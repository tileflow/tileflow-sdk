package dev.tileflow.sdk

import android.os.SystemClock
import android.view.MotionEvent
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import dev.tileflow.sdk.location.TileflowFollowMode
import dev.tileflow.sdk.location.TileflowFollowModeChange
import dev.tileflow.sdk.location.TileflowFollowModeChangeReason
import dev.tileflow.sdk.location.TileflowLocationOptions
import dev.tileflow.sdk.location.TileflowPuckBearing
import dev.tileflow.sdk.location.TileflowSimulatedLocationProvider
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import kotlin.math.abs
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
 * A simulated route through the real renderer: the puck, following, gestures and replay. Run with
 * the online fixture server and `adb reverse tcp:18645 tcp:18645`.
 */
@RunWith(AndroidJUnit4::class)
public class LocationIntegrationTest {
    private val provider =
        TileflowSimulatedLocationProvider(
            listOf(
                TileflowCoordinate(-3.7010, 40.4200),
                TileflowCoordinate(-3.6990, 40.4200),
                TileflowCoordinate(-3.6990, 40.4210),
            ),
            speed = 15.0,
            horizontalAccuracy = 20.0,
            playsAutomatically = false,
        )

    private suspend fun waitFor(message: String, condition: () -> Boolean) {
        withTimeout(10_000) { while (!condition()) delay(50) }
        assertTrue(message, condition())
    }

    /** Whether the camera's centre is within a metre of a coordinate. */
    private fun centred(map: TileflowMapView, coordinate: TileflowCoordinate): Boolean {
        val camera = map.currentCamera ?: return false
        return abs(camera.longitude - coordinate.longitude) < 1e-5 &&
            abs(camera.latitude - coordinate.latitude) < 1e-5
    }

    private suspend fun assertPuck(map: TileflowMapView, coordinate: TileflowCoordinate) {
        var observed = emptyList<TileflowRenderedFeature>()
        repeat(50) {
            val point = map.project(coordinate)
            observed = map.query(point.x, point.y)
            if (observed.any { it.layer == "__tileflow_location_dot" }) return
            delay(100)
        }
        throw AssertionError("The puck is not at $coordinate: $observed")
    }

    @Test
    public fun aSimulatedRouteMovesThePuckAndTheCameraThatFollowsIt() {
        ActivityScenario.launch(CameraHostActivity::class.java).use { scenario ->
            lateinit var activity: CameraHostActivity
            scenario.onActivity { activity = it }
            assertTrue(activity.loaded.await(30, TimeUnit.SECONDS))
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    val reasons = CopyOnWriteArrayList<TileflowCameraChangeReason>()
                    val changes = CopyOnWriteArrayList<TileflowFollowModeChange>()
                    var loads = 1
                    map.onEvent = {
                        when (it) {
                            is TileflowMapEvent.CameraChanged -> reasons += it.change.reason
                            is TileflowMapEvent.FollowModeChanged -> changes += it.change
                            TileflowMapEvent.ContentReady -> loads += 1
                            else -> Unit
                        }
                    }
                    map.locationProvider = provider
                    map.setOptions(
                        TileflowMapOptions(
                            events = TileflowEventOptions(TileflowEventLevel.CAMERA),
                            location =
                                TileflowLocationOptions(
                                    enabled = true,
                                    puckBearing = TileflowPuckBearing.COURSE,
                                    followZoom = 16.0,
                                ),
                        )
                    )
                    val start = map.latestLocation!!.coordinate
                    assertPuck(map, start)

                    // Following zooms in and keeps the location at the centre as the route plays.
                    map.followMode = TileflowFollowMode.POSITION
                    waitFor("following started") {
                        abs((map.currentCamera?.zoom ?: 0.0) - 16) < 0.01 &&
                            !map.isMoving &&
                            centred(map, start)
                    }
                    reasons.clear()
                    repeat(4) {
                        provider.advance(1000)
                        delay(400)
                    }
                    val latest = map.latestLocation!!.coordinate
                    waitFor("following the route") { !map.isMoving && centred(map, latest) }
                    assertEquals(setOf(TileflowCameraChangeReason.LOCATION), reasons.toSet())
                    assertPuck(map, latest)

                    // The course mode turns the map with the travel: east is up on the first leg.
                    map.followMode = TileflowFollowMode.COURSE
                    waitFor("turned with the course") {
                        abs((map.currentCamera?.bearing ?: 0.0) - 90) < 0.5 && !map.isMoving
                    }

                    // A person dragging the map ends following and says so.
                    val down = SystemClock.uptimeMillis()
                    val startX = map.width / 3f
                    val dragWidth = map.width / 3f
                    fun send(action: Int, x: Float) {
                        val event =
                            MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, map.height / 2f, 0)
                        map.dispatchTouchEvent(event)
                        event.recycle()
                    }
                    send(MotionEvent.ACTION_DOWN, startX)
                    for (step in 1..8) {
                        send(MotionEvent.ACTION_MOVE, startX + step * dragWidth / 8)
                        delay(16)
                    }
                    send(MotionEvent.ACTION_UP, startX + dragWidth)
                    waitFor("a gesture ended following") {
                        map.followMode == TileflowFollowMode.NONE
                    }
                    assertEquals(
                        listOf(
                            TileflowFollowModeChange(
                                TileflowFollowMode.NONE,
                                TileflowFollowModeChangeReason.GESTURE,
                            )
                        ),
                        changes.toList(),
                    )

                    // The recenter button follows again, with the mode followed last.
                    map.recenterTapped()
                    assertEquals(TileflowFollowMode.COURSE, map.followMode)
                    val resumed = map.latestLocation!!.coordinate
                    waitFor("following again") { !map.isMoving && centred(map, resumed) }

                    // A new renderer receives the location and the follow mode again.
                    map.reload()
                    waitFor("reloaded") { loads == 2 }
                    assertPuck(map, resumed)
                    val moved = provider.advance(2000).coordinate
                    waitFor("following after a reload") { !map.isMoving && centred(map, moved) }
                    assertEquals(TileflowFollowMode.COURSE, map.followMode)
                    assertTrue("${activity.failures}", activity.failures.isEmpty())
                }
            }
        }
    }
}
