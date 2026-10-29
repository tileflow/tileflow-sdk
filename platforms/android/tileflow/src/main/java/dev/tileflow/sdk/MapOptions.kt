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

/**
 * Which gestures move the map, and how.
 *
 * @property zoom Pinching, double taps and other zoom gestures.
 * @property doubleTapZoom Whether a double tap zooms in and a two-finger tap zooms out, while
 *   [zoom] is on.
 * @property doubleTapZoomDelta How many zoom levels a double tap adds, from 0.25 to 4.
 * @property cooperative One finger scrolls what surrounds the map, such as a list or a page, and
 *   two fingers move the map. The map shows a hint when one finger tries to move it.
 */
public data class TileflowGestures(
    val pan: Boolean = true,
    val zoom: Boolean = true,
    val rotate: Boolean = true,
    val pitch: Boolean = true,
    val doubleTapZoom: Boolean = true,
    val doubleTapZoomDelta: Double = 1.0,
    val cooperative: Boolean = false,
) {
    /** Whether any gesture moves the map, so the map takes touches from scrolling parents. */
    internal val movesMap: Boolean
        get() = pan || zoom || rotate || pitch

    internal fun json(): JSONObject {
        if (doubleTapZoomDelta !in 0.25..4.0)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        return JSONObject()
            .put("pan", pan)
            .put("zoom", zoom)
            .put("rotate", rotate)
            .put("pitch", pitch)
            .put("doubleTapZoom", doubleTapZoom)
            .put("doubleTapZoomDelta", doubleTapZoomDelta)
            .put("cooperative", cooperative)
    }

    public companion object {
        /** No gesture moves the map; taps and long presses are still reported. */
        public val NONE: TileflowGestures =
            TileflowGestures(
                pan = false,
                zoom = false,
                rotate = false,
                pitch = false,
                doubleTapZoom = false,
            )
    }
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
 * @property quality The rendering quality. Null uses [TileflowDeviceProfile.current]'s quality when
 *   the options reach the map.
 * @property controls The compass, scale bar, recenter button and attribution. The attribution is
 *   always shown.
 * @property cameraLimits Where the camera may go.
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
    val quality: TileflowQuality? = null,
    val gestures: TileflowGestures = TileflowGestures(),
    val controls: TileflowMapControls = TileflowMapControls(),
    val cameraLimits: TileflowCameraLimits = TileflowCameraLimits(),
    val events: TileflowEventOptions = TileflowEventOptions(),
    val vegetation: Boolean? = null,
    val antialias: Boolean = true,
    val validatesStyle: Boolean = false,
) {
    /**
     * The renderer's options. Event delivery is set up separately by the SDK; the attribution's
     * corner follows the layout direction.
     */
    internal fun json(rightToLeft: Boolean = false): JSONObject =
        JSONObject()
            .put("viewMode", viewMode.wireName)
            .put(
                "quality",
                (quality ?: TileflowDeviceProfile.known()?.quality ?: TileflowQuality.BALANCED)
                    .wireName,
            )
            .put("gestures", gestures.json())
            .put("limits", cameraLimits.json())
            .put("attribution", controls.attributionPosition.corner(rightToLeft))
            .put("vegetation", vegetation ?: JSONObject.NULL)

    /** Options fixed for a renderer's lifetime. */
    internal fun rendererJson(): JSONObject =
        JSONObject().put("antialias", antialias).put("validateStyle", validatesStyle)

    internal fun validate() {
        events.validate()
        json()
    }
}

public data class TileflowCoordinate(val longitude: Double, val latitude: Double)

public data class TileflowPoint(val x: Float, val y: Float)

/** An east edge west of the west edge describes a region crossing the antimeridian. */
public data class TileflowBounds(
    val west: Double,
    val south: Double,
    val east: Double,
    val north: Double,
) {
    public companion object {
        /**
         * The smallest bounds that contain every coordinate, crossing the antimeridian when that is
         * narrower. Null without coordinates.
         */
        public fun enclosing(coordinates: List<TileflowCoordinate>): TileflowBounds? {
            if (coordinates.isEmpty()) return null
            val longitudes = coordinates.map { it.longitude }.sorted()
            // The widest gap between neighbouring longitudes, including the one across the
            // antimeridian, is the part of the world the bounds leave out.
            var gap = longitudes.first() + 360 - longitudes.last()
            var west = longitudes.first()
            var east = longitudes.last()
            for ((previous, next) in longitudes.zipWithNext()) {
                if (next - previous > gap) {
                    gap = next - previous
                    west = next
                    east = previous
                }
            }
            return TileflowBounds(
                west,
                coordinates.minOf { it.latitude },
                east,
                coordinates.maxOf { it.latitude },
            )
        }
    }
}
