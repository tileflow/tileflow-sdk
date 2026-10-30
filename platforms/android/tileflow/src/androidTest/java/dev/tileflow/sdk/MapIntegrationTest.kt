package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Rect
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.PixelCopy
import android.view.ViewGroup
import android.view.Window
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

public class MapHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loaded = CountDownLatch(1)
    val failures = CopyOnWriteArrayList<TileflowErrorCode>()
    val selections = CopyOnWriteArrayList<TileflowPoiSelection>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        map =
            TileflowMapView(this).apply {
                onEvent = {
                    when (it) {
                        TileflowMapEvent.ContentReady -> loaded.countDown()
                        is TileflowMapEvent.Failed -> failures.add(it.code)
                        is TileflowMapEvent.PoiActivated -> selections.add(it.selection)
                        else -> Unit
                    }
                }
                setSource(
                    TileflowMapSource(
                        map = "fixture",
                        manifestUrl = URI("http://127.0.0.1:18645/manifest.json"),
                        allowsLoopbackHttp = true,
                    )
                )
                runBlocking { setTheme("light") }
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }
}

/** Run with the online fixture server and `adb reverse tcp:18645 tcp:18645`. */
@RunWith(AndroidJUnit4::class)
public class MapIntegrationTest {
    @Test
    public fun onlineMapLoadsChangesThemeAndRetires() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent =
            Intent(instrumentation.context, MapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as MapHostActivity
        try {
            assertTrue(
                "Map did not load. Errors: ${activity.failures}",
                activity.loaded.await(30, TimeUnit.SECONDS),
            )
            assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
            runBlocking {
                withContext(Dispatchers.Main) {
                    assertRenderedBackground(
                        activity.map,
                        activity.window,
                        Color.rgb(232, 226, 216),
                    )
                    val initial = activity.map.camera()
                    assertEquals(-3.70, initial.longitude, 0.01)
                    // The camera centres on the view inside the system bars it overlaps.
                    val centre = activity.map.project(TileflowCoordinate(-3.70, 40.42))
                    val features = activity.map.query(centre.x, centre.y)
                    assertTrue(
                        "The POI did not render: $features",
                        features.any { it.layer == "poi" },
                    )
                    val projected = activity.map.project(TileflowCoordinate(-3.70, 40.42))
                    val coordinate = activity.map.unproject(projected)
                    assertEquals(-3.70, coordinate.longitude, 0.0001)
                    assertEquals(40.42, coordinate.latitude, 0.0001)
                    val down = SystemClock.uptimeMillis()
                    for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
                        val event =
                            MotionEvent.obtain(
                                down,
                                SystemClock.uptimeMillis(),
                                action,
                                projected.x,
                                projected.y,
                                0,
                            )
                        activity.map.dispatchTouchEvent(event)
                        event.recycle()
                        delay(80)
                    }
                    withTimeout(5_000) {
                        while (activity.selections.isEmpty()) delay(50)
                    }
                    assertEquals("42", activity.selections.single().id)
                    assertEquals("Tileflow", activity.selections.single().name)
                    assertEquals("food-drink", activity.selections.single().category)
                    val data =
                        """{"type":"FeatureCollection","features":[{"type":"Feature","id":"selected","geometry":{"type":"Point","coordinates":[-3.70,40.42]},"properties":{}}]}"""
                    activity.map.setContent(
                        annotations =
                            listOf(
                                TileflowAnnotation(
                                    "accessible-place",
                                    TileflowCoordinate(-3.71, 40.43),
                                    "Saved place",
                                )
                            ),
                        layers =
                            listOf(
                                TileflowGeoJSONLayer(
                                    "selection",
                                    data,
                                    TileflowGeoJSONLayerKind.CIRCLE,
                                    "#2166ce",
                                    14.0,
                                )
                            ),
                    )
                    assertApplicationLayer(activity.map)
                    activity.map.setTheme("dark")
                    assertApplicationLayer(activity.map)
                    assertRenderedBackground(activity.map, activity.window, Color.rgb(32, 42, 55))
                    activity.map.setBlend(listOf("light", "dark"), 0.5)
                    activity.map.setOptions(
                        TileflowMapOptions(
                            viewMode = TileflowViewMode.THREE_DIMENSIONAL,
                            quality = TileflowQuality.LOW,
                        )
                    )
                    activity.map.fit(TileflowBounds(-3.71, 40.41, -3.69, 40.43))
                    activity.map.setCamera(TileflowCamera(-3.70, 40.42, 14.0))
                    assertEquals(14.0, activity.map.camera().zoom, 0.01)
                    activity.map.reload()
                    assertApplicationLayer(activity.map)
                    assertTrue("Late map errors: ${activity.failures}", activity.failures.isEmpty())
                    activity.map.destroy()
                    try {
                        activity.map.setTheme("light")
                        throw AssertionError("A destroyed map accepted an update.")
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
    public fun rendererLossWhileDetachedWaitsForVisibilityAndInvalidRequestsAnswerAtOnce() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent =
            Intent(instrumentation.context, MapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as MapHostActivity
        val loads = AtomicInteger(1)
        try {
            assertTrue(
                "Map did not load. Errors: ${activity.failures}",
                activity.loaded.await(30, TimeUnit.SECONDS),
            )
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    map.onEvent = {
                        when (it) {
                            TileflowMapEvent.ContentReady -> loads.incrementAndGet()
                            is TileflowMapEvent.Failed -> activity.failures.add(it.code)
                            else -> Unit
                        }
                    }
                    // The style's notices are always visible on the map, as on the web.
                    val notice = suspendCancellableCoroutine { continuation ->
                        renderer(map).evaluateJavascript(
                            "document.querySelector('.tileflow-notice')?.textContent ?? ''"
                        ) {
                            continuation.resume(it)
                        }
                    }
                    assertEquals("\"Not for navigation\"", notice)
                    // Off-screen points are valid; invalid requests fail at once, not at timeout.
                    val started = SystemClock.uptimeMillis()
                    map.unproject(TileflowPoint(-40f, -40f))
                    map.query(-40f, map.height * 3f)
                    map.setContent(
                        layers =
                            listOf(
                                TileflowGeoJSONLayer(
                                    "selection",
                                    """{"type":"FeatureCollection","bbox":[-3.71,40.41,-3.69,40.43],"features":[{"type":"Feature","bbox":[-3.7,40.42,-3.7,40.42],"geometry":{"type":"Point","coordinates":[-3.7,40.42]},"properties":{}}]}""",
                                    TileflowGeoJSONLayerKind.CIRCLE,
                                )
                            )
                    )
                    assertTrue(SystemClock.uptimeMillis() - started < 5_000)
                    // The renderer accepts the steep pitch the camera API allows.
                    map.setCamera(TileflowCamera(-3.7, 40.42, 16.0, pitch = 80.0))
                    assertEquals(80.0, map.camera().pitch, 0.5)
                    map.setCamera(TileflowCamera(-3.7, 40.42, 16.0))

                    // A renderer that ends while the map is detached is replaced once visible.
                    val parent = map.parent as ViewGroup
                    parent.removeView(map)
                    renderProcessGone(renderer(map))
                    assertTrue((0 until map.childCount).none { map.getChildAt(it) is WebView })
                    parent.addView(map)
                    withTimeout(30_000) { while (loads.get() < 2) delay(50) }
                    // Loading resets the recovery budget, so a later loss is recovered too.
                    renderProcessGone(renderer(map))
                    withTimeout(30_000) { while (loads.get() < 3) delay(50) }
                    assertApplicationLayer(map)
                    assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    public fun eventLevelsCameraReasonsAndLargeContentOverTheDataChannel() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent =
            Intent(instrumentation.context, MapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as MapHostActivity
        try {
            assertTrue(
                "Map did not load. Errors: ${activity.failures}",
                activity.loaded.await(30, TimeUnit.SECONDS),
            )
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    val changes = CopyOnWriteArrayList<TileflowCameraChange>()
                    map.onEvent = {
                        when (it) {
                            is TileflowMapEvent.CameraChanged -> changes.add(it.change)
                            is TileflowMapEvent.Failed -> activity.failures.add(it.code)
                            else -> Unit
                        }
                    }
                    // At the default level only the settled camera arrives, tagged with its cause.
                    map.setCamera(TileflowCamera(-3.69, 40.42, 13.0), durationMillis = 600)
                    withTimeout(10_000) { while (changes.none { it.isFinal }) delay(50) }
                    assertEquals(listOf(TileflowCameraChangePhase.ENDED), changes.map { it.phase })
                    assertEquals(TileflowCameraChangeReason.API, changes.last().reason)
                    // The continuous level adds the start and throttled updates.
                    map.setOptions(
                        TileflowMapOptions(
                            events = TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 100)
                        )
                    )
                    changes.clear()
                    map.setCamera(TileflowCamera(-3.70, 40.42, 14.0), durationMillis = 800)
                    withTimeout(10_000) { while (changes.none { it.isFinal }) delay(50) }
                    assertEquals(TileflowCameraChangePhase.STARTED, changes.first().phase)
                    assertTrue(
                        "${changes.map { it.reason }}",
                        changes.all { it.reason == TileflowCameraChangeReason.API },
                    )
                    val moving = changes.count { it.phase == TileflowCameraChangePhase.MOVING }
                    assertTrue("$moving throttled updates in 0.8 s", moving in 1..11)
                    assertEquals(14.0, changes.last().camera.zoom, 0.01)

                    // A 5 MiB layer travels over the data channel and renders.
                    val (geoJSON, features) = BridgeIntegrationTest.geoJSON(5 * 1024 * 1024)
                    val started = SystemClock.elapsedRealtime()
                    map.setContent(
                        layers =
                            listOf(
                                TileflowGeoJSONLayer(
                                    "selection",
                                    geoJSON,
                                    TileflowGeoJSONLayerKind.CIRCLE,
                                    size = 3.0,
                                )
                            )
                    )
                    println(
                        "Tileflow setContent with ${geoJSON.length} bytes of GeoJSON ($features points): ${SystemClock.elapsedRealtime() - started} ms"
                    )
                    map.setCamera(TileflowCamera(-3.70, 40.42, 14.0))
                    assertApplicationLayer(map)
                    // Invalid GeoJSON is a typed rejection that leaves the content as it was.
                    try {
                        map.setContent(
                            layers =
                                listOf(
                                    TileflowGeoJSONLayer(
                                        "broken",
                                        """{"type":"Feature"}""",
                                        TileflowGeoJSONLayerKind.FILL,
                                    )
                                )
                        )
                        throw AssertionError("The renderer accepted invalid GeoJSON.")
                    } catch (error: TileflowMapException) {
                        assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
                        assertEquals("invalidGeoJSON", error.context.reason)
                        assertEquals(TileflowResourceKind.DATA, error.context.resource)
                    }
                    assertApplicationLayer(map)
                    assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    private fun renderer(map: TileflowMapView): WebView =
        (0 until map.childCount).map(map::getChildAt).filterIsInstance<WebView>().single()

    private fun renderProcessGone(view: WebView) {
        view.webViewClient.onRenderProcessGone(
            view,
            object : RenderProcessGoneDetail() {
                override fun didCrash(): Boolean = false

                override fun rendererPriorityAtExit(): Int = 0
            },
        )
    }

    private suspend fun assertApplicationLayer(map: TileflowMapView) {
        withTimeout(10_000) {
            while (true) {
                val restored = runCatching {
                    val point = map.project(TileflowCoordinate(-3.70, 40.42))
                    map.query(point.x, point.y).any { it.layer == "__tileflow_app_selection" }
                }
                    .getOrDefault(false)
                if (restored) break
                delay(100)
            }
        }
    }

    /** Queries prove feature layout; PixelCopy independently proves native presentation. */
    private suspend fun assertRenderedBackground(
        map: TileflowMapView,
        window: Window,
        expected: Int,
    ) {
        var last = Color.TRANSPARENT
        repeat(40) {
            val location = IntArray(2)
            map.getLocationInWindow(location)
            val bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
            val x = location[0] + map.width / 8
            val y = location[1] + map.height / 4
            val status = suspendCancellableCoroutine { continuation ->
                PixelCopy.request(
                    window,
                    Rect(x, y, x + 1, y + 1),
                    bitmap,
                    { code -> if (continuation.isActive) continuation.resume(code) },
                    Handler(Looper.getMainLooper()),
                )
            }
            if (status == PixelCopy.SUCCESS) last = bitmap.getPixel(0, 0)
            bitmap.recycle()
            if (
                kotlin.math.abs(Color.red(last) - Color.red(expected)) <= 3 &&
                    kotlin.math.abs(Color.green(last) - Color.green(expected)) <= 3 &&
                    kotlin.math.abs(Color.blue(last) - Color.blue(expected)) <= 3
            )
                return
            delay(100)
        }
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val capture =
            java.io.File(instrumentation.context.getExternalFilesDir(null), "map-pixel-failure.png")
        instrumentation.uiAutomation.takeScreenshot()?.let { screenshot ->
            capture.outputStream().use { screenshot.compress(Bitmap.CompressFormat.PNG, 100, it) }
            screenshot.recycle()
        }
        println("Native frame failure: ${capture.absolutePath}")
        throw AssertionError(
            "Map pixels did not present: expected ${Integer.toHexString(expected)}, got ${Integer.toHexString(last)}"
        )
    }
}
