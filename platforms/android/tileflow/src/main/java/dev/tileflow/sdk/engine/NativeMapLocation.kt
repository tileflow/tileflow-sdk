package dev.tileflow.sdk.engine

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.PointF
import android.location.Location
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.location.LocationComponentActivationOptions
import org.maplibre.android.location.LocationComponentConstants
import org.maplibre.android.location.LocationComponentOptions
import org.maplibre.android.location.engine.LocationEngineRequest
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.Layer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.android.style.layers.SymbolLayer

/** The puck stays above application content, including layers installed after the location. */
internal fun Style.addBelowLocation(layer: Layer) {
    val bottom = LocationComponentConstants.SHADOW_LAYER
    if (getLayer(bottom) == null) addLayer(layer) else addLayerBelow(layer, bottom)
}

/**
 * MapLibre tracks the app's fixes. The view owns the provider's lifecycle and permission policy.
 */
internal class NativeMapLocation(
    private val context: Context,
    private val map: MapLibreMap,
    private val camera: NativeCamera,
    private val emit: (String, JSONObject) -> Unit,
) {
    private val component
        get() = map.locationComponent

    internal val relay = NativeLocationEngine()
    private val main = Handler(Looper.getMainLooper())
    private val checkAge = Runnable { decorate() }
    private var activated = false
    private var enabled = false
    private var showsPuck = true
    private var accuracy = true
    private var bearing = "none"
    private var staleAfter = 30_000L
    private var measuredAt: Long? = null
    private var request: JSONObject? = null
    private var entering = false

    private data class Colours(val stale: Boolean, val accuracy: Boolean)

    private var appearance: Colours? = null

    private data class Indicators(val mode: Int, val course: Float?, val colours: Colours, val visible: Boolean)

    private var indicators: Indicators? = null

    fun options(value: JSONObject?) {
        if (value == null) return
        enabled = value.getBoolean("enabled")
        showsPuck = value.optBoolean("showsPuck", true)
        accuracy = value.getBoolean("accuracy")
        bearing = value.getString("bearing")
        staleAfter = value.getLong("staleAfterMs")
        refresh(map.style)
    }

    /** Called by the new style after its own sources and layers are restored. */
    fun restore(style: Style) {
        appearance = null
        indicators = null
        refresh(style)
    }

    fun resume() {
        decorate()
        scheduleAgeCheck()
    }

    @SuppressLint("MissingPermission") // Both component engines receive only app-provided data.
    private fun refresh(style: Style?) {
        if (enabled && !activated && style?.isFullyLoaded == true) {
            val colours = colours()
            component.activateLocationComponent(
                LocationComponentActivationOptions.builder(context, style)
                    .useDefaultLocationEngine(false)
                    .locationEngine(relay)
                    .locationEngineRequest(
                        LocationEngineRequest.Builder(0).setFastestInterval(0).build()
                    )
                    .locationComponentOptions(options(colours))
                    .build()
            )
            component.compassEngine = relay
            activated = true
            appearance = colours
        }
        if (!activated) return
        val visible = enabled && relay.fix != null
        if (component.isLocationComponentEnabled != visible) {
            component.isLocationComponentEnabled = visible
            indicators = null
        }
        applyFollow()
        decorate()
        scheduleAgeCheck()
    }

    fun update(value: JSONObject) {
        if (value.has("location")) {
            val data = value.optJSONObject("location")
            val age = data?.getLong("age") ?: 0L
            measuredAt = data?.let { SystemClock.elapsedRealtime() - age }
            relay.update(
                data?.let {
                    Location("Tileflow").apply {
                        longitude = it.getDouble("longitude")
                        latitude = it.getDouble("latitude")
                        time = System.currentTimeMillis() - age
                        if (it.has("accuracy")) accuracy = it.getDouble("accuracy").toFloat()
                        if (it.has("course")) bearing = it.getDouble("course").toFloat()
                    }
                }
            )
        }
        if (value.has("heading")) {
            relay.direction(value.optJSONObject("heading")?.getDouble("direction")?.toFloat())
        }
        refresh(map.style)
    }

    private fun colours(): Colours {
        val stale = measuredAt?.let { SystemClock.elapsedRealtime() - it >= staleAfter } == true
        return Colours(stale, accuracy && relay.fix?.hasAccuracy() == true)
    }

    @Suppress(
        "DEPRECATION"
    ) // Applying LocationComponentOptions otherwise resets the view's padding.
    private fun options(colours: Colours): LocationComponentOptions {
        val colour = if (colours.stale) Color.rgb(142, 142, 147) else Color.rgb(26, 115, 232)
        return LocationComponentOptions.builder(context)
            .enableStaleState(false)
            .foregroundTintColor(colour)
            .foregroundStaleTintColor(colour)
            .backgroundTintColor(Color.WHITE)
            .accuracyColor(colour)
            .accuracyAlpha(if (colours.accuracy) .12f else 0f)
            .trackingGesturesManagement(false)
            .trackingAnimationDurationMultiplier(1f)
            .padding(
                map.cameraPosition.padding?.let { values ->
                    IntArray(4) { values[it].roundToInt() }
                } ?: IntArray(4)
            )
            .build()
    }

    private fun scheduleAgeCheck() {
        main.removeCallbacks(checkAge)
        if (!enabled) return
        val time = measuredAt ?: return
        val remaining = time + staleAfter - SystemClock.elapsedRealtime()
        if (remaining > 0) main.postDelayed(checkAge, remaining)
    }

    private fun direction(): Float? =
        when (bearing) {
            "heading" -> relay.heading
            "course" -> relay.fix?.takeIf { it.hasBearing() }?.bearing
            else -> null
        }

    private fun decorate() {
        if (!activated || !component.isLocationComponentEnabled) return
        val colours = colours()
        if (colours != appearance) {
            appearance = colours
            component.applyStyle(options(colours))
        }

        val direction = direction()
        // GPS render mode removes the accuracy ring. Its compass symbol supports an independent
        // course.
        val mode = if (direction == null) RenderMode.NORMAL else RenderMode.COMPASS
        val next = Indicators(mode, direction?.takeIf { bearing == "course" }, colours, showsPuck)
        val style = map.style ?: return
        if (showsPuck && next == indicators) return
        indicators = next
        if (component.renderMode != mode) component.renderMode = mode
        for (id in listOf(LocationComponentConstants.FOREGROUND_LAYER, LocationComponentConstants.BACKGROUND_LAYER, LocationComponentConstants.SHADOW_LAYER)) {
            style.getLayer(id)?.setProperties(PropertyFactory.visibility(if (showsPuck) Property.VISIBLE else Property.NONE))
        }
        val cone = style.getLayerAs<SymbolLayer>(LocationComponentConstants.BEARING_LAYER)
        cone?.setProperties(PropertyFactory.visibility(if (showsPuck && direction != null) Property.VISIBLE else Property.NONE))
        if (direction != null) {
            cone?.setProperties(
                if (bearing == "heading")
                    PropertyFactory.iconRotate(Expression.get("mapbox-property-compass-bearing"))
                else PropertyFactory.iconRotate(direction),
                PropertyFactory.iconOpacity(if (colours.stale) .4f else 1f),
            )
        }
        style
            .getLayer(LocationComponentConstants.ACCURACY_LAYER)
            ?.setProperties(
                PropertyFactory.visibility(
                    if (showsPuck && colours.accuracy) Property.VISIBLE else Property.NONE
                )
            )
    }

    fun follow(value: JSONObject) {
        request = value.takeIf { it.getString("mode") != "none" }
        entering = request != null
        applyFollow()
    }

    private fun applyFollow() {
        if (!activated) return
        val fix = relay.fix
        val value = request
        if (fix == null || value == null || !component.isLocationComponentEnabled) {
            camera.followsLocation = false
            if (component.cameraMode != CameraMode.NONE) component.cameraMode = CameraMode.NONE
            return
        }
        val requested = value.getString("mode")
        val course = fix.takeIf { it.hasBearing() }?.bearing?.toDouble()
        val target =
            when {
                requested == "heading" && relay.heading != null -> CameraMode.TRACKING_COMPASS
                requested == "course" && course != null -> CameraMode.TRACKING_GPS
                else -> CameraMode.TRACKING
            }
        camera.followsLocation = true
        if (component.cameraMode == target && !entering) return
        val zoom =
            if (entering && value.has("minimumZoom"))
                maxOf(map.cameraPosition.zoom, value.getDouble("minimumZoom"))
            else null
        val rotation =
            when (target) {
                CameraMode.TRACKING_COMPASS -> relay.heading?.toDouble()
                CameraMode.TRACKING_GPS -> course
                else -> if (entering && value.has("bearing")) value.getDouble("bearing") else null
            }
        // The component accepts entry zoom and bearing only when it starts tracking.
        if (entering && component.cameraMode != CameraMode.NONE)
            component.cameraMode = CameraMode.NONE
        val duration = if (entering) value.optLong("duration") else 0L
        entering = false
        // A zero-duration MapLibre fly emits an unanimated completion. The location component
        // waits for an animated completion and otherwise discards every later camera update.
        component.setCameraMode(target, duration.coerceAtLeast(1), zoom, rotation, null, null)
    }

    fun padding(padding: DoubleArray): Boolean {
        if (!activated || component.cameraMode == CameraMode.NONE) return false
        component.paddingWhileTracking(padding, 0)
        return true
    }

    fun stop(reason: String) {
        val active = request ?: return
        request = null
        entering = false
        applyFollow()
        emit(
            "followModeChanged",
            JSONObject()
                .put("mode", "none")
                .put("reason", reason)
                .put("revision", active.getInt("revision")),
        )
    }

    /** Public layer identifiers stay stable across renderers. */
    fun query(point: PointF, result: JSONArray) {
        if (!activated || !component.isLocationComponentEnabled || !showsPuck) return
        fun add(layer: String, suffix: String) {
            if (map.queryRenderedFeatures(point, layer).isNotEmpty())
                result.put(
                    JSONObject()
                        .put("id", JSONObject.NULL)
                        .put("source", "__tileflow_location")
                        .put("layer", "__tileflow_location_$suffix")
                )
        }
        add(LocationComponentConstants.FOREGROUND_LAYER, "dot")
        if (direction() != null) add(LocationComponentConstants.BEARING_LAYER, "bearing")
        if (colours().accuracy) add(LocationComponentConstants.ACCURACY_LAYER, "accuracy")
    }

    @SuppressLint("MissingPermission")
    fun retire() {
        main.removeCallbacks(checkAge)
        request = null
        camera.followsLocation = false
        if (activated) {
            component.cameraMode = CameraMode.NONE
            component.isLocationComponentEnabled = false
        }
    }
}
