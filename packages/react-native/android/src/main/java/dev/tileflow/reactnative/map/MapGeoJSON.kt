package dev.tileflow.reactnative.map

import dev.tileflow.sdk.TileflowFeature
import dev.tileflow.sdk.TileflowGeometry
import dev.tileflow.sdk.TileflowJSON
import dev.tileflow.sdk.TileflowQueriedFeature
import org.json.JSONArray
import org.json.JSONObject

internal object MapGeoJSON {
    fun value(raw: Any?): TileflowJSON = when (raw) {
        null, JSONObject.NULL -> TileflowJSON.Null
        is Boolean -> TileflowJSON.Bool(raw)
        is Number -> TileflowJSON.Number(MapValues.number(raw))
        is String -> TileflowJSON.Text(raw)
        is JSONArray -> TileflowJSON.Array(MapValues.list(raw, ::value))
        is JSONObject -> TileflowJSON.Object(raw.keys().asSequence().associateWith { value(raw.get(it)) })
        else -> MapValues.invalid()
    }

    fun value(raw: TileflowJSON): Any = when (raw) {
        TileflowJSON.Null -> JSONObject.NULL
        is TileflowJSON.Bool -> raw.value
        is TileflowJSON.Number -> raw.value
        is TileflowJSON.Text -> raw.value
        is TileflowJSON.Array -> JSONArray(raw.values.map(::value))
        is TileflowJSON.Object -> JSONObject().also { json -> raw.values.forEach { (key, cell) -> json.put(key, value(cell)) } }
    }

    fun geometry(json: JSONObject): TileflowGeometry {
        val coordinates = json.getJSONArray("coordinates")
        fun points(array: JSONArray) = MapValues.list(array) { MapValues.coordinate(it as? JSONArray ?: MapValues.invalid()) }
        fun lines(array: JSONArray) = MapValues.list(array) { points(it as? JSONArray ?: MapValues.invalid()) }
        return when (MapValues.string(json.get("type"))) {
            "Point" -> TileflowGeometry.Point(MapValues.coordinate(coordinates))
            "MultiPoint" -> TileflowGeometry.MultiPoint(points(coordinates))
            "LineString" -> TileflowGeometry.LineString(points(coordinates))
            "MultiLineString" -> TileflowGeometry.MultiLineString(lines(coordinates))
            "Polygon" -> TileflowGeometry.Polygon(lines(coordinates))
            "MultiPolygon" -> TileflowGeometry.MultiPolygon(MapValues.list(coordinates) { lines(it as? JSONArray ?: MapValues.invalid()) })
            else -> MapValues.invalid()
        }
    }

    fun feature(json: JSONObject): TileflowFeature {
        if (json.get("type") != "Feature") MapValues.invalid()
        val id = when (val raw = json.opt("id")) {
            null, JSONObject.NULL -> null
            is String -> raw
            is Number -> {
                val number = MapValues.number(raw)
                if (number == Math.rint(number) && number >= 0 && number < 1e15) number.toLong().toString()
                else MapValues.invalid()
            }
            else -> MapValues.invalid()
        }
        val geometry = MapValues.objectValue(json, "geometry")?.let(::geometry)
        val properties = MapValues.objectValue(json, "properties") ?: JSONObject()
        return TileflowFeature(id, geometry, (value(properties) as TileflowJSON.Object).values)
    }

    fun geometry(value: TileflowGeometry): JSONObject {
        val type: String
        val coordinates: JSONArray
        fun points(values: List<dev.tileflow.sdk.TileflowCoordinate>) = JSONArray(values.map(MapValues::coordinate))
        fun lines(values: List<List<dev.tileflow.sdk.TileflowCoordinate>>) = JSONArray(values.map(::points))
        when (value) {
            is TileflowGeometry.Point -> { type = "Point"; coordinates = MapValues.coordinate(value.coordinate) }
            is TileflowGeometry.MultiPoint -> { type = "MultiPoint"; coordinates = points(value.coordinates) }
            is TileflowGeometry.LineString -> { type = "LineString"; coordinates = points(value.coordinates) }
            is TileflowGeometry.MultiLineString -> { type = "MultiLineString"; coordinates = lines(value.lines) }
            is TileflowGeometry.Polygon -> { type = "Polygon"; coordinates = lines(value.rings) }
            is TileflowGeometry.MultiPolygon -> { type = "MultiPolygon"; coordinates = JSONArray(value.polygons.map(::lines)) }
        }
        return JSONObject().put("type", type).put("coordinates", coordinates)
    }

    fun feature(value: TileflowFeature): JSONObject {
        val json = JSONObject().put("type", "Feature")
            .put("geometry", value.geometry?.let(::geometry) ?: JSONObject.NULL)
            .put("properties", value(TileflowJSON.Object(value.properties)))
        value.id?.let { id -> json.put("id", if (Regex("^(0|[1-9][0-9]{0,14})$").matches(id)) id.toLong() else id) }
        return json
    }

    fun features(values: List<TileflowQueriedFeature>): JSONArray = JSONArray(values.map { feature(it.feature) })
}
