package dev.tileflow.sdk

import android.content.Intent
import android.content.pm.ActivityInfo
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.LinearLayout
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.engine.MapEngineKind
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.engine.NativeRepresentation
import dev.tileflow.sdk.bridge.ProtocolContract
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.RasterLayer
import org.maplibre.android.style.sources.RasterSource

/** What a map view reported during a check. */
internal class NativeMapEvents {
    val events = CopyOnWriteArrayList<TileflowMapEvent>()
    val loads: Int
        get() = events.count { it == TileflowMapEvent.ContentReady }

    val failures: List<TileflowMapEvent.Failed>
        get() = events.filterIsInstance<TileflowMapEvent.Failed>()

    /** The capabilities reported as unavailable, in order. */
    val features: List<String>
        get() =
            events.filterIsInstance<TileflowMapEvent.Warning>().mapNotNull {
                it.context.feature.takeIf { _ -> it.context.reason == "featureUnavailable" }
            }

    val transitions: List<TileflowThemeTransition>
        get() = events.filterIsInstance<TileflowMapEvent.ThemeTransition>().map { it.transition }

    val changes: List<TileflowCameraChange>
        get() = events.filterIsInstance<TileflowMapEvent.CameraChanged>().map { it.change }

    suspend fun waitForLoads(count: Int, millis: Long = 60_000) {
        withTimeout(millis) { while (loads < count) delay(50) }
    }
}

/** Hosts one or two maps drawn by MapLibre Native, as [maps] describes them. */
public class NativeViewHostActivity : ComponentActivity() {
    val views = mutableListOf<TileflowMapView>()
    internal val recorded = mutableListOf<NativeMapEvents>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = this
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        for ((source, theme) in maps) {
            val events = NativeMapEvents()
            val view =
                TileflowMapView(this).apply {
                    engineKind = MapEngineKind.NATIVE
                    onEvent = { events.events.add(it) }
                    setSource(source)
                    theme?.let { runBlocking { setTheme(it) } }
                }
            layout.addView(view, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            views += view
            recorded += events
        }
        setContentView(layout)
    }

    override fun onDestroy() {
        views.forEach { it.destroy() }
        super.onDestroy()
    }

    internal val engine: NativeMapEngine?
        get() = views.first().readyEngine as? NativeMapEngine

    internal companion object {
        val CITY =
            TileflowMapSource(
                map = "city",
                manifestUrl = URI("${Fixture.ORIGIN}/native/manifest.json"),
                allowsLoopbackHttp = true,
            )
        @Volatile var maps: List<Pair<TileflowMapSource, String?>> = listOf(CITY to null)
        @Volatile var current: NativeViewHostActivity? = null
    }
}

/**
 * The map view's integration checks on MapLibre Native: loading, theme changes, blends, emphasis,
 * the view mode, degradation warnings, renderer recovery, camera events, lifecycle and two maps at
 * once. They use the fixture's self-hosted map built for the native renderer
 * (`/native/manifest.json`) and its Hosted map's `native-v1` representation. There is no data
 * channel to a web process: what the WebView suite reads with JavaScript, these checks read from
 * the view and its engine.
 *
 * Run with the online fixture server and `adb reverse tcp:18645 tcp:<port>`.
 */
@RunWith(AndroidJUnit4::class)
public class NativeMapViewIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val center = TileflowCoordinate(-3.70, 40.42)

    @After
    public fun tearDown() {
        NativeViewHostActivity.maps = listOf(NativeViewHostActivity.CITY to null)
        runCatching { post("${Fixture.ORIGIN}/__fixture/hosted") }
    }

    /** The native map is built when the fixture server starts; the first request waits for it. */
    private fun requireNativeFixture() {
        val reachable = runCatching {
                val connection =
                    URL("${Fixture.ORIGIN}/native/manifest.json").openConnection()
                        as HttpURLConnection
                connection.readTimeout = 180_000
                connection.responseCode == 200
            }
            .getOrDefault(false)
        assumeTrue("Start scripts/mobile-fixture-server.mjs and adb reverse tcp:18645", reachable)
    }

    private fun post(url: String) {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.requestMethod = "POST"
        connection.inputStream.close()
    }

    private fun show(): NativeViewHostActivity {
        val intent =
            Intent(instrumentation.context, NativeViewHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return instrumentation.startActivitySync(intent) as NativeViewHostActivity
    }

    private suspend fun assertBuildings(map: TileflowMapView) {
        var observed: List<TileflowRenderedFeature> = emptyList()
        repeat(100) {
            val point = map.project(center)
            observed = map.query(point.x, point.y)
            if (observed.any { it.layer.startsWith("tileflow-buildings") }) return
            delay(100)
        }
        fail("The buildings did not render: $observed")
    }

    @Test
    public fun onlineMapLoadsChangesThemeAndRetires() {
        requireNativeFixture()
        val activity = show()
        val events = activity.recorded.single()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.views.single()
                    events.waitForLoads(1)
                    assertTrue("Map errors: ${events.failures}", events.failures.isEmpty())
                    val initial = map.camera()
                    assertEquals(-3.70, initial.longitude, 0.01)
                    assertEquals(16.0, initial.zoom, 0.01)
                    assertBuildings(map)
                    val coordinate = map.unproject(map.project(center))
                    assertEquals(-3.70, coordinate.longitude, 0.0001)
                    assertEquals(40.42, coordinate.latitude, 0.0001)

                    // Each degradation the style records arrives once, as a warning and in the log.
                    withTimeout(10_000) {
                        while (events.features.toSet() != setOf("scene3d", "sky", "trees3d"))
                            delay(50)
                    }
                    assertEquals(listOf("scene3d", "sky", "trees3d"), events.features.sorted())
                    val degradation =
                        events.events.filterIsInstance<TileflowMapEvent.Warning>().first {
                            it.context.feature == "scene3d"
                        }
                    assertEquals(TileflowErrorCode.RENDERER_FAILED, degradation.code)

                    // A theme change reports its phases and the route inks of the theme on screen.
                    map.setTheme("dark", durationMillis = 300)
                    assertEquals(
                        listOf(
                            TileflowThemeTransition.Phase.PRELOADING,
                            TileflowThemeTransition.Phase.APPLYING,
                            TileflowThemeTransition.Phase.READY,
                        ),
                        events.transitions.map { it.phase },
                    )
                    assertEquals("dark", events.transitions.last().currentTheme)
                    assertNotNull(events.transitions.last().routeInks)
                    assertEquals(
                        listOf("dark"),
                        events.events.filterIsInstance<TileflowMapEvent.ThemeChanged>().map {
                            it.theme
                        },
                    )
                    assertBuildings(map)
                    val engine = requireNotNull(activity.engine)
                    val darkInks = map.routeInks()

                    // A blend loads one style; moving it changes the live style without loading.
                    map.setBlend(listOf("light", "dark"), 0.5)
                    assertEquals("dark", engine.blend?.let { it.themes[it.dominant] })
                    val loads = engine.received[ProtocolContract.Method.SET_BLEND] ?: 0
                    map.setBlend(listOf("light", "dark"), 0.2)
                    assertEquals(loads + 1, engine.received[ProtocolContract.Method.SET_BLEND])
                    assertEquals("light", engine.blend?.let { it.themes[it.dominant] })
                    assertNotEquals(darkInks.line, map.routeInks().line)
                    assertBuildings(map)

                    // Emphasis recedes a module and returns it to its design.
                    map.setTheme("light")
                    val fill =
                        engine.map?.style?.getLayer("tileflow-buildings-fill") as FillLayer
                    val designed = fill.fillColor.toString()
                    map.setEmphasis(
                        TileflowEmphasis(recede = mapOf(TileflowMapModule.BUILDINGS to 1.0)),
                        durationMillis = 300,
                    )
                    assertNotEquals(designed, fill.fillColor.toString())
                    map.setEmphasis(null, durationMillis = 200)
                    assertEquals(designed, fill.fillColor.toString())

                    // The 3D view shows the extrusions that stand in for the scene.
                    fun extrusion() =
                        engine.map
                            ?.style
                            ?.getLayer("tileflow-buildings-native-extrusion")
                            ?.visibility
                            ?.value
                    assertEquals(Property.NONE, extrusion())
                    map.setViewMode(TileflowViewMode.THREE_DIMENSIONAL, durationMillis = 300)
                    withTimeout(5_000) { while (extrusion() != Property.VISIBLE) delay(50) }
                    map.setOptions(TileflowMapOptions(viewMode = TileflowViewMode.FLAT))
                    assertEquals(Property.NONE, extrusion())

                    map.setCamera(TileflowCamera(-3.70, 40.42, 14.0))
                    assertEquals(14.0, map.camera().zoom, 0.01)
                    // The city's buildings draw from z15.
                    map.setCamera(TileflowCamera(-3.70, 40.42, 16.0))
                    map.reload()
                    events.waitForLoads(2)
                    assertBuildings(map)
                    assertTrue("Late map errors: ${events.failures}", events.failures.isEmpty())
                    map.destroy()
                    try {
                        map.setTheme("light")
                        fail("A destroyed map accepted an update.")
                    } catch (error: TileflowMapException) {
                        assertEquals(TileflowErrorCode.DISPOSED, error.code)
                    }
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    public fun streetsLoadsAtCityZoomWithItsHostedClimateLayer() {
        requireNativeFixture()
        val streets = TileflowMapSource(
            map = "streets",
            manifestUrl = URI("${Fixture.ORIGIN}/native/manifest.json"),
            allowsLoopbackHttp = true,
        )
        NativeViewHostActivity.maps = listOf(streets to null)
        val activity = show()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val events = activity.recorded.single()
                    events.waitForLoads(1)
                    val map = activity.views.single()
                    val style = requireNotNull(activity.engine?.map?.style)
                    val climate = style.getLayer("tileflow-global-landcover-underlay") as RasterLayer
                    assertTrue(map.camera().zoom > climate.maxZoom)
                    assertTrue(style.getSource("tileflow-landcover-underlay") is RasterSource)
                    assertTrue("Map errors: ${events.failures}", events.failures.isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    /**
     * The city map holds a world image drawn only below zoom 11, as Streets' climate underlay is.
     * At zoom 16 no layer draws it, which MapLibre Native takes for an image source still loading:
     * the map must load all the same, and draw the image once the camera zooms out to it.
     */
    @Test
    public fun aWorldImageOutsideItsZoomsLetsTheMapLoadAndDrawsWhenInRange() {
        requireNativeFixture()
        val activity = show()
        val events = activity.recorded.single()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.views.single()
                    events.waitForLoads(1)
                    assertTrue("Map errors: ${events.failures}", events.failures.isEmpty())
                    val engine = requireNotNull(activity.engine)
                    val style = requireNotNull(engine.map?.style)
                    val underlay =
                        style.getLayer("tileflow-global-landcover-underlay") as RasterLayer
                    assertEquals(11f, underlay.maxZoom, 0f)
                    assertTrue(style.getSource("tileflow-landcover-underlay") is RasterSource)
                    val hidden = underlayShare(engine)
                    assertTrue("At zoom 16 no layer draws the image: $hidden", hidden < 0.01)

                    map.setCamera(TileflowCamera(-3.70, 40.42, 5.0))
                    withTimeout(10_000) { while (underlayShare(engine) <= 0.5) delay(100) }
                    assertTrue("Map errors: ${events.failures}", events.failures.isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    /** The share of the map's own drawing in the fixture underlay's green, `#01a004`. */
    private suspend fun underlayShare(engine: NativeMapEngine): Double {
        val bitmap =
            suspendCancellableCoroutine<Bitmap?> { done ->
                engine.map?.snapshot { done.resume(it) } ?: done.resume(null)
            } ?: return 0.0
        var green = 0
        var total = 0
        for (y in 0 until bitmap.height step 8) {
            for (x in 0 until bitmap.width step 8) {
                val pixel = bitmap.getPixel(x, y)
                total += 1
                if (Color.red(pixel) < 60 && Color.green(pixel) > 120 && Color.blue(pixel) < 60)
                    green += 1
            }
        }
        return green.toDouble() / maxOf(total, 1)
    }

    @Test
    public fun rendererLossWhileDetachedWaitsForVisibilityAndInvalidRequestsAnswerAtOnce() {
        requireNativeFixture()
        val activity = show()
        val events = activity.recorded.single()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.views.single()
                    events.waitForLoads(1)
                    // Off-screen points are valid; invalid requests fail at once, not at timeout.
                    val started = System.currentTimeMillis()
                    map.unproject(TileflowPoint(-40f, -40f))
                    map.query(-40f, map.height * 3f)
                    assertTrue(System.currentTimeMillis() - started < 5_000)
                    // MapLibre Android draws at most 60 degrees: a steeper camera is capped, once.
                    map.setCamera(TileflowCamera(-3.7, 40.42, 16.0, pitch = 80.0))
                    assertEquals(60.0, map.camera().pitch, 0.5)
                    map.setCamera(TileflowCamera(-3.7, 40.42, 16.0, pitch = 85.0))
                    assertEquals(listOf("pitchAbove60"), events.features.filter { it == "pitchAbove60" })
                    map.setCamera(TileflowCamera(-3.7, 40.42, 16.0))

                    // A renderer that loses its graphics context while the map is detached is
                    // replaced once the map is visible again.
                    val parent = map.parent as ViewGroup
                    val params = map.layoutParams
                    parent.removeView(map)
                    requireNotNull(map.readyEngine as? NativeMapEngine).graphicsContextLost()
                    assertNull(map.readyEngine)
                    parent.addView(map, params)
                    events.waitForLoads(2)
                    // Loading resets the recovery budget, so a later loss is recovered too.
                    requireNotNull(map.readyEngine as? NativeMapEngine).graphicsContextLost()
                    events.waitForLoads(3)
                    assertBuildings(map)
                    assertTrue("Map errors: ${events.failures}", events.failures.isEmpty())
                    // A loss before the replacement loads is a recoverable failure.
                    withTimeout(10_000) { while (map.readyEngine == null) delay(20) }
                    (map.readyEngine as NativeMapEngine).graphicsContextLost()
                    withTimeout(10_000) { while (map.readyEngine == null) delay(20) }
                    (map.readyEngine as NativeMapEngine).graphicsContextLost()
                    withTimeout(10_000) { while (events.failures.isEmpty()) delay(50) }
                    val failure = events.failures.first()
                    assertEquals(TileflowErrorCode.RENDERER_FAILED, failure.code)
                    assertEquals("graphicsContextLost", failure.context.reason)
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    public fun eventLevelsAndCameraReasons() {
        requireNativeFixture()
        val activity = show()
        val events = activity.recorded.single()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.views.single()
                    events.waitForLoads(1)
                    // At the default level only the settled camera arrives, tagged with its cause.
                    events.events.clear()
                    map.setCamera(TileflowCamera(-3.69, 40.42, 13.0), durationMillis = 600)
                    withTimeout(10_000) { while (events.changes.none { it.isFinal }) delay(50) }
                    assertEquals(
                        listOf(TileflowCameraChangePhase.ENDED),
                        events.changes.map { it.phase },
                    )
                    assertEquals(TileflowCameraChangeReason.API, events.changes.last().reason)
                    // The continuous level adds the start and throttled updates.
                    map.setOptions(
                        TileflowMapOptions(
                            events = TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 100)
                        )
                    )
                    events.events.clear()
                    map.setCamera(TileflowCamera(-3.70, 40.42, 14.0), durationMillis = 800)
                    withTimeout(10_000) { while (events.changes.none { it.isFinal }) delay(50) }
                    val changes = events.changes
                    assertEquals(TileflowCameraChangePhase.STARTED, changes.first().phase)
                    assertTrue(
                        "${changes.map { it.reason }}",
                        changes.all { it.reason == TileflowCameraChangeReason.API },
                    )
                    val moving = changes.count { it.phase == TileflowCameraChangePhase.MOVING }
                    assertTrue("$moving throttled updates in 0.8 s", moving in 1..11)
                    assertEquals(14.0, changes.last().camera.zoom, 0.01)
                    // Framing bounds settles on a camera that holds them.
                    map.fit(TileflowBounds(-3.71, 40.41, -3.69, 40.43))
                    val bounds = map.visibleBounds()
                    assertTrue("$bounds", bounds.west <= -3.71 && bounds.north >= 40.43)
                    assertTrue("Map errors: ${events.failures}", events.failures.isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    /**
     * The Hosted map's native representation: themes and blends from the family document that
     * discovery names, its degradations, and one reload when a later deployment supersedes it.
     */
    @Test
    public fun aHostedMapReadsItsNativeRepresentationAndReloadsOnceWhenSuperseded() {
        requireNativeFixture()
        Fixture.counters(reset = true)
        NativeViewHostActivity.maps =
            listOf(
                TileflowMapSource.hosted(
                    Fixture.HOSTED_MAP_ID,
                    configuration =
                        TileflowConfiguration(
                            apiOrigin = URI(Fixture.ORIGIN),
                            mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)),
                        ),
                ) to null
            )
        val activity = show()
        val events = activity.recorded.single()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.views.single()
                    events.waitForLoads(1)
                    val engine = requireNotNull(activity.engine)
                    assertEquals(NativeRepresentation.NATIVE, engine.manifest?.representation)
                    assertNotNull(engine.family)
                    withTimeout(10_000) { while (events.features != listOf("scene3d")) delay(50) }
                    map.setBlend(listOf("day", "night"), 0.5)
                    map.setBlend(listOf("day", "night"), 0.75)
                    assertEquals("night", engine.blend?.let { it.themes[it.dominant] })
                    try {
                        map.setBlend(listOf("day", "labels"), 0.5)
                        fail("Themes of different structure blended.")
                    } catch (error: TileflowMapException) {
                        assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
                    }
                    // A later deployment supersedes version 1: the next style answers 409 and the
                    // map reloads once, from the new deployment, in the requested theme.
                    withContext(Dispatchers.IO) {
                        post("${Fixture.ORIGIN}/__fixture/hosted?deployment=2")
                    }
                    runCatching { map.setTheme("terrain") }
                    events.waitForLoads(2)
                    val reloaded = requireNotNull(map.readyEngine as? NativeMapEngine)
                    assertEquals("terrain", reloaded.shownTheme)
                    withTimeout(10_000) { while ("terrain3d" !in events.features) delay(50) }
                    assertEquals(2, events.loads)
                    assertTrue("Map errors: ${events.failures}", events.failures.isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    public fun twoMapsAtOnceAndRotation() {
        requireNativeFixture()
        NativeViewHostActivity.maps =
            listOf(NativeViewHostActivity.CITY to "light", NativeViewHostActivity.CITY to "dark")
        val activity = show()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    for ((index, map) in activity.views.withIndex()) {
                        activity.recorded[index].waitForLoads(1)
                        assertBuildings(map)
                    }
                    assertEquals(
                        "dark",
                        (activity.views[1].readyEngine as? NativeMapEngine)?.shownTheme,
                    )
                }
            }
            // Turning the device recreates the activity; each map starts again where it was.
            instrumentation.runOnMainSync {
                activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
            }
            runBlocking {
                withTimeout(30_000) {
                    while (NativeViewHostActivity.current === activity) delay(50)
                }
                val turned = requireNotNull(NativeViewHostActivity.current)
                withContext(Dispatchers.Main) {
                    for ((index, map) in turned.views.withIndex()) {
                        turned.recorded[index].waitForLoads(1)
                        val camera = map.camera()
                        assertEquals(-3.70, camera.longitude, 0.001)
                        assertBuildings(map)
                        assertTrue(turned.recorded[index].failures.isEmpty())
                    }
                    assertFalse(turned.isFinishing)
                }
                instrumentation.runOnMainSync {
                    turned.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                    turned.finish()
                }
            }
        } finally {
            instrumentation.runOnMainSync { if (!activity.isFinishing) activity.finish() }
        }
    }

    /** Annotation layers and tracked points the engine refuses are sent once, not again and again. */
    @Test
    public fun refusedAnnotationsAreNotSentAgain() {
        requireNativeFixture()
        val activity = show()
        val events = activity.recorded.single()
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.views.single()
                    events.waitForLoads(1)
                    val engine = requireNotNull(activity.engine)
                    map.annotations
                        .createCircleAnnotationManager(TileflowAnnotationConfig("places"))
                        .create(TileflowCircleAnnotationOptions().withPoint(center))
                    map.viewAnnotationManager.addViewAnnotation(
                        android.view.View(activity),
                        TileflowViewAnnotationOptions(center),
                    )
                    delay(1_500)
                    val layers = engine.received[ProtocolContract.Method.SET_ANNOTATION_LAYERS] ?: 0
                    val points = engine.received[ProtocolContract.Method.SET_TRACKED_POINTS] ?: 0
                    assertTrue("$layers annotation layer requests", layers <= 3)
                    assertTrue("$points tracked point requests", points <= 3)
                    delay(1_500)
                    assertEquals(layers, engine.received[ProtocolContract.Method.SET_ANNOTATION_LAYERS] ?: 0)
                    assertEquals(points, engine.received[ProtocolContract.Method.SET_TRACKED_POINTS] ?: 0)
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
