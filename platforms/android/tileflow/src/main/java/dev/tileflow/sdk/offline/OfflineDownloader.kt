package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.transport.ResourceCacheEntryFormat
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheMetadata
import dev.tileflow.sdk.transport.ResourceCacheRetention
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceCacheStore
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

/** One resource of a region version, under the transport's own cache key. */
internal class OfflinePlannedResource(
    val key: ResourceCacheKey,
    /** Exact bytes on the wire, when known before download. */
    val bytes: Long?,
    /** SHA-256 of those bytes, when known before download. */
    val sha256: String?,
    val billable: Boolean,
    val isPublic: Boolean,
    /** The Hosted pack whose grant admits it; null for public and self-hosted resources. */
    val pack: Int?,
) {
    val url: URI
        get() = key.url
}

/**
 * A version's resources and the authority to download them. Hosted resources a corridor's
 * overlapping packs share are downloaded once, under the first pack that lists them.
 */
internal class OfflineVersionPlan(
    val packs: List<OfflinePack> = emptyList(),
    val requests: List<OfflinePackRequest> = emptyList(),
    val resources: List<OfflinePlannedResource> = emptyList(),
    val tileCounts: Map<String, Long> = emptyMap(),
) {
    val isHosted: Boolean
        get() = packs.isNotEmpty()

    val billable: Long
        get() = resources.count { it.billable }.toLong()

    /** Null when any size is unknown. */
    val bytes: Long?
        get() {
            var total = 0L
            for (resource in resources) total += resource.bytes ?: return null
            return total
        }

    companion object {
        fun hosted(
            packs: List<OfflinePack>,
            requests: List<OfflinePackRequest>,
            apiOrigin: URI,
        ): OfflineVersionPlan {
            val resources = ArrayList<OfflinePlannedResource>()
            val seen = HashSet<String>()
            for ((index, pack) in packs.withIndex()) {
                val scope = ResourceCacheScope.grant(apiOrigin, pack.manifest.mapId)
                for (resource in OfflinePlanner.resources(pack.manifest)) {
                    if (!seen.add(resource.url.toASCIIString())) continue
                    resources.add(
                        OfflinePlannedResource(
                            ResourceCacheKey(
                                resource.url,
                                if (resource.isPublic) ResourceCacheScope.Shared else scope,
                            ),
                            resource.bytes,
                            resource.sha256,
                            resource.billable,
                            resource.isPublic,
                            if (resource.isPublic) null else index,
                        )
                    )
                }
            }
            // Tiles per source, counted once across packs.
            val counts = HashMap<String, Long>()
            val counted = HashSet<String>()
            for (pack in packs) for (set in pack.manifest.tiles) {
                counts.putIfAbsent(set.source, 0)
                for (tile in set.entries)
                    if (counted.add(set.url(tile).toASCIIString()))
                        counts[set.source] = counts.getValue(set.source) + 1
            }
            return OfflineVersionPlan(packs, requests, resources, counts)
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
                    OfflinePlannedResource(
                        ResourceCacheKey(url, ResourceCacheScope.Shared),
                        null,
                        null,
                        billable = false,
                        isPublic = true,
                        pack = null,
                    )
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
    /** Every resource of the pass is stored. */
    object Complete : OfflineDownloadOutcome(0)

    /** A recoverable failure; continue after [delayMillis], or after a backoff when null. */
    class Wait(val error: TileflowOfflineException, val delayMillis: Long?) :
        OfflineDownloadOutcome(1)

    /** A pack's grant expired or its manifest is out of date: create the pack again. */
    class Renew(val pack: Int, val error: TileflowOfflineException) : OfflineDownloadOutcome(2)

    class Fail(val error: TileflowOfflineException) : OfflineDownloadOutcome(3)

    object Cancelled : OfflineDownloadOutcome(4)
}

/** One pass over a version's missing resources. */
internal class OfflineDownloadJob(
    /** Prefix of every transfer identifier, unique to the region version. */
    val prefix: String,
    val plan: OfflineVersionPlan,
    val pending: List<OfflinePlannedResource>,
    /**
     * Cache paths the stored versions use: changed bodies wait in [staging] until the version
     * completes, so a stored version never mixes in an unfinished update.
     */
    val activePaths: Set<String>,
    val staging: File,
)

/**
 * Downloads, verifies and stores resources into the pinned partition.
 *
 * A body is stored only when it matches the manifest: as received, or as decoded, its size and
 * SHA-256 (the manifest's, else the `ETag`'s) agree. A stored copy is offered with
 * `If-None-Match`; a `304` keeps it and is not billed. Recoverable refusals end the pass with the
 * wait the service asked for; a mismatch is retried twice before the download fails.
 */
internal class OfflineDownloader(
    private val cache: ResourceCacheStore,
    private val fetcher: OfflineResourceFetching,
    private val availableBytes: () -> Long?,
    private val reserveBytes: Long,
    private val concurrency: Int,
    private val now: () -> Long,
) {
    private sealed class Result {
        class Stored(val bytes: Long) : Result()

        object Mismatch : Result()

        class Outcome(val outcome: OfflineDownloadOutcome) : Result()
    }

    suspend fun run(
        job: OfflineDownloadJob,
        log: OfflineProgressLog,
        progress: suspend (List<Pair<String, Long>>) -> Unit,
    ): OfflineDownloadOutcome {
        val lock = Mutex()
        var outcome: OfflineDownloadOutcome = OfflineDownloadOutcome.Complete
        var next = 0
        val retries = ArrayDeque<OfflinePlannedResource>()
        val mismatches = HashMap<String, Int>()
        val stored = ArrayList<Pair<String, Long>>()
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
                            val resource =
                                lock.withLock {
                                    if (outcome.severity > 0 || !isActive) null
                                    else
                                        retries.removeFirstOrNull()
                                            ?: job.pending.getOrNull(next)?.also { next += 1 }
                                } ?: break
                            val result = download(resource, job)
                            lock.withLock {
                                when (result) {
                                    is Result.Stored -> {
                                        stored.add(resource.key.digest to result.bytes)
                                        sinceCheck += 1
                                    }
                                    Result.Mismatch -> {
                                        val count = (mismatches[resource.key.digest] ?: 0) + 1
                                        mismatches[resource.key.digest] = count
                                        if (count >= 3)
                                            record(
                                                OfflineDownloadOutcome.Fail(
                                                    TileflowOfflineException(
                                                        TileflowOfflineErrorCode.INVALID_RESPONSE,
                                                        TileflowErrorContext(
                                                            reason = "verificationFailed"
                                                        ),
                                                    )
                                                )
                                            )
                                        else retries.addLast(resource)
                                    }
                                    is Result.Outcome -> record(result.outcome)
                                }
                                if (stored.size >= BATCH) flush()
                                if (sinceCheck >= SPACE_CHECK) {
                                    sinceCheck = 0
                                    val available = availableBytes()
                                    if (available != null && available < reserveBytes)
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
                (next < job.pending.size || retries.isNotEmpty())
        )
            return OfflineDownloadOutcome.Cancelled
        return outcome
    }

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
            return Result.Stored(resource.bytes ?: stored.body.size.toLong())
        val headers = HashMap<String, String>()
        resource.pack?.let { headers[GRANT_HEADER] = job.plan.packs[it].grant.value }
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
                if (stored?.metadata?.bodySha256 == digest) return Result.Stored(bytes)
                val metadata =
                    ResourceCacheMetadata.of(
                        resource.url,
                        200,
                        response.headers,
                        now(),
                        job.plan.isHosted && !resource.isPublic,
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
                if (written) Result.Stored(bytes)
                else Result.Outcome(OfflineDownloadOutcome.Fail(storageError()))
            }
            response.status == 304 && stored != null ->
                Result.Stored(resource.bytes ?: stored.body.size.toLong())
            (response.status == 204 || response.status == 404) && !job.plan.isHosted ->
                // An absent self-hosted tile or glyph range stays absent offline, as online.
                Result.Stored(0)
            else -> Result.Outcome(failure(response, resource, job))
        }
    }

    private fun failure(
        response: OfflineFetchResponse,
        resource: OfflinePlannedResource,
        job: OfflineDownloadJob,
    ): OfflineDownloadOutcome {
        val retryAfter =
            OfflinePackContract.retryAfterMillis(response.headers["Retry-After"], now())
        if (!job.plan.isHosted) {
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
            TileflowOfflineErrorCode.NOT_FOUND ->
                OfflineDownloadOutcome.Renew(resource.pack ?: 0, error)
            TileflowOfflineErrorCode.ACCESS_DENIED ->
                if (error.context.reason == "OFFLINE_PACK_RESOURCE_DENIED")
                    OfflineDownloadOutcome.Renew(resource.pack ?: 0, error)
                else OfflineDownloadOutcome.Fail(error)
            TileflowOfflineErrorCode.RATE_LIMITED,
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
