package dev.tileflow.sdk.engine

import android.animation.ValueAnimator
import android.graphics.PointF
import android.os.Handler
import android.os.Looper
import dev.tileflow.sdk.TileflowBounds
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowCameraAnimation
import dev.tileflow.sdk.TileflowCameraLimits
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.sqrt
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView

/**
 * The camera of a map that MapLibre Native draws: movements and how they end, limits, padding, and
 * camera events with who moved the camera.
 *
 * A movement the view asks for answers once: `finished` when MapLibre completes it, `cancelled`
 * when the view stops or replaces it, and `interrupted` when anything else ends it first, such as a
 * person touching the map. The engine ends a movement as cancelled before it gives MapLibre the
 * change that replaces or stops it, so MapLibre's later cancellation of that movement finds nothing
 * to end; a cancellation MapLibre reports for a movement still in progress came from elsewhere.
 *
 * MapLibre Android reports camera changes a moment later, on the main thread's queue, and names
 * only gestures as their cause. The camera keeps who asked for the changes the engine makes until
 * the camera settles: the application (`api`), a person through the map's controls (`gesture`),
 * the location (`location`) or the SDK itself (`system`).
 */
internal class NativeCamera(
    private val map: MapLibreMap,
    private val mapView: MapView,
    private val density: Float,
    private val emit: (String, JSONObject) -> Unit,
    /** The application asked for a pitch steeper than MapLibre Android draws. */
    private val steep: (Double) -> Unit,
) {
    /** Where the camera may go, as the view's options give it. */
    data class Limits(
        val minZoom: Double = 0.0,
        val maxZoom: Double = 24.0,
        val minPitch: Double = 0.0,
        val maxPitch: Double = TileflowCameraLimits.MAXIMUM_PITCH,
        val bounds: TileflowBounds? = null,
    )

    private class Movement(
        val id: Int,
        val reason: String,
        val waiter: CancellableContinuation<String>,
    )

    private val main = Handler(Looper.getMainLooper())
    private var movement: Movement? = null
    private var sequence = 0
    var isMoving: Boolean = false
        private set

    /** Who moves the camera in the change under way. */
    private var changeReason = "system"
    /** Who asked for the changes the engine gave MapLibre since the camera last settled. */
    private var issuer: String? = null
    /** Padding, in pixels, that waits for the camera to settle so it never stops an animation. */
    private var pendingPadding: DoubleArray? = null
    var limits: Limits = Limits()
        private set

    /** The bounds the camera's target keeps within, so the whole view stays inside the limits. */
    private var targetBounds: LatLngBounds? = null
    /** Whether the view follows the camera frame by frame: `cameraMoved` costs a call per frame. */
    var followsFrames: Boolean = true
    /** Gestures a person is making. */
    private val gestures = LinkedHashSet<String>()
    private var retired = false

    init {
        map.addOnCameraMoveStartedListener(::started)
        map.addOnCameraMoveListener(::moved)
        map.addOnCameraIdleListener(::idle)
        mapView.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> updateBounds() }
    }

    // Reading

    /** The camera in the SDK's form. MapLibre's bearing runs from 0 to 360; the SDK's from -180. */
    val current: TileflowCamera
        get() {
            val position = map.cameraPosition
            val target = position.target ?: LatLng(0.0, 0.0)
            return TileflowCamera(
                target.wrap().longitude,
                target.latitude,
                position.zoom.coerceIn(0.0, 24.0),
                normalizedBearing(position.bearing),
                position.tilt.coerceIn(0.0, TileflowCameraLimits.MAXIMUM_PITCH),
            )
        }

    val json: JSONObject
        get() = json(current)

    /**
     * The region the view shows, as the web describes it: longitudes within [-180, 180], an east
     * edge west of the west edge across the antimeridian, and the whole world for a wider view.
     */
    fun visibleBounds(): JSONObject {
        val region = map.projection.visibleRegion
        val center = map.cameraPosition.target?.longitude ?: 0.0
        val corners = listOf(region.farLeft, region.farRight, region.nearLeft, region.nearRight)
            .filterNotNull()
        // Each corner on the side of the antimeridian nearer the centre.
        val longitudes = corners.map { center + NativeCameraMath.wrap(it.longitude - center) }
        val latitudes = corners.map { it.latitude }
        val bounds =
            NativeCameraMath.normalized(
                longitudes.minOrNull() ?: -180.0,
                latitudes.minOrNull() ?: -90.0,
                longitudes.maxOrNull() ?: 180.0,
                latitudes.maxOrNull() ?: 90.0,
            )
        return JSONObject()
            .put("west", bounds.west)
            .put("south", bounds.south)
            .put("east", bounds.east)
            .put("north", bounds.north)
    }

    /** A coordinate as a point in density-independent pixels. */
    fun project(coordinate: TileflowCoordinate): PointF {
        val point =
            map.projection.toScreenLocation(LatLng(coordinate.latitude, coordinate.longitude))
        return PointF(point.x / density, point.y / density)
    }

    /** The coordinate under a point in density-independent pixels. */
    fun unproject(x: Double, y: Double): TileflowCoordinate {
        val coordinate =
            map.projection.fromScreenLocation(PointF((x * density).toFloat(), (y * density).toFloat()))
                .wrap()
        return TileflowCoordinate(coordinate.longitude, coordinate.latitude)
    }

    // Movements

    /** Moves to a camera at once, for the SDK: the camera a map starts at. */
    fun jump(camera: TileflowCamera) {
        steep(camera.pitch)
        issue("system") { map.moveCamera(CameraUpdateFactory.newCameraPosition(position(camera))) }
    }

    /**
     * Runs one movement the view asked for and answers with how it ended and where the camera is.
     * Cancelling the calling coroutine stops the movement in MapLibre.
     */
    suspend fun move(payload: JSONObject): JSONObject {
        val start = current
        // MapLibre caps the pitch while it builds a camera; the request says what was asked for.
        payload.optJSONObject("fit")?.optDouble("pitch")?.let(steep)
        payload.optJSONObject("target")?.optDouble("pitch")?.let(steep)
        val target = target(payload, start)
        val reason = payload.optString("reason").ifEmpty { "api" }
        val animation = animation(payload.optJSONObject("animation"), start, target)
        end("cancelled")
        sequence += 1
        val id = sequence
        val completion =
            suspendCancellableCoroutine { waiter ->
                movement = Movement(id, reason, waiter)
                waiter.invokeOnCancellation { main.post { abandon(id) } }
                run(animation, target, id, reason)
            }
        return JSONObject().put("completion", completion).put("camera", json)
    }

    private fun target(payload: JSONObject, start: TileflowCamera): TileflowCamera {
        payload.optJSONObject("fit")?.let { fit ->
            return fitted(fit)
                ?: throw TileflowMapException(
                    TileflowErrorCode.INVALID_REQUEST,
                    TileflowErrorContext(
                        message = "The bounds do not fit the view with this padding."
                    ),
                )
        }
        val update = payload.optJSONObject("target") ?: JSONObject()
        val center = update.optJSONObject("center")
        return TileflowCamera(
            center?.optDouble("longitude") ?: start.longitude,
            center?.optDouble("latitude") ?: start.latitude,
            update.optDouble("zoom", start.zoom),
            update.optDouble("bearing", start.bearing),
            update.optDouble("pitch", start.pitch),
        )
    }

    /** How a movement reaches its target in MapLibre. */
    internal sealed interface Animation {
        data object Jump : Animation

        data class Ease(val millis: Int, val easing: Boolean) : Animation

        data class Fly(val millis: Int) : Animation
    }

    private fun animation(value: JSONObject?, start: TileflowCamera, target: TileflowCamera) =
        animation(
            value,
            start,
            target,
            mapView.width / density.toDouble(),
            mapView.height / density.toDouble(),
            reducedMotion = !ValueAnimator.areAnimatorsEnabled(),
        )

    private fun run(animation: Animation, target: TileflowCamera, id: Int, reason: String) {
        val update = CameraUpdateFactory.newCameraPosition(position(target))
        // MapLibre posts its callbacks once a transition ends, also when another change cancels
        // it; a movement that already ended ignores them.
        val callback =
            object : MapLibreMap.CancelableCallback {
                override fun onFinish() = end("finished", id)

                override fun onCancel() = end("interrupted", id)
            }
        issue(reason) {
            when (animation) {
                Animation.Jump -> map.moveCamera(update)
                is Animation.Ease ->
                    map.easeCamera(update, animation.millis, animation.easing, callback)
                is Animation.Fly -> map.animateCamera(update, animation.millis, callback)
            }
        }
        // A jump completes as it starts.
        if (animation == Animation.Jump) end("finished", id)
    }

    /** Ends the movement in progress, or the one with [id], with an outcome. */
    fun end(outcome: String, id: Int? = null) {
        val current = movement ?: return
        if (id != null && current.id != id) return
        movement = null
        if (current.waiter.isActive) current.waiter.resume(outcome)
    }

    /** The calling coroutine gave up its movement: MapLibre stops. */
    private fun abandon(id: Int) {
        if (movement?.id != id) return
        movement = null
        if (!retired) map.cancelTransitions()
    }

    /** Stops the camera, whether the application or a person moved it. */
    fun stop() {
        end("cancelled")
        map.cancelTransitions()
    }

    /** Gives MapLibre a change the engine makes for [reason]. */
    private inline fun issue(reason: String, change: () -> Unit) {
        issuer = reason
        change()
    }

    /**
     * A person's double tap: the zoom changes by [delta] around a point in pixels, as MapLibre's
     * own double tap does by one level.
     */
    fun zoom(delta: Double, x: Float, y: Float) {
        val start = current
        val anchor = map.projection.fromScreenLocation(PointF(x, y))
        val zoom = (start.zoom + delta).coerceIn(limits.minZoom, limits.maxZoom)
        val center =
            NativeCameraMath.center(
                zoom - start.zoom,
                TileflowCoordinate(anchor.longitude, anchor.latitude),
                TileflowCoordinate(start.longitude, start.latitude),
            )
        gestureBegan("zoom")
        issue("gesture") {
            map.easeCamera(
                CameraUpdateFactory.newCameraPosition(
                    position(start.copy(longitude = center.longitude, latitude = center.latitude, zoom = zoom))
                ),
                300,
            )
        }
    }

    // Limits and padding

    /** Applies the view's limits; a camera outside them moves inside. */
    fun setLimits(value: JSONObject?) {
        value ?: return
        val next =
            Limits(
                value.optDouble("minZoom", 0.0),
                value.optDouble("maxZoom", 24.0),
                value.optDouble("minPitch", 0.0),
                value.optDouble("maxPitch", TileflowCameraLimits.MAXIMUM_PITCH),
                value.optJSONObject("bounds")?.let {
                    TileflowBounds(
                        it.getDouble("west"),
                        it.getDouble("south"),
                        it.getDouble("east"),
                        it.getDouble("north"),
                    )
                },
            )
        if (next == limits) return
        limits = next
        // A minimum pitch MapLibre Android cannot reach asks for a steeper camera.
        steep(next.minPitch)
        // Reset first, so new limits never cross the previous ones while they are applied.
        map.setMinZoomPreference(0.0)
        map.setMaxZoomPreference(next.maxZoom)
        map.setMinZoomPreference(next.minZoom)
        map.setMinPitchPreference(0.0)
        map.setMaxPitchPreference(min(next.maxPitch, MAXIMUM_PITCH))
        map.setMinPitchPreference(min(next.minPitch, MAXIMUM_PITCH))
        // New bounds apply in full; removed ones free the camera's target.
        if (targetBounds != null) {
            targetBounds = null
            map.setLatLngBoundsForCameraTarget(null)
        }
        updateBounds()
        constrain()
    }

    /** Moves a camera whose zoom or pitch lies outside the limits inside them. */
    private fun constrain() {
        val camera = current
        val zoom = camera.zoom.coerceIn(limits.minZoom, max(limits.minZoom, limits.maxZoom))
        val pitch = camera.pitch.coerceIn(limits.minPitch, max(limits.minPitch, limits.maxPitch))
        if (zoom == camera.zoom && pitch == camera.pitch) return
        issue("system") {
            map.moveCamera(
                CameraUpdateFactory.newCameraPosition(position(camera.copy(zoom = zoom, pitch = pitch)))
            )
        }
    }

    /**
     * MapLibre Android keeps only the camera's target within bounds. For the whole view to stay
     * inside them, as on the web, the target keeps within the bounds less half the view at the
     * current zoom, and the zoom never drops below the one at which the view fits.
     */
    private fun updateBounds() {
        if (retired) return
        val bounds = limits.bounds ?: return
        if (mapView.width <= 0 || mapView.height <= 0) return
        val fit =
            NativeCameraMath.targetBounds(
                bounds,
                mapView.width / density.toDouble(),
                mapView.height / density.toDouble(),
                map.cameraPosition.zoom,
            )
        map.setMinZoomPreference(max(limits.minZoom, fit.minZoom).coerceAtMost(limits.maxZoom))
        val next = LatLngBounds.from(fit.north, fit.east, fit.south, fit.west)
        if (next == targetBounds) return
        targetBounds = next
        map.setLatLngBoundsForCameraTarget(next)
    }

    /**
     * Space covered at each edge, in density-independent pixels. The camera centres on the rest of
     * the view; a change while the camera moves applies when it settles.
     */
    fun setPadding(insets: JSONObject) {
        pendingPadding =
            doubleArrayOf(
                insets.optDouble("left", 0.0) * density,
                insets.optDouble("top", 0.0) * density,
                insets.optDouble("right", 0.0) * density,
                insets.optDouble("bottom", 0.0) * density,
            )
        applyPadding()
    }

    private fun applyPadding() {
        val padding = pendingPadding ?: return
        if (retired || isMoving || movement != null || gestures.isNotEmpty()) return
        pendingPadding = null
        if (map.cameraPosition.padding?.contentEquals(padding) == true) return
        issue("system") {
            map.moveCamera(
                CameraUpdateFactory.paddingTo(padding[0], padding[1], padding[2], padding[3])
            )
        }
    }

    // Framing

    /**
     * The camera that frames bounds with padding inside the content padding; null when the padding
     * leaves no room. The zoom stays within `maxZoom` and the limits.
     */
    fun fitted(fit: JSONObject): TileflowCamera? {
        val bounds = fit.optJSONObject("bounds") ?: return null
        val padding = fit.optJSONObject("padding") ?: JSONObject()
        val edges =
            listOf("left", "top", "right", "bottom").map { padding.optDouble(it, 0.0) * density }
        val insets = map.cameraPosition.padding ?: DoubleArray(4)
        val total = IntArray(4) { (edges[it] + insets[it]).roundToInt() }
        if (mapView.width - total[0] - total[2] <= 0 || mapView.height - total[1] - total[3] <= 0)
            return null
        var east = bounds.getDouble("east")
        val west = bounds.getDouble("west")
        if (east < west) east += 360
        val position =
            map.getCameraForLatLngBounds(
                LatLngBounds.from(bounds.getDouble("north"), east, bounds.getDouble("south"), west),
                total,
                fit.optDouble("bearing", map.cameraPosition.bearing),
                fit.optDouble("pitch", map.cameraPosition.tilt),
            ) ?: return null
        val target = position.target ?: return null
        var zoom = min(position.zoom, fit.optDouble("maxZoom", limits.maxZoom))
        zoom = max(min(zoom, limits.maxZoom), limits.minZoom).coerceIn(0.0, 24.0)
        val bearing = normalizedBearing(position.bearing)
        // MapLibre centres the bounds in the view less the padding and the content padding; the
        // camera's centre is the centre of the view less the content padding only, so uneven
        // padding moves it.
        val center =
            NativeCameraMath.shifted(
                TileflowCoordinate(target.longitude, target.latitude),
                (edges[2] - edges[0]) / 2 / density,
                (edges[3] - edges[1]) / 2 / density,
                zoom,
                bearing,
            )
        return TileflowCamera(
            NativeCameraMath.wrap(center.longitude),
            center.latitude,
            zoom,
            bearing,
            position.tilt,
        )
    }

    // MapLibre's camera changes

    private fun started(reason: Int) {
        if (retired) return
        changeReason =
            if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) {
                // A person's gesture takes over the movement the application asked for.
                end("interrupted")
                "gesture"
            } else issuer ?: movement?.reason ?: "system"
        if (isMoving) return
        isMoving = true
        emit("cameraMoveStarted", JSONObject().put("camera", json).put("reason", changeReason))
    }

    private fun moved() {
        if (retired) return
        if (limits.bounds != null) updateBounds()
        if (!followsFrames || !isMoving) return
        emit("cameraMoved", JSONObject().put("camera", json).put("reason", changeReason))
    }

    private fun idle() {
        if (retired) return
        if (limits.bounds != null) updateBounds()
        if (isMoving) {
            isMoving = false
            emit("cameraMoveEnded", JSONObject().put("camera", json).put("reason", changeReason))
        }
        // A zoom from a double tap ends as the camera settles.
        if ("zoom" in gestures && !zooming) gestureEnded("zoom")
        if (movement == null) issuer = null
        if (pendingPadding != null) main.post { applyPadding() }
    }

    /** Whether a person's pinch is in progress, rather than a double tap's animation. */
    private var zooming = false

    /** A person started a gesture: it takes over the movement the application asked for. */
    fun gestureBegan(gesture: String, continuous: Boolean = false) {
        if (retired) return
        end("interrupted")
        changeReason = "gesture"
        issuer = "gesture"
        if (gesture == "zoom" && continuous) zooming = true
        if (!gestures.add(gesture)) return
        emit("gestureStarted", JSONObject().put("gesture", gesture))
    }

    /** A person lifted the fingers of a gesture; the camera may still move, decelerating. */
    fun gestureEnded(gesture: String) {
        if (gesture == "zoom") zooming = false
        if (retired || !gestures.remove(gesture)) return
        emit("gestureEnded", JSONObject().put("gesture", gesture))
        if (gestures.isEmpty() && pendingPadding != null) main.post { applyPadding() }
    }

    fun retire(code: TileflowErrorCode) {
        retired = true
        main.removeCallbacksAndMessages(null)
        val current = movement ?: return
        movement = null
        if (current.waiter.isActive) current.waiter.resumeWithException(TileflowMapException(code))
    }

    private fun position(camera: TileflowCamera): CameraPosition =
        CameraPosition.Builder()
            .target(LatLng(camera.latitude, camera.longitude))
            .zoom(camera.zoom)
            .bearing(camera.bearing)
            .tilt(camera.pitch)
            .build()

    internal companion object {
        /** The steepest pitch MapLibre Android draws. */
        const val MAXIMUM_PITCH = 60.0

        /** MapLibre reports bearings in [0, 360); the SDK's cameras use (-180, 180]. */
        fun normalizedBearing(bearing: Double): Double =
            if (bearing > 180) bearing - 360 else bearing

        fun json(camera: TileflowCamera): JSONObject =
            JSONObject()
                .put("longitude", camera.longitude)
                .put("latitude", camera.latitude)
                .put("zoom", camera.zoom)
                .put("bearing", camera.bearing)
                .put("pitch", camera.pitch)

        /**
         * The animation MapLibre runs, for a view of [width] × [height] density-independent pixels.
         * A device that asks for reduced motion moves at once, and so does a flight that would last
         * longer than the limit. MapLibre Android eases along its own curve, or linearly.
         */
        fun animation(
            value: JSONObject?,
            start: TileflowCamera,
            target: TileflowCamera,
            width: Double,
            height: Double,
            reducedMotion: Boolean,
        ): Animation {
            val duration = value?.optDouble("duration")?.takeUnless { it.isNaN() }
            val limit = TileflowCameraAnimation.MAXIMUM_DURATION_MILLIS.toDouble()
            return when (value?.optString("type")) {
                "ease" -> {
                    if (duration == null || duration <= 0 || reducedMotion) return Animation.Jump
                    val easing = value.optJSONArray("easing")
                    val linear =
                        easing != null &&
                            easing.length() == 4 &&
                            (0 until 4).map { easing.getDouble(it) } == listOf(0.0, 0.0, 1.0, 1.0)
                    Animation.Ease(min(duration, limit).roundToInt(), !linear)
                }
                "fly" -> {
                    if (reducedMotion) return Animation.Jump
                    val length =
                        duration
                            ?: (NativeCameraMath.flightDuration(
                                start,
                                target,
                                width,
                                height,
                                value.optDouble("speed", 1.2),
                                value.optDouble("curve", 1.42),
                                value.optDouble("minZoom").takeUnless { it.isNaN() },
                            ) * 1000)
                    if (length <= 0 || length > limit) Animation.Jump
                    else Animation.Fly(length.roundToInt())
                }
                else -> Animation.Jump
            }
        }
    }
}

/** Web Mercator and flight arithmetic for the camera: the world is 512 dp wide at zoom 0. */
internal object NativeCameraMath {
    /** The latitude where Web Mercator's square world ends. */
    const val MAXIMUM_LATITUDE = 85.05112877980659

    fun wrap(longitude: Double): Double {
        if (longitude in -180.0..180.0) return longitude
        val wrapped = (longitude + 180) % 360
        return (if (wrapped < 0) wrapped + 360 else wrapped) - 180
    }

    /** A coordinate in the world's unit square: x eastwards and y southwards, from 0 to 1. */
    fun project(coordinate: TileflowCoordinate): Pair<Double, Double> {
        val latitude = coordinate.latitude.coerceIn(-MAXIMUM_LATITUDE, MAXIMUM_LATITUDE)
        val sine = sin(latitude * PI / 180)
        return (coordinate.longitude + 180) / 360 to 0.5 - ln((1 + sine) / (1 - sine)) / (4 * PI)
    }

    fun unproject(x: Double, y: Double): TileflowCoordinate {
        val angle = (0.5 - y) * 2 * PI
        return TileflowCoordinate(x * 360 - 180, atan(sinh(angle)) * 180 / PI)
    }

    private fun latitude(y: Double): Double = unproject(0.5, y).latitude

    /**
     * Bounds as the web reports a view: longitudes within [-180, 180], an east edge west of the
     * west edge across the antimeridian, and the whole world for a view wider than it.
     */
    fun normalized(west: Double, south: Double, east: Double, north: Double): TileflowBounds {
        val width = east - west
        if (width >= 360) return TileflowBounds(-180.0, south, 180.0, north)
        val start = wrap(west)
        val end = start + width
        return TileflowBounds(start, south, if (end > 180) end - 360 else end, north)
    }

    /** The centre after zooming by [delta] levels while [anchor] stays where it is on screen. */
    fun center(delta: Double, anchor: TileflowCoordinate, center: TileflowCoordinate): TileflowCoordinate {
        val (ax, ay) = project(anchor)
        var (cx, cy) = project(center)
        // Across the antimeridian, the shorter way round.
        if (cx - ax > 0.5) cx -= 1.0 else if (ax - cx > 0.5) cx += 1.0
        val scale = 2.0.pow(-delta)
        val result = unproject(ax + (cx - ax) * scale, ay + (cy - ay) * scale)
        return result.copy(longitude = wrap(result.longitude))
    }

    /**
     * The coordinate [dx], [dy] density-independent pixels away on screen, ignoring pitch. With a
     * bearing, the top of the screen points that way, so screen vectors turn clockwise onto the map.
     */
    fun shifted(
        coordinate: TileflowCoordinate,
        dx: Double,
        dy: Double,
        zoom: Double,
        bearing: Double,
    ): TileflowCoordinate {
        if (dx == 0.0 && dy == 0.0) return coordinate
        val world = 512 * 2.0.pow(zoom)
        val angle = bearing * PI / 180
        val x = dx * cos(angle) - dy * sin(angle)
        val y = dx * sin(angle) + dy * cos(angle)
        val (px, py) = project(coordinate)
        return unproject(px + x / world, py + y / world)
    }

    /** Where a camera's target may go for the whole view to stay inside bounds. */
    data class TargetBounds(
        val west: Double,
        val south: Double,
        val east: Double,
        val north: Double,
        /** The lowest zoom at which the view fits inside the bounds. */
        val minZoom: Double,
    )

    /**
     * The bounds less half a view of [width] × [height] density-independent pixels at [zoom] on each
     * side; a single point where the view is larger than the bounds.
     */
    fun targetBounds(bounds: TileflowBounds, width: Double, height: Double, zoom: Double): TargetBounds {
        val east = if (bounds.east < bounds.west) bounds.east + 360 else bounds.east
        val x0 = (bounds.west + 180) / 360
        val x1 = (east + 180) / 360
        val y0 = project(TileflowCoordinate(0.0, bounds.north)).second
        val y1 = project(TileflowCoordinate(0.0, bounds.south)).second
        val world = 512 * 2.0.pow(zoom)
        val halfWidth = width / 2 / world
        val halfHeight = height / 2 / world
        var left = x0 + halfWidth
        var right = x1 - halfWidth
        if (left > right) {
            left = (x0 + x1) / 2
            right = left
        }
        var top = y0 + halfHeight
        var bottom = y1 - halfHeight
        if (top > bottom) {
            top = (y0 + y1) / 2
            bottom = top
        }
        val minZoom =
            max(
                log2(width / ((x1 - x0).coerceAtLeast(1e-12) * 512)),
                log2(height / ((y1 - y0).coerceAtLeast(1e-12) * 512)),
            )
        return TargetBounds(left * 360 - 180, latitude(bottom), right * 360 - 180, latitude(top), minZoom)
    }

    /**
     * How long, in seconds, a flight lasts at [speed] screenfuls per second along the zoom and pan
     * curve of van Wijk and Nuij, "Smooth and efficient zooming and panning" (2003). [curve] is the
     * curve's ρ; [minZoom] sets the curve's highest point instead.
     */
    fun flightDuration(
        start: TileflowCamera,
        end: TileflowCamera,
        width: Double,
        height: Double,
        speed: Double,
        curve: Double,
        minZoom: Double?,
    ): Double {
        val w0 = max(width, height)
        if (w0 <= 0 || speed <= 0) return 0.0
        val w1 = w0 / 2.0.pow(end.zoom - start.zoom)
        val (ax, ay) = project(TileflowCoordinate(start.longitude, start.latitude))
        val (bx, by) = project(TileflowCoordinate(end.longitude, end.latitude))
        var dx = bx - ax
        if (dx > 0.5) dx -= 1.0 else if (dx < -0.5) dx += 1.0
        // The distance between the centres, in dp at the starting zoom.
        val u1 = hypot(dx, by - ay) * 512 * 2.0.pow(start.zoom)
        var rho = curve
        if (minZoom != null && u1 > 0) {
            val peak = min(minZoom, min(start.zoom, end.zoom))
            rho = sqrt(w0 / 2.0.pow(peak - start.zoom) / u1 * 2)
        }
        val rho2 = rho * rho
        fun r(last: Boolean): Double {
            val w = if (last) w1 else w0
            val b = (w1 * w1 - w0 * w0 + (if (last) -1 else 1) * rho2 * rho2 * u1 * u1) / (2 * w * rho2 * u1)
            return ln(sqrt(b * b + 1) - b)
        }
        var length = (r(true) - r(false)) / rho
        if (abs(u1) < 1e-6 || !length.isFinite()) {
            if (abs(w0 - w1) < 1e-6) return 0.0
            length = abs(ln(w1 / w0)) / rho
        }
        return length / speed
    }
}
