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
 * every resource is stored and verified, by one atomic record replacement; resources are shared
 * across regions by cache key, and a key is released only when no region version references it.
 * Each multi-step change is recorded before it starts (`pending`, `retired`, `removing`) and
 * finished when the store opens again, so a crash never leaves an unreferenced or missing resource
 * behind.
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
    private val now: () -> Long = System::currentTimeMillis,
    private val sleep: suspend (Long) -> Unit = { delay(it) },
) {
    private val runner = runner(this)
    private val lock = Mutex()
    private val records = HashMap<String, OfflineRegionRecord>()
    private var isOpen = false
    private val progress = HashMap<String, Pair<Long, Long>>()
    private val plans = HashMap<String, OfflineVersionPlan>()
    private val keySets = HashMap<String, Pair<Set<String>, Set<String>>>()
    private val creditSets = HashMap<String, Map<String, List<OfflineCredit>>>()
    private val created = HashMap<OfflinePackRequest, OfflinePack>()

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

    /** Tells maps which stored resources and regional credits they may use without a network. */
    private fun publishServing() {
        val index = index ?: return
        val paths = HashSet<String>()
        val credits = HashMap<String, MutableList<OfflineCredit>>()
        for ((id, record) in records) {
            if (!isServed(record)) continue
            val active = record.active ?: continue
            paths.addAll(keys(id, active).first)
            val origin = active.apiOrigin?.let { URI(it) } ?: continue
            if (active.packs == 0) continue
            for ((scope, list) in credits(id, active, origin)) {
                val merged = credits.getOrPut(scope) { mutableListOf() }
                for (credit in list) if (merged.none { it.id == credit.id }) merged.add(credit)
            }
        }
        index.publish(OfflineServingSnapshot(paths, credits), this)
    }

    /** The regional credits of a Hosted version's packs, by the cache scope of their Map. */
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
        for (pack in plan.packs) {
            val scope = ResourceCacheScope.grant(apiOrigin, pack.manifest.mapId).directory
            result[scope] =
                result[scope].orEmpty() + OfflineCredit.credits(pack.manifest.attribution)
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
                val perPack = LongArray(plan.packs.size)
                for (resource in plan.resources)
                    if (resource.billable && !isStored(resource.key)) perPack[resource.pack ?: 0]++
                val perView = OfflinePlanner.RESOURCES_PER_MAP_VIEW
                TileflowOfflineRegionEstimate(
                    plan.resources.size.toLong(),
                    plan.billable,
                    plan.resources.count { it.isPublic }.toLong(),
                    plan.bytes,
                    plan.tileCounts,
                    perPack.sumOf { (it + perView - 1) / perView },
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
            if (record != null && pending != null && offlineOptions(pending.options) == options) {
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
                return snapshot(records.getValue(id))!!
            }
        }

        // A new version: the plan first, so a refusal changes nothing.
        val number = lock.withLock { records[id]?.nextVersion ?: 1 }
        val plan: OfflineVersionPlan
        var apiOrigin: URI? = null
        when (val content = options.content) {
            is TileflowOfflineContent.Hosted -> {
                val hosted = hostedPlan(options)
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
            for ((index, pack) in plan.packs.withIndex()) {
                OfflineLayout.write(plan.requests[index].body, layout.request(id, number, index))
                OfflineLayout.write(pack.response, layout.pack(id, number, index))
            }
            val pending =
                OfflineVersionRecord(
                    number,
                    json,
                    apiOrigin?.toString(),
                    plan.packs.size,
                    plan.resources.size.toLong(),
                    plan.billable,
                    plan.bytes,
                    OfflineVersionRecord.State.DOWNLOADING,
                    createdAt = time,
                )
            save(record.copy(pending = pending))
            plans[planKey(id, number)] = plan
            progress[id] = 0L to 0L
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
            for (pack in plan.packs) {
                states.add(
                    try {
                        client.revalidate(pack.grant)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (_: Exception) {
                        break
                    }
                )
            }
            if (states.size != plan.packs.size) continue
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
            lock.withLock {
                progress[id] =
                    (plan.resources.size - remaining.size).toLong() to stored.values.sum()
            }
            if (remaining.isEmpty()) {
                lock.withLock { activate(id) }
                return OfflineDriveResult.Settled
            }
            val needed = remaining.sumOf { it.bytes ?: 0 }
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
                plan.packs.indices.firstOrNull { index ->
                    plan.packs[index].manifest.downloadExpiresAtMillis - time < RENEWAL_MARGIN &&
                        remaining.any { it.pack == index }
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
                OfflineDownloadJob(
                    transferPrefix(id, pending.number),
                    plan,
                    remaining,
                    lock.withLock { activePaths() },
                    layout.staging(id, pending.number),
                )
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
                    if (!renew(id, pending, outcome.pack, renewals))
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

    private suspend fun didStore(id: String, entries: List<Pair<String, Long>>) =
        lock.withLock {
            val (count, bytes) = progress[id] ?: (0L to 0L)
            progress[id] = (count + entries.size) to (bytes + entries.sumOf { it.second })
            emitChanged(id)
        }

    /**
     * Creates a pack of the pending version again, keeping every stored resource the new manifest
     * lists unchanged. Returns false when the download stopped.
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
            val pack = client.create(previousPlan.requests[index])
            return lock.withLock {
                if (records[id]?.pending?.number != pending.number) return@withLock false
                val previous = previousPlan.resources.associate {
                    it.key.digest to (it.bytes to it.sha256)
                }
                val packs = previousPlan.packs.toMutableList().also { it[index] = pack }
                val plan = OfflineVersionPlan.hosted(packs, previousPlan.requests, client.apiOrigin)
                checkDeviceLimit(id, plan)
                val stored = OfflineProgressLog.read(layout.progress(id, pending.number))
                val kept = HashMap<String, Long>()
                for (resource in plan.resources) {
                    val bytes = stored[resource.key.digest] ?: continue
                    if (previous[resource.key.digest] == (resource.bytes to resource.sha256))
                        kept[resource.key.digest] = bytes
                }
                OfflineProgressLog.write(kept, layout.progress(id, pending.number))
                OfflineLayout.write(pack.response, layout.pack(id, pending.number, index))
                plans[planKey(id, pending.number)] = plan
                keySets.remove(planKey(id, pending.number))
                update(id) {
                    it.copy(
                        resources = plan.resources.size.toLong(),
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

    /**
     * Makes a complete pending version the region's version: staged bodies enter the pinned
     * partition, one record replacement switches versions, then the replaced version's resources
     * no other version uses are released.
     */
    private fun activate(id: String) {
        val record = records[id] ?: return
        val pending = record.pending ?: return
        val plan = runCatching { plan(id, pending) }.getOrNull() ?: return
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
        val active =
            pending.copy(
                state = OfflineVersionRecord.State.COMPLETE,
                error = null,
                retryAt = null,
                completedAt = time,
                bytes = pending.bytes ?: progress[id]?.second,
            )
        val check =
            if (plan.isHosted)
                OfflineCheckRecord(
                    "current",
                    null,
                    time,
                    plan.packs.minOf { it.manifest.revalidationIntervalMillis },
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
     * Removes pinned entries of [versions] that no other version references, then the versions'
     * files.
     */
    private fun release(id: String, versions: List<OfflineVersionRecord>) {
        val numbers = versions.map { it.number }.toSet()
        val keep = HashSet<String>()
        for ((other, record) in records) {
            if (record.removing) continue
            for (version in record.versions)
                if (other != id || version.number !in numbers)
                    keep.addAll(keys(other, version).first)
        }
        for (version in versions) {
            runCatching { plan(id, version) }
                .getOrNull()
                ?.let { plan ->
                    cache.removePinned(
                        plan.resources.map { it.key }.filter { it.relativePath !in keep }
                    )
                }
            layout.version(id, version.number).deleteRecursively()
            plans.remove(planKey(id, version.number))
            keySets.remove(planKey(id, version.number))
            creditSets.remove(planKey(id, version.number))
        }
    }

    // Plans.

    private suspend fun hostedPlan(
        options: TileflowOfflineRegionLoadOptions
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
        val packs = ArrayList<OfflinePack>()
        for (request in requests) {
            val reusable =
                lock.withLock {
                    created[request]?.takeIf {
                        it.manifest.downloadExpiresAtMillis - now() > REUSE_WINDOW
                    }
                }
            val pack =
                reusable ?: client.create(request).also { lock.withLock { created[request] = it } }
            packs.add(pack)
        }
        return OfflineVersionPlan.hosted(packs, requests, client.apiOrigin) to client.apiOrigin
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
            if (version.packs > 0) {
                val origin =
                    version.apiOrigin?.let { URI(it) }
                        ?: throw TileflowOfflineException.invalidResponse()
                val requests = ArrayList<OfflinePackRequest>()
                val packs = ArrayList<OfflinePack>()
                for (index in 0 until version.packs) {
                    val request =
                        OfflinePackRequest.fromJson(
                            layout.request(id, version.number, index).readBytes()
                        ) ?: throw TileflowOfflineException.invalidResponse()
                    requests.add(request)
                    packs.add(
                        OfflinePackContract.pack(
                            layout.pack(id, version.number, index).readBytes(),
                            request,
                            origin.scheme == "http",
                        )
                    )
                }
                OfflineVersionPlan.hosted(packs, requests, origin)
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

    private fun keys(id: String, version: OfflineVersionRecord): Pair<Set<String>, Set<String>> {
        val key = planKey(id, version.number)
        keySets[key]?.let {
            return it
        }
        val plan =
            runCatching { plan(id, version) }.getOrNull()
                ?: return emptySet<String>() to emptySet()
        val all = HashSet<String>()
        val billable = HashSet<String>()
        for (resource in plan.resources) {
            all.add(resource.key.relativePath)
            if (resource.billable) billable.add(resource.key.relativePath)
        }
        return (all to billable).also { keySets[key] = it }
    }

    /** Cache paths of every stored (active) version. */
    private fun activePaths(): Set<String> {
        val paths = HashSet<String>()
        for ((id, record) in records) {
            if (record.removing) continue
            record.active?.let { paths.addAll(keys(id, it).first) }
        }
        return paths
    }

    /**
     * The device holds at most the plan's limit of billable resources; a version that does not
     * grow the device's total is always accepted.
     */
    private fun checkDeviceLimit(id: String, plan: OfflineVersionPlan) {
        val limit = plan.packs.minOfOrNull { it.manifest.maximumPackResources } ?: return
        val others = HashSet<String>()
        for ((other, record) in records) {
            if (other == id || record.removing) continue
            for (version in listOfNotNull(record.active, record.pending))
                others.addAll(keys(other, version).second)
        }
        val mine = records[id]?.active?.let { keys(id, it).second } ?: emptySet()
        val next = plan.resources.filter { it.billable }.map { it.key.relativePath }.toSet()
        val held = others + mine
        OfflineDeviceLimit.check(
            held.size.toLong(),
            (next - held).size.toLong(),
            (mine - (others + next)).size.toLong(),
            limit,
        )
    }

    private fun isStored(key: ResourceCacheKey): Boolean =
        cache.file(key, ResourceCacheRetention.PINNED).exists()

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

    private fun storedProgress(id: String, version: OfflineVersionRecord): Pair<Long, Long> {
        val stored = OfflineProgressLog.read(layout.progress(id, version.number))
        return stored.size.toLong() to stored.values.sum()
    }

    private fun planKey(id: String, number: Int) = "$id\n$number"

    private fun transferPrefix(id: String, number: Int) =
        "${sha256Hex(id.toByteArray()).take(16)}/$number/"

    private fun snapshot(record: OfflineRegionRecord): TileflowOfflineRegion? {
        if (record.removing) return null
        val version = record.pending ?: record.active ?: return null
        val options = offlineOptions(version.options) ?: return null
        val done =
            if (record.pending != null) progress[record.id] ?: (0L to 0L)
            else version.resources to (version.bytes ?: 0)
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
            version.resources,
            minOf(done.first, version.resources),
            version.bytes,
            done.second,
            version.billable,
            version.error?.exception,
            version.retryAt,
            record.active?.completedAt,
            update,
            record.check?.checkedAt,
        )
    }

    companion object {
        /** A created pack is reused while at least this much of its download window remains. */
        const val REUSE_WINDOW = 600_000L

        /** Grants are renewed before their window ends. */
        const val RENEWAL_MARGIN = 300_000L
        const val MAXIMUM_BACKOFF = 300_000L
        const val MAXIMUM_RENEWALS = 3
    }
}
