package dev.tileflow.sdk

import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.net.URI
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
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** A map with a view identifier, so it keeps its camera when the activity is recreated. */
public class CameraHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loaded = CountDownLatch(1)
    val failures = CopyOnWriteArrayList<TileflowErrorCode>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        map =
            TileflowMapView(this).apply {
                id = MAP_ID
                // The tests measure the view itself; system bars do not move the camera here.
                automaticallyAdjustsContentPadding = false
                onEvent = {
                    when (it) {
                        TileflowMapEvent.ContentReady -> loaded.countDown()
                        is TileflowMapEvent.Failed -> failures.add(it.code)
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
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }

    internal companion object {
        const val MAP_ID = 4242
    }
}

/** Run with the online fixture server and `adb reverse tcp:18645 tcp:18645`. */
@RunWith(AndroidJUnit4::class)
public class CameraIntegrationTest {
    private val centre = TileflowCoordinate(-3.70, 40.42)

    private fun loaded(activity: CameraHostActivity) {
        assertTrue(
            "Map did not load. Errors: ${activity.failures}",
            activity.loaded.await(30, TimeUnit.SECONDS),
        )
    }

    /** A five-second ease, started at once, that later calls stop, replace or take over. */
    private fun CoroutineScope.easing(map: TileflowMapView) =
        async(start = CoroutineStart.UNDISPATCHED) {
            map.ease(TileflowCameraUpdate(centre, zoom = 16.0), 5000)
        }

    private fun drag(map: TileflowMapView, fromX: Float, fromY: Float) {
        val down = SystemClock.uptimeMillis()
        fun send(action: Int, x: Float, y: Float) {
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0)
            map.dispatchTouchEvent(event)
            event.recycle()
        }
        send(MotionEvent.ACTION_DOWN, fromX, fromY)
        for (step in 1..8) send(MotionEvent.ACTION_MOVE, fromX + step * 20f, fromY + step * 20f)
        send(MotionEvent.ACTION_UP, fromX + 160f, fromY + 160f)
    }

    @Test
    public fun movementsAnswerWithHowTheyEnded() {
        ActivityScenario.launch(CameraHostActivity::class.java).use { scenario ->
            lateinit var activity: CameraHostActivity
            scenario.onActivity { activity = it }
            loaded(activity)
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    assertEquals(
                        TileflowCameraAnimationResult.FINISHED,
                        map.jump(TileflowCamera(-3.70, 40.42, 14.0)),
                    )
                    assertEquals(14.0, map.currentCamera!!.zoom, 0.01)
                    assertEquals(
                        TileflowCameraAnimationResult.FINISHED,
                        map.fly(TileflowCameraUpdate(zoom = 13.0), TileflowFlyOptions(speed = 4.0)),
                    )
                    // A later movement replaces one in progress.
                    val replaced = easing(map)
                    delay(300)
                    assertTrue(map.isMoving)
                    map.jump(TileflowCameraUpdate(zoom = 12.0))
                    assertEquals(TileflowCameraAnimationResult.CANCELLED, replaced.await())
                    // Stopping the camera cancels the movement.
                    val stopped = easing(map)
                    delay(300)
                    map.stopCamera()
                    assertEquals(TileflowCameraAnimationResult.CANCELLED, stopped.await())
                    // Cancelling the coroutine stops the movement in the renderer.
                    val cancelled = easing(map)
                    delay(300)
                    cancelled.cancel()
                    try {
                        cancelled.await()
                        throw AssertionError("A cancelled movement returned.")
                    } catch (_: CancellationException) {}
                    withTimeout(5_000) { while (map.isMoving) delay(50) }
                    val halted = map.camera().zoom
                    delay(500)
                    assertEquals(halted, map.camera().zoom, 0.001)
                    // A person who drags the map takes it over.
                    val grabbed = easing(map)
                    delay(300)
                    drag(map, map.width / 3f, map.height / 3f)
                    assertEquals(TileflowCameraAnimationResult.INTERRUPTED, grabbed.await())
                    assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
                }
            }
        }
    }

    @Test
    public fun paddingCentresTheCameraAndSteepViewsStillAnswerQueries() {
        ActivityScenario.launch(CameraHostActivity::class.java).use { scenario ->
            lateinit var activity: CameraHostActivity
            scenario.onActivity { activity = it }
            loaded(activity)
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    map.jump(TileflowCamera(-3.70, 40.42, 15.0))
                    val before = map.project(centre)
                    assertEquals(map.height / 2f, before.y, 2f)
                    // A sheet covering the bottom moves the camera's centre up by half its height.
                    val sheet = map.height / 3f
                    map.setContentPadding(0f, 0f, 0f, sheet)
                    assertEquals(sheet, map.effectiveContentPadding.bottom)
                    withTimeout(5_000) {
                        while (abs(map.project(centre).y - (map.height - sheet) / 2f) > 2f)
                            delay(50)
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
                            listOf(
                                TileflowCoordinate(-3.71, 40.41),
                                TileflowCoordinate(-3.69, 40.43),
                            )
                        )!!
                    assertEquals(-3.70, fitted.longitude, 0.001)
                    map.setContentPadding(0f, 0f, 0f, 0f)
                    // Features stay queryable once a steep pitch shows the horizon.
                    map.jump(TileflowCamera(-3.70, 40.42, 16.0, pitch = 80.0))
                    withTimeout(10_000) {
                        while (true) {
                            val point = map.project(centre)
                            if (map.query(point.x, point.y).any { it.layer == "poi" }) break
                            delay(100)
                        }
                    }
                    assertEquals(80.0, map.camera().pitch, 0.5)
                    assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
                }
            }
        }
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
}
