package dev.tileflow.sdk.engine

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PointF
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import dev.tileflow.sdk.TileflowCoordinate
import kotlin.math.hypot
import kotlin.math.roundToInt
import kotlin.math.tan
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView

/** Synchronous, bulk projection in physical view pixels. Input pairs are latitude, longitude. */
internal interface AnnotationProjection {
    var onFrame: (() -> Unit)?

    fun track(input: DoubleArray)

    fun project(input: DoubleArray, pixels: DoubleArray)
}

/** Layer hits, feature drags and accessible simple markers for one MapLibre renderer. */
internal class NativeAnnotations(
    context: Context,
    private val map: MapLibreMap,
    private val mapView: MapView,
    private val runtime: NativeRuntimeStyle,
    private val emit: (String, JSONObject) -> Unit,
) : AnnotationProjection {
    private val density = context.resources.displayMetrics.density
    override var onFrame: (() -> Unit)? = null
    private var layers = emptySet<String>()
    private var dragging: Drag? = null
    private val pins = linkedMapOf<String, Pin>()
    private var pinInput = DoubleArray(0)
    private var pinPixels = DoubleArray(0)
    private var retired = false

    val view: FrameLayout =
        object : FrameLayout(context) {
                override fun dispatchDraw(canvas: Canvas) {
                    positionPins()
                    super.dispatchDraw(canvas)
                }
            }
            .apply {
                clipChildren = true
                visibility = View.GONE
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            }

    private var tracked = DoubleArray(0)
    private var coordinates = DoubleArray(0)
    private var rendering = DoubleArray(0)
    private var presented = DoubleArray(0)
    private var captured: DoubleArray? = null
    private var available: DoubleArray? = null
    private var followingFrames = false

    // The camera reported during the Android view draw can already belong to the next
    // SurfaceView buffer. Use the transform from the start of the completed MapLibre frame.
    private val frameStart =
        MapView.OnWillStartRenderingFrameListener {
            if (!retired && coordinates.isNotEmpty()) {
                projectOnGround(coordinates, rendering)
                captured = coordinates
            }
        }

    private val frameEnd =
        MapView.OnDidFinishRenderingFrameListener { _, _, _ ->
            if (!retired && captured === coordinates) {
                val previous = presented
                presented = rendering
                rendering = previous
                available = coordinates
                captured = null
                onFrame?.invoke()
                if (pins.isNotEmpty()) view.invalidate()
            }
        }

    override fun track(input: DoubleArray) {
        tracked = input
        resetProjection()
    }

    private fun resetProjection() {
        coordinates = tracked + pinInput
        rendering = DoubleArray(coordinates.size)
        presented = DoubleArray(coordinates.size)
        available = null
        captured = null
        val follow = !retired && coordinates.isNotEmpty()
        if (follow == followingFrames) return
        followingFrames = follow
        if (follow) {
            mapView.addOnWillStartRenderingFrameListener(frameStart)
            mapView.addOnDidFinishRenderingFrameListener(frameEnd)
        } else {
            mapView.removeOnWillStartRenderingFrameListener(frameStart)
            mapView.removeOnDidFinishRenderingFrameListener(frameEnd)
        }
    }

    override fun project(input: DoubleArray, pixels: DoubleArray) {
        if (input.isEmpty() || retired) return
        if (available !== coordinates) {
            projectOnGround(input, pixels)
            return
        }
        val start = if (input === tracked) 0 else tracked.size
        presented.copyInto(pixels, 0, start, start + input.size)
    }

    private fun projectOnGround(input: DoubleArray, pixels: DoubleArray) {
        map.projection.toScreenLocations(input, pixels)
        val camera = map.cameraPosition
        if (camera.tilt <= 0) return

        // MapLibre's ground projection divides by W even for points behind the camera.
        // With its fixed vertical field of view, the focal distance is 1.5 viewport heights.
        val height = mapView.height.toDouble()
        val centerY = (height + (camera.padding?.let { it[1] - it[3] } ?: 0.0)) / 2
        val horizonY = centerY - 1.5 * height / tan(Math.toRadians(camera.tilt))
        for (y in 1 until pixels.size step 2) {
            if (pixels[y] <= horizonY) pixels[y] = Double.NaN
        }
    }

    internal data class Simple(
        val id: String,
        val coordinate: TileflowCoordinate,
        val title: String,
        val color: Int,
    )

    fun simple(request: JSONObject): List<Simple> =
        request.getJSONArray("annotations").objects().map {
            val pair = it.getJSONArray("coordinate")
            val rgba = it.getJSONObject("marker").getString("color")
            val color =
                if (rgba.length == 9) "#" + rgba.takeLast(2) + rgba.substring(1, 7) else rgba
            Simple(
                it.getString("id"),
                TileflowCoordinate(pair.getDouble(0), pair.getDouble(1)),
                it.getString("ariaLabel"),
                Color.parseColor(color),
            )
        }

    fun setSimple(entries: List<Simple>) {
        if (entries == pins.values.map { it.entry }) return
        val wanted = entries.map { it.id }.toSet()
        val coordinatesChanged = pins.keys != wanted || entries.any { pins[it.id]?.entry?.coordinate != it.coordinate }
        for (id in pins.keys - wanted) view.removeView(pins.remove(id))
        for (entry in entries) {
            if (pins[entry.id]?.entry == entry) continue
            val pin =
                pins.getOrPut(entry.id) {
                    Pin(view.context, entry).also {
                        val size = (44 * density).roundToInt()
                        view.addView(it, FrameLayout.LayoutParams(size, size))
                    }
                }
            pin.entry = entry
            pin.contentDescription = entry.title
            pin.invalidate()
        }
        if (!coordinatesChanged) return
        pinInput = DoubleArray(pins.size * 2)
        pins.values.forEachIndexed { i, pin ->
            pinInput[i * 2] = pin.entry.coordinate.latitude
            pinInput[i * 2 + 1] = pin.entry.coordinate.longitude
        }
        pinPixels = DoubleArray(pinInput.size)
        view.visibility = if (pins.isEmpty()) View.GONE else View.VISIBLE
        resetProjection()
        view.invalidate()
    }

    private inner class Pin(context: Context, var entry: Simple) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        init {
            isClickable = true
            isFocusable = true
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
            setOnClickListener {
                val at = entry.coordinate
                emit(
                    "annotationActivated",
                    JSONObject()
                        .put("id", entry.id)
                        .put(
                            "coordinate",
                            JSONObject().put("longitude", at.longitude).put("latitude", at.latitude),
                        ),
                )
            }
        }

        override fun getAccessibilityClassName(): CharSequence = Button::class.java.name

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2 * density
            paint.color = Color.WHITE
            canvas.drawCircle(width / 2f, height / 2f, 11 * density, paint)
            paint.style = Paint.Style.FILL
            paint.color = entry.color
            canvas.drawCircle(width / 2f, height / 2f, 10 * density, paint)
        }
    }

    private fun positionPins() {
        if (pins.isEmpty() || retired) return
        project(pinInput, pinPixels)
        pins.values.forEachIndexed { index, pin ->
            val x = pinPixels[index * 2]
            val y = pinPixels[index * 2 + 1]
            if (
                x.isFinite() &&
                    y.isFinite() &&
                    x + pin.width / 2 >= 0 &&
                    x - pin.width / 2 <= view.width &&
                    y + pin.height / 2 >= 0 &&
                    y - pin.height / 2 <= view.height
            ) {
                pin.visibility = View.VISIBLE
                pin.translationX = x.toFloat() - pin.width / 2f
                pin.translationY = y.toFloat() - pin.height / 2f
            } else pin.visibility = View.INVISIBLE
        }
    }

    fun setLayers(value: JSONObject) {
        layers = value.getJSONArray("layers").items().map { it as String }.toSet()
        if (dragging?.hit?.layer !in layers) finish()
    }

    private data class Hit(val layer: String, val id: String, val draggable: Boolean)

    private fun hits(point: PointF): List<Hit> {
        if (layers.isEmpty()) return emptyList()
        val style = map.style ?: return emptyList()
        val r = 6f * density
        val box = RectF(point.x - r, point.y - r, point.x + r, point.y + r)
        val result = mutableListOf<Hit>()
        for (layer in style.layers.asReversed()) {
            val id = layer.id.removePrefix("__tileflow_layer_")
            if (layer.id == id || id !in layers) continue
            for (feature in map.queryRenderedFeatures(box, layer.id)) {
                val key = feature.getStringProperty("id") ?: feature.id() ?: continue
                if (result.none { it.layer == id && it.id == key })
                    result += Hit(id, key, feature.getBooleanProperty("draggable") == true)
                if (result.size == 16) return result
            }
        }
        return result
    }

    fun press(point: PointF): JSONArray =
        JSONArray(hits(point).map { JSONObject().put("layer", it.layer).put("id", it.id) })

    private class Drag(
        val pointer: Int,
        val hit: Hit,
        val edit: NativeDragFeature,
        val start: PointF,
        val anchors: JSONObject,
        val scroll: Boolean,
        var point: PointF,
        var geometry: JSONObject,
        var moved: Boolean = false,
    )

    private fun positions(
        geometry: JSONObject,
        transform: (Double, Double) -> Pair<Double, Double>,
    ): JSONObject {
        fun mapCoordinates(value: JSONArray): JSONArray {
            if (value.opt(0) is Number) {
                val (a, b) = transform(value.getDouble(0), value.getDouble(1))
                return JSONArray().put(a).put(b).apply {
                    for (i in 2 until value.length()) put(value.get(i))
                }
            }
            return JSONArray(
                (0 until value.length()).map { mapCoordinates(value.getJSONArray(it)) }
            )
        }
        val out = JSONObject(geometry.toString())
        if (out.has("coordinates"))
            out.put("coordinates", mapCoordinates(out.getJSONArray("coordinates")))
        else
            out.put(
                "geometries",
                JSONArray(out.getJSONArray("geometries").objects().map { positions(it, transform) }),
            )
        return out
    }

    /** Called before MapLibre's own gesture detector. A draggable annotation owns its pan. */
    fun touch(event: MotionEvent, cancelMapTouch: () -> Unit): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                finish()
                val point = PointF(event.x, event.y)
                val hit = hits(point).firstOrNull()?.takeIf { it.draggable } ?: return false
                val edit = runtime.dragFeature(hit.layer, hit.id) ?: return false
                val center = map.cameraPosition.target?.longitude ?: 0.0
                val anchors =
                    positions(edit.geometry) { x, y ->
                        val lon = center + NativeCameraMath.wrap(x - center)
                        val p = map.projection.toScreenLocation(LatLng(y, lon))
                        p.x.toDouble() to p.y.toDouble()
                    }
                val pan = map.uiSettings.isScrollGesturesEnabled
                dragging =
                    Drag(
                        event.getPointerId(0),
                        hit,
                        edit,
                        point,
                        anchors,
                        pan,
                        point,
                        edit.geometry,
                    )
                map.uiSettings.isScrollGesturesEnabled = false
                return false
            }
            MotionEvent.ACTION_POINTER_DOWN -> {
                val owned = dragging?.moved == true
                finish()
                // MapLibre previously received ACTION_CANCEL. Reintroduce the first pointer for a
                // pinch.
                if (owned)
                    MotionEvent.obtain(
                            event.downTime,
                            event.eventTime,
                            MotionEvent.ACTION_DOWN,
                            event.x,
                            event.y,
                            event.metaState,
                        )
                        .also {
                            mapView.onTouchEvent(it)
                            it.recycle()
                        }
                return false
            }
            MotionEvent.ACTION_MOVE,
            MotionEvent.ACTION_UP -> {
                val drag = dragging ?: return false
                val index = event.findPointerIndex(drag.pointer)
                if (index < 0) {
                    finish()
                    return false
                }
                val point = PointF(event.getX(index), event.getY(index))
                val dx = point.x - drag.start.x
                val dy = point.y - drag.start.y
                if (drag.moved || hypot(dx, dy) > 3 * density) {
                    val geometry =
                        positions(drag.anchors) { x, y ->
                            val pos =
                                map.projection
                                    .fromScreenLocation(
                                        PointF((x + dx).toFloat(), (y + dy).toFloat())
                                    )
                                    .wrap()
                            pos.longitude to pos.latitude.coerceIn(-85.0, 85.0)
                        }
                    if (!drag.edit.move(geometry)) {
                        finish()
                        return false
                    }
                    drag.point = point
                    drag.geometry = geometry
                    if (!drag.moved) {
                        cancelMapTouch()
                        drag.moved = true
                        report("started", drag)
                    }
                    report("moved", drag)
                }
                val owned = drag.moved
                if (event.actionMasked == MotionEvent.ACTION_UP) finish()
                return owned
            }
            MotionEvent.ACTION_CANCEL -> {
                val owned = dragging?.moved == true
                finish()
                return owned
            }
            else -> return false
        }
    }

    private fun report(phase: String, drag: Drag) {
        emit(
            "annotationDragged",
            JSONObject()
                .put("phase", phase)
                .put("layer", drag.hit.layer)
                .put("id", drag.hit.id)
                .put("geometry", drag.geometry)
                .put(
                    "point",
                    JSONObject().put("x", drag.point.x / density).put("y", drag.point.y / density),
                ),
        )
    }

    private fun finish() {
        val drag = dragging ?: return
        dragging = null
        if (!retired) map.uiSettings.isScrollGesturesEnabled = drag.scroll
        if (drag.moved && !retired) report("ended", drag)
    }

    fun retire() {
        finish()
        retired = true
        onFrame = null
        tracked = DoubleArray(0)
        pinInput = DoubleArray(0)
        resetProjection()
        pins.clear()
        view.removeAllViews()
    }
}

/** Keeps the uncut source feature in hand throughout a drag. Other source edits supersede it. */
internal class NativeDragFeature(val geometry: JSONObject, val move: (JSONObject) -> Boolean)
