package dev.tileflow.sdk.engine

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.TextView
import kotlin.math.hypot
import kotlin.math.roundToInt
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.gestures.MoveGestureDetector
import org.maplibre.android.gestures.RotateGestureDetector
import org.maplibre.android.gestures.ShoveGestureDetector
import org.maplibre.android.gestures.StandardScaleGestureDetector
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView

/**
 * What a person does on a map that MapLibre Native draws: which gestures move the camera, taps and
 * long presses with their coordinate, double taps that zoom by the chosen amount, when each gesture
 * starts and ends, and cooperative gestures with their hint.
 *
 * MapLibre's own detectors pan, pinch, rotate, tilt and zoom on double taps, and report taps after
 * the time a double tap allows, and long presses. The SDK turns them on and off, listens to them,
 * and watches the touches MapLibre receives: for double taps of another amount, and, with
 * cooperative gestures, to keep one finger from moving the map.
 */
@SuppressLint("ClickableViewAccessibility")
internal class NativeGestures(
    context: Context,
    private val map: MapLibreMap,
    private val mapView: MapView,
    container: FrameLayout,
    private val camera: NativeCamera,
    private val density: Float,
    private val emit: (String, JSONObject) -> Unit,
) {
    /** The gestures the view's options ask for. */
    data class Settings(
        val pan: Boolean = true,
        val zoom: Boolean = true,
        val rotate: Boolean = true,
        val pitch: Boolean = true,
        val doubleTapZoom: Boolean = true,
        val doubleTapZoomDelta: Double = 1.0,
        val cooperative: Boolean = false,
    ) {
        val doubleTaps: Boolean
            get() = zoom && doubleTapZoom
    }

    var settings: Settings = Settings()
        private set

    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    /** A one-finger touch on a cooperative map that MapLibre no longer receives. */
    private var withheld = false
    private var downX = 0f
    private var downY = 0f

    /** The hint of cooperative gestures, centred over the map. */
    internal val hint =
        TextView(context).apply {
            text = HINT
            setTextColor(Color.WHITE)
            textSize = 15f
            gravity = Gravity.CENTER
            val horizontal = (16 * density).roundToInt()
            val vertical = (10 * density).roundToInt()
            setPadding(horizontal, vertical, horizontal, vertical)
            background =
                GradientDrawable().apply {
                    setColor(Color.argb(166, 0, 0, 0))
                    cornerRadius = 8 * density
                }
            alpha = 0f
            visibility = View.GONE
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
    private val hideHint = Runnable {
        hint.animate().alpha(0f).setDuration(300).withEndAction { hint.visibility = View.GONE }
    }

    private val doubleTaps =
        GestureDetector(
            context,
            object : GestureDetector.SimpleOnGestureListener() {
                override fun onDoubleTap(event: MotionEvent): Boolean {
                    if (!settings.doubleTaps) return false
                    if (settings.doubleTapZoomDelta == 1.0) {
                        // MapLibre zooms one level; the camera reports the gesture.
                        camera.gestureBegan("zoom")
                    } else {
                        camera.zoom(settings.doubleTapZoomDelta, event.x, event.y)
                    }
                    return true
                }
            },
        )

    init {
        map.addOnMoveListener(
            object : MapLibreMap.OnMoveListener {
                override fun onMoveBegin(detector: MoveGestureDetector) = camera.gestureBegan("pan")

                override fun onMove(detector: MoveGestureDetector) = Unit

                override fun onMoveEnd(detector: MoveGestureDetector) = camera.gestureEnded("pan")
            }
        )
        map.addOnScaleListener(
            object : MapLibreMap.OnScaleListener {
                override fun onScaleBegin(detector: StandardScaleGestureDetector) =
                    camera.gestureBegan("zoom", continuous = true)

                override fun onScale(detector: StandardScaleGestureDetector) = Unit

                override fun onScaleEnd(detector: StandardScaleGestureDetector) =
                    camera.gestureEnded("zoom")
            }
        )
        map.addOnRotateListener(
            object : MapLibreMap.OnRotateListener {
                override fun onRotateBegin(detector: RotateGestureDetector) =
                    camera.gestureBegan("rotate")

                override fun onRotate(detector: RotateGestureDetector) = Unit

                override fun onRotateEnd(detector: RotateGestureDetector) =
                    camera.gestureEnded("rotate")
            }
        )
        map.addOnShoveListener(
            object : MapLibreMap.OnShoveListener {
                override fun onShoveBegin(detector: ShoveGestureDetector) =
                    camera.gestureBegan("pitch")

                override fun onShove(detector: ShoveGestureDetector) = Unit

                override fun onShoveEnd(detector: ShoveGestureDetector) =
                    camera.gestureEnded("pitch")
            }
        )
        // A tap arrives once no double tap can claim it; a long press is never also a tap.
        map.addOnMapClickListener {
            report("tap", it)
            false
        }
        map.addOnMapLongClickListener {
            report("longPress", it)
            false
        }
        mapView.setOnTouchListener { _, event -> touched(event) }
        container.addView(
            hint,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.WRAP_CONTENT,
                FrameLayout.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ),
        )
    }

    /** Turns gestures on and off as the view's options say. */
    fun apply(value: JSONObject?) {
        val next =
            if (value == null) Settings()
            else
                Settings(
                    value.optBoolean("pan", true),
                    value.optBoolean("zoom", true),
                    value.optBoolean("rotate", true),
                    value.optBoolean("pitch", true),
                    value.optBoolean("doubleTapZoom", true),
                    value.optDouble("doubleTapZoomDelta", 1.0),
                    value.optBoolean("cooperative", false),
                )
        settings = next
        map.uiSettings.apply {
            isScrollGesturesEnabled = next.pan
            isZoomGesturesEnabled = next.zoom
            isRotateGesturesEnabled = next.rotate
            isTiltGesturesEnabled = next.pitch
            isQuickZoomGesturesEnabled = next.zoom
            // MapLibre zooms one level per double tap; another amount is the SDK's.
            isDoubleTapGesturesEnabled = next.doubleTaps && next.doubleTapZoomDelta == 1.0
        }
        if (!next.cooperative) withheld = false
    }

    /**
     * Watches each touch before MapLibre receives it. Returns true to keep it from MapLibre: with
     * cooperative gestures, one finger never moves the map; once it slides, MapLibre forgets the
     * touch (no tap, no long press) and the hint shows; a second finger hands the touch back.
     */
    private fun touched(event: MotionEvent): Boolean {
        doubleTaps.onTouchEvent(event)
        if (!settings.cooperative || !settings.pan) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                withheld = false
                downX = event.x
                downY = event.y
            }
            MotionEvent.ACTION_MOVE ->
                if (event.pointerCount == 1) {
                    if (!withheld && hypot(event.x - downX, event.y - downY) > slop) {
                        withheld = true
                        forward(event, MotionEvent.ACTION_CANCEL)
                        showHint()
                    }
                    return true
                }
            MotionEvent.ACTION_POINTER_DOWN ->
                if (withheld) {
                    withheld = false
                    // MapLibre forgot the first finger; it starts again where that finger is.
                    val first = if (event.actionIndex == 0) 1 else 0
                    val down =
                        MotionEvent.obtain(
                            event.downTime,
                            event.eventTime,
                            MotionEvent.ACTION_DOWN,
                            event.getX(first),
                            event.getY(first),
                            event.metaState,
                        )
                    mapView.onTouchEvent(down)
                    down.recycle()
                }
            MotionEvent.ACTION_UP,
            MotionEvent.ACTION_CANCEL ->
                if (withheld) {
                    withheld = false
                    return true
                }
        }
        return false
    }

    private fun forward(event: MotionEvent, action: Int) {
        val copy = MotionEvent.obtain(event)
        copy.action = action
        mapView.onTouchEvent(copy)
        copy.recycle()
    }

    private fun report(event: String, coordinate: LatLng) {
        val point = map.projection.toScreenLocation(coordinate)
        val wrapped = coordinate.wrap()
        emit(
            event,
            JSONObject()
                .put(
                    "coordinate",
                    JSONObject()
                        .put("longitude", wrapped.longitude)
                        .put("latitude", wrapped.latitude),
                )
                .put("point", JSONObject().put("x", point.x / density).put("y", point.y / density)),
        )
    }

    fun showHint() {
        hint.removeCallbacks(hideHint)
        hint.animate().cancel()
        hint.visibility = View.VISIBLE
        hint.animate().alpha(1f).setDuration(200)
        hint.postDelayed(hideHint, 1_500)
    }

    fun retire() {
        hint.removeCallbacks(hideHint)
        hint.animate().cancel()
        mapView.setOnTouchListener(null)
    }

    internal companion object {
        const val HINT = "Use two fingers to move the map"
    }
}
