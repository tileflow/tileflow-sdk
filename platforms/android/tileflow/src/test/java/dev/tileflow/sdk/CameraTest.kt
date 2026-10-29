package dev.tileflow.sdk

import android.app.Activity
import android.os.Parcel
import android.os.Parcelable
import android.util.SparseArray
import android.os.SystemClock
import android.view.AbsSavedState
import android.view.MotionEvent
import android.widget.FrameLayout
import androidx.compose.runtime.saveable.SaverScope
import java.util.Locale
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
public class CameraTest {
    private fun invalid(block: () -> Unit) {
        val error = assertThrows(TileflowMapException::class.java) { block() }
        assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
    }

    @Test
    public fun updatesAnimationsAndLimitsHaveTheirWireForm() {
        assertEquals(
            """{"center":{"longitude":-3.7,"latitude":40.42},"zoom":14,"pitch":80}""",
            TileflowCameraUpdate(TileflowCoordinate(-3.7, 40.42), zoom = 14.0, pitch = 80.0)
                .json()
                .toString(),
        )
        assertEquals("""{"bearing":0}""", TileflowCameraUpdate(bearing = 0.0).json().toString())
        assertEquals(
            TileflowCamera(1.0, 2.0, 3.0, 4.0, 5.0),
            TileflowCameraUpdate(TileflowCamera(1.0, 2.0, 3.0, 4.0, 5.0))
                .appliedTo(TileflowCamera(0.0, 0.0, 0.0)),
        )
        invalid { TileflowCameraUpdate(pitch = 86.0).json() }
        invalid { TileflowCameraUpdate(TileflowCoordinate(181.0, 0.0)).json() }

        assertEquals("""{"type":"jump"}""", TileflowCameraAnimation.None.json().toString())
        assertEquals(
            """{"type":"ease","duration":300,"easing":[0,0,1,1]}""",
            TileflowCameraAnimation.Ease(300, TileflowEasing.LINEAR).json().toString(),
        )
        val fly = TileflowCameraAnimation.Fly(TileflowFlyOptions(minZoom = 3.0)).json()
        assertEquals("fly", fly.getString("type"))
        assertEquals(1.42, fly.getDouble("curve"), 0.0)
        assertEquals(3.0, fly.getDouble("minZoom"), 0.0)
        assertFalse(fly.has("duration"))
        // Every movement answers within a request's time limit.
        invalid { TileflowCameraAnimation.Ease(20_001).json() }
        invalid { TileflowCameraAnimation.Fly(TileflowFlyOptions(durationMillis = -1)).json() }
        invalid { TileflowCameraAnimation.Ease(easing = TileflowEasing(1.5, 0.0, 0.5, 1.0)).json() }

        val limits =
            TileflowCameraLimits(
                    maxZoom = 16.0,
                    bounds = TileflowBounds(170.0, -10.0, -170.0, 10.0),
                )
                .json()
        assertEquals(85.0, limits.getDouble("maxPitch"), 0.0)
        assertEquals(-170.0, limits.getJSONObject("bounds").getDouble("east"), 0.0)
        assertTrue(TileflowCameraLimits().json().isNull("bounds"))
        invalid { TileflowCameraLimits(minZoom = 10.0, maxZoom = 5.0).json() }
        invalid { TileflowCameraLimits(maxPitch = 90.0).json() }
    }

    @Test
    public fun optionsCarryGesturesLimitsAndTheAttributionCorner() {
        val options =
            TileflowMapOptions(
                gestures = TileflowGestures(doubleTapZoomDelta = 2.0, cooperative = true),
                controls =
                    TileflowMapControls(attributionPosition = TileflowControlPosition.BOTTOM_START),
            )
        val json = options.json()
        assertFalse(json.has("controls"))
        assertEquals("bottom-left", json.getString("attribution"))
        assertEquals("bottom-right", options.json(rightToLeft = true).getString("attribution"))
        assertEquals(true, json.getJSONObject("gestures").getBoolean("cooperative"))
        assertEquals(2.0, json.getJSONObject("gestures").getDouble("doubleTapZoomDelta"), 0.0)
        assertEquals(24.0, json.getJSONObject("limits").getDouble("maxZoom"), 0.0)
        invalid {
            TileflowMapOptions(gestures = TileflowGestures(doubleTapZoomDelta = 8.0)).validate()
        }
        assertFalse(TileflowGestures.NONE.movesMap)
        assertEquals("top-right", TileflowControlPosition.TOP_END.corner(false))
        assertEquals("top-left", TileflowControlPosition.TOP_END.corner(true))
    }

    @Test
    public fun enclosingBoundsCrossTheAntimeridianWhenThatIsNarrower() {
        assertNull(TileflowBounds.enclosing(emptyList()))
        assertEquals(
            TileflowBounds(-3.8, 40.3, -3.6, 40.5),
            TileflowBounds.enclosing(
                listOf(TileflowCoordinate(-3.6, 40.3), TileflowCoordinate(-3.8, 40.5))
            ),
        )
        assertEquals(
            TileflowBounds(170.0, -10.0, -170.0, 10.0),
            TileflowBounds.enclosing(
                listOf(TileflowCoordinate(170.0, -10.0), TileflowCoordinate(-170.0, 10.0))
            ),
        )
    }

    @Test
    public fun theScaleBarShowsTheLongestRoundDistanceThatFits() {
        val equator = TileflowCamera(0.0, 0.0, 10.0)
        // 40 075 016.686 m / (512 × 2¹⁰) ≈ 76.44 m per CSS pixel: 100 pixels hold 7.64 km.
        val metric = ScaleBarMeasure.of(equator, 100.0, imperial = false)
        assertEquals(ScaleBarMeasure.Unit.KILOMETERS, metric.unit)
        assertEquals(5.0, metric.value, 0.0)
        assertEquals(65.4, metric.length, 0.1)
        assertEquals("5 km", metric.label(Locale.US))
        assertEquals("5 kilometers", metric.spoken(Locale.US))
        val imperial = ScaleBarMeasure.of(equator, 100.0, imperial = true)
        assertEquals(ScaleBarMeasure.Unit.MILES, imperial.unit)
        assertEquals(2.0, imperial.value, 0.0)
        val close = ScaleBarMeasure.of(TileflowCamera(0.0, 60.0, 20.0), 100.0, imperial = true)
        assertEquals(ScaleBarMeasure.Unit.FEET, close.unit)
        assertTrue(close.length <= 100.0)
        assertTrue(ScaleBarMeasure.imperial(TileflowScaleBarUnits.AUTOMATIC, Locale.US))
        assertTrue(ScaleBarMeasure.imperial(TileflowScaleBarUnits.AUTOMATIC, Locale.UK))
        assertFalse(ScaleBarMeasure.imperial(TileflowScaleBarUnits.AUTOMATIC, Locale.GERMANY))
        assertFalse(ScaleBarMeasure.imperial(TileflowScaleBarUnits.METRIC, Locale.US))
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    @Test
    public fun theApplicationReceivesCameraEventsAtItsLevelAndInterval() = runTest {
        val gate = CameraEventGate(this, now = { testScheduler.currentTime })
        val delivered = mutableListOf<TileflowCameraChange>()
        fun change(phase: TileflowCameraChangePhase, zoom: Double) =
            TileflowCameraChange(
                TileflowCamera(0.0, 0.0, zoom),
                TileflowCameraChangeReason.GESTURE,
                phase,
            )
        val essential = TileflowEventOptions()
        gate.receive(change(TileflowCameraChangePhase.STARTED, 1.0), essential) { delivered += it }
        assertTrue(gate.isMoving)
        gate.receive(change(TileflowCameraChangePhase.MOVING, 2.0), essential) { delivered += it }
        gate.receive(change(TileflowCameraChangePhase.ENDED, 3.0), essential) { delivered += it }
        assertFalse(gate.isMoving)
        assertEquals(listOf(3.0), delivered.map { it.camera.zoom })

        delivered.clear()
        val continuous = TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 100)
        gate.receive(change(TileflowCameraChangePhase.STARTED, 1.0), continuous) { delivered += it }
        for (zoom in listOf(2.0, 3.0, 4.0)) {
            gate.receive(change(TileflowCameraChangePhase.MOVING, zoom), continuous) {
                delivered += it
            }
            advanceTimeBy(30)
        }
        // The first update arrives at once; the latest of the interval when it ends.
        assertEquals(listOf(1.0, 2.0), delivered.map { it.camera.zoom })
        advanceTimeBy(20)
        runCurrent()
        assertEquals(listOf(1.0, 2.0, 4.0), delivered.map { it.camera.zoom })
        gate.receive(change(TileflowCameraChangePhase.MOVING, 5.0), continuous) { delivered += it }
        gate.receive(change(TileflowCameraChangePhase.ENDED, 6.0), continuous) { delivered += it }
        advanceTimeBy(500)
        // The settled camera supersedes an update still waiting for its interval.
        assertEquals(listOf(1.0, 2.0, 4.0, 6.0), delivered.map { it.camera.zoom })
    }

    @Test
    public fun theCameraStateSavesItsCameraAndNeverEchoesTheMap() {
        val camera = TileflowCamera(-3.7, 40.42, 13.0, 20.0, 40.0)
        val state = TileflowCameraState(camera)
        val scope = SaverScope { true }
        val saved = with(TileflowCameraState.Saver) { scope.save(state) }!!
        assertEquals(camera, TileflowCameraState.Saver.restore(saved)?.camera)
        assertNull(
            TileflowCameraState.Saver.restore(
                    with(TileflowCameraState.Saver) { scope.save(TileflowCameraState()) }!!
                )
                ?.camera
        )
        val moved = camera.copy(zoom = 15.0)
        state.record(
            TileflowCameraChange(
                moved,
                TileflowCameraChangeReason.GESTURE,
                TileflowCameraChangePhase.ENDED,
            )
        )
        // The map's own camera is already where the map is; only the application's writes move it.
        assertEquals(state.synced, state.camera)
        state.camera = camera
        assertTrue(state.synced != state.camera)
    }

    @Test
    public fun aViewKeepsItsCameraInItsSavedState() {
        val camera = TileflowCamera(-3.7, 40.42, 13.0, 20.0, 40.0)
        val parcel = Parcel.obtain()
        TileflowMapView.SavedState(AbsSavedState.EMPTY_STATE, camera).writeToParcel(parcel, 0)
        parcel.setDataPosition(0)
        assertEquals(camera, TileflowMapView.SavedState.CREATOR.createFromParcel(parcel).camera)
        parcel.recycle()

        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val view = TileflowMapView(activity)
        try {
            runBlocking {
                assertEquals(
                    TileflowCameraAnimationResult.FINISHED,
                    view.move(camera),
                )
                // A partial update needs the renderer's camera.
                val error =
                    assertThrows(TileflowMapException::class.java) {
                        runBlocking { view.move(TileflowCameraUpdate(zoom = 3.0)) }
                    }
                assertEquals(TileflowErrorCode.NOT_READY, error.code)
            }
            assertEquals(camera, view.currentCamera)
            // Views with an identifier keep their camera across recreation, as other views do.
            val states = SparseArray<Parcelable>()
            view.id = 42
            view.saveHierarchyState(states)
            val restored = TileflowMapView(activity)
            restored.id = 42
            restored.restoreHierarchyState(states)
            assertEquals(camera, restored.currentCamera)
            restored.destroy()
        } finally {
            view.destroy()
        }
    }

    @Test
    public fun theMapTakesItsTouchesFromScrollingParentsUnlessFilteredOrCooperative() {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val claims = mutableListOf<Boolean>()
        val parent =
            object : FrameLayout(activity) {
                override fun requestDisallowInterceptTouchEvent(disallowIntercept: Boolean) {
                    claims += disallowIntercept
                    super.requestDisallowInterceptTouchEvent(disallowIntercept)
                }
            }
        val view = TileflowMapView(activity)
        parent.addView(view, FrameLayout.LayoutParams(400, 400))
        activity.setContentView(parent)
        fun touch(action: Int, pointers: Int = 1): Boolean {
            val time = SystemClock.uptimeMillis()
            val properties =
                Array(pointers) { MotionEvent.PointerProperties().apply { id = it } }
            val coordinates =
                Array(pointers) {
                    MotionEvent.PointerCoords().apply {
                        x = 100f + it * 50
                        y = 100f
                    }
                }
            val event =
                MotionEvent.obtain(
                    time, time, action, pointers, properties, coordinates,
                    0, 0, 1f, 1f, 0, 0, 0, 0,
                )
            return view.dispatchTouchEvent(event).also { event.recycle() }
        }
        try {
            touch(MotionEvent.ACTION_DOWN)
            assertEquals(listOf(true), claims)
            claims.clear()
            runBlocking {
                view.setOptions(
                    TileflowMapOptions(gestures = TileflowGestures(cooperative = true))
                )
            }
            touch(MotionEvent.ACTION_DOWN)
            assertEquals(emptyList<Boolean>(), claims)
            val second = 1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT
            touch(MotionEvent.ACTION_POINTER_DOWN or second, 2)
            assertEquals(listOf(true), claims)
            claims.clear()
            runBlocking { view.setOptions(TileflowMapOptions(gestures = TileflowGestures.NONE)) }
            touch(MotionEvent.ACTION_DOWN)
            assertEquals(emptyList<Boolean>(), claims)
            view.touchFilter = { x, _ -> x > 200 }
            // A filtered touch is left to the views around the map.
            assertFalse(touch(MotionEvent.ACTION_DOWN))
            // Content padding is in pixels and must be positive.
            invalid { view.setContentPadding(0f, -1f, 0f, 0f) }
            view.automaticallyAdjustsContentPadding = false
            view.setContentPadding(0f, 10f, 0f, 300f)
            assertEquals(TileflowEdgeInsets(0f, 10f, 0f, 300f), view.effectiveContentPadding)
            assertEquals(
                JSONObject()
                    .put("top", 5.0)
                    .put("left", 0.0)
                    .put("bottom", 150.0)
                    .put("right", 0.0)
                    .toString(),
                view.effectiveContentPadding.css(2f).toString(),
            )
        } finally {
            view.destroy()
        }
    }
}
