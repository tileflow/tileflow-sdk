package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
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
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Shows one fixture map, named by the `map` extra, in the view mode of the `viewMode` extra. */
public class SceneHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loads = CopyOnWriteArrayList<Long>()
    val loaded = CountDownLatch(1)
    val events = CopyOnWriteArrayList<TileflowMapEvent>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val name = intent.getStringExtra("map") ?: "fixture"
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
                        manifestUrl = URI("http://127.0.0.1:18645/manifest.json"),
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
 * route inks, line progress and camera shots. Run with the online fixture server and
 * `adb reverse tcp:18645 tcp:<port>`. Screenshots land in the test app's external files.
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
        val activity = instrumentation.startActivitySync(intent) as SceneHostActivity
        assertTrue("The $map map did not load.", activity.loaded.await(30, TimeUnit.SECONDS))
        return activity
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

    private suspend fun javascript(map: TileflowMapView, script: String): String =
        suspendCancellableCoroutine { continuation ->
            (map.getChildAt(0) as WebView).evaluateJavascript(script) {
                if (continuation.isActive) continuation.resume(it)
            }
        }

    @Test
    public fun aNauticalMapShowsItsNoticeOnTheMap() {
        val activity = show("nautical")
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    withTimeout(10_000) {
                        while (
                            javascript(
                                activity.map,
                                "document.querySelector('.tileflow-notice')?.textContent ?? ''",
                            ) != "\"Not for navigation\""
                        )
                            delay(100)
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
    public fun aDeclaredSceneRisesInThreeDimensions() {
        val activity = show("scene", viewMode = "3d")
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
    public fun theSceneReachesTheRendererAndANewRendererReceivesItAgain() {
        val activity = show("fixture")
        val map = activity.map
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    assertEquals(TileflowRouteInks.LIGHT, map.routeInks())
                    map.setTheme("dark")
                    withTimeout(10_000) {
                        while (
                            activity.events.none {
                                it is TileflowMapEvent.ThemeTransition &&
                                    it.transition.phase == TileflowThemeTransition.Phase.READY &&
                                    it.transition.currentTheme == "dark"
                            }
                        )
                            delay(50)
                    }
                    assertEquals(TileflowRouteInks.DARK, map.routeInks())

                    val pin = Bitmap.createBitmap(12, 16, Bitmap.Config.ARGB_8888)
                    pin.eraseColor(Color.rgb(255, 140, 0))
                    map.setImages(listOf(TileflowMapImage.fromBitmap("pin", pin)))
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
                    map.setSun(TileflowSun.AtDate(Instant.ofEpochSecond(1_782_064_800)), 300)
                    map.setSun(TileflowSun.Direction(200.0, 20.0))
                    map.setEmphasis(
                        TileflowEmphasis(
                            recede = mapOf(TileflowMapModule.ROADS to 0.5),
                            labels = 0.4,
                            keepArea =
                                """{"type":"Polygon","coordinates":[[[-3.71,40.41],[-3.69,40.41],[-3.69,40.43],[-3.71,40.41]]]}""",
                        )
                    )
                    map.setStyleState("traffic", TileflowStyleValue.Number(0.5))
                    map.setBoundaryValues(
                        TileflowBoundaryValues.byIds(
                            mapOf(
                                1L to TileflowBoundaryValue.Number(4.5),
                                2L to TileflowBoundaryValue.Category("high"),
                            )
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
                        """{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-3.715,40.415],[-3.7,40.42],[-3.685,40.425]]}}]}"""
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
                                    ink = TileflowRouteInk.LINE,
                                    placement = TileflowLayerPlacement.GROUND,
                                    occludedOpacity = 0.35,
                                    progress = TileflowLineProgress(end = 0.0),
                                ),
                            )
                    )
                    assertTrue(
                        map.animateLineProgress(
                            listOf("route-line"),
                            TileflowLineProgress(end = 1.0, light = 0.5),
                            400,
                        )
                    )
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
                    val end = TileflowCamera(-3.69, 40.425, 14.0, bearing = 30.0, pitch = 60.0)
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
                    assertEquals(60.0, map.camera().pitch, 0.01)
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
                    map.reload()
                    withTimeout(30_000) { while (activity.loads.size < 2) delay(50) }
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
