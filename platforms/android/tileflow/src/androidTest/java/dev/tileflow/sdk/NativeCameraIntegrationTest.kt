package dev.tileflow.sdk

import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.tileflow.sdk.engine.MapEngineKind
import dev.tileflow.sdk.engine.NativeMapEngine
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** A Compose map, drawn by MapLibre Native, whose camera a [TileflowCameraState] holds. */
public class CameraStateHostActivity : ComponentActivity() {
    val state = TileflowCameraState(TileflowCamera(-3.70, 40.42, 15.0))
    val loaded = CountDownLatch(1)
    val events = CopyOnWriteArrayList<TileflowMapEvent>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(
            ComposeView(this).apply {
                setContent {
                    TileflowMap(
                        NativeViewHostActivity.CITY,
                        Modifier.fillMaxSize(),
                        cameraState = state,
                        onEvent = {
                            events.add(it)
                            if (it == TileflowMapEvent.ContentReady) loaded.countDown()
                        },
                    )
                }
            }
        )
    }
}

/**
 * [CameraIntegrationTest] on MapLibre Native, with the fixture's city map built for the native
 * renderer: movements and how they end, padding, limits, controls, gestures, touches, the steepest
 * pitch and a Compose camera state. Touches are motion events dispatched to the map view, as a
 * person's are.
 *
 * Run with the online fixture server and `adb reverse tcp:18645 tcp:<port>`.
 */
@RunWith(AndroidJUnit4::class)
public class NativeCameraIntegrationTest {
    private val initialEngineKind = TileflowMapView.defaultEngineKind
    private val centre = TileflowCoordinate(-3.70, 40.42)

    @Before
    public fun native() {
        Fixture.require("${Fixture.ORIGIN}/native/manifest.json")
        CameraHostActivity.native = true
    }

    @After
    public fun webView() {
        CameraHostActivity.native = false
        TileflowMapView.defaultEngineKind = initialEngineKind
    }

    private fun withMap(block: suspend CoroutineScope.(CameraHostActivity, TileflowMapView) -> Unit) {
        ActivityScenario.launch(CameraHostActivity::class.java).use { scenario ->
            lateinit var activity: CameraHostActivity
            scenario.onActivity { activity = it }
            loaded(activity)
            runBlocking { withContext(Dispatchers.Main) { block(activity, activity.map) } }
            assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
        }
    }

    private fun loaded(activity: CameraHostActivity) {
        assertTrue(
            "Map did not load. Errors: ${activity.failures}",
            activity.loaded.await(60, TimeUnit.SECONDS),
        )
    }

    /** A five-second ease, started at once, that later calls stop, replace or take over. */
    private fun CoroutineScope.easing(map: TileflowMapView) =
        async(start = CoroutineStart.UNDISPATCHED) {
            map.ease(TileflowCameraUpdate(centre, zoom = 16.0), 5000)
        }

    private fun send(map: View, down: Long, action: Int, x: Float, y: Float, time: Long? = null) {
        val event = MotionEvent.obtain(down, time ?: SystemClock.uptimeMillis(), action, x, y, 0)
        map.dispatchTouchEvent(event)
        event.recycle()
    }

    /** Two quick taps, sent at once with their times 80 ms apart, so a busy device keeps them a pair. */
    private fun doubleTap(map: View, x: Float, y: Float) {
        val first = SystemClock.uptimeMillis()
        send(map, first, MotionEvent.ACTION_DOWN, x, y, first)
        send(map, first, MotionEvent.ACTION_UP, x, y, first + 40)
        val second = first + 120
        send(map, second, MotionEvent.ACTION_DOWN, x, y, second)
        send(map, second, MotionEvent.ACTION_UP, x, y, second + 40)
    }

    private fun drag(map: View, fromX: Float, fromY: Float, dx: Float = 20f, dy: Float = 20f) {
        val down = SystemClock.uptimeMillis()
        send(map, down, MotionEvent.ACTION_DOWN, fromX, fromY)
        for (step in 1..8) send(map, down, MotionEvent.ACTION_MOVE, fromX + step * dx, fromY + step * dy)
        send(map, down, MotionEvent.ACTION_UP, fromX + 8 * dx, fromY + 8 * dy)
    }

    private suspend fun press(map: View, x: Float, y: Float, millis: Long = 60) {
        val down = SystemClock.uptimeMillis()
        send(map, down, MotionEvent.ACTION_DOWN, x, y)
        delay(millis)
        send(map, down, MotionEvent.ACTION_UP, x, y)
    }

    private fun CameraHostActivity.reasons() =
        events.filterIsInstance<TileflowMapEvent.CameraChanged>().map { it.change.reason }.toSet()

    /** Waits for a camera change that settles. */
    private suspend fun CameraHostActivity.settled() {
        withTimeout(10_000) {
            while (events.none { it is TileflowMapEvent.CameraChanged && it.change.isFinal }) delay(50)
        }
    }

    private suspend fun TileflowMapView.settle() {
        withTimeout(10_000) { while (isMoving) delay(50) }
    }

    @Test
    public fun movementsAnswerWithHowTheyEnded(): Unit = withMap { activity, map ->
        assertEquals(
            TileflowCameraAnimationResult.FINISHED,
            map.jump(TileflowCamera(-3.70, 40.42, 14.0)),
        )
        assertEquals(14.0, map.currentCamera!!.zoom, 0.01)
        assertEquals(
            TileflowCameraAnimationResult.FINISHED,
            map.fly(TileflowCameraUpdate(zoom = 13.0), TileflowFlyOptions(speed = 4.0)),
        )
        assertEquals(13.0, map.currentCamera!!.zoom, 0.01)
        // A later movement replaces one in progress.
        val replaced = easing(map)
        delay(300)
        assertTrue(map.isMoving)
        map.jump(TileflowCameraUpdate(zoom = 12.0))
        assertEquals(TileflowCameraAnimationResult.CANCELLED, replaced.await())
        // Stopping the camera cancels the movement, and the camera stays where it stopped.
        val stopped = easing(map)
        delay(300)
        map.stopCamera()
        assertEquals(TileflowCameraAnimationResult.CANCELLED, stopped.await())
        map.settle()
        val held = map.camera().zoom
        delay(500)
        assertEquals(held, map.camera().zoom, 0.001)
        // Cancelling the coroutine stops the movement in the renderer.
        val cancelled = easing(map)
        delay(300)
        cancelled.cancel()
        try {
            cancelled.await()
            throw AssertionError("A cancelled movement returned.")
        } catch (_: CancellationException) {}
        map.settle()
        val halted = map.camera().zoom
        delay(500)
        assertEquals(halted, map.camera().zoom, 0.001)
        // A person who drags the map takes it over.
        val grabbed = easing(map)
        delay(300)
        drag(map, map.width / 3f, map.height / 3f)
        assertEquals(TileflowCameraAnimationResult.INTERRUPTED, grabbed.await())
        // A flight longer than the limit jumps, and still finishes at its target.
        assertEquals(
            TileflowCameraAnimationResult.FINISHED,
            map.fly(TileflowCamera(139.7, 35.7, 16.0), TileflowFlyOptions(speed = 0.01)),
        )
        assertEquals(139.7, map.currentCamera!!.longitude, 0.001)
    }

    @Test
    public fun paddingCentresTheCameraAndSteepViewsStillAnswerQueries(): Unit = withMap { activity, map ->
        map.jump(TileflowCamera(-3.70, 40.42, 15.0))
        val before = map.project(centre)
        assertEquals(map.height / 2f, before.y, 2f)
        // A sheet covering the bottom moves the camera's centre up by half its height.
        val sheet = map.height / 3f
        map.setContentPadding(0f, 0f, 0f, sheet)
        assertEquals(sheet, map.effectiveContentPadding.bottom)
        withTimeout(10_000) {
            while (abs(map.project(centre).y - (map.height - sheet) / 2f) > 2f) delay(50)
        }
        // Fitting bounds keeps them inside the uncovered part of the view.
        map.fit(TileflowBounds(-3.71, 40.41, -3.69, 40.43), TileflowEdgeInsets.ZERO)
        val north = map.project(TileflowCoordinate(-3.70, 40.43))
        val south = map.project(TileflowCoordinate(-3.70, 40.41))
        assertTrue("${north.y}", north.y >= -2f)
        assertTrue("${south.y}", south.y <= map.height - sheet + 2f)
        // The whole view shows at least the fitted bounds.
        val visible = map.visibleBounds()
        assertTrue("$visible", visible.west <= -3.7099 && visible.east >= -3.6901)
        assertTrue("$visible", visible.south < 40.41 && visible.north > 40.43)
        val fitted =
            map.cameraFitting(
                listOf(TileflowCoordinate(-3.71, 40.41), TileflowCoordinate(-3.69, 40.43))
            )!!
        assertEquals(-3.70, fitted.longitude, 0.001)
        map.setContentPadding(0f, 0f, 0f, 0f)
        // Features stay queryable at the steepest pitch MapLibre Android draws.
        map.jump(TileflowCamera(-3.70, 40.42, 16.0, pitch = 80.0))
        withTimeout(10_000) {
            while (true) {
                val point = map.project(centre)
                if (map.query(point.x, point.y).any { it.layer.startsWith("tileflow-buildings") })
                    break
                delay(100)
            }
        }
        assertEquals(60.0, map.camera().pitch, 0.5)
    }

    @Test
    public fun aRecreatedActivityKeepsTheCamera() {
        val camera = TileflowCamera(-3.69, 40.43, 15.5, bearing = 30.0, pitch = 20.0)
        ActivityScenario.launch(CameraHostActivity::class.java).use { scenario ->
            lateinit var activity: CameraHostActivity
            scenario.onActivity { activity = it }
            loaded(activity)
            runBlocking { withContext(Dispatchers.Main) { activity.map.jump(camera) } }
            scenario.recreate()
            lateinit var recreated: CameraHostActivity
            scenario.onActivity { recreated = it }
            assertFalse(recreated === activity)
            loaded(recreated)
            runBlocking {
                withContext(Dispatchers.Main) {
                    val restored = recreated.map.camera()
                    assertEquals(camera.longitude, restored.longitude, 0.0001)
                    assertEquals(camera.zoom, restored.zoom, 0.01)
                    assertEquals(camera.bearing, restored.bearing, 0.01)
                    assertEquals(camera.pitch, restored.pitch, 0.01)
                }
            }
        }
    }

    @Test
    public fun controlsGesturesAndTouchesReachTheApplication(): Unit = withMap { activity, map ->
        var options =
            TileflowMapOptions(
                controls = TileflowMapControls(scaleBar = true, recenterButton = true),
                events = TileflowEventOptions(TileflowEventLevel.CAMERA),
            )
        map.setOptions(options)
        val engine = map.readyEngine as NativeMapEngine
        val settings = engine.map!!.uiSettings
        assertFalse("MapLibre's compass stays hidden.", settings.isCompassEnabled)
        val controls = map.controlsView
        assertEquals("The adaptive compass hides while north is up.", View.GONE, controls.compass.visibility)
        map.jump(TileflowCameraUpdate(bearing = 45.0))
        assertEquals(View.VISIBLE, controls.compass.visibility)
        activity.events.clear()
        controls.compass.performClick()
        withTimeout(10_000) {
            while (abs(map.currentCamera!!.bearing) > 0.001 || map.isMoving) delay(50)
        }
        assertEquals("The compass moves the map for a person.", setOf(TileflowCameraChangeReason.GESTURE), activity.reasons())
        controls.recenter.performClick()
        assertTrue(activity.events.contains(TileflowMapEvent.RecenterRequested))

        // A touch on a control reaches the control, never the map.
        map.jump(TileflowCameraUpdate(bearing = 45.0))
        activity.events.clear()
        val compass = controls.compass
        press(map, compass.left + compass.width / 2f, compass.top + compass.height / 2f)
        withTimeout(10_000) { while (abs(map.currentCamera!!.bearing) > 0.001 || map.isMoving) delay(50) }
        delay(500)
        assertFalse(activity.events.any { it is TileflowMapEvent.Tap })

        // Taps carry their point and coordinate; a press that holds still is a long press.
        val x = map.width / 3f
        val y = map.height / 3f
        activity.events.clear()
        press(map, x, y)
        withTimeout(10_000) { while (activity.events.none { it is TileflowMapEvent.Tap }) delay(50) }
        val tap = activity.events.filterIsInstance<TileflowMapEvent.Tap>().first()
        assertEquals(x, tap.point.x, 2f)
        assertEquals(y, tap.point.y, 2f)
        val tapped = map.unproject(TileflowPoint(x, y))
        assertEquals(tapped.longitude, tap.coordinate.longitude, 1e-5)
        assertEquals(tapped.latitude, tap.coordinate.latitude, 1e-5)
        activity.events.clear()
        press(map, x, y, millis = 900)
        withTimeout(10_000) { while (activity.events.none { it is TileflowMapEvent.LongPress }) delay(50) }
        delay(500)
        assertFalse(activity.events.any { it is TileflowMapEvent.Tap })

        // Gestures report their start and end at the camera level, and move the map for a person.
        activity.events.clear()
        drag(map, map.width / 2f, map.height / 2f, dx = -15f, dy = 0f)
        withTimeout(10_000) {
            while (TileflowMapEvent.GestureEnded(TileflowGesture.PAN) !in activity.events) delay(50)
        }
        assertTrue(TileflowMapEvent.GestureStarted(TileflowGesture.PAN) in activity.events)
        // MapLibre Android reports camera changes a moment after the touches that cause them.
        activity.settled()
        assertEquals(setOf(TileflowCameraChangeReason.GESTURE), activity.reasons())

        // A double tap zooms by the chosen amount around the point tapped.
        options = options.copy(gestures = TileflowGestures(doubleTapZoomDelta = 2.0))
        map.setOptions(options)
        assertFalse("MapLibre zooms one level per double tap.", settings.isDoubleTapGesturesEnabled)
        val start = map.camera().zoom
        val anchor = map.unproject(TileflowPoint(x, y))
        activity.events.clear()
        doubleTap(map, x, y)
        withTimeout(10_000) {
            while (abs(map.camera().zoom - start - 2) > 0.01 || map.isMoving) delay(50)
        }
        val kept = map.project(anchor)
        assertEquals(x, kept.x, 2f)
        assertEquals(y, kept.y, 2f)
        assertTrue(TileflowMapEvent.GestureStarted(TileflowGesture.ZOOM) in activity.events)
        activity.settled()
        assertEquals(setOf(TileflowCameraChangeReason.GESTURE), activity.reasons())

        // Gestures turn off one by one; a static map still reports taps.
        map.setOptions(options.copy(gestures = TileflowGestures.NONE))
        assertFalse(
            settings.isScrollGesturesEnabled ||
                settings.isZoomGesturesEnabled ||
                settings.isRotateGesturesEnabled ||
                settings.isTiltGesturesEnabled ||
                settings.isDoubleTapGesturesEnabled
        )
        activity.events.clear()
        press(map, x, y)
        withTimeout(10_000) { while (activity.events.none { it is TileflowMapEvent.Tap }) delay(50) }

        // With cooperative gestures one finger does not move the map, and the hint shows.
        map.setOptions(options.copy(gestures = TileflowGestures(cooperative = true)))
        assertTrue(settings.isScrollGesturesEnabled)
        val still = map.camera()
        activity.events.clear()
        drag(map, map.width / 2f, map.height / 2f)
        delay(500)
        assertEquals(still, map.camera())
        assertFalse(activity.events.any { it is TileflowMapEvent.Tap })
        assertEquals(View.VISIBLE, engine.gestures!!.hint.visibility)
    }

    @Test
    public fun theSteepestPitchIs60WithAWarning(): Unit = withMap { activity, map ->
        assertEquals(
            TileflowCameraAnimationResult.FINISHED,
            map.ease(TileflowCameraUpdate(centre, zoom = 16.0, pitch = 85.0), 300),
        )
        assertEquals(60.0, map.camera().pitch, 0.5)
        assertEquals(60.0, map.currentCamera!!.pitch, 0.5)
        map.jump(TileflowCameraUpdate(pitch = 85.0))
        delay(1_500)
        val warnings =
            activity.events.filterIsInstance<TileflowMapEvent.Warning>().filter {
                it.context.reason == "featureUnavailable" && it.context.feature == "pitchAbove60"
            }
        assertEquals("$warnings", 1, warnings.size)
        assertEquals(1, warnings.single().occurrences)
    }

    @Test
    public fun limitsKeepTheCameraAndTheViewInside(): Unit = withMap { activity, map ->
        map.setOptions(
            TileflowMapOptions(cameraLimits = TileflowCameraLimits(maxZoom = 15.0, maxPitch = 45.0))
        )
        withTimeout(10_000) { while (map.currentCamera!!.zoom > 15.001) delay(50) }
        map.jump(TileflowCamera(-3.70, 40.42, 18.0, pitch = 55.0))
        assertEquals(15.0, map.camera().zoom, 0.001)
        assertEquals(45.0, map.camera().pitch, 0.01)
        val framed =
            map.cameraFitting(
                listOf(TileflowCoordinate(-3.7005, 40.4195), TileflowCoordinate(-3.6995, 40.4205))
            )
        assertEquals("The limits cap the fitted zoom.", 15.0, framed!!.zoom, 0.001)
        // Bounds keep the whole view inside them, also when zooming out.
        val bounds = TileflowBounds(-3.72, 40.40, -3.68, 40.44)
        map.setOptions(TileflowMapOptions(cameraLimits = TileflowCameraLimits(bounds = bounds)))
        for (camera in listOf(TileflowCamera(-3.60, 40.42, 15.0), TileflowCamera(-3.70, 40.42, 10.0))) {
            map.jump(camera)
            delay(300)
            val visible = map.visibleBounds()
            assertTrue("$visible", visible.west >= bounds.west - 1e-3 && visible.east <= bounds.east + 1e-3)
            assertTrue("$visible", visible.south >= bounds.south - 1e-3 && visible.north <= bounds.north + 1e-3)
        }
        // Without bounds the camera moves freely again.
        map.setOptions(TileflowMapOptions())
        map.jump(TileflowCamera(-3.60, 40.42, 15.0))
        assertEquals(-3.60, map.camera().longitude, 0.0001)
    }

    @Test
    public fun aCameraStateFollowsTheMapAndMovesItWithoutEchoes() {
        TileflowMapView.defaultEngineKind = MapEngineKind.NATIVE
        ActivityScenario.launch(CameraStateHostActivity::class.java).use { scenario ->
            lateinit var activity: CameraStateHostActivity
            scenario.onActivity { activity = it }
            assertTrue("Map did not load.", activity.loaded.await(60, TimeUnit.SECONDS))
            runBlocking {
                withContext(Dispatchers.Main) {
                    val state = activity.state
                    assertEquals(15.0, state.camera!!.zoom, 0.001)
                    // The application writes the state: the map moves there.
                    state.camera = TileflowCamera(-3.69, 40.43, 16.0)
                    withTimeout(10_000) {
                        while (activity.events.none {
                            it is TileflowMapEvent.CameraChanged &&
                                it.change.isFinal &&
                                abs(it.change.camera.zoom - 16.0) < 0.001
                        }) delay(50)
                    }
                    delay(300)
                    // The map moves: the state follows, and its own write does not move it again.
                    activity.events.clear()
                    assertEquals(
                        TileflowCameraAnimationResult.FINISHED,
                        state.ease(TileflowCameraUpdate(zoom = 17.0), 300),
                    )
                    withTimeout(10_000) { while (abs(state.camera!!.zoom - 17.0) > 0.001) delay(50) }
                    delay(500)
                    val settled =
                        activity.events.filterIsInstance<TileflowMapEvent.CameraChanged>().count {
                            it.change.isFinal
                        }
                    assertEquals(1, settled)
                    assertFalse(state.isMoving)
                    assertTrue(activity.events.none { it is TileflowMapEvent.Failed })
                }
            }
        }
    }
}
