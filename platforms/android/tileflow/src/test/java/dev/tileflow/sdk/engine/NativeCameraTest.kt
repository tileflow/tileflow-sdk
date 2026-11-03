package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowBounds
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowCoordinate
import kotlin.math.ln
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The camera arithmetic of the native engine: flight durations and animations, visible bounds as
 * the web reports them, zooming around a point, offsets on screen and the bounds a camera's target
 * keeps within.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeCameraTest {
    private val width = 411.0
    private val height = 914.0

    private fun duration(start: TileflowCamera, end: TileflowCamera, speed: Double = 1.2) =
        NativeCameraMath.flightDuration(start, end, width, height, speed, 1.42, null)

    @Test
    fun aFlightLastsItsPathLengthOverItsSpeed() {
        val start = TileflowCamera(-3.70, 40.42, 12.0)
        // Zooming in place travels ln(w0 / w1) / ρ screenfuls.
        assertEquals(ln(4.0) / 1.42 / 1.2, duration(start, start.copy(zoom = 14.0)), 1e-9)
        assertEquals(0.0, duration(start, start), 0.0)
        // A longer way takes longer; twice the speed takes half the time; the way back is as long.
        val paris = TileflowCamera(2.35, 48.86, 12.0)
        val tokyo = TileflowCamera(139.70, 35.70, 12.0)
        val near = duration(start, paris)
        assertTrue(duration(start, tokyo) > near)
        assertEquals(near / 2, duration(start, paris, speed = 2.4), 1e-9)
        assertEquals(near, duration(paris, start), 1e-9)
        // The shorter way round crosses the antimeridian.
        assertTrue(duration(TileflowCamera(179.9, 0.0, 10.0), TileflowCamera(-179.9, 0.0, 10.0)) < 5)
    }

    @Test
    fun animationsJumpWhenTooLongOrWhenMotionIsReduced() {
        val start = TileflowCamera(-3.70, 40.42, 16.0)
        val end = TileflowCamera(139.70, 35.70, 16.0)
        fun animation(value: JSONObject, reduced: Boolean = false) =
            NativeCamera.animation(value, start, end, width, height, reduced)
        val slow = JSONObject().put("type", "fly").put("speed", 0.01)
        assertEquals(NativeCamera.Animation.Jump, animation(slow))
        val fly = animation(JSONObject().put("type", "fly"))
        assertTrue("$fly", fly is NativeCamera.Animation.Fly && fly.millis in 1..20_000)
        val ease = JSONObject().put("type", "ease").put("duration", 400)
        assertEquals(NativeCamera.Animation.Ease(400, true), animation(ease))
        assertEquals(NativeCamera.Animation.Jump, animation(ease, reduced = true))
        val linear = JSONObject(ease.toString()).put("easing", JSONArray(listOf(0, 0, 1, 1)))
        assertEquals(NativeCamera.Animation.Ease(400, false), animation(linear))
    }

    @Test
    fun visibleBoundsAreReportedAsOnTheWeb() {
        assertEquals(
            TileflowBounds(-3.8, 40.3, -3.6, 40.5),
            NativeCameraMath.normalized(-3.8, 40.3, -3.6, 40.5),
        )
        // Across the antimeridian the east edge lies west of the west edge.
        val across = NativeCameraMath.normalized(170.0, -10.0, 190.0, 10.0)
        assertEquals(170.0, across.west, 1e-9)
        assertEquals(-170.0, across.east, 1e-9)
        val unwrapped = NativeCameraMath.normalized(-190.0, -10.0, -170.0, 10.0)
        assertEquals(170.0, unwrapped.west, 1e-9)
        assertEquals(-170.0, unwrapped.east, 1e-9)
        // A view wider than the world shows all of it.
        assertEquals(
            TileflowBounds(-180.0, -80.0, 180.0, 80.0),
            NativeCameraMath.normalized(-300.0, -80.0, 300.0, 80.0),
        )
    }

    @Test
    fun zoomingAroundAPointKeepsItInPlace() {
        val center = TileflowCoordinate(-3.70, 40.42)
        val anchor = TileflowCoordinate(-3.68, 40.43)
        val zoomed = NativeCameraMath.center(2.0, anchor, center)
        // The anchor's offset from the centre, in the world, shrinks by 2².
        val (ax, ay) = NativeCameraMath.project(anchor)
        val (cx, cy) = NativeCameraMath.project(center)
        val (zx, zy) = NativeCameraMath.project(zoomed)
        assertEquals((ax - cx) / 4, ax - zx, 1e-12)
        assertEquals((ay - cy) / 4, ay - zy, 1e-12)
    }

    @Test
    fun offsetsOnScreenTurnWithTheBearing() {
        val start = TileflowCoordinate(0.0, 0.0)
        // At zoom 0 the world is 512 dp wide: 128 dp to the right is 90° east.
        val east = NativeCameraMath.shifted(start, 128.0, 0.0, 0.0, 0.0)
        assertEquals(90.0, east.longitude, 1e-9)
        assertEquals(0.0, east.latitude, 1e-9)
        // With the top of the screen pointing east, the right of the screen points south.
        val south = NativeCameraMath.shifted(start, 1.0, 0.0, 10.0, 90.0)
        assertEquals(0.0, south.longitude, 1e-9)
        assertTrue(south.latitude < 0)
    }

    @Test
    fun theTargetKeepsHalfAViewInsideTheBounds() {
        val bounds = TileflowBounds(-3.72, 40.40, -3.68, 40.44)
        // At zoom 15 the view fits; the target keeps half a view from each edge.
        val target = NativeCameraMath.targetBounds(bounds, width, height, 15.0)
        val halfWidth = width / 2 / (512 * Math.pow(2.0, 15.0)) * 360
        assertEquals(bounds.west + halfWidth, target.west, 1e-9)
        assertEquals(bounds.east - halfWidth, target.east, 1e-9)
        assertTrue(target.south > bounds.south && target.north < bounds.north)
        assertTrue(target.minZoom in 12.0..15.0)
        // Zoomed out further than the view fits, the target is the bounds' centre.
        val wide = NativeCameraMath.targetBounds(bounds, width, height, 10.0)
        assertEquals(wide.west, wide.east, 1e-12)
        assertEquals(wide.south, wide.north, 1e-12)
        assertEquals(-3.70, wide.west, 1e-9)
    }
}
