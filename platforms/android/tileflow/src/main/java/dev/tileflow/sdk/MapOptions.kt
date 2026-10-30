package dev.tileflow.sdk

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

public data class TileflowMapOptions(
    val viewMode: TileflowViewMode = TileflowViewMode.FLAT,
    val quality: TileflowQuality = TileflowQuality.BALANCED,
    val gestures: TileflowGestures = TileflowGestures(),
    val controls: Boolean = true,
) {
    internal fun json(): JSONObject =
        JSONObject()
            .put("viewMode", viewMode.wireName)
            .put("quality", quality.wireName)
            .put("gestures", gestures.json())
            .put("controls", controls)
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
