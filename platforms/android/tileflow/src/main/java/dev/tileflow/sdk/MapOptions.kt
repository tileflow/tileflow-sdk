package dev.tileflow.sdk

import dev.tileflow.sdk.bridge.ProtocolContract
import org.json.JSONObject

public enum class TileflowTimeOfDay(internal val wireName: String) {
    DAY("day"),
    DAWN("dawn"),
    DUSK("dusk"),
    NIGHT("night"),
}

public enum class TileflowViewMode(internal val wireName: String) {
    FLAT("2d"),
    THREE_DIMENSIONAL("3d"),
}

/** Explicit rendering budgets. Performance also depends on the map's data and design. */
public enum class TileflowQuality(internal val wireName: String) {
    LOW("low"),
    BALANCED("balanced"),
    HIGH("high"),
}

public data class TileflowGestures(
    val pan: Boolean = true,
    val zoom: Boolean = true,
    val rotate: Boolean = true,
    val pitch: Boolean = true,
) {
    internal fun json(): JSONObject =
        JSONObject().put("pan", pan).put("zoom", zoom).put("rotate", rotate).put("pitch", pitch)
}

/**
 * Which events the map reports. Events beyond the chosen level are never sent by the renderer, so
 * a map that does not need camera updates does not pay for them.
 *
 * @property level [TileflowEventLevel.ESSENTIAL] reports the camera when it settles,
 *   [TileflowEventLevel.CAMERA] also when it starts to move, and [TileflowEventLevel.CONTINUOUS]
 *   also while it moves.
 * @property cameraUpdateIntervalMillis At [TileflowEventLevel.CONTINUOUS], the shortest time
 *   between camera updates while the camera moves, from 0 (once per rendered frame) to 60 000. The
 *   latest camera is always delivered.
 */
public data class TileflowEventOptions(
    val level: TileflowEventLevel = TileflowEventLevel.ESSENTIAL,
    val cameraUpdateIntervalMillis: Long = 0,
) {
    internal fun validate() {
        if (cameraUpdateIntervalMillis !in 0..ProtocolContract.MAXIMUM_THROTTLE_MILLIS)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
    }
}

/**
 * @property events Which events the map reports.
 * @property vegetation Shows or hides the map's 3D vegetation; null keeps what the map's design
 *   chooses.
 * @property antialias Multisampling, which smooths the thin edges of 3D buildings, trees and
 *   models. Changing it starts a new renderer.
 * @property validatesStyle Validates each style as the renderer loads it, reporting problems as
 *   warnings. Tileflow validates its styles when it builds them, so this is off by default.
 *   Changing it starts a new renderer.
 */
public data class TileflowMapOptions(
    val viewMode: TileflowViewMode = TileflowViewMode.FLAT,
    val quality: TileflowQuality = TileflowQuality.BALANCED,
    val gestures: TileflowGestures = TileflowGestures(),
    val controls: Boolean = true,
    val events: TileflowEventOptions = TileflowEventOptions(),
    val vegetation: Boolean? = null,
    val antialias: Boolean = true,
    val validatesStyle: Boolean = false,
) {
    /** The renderer's options. Event delivery is set up separately by the SDK. */
    internal fun json(): JSONObject =
        JSONObject()
            .put("viewMode", viewMode.wireName)
            .put("quality", quality.wireName)
            .put("gestures", gestures.json())
            .put("controls", controls)
            .put("vegetation", vegetation ?: JSONObject.NULL)

    /** Options fixed for a renderer's lifetime. */
    internal fun rendererJson(): JSONObject =
        JSONObject().put("antialias", antialias).put("validateStyle", validatesStyle)
}

public data class TileflowCoordinate(val longitude: Double, val latitude: Double)

public data class TileflowPoint(val x: Float, val y: Float)

/** An east edge west of the west edge describes a region crossing the antimeridian. */
public data class TileflowBounds(
    val west: Double,
    val south: Double,
    val east: Double,
    val north: Double,
)
