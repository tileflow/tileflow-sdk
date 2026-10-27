package dev.tileflow.sdk

import org.json.JSONArray
import org.json.JSONObject

public data class TileflowAnnotation(
    val id: String,
    val coordinate: TileflowCoordinate,
    val title: String,
    val color: String = "#e9573f",
) {
    internal fun json(): JSONObject {
        if (
            !Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$").matches(id) ||
                title.isBlank() ||
                title.length > 256 ||
                coordinate.longitude !in -180.0..180.0 ||
                coordinate.latitude !in -90.0..90.0 ||
                !Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$").matches(color)
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        return JSONObject()
            .put("id", id)
            .put("kind", "marker")
            .put("ariaLabel", title)
            .put("coordinate", JSONArray(listOf(coordinate.longitude, coordinate.latitude)))
            .put("marker", JSONObject().put("color", color))
    }
}

public enum class TileflowGeoJSONLayerKind(internal val wireName: String) {
    CIRCLE("circle"),
    LINE("line"),
    FILL("fill"),
}

/** An application-owned FeatureCollection. The protocol bounds each update. */
public class TileflowGeoJSONLayer(
    public val id: String,
    geoJSON: String,
    public val kind: TileflowGeoJSONLayerKind,
    public val color: String = "#e9573f",
    public val size: Double = 6.0,
    public val opacity: Double = 1.0,
) {
    private val data: JSONObject

    init {
        try {
            require(
                Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$").matches(id) &&
                    geoJSON.toByteArray().size <= 49_152
            )
            require(
                Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$").matches(color) &&
                    size in 0.0..64.0 &&
                    opacity in 0.0..1.0
            )
            data = JSONObject(geoJSON)
            require(
                data.opt("type") == "FeatureCollection" &&
                    data.getJSONArray("features").length() <= 2000
            )
        } catch (_: Exception) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
    }

    internal fun json(): JSONObject =
        JSONObject()
            .put("id", id)
            .put("data", data)
            .put("kind", kind.wireName)
            .put("color", color)
            .put("size", size)
            .put("opacity", opacity)
}

public data class TileflowPoiSelection(
    val id: String?,
    val coordinate: TileflowCoordinate,
    val name: String?,
    val category: String,
)

internal data class MapContent(
    val annotations: List<TileflowAnnotation> = emptyList(),
    val overlays: List<TileflowGeoJSONLayer> = emptyList(),
) {
    fun json(): JSONObject {
        if (
            annotations.size > 128 ||
                overlays.size > 16 ||
                annotations.map { it.id }.toSet().size != annotations.size ||
                overlays.map { it.id }.toSet().size != overlays.size
        )
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val value =
            JSONObject()
                .put("annotations", JSONArray(annotations.map { it.json() }))
                .put("overlays", JSONArray(overlays.map { it.json() }))
        if (value.toString().toByteArray().size > 60_000)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        return value
    }
}
