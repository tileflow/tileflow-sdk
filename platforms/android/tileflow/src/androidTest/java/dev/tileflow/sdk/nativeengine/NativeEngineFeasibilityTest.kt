package dev.tileflow.sdk.nativeengine

import android.content.Intent
import android.database.sqlite.SQLiteDatabase
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PointF
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.google.gson.JsonPrimitive
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.TileflowMapCache
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.hosted.HostedEndpoint
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.offline.OfflineCover
import dev.tileflow.sdk.offline.OfflineHttpFetcher
import dev.tileflow.sdk.offline.OfflineLayout
import dev.tileflow.sdk.offline.OfflinePackClient
import dev.tileflow.sdk.offline.OfflinePackFormat
import dev.tileflow.sdk.offline.OfflineReachability
import dev.tileflow.sdk.offline.OfflineScopeRunner
import dev.tileflow.sdk.offline.OfflineServedPacks
import dev.tileflow.sdk.offline.OfflineServedTiles
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineServingSnapshot
import dev.tileflow.sdk.offline.OfflineStoreCore
import dev.tileflow.sdk.offline.OfflineSubscribers
import dev.tileflow.sdk.offline.OfflineTileId
import dev.tileflow.sdk.offline.OfflineTileTemplate
import dev.tileflow.sdk.offline.TileflowOfflineContent
import dev.tileflow.sdk.offline.TileflowOfflineGeometry
import dev.tileflow.sdk.offline.TileflowOfflineRegion
import dev.tileflow.sdk.offline.TileflowOfflineRegionLoadOptions
import dev.tileflow.sdk.offline.TileflowOfflineStore
import dev.tileflow.sdk.offline.TileflowOfflineSwitch
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourcePolicy
import dev.tileflow.sdk.transport.grantScope
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.sinh
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.log.Logger
import org.maplibre.android.log.LoggerDefinition
import org.maplibre.android.storage.FileSource

/**
 * Feasibility checks for drawing Tileflow maps with MapLibre Native on Android: network
 * interception through the engine's module provider, raster-dem parents offline, drawing on an
 * emulator, the engine's pitch limit and the native style family.
 *
 * Run with `TILEFLOW_FIXTURE_PORT=18682 node scripts/mobile-fixture-server.mjs` (and
 * `TILEFLOW_NATIVE_ARTIFACTS` naming a native build for the style family check) and
 * `adb reverse tcp:18682 tcp:18682`. Each check writes its receipt and pictures to the test
 * application's external files directory, under `native-engine/`.
 */
@RunWith(AndroidJUnit4::class)
public class NativeEngineFeasibilityTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val output = File(context.getExternalFilesDir(null), "native-engine").apply { mkdirs() }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val root = File(context.cacheDir, "native-engine-${System.nanoTime()}").apply { mkdirs() }
    private val stores = mutableListOf<TileflowOfflineStore>()
    private val logs = CopyOnWriteArrayList<String>()

    @Before
    public fun setUp() {
        EngineTransport.keepAmbientCache =
            InstrumentationRegistry.getArguments().getString("tileflowAmbientCache") == "default"
        EngineTransport.install(context)
        EngineTransport.records.clear()
        Logger.setLoggerDefinition(CapturingLogger(logs))
    }

    @After
    public fun tearDown() {
        TileflowOfflineSwitch.isNetworkEnabled = true
        if (Build.VERSION.SDK_INT >= 30) shell("cmd connectivity airplane-mode disable")
        EngineTransport.onMain { MapLibre.setConnected(null) }
        runBlocking {
            for (store in stores) for (region in store.allRegions()) store.removeRegion(region.id)
        }
        scope.cancel()
        root.deleteRecursively()
    }

    // Interception, online: a Hosted map through its session, nothing through MapLibre's client.

    @Test
    public fun hostedMapLoadsOnlineThroughTheTransport() {
        requireFixture()
        runBlocking { TileflowMapCache.get(context).clear() }
        val configuration = configuration()
        counters(reset = true)
        val hosted = hostedLoader(configuration)
        val engineContext = EngineTransport.register(hosted.loader)
        val receipt = JSONObject().put("check", "interception-online")
        try {
            val (styleUrl, style) = hostedStyle(hosted.loader)
            val projected =
                EngineStyleProjection.project(style, styleUrl, engineContext, hosted::read)
            receipt.put("projectedStyle", projected.style)
            receipt.put("dropped", JSONObject(EngineStyleProjection.reasons.toMap()))
            val activity = show(projected.style, camera(-3.7, 40.42, 15.5))
            try {
                receipt.put("render", drawHosted(activity, "interception-online"))
                receipt.put("features", features(activity, "buildings", "markers"))
            } finally {
                finish(activity)
            }
        } finally {
            EngineTransport.retire(engineContext)
            hosted.close()
        }
        val fixture = counters()
        receipt.put("fixtureCounters", fixture)
        receipt.put("requests", requests())
        receipt.put("engineDatabase", engineDatabase())
        receipt.put("logs", JSONArray(logs.filter(::relevant)))
        receipt.put("ambientCache", if (EngineTransport.keepAmbientCache) "default" else "0")
        write(if (EngineTransport.keepAmbientCache) "interception-online-default-cache" else "interception-online", receipt)
        if (EngineTransport.keepAmbientCache) return

        val records = EngineTransport.records.toList()
        assertTrue("MapLibre's own client made requests: $records", records.none { it.delegated })
        assertTrue("Every request answered: $records", records.all { it.status == 200 })
        val remotes = records.mapNotNull { it.remote }
        val sprite = Regex("/sprites/fixture/sprite(@2x)?\\.(json|png)\\?map=$MAP_ID$")
        assertEquals("Sprite JSON and image, suffix before the query", 2, remotes.count { sprite.containsMatchIn(it) })
        assertTrue(remotes.any { it.endsWith("/fonts/Noto%20Sans%20Regular/0-255.pbf?map=$MAP_ID") })
        assertTrue(remotes.any { Regex("/tiles/world/1/15/\\d+/\\d+\\.pbf\\?map=$MAP_ID$").containsMatchIn(it) })
        assertEquals("One session", 1, fixture.getInt("sessions"))
        assertTrue(fixture.getInt("sessionResources") > 0)
        assertEquals("MapLibre stored nothing", 0, receipt.getJSONObject("engineDatabase").getInt("rows"))
        assertTrue(receipt.getJSONObject("features").getJSONObject("buildings").getInt("count") > 0)
    }

    // Interception, airplane mode: the same map from its downloaded pack.

    @Test
    public fun hostedMapLoadsFromItsPackInAirplaneMode() {
        assumeTrue(Build.VERSION.SDK_INT >= 30)
        requireFixture()
        val cache = TileflowMapCache.get(context)
        runBlocking { cache.clear() }
        val configuration = configuration()
        val store = store { OfflinePackClient(configuration) }
        download(
            store,
            "hosted",
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.72, 40.41, -3.68, 40.43)),
                TileflowOfflineContent.Hosted(MAP_ID, listOf("day")),
                minZoom = 13,
                maxZoom = 15,
            ),
        )
        counters(reset = true)
        shell("cmd connectivity airplane-mode enable")
        waitFor(15_000) { !OfflineReachability.isReachable(context) }
        TileflowOfflineSwitch.isNetworkEnabled = false
        EngineTransport.records.clear()
        val receipt = JSONObject().put("check", "interception-airplane")
        receipt.put("systemReachable", OfflineReachability.isReachable(context))
        val hosted = hostedLoader(configuration)
        val engineContext = EngineTransport.register(hosted.loader)
        try {
            val (styleUrl, style) = hostedStyle(hosted.loader)
            val projected =
                EngineStyleProjection.project(style, styleUrl, engineContext, hosted::read)
            // First the engine follows the system's connectivity, as MapLibre does by default.
            EngineTransport.onMain { MapLibre.setConnected(null) }
            val activity = show(projected.style, camera(-3.7, 40.42, 15.0))
            try {
                assertTrue(activity.styleLoaded.await(30, TimeUnit.SECONDS))
                Thread.sleep(8_000)
                receipt.put(
                    "followingSystem",
                    JSONObject()
                        .put("engineConnected", MapLibre.isConnected())
                        .put("requests", EngineTransport.records.size)
                        .put("idleEvents", activity.idleCount.get())
                        .put("picture", picture(activity, "interception-airplane-following-system")),
                )
                // Then the engine is told it is connected: the SDK alone decides what is offline.
                val idle = activity.idleCount.get()
                EngineTransport.onMain { MapLibre.setConnected(true) }
                assertTrue("Not idle after connecting", activity.awaitIdle(idle, 30_000))
                Thread.sleep(1_000)
                receipt.put("forcedConnected", drawHosted(activity, "interception-airplane", waitIdle = false))
                receipt.put("features", features(activity, "buildings", "markers"))
            } finally {
                finish(activity)
            }
        } finally {
            EngineTransport.retire(engineContext)
            hosted.close()
            TileflowOfflineSwitch.isNetworkEnabled = true
            shell("cmd connectivity airplane-mode disable")
        }
        val fixture = counters()
        receipt.put("fixtureCounters", fixture)
        receipt.put("requests", requests())
        receipt.put("sdkCacheEntries", runBlocking { cache.usage() }.entries)
        receipt.put("engineDatabase", engineDatabase())
        receipt.put("logs", JSONArray(logs.filter(::relevant)))
        write("interception-airplane", receipt)

        val records = EngineTransport.records.toList()
        assertTrue(records.none { it.delegated })
        assertEquals("No session without a network", 0, fixture.getInt("sessions"))
        assertEquals(0, fixture.getInt("downloads"))
        assertEquals(0, fixture.getInt("notModified"))
        assertEquals("Nothing came from the network", 0, receipt.getInt("sdkCacheEntries"))
        assertEquals(0, receipt.getJSONObject("engineDatabase").getInt("rows"))
        assertTrue(receipt.getJSONObject("features").getJSONObject("buildings").getInt("count") > 0)
    }

    /** A custom scheme reaches the module provider; MapLibre's own client never completes it. */
    @Test
    public fun customSchemeRequestsReachTheModuleProvider() {
        val style =
            JSONObject(
                """{"version":8,"sources":{"custom":{"type":"geojson","data":"tileflow://resource/data.json"}},"layers":[{"id":"background","type":"background","paint":{"background-color":"#dddddd"}},{"id":"custom","type":"circle","source":"custom"}]}"""
            )
        val activity = show(style, camera(0.0, 0.0, 3.0))
        val receipt = JSONObject().put("check", "custom-scheme")
        try {
            assertTrue(activity.styleLoaded.await(30, TimeUnit.SECONDS))
            val idle = activity.awaitIdle(0, 15_000)
            receipt
                .put("idleWithin15s", idle)
                .put("failures", JSONArray(activity.failures))
                .put("requests", requests())
                .put("logs", JSONArray(logs.filter(::relevant)))
            write("custom-scheme", receipt)
        } finally {
            finish(activity)
        }
        assertTrue(EngineTransport.records.any { it.address == "tileflow://resource/data.json" })
    }

    /** Sprite and glyph suffixes with a query, and how the engine escapes a font stack. */
    @Test
    public fun suffixesGoBeforeTheQuery() {
        requireFixture()
        val loader = ResourceLoader(ResourcePolicy(setOf(ORIGIN), allowsLoopbackHttp = true))
        val engineContext = EngineTransport.register(loader)
        val style =
            JSONObject(
                """{"version":8,"sprite":"$ORIGIN/sprites/fixture/sprite?release=1","glyphs":"$ORIGIN/fonts/{fontstack}/{range}.pbf?release=1","sources":{"point":{"type":"geojson","data":{"type":"Point","coordinates":[0,0]}}},"layers":[{"id":"background","type":"background","paint":{"background-color":"#ffffff"}},{"id":"label","type":"symbol","source":"point","layout":{"text-field":"A","text-font":["Fixture Sans","Bold"]}}]}"""
            )
        val receipt = JSONObject().put("check", "suffixes")
        try {
            val projected = EngineStyleProjection.project(style, "$ORIGIN/style.json", engineContext, { null })
            val activity = show(projected.style, camera(0.0, 0.0, 3.0))
            try {
                assertTrue(activity.styleLoaded.await(30, TimeUnit.SECONDS))
                activity.awaitIdle(0, 15_000)
            } finally {
                finish(activity)
            }
        } finally {
            EngineTransport.retire(engineContext)
            loader.close()
        }
        receipt.put("requests", requests())
        write("suffixes", receipt)
    }

    // Raster-dem offline: an absent tile answered 204 draws its stored parent.

    @Test
    public fun bathymetryDemDrawsItsStoredParentOffline() {
        val receipt = demCase("dem-parent-stored", zooms = 8..9, stored = demParents)
        assertTrue("The parent was drawn: $receipt", receipt.getJSONObject("z10.5").getDouble("reliefShare") > 0.9)
    }

    /**
     * The fixture's download shape: the DEM's zooms are [9, 9] because the download starts at z10,
     * so a z9 tile the archive does not store has no stored parent.
     */
    @Test
    public fun bathymetryDemWithoutAStoredParentLeavesAHole() {
        demCase("dem-no-parent", zooms = 9..9, stored = emptyList())
    }

    // Drawing: a map on this device draws the pixels its style asks for.

    @Test
    public fun mapViewDrawsTheExpectedPixels() {
        val style =
            JSONObject()
                .put("version", 8)
                .put(
                    "sources",
                    JSONObject()
                        .put(
                            "square",
                            JSONObject()
                                .put("type", "geojson")
                                .put(
                                    "data",
                                    JSONObject(
                                        """{"type":"Polygon","coordinates":[[[-0.01,-0.01],[0.01,-0.01],[0.01,0.01],[-0.01,0.01],[-0.01,-0.01]]]}"""
                                    ),
                                ),
                        ),
                )
                .put(
                    "layers",
                    JSONArray()
                        .put(JSONObject("""{"id":"background","type":"background","paint":{"background-color":"#1f77b4"}}"""))
                        .put(JSONObject("""{"id":"square","type":"fill","source":"square","paint":{"fill-color":"#ff7f0e"}}""")),
                )
        val activity = show(style, camera(0.0, 0.0, 14.0))
        val receipt = JSONObject().put("check", "drawing")
        try {
            val bitmap = assertNotNull(draw(activity, "drawing", receipt = receipt))
            val center = bitmap.getPixel(bitmap.width / 2, bitmap.height / 2)
            val corner = bitmap.getPixel(4, 4)
            receipt
                .put("center", hex(center))
                .put("corner", hex(corner))
                .put("squareShare", share(bitmap, 0xff7f0e))
                .put("backgroundShare", share(bitmap, 0x1f77b4))
            write("drawing", receipt)
            assertTrue("Center ${hex(center)}", close(center, 0xff7f0e))
            assertTrue("Corner ${hex(corner)}", close(corner, 0x1f77b4))
        } finally {
            finish(activity)
        }
    }

    // Pitch: Android's engine stops at 60 degrees.

    @Test
    public fun pitchStopsAtTheEngineMaximum() {
        val style = JSONObject("""{"version":8,"sources":{},"layers":[{"id":"background","type":"background","paint":{"background-color":"#dddddd"}}]}""")
        val activity = show(style, camera(-3.7, 40.42, 15.0))
        val receipt = JSONObject().put("check", "pitch")
        try {
            assertTrue(activity.styleLoaded.await(30, TimeUnit.SECONDS))
            EngineTransport.onMain {
                val map = activity.map!!
                receipt.put("defaultMaxPitch", map.maxPitch)
                map.moveCamera(CameraUpdateFactory.tiltTo(85.0))
                receipt.put("tiltAfterAsking85", map.cameraPosition.tilt)
                map.setMaxPitchPreference(85.0)
                receipt.put("maxPitchAfterPreference85", map.maxPitch)
                map.cameraPosition = CameraPosition.Builder(map.cameraPosition).tilt(85.0).build()
                receipt.put("tiltAfterPreference85", map.cameraPosition.tilt)
                map.moveCamera(CameraUpdateFactory.tiltTo(60.0))
                receipt.put("tiltAfterAsking60", map.cameraPosition.tilt)
            }
            receipt.put("logs", JSONArray(logs.filter { it.contains("itch", ignoreCase = true) }))
            write("pitch", receipt)
        } finally {
            finish(activity)
        }
        assertEquals(60.0, receipt.getDouble("tiltAfterAsking85"), 0.01)
        assertEquals(60.0, receipt.getDouble("maxPitchAfterPreference85"), 0.01)
    }

    // The native style family: every Streets theme loads with its font faces.

    @Test
    public fun streetsNativeThemesLoadWithTheirFontFaces() {
        requireFixture("$ORIGIN/native-artifacts/manifest.json")
        val manifest = JSONObject(String(fetch("$ORIGIN/native-artifacts/manifest.json")))
        val themes = manifest.getJSONObject("maps").getJSONObject("streets").getJSONObject("themes")
        val loader =
            ResourceLoader(
                ResourcePolicy(setOf(ORIGIN), allowsLoopbackHttp = true),
                maximumBytes = 32 * 1024 * 1024,
            )
        val engineContext = EngineTransport.register(loader)
        val receipt = JSONObject().put("check", "streets-native")
        val results = JSONObject()
        try {
            for (theme in themes.keys().asSequence().sorted()) {
                EngineTransport.records.clear()
                logs.clear()
                val styleUrl = "$ORIGIN/native-artifacts/styles/streets/$theme.json"
                val style = JSONObject(String(loader.load(URI(styleUrl)).bytes))
                val declared =
                    JSONObject()
                        .put("glyphs", style.opt("glyphs") ?: JSONObject.NULL)
                        .put("fontFaces", style.optJSONObject("font-faces")?.length() ?: 0)
                        .put("state", style.has("state"))
                        .put("globalStateUses", style.toString().split("\"global-state\"").size - 1)
                        .put("layers", style.getJSONArray("layers").length())
                // A probe label in a font face, its colour chosen by global state.
                style.put("state", JSONObject("""{"tfProbe":{"default":true}}"""))
                style.getJSONObject("sources").put(
                    "tf-probe",
                    JSONObject(
                        """{"type":"geojson","data":{"type":"Point","coordinates":[-3.7,40.4185]}}"""
                    ),
                )
                // Streets' label stack: Greek is missing from DINish and falls back to Noto Sans.
                style.getJSONObject("sources").put(
                    "tf-probe-stack",
                    JSONObject(
                        """{"type":"geojson","data":{"type":"Point","coordinates":[-3.7,40.4215]}}"""
                    ),
                )
                style.getJSONArray("layers").put(
                    JSONObject(
                        """{"id":"tf-probe-stack","type":"symbol","source":"tf-probe-stack","layout":{"text-field":"Madrid Ωμέγα","text-font":["DINish Medium","Noto Sans Regular"],"text-size":40,"text-allow-overlap":true,"text-ignore-placement":true},"paint":{"text-color":"#00c000"}}"""
                    )
                )
                style.getJSONArray("layers").put(
                    JSONObject(
                        """{"id":"tf-probe","type":"symbol","source":"tf-probe","layout":{"text-field":"TILEFLOW","text-font":["Noto Sans Bold"],"text-size":40,"text-allow-overlap":true,"text-ignore-placement":true},"paint":{"text-color":["case",["global-state","tfProbe"],"#ff0000","#0000ff"]}}"""
                    )
                )
                val projected =
                    EngineStyleProjection.project(
                        style,
                        styleUrl,
                        engineContext,
                        { url -> loader.load(url).takeIf { it.status == 200 }?.bytes },
                    ) { id, source ->
                        when (id) {
                            // World tiles come from the fixture's building tiles.
                            "tileflow" ->
                                JSONObject()
                                    .put("type", "vector")
                                    .put("tiles", JSONArray().put("$ORIGIN/city/{z}/{x}/{y}.mvt"))
                                    .put("minzoom", 13)
                                    .put("maxzoom", 15)
                            // Third-party elevation stays off the network in this check.
                            "tileflow-terrain" -> null
                            else -> source
                        }
                    }
                val activity = show(projected.style, camera(-3.7, 40.42, 16.0))
                val result =
                    JSONObject()
                        .put("declared", declared)
                        .put("dropped", JSONArray(projected.droppedSources))
                        .put("projectedLayers", projected.style.getJSONArray("layers").length())
                try {
                    val bitmap = draw(activity, "streets-$theme", receipt = result)
                    result.put("probeRed", bitmap?.let { share(it, 0xff0000, 60) } ?: 0.0)
                    result.put("stackGreen", bitmap?.let { share(it, 0x00c000, 60) } ?: 0.0)
                    // Global state written at runtime changes what is drawn.
                    val idle = activity.idleCount.get()
                    EngineTransport.onMain {
                        activity.map!!.style!!.setGlobalStateProperty("tfProbe", JsonPrimitive(false))
                    }
                    activity.awaitIdle(idle, 10_000)
                    Thread.sleep(500)
                    val after = activity.snapshot()
                    after?.let { save(it, "streets-$theme-state") }
                    result.put("probeRedAfterState", after?.let { share(it, 0xff0000, 60) } ?: 0.0)
                    result.put("probeBlueAfterState", after?.let { share(it, 0x0000ff, 60) } ?: 0.0)
                    EngineTransport.onMain {
                        result.put("globalState", activity.map!!.style!!.globalState.toString())
                    }
                    result.put("features", features(activity, "tf-probe"))
                    result.put("distinctColours", after?.let(::distinct) ?: 0)
                    result.put(
                        "renderedLayers",
                        JSONArray().also { rendered ->
                            EngineTransport.onMain {
                                val map = activity.map!!
                                for (layer in projected.style.getJSONArray("layers").let { layers -> (0 until layers.length()).map { layers.getJSONObject(it).getString("id") } }) {
                                    if (map.queryRenderedFeatures(
                                            android.graphics.RectF(0f, 0f, activity.mapView.width.toFloat(), activity.mapView.height.toFloat()),
                                            layer,
                                        ).isNotEmpty()
                                    ) rendered.put(layer)
                                }
                            }
                        },
                    )
                } finally {
                    finish(activity)
                }
                val records = EngineTransport.records.toList()
                result.put(
                    "fonts",
                    JSONArray(
                        records
                            .filter { it.remote?.contains(".ttf") == true }
                            .map { "${it.remote!!.substringAfterLast('/').take(24)} ${it.status}" }
                    ),
                )
                result.put("sprites", JSONArray(records.filter { it.remote?.contains("/icons/") == true }.map { "${it.remote!!.substringAfterLast('/')} ${it.status}" }))
                result.put("delegated", records.count { it.delegated })
                result.put("failedRequests", JSONArray(records.filter { it.status != 200 && it.status != 204 }.map { "${it.remote} ${it.status} ${it.error}" }))
                result.put("logs", JSONArray(logs.filter(::relevant).distinct().take(40)))
                results.put(theme, result)
            }
        } finally {
            EngineTransport.retire(engineContext)
            loader.close()
        }
        receipt.put("themes", results)
        write("streets-native", receipt)
        for (theme in results.keys()) {
            val result = results.getJSONObject(theme)
            assertTrue("$theme: ${result.optJSONArray("failures")}", result.getJSONObject("render").getBoolean("styleLoaded"))
            assertEquals("$theme delegated", 0, result.getInt("delegated"))
        }
    }

    /**
     * A face declared with the Unicode ranges its file covers lets the next face of a `text-font`
     * stack draw the rest: the light theme with DINish Medium limited to Latin.
     */
    @Test
    public fun fontFaceRangesFallBackAlongTheStack() {
        requireFixture("$ORIGIN/native-artifacts/manifest.json")
        val loader = ResourceLoader(ResourcePolicy(setOf(ORIGIN), allowsLoopbackHttp = true))
        val engineContext = EngineTransport.register(loader)
        val receipt = JSONObject().put("check", "font-face-ranges")
        try {
            for (ranged in listOf(false, true)) {
                EngineTransport.records.clear()
                val styleUrl = "$ORIGIN/native-artifacts/styles/streets/light.json"
                val style = JSONObject(String(loader.load(URI(styleUrl)).bytes))
                val faces = style.getJSONObject("font-faces")
                if (ranged)
                    faces.put(
                        "DINish Medium",
                        JSONArray().put(
                            JSONObject()
                                .put("url", faces.getString("DINish Medium"))
                                .put("unicode-range", JSONArray(listOf("U+0000-024F", "U+2000-206F")))
                        ),
                    )
                style.put("layers", JSONArray().put(JSONObject("""{"id":"background","type":"background","paint":{"background-color":"#ffffff"}}""")))
                style.put("sources", JSONObject().put("probe", JSONObject("""{"type":"geojson","data":{"type":"Point","coordinates":[-3.7,40.42]}}""")))
                style.getJSONArray("layers").put(
                    JSONObject(
                        """{"id":"probe","type":"symbol","source":"probe","layout":{"text-field":"Madrid Ωμέγα","text-font":["DINish Medium","Noto Sans Regular"],"text-size":40,"text-allow-overlap":true},"paint":{"text-color":"#00c000"}}"""
                    )
                )
                val projected =
                    EngineStyleProjection.project(style, styleUrl, engineContext, { url ->
                        loader.load(url).takeIf { it.status == 200 }?.bytes
                    })
                val activity = show(projected.style, camera(-3.7, 40.42, 16.0))
                val result = JSONObject().put("fontFaces", projected.style.getJSONObject("font-faces").toString().replace(Regex("https://tileflow\\.invalid/[^\"]*/fonts/"), ".../fonts/"))
                try {
                    val bitmap = draw(activity, if (ranged) "font-face-ranges" else "font-face-whole", receipt = result)
                    result.put("textShare", bitmap?.let { share(it, 0x00c000, 60) } ?: 0.0)
                } finally {
                    finish(activity)
                }
                result.put(
                    "fonts",
                    JSONArray(EngineTransport.records.filter { it.remote?.contains(".ttf") == true }.map { "${it.remote!!.substringAfterLast('/').take(24)} ${it.status}" }),
                )
                receipt.put(if (ranged) "ranged" else "whole", result)
            }
        } finally {
            EngineTransport.retire(engineContext)
            loader.close()
        }
        write("font-face-ranges", receipt)
    }

    // Helpers.

    private class Hosted(val loader: ResourceLoader, val session: HostedSession) {
        fun read(url: URI): ByteArray? = loader.load(url).takeIf { it.status == 200 }?.bytes

        fun close() {
            loader.close()
            session.close()
        }
    }

    private fun configuration() =
        TileflowConfiguration(
            apiOrigin = URI(ORIGIN),
            mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)),
        )

    /** The loader a map view builds for a Hosted map. */
    private fun hostedLoader(configuration: TileflowConfiguration): Hosted {
        val loadable =
            TileflowMapSource.hosted(MAP_ID, configuration = configuration).loadable { configuration }
        val endpoint = loadable.hosted!!
        val session = HostedSession(endpoint, loadable.mapId!!, loadable.surfaceId!!)
        val loader =
            ResourceLoader(
                loadable.policy,
                hosted = session,
                apiOrigin = endpoint.apiOrigin,
                publicMetadataUrls = loadable.publicMetadataUrls,
                cache = TileflowMapCache.get(context).store,
                grantScope = loadable.grantScope,
                offline = OfflineServingIndex.shared(context),
                reachable = { OfflineReachability.isReachable(context) },
            )
        return Hosted(loader, session)
    }

    /** Discovery, profile manifest and the default theme's style, through the loader. */
    private fun hostedStyle(loader: ResourceLoader, theme: String = "day"): Pair<String, JSONObject> {
        fun json(url: String) = JSONObject(String(loader.load(URI(url)).also { check(it.status == 200) { "$url ${it.status}" } }.bytes))
        val discovery = json("$ORIGIN/maps/$MAP_ID/mobile/manifest.json")
        val representations = discovery.getJSONObject("representations")
        val profile =
            json(
                (representations.optJSONObject("native-v1") ?: representations.getJSONObject("webview-v1"))
                    .getString("manifestUrl")
            )
        val styleUrl =
            profile.getJSONObject("maps").getJSONObject("map").getJSONObject("themes")
                .getJSONObject(theme).getString("styleUrl")
        return styleUrl to json(styleUrl)
    }

    private val demTemplate =
        "https://api.tileflow.test/tiles/bathymetry/dem/bathymetry-v1-20261021-fixture/{z}/{x}/{y}.webp?map=map_offlinefixture00"
    private val demAnchor = OfflineTileId(7, 62, 48)
    private val demParents = listOf(OfflineTileId(8, 124, 96), OfflineTileId(8, 125, 96), OfflineTileId(8, 124, 97), OfflineTileId(8, 125, 97))

    /**
     * Opens the marine fixture's release 1 offline, with the network switched off: its style pack's
     * documents, and a Bathymetry DEM tile pack under the Madrid anchor holding [stored] (real
     * lossless WebP, Terrarium encoded) for a download whose DEM zooms are [zooms]. The camera is
     * over z9 tile 9/250/193, which the pack does not store.
     */
    private fun demCase(name: String, zooms: IntRange, stored: List<OfflineTileId>): JSONObject {
        val fixture = File(root, "marine-release-1-style.tfpack")
        fixture.writeBytes(shellBytes("cat /data/local/tmp/tileflow-native-engine/marine-release-1-style.tfpack"))
        assumeTrue("Push the marine fixture's release-1 style pack", fixture.length() > 64)
        val documents = OfflinePackFormat.index(fixture).entries.values.associate { it.name to (fixture to it) }
        val tilePack = File(root, "bathymetry-dem.tfpack")
        tilePack.writeBytes(pack(stored.map { it.name to demTile(it) }))
        val api = URI("https://api.tileflow.test")
        val mapId = "map_offlinefixture00"
        val grantScope = ResourceCacheScope.grant(api, mapId)
        val index = OfflineServingIndex()
        index.publish(
            OfflineServingSnapshot(
                packs =
                    mapOf(
                        grantScope.directory to
                            OfflineServedPacks(
                                documents,
                                mapOf(
                                    demTemplate to
                                        OfflineServedTiles(
                                            OfflineTileTemplate.of(demTemplate)!!,
                                            zooms,
                                            204,
                                            listOf(OfflineCover(zooms.first, zooms.last, listOf(OfflineCover.Entry(demAnchor, null)))),
                                            mapOf(demAnchor to listOf(tilePack)),
                                        )
                                ),
                            )
                    )
            ),
            this,
        )
        val configuration =
            TileflowConfiguration(apiOrigin = api, mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)))
        val session = HostedSession(HostedEndpoint(configuration), mapId, "mobile-map")
        val loader =
            ResourceLoader(
                ResourcePolicy(setOf("https://api.tileflow.test")),
                hosted = session,
                apiOrigin = api,
                cache = TileflowMapCache.get(context).store,
                grantScope = grantScope,
                offline = index,
                networkEnabled = { false },
            )
        val engineContext = EngineTransport.register(loader)
        val receipt = JSONObject().put("check", name).put("packZooms", "${zooms.first}-${zooms.last}")
            .put("storedTiles", JSONArray(stored.map { it.name }))
        try {
            val styleUrl = "https://api.tileflow.test/maps/map_offlinefixture00/mobile/webview-v1/v1/default.json"
            val fixtureStyle = JSONObject(String(loader.load(URI(styleUrl)).bytes))
            val depths = fixtureStyle.getJSONObject("sources").getJSONObject("depths")
            // Core's Bathymetry DEM source: Terrarium, 512-pixel tiles.
            depths.put("encoding", "terrarium").put("tileSize", 512)
            val style =
                JSONObject()
                    .put("version", 8)
                    .put("sources", JSONObject().put("depths", depths))
                    .put(
                        "layers",
                        JSONArray()
                            .put(JSONObject("""{"id":"background","type":"background","paint":{"background-color":"#ffffff"}}"""))
                            .put(
                                JSONObject(
                                    """{"id":"relief","type":"color-relief","source":"depths","paint":{"color-relief-color":["interpolate",["linear"],["elevation"],-4000,"#08306b",-500,"#6baed6",0,"#c6dbef"]}}"""
                                )
                            ),
                    )
            val projected =
                EngineStyleProjection.project(style, styleUrl, engineContext, { url ->
                    loader.load(url).takeIf { it.status == 200 }?.bytes
                })
            receipt.put("projectedStyle", projected.style)
            // The centre of z9 tile 9/250/193, inside the Madrid anchor.
            val longitude = (250.5 / 512) * 360 - 180
            val latitude = Math.toDegrees(atan(sinh(PI * (1 - 2 * 193.5 / 512))))
            for (zoom in listOf(9.5, 10.5)) {
                EngineTransport.records.clear()
                logs.clear()
                val activity = show(projected.style, camera(longitude, latitude, zoom))
                val result = JSONObject()
                try {
                    val bitmap = draw(activity, "$name-z$zoom", receipt = result)
                    result.put("reliefShare", bitmap?.let(::reliefShare) ?: 0.0)
                    result.put("backgroundShare", bitmap?.let { share(it, 0xffffff, 6) } ?: 0.0)
                } finally {
                    finish(activity)
                }
                result.put(
                    "tiles",
                    JSONArray(
                        EngineTransport.records.toList()
                            .filter { it.remote?.contains("/dem/") == true }
                            .map {
                                val tile = Regex("/(\\d+)/(\\d+)/(\\d+)\\.webp").find(it.remote!!)!!.groupValues
                                "${tile[1]}/${tile[2]}/${tile[3]} ${it.status ?: it.error}"
                            }
                            .sorted()
                            .distinct()
                    ),
                )
                result.put("logs", JSONArray(logs.filter(::relevant).distinct().take(30)))
                receipt.put("z$zoom", result)
            }
        } finally {
            EngineTransport.retire(engineContext)
            loader.close()
            session.close()
        }
        write(name, receipt)
        return receipt
    }

    /** A 512-pixel Terrarium tile of depths from -3,500 m (west) to -1,000 m (east). */
    private fun demTile(tile: OfflineTileId): ByteArray {
        val size = 512
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val pixels = IntArray(size * size)
        for (y in 0 until size) for (x in 0 until size) {
            val elevation = -3500.0 + 2500.0 * x / (size - 1) + 200.0 * ((tile.x + tile.y) % 2)
            val value = elevation + 32768.0
            val red = (value / 256).toInt()
            val green = (value - red * 256).toInt()
            val blue = ((value - red * 256 - green) * 256).toInt()
            pixels[y * size + x] = Color.argb(255, red, green, blue)
        }
        bitmap.setPixels(pixels, 0, size, 0, 0, size, size)
        return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.WEBP_LOSSLESS, 100, it) }.toByteArray()
    }

    /** A tiles pack in format 2 (`TFPK` version 1) holding [entries] by name. */
    private fun pack(entries: List<Pair<String, ByteArray>>): ByteArray {
        val index = ByteArrayOutputStream()
        var offset = 0L
        for ((name, body) in entries) {
            val nameBytes = name.toByteArray()
            val type = "image/webp".toByteArray()
            val record = ByteBuffer.allocate(2 + nameBytes.size + 1 + type.size + 1 + 12).order(ByteOrder.LITTLE_ENDIAN)
            record.putShort(nameBytes.size.toShort()).put(nameBytes).put(type.size.toByte()).put(type).put(0.toByte())
            record.putLong(offset).putInt(body.size)
            index.write(record.array())
            offset += body.size
        }
        val indexBytes = index.toByteArray()
        val header = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN)
        header.put("TFPK".toByteArray()).putShort(1.toShort()).put(1.toByte()).put(0.toByte()).putInt(entries.size).putInt(indexBytes.size).putLong(offset).putLong(0)
        val content = ByteArrayOutputStream()
        content.write(header.array())
        content.write(indexBytes)
        for ((_, body) in entries) content.write(body)
        val bytes = content.toByteArray()
        return bytes + MessageDigest.getInstance("SHA-256").digest(bytes)
    }

    private fun reliefShare(bitmap: Bitmap): Double {
        var count = 0
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        for (pixel in pixels) if (Color.blue(pixel) - Color.red(pixel) > 40) count++
        return count.toDouble() / pixels.size
    }

    private fun camera(longitude: Double, latitude: Double, zoom: Double, tilt: Double = 0.0) =
        CameraPosition.Builder().target(LatLng(latitude, longitude)).zoom(zoom).tilt(tilt).build()

    private fun show(style: JSONObject, camera: CameraPosition): EngineHostActivity {
        EngineHostActivity.style = style.toString()
        EngineHostActivity.camera = camera
        val intent =
            Intent(instrumentation.context, EngineHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return instrumentation.startActivitySync(intent) as EngineHostActivity
    }

    private fun finish(activity: EngineHostActivity) {
        instrumentation.runOnMainSync { activity.finish() }
        Thread.sleep(500)
    }

    /** Waits for the style and the first idle frame, then keeps the engine's own picture. */
    private fun draw(
        activity: EngineHostActivity,
        name: String,
        waitIdle: Boolean = true,
        receipt: JSONObject = JSONObject(),
    ): Bitmap? {
        val started = System.currentTimeMillis()
        val loaded = activity.styleLoaded.await(30, TimeUnit.SECONDS)
        val idle = if (waitIdle) activity.awaitIdle(0, 30_000) else true
        receipt.put(
            "render",
            JSONObject()
                .put("styleLoaded", loaded)
                .put("idle", idle)
                .put("millis", System.currentTimeMillis() - started)
                .put("fullyRendered", activity.fullyRendered.get())
                .put("failures", JSONArray(activity.failures)),
        )
        val bitmap = activity.snapshot()
        receipt.getJSONObject("render").put("picture", bitmap?.let { save(it, name) } ?: JSONObject.NULL)
        return bitmap
    }

    private fun picture(activity: EngineHostActivity, name: String): Any =
        activity.snapshot()?.let { bitmap ->
            JSONObject().put("file", save(bitmap, name)).put("distinctColours", distinct(bitmap))
        } ?: JSONObject.NULL

    /** The Hosted fixture's drawing: shares of its ground, buildings, markers and labels. */
    private fun drawHosted(activity: EngineHostActivity, name: String, waitIdle: Boolean = true): JSONObject {
        val receipt = JSONObject()
        val bitmap = draw(activity, name, waitIdle, receipt)
        bitmap?.let {
            receipt.put("buildingShare", share(it, 0xd6ccb8))
            receipt.put("groundShare", share(it, 0xece6da))
            receipt.put("markerShare", share(it, 0xe0218a))
            receipt.put("labelShare", share(it, 0x1d3c8f, 40))
        }
        return receipt
    }

    private fun features(activity: EngineHostActivity, vararg layers: String): JSONObject {
        val result = JSONObject()
        EngineTransport.onMain {
            val map = activity.map!!
            for (layer in layers) {
                val found = map.queryRenderedFeatures(
                    android.graphics.RectF(0f, 0f, activity.mapView.width.toFloat(), activity.mapView.height.toFloat()),
                    layer,
                )
                result.put(layer, JSONObject().put("count", found.size))
            }
        }
        return result
    }

    private fun requests(): JSONArray =
        JSONArray(
            EngineTransport.records.toList().map { record ->
                JSONObject()
                    .put("remote", record.remote ?: JSONObject.NULL)
                    .put("address", record.address.replace(Regex("^(https://tileflow\\.invalid/)[0-9a-f]{16}/"), "$1<context>/"))
                    .put("status", record.status ?: JSONObject.NULL)
                    .put("delegated", record.delegated)
                    .put("range", record.range)
                    .put("error", record.error ?: JSONObject.NULL)
                    .put("millis", record.elapsedMillis)
            }
        )

    /** Rows MapLibre stored in its database, and whether any grant reached it. */
    private fun engineDatabase(): JSONObject {
        val file = File(FileSource.getResourcesCachePath(context), "mbgl-offline.db")
        val result = JSONObject().put("exists", file.exists()).put("bytes", file.length())
        if (!file.exists()) return result.put("rows", 0)
        var rows = 0
        SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { database ->
            for (table in listOf("resources", "tiles")) {
                database.rawQuery("SELECT COUNT(*) FROM $table", null).use {
                    it.moveToFirst()
                    result.put(table, it.getInt(0))
                    rows += it.getInt(0)
                }
            }
        }
        val bytes = file.readBytes() + (File(file.path + "-wal").takeIf { it.exists() }?.readBytes() ?: ByteArray(0))
        result.put("containsGrant", String(bytes, Charsets.ISO_8859_1).contains("tf_native_v1"))
        return result.put("rows", rows)
    }

    private fun save(bitmap: Bitmap, name: String): String {
        val file = File(output, "$name.png")
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return file.name
    }

    private fun write(name: String, receipt: JSONObject) {
        receipt
            .put("date", Instant.now().toString())
            .put("engine", "org.maplibre.gl:android-sdk-opengl:13.7.1")
            .put("device", "${Build.MANUFACTURER} ${Build.MODEL} API ${Build.VERSION.SDK_INT} ${Build.SUPPORTED_ABIS.first()}")
            .put("fingerprint", Build.FINGERPRINT)
        File(output, "$name.json").writeText(receipt.toString(2))
    }

    private fun share(bitmap: Bitmap, rgb: Int, tolerance: Int = 12): Double {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return pixels.count { close(it, rgb, tolerance) }.toDouble() / pixels.size
    }

    private fun distinct(bitmap: Bitmap): Int {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return pixels.toSet().size
    }

    private fun close(pixel: Int, rgb: Int, tolerance: Int = 12): Boolean =
        kotlin.math.abs(Color.red(pixel) - (rgb shr 16 and 255)) <= tolerance &&
            kotlin.math.abs(Color.green(pixel) - (rgb shr 8 and 255)) <= tolerance &&
            kotlin.math.abs(Color.blue(pixel) - (rgb and 255)) <= tolerance

    private fun hex(pixel: Int) = "#%06x".format(pixel and 0xffffff)

    private fun <T> assertNotNull(value: T?): T {
        assertTrue(value != null)
        return value!!
    }

    private fun relevant(line: String): Boolean =
        !line.startsWith("V/") && !line.startsWith("D/")

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

    private fun download(store: TileflowOfflineStore, id: String, options: TileflowOfflineRegionLoadOptions) =
        runBlocking {
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

    private fun fetch(url: String): ByteArray =
        (URL(url).openConnection() as HttpURLConnection).inputStream.use { it.readBytes() }

    /** The fixture's Hosted counters, read directly, never through the transport. */
    private fun counters(reset: Boolean = false): JSONObject {
        val connection = URL("$ORIGIN/__fixture/hosted").openConnection() as HttpURLConnection
        connection.requestMethod = if (reset) "POST" else "GET"
        return connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
    }

    private fun requireFixture(url: String = "$ORIGIN/maps/$MAP_ID/mobile/manifest.json") {
        val reachable =
            runCatching { (URL(url).openConnection() as HttpURLConnection).responseCode == 200 }
                .getOrDefault(false)
        assumeTrue("Start the fixture server on $ORIGIN and adb reverse its port", reachable)
    }

    private fun shellBytes(command: String): ByteArray =
        ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(command))
            .use { it.readBytes() }

    private fun shell(command: String): String = String(shellBytes(command))

    private fun waitFor(timeoutMillis: Long, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (!condition() && System.currentTimeMillis() < deadline) Thread.sleep(100)
        assertTrue("Timed out", condition())
    }

    private class CapturingLogger(private val lines: MutableList<String>) : LoggerDefinition {
        private fun add(level: String, tag: String?, message: String?) {
            lines.add("$level/$tag: $message")
            android.util.Log.println(
                when (level) {
                    "E" -> android.util.Log.ERROR
                    "W" -> android.util.Log.WARN
                    "I" -> android.util.Log.INFO
                    else -> android.util.Log.DEBUG
                },
                tag ?: "Mbgl",
                message ?: "",
            )
        }

        override fun v(tag: String?, msg: String?) = add("V", tag, msg)

        override fun v(tag: String?, msg: String?, tr: Throwable?) = add("V", tag, "$msg $tr")

        override fun d(tag: String?, msg: String?) = add("D", tag, msg)

        override fun d(tag: String?, msg: String?, tr: Throwable?) = add("D", tag, "$msg $tr")

        override fun i(tag: String?, msg: String?) = add("I", tag, msg)

        override fun i(tag: String?, msg: String?, tr: Throwable?) = add("I", tag, "$msg $tr")

        override fun w(tag: String?, msg: String?) = add("W", tag, msg)

        override fun w(tag: String?, msg: String?, tr: Throwable?) = add("W", tag, "$msg $tr")

        override fun e(tag: String?, msg: String?) = add("E", tag, msg)

        override fun e(tag: String?, msg: String?, tr: Throwable?) = add("E", tag, "$msg $tr")
    }

    private companion object {
        const val ORIGIN = "http://127.0.0.1:18682"
        const val MAP_ID = "map_offlinefixture01"
    }
}
