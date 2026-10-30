package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Annotations through the embedded renderer: taps and drags reach annotation listeners, native
 * views follow a fast pan, and accessibility services read annotations in order. Run with the
 * online fixture server and `adb reverse tcp:18645 tcp:<port>`. The test prints the delay between
 * a rendered frame and the views it moves, for the device it runs on.
 */
@RunWith(AndroidJUnit4::class)
public class AnnotationIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val centre = TileflowCoordinate(-3.7, 40.42)

    private fun show(): SceneHostActivity {
        val intent =
            Intent(instrumentation.context, SceneHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("map", "fixture")
        val activity = instrumentation.startActivitySync(intent) as SceneHostActivity
        assertTrue("The map did not load.", activity.loaded.await(30, TimeUnit.SECONDS))
        return activity
    }

    private fun <T> onMap(activity: SceneHostActivity, block: suspend (TileflowMapView) -> T): T =
        try {
            runBlocking { withContext(Dispatchers.Main) { block(activity.map) } }
        } finally {
            activity.finish()
        }

    private suspend fun until(label: String, condition: suspend () -> Boolean) {
        withTimeout(30_000) { while (!condition()) delay(50) }
        println("Tileflow: $label")
    }

    private suspend fun suspendJavascript(map: TileflowMapView, script: String): String =
        kotlinx.coroutines.suspendCancellableCoroutine { continuation ->
            (map.getChildAt(0) as android.webkit.WebView).evaluateJavascript(script) {
                if (continuation.isActive) continuation.resumeWith(Result.success(it))
            }
        }

    /** A person's finger on the map: down, [steps] moves of [dx], [dy] a frame apart, and up. */
    private suspend fun touch(
        map: TileflowMapView,
        x: Float,
        y: Float,
        dx: Float = 0f,
        dy: Float = 0f,
        steps: Int = 0,
    ) {
        val down = SystemClock.uptimeMillis()
        fun send(action: Int, atX: Float, atY: Float) {
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, atX, atY, 0)
            map.dispatchTouchEvent(event)
            event.recycle()
        }
        send(MotionEvent.ACTION_DOWN, x, y)
        for (step in 1..steps) {
            delay(16)
            send(MotionEvent.ACTION_MOVE, x + dx * step, y + dy * step)
        }
        delay(16)
        send(MotionEvent.ACTION_UP, x + dx * steps, y + dy * steps)
    }

    @Test
    public fun aTapOnAnAnnotationReachesItsListenerAndADragMovesIt() {
        val activity = show()
        onMap(activity) { map ->
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 14.0))
            val circles =
                map.annotations.createCircleAnnotationManager(TileflowAnnotationConfig("spots"))
            val spot =
                circles.create(
                    TileflowCircleAnnotationOptions()
                        .withPoint(centre)
                        .withCircleRadius(24.0)
                        .withCircleColor(Color.RED)
                        .withDraggable(true)
                )
            val taps = mutableListOf<String>()
            circles.addClickListener {
                taps += it.id
                true
            }
            val dropped = mutableListOf<TileflowCoordinate>()
            circles.addDragListener(
                object : TileflowAnnotationDragListener<TileflowCircleAnnotation> {
                    override fun onAnnotationDragFinished(annotation: TileflowCircleAnnotation) {
                        dropped += annotation.point
                    }
                }
            )
            until("the annotation is drawn") {
                runCatching {
                        map.queryRenderedFeatures(
                            options = TileflowRenderedQueryOptions(layerIds = listOf("spots"))
                        )
                    }
                    .getOrNull()
                    ?.isNotEmpty() == true
            }
            val point = map.project(centre)
            val appTaps = { activity.events.count { it is TileflowMapEvent.Tap } }
            val before = appTaps()
            touch(map, point.x, point.y)
            until("the listener took the tap") { taps.isNotEmpty() }
            assertEquals(listOf(spot.id), taps)
            delay(300)
            assertEquals("The application did not receive the taken tap.", before, appTaps())
            // A tap beside the annotation reaches the application.
            touch(map, point.x + map.width / 4f, point.y + map.height / 4f)
            until("the application received a tap") { appTaps() > before }

            // A pan that starts on the draggable annotation moves it, not the map.
            val camera = map.currentCamera!!
            val dragX = minOf(150f, map.width / 4f)
            val dragY = minOf(100f, map.height / 4f)
            touch(map, point.x, point.y, dx = dragX / 10, dy = dragY / 10, steps = 10)
            until("the drag ended") { dropped.isNotEmpty() }
            val target = map.unproject(TileflowPoint(point.x + dragX, point.y + dragY))
            assertEquals(target.longitude, dropped.single().longitude, 1e-4)
            assertEquals(target.latitude, dropped.single().latitude, 1e-4)
            assertEquals(camera, map.currentCamera)
            val moved =
                map.querySourceFeatures("spots").single().feature.geometry as TileflowGeometry.Point
            assertEquals(target.longitude, moved.coordinate.longitude, 1e-4)
        }
    }

    @Test
    public fun twoHundredViewsFollowAFastPan() {
        val activity = show()
        onMap(activity) { map ->
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 13.0))
            val bounds = map.visibleBounds()
            val views =
                (0 until 200).map { index ->
                    val coordinate =
                        TileflowCoordinate(
                            bounds.west + (bounds.east - bounds.west) * ((index % 20) + 0.5) / 20,
                            bounds.south + (bounds.north - bounds.south) * ((index / 20) + 0.5) / 10,
                        )
                    val view = View(activity).apply { setBackgroundColor(Color.BLUE) }
                    map.viewAnnotationManager.addViewAnnotation(
                        view,
                        TileflowViewAnnotationOptions(
                            coordinate,
                            allowOverlap = true,
                            width = 12f,
                            height = 12f,
                        ),
                    )
                    view to coordinate
                }
            until("the views are placed") { views.all { it.first.visibility == View.VISIBLE } }
            val overlay = map.annotationOverlay
            overlay.lag.clear()
            overlay.delivery.clear()
            val skew =
                suspendJavascript(map, "Date.now() - (performance.timeOrigin + performance.now())")
            suspendJavascript(
                map,
                """
                (() => {
                    const channel = window.tileflowNative;
                    const send = channel.postMessage.bind(channel);
                    const samples = window.tileflowTrackingTiming = {beforeSend: [], longTasks: []};
                    const measured = message => {
                        const event = JSON.parse(message);
                        if (event.event === 'trackedPointsMoved') {
                            samples.beforeSend.push(performance.timeOrigin + performance.now() - event.result.time);
                        }
                        send(message);
                    };
                    channel.postMessage = measured;
                    samples.installed = channel.postMessage === measured;
                    new PerformanceObserver(list => {
                        samples.longTasks.push(...list.getEntries().map(entry => entry.duration));
                    }).observe({type: 'longtask'});
                })()
                """.trimIndent(),
            )
            // Pan by the view's width in half a second, back and forth.
            val width = bounds.east - bounds.west
            val started = SystemClock.uptimeMillis()
            for (pass in 0 until 6) {
                val shift = if (pass % 2 == 0) width else 0.0
                map.ease(
                    TileflowCameraUpdate(
                        center = TileflowCoordinate(centre.longitude + shift, centre.latitude)
                    ),
                    durationMillis = 500,
                )
            }
            val elapsed = SystemClock.uptimeMillis() - started
            delay(200)
            // After the pan, each view sits where its coordinate is.
            for ((view, coordinate) in views.take(20)) {
                val expected = map.project(coordinate)
                assertEquals(expected.x, view.translationX + view.width / 2f, 1.5f)
                assertEquals(expected.y, view.translationY + view.height / 2f, 1.5f)
            }
            val lag = overlay.lag
            val frame = 1000.0 / 60
            val p50 = lag.percentile(0.5)!!
            val p95 = lag.percentile(0.95)!!
            val maximum = lag.maximum!!
            println(
                "Tileflow: 200 view annotations, %d position updates in %d ms of panning on %s (API %d): lag p50 %.1f ms (%.2f frames), p95 %.1f ms (%.2f frames), max %.1f ms (%.2f frames)"
                    .format(
                        lag.count,
                        elapsed,
                        Build.MODEL,
                        Build.VERSION.SDK_INT,
                        p50,
                        p50 / frame,
                        p95,
                        p95 / frame,
                        maximum,
                        maximum / frame,
                    )
            )
            println(
                "Tileflow: delivery to the main thread p50 %.1f ms, p95 %.1f ms; renderer clock skew %s ms"
                    .format(overlay.delivery.percentile(0.5), overlay.delivery.percentile(0.95), skew)
            )
            println(
                "Tileflow: renderer timing " +
                    suspendJavascript(
                        map,
                        "JSON.stringify({...window.tileflowTrackingTiming, clockSkewAfter: Date.now() - (performance.timeOrigin + performance.now())})",
                    )
            )
            assertTrue("Too few position updates: ${lag.count}", lag.count >= 30)
            assertTrue("Lag p95 $p95 ms", p95 < 100)
            map.viewAnnotationManager.removeAllViewAnnotations()
            assertTrue(views.all { it.first.parent == null })
        }
    }

    @Test
    public fun accessibilityServicesReadAnnotationsInOrderAndActivateThem() {
        val activity = show()
        onMap(activity) { map ->
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 14.0))
            val overlay = map.annotationOverlay
            overlay.forcesAccessibilityTracking = true
            val pins = map.annotations.createPointAnnotationManager()
            val north =
                pins.create(
                    TileflowPointAnnotationOptions()
                        .withPoint(TileflowCoordinate(centre.longitude + 0.004, centre.latitude + 0.006))
                        .withAccessibilityLabel("North pin")
                )
            val south =
                pins.create(
                    TileflowPointAnnotationOptions()
                        .withPoint(TileflowCoordinate(centre.longitude - 0.004, centre.latitude - 0.006))
                        .withAccessibilityLabel("South pin")
                )
            val callout = View(activity).apply { contentDescription = "Callout" }
            map.viewAnnotationManager.addViewAnnotation(
                callout,
                TileflowViewAnnotationOptions(centre, width = 80f, height = 40f),
            )
            val activated = mutableListOf<String>()
            pins.addClickListener {
                activated += "tap ${it.accessibilityLabel}"
                true
            }
            pins.addLongClickListener {
                activated += "hold ${it.accessibilityLabel}"
                true
            }
            until("the annotations are placed") {
                listOf(north, south).all {
                    overlay.accessibilityTarget(pins.id, it.id)?.visibility == View.VISIBLE
                } && callout.visibility == View.VISIBLE
            }
            val order = ArrayList<View>().also(overlay::addChildrenForAccessibility)
            assertEquals(
                listOf("North pin", "Callout", "South pin"),
                order.map { it.contentDescription.toString() },
            )
            val node = overlay.createAccessibilityNodeInfo()
            assertEquals(3, node.childCount)
            val target = overlay.accessibilityTarget(pins.id, south.id)!!
            val info = target.createAccessibilityNodeInfo()
            assertEquals("South pin", info.contentDescription.toString())
            assertTrue(info.actionList.any { it.id == AccessibilityNodeInfo.ACTION_CLICK })
            assertTrue(info.actionList.any { it.id == AccessibilityNodeInfo.ACTION_LONG_CLICK })
            // The target lies on its annotation.
            val point = map.project(south.point)
            assertEquals(point.x, target.translationX + target.width / 2f, 1.5f)
            assertEquals(point.y, target.translationY + target.height / 2f, 1.5f)
            assertTrue(target.performAccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, null))
            assertTrue(target.performAccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, null))
            assertEquals(listOf("tap South pin", "hold South pin"), activated)
            overlay.forcesAccessibilityTracking = false
            assertEquals(null, overlay.accessibilityTarget(pins.id, south.id))
        }
    }
}
