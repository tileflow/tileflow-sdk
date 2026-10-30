package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.transport.ResourceCacheEntryFormat
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheMetadata
import dev.tileflow.sdk.transport.ResourceCacheRetention
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceCacheStore
import dev.tileflow.sdk.transport.ResourcePolicy
import dev.tileflow.sdk.transport.sha256Hex
import java.io.File
import java.io.IOException
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** One public or self-hosted resource of a region version, under the transport's own cache key. */
internal class OfflinePlannedResource(
    val key: ResourceCacheKey,
    /** Exact bytes on the wire, when known before download. */
    val bytes: Long?,
    /** SHA-256 of those bytes, when known before download. */
    val sha256: String?,
) {
    val url: URI
        get() = key.url
}

/** One pack of a Hosted region version. */
internal class OfflinePlannedPack(
    /** The download whose grant admits the pack. */
    val download: Int,
    val pack: OfflineDownloadPack,
    /**
     * A tile pack's source release. The same pack of the same request and release holds the same
     * bytes, so an update keeps it without asking.
     */
    val release: String?,
) {
    /**
     * Names the pack in the version's progress log: a corridor's downloads may list one pack id
     * with different covers.
     */
    val key: String = sha256Hex("$download\n${pack.id}".toByteArray())
}

/** A version's packs, resources and the authority to download them. */
internal class OfflineVersionPlan(
    val downloads: List<OfflineDownload> = emptyList(),
    val requests: List<OfflinePackRequest> = emptyList(),
    val packs: List<OfflinePlannedPack> = emptyList(),
    val resources: List<OfflinePlannedResource> = emptyList(),
    val tileCounts: Map<String, Long> = emptyMap(),
) {
    val isHosted: Boolean
        get() = downloads.isNotEmpty()

    /** Every resource: each pack's entries and each file. */
    val resourceCount: Long
        get() = packs.sumOf { it.pack.resources.toLong() } + resources.size

    val billable: Long
        get() = packs.sumOf { it.pack.billableResources.toLong() }

    /** Null when any size is unknown. */
    val bytes: Long?
        get() {
            var total = packs.sumOf { it.pack.bytes }
            for (resource in resources) total += resource.bytes ?: return null
            return total
        }

    companion object {
        /** Every pack of every download, and the public files they need once each. */
        fun hosted(
            downloads: List<OfflineDownload>,
            requests: List<OfflinePackRequest>,
        ): OfflineVersionPlan {
            val packs = ArrayList<OfflinePlannedPack>()
            val resources = ArrayList<OfflinePlannedResource>()
            val counts = LinkedHashMap<String, Long>()
            val seen = HashSet<String>()
            for ((index, download) in downloads.withIndex()) {
                for (source in download.manifest.sources) counts.putIfAbsent(source.source, 0)
                for (pack in download.manifest.packs) {
                    val release = pack.source?.let { download.manifest.source(it)?.version }
                    packs.add(OfflinePlannedPack(index, pack, release))
                    pack.source?.let {
                        counts[it] = (counts[it] ?: 0) + pack.resources
                    }
                }
                for (resource in download.manifest.publicResources) {
                    if (!seen.add(resource.url.toASCIIString())) continue
                    resources.add(
                        OfflinePlannedResource(
                            ResourceCacheKey(resource.url, ResourceCacheScope.Shared),
                            resource.bytes,
                            resource.sha256,
                        )
                    )
                }
            }
            return OfflineVersionPlan(downloads, requests, packs, resources, counts)
        }

        /**
         * A self-hosted version: the style's documents, then every tile of the cover at each
         * source's zooms. Sizes are unknown.
         */
        fun selfHosted(
            documents: List<URI>,
            sources: List<TileflowOfflineTileSource>,
            regions: List<OfflinePackRegion>,
            zooms: OfflineZooms,
        ): OfflineVersionPlan {
            val resources = ArrayList<OfflinePlannedResource>()
            val seen = HashSet<String>()
            val counts = HashMap<String, Long>()
            fun add(url: URI): Boolean {
                if (!seen.add(url.toASCIIString())) return false
                resources.add(
                    OfflinePlannedResource(ResourceCacheKey(url, ResourceCacheScope.Shared), null, null)
                )
                return true
            }
            documents.forEach { add(it) }
            for (source in sources) {
                counts.putIfAbsent(source.id, 0)
                val range =
                    zooms.zooms(source.minZoom, minOf(source.maxZoom, OfflineZooms.MAXIMUM))
                        ?: continue
                for (zoom in range) for (region in regions) {
                    val cover = OfflineTileCover(region, zoom)
                    val rows = cover.rows ?: continue
                    for (y in rows) for (xs in cover.row(y)) for (x in xs) {
                        val url = OfflineSelfHosted.tileUrl(source.template, zoom, x, y) ?: continue
                        if (add(url)) counts[source.id] = counts.getValue(source.id) + 1
                    }
                }
            }
            return OfflineVersionPlan(resources = resources, tileCounts = counts)
        }
    }
}

/** What ended a download pass. */
internal sealed class OfflineDownloadOutcome(val severity: Int) {
    /** Every pack and resource of the pass is stored. */
    object Complete : OfflineDownloadOutcome(0)

    /** A recoverable failure; continue after [delayMillis], or after a backoff when null. */
    class Wait(val error: TileflowOfflineException, val delayMillis: Long?) :
        OfflineDownloadOutcome(1)

    /**
     * A download's grant expired, its packs are out of date or were asked for too often: create
     * the download again.
     */
    class Renew(val download: Int, val error: TileflowOfflineException) : OfflineDownloadOutcome(2)

    class Fail(val error: TileflowOfflineException) : OfflineDownloadOutcome(3)

    object Cancelled : OfflineDownloadOutcome(4)
}

/** A pack the version a download replaces holds under the same key. */
internal class OfflinePreviousPack(
    val digest: String,
    val url: URI,
    val release: String?,
    /**
     * Whether the replaced version created the pack's download from the same request, so the same
     * pack of the same release holds the same tiles.
     */
    val sameRequest: Boolean,
)

/** One pass over a version's missing packs and resources. */
internal class OfflineDownloadJob(
    /** Prefix of every transfer identifier, unique to the region version. */
    val prefix: String,
    val plan: OfflineVersionPlan,
    val pending: List<OfflinePlannedResource>,
    val pendingPacks: List<OfflinePlannedPack> = emptyList(),
    /**
     * What a replaced version or an earlier pass holds for each pack key: offered with
     * `If-None-Match`, or kept without asking when its source's release did not change.
     */
    val previous: Map<String, OfflinePreviousPack> = emptyMap(),
    /**
     * Cache paths the stored versions use: changed bodies wait in [staging] until the version
     * completes, so a stored version never mixes in an unfinished update.
     */
    val activePaths: Set<String>,
    val staging: File,
    val packs: OfflinePackStore,
)

/**
 * Downloads and verifies a version's packs into the pack store and its resources into the pinned
 * partition.
 *
 * A pack is kept only when it is exactly the manifest's size, its trailer is the SHA-256 of what
 * precedes it, its `ETag` names that digest and every entry belongs to it: a tile pack's tiles lie
 * in its anchor, zooms and the download's cover, a document pack's names on the download's origins.
 * A stored pack is offered with `If-None-Match`; a `304` keeps it and is not billed. A resource is
 * stored only when its size and SHA-256 match the manifest. Recoverable refusals end the pass with
 * the wait the service asked for; a mismatch is retried twice before the download fails.
 */
internal class OfflineDownloader(
    private val cache: ResourceCacheStore,
    private val fetcher: OfflineResourceFetching,
    private val availableBytes: () -> Long?,
    private val reserveBytes: Long,
    private val concurrency: Int,
    private val now: () -> Long,
    /** Packs transferred at once. */
    private val packConcurrency: Int = 4,
) {
    private sealed class Work {
        abstract val key: String

        class Resource(val resource: OfflinePlannedResource) : Work() {
            override val key: String
                get() = resource.key.digest
        }

        class Pack(val pack: OfflinePlannedPack) : Work() {
            override val key: String
                get() = pack.key
        }
    }

    private sealed class Result {
        class Stored(val entry: OfflineStoredEntry) : Result()

        object Mismatch : Result()

        class Outcome(val outcome: OfflineDownloadOutcome) : Result()
    }

    /** Downloads the job's resources, then its packs. */
    suspend fun run(
        job: OfflineDownloadJob,
        log: OfflineProgressLog,
        progress: suspend (List<Pair<String, OfflineStoredEntry>>) -> Unit,
    ): OfflineDownloadOutcome {
        val files = pass(job.pending.map { Work.Resource(it) }, job, concurrency, log, progress)
        if (files !is OfflineDownloadOutcome.Complete) return files
        return pass(job.pendingPacks.map { Work.Pack(it) }, job, packConcurrency, log, progress)
    }

    private suspend fun pass(
        work: List<Work>,
        job: OfflineDownloadJob,
        concurrency: Int,
        log: OfflineProgressLog,
        progress: suspend (List<Pair<String, OfflineStoredEntry>>) -> Unit,
    ): OfflineDownloadOutcome {
        val lock = Mutex()
        var outcome: OfflineDownloadOutcome = OfflineDownloadOutcome.Complete
        var next = 0
        val retries = ArrayDeque<Work>()
        val mismatches = HashMap<String, Int>()
        val stored = ArrayList<Pair<String, OfflineStoredEntry>>()
        var sinceCheck = 0

        fun record(worse: OfflineDownloadOutcome) {
            if (worse.severity > outcome.severity) outcome = worse
        }

        suspend fun flush() {
            if (stored.isEmpty()) return
            val entries = ArrayList(stored)
            stored.clear()
            try {
                log.append(entries)
            } catch (_: IOException) {
                record(OfflineDownloadOutcome.Fail(storageError()))
            }
            progress(entries)
        }

        try {
            coroutineScope {
                repeat(concurrency) {
                    launch {
                        while (true) {
                            val item =
                                lock.withLock {
                                    if (outcome.severity > 0 || !isActive) null
                                    else
                                        retries.removeFirstOrNull()
                                            ?: work.getOrNull(next)?.also { next += 1 }
                                } ?: break
                            val result =
                                when (item) {
                                    is Work.Resource -> download(item.resource, job)
                                    is Work.Pack -> download(item.pack, job)
                                }
                            lock.withLock {
                                when (result) {
                                    is Result.Stored -> {
                                        stored.add(item.key to result.entry)
                                        sinceCheck += result.entry.resources
                                        // A pack is a unit of progress worth reporting at once.
                                        if (result.entry.pack != null) flush()
                                    }
                                    Result.Mismatch -> {
                                        val count = (mismatches[item.key] ?: 0) + 1
                                        mismatches[item.key] = count
                                        if (count >= 3)
                                            record(
                                                OfflineDownloadOutcome.Fail(
                                                    OfflinePackFormat.invalid()
                                                )
                                            )
                                        else retries.addLast(item)
                                    }
                                    is Result.Outcome -> record(result.outcome)
                                }
                                if (stored.size >= BATCH) flush()
                                if (sinceCheck >= SPACE_CHECK) {
                                    sinceCheck = 0
                                    val room =
                                        OfflineStorage.hasRoom(reserveBytes, availableBytes, cache)
                                    if (!room)
                                        record(
                                            OfflineDownloadOutcome.Fail(
                                                TileflowOfflineException(
                                                    TileflowOfflineErrorCode.INSUFFICIENT_STORAGE
                                                )
                                            )
                                        )
                                }
                            }
                        }
                    }
                }
            }
        } catch (error: CancellationException) {
            withContext(NonCancellable) { lock.withLock { flush() } }
            throw error
        }
        lock.withLock { flush() }
        currentCoroutineContext().ensureActive()
        if (
            outcome is OfflineDownloadOutcome.Complete &&
                (next < work.size || retries.isNotEmpty())
        )
            return OfflineDownloadOutcome.Cancelled
        return outcome
    }

    // Packs

    private suspend fun download(planned: OfflinePlannedPack, job: OfflineDownloadJob): Result {
        val pack = planned.pack
        val previous = job.previous[planned.key]?.takeIf { job.packs.size(it.digest) != null }
        // The same tiles of the same release under the same request: nothing to ask.
        if (
            previous != null &&
                previous.sameRequest &&
                pack.kind == OfflinePackKind.TILES &&
                previous.release != null &&
                previous.release == planned.release &&
                previous.url == pack.url &&
                job.packs.size(previous.digest) == pack.bytes
        )
            return Result.Stored(entry(pack, transferred = false, previous.digest))
        if (!OfflineStorage.hasRoom(pack.bytes + reserveBytes, availableBytes, cache))
            return Result.Outcome(OfflineDownloadOutcome.Fail(storageError()))
        val download = job.plan.downloads[planned.download]
        val headers = HashMap<String, String>()
        headers[GRANT_HEADER] = download.grant.value
        previous?.let { headers["If-None-Match"] = "\"${it.digest}\"" }
        // A new grant starts a new transfer: a resumed one would present the old grant again.
        val id = job.prefix + planned.key + "." + download.grant.tag
        val destination = job.packs.incoming(id)
        job.packs.incoming.mkdirs()
        val response =
            try {
                fetcher.fetch(OfflineFetchRequest(id, pack.url, headers, destination))
            } catch (error: CancellationException) {
                throw error
            } catch (_: OfflineTooLargeException) {
                destination.delete()
                return Result.Outcome(
                    OfflineDownloadOutcome.Fail(
                        TileflowOfflineException(
                            TileflowOfflineErrorCode.INVALID_RESPONSE,
                            TileflowErrorContext(reason = "resourceTooLarge"),
                        )
                    )
                )
            } catch (_: Exception) {
                return Result.Outcome(
                    OfflineDownloadOutcome.Wait(
                        TileflowOfflineException(TileflowOfflineErrorCode.NETWORK),
                        null,
                    )
                )
            }
        return when {
            response.status == 200 ->
                try {
                    val (digest, index) =
                        OfflinePackFormat.verify(destination, pack.bytes, pack.kind)
                    val tag = response.headers["ETag"]
                    if (tag != null && tag != "\"$digest\"") throw OfflinePackFormat.invalid()
                    check(index, planned, download.manifest)
                    job.packs.adopt(destination, digest)
                    Result.Stored(entry(pack, transferred = true, digest))
                } catch (_: Exception) {
                    destination.delete()
                    Result.Mismatch
                }
            response.status == 304 && previous != null ->
                Result.Stored(entry(pack, transferred = false, previous.digest))
            response.status == 416 -> {
                // The partial pack no longer matches: start it again.
                destination.delete()
                Result.Mismatch
            }
            else -> Result.Outcome(failure(response, planned.download, job))
        }
    }

    private fun entry(pack: OfflineDownloadPack, transferred: Boolean, digest: String) =
        OfflineStoredEntry(pack.bytes, transferred, pack.resources, digest)

    // Resources

    private suspend fun download(
        resource: OfflinePlannedResource,
        job: OfflineDownloadJob,
    ): Result {
        val stored = cache.read(resource.key, ResourceCacheRetention.PINNED)
        if (
            stored != null &&
                resource.sha256 != null &&
                stored.metadata.bodySha256 == resource.sha256
        )
            return Result.Stored(
                OfflineStoredEntry(resource.bytes ?: stored.body.size.toLong(), transferred = false)
            )
        val headers = HashMap<String, String>()
        stored?.metadata?.headers?.get("ETag")?.let { headers["If-None-Match"] = it }
        val response =
            try {
                fetcher.fetch(
                    OfflineFetchRequest(job.prefix + resource.key.digest, resource.url, headers)
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: OfflineTooLargeException) {
                return Result.Outcome(
                    OfflineDownloadOutcome.Fail(
                        TileflowOfflineException(
                            TileflowOfflineErrorCode.INVALID_RESPONSE,
                            TileflowErrorContext(reason = "resourceTooLarge"),
                        )
                    )
                )
            } catch (_: Exception) {
                return Result.Outcome(
                    OfflineDownloadOutcome.Wait(
                        TileflowOfflineException(TileflowOfflineErrorCode.NETWORK),
                        null,
                    )
                )
            }
        return when {
            response.status == 200 -> {
                if (!verify(response, resource)) return Result.Mismatch
                val digest = offlineDigest(response.body)
                val bytes = resource.bytes ?: response.body.size.toLong()
                val received = OfflineStoredEntry(bytes, transferred = true)
                if (stored?.metadata?.bodySha256 == digest) return Result.Stored(received)
                val metadata =
                    ResourceCacheMetadata.of(
                        resource.url,
                        200,
                        response.headers,
                        now(),
                        false,
                        response.body.size,
                        digest,
                    )
                val written =
                    if (resource.key.relativePath in job.activePaths)
                        runCatching {
                                OfflineLayout.write(
                                    ResourceCacheEntryFormat.encode(metadata, response.body),
                                    File(job.staging, resource.key.digest),
                                )
                            }
                            .isSuccess
                    else
                        cache.write(
                            resource.key,
                            ResourceCacheRetention.PINNED,
                            metadata,
                            response.body,
                        )
                if (written) Result.Stored(received)
                else Result.Outcome(OfflineDownloadOutcome.Fail(storageError()))
            }
            response.status == 304 && stored != null ->
                Result.Stored(
                    OfflineStoredEntry(
                        resource.bytes ?: stored.body.size.toLong(),
                        transferred = false,
                    )
                )
            (response.status == 204 || response.status == 404) && !job.plan.isHosted ->
                // An absent self-hosted tile or glyph range stays absent offline, as online.
                Result.Stored(OfflineStoredEntry(0, transferred = false))
            else -> Result.Outcome(failure(response, null, job))
        }
    }

    // Failures

    private fun failure(
        response: OfflineFetchResponse,
        download: Int?,
        job: OfflineDownloadJob,
    ): OfflineDownloadOutcome {
        val retryAfter =
            OfflinePackContract.retryAfterMillis(response.headers["Retry-After"], now())
        if (download == null) {
            val context = TileflowErrorContext(status = response.status)
            return when (response.status) {
                408,
                429,
                in 500..599 ->
                    OfflineDownloadOutcome.Wait(
                        TileflowOfflineException(TileflowOfflineErrorCode.UNAVAILABLE, context),
                        retryAfter,
                    )
                401,
                403 ->
                    OfflineDownloadOutcome.Fail(
                        TileflowOfflineException(TileflowOfflineErrorCode.ACCESS_DENIED, context)
                    )
                else ->
                    OfflineDownloadOutcome.Fail(
                        TileflowOfflineException(TileflowOfflineErrorCode.REJECTED, context)
                    )
            }
        }
        val error =
            OfflinePackContract.failure(
                response.status,
                response.body.copyOf(minOf(response.body.size, 8192)),
                response.headers["Retry-After"],
                OfflinePackContract.Operation.DOWNLOAD,
                now(),
            )
        return when (error.code) {
            TileflowOfflineErrorCode.GRANT_REJECTED,
            TileflowOfflineErrorCode.SUPERSEDED,
            TileflowOfflineErrorCode.NOT_FOUND -> OfflineDownloadOutcome.Renew(download, error)
            TileflowOfflineErrorCode.ACCESS_DENIED ->
                if (error.context.reason == "OFFLINE_PACK_RESOURCE_DENIED")
                    OfflineDownloadOutcome.Renew(download, error)
                else OfflineDownloadOutcome.Fail(error)
            TileflowOfflineErrorCode.RATE_LIMITED ->
                if (error.context.reason == "OFFLINE_PACK_REPEAT_LIMIT_REACHED")
                    OfflineDownloadOutcome.Renew(download, error)
                else OfflineDownloadOutcome.Wait(error, error.retryAfterMillis)
            TileflowOfflineErrorCode.UNAVAILABLE,
            TileflowOfflineErrorCode.DAILY_LIMIT_REACHED ->
                OfflineDownloadOutcome.Wait(error, error.retryAfterMillis)
            else -> OfflineDownloadOutcome.Fail(error)
        }
    }

    private fun storageError(): TileflowOfflineException {
        val available = availableBytes()
        return if (available != null && available < reserveBytes)
            TileflowOfflineException(TileflowOfflineErrorCode.INSUFFICIENT_STORAGE)
        else
            TileflowOfflineException(
                TileflowOfflineErrorCode.INSUFFICIENT_STORAGE,
                TileflowErrorContext(reason = "writeFailed"),
            )
    }

    companion object {
        const val GRANT_HEADER = "X-Tileflow-Offline-Grant"

        /** Stored resources are logged and reported in batches. */
        const val BATCH = 64

        /** Free space is checked again after this many stored resources. */
        const val SPACE_CHECK = 16

        /** Whether a verified pack holds exactly what its manifest entry promises. */
        fun check(
            index: OfflinePackIndex,
            planned: OfflinePlannedPack,
            manifest: OfflineDownloadManifest,
        ) {
            val pack = planned.pack
            if (index.kind != pack.kind || index.entries.size != pack.resources)
                throw OfflinePackFormat.invalid()
            when (pack.kind) {
                OfflinePackKind.TILES -> {
                    val anchor = pack.anchor ?: throw OfflinePackFormat.invalid()
                    val zooms = pack.zooms ?: throw OfflinePackFormat.invalid()
                    val covers = HashMap<Int, OfflineTileCover>()
                    val rows = HashMap<Pair<Int, Int>, List<IntRange>>()
                    for (name in index.entries.keys) {
                        val tile = OfflineTileId.ofName(name) ?: throw OfflinePackFormat.invalid()
                        if (tile.z !in zooms || tile.ancestor(anchor.z) != anchor)
                            throw OfflinePackFormat.invalid()
                        val cover = covers.getOrPut(tile.z) { OfflineTileCover(manifest.region, tile.z) }
                        val row = rows.getOrPut(tile.z to tile.y) { cover.row(tile.y) }
                        if (row.none { tile.x in it }) throw OfflinePackFormat.invalid()
                    }
                }
                OfflinePackKind.DOCUMENTS ->
                    for (name in index.entries.keys) {
                        val url = runCatching { URI(name) }.getOrNull()
                        if (url?.host == null || ResourcePolicy.origin(url) !in manifest.origins)
                            throw OfflinePackFormat.invalid()
                    }
            }
        }

        /** Whether a body is the manifest's resource, as received or as decoded. */
        fun verify(response: OfflineFetchResponse, resource: OfflinePlannedResource): Boolean {
            // Self-hosted sizes and hashes are unknown before download.
            val bytes = resource.bytes ?: return true
            val tag = etag(response.headers["ETag"])
            val expected = resource.sha256 ?: tag
            if (
                response.body.size.toLong() == bytes &&
                    (expected == null || expected == offlineDigest(response.body))
            )
                return true
            val encoding = response.headers["Content-Encoding"]?.lowercase()
            if (encoding == null || encoding == "identity" || response.wireBytes != bytes)
                return false
            response.wireSha256?.let { received -> return expected == null || expected == received }
            // The body was decoded; the service's tag must still name the manifest's hash.
            return resource.sha256 == null || resource.sha256 == tag
        }

        /** The SHA-256 a strong or weak `ETag` names, when it is one. */
        fun etag(value: String?): String? {
            var text = value?.trim() ?: return null
            if (text.startsWith("W/")) text = text.substring(2)
            if (text.length != 66 || !text.startsWith('"') || !text.endsWith('"')) return null
            val digest = text.substring(1, 65).lowercase()
            return digest.takeIf { it.all { char -> char in '0'..'9' || char in 'a'..'f' } }
        }
    }
}
