package dev.tileflow.sdk.offline

import android.content.Context
import androidx.work.Configuration
import androidx.work.WorkManager
import androidx.work.testing.SynchronousExecutor
import androidx.work.testing.WorkManagerTestInitHelper
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.transport.NativeHTTPTransporting
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheRetention
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceCacheStore
import dev.tileflow.sdk.transport.ResourcePayload
import dev.tileflow.sdk.transport.sha256Hex
import java.io.File
import java.io.IOException
import java.net.URI
import java.nio.file.Files
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * End-to-end store tests against an in-process Hosted service: packs are created, downloaded,
 * verified, stored in a real pinned partition, updated and removed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class OfflineStoreTest {
    private val directory: File = Files.createTempDirectory("offline-store").toFile()
    private val scopes = CopyOnWriteArrayList<CoroutineScope>()
    private val cache =
        ResourceCacheStore(File(directory, "ambient"), File(directory, "durable"), 64L shl 20)

    @After
    fun tearDown() {
        scopes.forEach { it.cancel() }
        directory.deleteRecursively()
    }

    @Test
    fun hostedRegionDownloadsVerifiedResourcesAndWorksOffline() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        val region = store.loadRegion("madrid", madrid())
        assertFalse(region.isAvailable)
        val done = waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        assertTrue(done.isAvailable)
        assertEquals(done.requiredResourceCount, done.completedResourceCount)
        assertEquals(done.requiredResourceBytes, done.completedResourceBytes)
        assertEquals(service.billable, done.billableResourceCount)
        assertEquals(TileflowOfflineRegion.UpdateState.Current, done.updateState)

        // Each resource was downloaded once, with the grant only where the manifest asks for it.
        assertEquals(1, service.creations.get())
        for (entry in service.downloads) {
            assertEquals(entry.url, service.isPublic(entry.url), entry.headers[GRANT] == null)
            assertEquals(emptySet<String>(), entry.headers.keys - GRANT)
        }
        assertEquals(done.requiredResourceCount, service.downloads.size.toLong())

        // Without a network, a new store over the same files has the region and every body.
        service.online = false
        val offline = store(service)
        val reopened = offline.region("madrid")!!
        assertTrue(reopened.isAvailable)
        assertEquals(TileflowOfflineRegion.DownloadState.COMPLETE, reopened.state)
        offline.core.networkDidConnect()
        assertEquals(done.requiredResourceCount, service.downloads.size.toLong())
        for ((url, body) in service.served)
            assertTrue(url, cache.read(service.key(url), ResourceCacheRetention.PINNED)?.body?.contentEquals(body) == true)
    }

    @Test
    fun killedDownloadResumesWithoutDownloadingAgain() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val first = store(service, fetcher = FreezingFetcher(service, 20))
        first.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= 20 }
        // The process ends: nothing more is written, a line of the progress log is cut short and a
        // partial staging file is left behind.
        val version = layout().regions.walkTopDown().first { it.name == "v1" }
        File(version, "progress").appendText("0123abc")
        File(version, "staging-partial").writeText("partial")

        val second = store(service)
        val done = waitFor(second, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        assertEquals(done.requiredResourceCount, done.completedResourceCount)
        val bodies = service.downloads.filter { it.status == 200 }.groupingBy { it.url }.eachCount()
        assertEquals(done.requiredResourceCount, bodies.size.toLong())
        assertEquals("No resource is downloaded twice", 1, bodies.values.max())
        assertEquals(1, service.creations.get())
    }

    @Test
    fun fullDiskStopsTheDownloadUntilResumed() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val space = AtomicReference<Long?>(1024)
        val store = store(service, space = space)
        store.loadRegion("madrid", madrid())
        val full = waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.FAILED }
        assertEquals(TileflowOfflineErrorCode.INSUFFICIENT_STORAGE, full.error?.code)
        assertTrue(service.downloads.isEmpty())

        // The disk fills during the download.
        space.set(null)
        service.onDownload = { if (it == 70) space.set(512) }
        store.resumeRegion("madrid")
        val again = waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.FAILED }
        assertEquals(TileflowOfflineErrorCode.INSUFFICIENT_STORAGE, again.error?.code)
        assertFalse(again.isAvailable)
        assertTrue(again.completedResourceCount >= 64)

        space.set(null)
        service.onDownload = null
        store.resumeRegion("madrid")
        val done = waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        assertEquals(done.requiredResourceCount, done.completedResourceCount)
        assertEquals(service.downloads.size, service.downloads.map { it.url }.toSet().size)
    }

    @Test
    fun fiftyThousandResourcePack() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.tileLimit = 49_998
        service.documentsPublicOnly = true
        service.maximumPackResources = 50_000
        val store = store(service, concurrency = 64)
        val options =
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(10.0, 10.0, 11.5, 11.5)),
                TileflowOfflineContent.Hosted(MAP_ID, listOf("default")),
                minZoom = 16,
                maxZoom = 16,
            )
        val estimate = store.estimateRegion(options)
        assertEquals(50_000L, estimate.resourceCount)
        assertEquals(49_998L, estimate.billableResourceCount)
        assertEquals(50L, estimate.mapViews)
        val started = System.currentTimeMillis()
        store.loadRegion("large", options)
        val done =
            waitFor(store, "large", timeoutMillis = 600_000) {
                it.state == TileflowOfflineRegion.DownloadState.COMPLETE
            }
        assertEquals(50_000L, done.completedResourceCount)
        assertEquals("The estimate's pack is reused", 1, service.creations.get())
        println("50,000 resources stored in ${(System.currentTimeMillis() - started) / 1000} s")

        // The device holds 49,998 billable resources of 50,000: a further region does not fit.
        try {
            store.loadRegion("madrid", madrid())
            fail("The device limit is enforced")
        } catch (error: TileflowOfflineException) {
            assertEquals(TileflowOfflineErrorCode.DEVICE_LIMIT_EXCEEDED, error.code)
            assertEquals(50_000, error.context.limit)
        }
    }

    @Test
    fun updatesDownloadOnlyChangesAndKeepTheStoredVersionUntilComplete() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        store.loadRegion("madrid", madrid())
        waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        val first = service.downloads.size

        // Due only after the service's interval.
        store.core.checkForUpdates()
        assertEquals(0, service.revalidations.get())
        service.clock.addAndGet(86_401_000)
        service.revalidationState = "update_available"
        store.core.networkDidConnect()
        assertEquals(
            TileflowOfflineRegion.UpdateState.UpdateAvailable,
            store.region("madrid")!!.updateState,
        )

        // The deployment changes the style and one tile; the rest answers 304.
        val oldStyle = service.styleUrl
        service.publish()
        service.freezeAfter = first + 5
        store.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= first + 5 }
        val updating = store.region("madrid")!!
        assertTrue("The stored version stays while the update downloads", updating.isAvailable)
        assertNotNull(cache.read(service.key(oldStyle), ResourceCacheRetention.PINNED))

        service.freezeAfter = null
        store.pauseRegion("madrid")
        store.resumeRegion("madrid")
        val done =
            waitFor(store, "madrid") {
                it.state == TileflowOfflineRegion.DownloadState.COMPLETE && it.completedAtMillis != null
            }
        val update = service.downloads.drop(first)
        assertEquals(
            service.changedUrls.toSet(),
            update.filter { it.status == 200 }.map { it.url }.toSet(),
        )
        assertTrue(update.filter { it.status == 304 }.all { it.headers["If-None-Match"] != null })
        assertEquals(TileflowOfflineRegion.UpdateState.Current, done.updateState)
        // The previous deployment's style is released; the changed tile holds its new body.
        assertNull(cache.read(service.key(oldStyle), ResourceCacheRetention.PINNED))
        for (url in service.changedUrls)
            assertTrue(
                cache.read(service.key(url), ResourceCacheRetention.PINNED)!!
                    .body
                    .contentEquals(service.served[url])
            )
    }

    @Test
    fun accessEndingStopsUpdatesWithoutRemovingTheRegion() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        store.loadRegion("madrid", madrid())
        waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        service.clock.addAndGet(86_401_000)
        service.revalidationState = "not_updatable"
        store.core.checkForUpdates()
        val region = store.region("madrid")!!
        assertEquals(
            TileflowOfflineRegion.UpdateState.NotUpdatable("credential_revoked"),
            region.updateState,
        )
        assertFalse("Maps stop using it", region.isAvailable)
        service.clock.addAndGet(10 * 86_400_000L)
        store.core.checkForUpdates()
        assertEquals(1, service.revalidations.get())
        for ((url, body) in service.served)
            assertTrue(cache.read(service.key(url), ResourceCacheRetention.PINNED)!!.body.contentEquals(body))
    }

    @Test
    fun expiredGrantCreatesThePackAgain() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.expireGrantAfter = 30
        val store = store(service)
        store.loadRegion("madrid", madrid())
        val done = waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        assertEquals(2, service.creations.get())
        assertEquals(done.requiredResourceCount, done.completedResourceCount)
        val bodies = service.downloads.filter { it.status == 200 }.map { it.url }
        assertEquals("Stored resources are kept", bodies.size, bodies.toSet().size)

        // A window that ends before the download continues is renewed before downloading.
        val other = OfflineServiceStub()
        val first = store(other, root = "second", fetcher = FreezingFetcher(other, 5))
        first.loadRegion("madrid", madrid())
        waitUntil { other.downloads.size >= 5 }
        other.clock.addAndGet(86_400_000)
        val second = store(other, root = "second")
        waitFor(second, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        assertEquals(2, other.creations.get())
    }

    @Test
    fun recoverableRefusalsWaitAsAsked() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.refuseOnce = Refusal(10, 429, "RATE_LIMITED", "7")
        val sleeps = CopyOnWriteArrayList<Long>()
        val store = store(service, sleeps = sleeps)
        store.loadRegion("madrid", madrid())
        waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        assertTrue(7_000L in sleeps)

        // A refusal that waiting cannot repair stops the download.
        val refused = OfflineServiceStub()
        refused.refuseOnce = Refusal(3, 429, "COMMERCIAL_MAP_LIMIT_REACHED", null)
        val other = store(refused, root = "refused")
        other.loadRegion("madrid", madrid())
        val failed = waitFor(other, "madrid") { it.state == TileflowOfflineRegion.DownloadState.FAILED }
        assertEquals(TileflowOfflineErrorCode.QUOTA_EXCEEDED, failed.error?.code)
    }

    @Test
    fun offlineDownloadWaitsForTheNetwork() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        store.loadRegion("madrid", madrid())
        waitUntil { service.downloads.isNotEmpty() }
        service.online = false
        val waiting = waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.WAITING }
        assertEquals(TileflowOfflineErrorCode.NETWORK, waiting.error?.code)
        service.online = true
        store.core.networkDidConnect()
        waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
    }

    @Test
    fun removingReleasesOnlyResourcesNoOtherRegionUses() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        val events = CopyOnWriteArrayList<TileflowOfflineRegionEvent>()
        val subscription = store.subscribe { events.add(it) }
        store.loadRegion("madrid", madrid())
        waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        val first = service.served.keys.toSet()
        store.loadRegion("nearby", madrid(east = -3.67))
        waitFor(store, "nearby") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        val all = service.served.keys.toSet()
        assertTrue(all.size > first.size)
        assertEquals(listOf("madrid", "nearby"), store.allRegions().map { it.id })

        store.removeRegion("nearby")
        for (url in all)
            assertEquals(
                url,
                url in first,
                cache.read(service.key(url), ResourceCacheRetention.PINNED) != null,
            )
        store.removeRegion("madrid")
        for (url in all) assertNull(url, cache.read(service.key(url), ResourceCacheRetention.PINNED))
        assertTrue(store.allRegions().isEmpty())
        waitUntil { TileflowOfflineRegionEvent.Removed("madrid") in events }
        subscription.cancel()
    }

    @Test
    fun pauseAndCancel() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.freezeAfter = 10
        val store = store(service)
        store.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= 10 }
        store.pauseRegion("madrid")
        assertEquals(TileflowOfflineRegion.DownloadState.PAUSED, store.region("madrid")!!.state)
        delay(100)
        service.freezeAfter = null
        delay(50)
        assertEquals(10, service.downloads.size)

        // Cancelling a region that never completed removes it and what it stored.
        store.cancelRegion("madrid")
        assertTrue(store.allRegions().isEmpty())
        for (url in service.served.keys)
            assertNull(cache.read(service.key(url), ResourceCacheRetention.PINNED))
        try {
            store.resumeRegion("madrid")
            fail("The region is gone")
        } catch (error: TileflowOfflineException) {
            assertEquals(TileflowOfflineErrorCode.REGION_NOT_FOUND, error.code)
        }
    }

    @Test
    fun selfHostedRegionDownloadsItsManifestStylesFontsSpritesGlyphsAndTiles() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        val options =
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.71, 40.41, -3.69, 40.425)),
                TileflowOfflineContent.Manifest(
                    "https://tiles.example.com/manifest.json",
                    "streets",
                    listOf(
                        TileflowOfflineTileSource(
                            "streets",
                            "https://tiles.example.com/streets/{z}/{x}/{y}.pbf",
                            maxZoom = 14,
                        )
                    ),
                ),
                minZoom = 12,
                maxZoom = 15,
            )
        val estimate = store.estimateRegion(options)
        assertNull(estimate.bytes)
        assertEquals(0L, estimate.billableResourceCount)
        store.loadRegion("streets", options)
        val done = waitFor(store, "streets") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        // Sizes are known once downloaded.
        assertEquals(done.completedResourceBytes, done.requiredResourceBytes)
        assertEquals(0L, done.billableResourceCount)
        // Manifest, font file, style, its data, four sprite files, 256 glyph ranges of one stack
        // and the tiles to zoom 14.
        assertEquals(1 + 1 + 1 + 1 + 4 + 256 + estimate.resourceCount, done.requiredResourceCount)
        val urls = service.downloads.map { it.url }.toSet()
        assertTrue("https://tiles.example.com/fonts/face.woff2" in urls)
        assertTrue("https://tiles.example.com/data/places.json" in urls)
        assertTrue("https://tiles.example.com/sprites/base@2x.png" in urls)
        assertTrue("https://tiles.example.com/fonts/Noto%20Sans%20Regular/0-255.pbf" in urls)
        assertTrue(service.downloads.all { it.headers.isEmpty() })
    }

    @Test
    fun mapsUseAvailableRegionsAndStopUsingOnesWhoseAccessEnded() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val index = OfflineServingIndex()
        val store = store(service, index = index)
        val style = service.key(service.styleUrl)
        store.loadRegion("madrid", madrid())
        waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        assertTrue(index.serves(style))
        val credits = index.credits(ResourceCacheScope.grant(URI(ORIGIN), MAP_ID))
        assertEquals(listOf("es-ign"), credits.map { it.id })
        assertEquals(listOf(listOf(-9.4, 35.9, 4.4, 43.8)), credits.single().regions)

        // A region that is still downloading is not used.
        service.publish()
        val frozen = service.downloads.size + 3
        service.freezeAfter = frozen
        store.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= frozen }
        assertFalse(index.serves(service.key(service.styleUrl)))
        store.cancelRegion("madrid")
        service.freezeAfter = null

        // Access ends: maps stop using the region; its files stay on the device.
        service.clock.addAndGet(86_401_000)
        service.revalidationState = "not_updatable"
        store.core.checkForUpdates()
        assertFalse(store.region("madrid")!!.isAvailable)
        assertFalse(index.serves(style))
        assertNotNull(cache.read(style, ResourceCacheRetention.PINNED))
    }

    @Test
    fun backgroundWorkDownloadsTheRegion() = runBlocking<Unit> {
        val context: Context = RuntimeEnvironment.getApplication()
        WorkManagerTestInitHelper.initializeTestWorkManager(
            context,
            Configuration.Builder().setExecutor(SynchronousExecutor()).build(),
        )
        val service = OfflineServiceStub()
        val subscribers = OfflineSubscribers()
        val store =
            TileflowOfflineStore(
                core(service, "work", subscribers, runner = { OfflineWorkRunner(context) }),
                subscribers,
            )
        TileflowOfflineStore.instance = store
        try {
            store.loadRegion("madrid", madrid())
            val work =
                WorkManager.getInstance(context)
                    .getWorkInfosForUniqueWork(OfflineWorkRunner.name("madrid"))
                    .get()
                    .single()
            WorkManagerTestInitHelper.getTestDriver(context)!!.setAllConstraintsMet(work.id)
            waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.COMPLETE }
        } finally {
            TileflowOfflineStore.instance = null
        }
    }

    @Test
    fun verificationAcceptsTheWireOrTheDecodedBody() {
        val body = "tile".toByteArray()
        val digest = sha256Hex(body)
        val resource =
            OfflinePlannedResource(
                ResourceCacheKey(URI("https://a.test/t/1/2/3.pbf"), ResourceCacheScope.Shared),
                4,
                null,
                billable = true,
                isPublic = false,
                pack = 0,
            )
        fun response(body: ByteArray, etag: String?, encoding: String? = null, wire: Long?, sha: String? = null) =
            OfflineFetchResponse(
                200,
                listOfNotNull(etag?.let { "ETag" to it }, encoding?.let { "Content-Encoding" to it })
                    .toMap(),
                body,
                wire,
                sha,
            )
        assertTrue(OfflineDownloader.verify(response(body, "\"$digest\"", wire = 4), resource))
        assertFalse(OfflineDownloader.verify(response(body, "\"${"0".repeat(64)}\"", wire = 4), resource))
        assertFalse(OfflineDownloader.verify(response("til".toByteArray(), null, wire = 3), resource))
        // Decoded by the client: the wire size and hash must match.
        assertTrue(
            OfflineDownloader.verify(
                response("decoded tile".toByteArray(), "\"$digest\"", "gzip", 4, digest),
                resource,
            )
        )
        assertFalse(
            OfflineDownloader.verify(
                response("decoded tile".toByteArray(), "\"$digest\"", "gzip", 4, "1".repeat(64)),
                resource,
            )
        )
        assertEquals(digest, OfflineDownloader.etag("W/\"${digest.uppercase()}\""))
        assertNull(OfflineDownloader.etag("\"short\""))
    }

    // Helpers.

    private fun layout(root: String = "offline") = OfflineLayout(File(directory, root))

    private fun core(
        service: OfflineServiceStub,
        root: String,
        subscribers: OfflineSubscribers,
        space: AtomicReference<Long?>? = null,
        sleeps: MutableList<Long>? = null,
        concurrency: Int = 8,
        fetcher: OfflineResourceFetching? = null,
        runner: ((OfflineStoreCore) -> OfflineRunner)? = null,
        index: OfflineServingIndex? = null,
    ): OfflineStoreCore {
        val cache =
            if (root == "offline") cache
            else ResourceCacheStore(File(directory, "$root-ambient"), File(directory, "$root-durable"), 64L shl 20)
        val configuration =
            TileflowConfiguration(
                apiOrigin = URI(ORIGIN),
                mapCredential = TileflowCredential("tf_public_" + "a".repeat(48)),
            )
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also(scopes::add)
        return OfflineStoreCore(
            layout(root),
            cache,
            fetcher ?: service,
            { OfflinePackClient(configuration, { service }, now = { service.clock.get() }) },
            { space?.get() },
            subscribers,
            index,
            runner ?: { OfflineScopeRunner(it, scope) },
            reserveBytes = 4096,
            concurrency = concurrency,
            now = { service.clock.get() },
            sleep = { sleeps?.add(it); delay(2) },
        )
    }

    private fun store(
        service: OfflineServiceStub,
        root: String = "offline",
        space: AtomicReference<Long?>? = null,
        sleeps: MutableList<Long>? = null,
        concurrency: Int = 8,
        fetcher: OfflineResourceFetching? = null,
        index: OfflineServingIndex? = null,
    ): TileflowOfflineStore {
        val subscribers = OfflineSubscribers()
        return TileflowOfflineStore(
            core(service, root, subscribers, space, sleeps, concurrency, fetcher, index = index),
            subscribers,
        )
    }

    private fun madrid(east: Double = -3.69) =
        TileflowOfflineRegionLoadOptions(
            TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.71, 40.41, east, 40.425)),
            TileflowOfflineContent.Hosted(MAP_ID, listOf("light", "dark")),
            minZoom = 12,
            maxZoom = 17,
        )

    private suspend fun waitFor(
        store: TileflowOfflineStore,
        id: String,
        timeoutMillis: Long = 30_000,
        predicate: (TileflowOfflineRegion) -> Boolean,
    ): TileflowOfflineRegion {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            store.region(id)?.takeIf(predicate)?.let {
                return it
            }
            delay(5)
        }
        throw AssertionError("Timed out: ${store.region(id)}")
    }

    private suspend fun waitUntil(timeoutMillis: Long = 30_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (!condition()) {
            if (System.currentTimeMillis() > deadline) throw AssertionError("Timed out")
            delay(2)
        }
    }

    internal data class Refusal(val at: Int, val status: Int, val code: String, val retryAfter: String?)

    /** A process that ends after [after] requests: later requests never return. */
    private class FreezingFetcher(private val base: OfflineResourceFetching, after: Int) :
        OfflineResourceFetching {
        private val remaining = AtomicInteger(after)

        override suspend fun fetch(request: OfflineFetchRequest): OfflineFetchResponse {
            if (remaining.getAndDecrement() <= 0) {
                delay(Long.MAX_VALUE)
                error("unreachable")
            }
            return base.fetch(request)
        }
    }

    /**
     * A Hosted service in process: it creates packs from the region's cover, serves their
     * resources with the contract's headers and statuses, and records every download.
     */
    private class OfflineServiceStub : NativeHTTPTransporting, OfflineResourceFetching {
        class Download(val url: String, val headers: Map<String, String>, val status: Int)

        val clock = AtomicLong(1_793_188_800_000) // 2026-10-28T12:00:00Z
        val creations = AtomicInteger()
        val revalidations = AtomicInteger()
        val downloads = CopyOnWriteArrayList<Download>()
        val served = java.util.concurrent.ConcurrentHashMap<String, ByteArray>()
        private val publicUrls = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
        private val lock = Any()
        private var deployment = 1
        private var changes = HashMap<String, Int>()
        private val grants = HashMap<String, Pair<Long, Int>>()
        @Volatile var revalidationState = "current"
        @Volatile var online = true
        @Volatile var freezeAfter: Int? = null
        @Volatile var expireGrantAfter: Int? = null
        @Volatile var refuseOnce: Refusal? = null
        @Volatile var tileLimit: Int? = null
        @Volatile var documentsPublicOnly = false
        @Volatile var maximumPackResources = 10_000
        @Volatile var onDownload: ((Int) -> Unit)? = null
        @Volatile var billable = 0L
        @Volatile var changedUrls = emptyList<String>()

        private val changedTile: Pair<Int, Int> = run {
            val cover = OfflineTileCover(OfflinePackRegion.canonical(-3.71, 40.41, -3.69, 40.425)!!, 17)
            val y = cover.rows!!.first
            cover.row(y)[0].first to y
        }

        val styleUrl: String
            get() = "$ORIGIN/maps/$MAP_ID/mobile/webview-v1/v${synchronized(lock) { deployment }}/light.json"

        fun isPublic(url: String) = url in publicUrls

        fun key(url: String) =
            ResourceCacheKey(
                URI(url),
                if (isPublic(url) || !url.startsWith(ORIGIN)) ResourceCacheScope.Shared
                else ResourceCacheScope.grant(URI(ORIGIN), MAP_ID),
            )

        /** A new deployment: a new versioned style URL and new bodies for one tile and the profile. */
        fun publish() =
            synchronized(lock) {
                deployment += 1
                changes["tile"] = deployment
                changes["profile"] = deployment
                changedUrls =
                    listOf(
                        "$ORIGIN/tiles/world/17/${changedTile.first}/${changedTile.second}.pbf?map=$MAP_ID",
                        "$ORIGIN/maps/$MAP_ID/mobile/webview-v1/v$deployment/light.json",
                        "$ORIGIN/maps/$MAP_ID/mobile/webview-v1/v$deployment/dark.json",
                        "$ORIGIN/maps/$MAP_ID/mobile/webview-v1/manifest.json",
                    )
            }

        private fun body(url: String): ByteArray {
            var version = 1
            if ("/tiles/" in url && "/17/${changedTile.first}/${changedTile.second}." in url)
                version = changes["tile"] ?: 1
            if (url.endsWith("/webview-v1/manifest.json")) version = changes["profile"] ?: 1
            if (url == "https://tiles.example.com/manifest.json")
                return """{"version":1,"maps":{"streets":{"defaultTheme":"day","themes":{"day":{"styleUrl":"./style.json","fontFaces":[{"family":"Face","source":"./fonts/face.woff2"}]}}}}}"""
                    .toByteArray()
            if (url == "https://tiles.example.com/style.json")
                return """{"version":8,"sprite":"https://tiles.example.com/sprites/base","glyphs":"https://tiles.example.com/fonts/{fontstack}/{range}.pbf","sources":{"places":{"type":"geojson","data":"./data/places.json"}},"layers":[{"id":"l","type":"symbol","layout":{"text-font":["Noto Sans Regular"],"text-field":"x"}}]}"""
                    .toByteArray()
            return "$url#$version".toByteArray()
        }

        // NativeHTTPTransporting.

        override fun send(request: Request, timeoutMillis: Long): ResourcePayload {
            if (!online) throw IOException("offline")
            if (request.url.encodedPath.endsWith("/revalidate")) {
                revalidations.incrementAndGet()
                val checked = date(clock.get())
                val body =
                    if (revalidationState == "not_updatable")
                        """{"state":"not_updatable","reason":"credential_revoked","checkedAt":"$checked"}"""
                    else
                        """{"state":"$revalidationState","checkedAt":"$checked","intervalSeconds":86400}"""
                return ResourcePayload(body.toByteArray(), 200, emptyMap())
            }
            val buffer = Buffer().also { request.body!!.writeTo(it) }
            val packRequest = OfflinePackRequest.fromJson(buffer.readByteArray())!!
            return synchronized(lock) {
                creations.incrementAndGet()
                revalidationState = "current"
                ResourcePayload(created(packRequest, clock.get()), 201, emptyMap())
            }
        }

        override fun cancelActive() {}

        override fun close() {}

        private fun created(request: OfflinePackRequest, now: Long): ByteArray {
            val mapPath = "$ORIGIN/maps/$MAP_ID/mobile"
            val documents = JSONArray()
            var billableDocuments = 0
            var bytes = 0L
            fun document(kind: String, url: String, billable: Boolean, public: Boolean) {
                val body = body(url)
                if (public) publicUrls.add(url)
                if (billable) billableDocuments += 1
                bytes += body.size
                documents.put(
                    JSONObject()
                        .put("kind", kind)
                        .put("url", url)
                        .put("bytes", body.size)
                        .put("sha256", sha256Hex(body))
                        .put("billable", billable)
                        .put("access", if (public) "public" else "grant")
                )
            }
            document("discovery", "$mapPath/manifest.json", billable = false, public = true)
            document("profile", "$mapPath/webview-v1/manifest.json", billable = false, public = true)
            if (!documentsPublicOnly) {
                for (theme in request.themes)
                    document("style", "$mapPath/webview-v1/v$deployment/$theme.json", billable = true, public = false)
                document("glyph", "$ORIGIN/fonts/Noto%20Sans%20Regular/0-255.pbf", billable = true, public = false)
                document("landmark", "$ORIGIN/landmarks/2026-10/notice.txt", billable = false, public = true)
            }
            val template = "$ORIGIN/tiles/world/{z}/{x}/{y}.pbf?map=$MAP_ID"
            val entries = JSONArray()
            var count = 0
            zooms@ for (zoom in request.minZoom..request.maxZoom) {
                val cover = OfflineTileCover(request.region, zoom)
                val rows = cover.rows ?: continue
                for (y in rows) for (xs in cover.row(y)) for (x in xs) {
                    if (tileLimit?.let { count >= it } == true) break@zooms
                    val url = template.replace("{z}", "$zoom").replace("{x}", "$x").replace("{y}", "$y")
                    val size = body(url).size
                    bytes += size
                    count += 1
                    entries.put(JSONArray().put(zoom).put(x).put(y).put(size))
                }
            }
            billable = (billableDocuments + count).toLong()
            grants.clear()
            val grant = "tf_offline_v1.g${creations.get()}.sig"
            grants[grant] = (now + 86_400_000) to 0
            val manifest =
                JSONObject()
                    .put("version", 1)
                    .put("packId", "opk_" + "%022d".format(creations.get()))
                    .put("mapId", request.mapId)
                    .put("profile", request.profile)
                    .put("deploymentVersion", deployment)
                    .put("themes", JSONArray(request.themes))
                    .put("region", request.region.toJson())
                    .put("minZoom", request.minZoom)
                    .put("maxZoom", request.maxZoom)
                    .put("terrainMaxZoom", request.terrainMaxZoom)
                    .put("createdAt", date(now))
                    .put("documents", documents)
                    .put(
                        "tiles",
                        JSONArray()
                            .put(
                                JSONObject()
                                    .put("source", "world")
                                    .put("template", template)
                                    .put("zooms", JSONArray().put(request.minZoom).put(request.maxZoom))
                                    .put("entries", entries)
                            ),
                    )
                    .put("excluded", JSONArray())
                    .put(
                        "totals",
                        JSONObject()
                            .put("resources", documents.length() + count)
                            .put("billableResources", billable)
                            .put("bytes", bytes),
                    )
                    .put(
                        "attribution",
                        JSONObject()
                            .put(
                                "sources",
                                JSONArray()
                                    .put(
                                        JSONObject()
                                            .put("source", "world")
                                            .put("text", "OpenStreetMap")
                                            .put(
                                                "regionalObligations",
                                                JSONArray()
                                                    .put(
                                                        JSONObject()
                                                            .put("id", "es-ign")
                                                            .put("exact", "IGN España")
                                                            .put("href", "https://www.ign.es")
                                                            .put(
                                                                "regions",
                                                                JSONArray()
                                                                    .put(
                                                                        JSONArray("[-9.4,35.9,4.4,43.8]")
                                                                    ),
                                                            )
                                                    ),
                                            )
                                    ),
                            ),
                    )
                    .put(
                        "limits",
                        JSONObject()
                            .put("maxPackResources", maximumPackResources)
                            .put("dailyDownloads", 200_000),
                    )
                    .put(
                        "revalidation",
                        JSONObject()
                            .put("url", "$ORIGIN/v1/offline/packs/revalidate")
                            .put("intervalSeconds", 86_400),
                    )
                    .put("download", JSONObject().put("expiresAt", date(now + 86_400_000)))
            return JSONObject()
                .put("version", 1)
                .put("kind", "offline_pack")
                .put("grant", grant)
                .put("manifest", manifest)
                .toString()
                .toByteArray()
        }

        // OfflineResourceFetching.

        override suspend fun fetch(request: OfflineFetchRequest): OfflineFetchResponse {
            val url = request.url.toASCIIString()
            val context = currentCoroutineContext()
            var freeze = false
            val response =
                synchronized(lock) {
                    // A request cancelled before a test changes the stub never reaches it.
                    if (!context.isActive) return@synchronized null
                    if (!online) return@synchronized null
                    if (freezeAfter?.let { downloads.size >= it } == true) {
                        freeze = true
                        return@synchronized null
                    }
                    respond(url, request.headers)
                }
            currentCoroutineContext().ensureActive()
            if (freeze) {
                delay(Long.MAX_VALUE)
                error("unreachable")
            }
            return response ?: throw IOException("offline")
        }

        private fun respond(url: String, headers: Map<String, String>): OfflineFetchResponse {
            val count = downloads.size + 1
            fun record(response: OfflineFetchResponse): OfflineFetchResponse {
                downloads.add(Download(url, headers, response.status))
                if (response.status == 200) served[url] = response.body
                onDownload?.invoke(count)
                return response
            }
            refuseOnce
                ?.takeIf { it.at == count }
                ?.let { refusal ->
                    refuseOnce = null
                    return record(
                        OfflineFetchResponse(
                            refusal.status,
                            listOfNotNull(
                                    "Cache-Control" to "no-store",
                                    refusal.retryAfter?.let { "Retry-After" to it },
                                )
                                .toMap(),
                            """{"code":"${refusal.code}","error":"refused"}""".toByteArray(),
                            null,
                            null,
                        )
                    )
                }
            if (url.startsWith(ORIGIN) && url !in publicUrls) {
                val grant = headers[GRANT] ?: ""
                val entry = grants[grant]
                var expired = entry == null || clock.get() >= entry.first
                val limit = expireGrantAfter
                if (entry != null && limit != null && entry.second >= limit) {
                    expireGrantAfter = null
                    grants.remove(grant)
                    expired = true
                }
                if (expired)
                    return record(
                        OfflineFetchResponse(
                            401,
                            mapOf("Cache-Control" to "no-store"),
                            """{"code":"OFFLINE_PACK_GRANT_EXPIRED","error":"expired"}""".toByteArray(),
                            null,
                            null,
                        )
                    )
                grants[grant] = entry!!.first to entry.second + 1
            }
            val body = body(url)
            val etag = "\"${sha256Hex(body)}\""
            if (headers["If-None-Match"] == etag)
                return record(OfflineFetchResponse(304, mapOf("ETag" to etag), ByteArray(0), 0, null))
            if (url.startsWith("https://tiles.example.com/streets/") && "/14/" in url)
                return record(OfflineFetchResponse(404, emptyMap(), ByteArray(0), 0, null))
            return record(
                OfflineFetchResponse(
                    200,
                    mapOf(
                        "ETag" to etag,
                        "Cache-Control" to "private, no-cache",
                        "Content-Type" to "application/octet-stream",
                    ),
                    body,
                    body.size.toLong(),
                    sha256Hex(body),
                )
            )
        }
    }

    private companion object {
        const val MAP_ID = "map_offlineofflineof"
        const val ORIGIN = "https://api.tileflow.test"
        const val GRANT = "X-Tileflow-Offline-Grant"

        fun date(millis: Long): String =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                .apply { timeZone = TimeZone.getTimeZone("UTC") }
                .format(millis)
    }
}
