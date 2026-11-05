package dev.tileflow.sdk.engine

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.stream.JsonReader
import dev.tileflow.sdk.GeoJSONLog
import dev.tileflow.sdk.RuntimeStyle
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.model.MapPayloadStore
import dev.tileflow.sdk.transport.MapResourceAddress
import java.io.StringReader
import java.net.URI
import kotlin.math.floor
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngQuad
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.sources.*

internal fun styleInvalid(message: String = "Invalid runtime style definition."): Nothing =
    throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST, TileflowErrorContext(message = message))

internal fun JSONArray.items(): List<Any> = (0 until length()).map(::get)

internal fun JSONObject.numberOr(key: String, default: Double, minimum: Double, maximum: Double): Double {
    if (!has(key)) return default
    val number = (opt(key) as? Number)?.toDouble() ?: styleInvalid(key)
    if (!number.isFinite() || number !in minimum..maximum) styleInvalid(key)
    return number
}

internal fun JSONObject.checkKeys(allowed: Set<String>) {
    keys().asSequence().firstOrNull { it !in allowed }?.let { styleInvalid("Unsupported style property: $it") }
}

internal class NativeStyleSource(
    val name: String,
    val spec: JSONObject,
    var geoJSON: String?,
    val projection: NativeStyleProjection?,
) {
    val id = "__tileflow_source_$name"
    val type: String = spec.getString("type")

    fun make(): Source = when (type) {
        "geojson" -> GeoJsonSource(id, options()).also { setData(it, geoJSON, spec.opt("data") as? String) }
        "image" -> {
            val corners = spec.getJSONArray("coordinates").items().map {
                val pair = it as JSONArray
                LatLng(pair.getDouble(1), pair.getDouble(0))
            }
            ImageSource(id, LatLngQuad(corners[0], corners[1], corners[2], corners[3]), URI(spec.getString("url")))
        }
        else -> {
            val templates = spec.optJSONArray("tiles")
            val archive = spec.optString("url")
            val set = templates?.let {
                TileSet("2.2.0", *it.items().map { item -> item as String }.toTypedArray()).apply {
                    if (spec.has("bounds")) setBounds(*spec.getJSONArray("bounds").items().map { n -> (n as Number).toFloat() }.toFloatArray())
                    if (spec.has("minzoom")) setMinZoom(spec.getDouble("minzoom").toFloat())
                    if (spec.has("maxzoom")) setMaxZoom(spec.getDouble("maxzoom").toFloat())
                    if (spec.has("scheme")) scheme = spec.getString("scheme")
                    if (spec.has("attribution")) attribution = spec.getString("attribution")
                    if (spec.has("encoding")) encoding = spec.getString("encoding")
                }
            }
            val size = spec.optInt("tileSize", 512)
            when (type) {
                "vector" -> if (set != null) VectorSource(id, set) else VectorSource(id, archive)
                "raster" -> if (set != null) RasterSource(id, set, size) else RasterSource(id, archive, size)
                "raster-dem" -> if (set != null) RasterDemSource(id, set, size) else RasterDemSource(id, archive, size)
                else -> styleInvalid(type)
            }
        }
    }

    private fun options(): GeoJsonOptions = GeoJsonOptions().apply {
        if (spec.has("maxzoom")) withMaxZoom(spec.getInt("maxzoom"))
        if (spec.has("cluster")) withCluster(spec.getBoolean("cluster"))
        if (spec.has("clusterRadius")) withClusterRadius(spec.getInt("clusterRadius"))
        if (spec.has("clusterMaxZoom")) withClusterMaxZoom(spec.getInt("clusterMaxZoom"))
        if (spec.has("clusterMinPoints")) withClusterMinPoints(spec.getInt("clusterMinPoints"))
        if (spec.has("buffer")) withBuffer(spec.getInt("buffer"))
        if (spec.has("lineMetrics")) withLineMetrics(spec.getBoolean("lineMetrics"))
        if (spec.has("tolerance")) withTolerance(spec.getDouble("tolerance").toFloat())
        spec.optJSONObject("clusterProperties")?.let { properties ->
            for (key in properties.keys()) {
                val pair = properties.getJSONArray(key)
                val reduce = when (val value = pair.get(0)) {
                    is String -> Expression.literal(value)
                    is JSONArray -> Expression.raw(value.toString())
                    else -> styleInvalid("clusterProperties")
                }
                withClusterProperty(key, reduce, Expression.raw(pair.getJSONArray(1).toString()))
            }
        }
    }

    companion object {
        const val EMPTY = """{"type":"FeatureCollection","features":[]}"""
        private val geoKeys = setOf("type", "data", "maxzoom", "attribution", "buffer", "tolerance", "cluster",
            "clusterRadius", "clusterMaxZoom", "clusterMinPoints", "clusterProperties", "lineMetrics", "generateId", "promoteId")
        private val tiledKeys = setOf("type", "url", "tiles", "minzoom", "maxzoom", "bounds", "scheme", "attribution")
        private val imageKeys = setOf("type", "url", "coordinates")

        fun validateQueued(source: RuntimeStyle.Source) {
            validate(source.spec)
            val data = source.geoJSON?.base
            if (data is GeoJSONLog.Base.Url) validateLocation(data.url, absolute = true)
            if (data is GeoJSONLog.Base.Bytes) validateGeoJSON(data.bytes.toString(Charsets.UTF_8))
        }

        fun validate(spec: JSONObject) {
            val type = spec.optString("type")
            when (type) {
                "geojson" -> {
                    spec.checkKeys(geoKeys)
                    for (key in listOf("cluster", "lineMetrics", "generateId"))
                        if (spec.has(key) && spec.opt(key) !is Boolean) styleInvalid(key)
                    for ((key, range) in mapOf("maxzoom" to 0..24, "buffer" to 0..512, "clusterMaxZoom" to 0..24,
                        "clusterRadius" to 0..65535, "clusterMinPoints" to 2..Int.MAX_VALUE)) {
                        val n = spec.numberOr(key, 0.0, range.first.toDouble(), range.last.toDouble())
                        if (n != floor(n)) styleInvalid(key)
                    }
                    spec.numberOr("tolerance", 0.0, 0.0, Float.MAX_VALUE.toDouble())
                    if (spec.has("promoteId") && (spec.opt("promoteId") as? String).isNullOrEmpty()) styleInvalid("promoteId")
                    if (spec.has("clusterProperties")) {
                        val properties = spec.optJSONObject("clusterProperties") ?: styleInvalid("clusterProperties")
                        if (properties.length() > 64) styleInvalid("clusterProperties")
                        for (key in properties.keys()) {
                            val pair = properties.optJSONArray(key) ?: styleInvalid(key)
                            if (pair.length() != 2 || pair.opt(0) !is String && pair.opt(0) !is JSONArray ||
                                pair.optJSONArray(1) == null) styleInvalid(key)
                        }
                    }
                }
                "image" -> {
                    spec.checkKeys(imageKeys)
                    validateLocation(spec.opt("url") as? String ?: styleInvalid("url"))
                    val points = spec.optJSONArray("coordinates") ?: styleInvalid("coordinates")
                    if (points.length() != 4 || !points.items().all { value ->
                            value is JSONArray && value.length() == 2 &&
                                (value.opt(0) as? Number)?.toDouble() in -180.0..180.0 &&
                                (value.opt(1) as? Number)?.toDouble() in -90.0..90.0
                        }) styleInvalid("coordinates")
                }
                "vector", "raster", "raster-dem" -> {
                    spec.checkKeys(when (type) {
                        "vector" -> tiledKeys + "encoding"
                        "raster" -> tiledKeys + "tileSize"
                        else -> tiledKeys + setOf("tileSize", "encoding")
                    })
                    if (spec.has("url") == spec.has("tiles")) styleInvalid("url or tiles")
                    if (spec.has("url")) validateLocation(spec.opt("url") as? String ?: styleInvalid("url"), archive = true)
                    spec.opt("tiles")?.let { value ->
                        if (value !is JSONArray || value.length() !in 1..16) styleInvalid("tiles")
                        value.items().forEach { validateLocation(it as? String ?: styleInvalid("tiles")) }
                    }
                    if (spec.has("scheme") && spec.opt("scheme") !in setOf("xyz", "tms")) styleInvalid("scheme")
                    if (spec.has("encoding") && spec.opt("encoding") !in
                        (if (type == "vector") setOf("mvt", "mlt") else setOf("mapbox", "terrarium"))) styleInvalid("encoding")
                    for (key in listOf("minzoom", "maxzoom")) spec.numberOr(key, 0.0, 0.0, 24.0)
                    val size = spec.numberOr("tileSize", 512.0, 64.0, 1024.0)
                    if (size != floor(size)) styleInvalid("tileSize")
                    if (spec.has("bounds")) {
                        val bounds = spec.optJSONArray("bounds") ?: styleInvalid("bounds")
                        if (bounds.length() != 4 || bounds.items().any { it !is Number || !it.toDouble().isFinite() }) styleInvalid("bounds")
                    }
                }
                else -> styleInvalid(type)
            }
            if (spec.has("attribution") && spec.opt("attribution") !is String) styleInvalid("attribution")
        }

        private operator fun ClosedFloatingPointRange<Double>.contains(value: Double?): Boolean =
            value != null && value >= start && value <= endInclusive

        fun validateLocation(value: String, absolute: Boolean = false, archive: Boolean = false) {
            val text = if (archive) value.removePrefix("pmtiles://") else value
            val uri = runCatching { URI(text.replace("{", "%7B").replace("}", "%7D")) }.getOrNull()
                ?: styleInvalid("Invalid resource URL")
            if (text.isBlank() || (absolute || uri.isAbsolute) &&
                (uri.scheme?.lowercase() !in setOf("https", "http") || uri.host == null || uri.userInfo != null) ||
                uri.rawAuthority != null && uri.userInfo != null) styleInvalid("Invalid resource URL")
        }

        fun data(reference: JSONObject, channel: MapPayloadStore): String? = when {
            reference.opt("empty") == true -> EMPTY
            reference.has("url") -> null
            else -> channel.payload(reference.optString("id"))?.bytes?.toString(Charsets.UTF_8) ?: styleInvalid("Unknown data")
        }

        fun setData(source: GeoJsonSource, inline: String?, address: String?) {
            if (inline != null) source.setGeoJson(inline) else source.setUri(address ?: styleInvalid("Missing GeoJSON"))
        }

        /** Walks the document without putting 100,000 feature objects on the Android heap. */
        fun validateGeoJSON(text: String) {
            try {
                val reader = JsonReader(StringReader(text))
                var type: String? = null
                var features = false
                var coordinates = false
                var geometries = false
                var geometry = false
                reader.beginObject()
                while (reader.hasNext()) {
                    when (val key = reader.nextName()) {
                        "type" -> type = reader.nextString()
                        "features" -> {
                            reader.beginArray()
                            while (reader.hasNext()) {
                                if (reader.peek() != com.google.gson.stream.JsonToken.BEGIN_OBJECT) styleInvalid("Invalid GeoJSON feature")
                                reader.skipValue()
                            }
                            reader.endArray()
                            features = true
                        }
                        "coordinates", "geometries" -> {
                            if (reader.peek() != com.google.gson.stream.JsonToken.BEGIN_ARRAY) styleInvalid("Invalid GeoJSON geometry")
                            reader.skipValue()
                            if (key == "coordinates") coordinates = true else geometries = true
                        }
                        "geometry" -> {
                            if (reader.peek() !in setOf(com.google.gson.stream.JsonToken.BEGIN_OBJECT, com.google.gson.stream.JsonToken.NULL))
                                styleInvalid("Invalid GeoJSON geometry")
                            reader.skipValue()
                            geometry = true
                        }
                        else -> reader.skipValue()
                    }
                }
                reader.endObject()
                val valid = when (type) {
                    "FeatureCollection" -> features
                    "GeometryCollection" -> geometries
                    "Feature" -> geometry
                    "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon" -> coordinates
                    else -> false
                }
                if (!valid || reader.peek() != com.google.gson.stream.JsonToken.END_DOCUMENT) styleInvalid("Invalid GeoJSON")
            } catch (_: Exception) {
                styleInvalid("Invalid GeoJSON")
            }
        }

        /** Maps selected identifiers while streaming the base collection, keeping feature order and other entries. */
        fun edit(text: String, spec: JSONObject, added: JSONArray?, removed: Set<String>, normalize: Boolean = false): String {
            val promotion = spec.opt("promoteId") as? String
            val generate = spec.optBoolean("generateId")
            if (normalize && promotion == null && !generate) {
                validateGeoJSON(text)
                return text
            }
            val pending = linkedMapOf<String, JsonObject>()
            fun id(feature: JsonObject): String? {
                val candidate = if (promotion != null) feature.getAsJsonObject("properties")?.get(promotion) else feature.get("id")
                return candidate?.takeIf { it.isJsonPrimitive && !it.asJsonPrimitive.isBoolean }?.asString
            }
            fun promote(feature: JsonObject, index: Int) {
                if (promotion != null) feature.getAsJsonObject("properties")?.get(promotion)?.let { feature.add("id", it) }
                else if (generate) feature.addProperty("id", index)
            }
            added?.items()?.forEach {
                val feature = JsonParser.parseString(it.toString()).asJsonObject
                pending[id(feature) ?: styleInvalid("Feature needs an id")] = feature
            }
            val output = StringBuilder(text.length).append("""{"type":"FeatureCollection","features":[""")
            var count = 0
            fun append(feature: JsonObject) {
                if (count > 0) output.append(',')
                promote(feature, count++)
                output.append(feature)
            }
            val reader = JsonReader(StringReader(text))
            var collection = false
            reader.beginObject()
            while (reader.hasNext()) {
                if (reader.nextName() != "features") { reader.skipValue(); continue }
                collection = true
                reader.beginArray()
                while (reader.hasNext()) {
                    val feature = JsonParser.parseReader(reader).asJsonObject
                    val key = id(feature)
                    if (key !in removed) append(pending.remove(key) ?: feature)
                }
                reader.endArray()
            }
            reader.endObject()
            if (!collection) {
                val value = JsonParser.parseString(text).asJsonObject
                val feature = if (value.get("type").asString == "Feature") value else JsonObject().apply {
                    addProperty("type", "Feature"); add("geometry", value); add("properties", JsonObject())
                }
                val key = id(feature)
                if (key !in removed) append(pending.remove(key) ?: feature)
            }
            pending.values.forEach(::append)
            return output.append("]}").toString()
        }
    }
}
