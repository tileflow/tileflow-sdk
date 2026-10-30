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
import dev.tileflow.sdk.transport.ResourceCacheMetadata
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
 * End-to-end store tests against an in-process Hosted service: downloads are created, their packs
 * downloaded, verified, stored, served in place, updated and removed.
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
    fun hostedRegionDownloadsVerifiedPacksAndWorksOffline() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        val region = store.loadRegion("madrid", madrid())
        assertFalse(region.isAvailable)
        val done = waitFor(store, "madrid") { it.state == COMPLETE }
        assertTrue(done.isAvailable)
        assertTrue(done.requiredPackCount > 2)
        assertEquals(done.requiredPackCount, done.completedPackCount)
        assertEquals(done.requiredResourceCount, done.completedResourceCount)
        assertEquals(done.requiredResourceBytes, done.completedResourceBytes)
        assertEquals(service.billable, done.billableResourceCount)
        assertEquals(TileflowOfflineRegion.UpdateState.Current, done.updateState)
        assertEquals(done.requiredResourceCount, done.loadedResourceCount)
        assertEquals(done.requiredResourceBytes, done.loadedResourceBytes)

        // Each pack and public file was downloaded once, with the grant only on packs.
        assertEquals(1, service.creations.get())
        for (entry in service.downloads) {
            assertEquals(entry.url, entry.url.endsWith(".tfpack"), entry.headers[GRANT] != null)
            assertEquals(emptySet<String>(), entry.headers.keys - GRANT)
        }
        val packs = service.downloads.filter { it.url.endsWith(".tfpack") }
        assertEquals(done.requiredPackCount, packs.size.toLong())
        assertEquals("Discovery, profile and a landmark", 3, service.downloads.size - packs.size)
        assertEquals(done.requiredPackCount, storedPacks().size.toLong())

        // Without a network, a new store over the same files has the region and every body.
        service.online = false
        val index = OfflineServingIndex()
        val offline = store(service, index = index)
        val reopened = offline.region("madrid")!!
        assertTrue(reopened.isAvailable)
        assertEquals(COMPLETE, reopened.state)
        offline.core.networkDidConnect()
        assertEquals(packs.size + 3, service.downloads.size)
        assertTrue(service.served.size > done.requiredPackCount)
        for ((url, body) in service.served) {
            val resource = index.resource(service.key(url), cache)
            assertEquals(url, 200, resource?.metadata?.status)
            assertTrue(url, resource?.body?.contentEquals(body) == true)
        }
    }

    @Test
    fun killedDownloadResumesWithoutDownloadingAgain() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val first = store(service, fetcher = FreezingFetcher(service, 8))
        first.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= 8 }
        // The process ends: nothing more is written, a line of the progress log is cut short and a
        // partial pack is left behind.
        val version = layout().regions.walkTopDown().first { it.name == "v1" }
        File(version, "progress").appendText("0123abc")
        layout().packs.incoming.mkdirs()
        File(layout().packs.incoming, "x.tfpack.part").writeText("partial")

        val second = store(service)
        val done = waitFor(second, "madrid") { it.state == COMPLETE }
        assertEquals(done.requiredPackCount, done.completedPackCount)
        val bodies = service.downloads.filter { it.status == 200 }.groupingBy { it.url }.eachCount()
        assertEquals(done.requiredPackCount + 3, bodies.size.toLong())
        assertEquals("Nothing is downloaded twice", 1, bodies.values.max())
        assertEquals(1, service.creations.get())
    }

    @Test
    fun corruptedPacksAreDownloadedAgainAndNeverStored() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.corruptPacks = 1
        val store = store(service)
        store.loadRegion("madrid", madrid())
        val done = waitFor(store, "madrid") { it.state == COMPLETE }
        val packs = service.downloads.filter { it.url.endsWith(".tfpack") }
        assertEquals("One pack came twice", done.requiredPackCount + 1, packs.size.toLong())

        // A pack that never verifies stops the download; nothing damaged is kept.
        val damaged = OfflineServiceStub()
        damaged.corruptPacks = 1_000
        val other = store(damaged, root = "damaged")
        other.loadRegion("madrid", madrid())
        val failed = waitFor(other, "madrid") { it.state == FAILED }
        assertEquals(TileflowOfflineErrorCode.INVALID_RESPONSE, failed.error?.code)
        assertEquals("verificationFailed", failed.error?.context?.reason)
        assertFalse(failed.isAvailable)
        assertEquals(emptyList<File>(), storedPacks("damaged"))
    }

    @Test
    fun fullDiskStopsTheDownloadUntilResumed() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val space = AtomicReference<Long?>(1024)
        val store = store(service, space = space)
        store.loadRegion("madrid", madrid())
        val full = waitFor(store, "madrid") { it.state == FAILED }
        assertEquals(TileflowOfflineErrorCode.INSUFFICIENT_STORAGE, full.error?.code)
        assertTrue(service.downloads.isEmpty())

        // The disk fills during the download.
        space.set(null)
        service.onDownload = { count -> if (count == 8) space.set(512) }
        store.resumeRegion("madrid")
        val again = waitFor(store, "madrid") { it.state == FAILED }
        assertEquals(TileflowOfflineErrorCode.INSUFFICIENT_STORAGE, again.error?.code)
        assertFalse(again.isAvailable)
        assertTrue(again.completedPackCount >= 1)
        assertTrue(again.completedPackCount < again.requiredPackCount)

        space.set(null)
        service.onDownload = null
        store.resumeRegion("madrid")
        val done = waitFor(store, "madrid") { it.state == COMPLETE }
        assertEquals(done.requiredPackCount, done.completedPackCount)
        val bodies = service.downloads.filter { it.status == 200 }.map { it.url }
        assertEquals(bodies.size, bodies.toSet().size)
    }

    @Test
    fun aFullDiskFirstMakesRoomFromTheMapCache() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val url = URI("https://maps.example.com/style.json")
        val body = "cached".toByteArray()
        assertTrue(
            cache.write(
                ResourceCacheKey(url, ResourceCacheScope.Shared),
                ResourceCacheRetention.AMBIENT,
                ResourceCacheMetadata.of(
                    url,
                    200,
                    mapOf("Cache-Control" to "max-age=60"),
                    System.currentTimeMillis(),
                    false,
                    body.size,
                    sha256Hex(body),
                ),
                body,
            )
        )
        // The disk is full until the map cache is cleared.
        val store = store(service, available = { if (cache.usage().bytes > 0) 1024 else null })
        store.loadRegion("madrid", madrid())
        val done = waitFor(store, "madrid") { it.state == COMPLETE }
        assertTrue(done.isAvailable)
        assertEquals(0, cache.usage().entries)
    }

    @Test
    fun fiftyThousandResourceDownload() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.tileLimit = 49_998
        service.documentsPublicOnly = true
        service.maximumPackResources = 50_000
        val store = store(service, concurrency = 64)
        val options =
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(10.0, 10.0, 12.5, 12.5)),
                TileflowOfflineContent.Hosted(MAP_ID, listOf("default")),
                minZoom = 11,
                maxZoom = 15,
            )
        val estimate = store.estimateRegion(options)
        assertEquals(50_000L, estimate.resourceCount)
        assertEquals(49_998L, estimate.billableResourceCount)
        assertEquals(50L, estimate.mapViews)
        assertEquals(mapOf("world" to 49_998L), estimate.tileCounts)
        assertTrue(estimate.packCount < 400)
        val started = System.currentTimeMillis()
        store.loadRegion("large", options)
        val done = waitFor(store, "large", timeoutMillis = 600_000) { it.state == COMPLETE }
        assertEquals(50_000L, done.completedResourceCount)
        assertEquals(estimate.packCount, done.completedPackCount)
        assertEquals("The estimate's download is reused", 1, service.creations.get())
        println(
            "50,000 resources in ${estimate.packCount} packs stored in " +
                "${(System.currentTimeMillis() - started) / 1000} s"
        )

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
    fun updatesDownloadOnlyChangedPacksAndKeepTheStoredVersionUntilComplete() =
        runBlocking<Unit> {
            val service = OfflineServiceStub()
            val index = OfflineServingIndex()
            val store = store(service, index = index)
            store.loadRegion("madrid", madrid())
            waitFor(store, "madrid") { it.state == COMPLETE }
            val first = service.downloads.size
            val oldTile = service.tileUrl(service.changedTile)

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

            // A deployment changes the styles and a World release one tile; every other pack
            // answers 304.
            service.publish()
            service.freezeAfter = first + 4
            store.loadRegion("madrid", madrid())
            waitUntil { service.downloads.size >= first + 4 }
            val updating = store.region("madrid")!!
            assertTrue("The stored version stays while the update downloads", updating.isAvailable)
            assertTrue(
                index.resource(service.key(oldTile), cache)!!
                    .body
                    .contentEquals("tile ${service.changedTile.name}#1".toByteArray())
            )

            service.freezeAfter = null
            store.pauseRegion("madrid")
            store.resumeRegion("madrid")
            val done = waitFor(store, "madrid") { it.state == COMPLETE && it.completedAtMillis != null }
            val update = service.downloads.drop(first)
            assertEquals(
                setOf(
                    "$ORIGIN/v1/offline/documents/style.tfpack",
                    service.changedPackUrl,
                    "$ORIGIN/maps/$MAP_ID/mobile/webview-v1/manifest.json",
                ),
                update.filter { it.status == 200 }.map { it.url }.toSet(),
            )
            assertTrue(update.filter { it.status == 304 }.all { it.headers["If-None-Match"] != null })
            assertEquals(
                "Every pack of the changed release was asked for",
                done.requiredPackCount,
                update.count { it.url.endsWith(".tfpack") }.toLong(),
            )
            assertEquals(TileflowOfflineRegion.UpdateState.Current, done.updateState)
            assertEquals(done.requiredPackCount, done.completedPackCount)
            assertTrue(done.loadedResourceCount < done.requiredResourceCount)
            // The new release serves the changed tile; the previous version's packs are released.
            assertTrue(
                index.resource(service.key(service.tileUrl(service.changedTile)), cache)!!
                    .body
                    .contentEquals("tile ${service.changedTile.name}#2".toByteArray())
            )
            assertNull(index.resource(service.key(oldTile), cache))
            assertEquals(done.requiredPackCount, storedPacks().size.toLong())

            // A deployment alone keeps every tile pack without asking.
            val before = service.downloads.size
            service.deploy()
            store.loadRegion("madrid", madrid())
            waitFor(store, "madrid") { it.state == COMPLETE }
            assertEquals(
                setOf(
                    "$ORIGIN/v1/offline/documents/style.tfpack",
                    "$ORIGIN/v1/offline/documents/glyphs/Noto%20Sans%20Regular/0.tfpack",
                ),
                service.downloads.drop(before).map { it.url }.filter { it.endsWith(".tfpack") }.toSet(),
            )
        }

    @Test
    fun metadataChangesInPlaceWithoutDownloadingAgain() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service, fetcher = FreezingFetcher(service, 5))
        val options = madrid().copy(metadata = mapOf("name" to "Madrid"))
        store.loadRegion("madrid", options)
        waitUntil { service.downloads.size >= 5 }
        // Loading with new metadata keeps the download in progress.
        val renamed = options.copy(metadata = mapOf("name" to "Centro"))
        store.loadRegion("madrid", renamed)
        assertEquals(mapOf("name" to "Centro"), store.region("madrid")!!.options.metadata)
        assertEquals("No new download", 1, service.creations.get())

        val other = store(service, root = "other")
        other.loadRegion("madrid", renamed)
        waitFor(other, "madrid") { it.state == COMPLETE }
        val downloads = service.downloads.size
        other.updateRegionMetadata("madrid", mapOf("name" to "Sol"))
        val updated = other.region("madrid")!!
        assertEquals(mapOf("name" to "Sol"), updated.options.metadata)
        assertEquals(COMPLETE, updated.state)
        assertEquals("Nothing downloads", downloads, service.downloads.size)
        // The change survives a new store over the same files.
        assertEquals(
            mapOf("name" to "Sol"),
            store(service, root = "other").region("madrid")!!.options.metadata,
        )
        try {
            other.updateRegionMetadata("missing", emptyMap())
            fail("The region does not exist")
        } catch (error: TileflowOfflineException) {
            assertEquals(TileflowOfflineErrorCode.REGION_NOT_FOUND, error.code)
        }
    }

    @Test
    fun accessEndingStopsUpdatesWithoutRemovingTheRegion() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        store.loadRegion("madrid", madrid())
        val done = waitFor(store, "madrid") { it.state == COMPLETE }
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
        assertEquals(done.requiredPackCount, storedPacks().size.toLong())
    }

    @Test
    fun expiredOrOverusedGrantsCreateTheDownloadAgain() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.expireGrantAfter = 6
        val store = store(service)
        store.loadRegion("madrid", madrid())
        val done = waitFor(store, "madrid") { it.state == COMPLETE }
        assertEquals(2, service.creations.get())
        assertEquals(done.requiredPackCount, done.completedPackCount)
        val bodies = service.downloads.filter { it.status == 200 }.map { it.url }
        assertEquals("Stored packs are kept", bodies.size, bodies.toSet().size)

        // A pack asked for too often under one grant: the download is created again.
        val repeated = OfflineServiceStub()
        repeated.refuseOnce =
            OfflineServiceStub.Refusal(5, 429, "OFFLINE_PACK_REPEAT_LIMIT_REACHED", null)
        val again = store(repeated, root = "repeated")
        again.loadRegion("madrid", madrid())
        waitFor(again, "madrid") { it.state == COMPLETE }
        assertEquals(2, repeated.creations.get())

        // A window that ends before the download continues is renewed before downloading.
        val other = OfflineServiceStub()
        val first = store(other, root = "second", fetcher = FreezingFetcher(other, 5))
        first.loadRegion("madrid", madrid())
        waitUntil { other.downloads.size >= 5 }
        other.clock.addAndGet(86_400_000)
        val second = store(other, root = "second")
        waitFor(second, "madrid") { it.state == COMPLETE }
        assertEquals(2, other.creations.get())
    }

    @Test
    fun recoverableRefusalsWaitAsAsked() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.refuseOnce =
            OfflineServiceStub.Refusal(6, 429, "OFFLINE_TEAM_DAILY_LIMIT_REACHED", "7")
        val sleeps = java.util.Collections.synchronizedList(mutableListOf<Long>())
        val store = store(service, sleeps = sleeps)
        store.loadRegion("madrid", madrid())
        waitFor(store, "madrid") { it.state == COMPLETE }
        assertTrue(sleeps.toString(), 7_000L in sleeps)

        // A refusal that waiting cannot repair stops the download.
        val refused = OfflineServiceStub()
        refused.refuseOnce = OfflineServiceStub.Refusal(5, 429, "COMMERCIAL_MAP_LIMIT_REACHED", null)
        val other = store(refused, root = "refused")
        other.loadRegion("madrid", madrid())
        val failed = waitFor(other, "madrid") { it.state == FAILED }
        assertEquals(TileflowOfflineErrorCode.QUOTA_EXCEEDED, failed.error?.code)
    }

    @Test
    fun offlineDownloadWaitsForTheNetwork() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        store.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= 1 }
        service.online = false
        val waiting = waitFor(store, "madrid") { it.state == TileflowOfflineRegion.DownloadState.WAITING }
        assertEquals(TileflowOfflineErrorCode.NETWORK, waiting.error?.code)
        service.online = true
        store.core.networkDidConnect()
        waitFor(store, "madrid") { it.state == COMPLETE }
    }

    @Test
    fun removingReleasesOnlyPacksNoOtherRegionUses() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        val store = store(service)
        val events = CopyOnWriteArrayList<TileflowOfflineRegionEvent>()
        val subscription = store.subscribe { events.add(it) }
        store.loadRegion("madrid", madrid())
        waitFor(store, "madrid") { it.state == COMPLETE }
        val first = storedPacks().toSet()
        store.loadRegion("nearby", madrid(east = -3.67))
        waitFor(store, "nearby") { it.state == COMPLETE }
        val all = storedPacks().toSet()
        assertTrue(all.size > first.size)
        assertEquals(listOf("madrid", "nearby"), store.allRegions().map { it.id })

        store.removeRegion("nearby")
        assertEquals("Identical packs are shared", first, storedPacks().toSet())
        store.removeRegion("madrid")
        assertEquals(emptyList<File>(), storedPacks())
        assertTrue(store.allRegions().isEmpty())
        waitUntil { events.contains(TileflowOfflineRegionEvent.Removed("madrid")) }
        subscription.cancel()
    }

    @Test
    fun pauseAndCancel() = runBlocking<Unit> {
        val service = OfflineServiceStub()
        service.freezeAfter = 5
        val store = store(service)
        store.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= 5 }
        store.pauseRegion("madrid")
        assertEquals(TileflowOfflineRegion.DownloadState.PAUSED, store.region("madrid")!!.state)
        service.freezeAfter = null
        delay(50)
        assertEquals(5, service.downloads.size)

        // Cancelling a region that never completed removes it and what it stored.
        store.cancelRegion("madrid")
        assertTrue(store.allRegions().isEmpty())
        assertEquals(emptyList<File>(), storedPacks())
        for (url in service.served.keys.filter(service::isPublic))
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
        waitFor(store, "madrid") { it.state == COMPLETE }
        assertEquals(
            "application/json",
            index.resource(style, cache)?.metadata?.headers?.get("Content-Type"),
        )
        val credits = index.credits(ResourceCacheScope.grant(URI(ORIGIN), MAP_ID))
        assertEquals(listOf("es-ign"), credits.map { it.id })
        assertEquals(listOf(listOf(-9.4, 35.9, 4.4, 43.8)), credits.single().regions)
        // A tile the region does not cover is not known offline.
        assertNull(index.resource(service.key(service.tileUrl(OfflineTileId(12, 0, 0))), cache))

        // A region that is still downloading is not used.
        service.publish()
        val frozen = service.downloads.size + 3
        service.freezeAfter = frozen
        store.loadRegion("madrid", madrid())
        waitUntil { service.downloads.size >= frozen }
        assertNull(index.resource(service.key(service.styleUrl), cache))
        store.cancelRegion("madrid")
        service.freezeAfter = null

        // Access ends: maps stop using the region; its files stay on the device.
        service.clock.addAndGet(86_401_000)
        service.revalidationState = "not_updatable"
        store.core.checkForUpdates()
        assertFalse(store.region("madrid")!!.isAvailable)
        assertNull(index.resource(style, cache))
        assertTrue(storedPacks().isNotEmpty())
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

    /**
     * The service's own packs, generated by its code for two releases: downloaded, verified, served
     * in place, and updated with only the changed packs transferred.
     */
    @Test
    fun platformsPacksDownloadServeAndUpdate() = runBlocking<Unit> {
        val service = OfflinePlatformFixture()
        val index = OfflineServingIndex()
        val subscribers = OfflineSubscribers()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO).also(scopes::add)
        val configuration =
            TileflowConfiguration(
                apiOrigin = URI(ORIGIN),
                mapCredential = TileflowCredential("tf_public_" + "c".repeat(48)),
            )
        val store =
            TileflowOfflineStore(
                OfflineStoreCore(
                    layout("platform"),
                    cache,
                    service,
                    { OfflinePackClient(configuration, { service }, now = { OfflinePlatformFixture.NOW }) },
                    { null },
                    subscribers,
                    index,
                    { OfflineScopeRunner(it, scope) },
                    reserveBytes = 4096,
                    now = { OfflinePlatformFixture.NOW },
                ),
                subscribers,
            )
        val options =
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.71, 40.41, -3.69, 40.425)),
                TileflowOfflineContent.Hosted(OfflinePlatformFixture.MAP_ID, listOf("default")),
                minZoom = 10,
                maxZoom = 14,
            )
        store.loadRegion("fixture", options)
        val done = waitFor(store, "fixture") { it.state == COMPLETE }
        assertEquals(9L, done.requiredPackCount)
        assertEquals(9L, done.completedPackCount)
        assertEquals(25L, done.requiredResourceCount)
        assertEquals(23L, done.billableResourceCount)
        assertEquals("Nine packs, discovery", 10, service.downloads.count { it.status == 200 })

        // Every entry of every pack answers as the route serves it, decoded.
        val scopeOfMap = ResourceCacheScope.grant(URI(ORIGIN), OfflinePlatformFixture.MAP_ID)
        val manifest = service.manifest(1)
        val held = HashSet<String>()
        for (pack in service.packs(1)) {
            val file = OfflinePlatformFixture.file(pack.file)
            val entries = OfflinePackFormat.index(file)
            for (entry in entries.entries.values) {
                val raw = OfflinePackFormat.body(entry, file)
                var address = entry.name
                val tile = OfflineTileId.ofName(entry.name)
                val source = manifest.sources.firstOrNull { pack.id.startsWith("tiles/${it.source}/") }
                if (entries.kind == OfflinePackKind.TILES && tile != null && source != null) {
                    address = source.template.url(tile).toASCIIString()
                    held.add("${source.source}/${tile.name}")
                }
                val served = index.resource(ResourceCacheKey(URI(address), scopeOfMap), cache)
                assertEquals(address, 200, served?.metadata?.status)
                val expected = if (entry.contentEncoding == "gzip") OfflinePackFormat.gunzip(raw) else raw
                assertTrue(address, served!!.body.contentEquals(expected))
            }
        }
        // The World tile the archive does not store, and Terrain inside the region above the zoom
        // the download stops at, answer as online; outside the region nothing is known.
        val world = manifest.source("world")!!
        val terrain = manifest.source("terrain")!!
        val cover = OfflineTileCover(manifest.region, 13)
        val unstored =
            cover.rows!!.flatMap { y ->
                cover.row(y).flatMap { xs -> xs.map { OfflineTileId(13, it, y) } }
            }.filter { "world/${it.name}" !in held }
        assertTrue("The archive does not store every covered tile", unstored.isNotEmpty())
        val deep = OfflineTileCover(manifest.region, 14)
        val inside = OfflineTileId(14, deep.row(deep.rows!!.first)[0].first, deep.rows!!.first)
        for (url in listOf(world.template.url(unstored[0]), terrain.template.url(inside))) {
            val answer = index.resource(ResourceCacheKey(url, scopeOfMap), cache)
            assertEquals(url.toString(), 404, answer?.metadata?.status)
            assertEquals(0, answer!!.body.size)
        }
        assertNull(index.resource(ResourceCacheKey(terrain.template.url(OfflineTileId(14, 0, 0)), scopeOfMap), cache))

        // A new World release: Terrain's packs are kept without asking, every other pack is asked
        // for with its digest, and only the changed ones transfer.
        val before = service.downloads.size
        service.release = 2
        store.loadRegion("fixture", options)
        val updated =
            waitFor(store, "fixture") {
                it.state == COMPLETE && it.loadedResourceCount < it.requiredResourceCount
            }
        assertEquals(9L, updated.completedPackCount)
        val asked = service.downloads.drop(before).filter { it.url.endsWith(".tfpack") }
        assertFalse("Terrain did not change", asked.any { "/tiles/terrain/" in it.url })
        val first = service.packs(1).associate { it.id to it.etag }
        val changed = service.packs(2).filter { first[it.id] != it.etag }.map { it.url }.toSet()
        assertTrue(changed.isNotEmpty())
        assertEquals(changed, asked.filter { it.status == 200 }.map { it.url }.toSet())
        assertTrue(asked.filter { it.status == 304 }.all { it.headers["If-None-Match"] != null })
    }

    // Helpers.

    private fun layout(root: String = "offline") = OfflineLayout(File(directory, root))

    private fun storedPacks(root: String = "offline"): List<File> =
        layout(root).packs.directory.listFiles().orEmpty().filter { it.isFile }.sortedBy { it.name }

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
        available: (() -> Long?)? = null,
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
            available ?: { space?.get() },
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
        available: (() -> Long?)? = null,
    ): TileflowOfflineStore {
        val subscribers = OfflineSubscribers()
        return TileflowOfflineStore(
            core(
                service,
                root,
                subscribers,
                space,
                sleeps,
                concurrency,
                fetcher,
                index = index,
                available = available,
            ),
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

    private companion object {
        const val MAP_ID = OfflineServiceStub.MAP_ID
        const val ORIGIN = OfflineServiceStub.ORIGIN
        const val GRANT = OfflineServiceStub.GRANT
        val COMPLETE = TileflowOfflineRegion.DownloadState.COMPLETE
        val FAILED = TileflowOfflineRegion.DownloadState.FAILED
    }
}
