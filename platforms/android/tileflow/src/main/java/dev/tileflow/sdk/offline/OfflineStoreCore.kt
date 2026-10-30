package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.transport.ResourceCacheEntryFormat
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheRetention
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceCacheStore
import dev.tileflow.sdk.transport.sha256Hex
import java.io.File
import java.net.URI
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Delivers region events in order on one thread. */
internal class OfflineSubscribers {
    private val handlers = ConcurrentHashMap<UUID, (TileflowOfflineRegionEvent) -> Unit>()
    private val executor =
        Executors.newSingleThreadExecutor {
            Thread(it, "tileflow-offline-events").apply { isDaemon = true }
        }

    fun add(handler: (TileflowOfflineRegionEvent) -> Unit): TileflowOfflineSubscription {
        val id = UUID.randomUUID()
        handlers[id] = handler
        return TileflowOfflineSubscription { handlers.remove(id) }
    }

    fun emit(event: TileflowOfflineRegionEvent) {
        val current = handlers.values.toList()
        if (current.isNotEmpty()) executor.execute { current.forEach { it(event) } }
    }
}

/** Runs a region's download until it settles: in the process, or as background work. */
internal interface OfflineRunner {
    fun start(id: String, restriction: TileflowOfflineNetworkRestriction)

    fun stop(id: String)
}

/** What ended a [OfflineStoreCore.drive]. */
internal sealed class OfflineDriveResult {
    /** Complete, failed, paused, removed or interrupted: nothing to schedule. */
    object Settled : OfflineDriveResult()

    /** Waiting longer than the caller allows: continue at [atMillis]. */
    class Deferred(val atMillis: Long) : OfflineDriveResult()
}

/**
 * The store's state and its one writer.
 *
 * Records change only under [lock]. A version becomes the region's `active` version only when
 * every pack and resource is stored and verified, by one atomic record replacement. Packs are shared
 * across regions by digest and resources by cache key; either is released only when no region
 * version references it. Each multi-step change is recorded before it starts (`pending`, `retired`,
 * `removing`) and finished when the store opens again, so a crash never leaves an unreferenced or
 * missing pack or resource behind.
 */
internal class OfflineStoreCore(
    private val layout: OfflineLayout,
    private val cache: ResourceCacheStore,
    private val fetcher: OfflineResourceFetching,
    private val client: () -> OfflinePackClient,
    private val availableBytes: () -> Long?,
    private val subscribers: OfflineSubscribers,
    /** Where maps learn which stored regions they may use. */
    private val index: OfflineServingIndex? = null,
    runner: (OfflineStoreCore) -> OfflineRunner,
    /** Space a download leaves free on the device. */
    private val reserveBytes: Long = 64L * 1024 * 1024,
    private val concurrency: Int = 16,
    /** Packs transferred at once. */
    private val packConcurrency: Int = 4,
    private val now: () -> Long = System::currentTimeMillis,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private val runner = runner(this)
    private val lock = Mutex()
    private val records = HashMap<String, OfflineRegionRecord>()
    private var isOpen = false
    private val progress = HashMap<String, OfflineProgress>()
    private val plans = HashMap<String, OfflineVersionPlan>()
    private val keySets = HashMap<String, Set<String>>()
    private val unitSets = HashMap<String, Map<String, Long>>()
    private val digestSets = HashMap<String, Set<String>>()
    private val servedSets = HashMap<String, Map<String, OfflineServedPacks>>()
    private val creditSets = HashMap<String, Map<String, List<OfflineCredit>>>()
    private val created = HashMap<OfflinePackRequest, OfflineDownload>()
    /** Packs an earlier pass of a pending version held before its download was created again. */
    private val candidates = HashMap<String, Map<String, OfflinePreviousPack>>()

    // Opening.

    /** Reads the records, finishes interrupted removals and replacements, and resumes downloads. */
    suspend fun open() = lock.withLock { openLocked() }

    private fun openLocked() {
        if (isOpen) return
        isOpen = true
        for (directory in layout.regions.listFiles().orEmpty()) {
            val record = OfflineRegionRecord.read(File(directory, "region.json"))
            if (record == null) {
                // A region whose record was never written stored nothing.
                directory.deleteRecursively()
                continue
            }
            records[record.id] = record
        }
        for (id in records.keys.sorted()) {
            val record = records[id] ?: continue
            if (record.removing) {
                finishRemoval(id)
                continue
            }
            if (record.retired != null) finishRetirement(id)
            val pending = record.pending ?: continue
            progress[id] = storedProgress(id, pending)
            if (
                pending.state == OfflineVersionRecord.State.DOWNLOADING ||
                    pending.state == OfflineVersionRecord.State.WAITING
            )
                start(id, pending)
        }
        publishServing()
    }

    /** Whether maps may use the region's stored version. */
    private fun isServed(record: OfflineRegionRecord): Boolean =
        record.active != null &&
            !record.removing &&
            (record.check?.state != "not_updatable" ||
                OfflineServingRule.SERVES_REGIONS_AFTER_ACCESS_ENDS)

    /**
     * Tells maps which stored packs, resources and regional credits they may use without a
     * network.
     */
    private fun publishServing() {
        val index = index ?: return
        val paths = HashSet<String>()
        val packs = HashMap<String, OfflineServedPacks>()
        val credits = HashMap<String, MutableList<OfflineCredit>>()
        for ((id, record) in records) {
            if (!isServed(record)) continue
            val active = record.active ?: continue
            paths.addAll(keys(id, active))
            val origin = active.apiOrigin?.let { URI(it) } ?: continue
            if (active.downloads == 0) continue
            for ((scope, served) in served(id, active, origin))
                packs[scope] = packs[scope]?.merging(served) ?: served
            for ((scope, list) in credits(id, active, origin)) {
                val merged = credits.getOrPut(scope) { mutableListOf() }
                for (credit in list) if (merged.none { it.id == credit.id }) merged.add(credit)
            }
        }
        index.publish(OfflineServingSnapshot(paths, packs, credits), this)
    }

    /**
     * The packs of a complete Hosted version as maps read them, by the cache scope of their Map:
     * document packs' entries by address, tile packs by source template and anchor.
     */
    private fun served(
        id: String,
        version: OfflineVersionRecord,
        apiOrigin: URI,
    ): Map<String, OfflineServedPacks> {
        val key = planKey(id, version.number)
        servedSets[key]?.let {
            return it
        }
        val plan = runCatching { plan(id, version) }.getOrNull() ?: return emptyMap()
        val stored = OfflineProgressLog.read(layout.progress(id, version.number))
        val documents = HashMap<String, HashMap<String, Pair<File, OfflinePackEntry>>>()
        val tiles = HashMap<String, HashMap<String, OfflineServedTiles>>()
        // Every source a download holds answers for its cover, even where no pack was stored.
        for (download in plan.downloads) {
            val scope = ResourceCacheScope.grant(apiOrigin, download.manifest.mapId).directory
            val bySource = tiles.getOrPut(scope) { HashMap() }
            for (source in download.manifest.sources) {
                val zooms = source.zooms ?: continue
                val served =
                    bySource[source.template.text]
                        ?: OfflineServedTiles(source.template, zooms, source.absentStatus)
                bySource[source.template.text] =
                    served.copy(regions = (served.regions + download.manifest.region).distinct())
            }
        }
        for (planned in plan.packs) {
            val digest = stored[planned.key]?.pack ?: continue
            val manifest = plan.downloads[planned.download].manifest
            val scope = ResourceCacheScope.grant(apiOrigin, manifest.mapId).directory
            val file = layout.packs.file(digest)
            when (planned.pack.kind) {
                OfflinePackKind.DOCUMENTS -> {
                    val index = runCatching { OfflinePackFormat.index(file) }.getOrNull() ?: continue
                    val byUrl = documents.getOrPut(scope) { HashMap() }
                    for (entry in index.entries.values) byUrl.putIfAbsent(entry.name, file to entry)
                }
                OfflinePackKind.TILES -> {
                    val source = planned.pack.source?.let(manifest::source) ?: continue
                    val anchor = planned.pack.anchor ?: continue
                    val bySource = tiles.getOrPut(scope) { HashMap() }
                    val served = bySource[source.template.text] ?: continue
                    bySource[source.template.text] =
                        served.copy(
                            anchors =
                                served.anchors + (anchor to (served.anchors[anchor].orEmpty() + file))
                        )
                }
            }
        }
        val result =
            (documents.keys + tiles.keys).associateWith {
                OfflineServedPacks(documents[it].orEmpty(), tiles[it].orEmpty())
            }
        return result.also { servedSets[key] = it }
    }

    /** The regional credits of a Hosted version's downloads, by the cache scope of their Map. */
    private fun credits(
        id: String,
        version: OfflineVersionRecord,
        apiOrigin: URI,
    ): Map<String, List<OfflineCredit>> {
        val key = planKey(id, version.number)
        creditSets[key]?.let {
            return it
        }
        val plan = runCatching { plan(id, version) }.getOrNull() ?: return emptyMap()
        val result = HashMap<String, List<OfflineCredit>>()
        for (download in plan.downloads) {
            val scope = ResourceCacheScope.grant(apiOrigin, download.manifest.mapId).directory
            result[scope] =
                result[scope].orEmpty() + OfflineCredit.credits(download.manifest.attribution)
        }
        return result.also { creditSets[key] = it }
    }

    // Reading.

    suspend fun regions(): List<TileflowOfflineRegion> =
        lock.withLock {
            openLocked()
            records.values
                .filter { !it.removing }
                .sortedWith(compareBy({ it.createdAt }, { it.id }))
                .mapNotNull(::snapshot)
        }

    suspend fun region(id: String): TileflowOfflineRegion? =
        lock.withLock {
            openLocked()
            records[id]?.let(::snapshot)
        }

    // Estimating.

    suspend fun estimate(options: TileflowOfflineRegionLoadOptions): TileflowOfflineRegionEstimate {
        open()
        return when (val content = options.content) {
            is TileflowOfflineContent.Hosted -> {
                val plan = hostedPlan(options).first
                // Packs the device holds for the same request and release are kept without being
                // billed.
                val held = lock.withLock { heldUnits() }
                val perDownload = LongArray(plan.downloads.size)
                for (planned in plan.packs)
                    if (unit(planned, plan) !in held)
                        perDownload[planned.download] += planned.pack.billableResources.toLong()
                val perView = OfflinePlanner.RESOURCES_PER_MAP_VIEW
                TileflowOfflineRegionEstimate(
                    plan.packs.size.toLong(),
                    plan.resourceCount,
                    plan.billable,
                    plan.resources.size.toLong(),
                    plan.bytes,
                    plan.tileCounts,
                    perDownload.sumOf { (it + perView - 1) / perView },
                )
            }
            is TileflowOfflineContent.Manifest -> {
                OfflineSelfHosted.validate(content.url, content.map)
                OfflineSelfHosted.validate(content.sources)
                OfflinePlanner.estimate(
                    options.geometry,
                    options.zooms,
                    content.sources.map {
                        OfflinePlanner.SelfHostedSource(it.id, it.minZoom, it.maxZoom)
                    },
                )
            }
        }
    }

    // Loading.

    /** Creates the region, resumes its unfinished download, or downloads a new version of it. */
    suspend fun load(id: String, options: TileflowOfflineRegionLoadOptions): TileflowOfflineRegion {
        open()
        if (id.isEmpty() || id.toByteArray().size > 256)
            throw TileflowOfflineException.options("invalidRegionID")
        options.geometry.validate()
        options.zooms
        val json = options.toJson()
        lock.withLock {
            val record = records[id]
            val pending = record?.pending
            val current = pending?.let { offlineOptions(it.options) }
            if (
                record != null &&
                    pending != null &&
                    current?.copy(metadata = emptyMap()) == options.copy(metadata = emptyMap())
            ) {
                // Metadata alone never restarts a download: it changes in place.
                if (current.metadata != options.metadata)
                    save(replacingMetadata(record, options.metadata))
                val latest = records.getValue(id)
                if (pending.state != OfflineVersionRecord.State.DOWNLOADING)
                    save(
                        latest.copy(
                            pending =
                                latest.pending!!.copy(
                                    state = OfflineVersionRecord.State.DOWNLOADING,
                                    error = null,
                                    retryAt = null,
                                )
                        )
                    )
                start(id, pending)
                return snapshot(records.getValue(id))!!
            }
        }

        // A new version: the plan first, so a refusal changes nothing.
        val number = lock.withLock { records[id]?.nextVersion ?: 1 }
        val plan: OfflineVersionPlan
        var apiOrigin: URI? = null
        when (val content = options.content) {
            is TileflowOfflineContent.Hosted -> {
                val hosted = hostedPlan(options, consuming = true)
                plan = hosted.first
                apiOrigin = hosted.second
                lock.withLock { checkDeviceLimit(id, plan) }
            }
            is TileflowOfflineContent.Manifest -> {
                val manifest = OfflineSelfHosted.validate(content.url, content.map)
                OfflineSelfHosted.validate(content.sources)
                val documents = selfHostedDocuments(manifest, content.map)
                plan =
                    OfflineVersionPlan.selfHosted(
                        documents,
                        content.sources,
                        options.geometry.packRegions(),
                        options.zooms,
                    )
                OfflineLayout.write(
                    JSONObject()
                        .put("documents", JSONArray(documents.map { it.toASCIIString() }))
                        .toString()
                        .toByteArray(),
                    layout.plan(id, number),
                )
            }
        }
        return lock.withLock {
            if (records[id]?.pending != null) discardPending(id)
            val time = now()
            val record = records[id] ?: OfflineRegionRecord(id, time)
            for ((index, download) in plan.downloads.withIndex()) {
                OfflineLayout.write(plan.requests[index].body, layout.request(id, number, index))
                OfflineLayout.write(download.response, layout.download(id, number, index))
            }
            val pending =
                OfflineVersionRecord(
                    number,
                    json,
                    apiOrigin?.toString(),
                    plan.downloads.size,
                    plan.packs.size,
                    plan.resourceCount,
                    plan.billable,
                    plan.bytes,
                    OfflineVersionRecord.State.DOWNLOADING,
                    createdAt = time,
                )
            save(record.copy(pending = pending))
            plans[planKey(id, number)] = plan
            progress[id] = OfflineProgress()
            start(id, pending)
            snapshot(records.getValue(id))!!.also {
                subscribers.emit(TileflowOfflineRegionEvent.Changed(it))
            }
        }
    }

    // Controlling.

    suspend fun pause(id: String) =
        lock.withLock {
            openLocked()
            val record = existing(id)
            val pending = record.pending ?: return@withLock
            if (pending.state == OfflineVersionRecord.State.PAUSED) return@withLock
            runner.stop(id)
            save(
                record.copy(
                    pending =
                        pending.copy(state = OfflineVersionRecord.State.PAUSED, retryAt = null)
                )
            )
            emitChanged(id)
        }

    suspend fun resume(id: String) =
        lock.withLock {
            openLocked()
            val record = existing(id)
            val pending = record.pending ?: return@withLock
            // A waiting download continues now instead of at its retry time.
            if (pending.state == OfflineVersionRecord.State.WAITING) runner.stop(id)
            if (pending.state != OfflineVersionRecord.State.DOWNLOADING)
                save(
                    record.copy(
                        pending =
                            pending.copy(
                                state = OfflineVersionRecord.State.DOWNLOADING,
                                error = null,
                                retryAt = null,
                            )
                    )
                )
            start(id, pending)
            emitChanged(id)
        }

    /**
     * Stops the download. A region never completed is removed; an update is abandoned and the
     * stored version kept.
     */
    suspend fun cancel(id: String) =
        lock.withLock {
            openLocked()
            val record = existing(id)
            if (record.active == null) return@withLock removeLocked(id)
            if (record.pending == null) return@withLock
            discardPending(id)
            emitChanged(id)
        }

    suspend fun remove(id: String) =
        lock.withLock {
            openLocked()
            removeLocked(id)
        }

    private fun removeLocked(id: String) {
        val record = existing(id)
        runner.stop(id)
        save(record.copy(removing = true))
        finishRemoval(id)
    }

    private fun existing(id: String): OfflineRegionRecord =
        records[id]?.takeIf { !it.removing }
            ?: throw TileflowOfflineException(TileflowOfflineErrorCode.REGION_NOT_FOUND)

    // Updates.

    /**
     * Revalidates stored Hosted regions that are due: never checked, or checked longer ago than
     * the service's interval. Access ending stops further checks; nothing is removed.
     */
    suspend fun checkForUpdates() {
        open()
        val client = runCatching { client() }.getOrNull() ?: return
        val due =
            lock.withLock {
                val time = now()
                records.values
                    .filter { record ->
                        val active = record.active
                        val check = record.check
                        !record.removing &&
                            active != null &&
                            active.packs > 0 &&
                            (check == null ||
                                (check.state != "not_updatable" &&
                                    time >= check.checkedAt + check.intervalMillis))
                    }
                    .mapNotNull { record ->
                        runCatching { record.id to plan(record.id, record.active!!) }.getOrNull()
                    }
            }
        for ((id, plan) in due) {
            val states = ArrayList<OfflinePackRevalidation>()
            for (download in plan.downloads) {
                states.add(
                    try {
                        client.revalidate(download.grant)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        break
                    }
                )
            }
            if (states.size != plan.downloads.size) continue
            var check = OfflineCheckRecord("current", null, now(), 86_400_000)
            for (state in states) {
                check =
                    when (state) {
                        is OfflinePackRevalidation.Current ->
                            check.copy(
                                checkedAt = state.checkedAtMillis,
                                intervalMillis = minOf(check.intervalMillis, state.intervalMillis),
                            )
                        is OfflinePackRevalidation.UpdateAvailable ->
                            check.copy(
                                state =
                                    if (check.state == "current") "update_available"
                                    else check.state,
                                checkedAt = state.checkedAtMillis,
                                intervalMillis = minOf(check.intervalMillis, state.intervalMillis),
                            )
                        is OfflinePackRevalidation.NotUpdatable ->
                            check.copy(
                                state = "not_updatable",
                                reason = check.reason ?: state.reason,
                                checkedAt = state.checkedAtMillis,
                            )
                    }
            }
            lock.withLock {
                val current = records[id]?.takeIf { !it.removing } ?: return@withLock
                save(current.copy(check = check))
                publishServing()
                emitChanged(id)
            }
        }
    }

    /** The network returned: waiting downloads try again now and due regions are revalidated. */
    suspend fun networkDidConnect() {
        lock.withLock {
            openLocked()
            for ((id, record) in records) {
                val pending = record.pending ?: continue
                if (
                    !record.removing &&
                        pending.state == OfflineVersionRecord.State.WAITING &&
                        pending.error?.code == TileflowOfflineErrorCode.NETWORK.name
                ) {
                    runner.stop(id)
                    start(id, pending)
                }
            }
        }
        checkForUpdates()
    }

    // Downloading.

    private fun start(id: String, pending: OfflineVersionRecord) =
        runner.start(
            id,
            offlineOptions(pending.options)?.networkRestriction
                ?: TileflowOfflineNetworkRestriction.NONE,
        )

    /**
     * Downloads the region's pending version until it completes, fails, pauses or is stopped.
     * Waits longer than [maximumWaitMillis] end the drive with the time to continue.
     */
    suspend fun drive(id: String, maximumWaitMillis: Long = Long.MAX_VALUE): OfflineDriveResult {
        open()
        var renewals = 0
        var attempt = 0
        var waited = false
        while (currentCoroutineContext().isActive) {
            val pending =
                lock.withLock {
                    val record =
                        records[id]?.takeIf { !it.removing } ?: return OfflineDriveResult.Settled
                    record.pending?.takeIf {
                        it.state == OfflineVersionRecord.State.DOWNLOADING ||
                            it.state == OfflineVersionRecord.State.WAITING
                    }
                } ?: return OfflineDriveResult.Settled
            val retryAt = pending.retryAt
            if (retryAt != null && !waited) {
                val wait = retryAt - now()
                if (wait > 0) {
                    if (wait > maximumWaitMillis) return OfflineDriveResult.Deferred(retryAt)
                    sleep(wait)
                    waited = true
                    continue
                }
            }
            waited = false
            val plan =
                lock.withLock {
                    runCatching { plan(id, pending) }.getOrNull()
                        ?: run {
                            update(id) {
                                it.failed(
                                    TileflowOfflineException(
                                        TileflowOfflineErrorCode.INVALID_RESPONSE,
                                        TileflowErrorContext(reason = "storedPack"),
                                    )
                                )
                            }
                            null
                        }
                } ?: return OfflineDriveResult.Settled
            val stored = OfflineProgressLog.read(layout.progress(id, pending.number))
            val remaining = plan.resources.filter { it.key.digest !in stored }
            // A logged pack whose file is gone is downloaded again.
            val remainingPacks =
                plan.packs.filter { planned ->
                    stored[planned.key]?.pack?.let { layout.packs.size(it) } == null
                }
            lock.withLock { progress[id] = OfflineProgress.of(stored.values) }
            if (remaining.isEmpty() && remainingPacks.isEmpty()) {
                lock.withLock { activate(id) }
                return OfflineDriveResult.Settled
            }
            val needed = remaining.sumOf { it.bytes ?: 0 } + remainingPacks.sumOf { it.pack.bytes }
            if (!OfflineStorage.hasRoom(needed + reserveBytes, availableBytes, cache)) {
                lock.withLock {
                    update(id) {
                        it.failed(
                            TileflowOfflineException(
                                TileflowOfflineErrorCode.INSUFFICIENT_STORAGE,
                                TileflowErrorContext(
                                    limit = needed.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                                ),
                            )
                        )
                    }
                }
                return OfflineDriveResult.Settled
            }
            val time = now()
            val expiring =
                plan.downloads.indices.firstOrNull { index ->
                    plan.downloads[index].manifest.downloadExpiresAtMillis - time <
                        RENEWAL_MARGIN && remainingPacks.any { it.download == index }
                }
            if (expiring != null) {
                renewals += 1
                if (!renew(id, pending, expiring, renewals)) return OfflineDriveResult.Settled
                continue
            }
            if (pending.state != OfflineVersionRecord.State.DOWNLOADING || pending.error != null)
                lock.withLock {
                    update(id) {
                        it.copy(
                            state = OfflineVersionRecord.State.DOWNLOADING,
                            error = null,
                            retryAt = null,
                        )
                    }
                }
            val job =
                lock.withLock {
                    OfflineDownloadJob(
                        transferPrefix(id, pending.number),
                        plan,
                        remaining,
                        remainingPacks,
                        previousPacks(id, plan),
                        activePaths(),
                        layout.staging(id, pending.number),
                        layout.packs,
                    )
                }
            val log = OfflineProgressLog(layout.progress(id, pending.number))
            val outcome =
                try {
                    OfflineDownloader(
                            cache,
                            fetcher,
                            availableBytes,
                            reserveBytes,
                            concurrency,
                            now,
                            packConcurrency,
                        )
                        .run(job, log) { entries -> didStore(id, entries) }
                } finally {
                    log.close()
                }
            when (outcome) {
                OfflineDownloadOutcome.Complete -> attempt = 0
                OfflineDownloadOutcome.Cancelled -> return OfflineDriveResult.Settled
                is OfflineDownloadOutcome.Renew -> {
                    renewals += 1
                    if (renewals > MAXIMUM_RENEWALS) {
                        lock.withLock { update(id) { it.failed(outcome.error) } }
                        return OfflineDriveResult.Settled
                    }
                    if (!renew(id, pending, outcome.download, renewals))
                        return OfflineDriveResult.Settled
                }
                is OfflineDownloadOutcome.Wait -> {
                    attempt += 1
                    val wait =
                        outcome.delayMillis
                            ?: minOf(MAXIMUM_BACKOFF, 1_000L shl minOf(attempt, 9))
                    lock.withLock {
                        update(id) {
                            it.copy(
                                state = OfflineVersionRecord.State.WAITING,
                                error = OfflineStoredError.of(outcome.error),
                                retryAt = now() + wait,
                            )
                        }
                    }
                }
                is OfflineDownloadOutcome.Fail -> {
                    lock.withLock { update(id) { it.failed(outcome.error) } }
                    return OfflineDriveResult.Settled
                }
            }
        }
        return OfflineDriveResult.Settled
    }

    /** A background run was stopped by the system: the download waits for it to run again. */
    suspend fun interrupted(id: String) =
        withContext(NonCancellable) {
            lock.withLock {
                val pending = records[id]?.pending ?: return@withLock
                if (pending.state == OfflineVersionRecord.State.DOWNLOADING)
                    update(id) {
                        it.copy(
                            state = OfflineVersionRecord.State.WAITING,
                            error = OfflineStoredError(TileflowOfflineErrorCode.NETWORK.name),
                        )
                    }
            }
        }

    private suspend fun didStore(id: String, entries: List<Pair<String, OfflineStoredEntry>>) =
        lock.withLock {
            progress[id] =
                entries.fold(progress[id] ?: OfflineProgress()) { current, entry ->
                    current.adding(entry.second)
                }
            emitChanged(id)
        }

    /**
     * Creates a download of the pending version again. Stored resources and tile packs the new
     * manifest lists unchanged are kept; other packs it held are offered with `If-None-Match`, so
     * unchanged ones answer 304. Returns false when the download stopped.
     */
    private suspend fun renew(
        id: String,
        pending: OfflineVersionRecord,
        index: Int,
        renewals: Int,
    ): Boolean {
        if (renewals > MAXIMUM_RENEWALS) {
            lock.withLock {
                update(id) {
                    it.failed(TileflowOfflineException(TileflowOfflineErrorCode.GRANT_REJECTED))
                }
            }
            return false
        }
        try {
            val client = client()
            val previousPlan = lock.withLock { plan(id, pending) }
            val download = client.create(previousPlan.requests[index])
            return lock.withLock {
                if (records[id]?.pending?.number != pending.number) return@withLock false
                val previousResources =
                    previousPlan.resources.associate { it.key.digest to (it.bytes to it.sha256) }
                val previousPacks = previousPlan.packs.associateBy { it.key }
                val downloads =
                    previousPlan.downloads.toMutableList().also { it[index] = download }
                val plan = OfflineVersionPlan.hosted(downloads, previousPlan.requests)
                checkDeviceLimit(id, plan)
                val stored = OfflineProgressLog.read(layout.progress(id, pending.number))
                val kept = HashMap<String, OfflineStoredEntry>()
                val offered = HashMap(candidates[planKey(id, pending.number)].orEmpty())
                for (resource in plan.resources) {
                    val entry = stored[resource.key.digest] ?: continue
                    if (previousResources[resource.key.digest] == (resource.bytes to resource.sha256))
                        kept[resource.key.digest] = entry
                }
                for (planned in plan.packs) {
                    val entry = stored[planned.key] ?: continue
                    val digest = entry.pack ?: continue
                    val before = previousPacks[planned.key]
                    if (
                        planned.download != index ||
                            (planned.pack.kind == OfflinePackKind.TILES &&
                                before?.release == planned.release &&
                                before?.pack?.url == planned.pack.url &&
                                before?.pack?.bytes == planned.pack.bytes)
                    )
                        kept[planned.key] = entry
                    else
                        offered[planned.key] =
                            OfflinePreviousPack(digest, planned.pack.url, before?.release, false)
                }
                OfflineProgressLog.write(kept, layout.progress(id, pending.number))
                OfflineLayout.write(download.response, layout.download(id, pending.number, index))
                candidates[planKey(id, pending.number)] = offered
                forget(id, pending.number)
                plans[planKey(id, pending.number)] = plan
                update(id) {
                    it.copy(
                        packs = plan.packs.size,
                        resources = plan.resourceCount,
                        billable = plan.billable,
                        bytes = plan.bytes,
                    )
                }
                true
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: TileflowOfflineException) {
            lock.withLock {
                update(id) {
                    if (error.isRecoverable)
                        it.copy(
                            state = OfflineVersionRecord.State.WAITING,
                            error = OfflineStoredError.of(error),
                            retryAt = now() + (error.retryAfterMillis ?: MAXIMUM_BACKOFF),
                        )
                    else it.failed(error)
                }
            }
            return error.isRecoverable
        } catch (_: Exception) {
            lock.withLock {
                update(id) {
                    it.failed(TileflowOfflineException(TileflowOfflineErrorCode.INVALID_RESPONSE))
                }
            }
            return false
        }
    }

    /** What the region's stored version, and earlier passes of this one, hold for each pack key. */
    private fun previousPacks(id: String, plan: OfflineVersionPlan): Map<String, OfflinePreviousPack> {
        val result = HashMap<String, OfflinePreviousPack>()
        val active = records[id]?.active
        val stored = active?.takeIf { it.downloads > 0 }?.let { runCatching { plan(id, it) }.getOrNull() }
        if (active != null && stored != null) {
            val log = OfflineProgressLog.read(layout.progress(id, active.number))
            for (planned in stored.packs) {
                val digest = log[planned.key]?.pack ?: continue
                val sameRequest =
                    planned.download < plan.requests.size &&
                        stored.requests[planned.download] == plan.requests[planned.download]
                result[planned.key] =
                    OfflinePreviousPack(digest, planned.pack.url, planned.release, sameRequest)
            }
        }
        records[id]?.pending?.let { result.putAll(candidates[planKey(id, it.number)].orEmpty()) }
        return result
    }

    /**
     * Makes a complete pending version the region's version: staged bodies enter the pinned
     * partition, one record replacement switches versions, then the replaced version's packs and
     * resources no other version uses are released.
     */
    private fun activate(id: String) {
        val record = records[id] ?: return
        val pending = record.pending ?: return
        val plan = runCatching { plan(id, pending) }.getOrNull() ?: return
        val stored = OfflineProgressLog.read(layout.progress(id, pending.number))
        // Every pack the version lists is in the store: a version never activates with a pack gone.
        if (plan.packs.any { stored[it.key]?.pack?.let(layout.packs::size) == null }) return
        val staging = layout.staging(id, pending.number)
        val byDigest = plan.resources.associateBy { it.key.digest }
        for (file in staging.listFiles().orEmpty()) {
            val resource = byDigest[file.name] ?: continue
            val entry =
                runCatching { ResourceCacheEntryFormat.decode(file.readBytes(), resource.url) }
                    .getOrNull() ?: continue
            val written =
                cache.write(resource.key, ResourceCacheRetention.PINNED, entry.metadata, entry.body)
            if (!written)
                return update(id) {
                    it.failed(
                        TileflowOfflineException(
                            TileflowOfflineErrorCode.INSUFFICIENT_STORAGE,
                            TileflowErrorContext(reason = "writeFailed"),
                        )
                    )
                }
        }
        val time = now()
        val done = progress[id] ?: storedProgress(id, pending)
        val active =
            pending.copy(
                state = OfflineVersionRecord.State.COMPLETE,
                error = null,
                retryAt = null,
                completedAt = time,
                bytes = pending.bytes ?: done.bytes,
                loaded = done.loaded,
                loadedBytes = done.loadedBytes,
            )
        val check =
            if (plan.isHosted)
                OfflineCheckRecord(
                    "current",
                    null,
                    time,
                    plan.downloads.minOf { it.manifest.revalidationIntervalMillis },
                )
            else record.check
        runCatching {
                save(
                    record.copy(
                        retired = record.active,
                        active = active,
                        pending = null,
                        check = check,
                    )
                )
            }
            .getOrElse {
                return
            }
        staging.deleteRecursively()
        progress.remove(id)
        candidates.remove(planKey(id, pending.number))
        finishRetirement(id)
        publishServing()
        emitChanged(id)
    }

    private fun finishRetirement(id: String) {
        val record = records[id] ?: return
        val retired = record.retired ?: return
        release(id, listOf(retired))
        runCatching { save(record.copy(retired = null)) }
    }

    private fun finishRemoval(id: String) {
        val record = records.remove(id) ?: return
        release(id, record.versions)
        layout.region(id).deleteRecursively()
        progress.remove(id)
        if (isOpen) publishServing()
        subscribers.emit(TileflowOfflineRegionEvent.Removed(id))
    }

    /** Abandons the pending version and releases what only it used. */
    private fun discardPending(id: String) {
        val record = records[id] ?: return
        val pending = record.pending ?: return
        runner.stop(id)
        release(id, listOf(pending))
        runCatching { save(record.copy(pending = null)) }
        progress.remove(id)
    }

    /**
     * Removes the packs and pinned entries of [versions] that no other version references, then the
     * versions' files.
     */
    private fun release(id: String, versions: List<OfflineVersionRecord>) {
        val numbers = versions.map { it.number }.toSet()
        val keep = HashSet<String>()
        val keepPacks = HashSet<String>()
        for ((other, record) in records) {
            if (record.removing) continue
            for (version in record.versions)
                if (other != id || version.number !in numbers) {
                    keep.addAll(keys(other, version))
                    keepPacks.addAll(digests(other, version))
                }
        }
        for (version in versions) {
            runCatching { plan(id, version) }
                .getOrNull()
                ?.let { plan ->
                    cache.removePinned(
                        plan.resources.map { it.key }.filter { it.relativePath !in keep }
                    )
                }
            layout.packs.remove(digests(id, version) - keepPacks)
            layout.packs.removeIncoming(transferPrefix(id, version.number))
            layout.version(id, version.number).deleteRecursively()
            forget(id, version.number)
            candidates.remove(planKey(id, version.number))
        }
    }

    /** Drops what the store derived from a version's files. */
    private fun forget(id: String, number: Int) {
        val key = planKey(id, number)
        plans.remove(key)
        keySets.remove(key)
        unitSets.remove(key)
        digestSets.remove(key)
        servedSets.remove(key)
        creditSets.remove(key)
    }

    // Plans.

    /**
     * The downloads of [options]: those an estimate created, or new ones. A load consumes what an
     * estimate created, so loading again later sees the Map as it is then.
     */
    private suspend fun hostedPlan(
        options: TileflowOfflineRegionLoadOptions,
        consuming: Boolean = false,
    ): Pair<OfflineVersionPlan, URI> {
        val content =
            options.content as? TileflowOfflineContent.Hosted
                ?: throw TileflowOfflineException.options("invalidContent")
        val client = client()
        val requests =
            OfflinePackRequest.requests(
                content.mapId,
                content.themes,
                options.geometry,
                options.zooms,
            )
        val downloads = ArrayList<OfflineDownload>()
        for (request in requests) {
            val reusable =
                lock.withLock {
                    created[request]
                        ?.takeIf { it.manifest.downloadExpiresAtMillis - now() > REUSE_WINDOW }
                        ?.also { if (consuming) created.remove(request) }
                }
            val download =
                reusable
                    ?: client.create(request).also {
                        if (!consuming) lock.withLock { created[request] = it }
                    }
            downloads.add(download)
        }
        return OfflineVersionPlan.hosted(downloads, requests) to client.apiOrigin
    }

    /** The manifest, then each theme's style and what it references, without duplicates. */
    private suspend fun selfHostedDocuments(url: URI, map: String): List<URI> {
        val manifest = OfflineSelfHosted.manifest(url, document(url), map)
        val documents = manifest.second.toMutableList()
        for (style in manifest.first)
            documents += OfflineSelfHosted.documents(style, document(style))
        val seen = HashSet<String>()
        return documents.filter { seen.add(it.toASCIIString()) }
    }

    private suspend fun document(url: URI): ByteArray {
        val response =
            try {
                fetcher.fetch(
                    OfflineFetchRequest(
                        "plan/" + sha256Hex(url.toASCIIString().toByteArray()),
                        url,
                        emptyMap(),
                    )
                )
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                throw TileflowOfflineException(TileflowOfflineErrorCode.NETWORK)
            }
        if (response.status != 200)
            throw TileflowOfflineException(
                TileflowOfflineErrorCode.NOT_FOUND,
                TileflowErrorContext(status = response.status),
            )
        return response.body
    }

    /** The plan of a stored version, read from its files once. */
    private fun plan(id: String, version: OfflineVersionRecord): OfflineVersionPlan {
        val key = planKey(id, version.number)
        plans[key]?.let {
            return it
        }
        val options =
            offlineOptions(version.options) ?: throw TileflowOfflineException.invalidResponse()
        val plan =
            if (version.downloads > 0) {
                val origin =
                    version.apiOrigin?.let { URI(it) }
                        ?: throw TileflowOfflineException.invalidResponse()
                val requests = ArrayList<OfflinePackRequest>()
                val downloads = ArrayList<OfflineDownload>()
                for (index in 0 until version.downloads) {
                    val request =
                        OfflinePackRequest.fromJson(
                            layout.request(id, version.number, index).readBytes()
                        ) ?: throw TileflowOfflineException.invalidResponse()
                    requests.add(request)
                    downloads.add(
                        OfflinePackContract.download(
                            layout.download(id, version.number, index).readBytes(),
                            request,
                            origin.scheme == "http",
                        )
                    )
                }
                OfflineVersionPlan.hosted(downloads, requests)
            } else {
                val content =
                    options.content as? TileflowOfflineContent.Manifest
                        ?: throw TileflowOfflineException.invalidResponse()
                val documents =
                    JSONObject(layout.plan(id, version.number).readText()).getJSONArray("documents")
                OfflineVersionPlan.selfHosted(
                    List(documents.length()) { URI(documents.getString(it)) },
                    content.sources,
                    options.geometry.packRegions(),
                    options.zooms,
                )
            }
        // Plans of versions downloading stay in memory; others are read again when needed.
        if (records[id]?.pending?.number == version.number) plans[key] = plan
        return plan
    }

    /** The cache paths of a version's resources. */
    private fun keys(id: String, version: OfflineVersionRecord): Set<String> {
        val key = planKey(id, version.number)
        keySets[key]?.let {
            return it
        }
        val plan = runCatching { plan(id, version) }.getOrNull() ?: return emptySet()
        return plan.resources.map { it.key.relativePath }.toSet().also { keySets[key] = it }
    }

    /** The digests of the packs a version stored. */
    private fun digests(id: String, version: OfflineVersionRecord): Set<String> {
        val key = planKey(id, version.number)
        val complete = version.state == OfflineVersionRecord.State.COMPLETE
        if (complete) digestSets[key]?.let { return it }
        val digests =
            OfflineProgressLog.read(layout.progress(id, version.number))
                .values
                .mapNotNull { it.pack }
                .toSet()
        if (complete) digestSets[key] = digests
        return digests
    }

    /**
     * A version's billable units: each pack's billable resources, under a name equal for the same
     * pack of the same request and release, which holds the same bytes in any region.
     */
    private fun units(id: String, version: OfflineVersionRecord): Map<String, Long> {
        val key = planKey(id, version.number)
        unitSets[key]?.let {
            return it
        }
        val plan = runCatching { plan(id, version) }.getOrNull() ?: return emptyMap()
        return units(plan).also { unitSets[key] = it }
    }

    private fun units(plan: OfflineVersionPlan): Map<String, Long> =
        plan.packs.associate { unit(it, plan) to it.pack.billableResources.toLong() }

    private fun unit(planned: OfflinePlannedPack, plan: OfflineVersionPlan): String {
        val manifest = plan.downloads[planned.download].manifest
        val request = sha256Hex(plan.requests[planned.download].body)
        val release = planned.release ?: "d${manifest.deploymentVersion}"
        return "$request\n${planned.pack.url.toASCIIString()}\n$release"
    }

    /** The billable units every stored or downloading version holds. */
    private fun heldUnits(except: String? = null): Map<String, Long> {
        val held = HashMap<String, Long>()
        for ((other, record) in records) {
            if (other == except || record.removing) continue
            for (version in listOfNotNull(record.active, record.pending))
                for ((unit, weight) in units(other, version)) held.putIfAbsent(unit, weight)
        }
        return held
    }

    /** Cache paths of every stored (active) version. */
    private fun activePaths(): Set<String> {
        val paths = HashSet<String>()
        for ((id, record) in records) {
            if (record.removing) continue
            record.active?.let { paths.addAll(keys(id, it)) }
        }
        return paths
    }

    /**
     * The device holds at most the plan's limit of billable resources; a version that does not
     * grow the device's total is always accepted.
     */
    private fun checkDeviceLimit(id: String, plan: OfflineVersionPlan) {
        val limit = plan.downloads.minOfOrNull { it.manifest.maximumPackResources } ?: return
        val others = heldUnits(except = id)
        val mine = records[id]?.active?.let { units(id, it) }.orEmpty()
        val next = units(plan)
        val held = mine + others
        OfflineDeviceLimit.check(
            held.values.sum(),
            next.filterKeys { it !in held }.values.sum(),
            mine.filterKeys { it !in others && it !in next }.values.sum(),
            limit,
        )
    }

    // Records.

    private fun save(record: OfflineRegionRecord) {
        record.write(layout.record(record.id))
        records[record.id] = record
    }

    private fun update(id: String, change: (OfflineVersionRecord) -> OfflineVersionRecord) {
        val record = records[id] ?: return
        val pending = record.pending ?: return
        runCatching { save(record.copy(pending = change(pending))) }
        emitChanged(id)
    }

    private fun emitChanged(id: String) {
        records[id]?.let(::snapshot)?.let {
            subscribers.emit(TileflowOfflineRegionEvent.Changed(it))
        }
    }

    private fun storedProgress(id: String, version: OfflineVersionRecord): OfflineProgress =
        OfflineProgress.of(OfflineProgressLog.read(layout.progress(id, version.number)).values)

    /** The record with [metadata] in the options of every version it keeps. */
    private fun replacingMetadata(
        record: OfflineRegionRecord,
        metadata: Map<String, String>,
    ): OfflineRegionRecord {
        fun replaced(version: OfflineVersionRecord?) =
            version?.copy(
                options =
                    JSONObject(version.options.toString()).put("metadata", JSONObject(metadata))
            )
        return record.copy(active = replaced(record.active), pending = replaced(record.pending))
    }

    /** Replaces the region's metadata in place, without downloading anything. */
    suspend fun updateMetadata(id: String, metadata: Map<String, String>) =
        lock.withLock {
            openLocked()
            save(replacingMetadata(existing(id), metadata))
            emitChanged(id)
        }

    private fun planKey(id: String, number: Int) = "$id\n$number"

    private fun transferPrefix(id: String, number: Int) =
        "${sha256Hex(id.toByteArray()).take(16)}/$number/"

    private fun snapshot(record: OfflineRegionRecord): TileflowOfflineRegion? {
        if (record.removing) return null
        val version = record.pending ?: record.active ?: return null
        val options = offlineOptions(version.options) ?: return null
        val done =
            if (record.pending != null) progress[record.id] ?: OfflineProgress()
            else
                OfflineProgress(
                    version.packs.toLong(),
                    version.resources,
                    version.bytes ?: 0,
                    version.loaded ?: 0,
                    version.loadedBytes ?: 0,
                )
        val state =
            when (version.state) {
                OfflineVersionRecord.State.DOWNLOADING ->
                    TileflowOfflineRegion.DownloadState.DOWNLOADING
                OfflineVersionRecord.State.WAITING -> TileflowOfflineRegion.DownloadState.WAITING
                OfflineVersionRecord.State.PAUSED -> TileflowOfflineRegion.DownloadState.PAUSED
                OfflineVersionRecord.State.FAILED -> TileflowOfflineRegion.DownloadState.FAILED
                OfflineVersionRecord.State.COMPLETE -> TileflowOfflineRegion.DownloadState.COMPLETE
            }
        val update =
            when (record.check?.state) {
                "current" -> TileflowOfflineRegion.UpdateState.Current
                "update_available" -> TileflowOfflineRegion.UpdateState.UpdateAvailable
                "not_updatable" ->
                    TileflowOfflineRegion.UpdateState.NotUpdatable(record.check.reason ?: "")
                else -> null
            }
        return TileflowOfflineRegion(
            record.id,
            options,
            state,
            isServed(record),
            version.packs.toLong(),
            minOf(done.packs, version.packs.toLong()),
            version.resources,
            minOf(done.count, version.resources),
            version.bytes,
            done.bytes,
            done.loaded,
            done.loadedBytes,
            version.billable,
            version.error?.exception,
            version.retryAt,
            record.active?.completedAt,
            update,
            record.check?.checkedAt,
        )
    }

    companion object {
        /**
         * A download an estimate created is reused by the next load while at least this much of
         * its window remains.
         */
        const val REUSE_WINDOW = 600_000L

        /** Grants are renewed before their window ends. */
        const val RENEWAL_MARGIN = 300_000L
        const val MAXIMUM_BACKOFF = 300_000L
        const val MAXIMUM_RENEWALS = 3
    }
}
