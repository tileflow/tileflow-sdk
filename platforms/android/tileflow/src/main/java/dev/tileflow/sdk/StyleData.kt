package dev.tileflow.sdk

import org.json.JSONArray
import org.json.JSONObject

/** A JSON value, such as a feature property. */
public sealed interface TileflowJSON {
    public data object Null : TileflowJSON

    public data class Bool(val value: Boolean) : TileflowJSON

    public data class Number(val value: Double) : TileflowJSON

    public data class Text(val value: String) : TileflowJSON

    public data class Array(val values: List<TileflowJSON>) : TileflowJSON

    public data class Object(val values: Map<String, TileflowJSON>) : TileflowJSON

    public companion object {
        internal fun of(value: Any?): TileflowJSON =
            when (value) {
                null,
                JSONObject.NULL -> Null
                is Boolean -> Bool(value)
                is kotlin.Number -> Number(value.toDouble())
                is String -> Text(value)
                is JSONArray -> Array((0 until value.length()).map { of(value.opt(it)) })
                is JSONObject -> Object(value.keys().asSequence().associateWith { of(value.opt(it)) })
                else -> Text(value.toString())
            }

        internal fun json(value: TileflowJSON): Any =
            when (value) {
                Null -> JSONObject.NULL
                is Bool -> value.value
                is Number -> value.value
                is Text -> value.value
                is Array -> JSONArray().apply { value.values.forEach { put(json(it)) } }
                is Object ->
                    JSONObject().apply { value.values.forEach { (key, item) -> put(key, json(item)) } }
            }
    }
}

/** A GeoJSON geometry, with positions as coordinates; altitudes are not kept. */
public sealed interface TileflowGeometry {
    public data class Point(val coordinate: TileflowCoordinate) : TileflowGeometry

    public data class MultiPoint(val coordinates: List<TileflowCoordinate>) : TileflowGeometry

    public data class LineString(val coordinates: List<TileflowCoordinate>) : TileflowGeometry

    public data class MultiLineString(val lines: List<List<TileflowCoordinate>>) : TileflowGeometry

    /** Rings, the first outer and the rest holes, each closed. */
    public data class Polygon(val rings: List<List<TileflowCoordinate>>) : TileflowGeometry

    public data class MultiPolygon(val polygons: List<List<List<TileflowCoordinate>>>) :
        TileflowGeometry

    public companion object {
        internal fun of(value: JSONObject?): TileflowGeometry? {
            value ?: return null
            fun position(item: Any?): TileflowCoordinate? {
                val array = item as? JSONArray ?: return null
                if (array.length() < 2) return null
                val longitude = (array.opt(0) as? kotlin.Number)?.toDouble() ?: return null
                val latitude = (array.opt(1) as? kotlin.Number)?.toDouble() ?: return null
                return TileflowCoordinate(longitude, latitude)
            }
            fun <T> list(item: Any?, map: (Any?) -> T?): List<T>? {
                val array = item as? JSONArray ?: return null
                val mapped = (0 until array.length()).mapNotNull { map(array.opt(it)) }
                return mapped.takeIf { it.size == array.length() }
            }
            val coordinates = value.opt("coordinates")
            return when (value.optString("type")) {
                "Point" -> position(coordinates)?.let(::Point)
                "MultiPoint" -> list(coordinates, ::position)?.let(::MultiPoint)
                "LineString" -> list(coordinates, ::position)?.let(::LineString)
                "MultiLineString" ->
                    list(coordinates) { list(it, ::position) }?.let(::MultiLineString)
                "Polygon" -> list(coordinates) { list(it, ::position) }?.let(::Polygon)
                "MultiPolygon" ->
                    list(coordinates) { polygon -> list(polygon) { list(it, ::position) } }
                        ?.let(::MultiPolygon)
                else -> null
            }
        }

        internal fun json(geometry: TileflowGeometry): JSONObject {
            fun position(coordinate: TileflowCoordinate) =
                JSONArray().put(coordinate.longitude).put(coordinate.latitude)
            fun line(points: List<TileflowCoordinate>) = JSONArray(points.map(::position))
            fun rings(lines: List<List<TileflowCoordinate>>) = JSONArray(lines.map(::line))
            val (type, coordinates) =
                when (geometry) {
                    is Point -> "Point" to position(geometry.coordinate)
                    is MultiPoint -> "MultiPoint" to line(geometry.coordinates)
                    is LineString -> "LineString" to line(geometry.coordinates)
                    is MultiLineString -> "MultiLineString" to rings(geometry.lines)
                    is Polygon -> "Polygon" to rings(geometry.rings)
                    is MultiPolygon -> "MultiPolygon" to JSONArray(geometry.polygons.map(::rings))
                }
            return JSONObject().put("type", type).put("coordinates", coordinates)
        }
    }
}

/**
 * A GeoJSON feature. An identifier that is a whole number, such as `"42"`, travels as a number,
 * which the map needs to keep feature state for it; other identifiers need the source's
 * `promoteId`.
 */
public data class TileflowFeature(
    val id: String? = null,
    val geometry: TileflowGeometry?,
    val properties: Map<String, TileflowJSON> = emptyMap(),
) {
    /** For a cluster of a clustering source: the identifier its cluster queries take. */
    val clusterId: Int?
        get() = (properties["cluster_id"] as? TileflowJSON.Number)?.value?.toInt()

    internal fun json(): JSONObject =
        JSONObject()
            .put("type", "Feature")
            .put("geometry", geometry?.let(TileflowGeometry::json) ?: JSONObject.NULL)
            .put(
                "properties",
                JSONObject().apply {
                    properties.forEach { (key, value) -> put(key, TileflowJSON.json(value)) }
                },
            )
            .apply { id?.let { put("id", wireId(it)) } }

    internal companion object {
        private val WHOLE = Regex("^(0|[1-9][0-9]{0,14})$")

        /** A whole number travels as a number. */
        fun wireId(id: String): Any = if (WHOLE.matches(id)) id.toLong() else id

        fun text(value: Any?): String? =
            when (value) {
                is Int,
                is Long -> value.toString()
                is kotlin.Number -> {
                    val number = value.toDouble()
                    if (number == Math.rint(number) && Math.abs(number) < 1e15)
                        number.toLong().toString()
                    else number.toString()
                }
                is String -> value
                else -> null
            }

        fun of(value: JSONObject): TileflowFeature =
            TileflowFeature(
                text(value.opt("id")),
                TileflowGeometry.of(value.optJSONObject("geometry")),
                (TileflowJSON.of(value.optJSONObject("properties") ?: JSONObject())
                        as TileflowJSON.Object)
                    .values,
            )
    }
}

/**
 * A feature a query found, with where it came from and its state.
 *
 * @property source The application source; null for a feature of the map's own style.
 * @property layer The application layer that drew it, for rendered features.
 */
public data class TileflowQueriedFeature(
    val feature: TileflowFeature,
    val source: String?,
    val sourceLayer: String?,
    val layer: String?,
    val state: Map<String, TileflowStyleValue>,
) {
    internal companion object {
        fun of(value: JSONObject): TileflowQueriedFeature =
            TileflowQueriedFeature(
                TileflowFeature.of(value),
                value.optString("source").takeIf { it.isNotEmpty() },
                value.optString("sourceLayer").takeIf { it.isNotEmpty() },
                value.optString("layer").takeIf { it.isNotEmpty() },
                (value.optJSONObject("state") ?: JSONObject()).let { state ->
                    state.keys().asSequence().mapNotNull { key -> styleValue(state.opt(key))?.let { key to it } }.toMap()
                },
            )
    }
}

internal fun styleValue(value: Any?): TileflowStyleValue? =
    when (value) {
        JSONObject.NULL,
        null -> TileflowStyleValue.Null
        is Boolean -> TileflowStyleValue.Bool(value)
        is Number -> TileflowStyleValue.Number(value.toDouble())
        is String -> TileflowStyleValue.Text(value)
        else -> null
    }

/**
 * The part of the view a rendered query reads: in pixels on [TileflowMapView], in dp on
 * [TileflowMapController].
 */
public sealed interface TileflowQueryGeometry {
    public data class Point(val point: TileflowPoint) : TileflowQueryGeometry

    /** The box between two corners. */
    public data class Box(val first: TileflowPoint, val second: TileflowPoint) :
        TileflowQueryGeometry

    /** At least three points; the polygon closes itself. */
    public data class Polygon(val points: List<TileflowPoint>) : TileflowQueryGeometry

    /** The whole view. */
    public data object View : TileflowQueryGeometry
}

/**
 * Which rendered features a query returns.
 *
 * @property layerIds Application layers to read; null reads every application layer.
 * @property limit At most this many features, up to 100 000.
 */
public data class TileflowRenderedQueryOptions(
    val layerIds: List<String>? = null,
    val filter: TileflowExpression? = null,
    val limit: Int = 1000,
)

/**
 * Which features of a source a query returns, whether or not they are drawn.
 *
 * @property sourceLayerIds For a vector source, the layers to read.
 * @property limit At most this many features, up to 100 000.
 */
public data class TileflowSourceQueryOptions(
    val sourceLayerIds: List<String>? = null,
    val filter: TileflowExpression? = null,
    val limit: Int = 1000,
)

/**
 * A source of the application's runtime style: [TileflowGeoJSONSource], [TileflowVectorSource],
 * [TileflowRasterSource], [TileflowRasterDEMSource] or [TileflowImageSource]. Addresses go through
 * the SDK's transport, so their origins must be among the map source's `resourceOrigins`.
 */
public sealed interface TileflowSource {
    public val id: String
}

/** The data of a GeoJSON source. */
public sealed interface TileflowGeoJSONData {
    /** A GeoJSON FeatureCollection, sent over the SDK's data channel (up to 32 MiB). */
    public class GeoJSON(geoJSON: String) : TileflowGeoJSONData {
        internal val bytes: ByteArray = geoJSON.toByteArray(Charsets.UTF_8)
    }

    public data class Features(val features: List<TileflowFeature>) : TileflowGeoJSONData

    /** GeoJSON the map loads itself. */
    public data class Url(val url: String) : TileflowGeoJSONData

    /** No features yet. */
    public data object Empty : TileflowGeoJSONData
}

/**
 * GeoJSON, inline or by address, optionally clustered. MapLibre source type `geojson`.
 *
 * @property cluster Groups nearby points into clusters, which carry `point_count` and `cluster_id`.
 * @property clusterProperties Aggregates of clustered points, as MapLibre's `clusterProperties`:
 *   for example `mapOf("total" to TileflowExpression.sum(TileflowExpression.get("count")))` adds
 *   each point's `count` into a cluster's `total`.
 * @property promoteId A property whose value identifies each feature, for feature state and
 *   updates.
 */
public data class TileflowGeoJSONSource(
    override val id: String,
    val data: TileflowGeoJSONData,
    val cluster: Boolean = false,
    val clusterRadius: Double? = null,
    val clusterMaxZoom: Double? = null,
    val clusterMinPoints: Int? = null,
    val clusterProperties: Map<String, TileflowExpression> = emptyMap(),
    val maxZoom: Double? = null,
    val attribution: String? = null,
    val buffer: Int? = null,
    val tolerance: Double? = null,
    val filter: TileflowExpression? = null,
    val lineMetrics: Boolean = false,
    val generateId: Boolean = false,
    val promoteId: String? = null,
) : TileflowSource

/** How a tiled source names its tiles. */
public sealed interface TileflowTiles {
    /** A TileJSON document. */
    public data class TileJSON(val url: String) : TileflowTiles

    /** Tile address templates with `{z}`, `{x}` and `{y}`. */
    public data class Templates(val templates: List<String>) : TileflowTiles
}

/** Vector tiles. MapLibre source type `vector`. */
public data class TileflowVectorSource(
    override val id: String,
    val tiles: TileflowTiles,
    val minZoom: Double? = null,
    val maxZoom: Double? = null,
    val bounds: TileflowBounds? = null,
    val attribution: String? = null,
    val promoteId: String? = null,
) : TileflowSource

/** Raster tiles, such as imagery. MapLibre source type `raster`. */
public data class TileflowRasterSource(
    override val id: String,
    val tiles: TileflowTiles,
    val tileSize: Int? = null,
    val minZoom: Double? = null,
    val maxZoom: Double? = null,
    val bounds: TileflowBounds? = null,
    val attribution: String? = null,
) : TileflowSource

/** Elevation tiles for hillshade and colour relief layers. MapLibre source type `raster-dem`. */
public data class TileflowRasterDEMSource(
    override val id: String,
    val tiles: TileflowTiles,
    val encoding: Encoding? = null,
    val tileSize: Int? = null,
    val minZoom: Double? = null,
    val maxZoom: Double? = null,
    val bounds: TileflowBounds? = null,
    val attribution: String? = null,
) : TileflowSource {
    public enum class Encoding(internal val wireName: String) {
        MAPBOX("mapbox"),
        TERRARIUM("terrarium"),
        CUSTOM("custom"),
    }
}

/**
 * An image laid on the map by its corners: top left, top right, bottom right and bottom left.
 * MapLibre source type `image`.
 */
public data class TileflowImageSource(
    override val id: String,
    val url: String,
    val coordinates: List<TileflowCoordinate>,
) : TileflowSource
