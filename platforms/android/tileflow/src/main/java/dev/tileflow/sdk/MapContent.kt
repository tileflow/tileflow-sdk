package dev.tileflow.sdk

import kotlin.math.abs
import kotlin.math.floor
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
            require(GeoJSONContract.isFeatureCollection(data))
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

/**
 * The renderer's GeoJSON contract, checked before content crosses the bridge so invalid content
 * fails at the call instead of in the renderer.
 */
internal object GeoJSONContract {
    fun isFeatureCollection(value: Any?): Boolean =
        value is JSONObject &&
            value.opt("type") == "FeatureCollection" &&
            keys(value, "type", "features", "bbox") &&
            isBoundingBox(value) &&
            items(value.opt("features"), 0..2000)?.all(::isFeature) == true

    private fun isFeature(value: Any?): Boolean {
        if (
            value !is JSONObject ||
                value.opt("type") != "Feature" ||
                !keys(value, "type", "id", "geometry", "properties", "bbox") ||
                !isBoundingBox(value) ||
                !value.has("geometry") ||
                !value.has("properties")
        )
            return false
        when (val id = value.opt("id")) {
            null,
            is String -> if (id != null && id.length > 128) return false
            is Number ->
                id.toDouble().let {
                    if (it != floor(it) || abs(it) > 9_007_199_254_740_991.0) return false
                }
            else -> return false
        }
        when (val properties = value.get("properties")) {
            JSONObject.NULL -> Unit
            is JSONObject ->
                for (key in properties.keys()) {
                    if (key.length > 128 || depth(properties.get(key)) > 64) return false
                }
            else -> return false
        }
        val geometry = value.get("geometry")
        return geometry == JSONObject.NULL || isGeometry(geometry)
    }

    private fun isGeometry(value: Any?): Boolean {
        if (
            value !is JSONObject ||
                !keys(value, "type", "coordinates", "bbox") ||
                !isBoundingBox(value) ||
                !value.has("coordinates")
        )
            return false
        val coordinates = value.get("coordinates")
        return when (value.opt("type")) {
            "Point" -> isPosition(coordinates)
            "MultiPoint" -> items(coordinates, 0..2000)?.all(::isPosition) == true
            "LineString" -> isLine(coordinates)
            "MultiLineString" -> items(coordinates, 0..128)?.all(::isLine) == true
            "Polygon" -> isPolygon(coordinates)
            "MultiPolygon" -> items(coordinates, 0..128)?.all(::isPolygon) == true
            else -> false
        }
    }

    private fun position(value: Any?): List<Double>? {
        val numbers = items(value, 2..3)?.map { (it as? Number)?.toDouble() ?: return null }
        return numbers?.takeIf {
            it.all(Double::isFinite) && it[0] in -180.0..180.0 && it[1] in -90.0..90.0
        }
    }

    private fun isPosition(value: Any?): Boolean = position(value) != null

    private fun isLine(value: Any?): Boolean = items(value, 2..4000)?.all(::isPosition) == true

    private fun isRing(value: Any?): Boolean {
        val positions = items(value, 4..4000)?.map { position(it) ?: return false } ?: return false
        return positions.first() == positions.last()
    }

    private fun isPolygon(value: Any?): Boolean = items(value, 1..128)?.all(::isRing) == true

    private fun isBoundingBox(value: JSONObject): Boolean {
        if (!value.has("bbox")) return true
        val box = items(value.get("bbox"), 4..6) ?: return false
        return box.size != 5 && box.all { (it as? Number)?.toDouble()?.isFinite() == true }
    }

    private fun keys(value: JSONObject, vararg allowed: String): Boolean =
        value.keys().asSequence().all { it in allowed }

    private fun items(value: Any?, count: IntRange): List<Any?>? =
        (value as? JSONArray)?.takeIf { it.length() in count }?.let { array ->
            (0 until array.length()).map(array::get)
        }

    private fun depth(value: Any?): Int =
        when (value) {
            is JSONArray -> 1 + ((0 until value.length()).maxOfOrNull { depth(value.get(it)) } ?: 0)
            is JSONObject ->
                1 + (value.keys().asSequence().maxOfOrNull { depth(value.get(it)) } ?: 0)
            else -> 0
        }
}
