package dev.tileflow.sdk.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.storage.StorageManager
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import dev.tileflow.configuration.Tileflow
import dev.tileflow.sdk.TileflowMapCache
import dev.tileflow.sdk.transport.ResourceCacheStore
import dev.tileflow.sdk.transport.sha256Hex
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking

/**
 * Downloads regions for use without a network and keeps them on the device, after Mapbox's tile
 * store: estimate, load, list, observe, pause, resume, cancel and remove regions by identifier.
 *
 * Hosted content downloads as Hosted offline packs with the configured map credential: the service
 * signs each pack's manifest, bills one map view per started 1,000 billable resources, and limits
 * each pack and each device to the plan's resources. Self-hosted content downloads a style and its
 * tiles as the style requests them, unbilled.
 *
 * Resources are stored once per URL and shared by every region that lists them, in a partition the
 * system does not reclaim and [TileflowMapCache.clear] does not touch; removing a region releases
 * only what no other region uses. Every body is checked against the pack's manifest before it is
 * stored, and a region is available only when all of it is stored. Updates keep the stored version
 * until the new one is complete.
 *
 * Downloads run as WorkManager work on an allowed network and continue after the process ends.
 * Recoverable failures wait and continue by themselves, and stored Hosted regions are checked for
 * updates when the network returns and at most once per the service's interval. Loading a region
 * again downloads only what changed. Access ending stops updates; it never deletes or locks what
 * the device holds.
 */
public class TileflowOfflineStore
internal constructor(
    internal val core: OfflineStoreCore,
    private val subscribers: OfflineSubscribers,
) {
    /**
     * What downloading the region would hold and cost. Hosted content creates its packs, which is
     * free, and loading the same region soon after reuses them.
     */
    public suspend fun estimateRegion(
        options: TileflowOfflineRegionLoadOptions
    ): TileflowOfflineRegionEstimate = core.estimate(options)

    /**
     * Starts downloading a region and returns as soon as it is recorded.
     *
     * A new identifier creates the region. An identifier whose download is unfinished resumes it
     * when [options] are unchanged apart from their metadata, which changes in place. Otherwise a
     * new version downloads, sending each stored resource's `ETag` so unchanged resources are
     * neither downloaded nor billed again, and replaces the stored version when complete.
     *
     * @throws TileflowOfflineException before anything downloads: invalid options, the service's
     *   refusal to create a pack, or `DEVICE_LIMIT_EXCEEDED` when the device would hold more
     *   billable resources than the plan allows.
     */
    public suspend fun loadRegion(
        id: String,
        options: TileflowOfflineRegionLoadOptions,
    ): TileflowOfflineRegion = core.load(id, options)

    /**
     * Replaces the region's metadata in place. Nothing downloads, and a download in progress
     * continues; loading the region with options that differ only in metadata does the same.
     */
    public suspend fun updateRegionMetadata(id: String, metadata: Map<String, String>): Unit =
        core.updateMetadata(id, metadata)

    /** Every region, oldest first. */
    public suspend fun allRegions(): List<TileflowOfflineRegion> = core.regions()

    public suspend fun region(id: String): TileflowOfflineRegion? = core.region(id)

    /** Pauses the region's download until [resumeRegion]. A stored version stays available. */
    public suspend fun pauseRegion(id: String): Unit = core.pause(id)

    /** Continues a paused, waiting or failed download. */
    public suspend fun resumeRegion(id: String): Unit = core.resume(id)

    /**
     * Stops the region's download and discards what it downloaded. A region that never completed
     * is removed; a region with a stored version keeps it.
     */
    public suspend fun cancelRegion(id: String): Unit = core.cancel(id)

    /** Removes the region and every stored resource no other region uses. */
    public suspend fun removeRegion(id: String): Unit = core.remove(id)

    /**
     * Calls [handler] on a background thread, in order, for every region change until the
     * subscription is cancelled.
     */
    public fun subscribe(
        handler: (TileflowOfflineRegionEvent) -> Unit
    ): TileflowOfflineSubscription = subscribers.add(handler)

    /** The network was switched on again: waiting downloads continue and regions are checked. */
    internal fun reconnected() {
        scope.launch { core.networkDidConnect() }
    }

    public companion object {
        @Volatile internal var instance: TileflowOfflineStore? = null
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        /**
         * The process's store, using [Tileflow.configuration] for Hosted content. Unfinished
         * downloads continue and stored regions are revalidated when the network returns.
         */
        @JvmStatic
        public fun get(context: Context): TileflowOfflineStore =
            instance
                ?: synchronized(this) {
                    instance
                        ?: run {
                            val application = context.applicationContext ?: context
                            val root = File(application.noBackupFilesDir, "dev.tileflow/offline-v1")
                            val subscribers = OfflineSubscribers()
                            val core =
                                OfflineStoreCore(
                                    OfflineLayout(root),
                                    TileflowMapCache.get(application).store,
                                    OfflineHttpFetcher(),
                                    {
                                        val configuration =
                                            runCatching { Tileflow.configuration(application) }
                                                .getOrNull()
                                                ?: throw TileflowOfflineException(
                                                    TileflowOfflineErrorCode.INVALID_CONFIGURATION
                                                )
                                        OfflinePackClient(configuration)
                                    },
                                    { OfflineStorage.availableBytes(application) },
                                    subscribers,
                                    OfflineServingIndex.shared,
                                    { OfflineWorkRunner(application) },
                                )
                            TileflowOfflineStore(core, subscribers).also { store ->
                                instance = store
                                OfflineServingIndex.shared.open = {
                                    runBlocking { core.open() }
                                }
                                scope.launch { core.open() }
                                watchNetwork(application, core)
                            }
                        }
                }

        private fun watchNetwork(context: Context, core: OfflineStoreCore) {
            val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
            runCatching {
                manager.registerDefaultNetworkCallback(
                    object : ConnectivityManager.NetworkCallback() {
                        override fun onAvailable(network: Network) {
                            scope.launch { core.networkDidConnect() }
                        }
                    }
                )
            }
        }
    }
}

internal object OfflineStorage {
    /**
     * Whether [bytes] fit. The system's figure already counts space it can free; when it falls
     * short, the map cache, which maps rebuild as they need, is cleared to make room before a
     * download stops for lack of space.
     */
    fun hasRoom(bytes: Long, available: () -> Long?, cache: ResourceCacheStore): Boolean {
        val free = available() ?: return true
        if (free >= bytes) return true
        if (cache.usage().bytes <= 0) return false
        cache.clear()
        cache.settle()
        return (available() ?: Long.MAX_VALUE) >= bytes
    }

    /**
     * Bytes the app can allocate next to its stored regions, counting cached data the system may
     * clear to make room, as `StorageManager` reports it; the free space when it cannot.
     */
    fun availableBytes(context: Context): Long {
        val directory = context.noBackupFilesDir
        return runCatching {
                val storage = context.getSystemService(StorageManager::class.java)!!
                storage.getAllocatableBytes(storage.getUuidForPath(directory))
            }
            .getOrElse { directory.usableSpace }
    }
}

/** Runs downloads in the process, for tests and for stores without background work. */
internal class OfflineScopeRunner(
    private val core: OfflineStoreCore,
    private val scope: CoroutineScope,
) : OfflineRunner {
    private val jobs = ConcurrentHashMap<String, Job>()

    override fun start(id: String, restriction: TileflowOfflineNetworkRestriction) {
        jobs.compute(id) { _, running ->
            running?.takeIf { it.isActive }
                ?: scope.launch { core.drive(id) }.also { job ->
                    job.invokeOnCompletion { jobs.remove(id, job) }
                }
        }
    }

    override fun stop(id: String) {
        jobs.remove(id)?.cancel()
    }
}

/**
 * Runs each region's download as unique WorkManager work, on any network or, for
 * [TileflowOfflineNetworkRestriction.DISALLOW_EXPENSIVE], only on unmetered ones. WorkManager
 * starts it again after the process ends or the network returns.
 */
internal class OfflineWorkRunner(private val context: Context) : OfflineRunner {
    override fun start(id: String, restriction: TileflowOfflineNetworkRestriction) =
        enqueue(id, restriction, 0, ExistingWorkPolicy.KEEP)

    fun enqueue(
        id: String,
        restriction: TileflowOfflineNetworkRestriction,
        delayMillis: Long,
        policy: ExistingWorkPolicy,
    ) {
        val network =
            if (restriction == TileflowOfflineNetworkRestriction.DISALLOW_EXPENSIVE)
                NetworkType.UNMETERED
            else NetworkType.CONNECTED
        val request =
            OneTimeWorkRequestBuilder<OfflineDownloadWorker>()
                .setInputData(
                    workDataOf(
                        OfflineDownloadWorker.REGION to id,
                        OfflineDownloadWorker.RESTRICTION to restriction.name,
                    )
                )
                .setConstraints(Constraints.Builder().setRequiredNetworkType(network).build())
                .setInitialDelay(delayMillis, TimeUnit.MILLISECONDS)
                .addTag(OfflineDownloadWorker.TAG)
                .build()
        WorkManager.getInstance(context).enqueueUniqueWork(name(id), policy, request)
    }

    override fun stop(id: String) {
        WorkManager.getInstance(context).cancelUniqueWork(name(id))
    }

    companion object {
        fun name(id: String) = "dev.tileflow.offline." + sha256Hex(id.toByteArray()).take(32)
    }
}

/**
 * Downloads one region until it completes, fails or pauses. A wait longer than a minute, such as
 * for a daily limit, ends the work and schedules it again for when the wait ends.
 */
internal class OfflineDownloadWorker(context: Context, parameters: WorkerParameters) :
    CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result {
        val id = inputData.getString(REGION) ?: return Result.failure()
        val restriction =
            runCatching {
                    TileflowOfflineNetworkRestriction.valueOf(inputData.getString(RESTRICTION)!!)
                }
                .getOrDefault(TileflowOfflineNetworkRestriction.NONE)
        val core = TileflowOfflineStore.get(applicationContext).core
        try {
            val result = core.drive(id, MAXIMUM_INLINE_WAIT)
            if (result is OfflineDriveResult.Deferred)
                OfflineWorkRunner(applicationContext)
                    .enqueue(
                        id,
                        restriction,
                        (result.atMillis - System.currentTimeMillis()).coerceAtLeast(0),
                        ExistingWorkPolicy.APPEND_OR_REPLACE,
                    )
            return Result.success()
        } catch (error: CancellationException) {
            core.interrupted(id)
            throw error
        }
    }

    companion object {
        const val REGION = "region"
        const val RESTRICTION = "restriction"
        const val TAG = "dev.tileflow.offline"
        const val MAXIMUM_INLINE_WAIT = 60_000L
    }
}
