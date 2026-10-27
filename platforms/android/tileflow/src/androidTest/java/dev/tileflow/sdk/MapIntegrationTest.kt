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
import android.view.Window
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
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
                    val features =
                        activity.map.query(activity.map.width / 2f, activity.map.height / 2f)
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
