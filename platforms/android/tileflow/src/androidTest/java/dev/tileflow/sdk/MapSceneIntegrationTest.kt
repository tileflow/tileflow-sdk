package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.offline.TileflowOfflineSwitch
import java.io.File
import java.net.URI
import java.time.Instant
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.light.Position
import org.maplibre.android.style.sources.VectorSource

/** Shows one fixture map, named by the `map` extra, in the view mode of the `viewMode` extra. */
public class SceneHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loads = CopyOnWriteArrayList<Long>()
    val loaded = CountDownLatch(1)
    val events = CopyOnWriteArrayList<TileflowMapEvent>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val name = intent.getStringExtra("map") ?: "fixture"
        val port = intent.getIntExtra("fixturePort", 18645)
        val origin = "http://127.0.0.1:$port"
        val mode =
            if (intent.getStringExtra("viewMode") == "3d") TileflowViewMode.THREE_DIMENSIONAL
            else TileflowViewMode.FLAT
        map =
            TileflowMapView(this).apply {
                onEvent = {
                    events.add(it)
                    if (it == TileflowMapEvent.ContentReady) {
                        loads.add(System.nanoTime())
                        loaded.countDown()
                    }
                }
                runBlocking { setOptions(TileflowMapOptions(viewMode = mode)) }
                setSource(
                    TileflowMapSource(
                        map = name,
                        manifestUrl =
                            URI(
                                if (name == "appearance") "$origin/native/manifest.json"
                                else "$origin/manifest.json"
                            ),
                        allowsLoopbackHttp = true,
                    )
                )
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }
}

/**
 * The parts of a Tileflow map beyond its theme, rendered by the embedded renderer: notices, the
 * declared 3D scene, the sun, emphasis, style states, Boundaries values, images, depth markers,
 * route inks, line progress and camera shots. Run with the online fixture server and `adb reverse
 * tcp:18645 tcp:<port>`. Screenshots land in the test app's external files.
 */
@RunWith(AndroidJUnit4::class)
public class MapSceneIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun show(map: String, viewMode: String = "2d"): SceneHostActivity {
        val intent =
            Intent(instrumentation.context, SceneHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("map", map)
                .putExtra("viewMode", viewMode)
                .putExtra(
                    "fixturePort",
                    InstrumentationRegistry.getArguments().getString("tileflowFixturePort")?.toInt()
                        ?: 18645,
                )
        val activity = instrumentation.startActivitySync(intent) as SceneHostActivity
        assertTrue("The $map map did not load.", activity.loaded.await(30, TimeUnit.SECONDS))
        return activity
    }

    private suspend fun awaitBoundaryState(expected: Double?, actual: () -> Double?) {
        repeat(100) {
            if (actual() == expected) return
            delay(50)
        }
        assertEquals("Rendered boundary state", expected, actual())
    }

    private fun failures(activity: SceneHostActivity) =
        activity.events.filterIsInstance<TileflowMapEvent.Failed>()

    private fun capture(name: String) {
        val file = File(instrumentation.context.getExternalFilesDir(null), "$name.png")
        instrumentation.uiAutomation.takeScreenshot()?.let { screenshot ->
            file.outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
        }
        println("Tileflow capture: ${file.absolutePath}")
    }

    @Test
    public fun aNauticalMapShowsItsNoticeOnTheMap() {
        val activity = show("nautical")
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    withTimeout(10_000) {
                        val engine = activity.map.readyEngine as NativeMapEngine
                        while ("Not for navigation" !in engine.attribution.model.notices) delay(100)
                    }
                    activity.map.setTheme("night")
                }
            }
            Thread.sleep(500)
            capture("tileflow-nautical-notice")
            assertTrue("Map errors: ${failures(activity)}", failures(activity).isEmpty())
        } finally {
            activity.finish()
        }
    }

    @Test
    public fun clearedStyleStateReadsTheActiveThemesDefault() {
        val activity = show("scene")
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val view = activity.map
                    fun state() =
                        requireNotNull((view.readyEngine as NativeMapEngine).map?.style).globalState
                    view.setStyleState("fixture-opacity", TileflowStyleValue.Number(0.2))
                    view.setStyleState("fixture-mode", TileflowStyleValue.Text("busy"))
                    assertEquals(0.2, state().get("fixture-opacity").asDouble, 0.001)
                    assertEquals("busy", state().get("fixture-mode").asString)
                    view.setStyleState("fixture-opacity", TileflowStyleValue.Number(0.8), 120)
                    assertEquals(0.8, state().get("fixture-opacity").asDouble, 0.001)
                    view.setStyleState("fixture-opacity", TileflowStyleValue.Null)
                    view.setStyleState("fixture-mode", TileflowStyleValue.Null)
                    assertEquals(1.0, state().get("fixture-opacity").asDouble, 0.001)
                    assertEquals("base", state().get("fixture-mode").asString)
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    public fun joinedBoundaryRowsColorRenderedDistricts() =
        checkBoundaryPixels("districts", "district-fill", joinRows = true)

    @Test
    public fun compiledBoundaryChoroplethColorsIntrinsicIds() =
        checkBoundaryPixels("appearance", "score-fill")

    private fun checkBoundaryPixels(name: String, layer: String, joinRows: Boolean = false) {
        val activity = show(name)
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val view = activity.map
                    val map = requireNotNull((view.readyEngine as NativeMapEngine).map)
                    val center = view.project(TileflowCoordinate(-3.7, 40.42))
                    suspend fun snapshot() =
                        suspendCancellableCoroutine<Bitmap> { done ->
                            map.snapshot { done.resume(it) }
                        }
                    var sample: android.graphics.Point? = null
                    withTimeout(12_000) {
                        while (sample == null) {
                            val image = snapshot()
                            for (dy in -100..100 step 10) {
                                for (dx in -100..100 step 10) {
                                    val x = center.x.toInt() + dx
                                    val y = center.y.toInt() + dy
                                    if (
                                        x !in 0 until image.width ||
                                            y !in 0 until image.height ||
                                            image.getPixel(x, y) != Color.GREEN
                                    )
                                        continue
                                    val hits =
                                        map.queryRenderedFeatures(
                                            android.graphics.PointF(x.toFloat(), y.toFloat()),
                                            layer,
                                        )
                                    if (hits.any { it.id() == "41" }) {
                                        sample = android.graphics.Point(x, y)
                                        break
                                    }
                                }
                                if (sample != null) break
                            }
                            if (sample == null) delay(50)
                        }
                    }
                    val point = requireNotNull(sample)
                    suspend fun checkColor(expected: Int) {
                        var last = Color.TRANSPARENT
                        repeat(150) {
                            last = snapshot().getPixel(point.x, point.y)
                            if (last == expected) return
                            delay(40)
                        }
                        assertEquals("Rendered pixel of district 41 in $layer", expected, last)
                    }
                    val joinInput = listOf(
                        TileflowBoundaryRow(TileflowBoundaryKey.Text(" q2807 "), TileflowBoundaryValue.Number(1.0)),
                    )
                    val joinOptions = JoinBoundaryRowsOptions(
                        TileflowBoundaryCode.WIKIDATA,
                        classes = setOf(TileflowBoundaryClass.MUNICIPALITY),
                    )
                    val values = if (joinRows) {
                        val result = view.joinBoundaryRows(joinInput, joinOptions)
                        assertEquals(TileflowBoundaryKey.Number(41.0), result.rows.single().key)
                        assertTrue(result.unmatched.isEmpty())
                        result.values(labels = true)
                    } else {
                        TileflowBoundaryValues.byIds(mapOf(41L to TileflowBoundaryValue.Number(1.0)), labels = true)
                    }
                    view.setBoundaryValues(values)
                    checkColor(Color.RED)
                    val source =
                        requireNotNull(map.style?.getSourceAs<VectorSource>("tileflow-boundaries"))
                    assertEquals(
                        1.0,
                        requireNotNull(source.getFeatureState("boundary_label", "41"))
                            .get("value")
                            .asDouble,
                        0.001,
                    )
                    view.setBoundaryValues(
                        TileflowBoundaryValues.byIds(
                            mapOf(41L to TileflowBoundaryValue.Number(2.0)),
                            labels = true,
                        )
                    )
                    checkColor(Color.BLUE)
                    view.setBoundaryValues(null)
                    checkColor(Color.GREEN)
                    if (joinRows) {
                        TileflowOfflineSwitch.isNetworkEnabled = false
                        try {
                            val error = runCatching {
                                view.joinBoundaryRows(joinInput, joinOptions)
                            }.exceptionOrNull() as? TileflowMapException
                            assertEquals(TileflowErrorCode.RESOURCE_FAILED, error?.code)
                            assertEquals("boundaryLookupOffline", error?.context?.reason)
                        } finally {
                            TileflowOfflineSwitch.isNetworkEnabled = true
                        }
                    }
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    public fun aDeclaredSceneRisesInThreeDimensions() {
        val activity = show("appearance", viewMode = "3d")
        try {
            // The buildings arrive as tiles the 3D renderer reads after the map loads.
            Thread.sleep(4_000)
            capture("tileflow-declared-3d-scene")
            runBlocking {
                withContext(Dispatchers.Main) {
                    activity.map.setViewMode(TileflowViewMode.FLAT)
                    activity.map.setViewMode(
                        TileflowViewMode.THREE_DIMENSIONAL,
                        durationMillis = 800,
                    )
                    assertEquals(TileflowViewMode.THREE_DIMENSIONAL, activity.map.options.viewMode)
                }
            }
            assertTrue("Map errors: ${failures(activity)}", failures(activity).isEmpty())
            val warnings = activity.events.filterIsInstance<TileflowMapEvent.Warning>()
            assertFalse(
                "The 3D scene failed: $warnings",
                warnings.any { it.context.reason == "scene" },
            )
        } finally {
            activity.finish()
        }
    }

    @Test
    public fun cameraShotBlendsThemesAndEndsWhenTheRendererIsReplaced() {
        val activity = show("appearance")
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val view = activity.map
                    val engine = view.readyEngine as NativeMapEngine
                    val start = TileflowCamera(-3.7, 40.42, 15.0)
                    val end = TileflowCamera(-3.69, 40.425, 14.0, bearing = 20.0, pitch = 30.0)
                    val cues = mutableListOf<String>()
                    val positions = mutableListOf<Double>()
                    val shot =
                        TileflowShot(
                            listOf(
                                TileflowShot.Keyframe(0, start, 0.0),
                                TileflowShot.Keyframe(800, end, 1.0),
                            ),
                            themes = listOf("light", "dark"),
                            cues =
                                listOf(
                                    TileflowShot.Cue(0, "start"),
                                    TileflowShot.Cue(400, "middle"),
                                    TileflowShot.Cue(800, "end"),
                                ),
                        )
                    assertTrue(
                        view.play(shot) { cue ->
                            cues += cue
                            positions += requireNotNull(engine.blend).position
                        }
                    )
                    assertEquals(listOf("start", "middle", "end"), cues)
                    assertEquals(0.0, positions.first(), 0.001)
                    assertTrue(
                        "Mid-shot blend should be between themes: $positions",
                        positions[1] > 0.0 && positions[1] < 1.0,
                    )
                    assertEquals(1.0, positions.last(), 0.001)
                    assertEquals(end.longitude, view.camera().longitude, 1e-6)
                    val long = async {
                        view.play(
                            TileflowShot(
                                listOf(
                                    TileflowShot.Keyframe(0, end),
                                    TileflowShot.Keyframe(60_000, start),
                                )
                            )
                        )
                    }
                    delay(120)
                    val loads = activity.loads.size
                    view.reload()
                    assertFalse("Reload must end the retired renderer's shot", long.await())
                    withTimeout(30_000) { while (activity.loads.size <= loads) delay(50) }
                    assertTrue(failures(activity).isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    public fun theSceneReachesTheRendererAndANewRendererReceivesItAgain() {
        val activity = show("appearance")
        val map = activity.map
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val engine = map.readyEngine as NativeMapEngine
                    fun style() = requireNotNull((map.readyEngine as? NativeMapEngine)?.map?.style)
                    val light = map.routeInks()
                    map.setTheme("dark")
                    withTimeout(10_000) {
                        while (
                            activity.events.none {
                                it is TileflowMapEvent.ThemeTransition &&
                                    it.transition.phase == TileflowThemeTransition.Phase.READY &&
                                    it.transition.currentTheme == "dark"
                            }
                        ) delay(50)
                    }
                    assertNotEquals(light, map.routeInks())

                    val pin = Bitmap.createBitmap(12, 16, Bitmap.Config.ARGB_8888)
                    pin.eraseColor(Color.rgb(255, 140, 0))
                    val night =
                        Bitmap.createBitmap(12, 16, Bitmap.Config.ARGB_8888).apply {
                            eraseColor(Color.CYAN)
                        }
                    map.setImages(
                        listOf(
                            TileflowMapImage.fromBitmap(
                                "pin",
                                pin,
                                variants = mapOf("dark" to night),
                            )
                        )
                    )
                    assertEquals(Color.CYAN, requireNotNull(style().getImage("pin")).getPixel(5, 5))
                    map.setDepthMarkers(
                        listOf(
                            TileflowDepthMarker(
                                "cafe",
                                TileflowCoordinate(-3.7, 40.42),
                                "pin",
                                12.0,
                                16.0,
                                anchor = TileflowDepthMarker.Anchor.BOTTOM,
                            )
                        )
                    )
                    assertNotNull(style().getLayer("__tileflow_depth_cafe"))
                    map.setSun(TileflowSun.AtDate(Instant.ofEpochSecond(1_782_064_800)), 300)
                    map.setSun(TileflowSun.Direction(200.0, 20.0))
                    val sunLight = requireNotNull(style().light)
                    assertEquals("map", sunLight.anchor)
                    val base =
                        org.json
                            .JSONObject(style().json)
                            .getJSONObject("light")
                            .getJSONArray("position")
                            .getDouble(0)
                            .toFloat()
                    assertEquals(Position.fromPosition(base, 200f, 70f), sunLight.position)
                    map.setEmphasis(
                        TileflowEmphasis(
                            recede = mapOf(TileflowMapModule.ROADS to 0.5),
                            labels = 0.4,
                            keepArea =
                                """{"type":"Polygon","coordinates":[[[-3.71,40.41],[-3.69,40.41],[-3.69,40.43],[-3.71,40.41]]]}""",
                        )
                    )
                    map.setStyleState("fixture-opacity", TileflowStyleValue.Number(0.5))
                    assertEquals(0.5, style().globalState.get("fixture-opacity").asDouble, 0.001)
                    map.setBoundaryValues(
                        TileflowBoundaryValues.byIds(
                            mapOf(
                                41L to TileflowBoundaryValue.Number(4.5),
                                2L to TileflowBoundaryValue.Category("high"),
                            )
                        )
                    )
                    fun boundState() =
                        style()
                            .getSourceAs<VectorSource>("tileflow-boundaries")
                            ?.getFeatureState("boundary_area", "41")
                            ?.get("value")
                            ?.asDouble
                    awaitBoundaryState(4.5, ::boundState)
                    assertNotNull(style().getLayer("score-fill"))
                    map.setBoundaryValues(
                        TileflowBoundaryValues.byIds(
                            mapOf(41L to TileflowBoundaryValue.Number(7.0))
                        )
                    )
                    awaitBoundaryState(7.0, ::boundState)
                    map.setBoundaryValues(null)
                    awaitBoundaryState(null, ::boundState)
                    val badJoin =
                        runCatching {
                                map.setBoundaryValues(
                                    TileflowBoundaryValues.byRefs(
                                        mapOf("ref-41" to TileflowBoundaryValue.Number(9.0))
                                    )
                                )
                            }
                            .exceptionOrNull()
                    assertEquals(
                        TileflowErrorCode.INVALID_REQUEST,
                        (badJoin as TileflowMapException).code,
                    )
                    map.setBoundaryValues(
                        TileflowBoundaryValues.byIds(
                            mapOf(41L to TileflowBoundaryValue.Number(4.5))
                        )
                    )
                    val missing =
                        runCatching {
                                map.setDepthMarkers(
                                    listOf(
                                        TileflowDepthMarker(
                                            "x",
                                            TileflowCoordinate(0.0, 0.0),
                                            "missing",
                                            1.0,
                                            1.0,
                                        )
                                    )
                                )
                            }
                            .exceptionOrNull() as TileflowMapException
                    assertEquals(TileflowErrorCode.INVALID_REQUEST, missing.code)

                    val route =
                        """{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-3.702,40.42],[-3.7,40.42],[-3.698,40.42]]}}]}"""
                    map.setContent(
                        layers =
                            listOf(
                                TileflowGeoJSONLayer(
                                    "route-casing",
                                    route,
                                    TileflowGeoJSONLayerKind.LINE,
                                    size = 9.0,
                                    ink = TileflowRouteInk.CASING,
                                    placement = TileflowLayerPlacement.GROUND,
                                ),
                                TileflowGeoJSONLayer(
                                    "route-line",
                                    route,
                                    TileflowGeoJSONLayerKind.LINE,
                                    color = "#ff00ff",
                                    size = 9.0,
                                    placement = TileflowLayerPlacement.TOP,
                                    progress = TileflowLineProgress(end = 0.0),
                                ),
                            )
                    )
                    val order = style().layers.map { it.id }
                    val casing = order.indexOf("__tileflow_app_route-casing")
                    assertTrue(
                        "Ground overlay must be above the roads",
                        casing >= order.indexOf("tileflow-buildings-render-flatShadow"),
                    )
                    assertTrue(
                        "Ground overlay must be before the first 3D layer",
                        casing < order.indexOf("tileflow-buildings-native-extrusion"),
                    )
                    val routePoint = TileflowCoordinate(-3.699, 40.42)
                    fun magenta(pixel: Int) =
                        Color.red(pixel) > 230 && Color.blue(pixel) > 230 && Color.green(pixel) < 25
                    suspend fun routePixel(): Int {
                        val at = map.project(routePoint)
                        val bitmap =
                            suspendCancellableCoroutine<Bitmap> { cb ->
                                requireNotNull(engine.map).snapshot { cb.resume(it) }
                            }
                        return bitmap.getPixel(at.x.toInt(), at.y.toInt())
                    }
                    assertFalse("An empty route must not color its midpoint", magenta(routePixel()))
                    assertTrue(
                        map.animateLineProgress(
                            listOf("route-line"),
                            TileflowLineProgress(end = 1.0, light = 0.5),
                            400,
                        )
                    )
                    assertNotNull(style().getLayerAs<LineLayer>("__tileflow_app_route-line"))
                    withTimeout(10_000) { while (!magenta(routePixel())) delay(50) }
                    val unknown =
                        runCatching {
                                map.animateLineProgress(
                                    listOf("route-casing"),
                                    TileflowLineProgress(),
                                    0,
                                )
                            }
                            .exceptionOrNull() as TileflowMapException
                    assertEquals("unknownLayer", unknown.context.reason)

                    val cues = mutableListOf<String>()
                    val start = TileflowCamera(-3.7, 40.42, 13.0)
                    val end = TileflowCamera(-3.69, 40.425, 14.0, bearing = 30.0, pitch = 45.0)
                    assertTrue(
                        map.play(
                            TileflowShot(
                                listOf(
                                    TileflowShot.Keyframe(0, start),
                                    TileflowShot.Keyframe(600, end),
                                ),
                                cues = listOf(TileflowShot.Cue(300, "midway")),
                            )
                        ) {
                            cues += it
                        }
                    )
                    assertEquals(listOf("midway"), cues)
                    val final = map.camera()
                    assertEquals(end.longitude, final.longitude, 1e-6)
                    assertEquals(end.latitude, final.latitude, 1e-6)
                    assertEquals(end.zoom, final.zoom, 0.001)
                    assertEquals(end.bearing, final.bearing, 0.01)
                    assertEquals(end.pitch, final.pitch, 0.01)
                    // Cancelling the caller stops the shot where it is.
                    val long = async {
                        map.play(
                            TileflowShot(
                                listOf(
                                    TileflowShot.Keyframe(0, end),
                                    TileflowShot.Keyframe(60_000, start),
                                )
                            )
                        )
                    }
                    delay(300)
                    long.cancel()
                    val stopped = runCatching { long.await() }.exceptionOrNull()
                    assertTrue(stopped is CancellationException)

                    // A new renderer receives the content and the scene again, without failures.
                    map.setBlend(listOf("light", "dark"), 0.0)
                    assertEquals(
                        pin.getPixel(5, 5),
                        requireNotNull(style().getImage("pin")).getPixel(5, 5),
                    )
                    map.setBlend(listOf("light", "dark"), 1.0)
                    assertEquals(Color.CYAN, requireNotNull(style().getImage("pin")).getPixel(5, 5))
                    assertEquals(
                        Color.CYAN,
                        requireNotNull(style().getImage("__tileflow_depth_cafe")).getPixel(5, 5),
                    )
                    map.setTheme("dark")
                    val loads = activity.loads.size
                    map.reload()
                    withTimeout(30_000) { while (activity.loads.size <= loads) delay(50) }
                    awaitBoundaryState(4.5, ::boundState)
                    assertNotNull(style().getLayer("__tileflow_depth_cafe"))
                    assertEquals(0.5, style().globalState.get("fixture-opacity").asDouble, 0.001)
                    assertEquals(Color.CYAN, requireNotNull(style().getImage("pin")).getPixel(5, 5))
                    assertEquals(
                        Position.fromPosition(base, 200f, 70f),
                        requireNotNull(style().light).position,
                    )
                    assertTrue(
                        map.animateLineProgress(
                            listOf("route-line"),
                            TileflowLineProgress(end = 0.5),
                            200,
                        )
                    )
                }
            }
            capture("tileflow-scene-features")
            assertTrue("Map errors: ${failures(activity)}", failures(activity).isEmpty())
        } finally {
            activity.finish()
        }
    }
}
