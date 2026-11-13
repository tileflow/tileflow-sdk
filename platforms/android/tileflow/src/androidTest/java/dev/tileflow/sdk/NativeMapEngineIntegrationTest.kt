package dev.tileflow.sdk

import android.content.Intent
import android.os.Bundle
import android.view.ViewGroup
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.offline.OfflineHttpFetcher
import dev.tileflow.sdk.offline.OfflineLayout
import dev.tileflow.sdk.offline.OfflinePackClient
import dev.tileflow.sdk.offline.OfflineScopeRunner
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineStoreCore
import dev.tileflow.sdk.offline.OfflineSubscribers
import dev.tileflow.sdk.offline.TileflowOfflineContent
import dev.tileflow.sdk.offline.TileflowOfflineGeometry
import dev.tileflow.sdk.offline.TileflowOfflineRegion
import dev.tileflow.sdk.offline.TileflowOfflineRegionLoadOptions
import dev.tileflow.sdk.offline.TileflowOfflineStore
import dev.tileflow.sdk.offline.TileflowOfflineSwitch
import java.io.File
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.maps.MapView

/** Hosts a map drawn by MapLibre Native: [requested] in [theme] at [camera]. */
public class NativeMapHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loaded = CountDownLatch(1)
    val failures = CopyOnWriteArrayList<TileflowErrorCode>()
    val warnings = CopyOnWriteArrayList<TileflowMapEvent.Warning>()
    val changedThemes = CopyOnWriteArrayList<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        map =
            TileflowMapView(this).apply {
                onEvent = {
                    when (it) {
                        TileflowMapEvent.ContentReady -> loaded.countDown()
                        is TileflowMapEvent.Failed -> failures.add(it.code)
                        is TileflowMapEvent.Warning -> warnings.add(it)
                        is TileflowMapEvent.ThemeChanged -> changedThemes.add(it.theme)
                        else -> Unit
                    }
                }
                setSource(requested, initialCamera = Companion.camera)
                Companion.theme?.let { runBlocking { setTheme(it) } }
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }

    /** The engine drawing the map, once it initialized. */
    internal val engine: NativeMapEngine?
        get() = map.readyEngine as? NativeMapEngine

    internal companion object {
        val SELF_HOSTED =
            TileflowMapSource(
                map = "fixture",
                manifestUrl = URI("${Fixture.ORIGIN}/manifest.json"),
                allowsLoopbackHttp = true,
            )
        @Volatile var requested: TileflowMapSource = SELF_HOSTED
        @Volatile var theme: String? = null
        @Volatile var camera: TileflowCamera? = TileflowCamera(-3.70, 40.42, 12.0)
    }
}

/**
 * Maps drawn by MapLibre Native through the same view as the default engine. Every request
 * MapLibre makes for a Tileflow map comes back to the SDK's transport: online through the map's
 * Hosted session, offline from its downloaded regions, also in airplane mode.
 *
 * Run with the online fixture server and `adb reverse tcp:18645 tcp:<port>`.
 */
@RunWith(AndroidJUnit4::class)
public class NativeMapEngineIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val root = File(context.cacheDir, "native-engine-test-${System.nanoTime()}")
    private val stores = mutableListOf<TileflowOfflineStore>()
    private val configuration =
        TileflowConfiguration(
            apiOrigin = URI(Fixture.ORIGIN),
            mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)),
        )
    private val madrid = TileflowCamera(-3.70, 40.42, 15.5)

    @After
    public fun tearDown() {
        airplaneMode(false)
        TileflowOfflineSwitch.isNetworkEnabled = true
        runBlocking {
            for (store in stores) for (region in store.allRegions()) store.removeRegion(region.id)
        }
        scope.cancel()
        root.deleteRecursively()
        NativeMapHostActivity.requested = NativeMapHostActivity.SELF_HOSTED
        NativeMapHostActivity.theme = null
        NativeMapHostActivity.camera = TileflowCamera(-3.70, 40.42, 12.0)
    }

    @Test
    public fun theNativeEngineMountsAndReportsItsCamera() {
        Fixture.require("${Fixture.ORIGIN}/manifest.json")
        val activity = show()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    // The engine's view holds MapLibre's view, and an image of it during a change.
                    val engines =
                        (0 until map.childCount)
                            .map(map::getChildAt)
                            .filterIsInstance<ViewGroup>()
                            .flatMap { group -> (0 until group.childCount).map(group::getChildAt) }
                            .filterIsInstance<MapView>()
                    assertEquals("One MapLibre view draws the map", 1, engines.size)
                    val camera = map.camera()
                    assertEquals(-3.70, camera.longitude, 0.0001)
                    assertEquals(40.42, camera.latitude, 0.0001)
                    assertEquals(12.0, camera.zoom, 0.0001)
                    assertEquals(camera, map.currentCamera)
                    // The fixture's POI, drawn where the camera projects it.
                    val point = map.project(TileflowCoordinate(-3.70, 40.42))
                    val features = map.query(point.x, point.y)
                    assertTrue(
                        "The POI did not render: $features",
                        features.any { it.layer == "poi" },
                    )
                    val coordinate = map.unproject(point)
                    assertEquals(-3.70, coordinate.longitude, 0.0001)
                    assertEquals(40.42, coordinate.latitude, 0.0001)
                }
            }
        } finally {
            finish(activity)
        }
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
    }

    @Test
    public fun aHostedMapLoadsOnlineThroughTheInterception() {
        Fixture.require()
        Fixture.counters(reset = true)
        NativeMapHostActivity.requested = hosted()
        NativeMapHostActivity.theme = "labels"
        NativeMapHostActivity.camera = madrid
        val (requests, activity) =
            EngineRequests().use { requests ->
                val activity = show()
                try {
                    assertTrue("The map did not render", rendered(activity, "buildings"))
                    // Labels and icons arrive after the content is ready.
                    waitFor(10_000) {
                        requests.matching("/fonts/").isNotEmpty() &&
                            requests.matching("/sprites/").size >= 2
                    }
                    assertTrue(
                        "Attribution: ${activity.engine?.attribution?.entries}",
                        activity.engine?.attribution?.entries?.any { it.text == "Fixture World" } == true,
                    )
                } finally {
                    finish(activity)
                }
                requests to activity
            }
        assertEquals("MapLibre reached the network itself", listOf<String>(), requests.delegated)
        val sprite = requests.matching("/sprites/fixture/sprite")
        assertEquals(
            setOf(
                URI("${Fixture.ORIGIN}/sprites/fixture/sprite@2x.json"),
                URI("${Fixture.ORIGIN}/sprites/fixture/sprite@2x.png"),
            ),
            sprite.map { it.first }.toSet(),
        )
        assertTrue("$sprite", sprite.all { it.second == 200 })
        val glyphs = requests.matching("/fonts/")
        assertEquals(
            setOf(URI("${Fixture.ORIGIN}/fonts/Noto%20Sans%20Regular/0-255.pbf")),
            glyphs.map { it.first }.toSet(),
        )
        assertTrue("$glyphs", glyphs.all { it.second == 200 })
        assertTrue("${requests.answered}", requests.answered.all { it.second == 200 })
        val counters = Fixture.counters()
        assertEquals("One session", 1, counters.getInt("sessions"))
        assertTrue("$counters", counters.getInt("sessionResources") > 0)
        assertEquals("MapLibre stores nothing", 0, mapLibreDatabaseRows(context).values.sum())
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
        assertTrue("Warnings: ${activity.warnings}", activity.warnings.isEmpty())
    }

    /**
     * The same map from its downloaded region in airplane mode, with Tileflow's network switched
     * off: MapLibre still asks the SDK, which answers everything from the region's packs.
     */
    @Test
    public fun aHostedMapOpensFromItsPackInAirplaneMode() {
        Fixture.require()
        val cache = TileflowMapCache.get(context)
        runBlocking { cache.clear() }
        val store = store { OfflinePackClient(configuration) }
        download(
            store,
            "labels",
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(
                    TileflowBoundingBox(-3.705, 40.416, -3.695, 40.424)
                ),
                TileflowOfflineContent.Hosted(Fixture.HOSTED_MAP_ID, listOf("labels")),
                minZoom = 13,
                maxZoom = 15,
            ),
        )
        Fixture.counters(reset = true)
        NativeMapHostActivity.requested = hosted()
        NativeMapHostActivity.theme = "labels"
        NativeMapHostActivity.camera = madrid
        TileflowOfflineSwitch.isNetworkEnabled = false
        airplaneMode(true)
        val (requests, activity) =
            EngineRequests().use { requests ->
                val activity = show()
                try {
                    assertTrue("The pack did not render", rendered(activity, "buildings"))
                    waitFor(10_000) {
                        requests.matching("/fonts/").isNotEmpty() &&
                            requests.matching("/sprites/").size >= 2
                    }
                } finally {
                    finish(activity)
                    airplaneMode(false)
                    TileflowOfflineSwitch.isNetworkEnabled = true
                }
                requests to activity
            }
        assertEquals("MapLibre reached the network itself", listOf<String>(), requests.delegated)
        assertTrue("MapLibre asked in airplane mode", requests.answered.isNotEmpty())
        assertTrue(
            "Everything came from the packs: ${requests.answered}",
            requests.answered.all { it.second == 200 },
        )
        assertTrue(requests.matching("/sprites/fixture/sprite@2x.png").isNotEmpty())
        assertTrue(requests.matching("/fonts/Noto%20Sans%20Regular/0-255.pbf").isNotEmpty())
        val counters = Fixture.counters()
        assertEquals("No session starts without a network", 0, counters.getInt("sessions"))
        assertEquals(0, counters.getInt("downloads"))
        assertEquals(0, counters.getInt("sessionResources"))
        assertEquals(0, counters.getInt("notModified"))
        assertEquals("Nothing came from the network", 0, runBlocking { cache.usage() }.entries)
        assertEquals("MapLibre stores nothing", 0, mapLibreDatabaseRows(context).values.sum())
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
        assertTrue("Warnings: ${activity.warnings}", activity.warnings.isEmpty())
    }

    @Test
    public fun hostedFontFilesRenderFromPacksWithAnEmptyCache() {
        Fixture.require()
        val cache = TileflowMapCache.get(context)
        runBlocking { cache.clear() }
        val store = store { OfflinePackClient(configuration) }
        download(
            store,
            "fonts",
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(
                    TileflowBoundingBox(-3.705, 40.416, -3.695, 40.424)
                ),
                TileflowOfflineContent.Hosted(Fixture.HOSTED_MAP_ID, listOf("fonts")),
                minZoom = 13,
                maxZoom = 15,
            ),
        )
        runBlocking { cache.clear() }
        Fixture.counters(reset = true)
        NativeMapHostActivity.requested = hosted()
        NativeMapHostActivity.theme = "fonts"
        NativeMapHostActivity.camera = madrid
        TileflowOfflineSwitch.isNetworkEnabled = false
        airplaneMode(true)
        val (requests, activity) =
            EngineRequests().use { requests ->
                val activity = show()
                try {
                    assertTrue("The pack did not render", rendered(activity, "brand-label"))
                    waitFor(10_000) {
                        requests.matching("/font-bundles/").map { it.first }.toSet().size == 2
                    }
                } finally {
                    finish(activity)
                    airplaneMode(false)
                    TileflowOfflineSwitch.isNetworkEnabled = true
                }
                requests to activity
            }
        assertEquals("MapLibre reached the network itself", listOf<String>(), requests.delegated)
        assertTrue("MapLibre asked in airplane mode", requests.answered.isNotEmpty())
        assertTrue(
            "Everything came from the packs: ${requests.answered}",
            requests.answered.all { it.second == 200 },
        )
        assertEquals("Latin and Greek files", 2, requests.matching("/font-bundles/").map { it.first }.toSet().size)
        val counters = Fixture.counters()
        assertEquals("No session starts without a network", 0, counters.getInt("sessions"))
        assertEquals(0, counters.getInt("downloads"))
        assertEquals(0, counters.getInt("sessionResources"))
        assertEquals(0, counters.getInt("notModified"))
        assertEquals("Nothing came from the network", 0, runBlocking { cache.usage() }.entries)
        assertEquals("MapLibre stores nothing", 0, mapLibreDatabaseRows(context).values.sum())
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
        assertTrue("Warnings: ${activity.warnings}", activity.warnings.isEmpty())
    }

    @Test
    public fun mixedFontFallbackRendersOnline() = checkMixedFontFallback(false)

    @Test
    public fun mixedFontFallbackRendersOffline() = checkMixedFontFallback(true)

    /** Actual pack files in one app store, after two neighbouring Madrid regions. */
    @Test
    public fun sharedFontStorageAcrossTwoRegions() {
        Fixture.require()
        val store = store { OfflinePackClient(configuration) }
        val packs = File(root, "store-0/packs")
        fun snapshot(): org.json.JSONObject {
            val files = packs.listFiles()?.filter { it.isFile && it.extension == "tfpack" }.orEmpty()
            val fontPacks = files.mapNotNull { file ->
                val entries = dev.tileflow.sdk.offline.OfflinePackFormat.index(file).entries.values
                val fonts = entries.filter { it.contentType.startsWith("font/") }
                if (fonts.isEmpty()) null else Triple(file, entries, fonts)
            }
            return org.json.JSONObject().apply {
                put("fontFiles", fontPacks.sumOf { it.third.size })
                put("localLicenseBytes", files.sumOf { file ->
                    dev.tileflow.sdk.offline.OfflinePackFormat.index(file).entries.values
                        .filter { it.name.contains("/fonts/licenses/") }.sumOf { it.length.toLong() }
                })
                put("fontBytes", fontPacks.sumOf { it.third.sumOf { entry -> entry.length.toLong() } })
                put("officialFontBytes", fontPacks.sumOf { it.third.filter { entry -> entry.name.contains("/base/") }.sumOf { entry -> entry.length.toLong() } })
                put("licenseBytes", fontPacks.sumOf { it.second.filter { entry -> entry.name.endsWith(".txt") }.sumOf { entry -> entry.length.toLong() } })
                put("fontPackBytes", fontPacks.sumOf { it.first.length() })
                put("allPackBytes", files.sumOf { it.length() })
                put("fontPackDigests", org.json.JSONArray(fontPacks.map { it.first.name }.sorted()))
            }
        }
        val snapshots = mutableListOf<org.json.JSONObject>()
        for ((index, west) in listOf(-3.705, -3.695).withIndex()) {
            download(store, "madrid-$index", TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(west, 40.416, west + 0.01, 40.424)),
                TileflowOfflineContent.Hosted(Fixture.HOSTED_MAP_ID, listOf("fallback")), minZoom = 13, maxZoom = 15,
            ))
            snapshots.add(snapshot())
        }
        val report = org.json.JSONObject().put("platform", "android").put("regions", org.json.JSONArray(snapshots))
        File(context.filesDir, "offline-font-measurement.json").writeText(report.toString(2))
        println("OFFLINE_FONT_MEASUREMENT $report")
        assertEquals(148, snapshots[0].getInt("fontFiles"))
        assertTrue(snapshots[0].getLong("localLicenseBytes") > 0)
        assertEquals(snapshots[0].getLong("localLicenseBytes"), snapshots[1].getLong("localLicenseBytes"))
        assertTrue(snapshots[0].getLong("fontBytes") > 32L * 1024 * 1024)
        assertEquals(snapshots[0].getLong("fontPackBytes"), snapshots[1].getLong("fontPackBytes"))
        assertEquals(snapshots[0].getJSONArray("fontPackDigests").toString(), snapshots[1].getJSONArray("fontPackDigests").toString())
        runBlocking { store.removeRegion("madrid-0") }
        assertEquals(snapshots[1].getLong("fontPackBytes"), snapshot().getLong("fontPackBytes"))
    }

    private fun checkMixedFontFallback(offline: Boolean) {
        Fixture.require()
        val cache = TileflowMapCache.get(context)
        runBlocking { cache.clear() }
        if (offline) {
            download(store { OfflinePackClient(configuration) }, "fallback", TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.705, 40.416, -3.695, 40.424)),
                TileflowOfflineContent.Hosted(Fixture.HOSTED_MAP_ID, listOf("fallback")), minZoom = 13, maxZoom = 15,
            ))
        }
        runBlocking { cache.clear() }
        Fixture.counters(reset = true)
        NativeMapHostActivity.requested = hosted()
        NativeMapHostActivity.theme = "fallback"
        NativeMapHostActivity.camera = madrid
        TileflowOfflineSwitch.isNetworkEnabled = !offline
        if (offline) airplaneMode(true)
        val (requests, activity) = EngineRequests().use { requests ->
            val activity = show()
            try {
                waitFor(10_000) { requests.matching("/font-bundles/").isNotEmpty() && requests.matching("/NotoSansCJKjp-Regular.otf").isNotEmpty() }
                runBlocking { withContext(Dispatchers.Main) {
                    for (latitude in listOf(40.4205, 40.4195, 40.42)) {
                        val point = activity.map.project(TileflowCoordinate(-3.7, latitude))
                        assertTrue(activity.map.query(point.x, point.y).any { it.layer == "fallback-label" })
                    }
                } }
            } finally {
                finish(activity)
                airplaneMode(false)
                TileflowOfflineSwitch.isNetworkEnabled = true
            }
            requests to activity
        }
        assertTrue(requests.matching("/font-bundles/").any { it.second == 200 })
        for (file in listOf("NotoSans-Regular.ttf", "NotoSansCJKjp-Regular.otf", "NotoSansArabic-Regular.ttf")) {
            assertTrue("${requests.answered}", requests.matching("/$file").any { it.second == 200 })
        }
        assertEquals(listOf<String>(), requests.delegated)
        val counters = Fixture.counters()
        assertEquals(if (offline) 0 else 1, counters.getInt("sessions"))
        if (offline) {
            assertEquals(0, counters.getInt("downloads"))
            assertEquals(0, counters.getInt("sessionResources"))
            assertEquals(0, runBlocking { cache.usage() }.entries)
        }
        assertEquals(0, mapLibreDatabaseRows(context).values.sum())
        assertTrue("${activity.failures}", activity.failures.isEmpty())
        assertTrue("${activity.warnings}", activity.warnings.isEmpty())
    }

    @Test
    public fun inconsistentFamilyOpensAndSwitchesThemesDirectly() {
        val url = "${Fixture.ORIGIN}/native-inconsistent/manifest.json"
        Fixture.require(url)
        NativeMapHostActivity.requested =
            TileflowMapSource(map = "city", manifestUrl = URI(url), allowsLoopbackHttp = true)
        NativeMapHostActivity.camera = madrid
        val activity = show()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    activity.map.setBlend(listOf("light", "dark"), 0.75)
                    assertEquals("dark", activity.changedThemes.lastOrNull())
                    activity.map.setTheme("light")
                    assertEquals("light", activity.changedThemes.lastOrNull())
                }
            }
            assertTrue(activity.warnings.any { it.context.reason == "nativeFamilyInconsistent" })
            assertTrue(activity.failures.isEmpty())
        } finally {
            finish(activity)
        }
    }

    private fun hosted() =
        TileflowMapSource.hosted(Fixture.HOSTED_MAP_ID, configuration = configuration)

    private fun show(): NativeMapHostActivity {
        val intent =
            Intent(instrumentation.context, NativeMapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val requests = EngineRequests()
        val activity = instrumentation.startActivitySync(intent) as NativeMapHostActivity
        val loaded = activity.loaded.await(30, TimeUnit.SECONDS)
        requests.close()
        assertTrue(
            "Map did not load. Errors: ${activity.failures}, warnings: ${activity.warnings}, " +
                "requests: ${requests.answered}, delegated: ${requests.delegated}",
            loaded,
        )
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
        return activity
    }

    private fun finish(activity: NativeMapHostActivity) {
        instrumentation.runOnMainSync { activity.finish() }
        instrumentation.waitForIdleSync()
    }

    private fun rendered(activity: NativeMapHostActivity, layer: String): Boolean = runBlocking {
        withContext(Dispatchers.Main) {
            activity.map.query(activity.map.width / 2f, activity.map.height / 2f).any {
                it.layer == layer
            }
        }
    }

    private fun waitFor(timeoutMillis: Long, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(50)
    }

    /** A store of its own, downloading in the process, whose regions every map may use. */
    private fun store(client: () -> OfflinePackClient): TileflowOfflineStore {
        val subscribers = OfflineSubscribers()
        val core =
            OfflineStoreCore(
                OfflineLayout(File(root, "store-${stores.size}")),
                TileflowMapCache.get(context).store,
                OfflineHttpFetcher(),
                client,
                { null },
                subscribers,
                OfflineServingIndex.shared,
                { OfflineScopeRunner(it, scope) },
            )
        return TileflowOfflineStore(core, subscribers).also(stores::add)
    }

    private fun download(
        store: TileflowOfflineStore,
        id: String,
        options: TileflowOfflineRegionLoadOptions,
    ) = runBlocking {
        store.loadRegion(id, options)
        val deadline = System.currentTimeMillis() + 30_000
        var region = store.region(id)
        while (
            region?.state != TileflowOfflineRegion.DownloadState.COMPLETE &&
                System.currentTimeMillis() < deadline
        ) {
            delay(20)
            region = store.region(id)
        }
        assertEquals("$region", TileflowOfflineRegion.DownloadState.COMPLETE, region?.state)
    }
}
