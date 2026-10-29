package dev.tileflow.sdk

import org.json.JSONArray
import org.json.JSONObject

private fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

/**
 * A change to some of the camera's values. Values left null keep their current value, so an update
 * can, for example, turn the map to north without moving it.
 *
 * @property bearing Degrees clockwise from north.
 * @property pitch Degrees from looking straight down, from 0 to 85.
 */
public data class TileflowCameraUpdate(
    val center: TileflowCoordinate? = null,
    val zoom: Double? = null,
    val bearing: Double? = null,
    val pitch: Double? = null,
) {
    /** Every value of a camera. */
    public constructor(
        camera: TileflowCamera
    ) : this(
        TileflowCoordinate(camera.longitude, camera.latitude),
        camera.zoom,
        camera.bearing,
        camera.pitch,
    )

    /** The camera this update leads to from [camera]. */
    internal fun appliedTo(camera: TileflowCamera): TileflowCamera =
        TileflowCamera(
            center?.longitude ?: camera.longitude,
            center?.latitude ?: camera.latitude,
            zoom ?: camera.zoom,
            bearing ?: camera.bearing,
            pitch ?: camera.pitch,
        )

    internal fun json(): JSONObject {
        val target = JSONObject()
        center?.let {
            if (it.longitude !in -180.0..180.0 || it.latitude !in -90.0..90.0) invalid()
            target.put(
                "center",
                JSONObject().put("longitude", it.longitude).put("latitude", it.latitude),
            )
        }
        for ((key, value, range) in
            listOf(
                Triple("zoom", zoom, 0.0..24.0),
                Triple("bearing", bearing, -360.0..360.0),
                Triple("pitch", pitch, 0.0..TileflowCameraLimits.MAXIMUM_PITCH),
            )) {
            if (value == null) continue
            if (value !in range) invalid()
            target.put(key, value)
        }
        return target
    }
}

/**
 * A timing curve for camera animations: a cubic Bézier through (0, 0) and (1, 1), as CSS
 * `cubic-bezier()`. The horizontal control coordinates [x1] and [x2] must lie between 0 and 1.
 */
public data class TileflowEasing(val x1: Double, val y1: Double, val x2: Double, val y2: Double) {
    internal fun json(): JSONArray {
        if (x1 !in 0.0..1.0 || x2 !in 0.0..1.0 || y1 !in -8.0..8.0 || y2 !in -8.0..8.0) invalid()
        return JSONArray().put(x1).put(y1).put(x2).put(y2)
    }

    public companion object {
        /** Starts quickly and settles gently; the default. */
        public val STANDARD: TileflowEasing = TileflowEasing(0.25, 0.1, 0.25, 1.0)
        public val LINEAR: TileflowEasing = TileflowEasing(0.0, 0.0, 1.0, 1.0)
        public val EASE_IN: TileflowEasing = TileflowEasing(0.42, 0.0, 1.0, 1.0)
        public val EASE_OUT: TileflowEasing = TileflowEasing(0.0, 0.0, 0.58, 1.0)
        public val EASE_IN_OUT: TileflowEasing = TileflowEasing(0.42, 0.0, 0.58, 1.0)
    }
}

/**
 * A flight: the camera zooms out, travels and zooms in along a curve.
 *
 * @property durationMillis Null derives the duration from [speed]. Flights last at most 20 seconds;
 *   a longer one jumps.
 * @property speed The average speed, in screenfuls per second along the curve, when
 *   [durationMillis] is null.
 * @property curve How far the camera zooms out along the way; 1.42 is the curve people perceive as
 *   natural.
 * @property minZoom The zoom at the top of the curve, instead of one derived from [curve].
 */
public data class TileflowFlyOptions(
    val durationMillis: Long? = null,
    val speed: Double = 1.2,
    val curve: Double = 1.42,
    val minZoom: Double? = null,
    val easing: TileflowEasing = TileflowEasing.STANDARD,
)

/**
 * How the camera reaches its target. Animations last at most
 * [TileflowCameraAnimation.MAXIMUM_DURATION_MILLIS].
 *
 * When the person using the device asks for reduced motion, the renderer may move at once instead;
 * the movement still ends as [TileflowCameraAnimationResult.FINISHED].
 */
public sealed interface TileflowCameraAnimation {
    /** Moves at once. */
    public data object None : TileflowCameraAnimation

    /** Changes every value along the same timing curve. */
    public data class Ease(
        val durationMillis: Long = 500,
        val easing: TileflowEasing = TileflowEasing.STANDARD,
    ) : TileflowCameraAnimation

    /** Zooms out, travels and zooms in. */
    public data class Fly(val options: TileflowFlyOptions = TileflowFlyOptions()) :
        TileflowCameraAnimation

    public companion object {
        /** The longest animation. Every movement answers within a request's time limit. */
        public const val MAXIMUM_DURATION_MILLIS: Long = 20_000
    }
}

internal fun TileflowCameraAnimation.json(): JSONObject {
    fun duration(millis: Long): Long =
        millis.takeIf { it in 0..TileflowCameraAnimation.MAXIMUM_DURATION_MILLIS } ?: invalid()
    return when (this) {
        TileflowCameraAnimation.None -> JSONObject().put("type", "jump")
        is TileflowCameraAnimation.Ease ->
            JSONObject()
                .put("type", "ease")
                .put("duration", duration(durationMillis))
                .put("easing", easing.json())
        is TileflowCameraAnimation.Fly -> {
            if (
                options.speed !in 0.01..100.0 ||
                    options.curve !in 0.01..100.0 ||
                    options.minZoom?.let { it !in 0.0..24.0 } == true
            )
                invalid()
            JSONObject()
                .put("type", "fly")
                .put("speed", options.speed)
                .put("curve", options.curve)
                .put("easing", options.easing.json())
                .apply {
                    options.durationMillis?.let { put("duration", duration(it)) }
                    options.minZoom?.let { put("minZoom", it) }
                }
        }
    }
}

/** How a camera movement ended. */
public enum class TileflowCameraAnimationResult(internal val wireName: String) {
    /** The camera reached its target. */
    FINISHED("finished"),
    /** The application stopped the movement or started another one. */
    CANCELLED("cancelled"),
    /** A person took over the map, or the map moved for another reason, before the target. */
    INTERRUPTED("interrupted"),
    ;

    internal companion object {
        fun fromWire(value: String?): TileflowCameraAnimationResult? =
            entries.firstOrNull { it.wireName == value }
    }
}

/**
 * Where the camera may go. Changing the limits moves a camera that lies outside them.
 *
 * @property bounds The region the view must stay within, or null for the whole world.
 */
public data class TileflowCameraLimits(
    val minZoom: Double = 0.0,
    val maxZoom: Double = 24.0,
    val minPitch: Double = 0.0,
    val maxPitch: Double = MAXIMUM_PITCH,
    val bounds: TileflowBounds? = null,
) {
    internal fun json(): JSONObject {
        if (
            minZoom !in 0.0..24.0 ||
                maxZoom !in 0.0..24.0 ||
                minZoom > maxZoom ||
                minPitch !in 0.0..MAXIMUM_PITCH ||
                maxPitch !in 0.0..MAXIMUM_PITCH ||
                minPitch > maxPitch
        )
            invalid()
        return JSONObject()
            .put("minZoom", minZoom)
            .put("maxZoom", maxZoom)
            .put("minPitch", minPitch)
            .put("maxPitch", maxPitch)
            .put("bounds", bounds?.json() ?: JSONObject.NULL)
    }

    public companion object {
        /** Tileflow's steepest pitch: the camera can look along a street to the sky. */
        public const val MAXIMUM_PITCH: Double = 85.0
    }
}

internal fun TileflowBounds.json(): JSONObject {
    if (
        west !in -180.0..180.0 ||
            east !in -180.0..180.0 ||
            south !in -90.0..90.0 ||
            north !in -90.0..90.0 ||
            south > north
    )
        invalid()
    return JSONObject().put("west", west).put("south", south).put("east", east).put("north", north)
}

internal fun boundsFrom(json: JSONObject): TileflowBounds =
    TileflowBounds(
        json.getDouble("west"),
        json.getDouble("south"),
        json.getDouble("east"),
        json.getDouble("north"),
    )

/** A gesture a person makes on the map. */
public enum class TileflowGesture(internal val wireName: String) {
    PAN("pan"),
    ZOOM("zoom"),
    ROTATE("rotate"),
    PITCH("pitch");

    internal companion object {
        fun fromWire(value: String?): TileflowGesture? =
            entries.firstOrNull { it.wireName == value }
    }
}

/** Space at each edge of a view, in physical pixels. */
public data class TileflowEdgeInsets(
    val left: Float = 0f,
    val top: Float = 0f,
    val right: Float = 0f,
    val bottom: Float = 0f,
) {
    internal fun valid(): Boolean =
        listOf(left, top, right, bottom).all { it.isFinite() && it >= 0f }

    /** The renderer's insets, in CSS pixels. */
    internal fun css(density: Float): JSONObject {
        fun value(inset: Float) = (inset / density).toDouble().coerceIn(0.0, 8192.0)
        return JSONObject()
            .put("top", value(top))
            .put("left", value(left))
            .put("bottom", value(bottom))
            .put("right", value(right))
    }

    public companion object {
        public val ZERO: TileflowEdgeInsets = TileflowEdgeInsets()
    }
}

internal fun TileflowCamera.isValid(): Boolean =
    longitude in -180.0..180.0 &&
        latitude in -90.0..90.0 &&
        zoom in 0.0..24.0 &&
        bearing in -360.0..360.0 &&
        pitch in 0.0..TileflowCameraLimits.MAXIMUM_PITCH

internal fun cameraOrNull(value: Any?): TileflowCamera? =
    (value as? JSONObject)?.let { runCatching { TileflowCamera.from(it) }.getOrNull() }?.takeIf {
        it.isValid()
    }
