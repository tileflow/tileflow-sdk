package dev.tileflow.sdk.engine

import android.graphics.PointF
import android.graphics.RectF
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.sources.VectorSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.Point
import org.maplibre.android.location.LocationComponentConstants
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.layers.FillExtrusionLayer
import org.maplibre.android.style.layers.FillLayer
import org.maplibre.android.style.layers.HeatmapLayer
import org.maplibre.android.style.layers.LineLayer
import org.maplibre.android.style.layers.SymbolLayer

internal object NativeFeatureQueries {
    /** The public point query covers basemap, overlays and runtime layers in paint order. */
    fun atPoint(
        map: MapLibreMap,
        point: PointF,
        basemap: Map<String, String>,
        result: JSONArray,
    ): JSONArray {
        val style = map.style ?: return result
        for (layer in style.layers.asReversed()) {
            if (layer.visibility.value == "none") continue
            val source = basemap[layer.id] ?: (
                when (layer) {
                    is CircleLayer -> layer.sourceId
                    is SymbolLayer -> layer.sourceId
                    is FillLayer -> layer.sourceId
                    is LineLayer -> layer.sourceId
                    is FillExtrusionLayer -> layer.sourceId
                    is HeatmapLayer -> layer.sourceId
                    else -> null
                }
            ) ?: continue
            // The location component exposes public layer names through the map's location owner.
            if (source == LocationComponentConstants.LOCATION_SOURCE) continue
            for (feature in map.queryRenderedFeatures(point, layer.id)) {
                result.put(
                    JSONObject()
                        .put("id", feature.id()?.takeIf(String::isNotEmpty) ?: JSONObject.NULL)
                        .put("source", source)
                        .put("layer", layer.id)
                )
                if (result.length() == 50) return result
            }
        }
        return result
    }

    fun rendered(
        map: MapLibreMap, view: MapView, density: Float, request: JSONObject,
        layers: List<NativeStyleLayer>, sources: Map<String, NativeStyleSource>,
    ): JSONArray {
        val wanted = request.optJSONArray("layers")?.items()?.map(Any::toString)?.toSet()
        if (wanted != null && wanted.any { id -> layers.none { it.name == id } }) styleInvalid("Unknown layer")
        val style = map.style ?: return JSONArray()
        val limit = request.getInt("limit")
        val geometry = request.optJSONObject("geometry")
        fun pixel(value: JSONObject) = PointF(value.getDouble("x").toFloat() * density, value.getDouble("y").toFloat() * density)
        val point = geometry?.optJSONObject("point")?.let(::pixel)
        val ring = geometry?.optJSONArray("polygon")?.objects()?.map(::pixel)
        val corners = ring ?: geometry?.optJSONArray("box")?.objects()?.map(::pixel)
        val bounds = if (corners.isNullOrEmpty()) RectF(0f, 0f, view.width.toFloat(), view.height.toFloat())
            else RectF(corners.minOf { it.x }, corners.minOf { it.y }, corners.maxOf { it.x }, corners.maxOf { it.y })
        val filter = request.optJSONArray("filter")?.let { Expression.raw(it.toString()) }
        val result = JSONArray()
        val app = layers.associateBy { it.id }
        // MapLibre returns features without layer metadata. Walk the native draw order for z-order
        // and query each application layer to retain its name, source layer and feature state.
        for (native in style.layers.asReversed()) {
            val layer = app[native.id] ?: continue
            if (wanted != null && layer.name !in wanted) continue
            val source = sources[layer.source] ?: continue
            val matches = if (point != null) map.queryRenderedFeatures(point, filter, layer.id)
                else map.queryRenderedFeatures(bounds, filter, layer.id)
            for (match in matches) {
                if (ring != null && !intersects(map, match, ring)) continue
                result.put(wire(match, source, style, layer.name, layer.sourceLayer))
                if (result.length() >= limit) return result
            }
        }
        return result
    }

    fun source(map: MapLibreMap, request: JSONObject, sources: Map<String, NativeStyleSource>): JSONArray {
        val source = sources[request.getString("source")] ?: styleInvalid("Unknown source")
        val style = map.style ?: return JSONArray()
        val native = style.getSource(source.id)
        val limit = request.getInt("limit")
        val filter = request.optJSONArray("filter")?.let { Expression.raw(it.toString()) }
        val groups = request.optJSONArray("sourceLayers")?.items()?.map { it as? String ?: styleInvalid("sourceLayers") }
            ?: listOf(null)
        val result = JSONArray()
        val seen = mutableSetOf<Pair<String?, String>>()
        for (group in groups) {
            val matches = when (native) {
                is GeoJsonSource -> native.querySourceFeatures(filter)
                is VectorSource -> group?.let { native.querySourceFeatures(arrayOf(it), filter) }.orEmpty()
                else -> styleInvalid("This source has no features")
            }
            for (item in matches) {
                val id = item.id()
                if (id != null && !seen.add(group to id)) continue
                result.put(wire(item, source, style, null, group))
                if (result.length() >= limit) return result
            }
        }
        return result
    }

    fun cluster(map: MapLibreMap, request: JSONObject, sources: Map<String, NativeStyleSource>): Any {
        val source = sources[request.getString("source")]?.takeIf { it.spec.optBoolean("cluster") }
            ?: styleInvalid("Unknown cluster source")
        val style = map.style ?: styleInvalid("Style not ready")
        val native = style.getSourceAs<GeoJsonSource>(source.id) ?: styleInvalid("Source not ready")
        val id = request.getInt("cluster")
        val cluster = Feature.fromGeometry(Point.fromLngLat(0.0, 0.0)).apply {
            addBooleanProperty("cluster", true)
            addNumberProperty("cluster_id", id)
        }
        val items = when (request.getString("query")) {
            "expansionZoom" -> return native.getClusterExpansionZoom(cluster)
            "children" -> native.getClusterChildren(cluster)
            "leaves" -> native.getClusterLeaves(cluster, request.getLong("limit"), request.getLong("offset"))
            else -> styleInvalid("Invalid cluster query")
        }
        return JSONArray(items.features().orEmpty().map { wire(it, source, style, null, null) })
    }

    private fun wire(feature: Feature, source: NativeStyleSource, style: Style, layer: String?, sourceLayer: String?): JSONObject {
        val value = JSONObject(feature.toJson())
        value.put("source", source.name)
        if (layer != null) value.put("layer", layer)
        if (sourceLayer != null) value.put("sourceLayer", sourceLayer)
        feature.id()?.let { id ->
            val state = when (val native = style.getSource(source.id)) {
                is GeoJsonSource -> native.getFeatureState(id)
                is VectorSource -> sourceLayer?.let { native.getFeatureState(it, id) }
                else -> null
            }
            if (state != null && state.size() != 0) value.put("state", JSONObject(state.toString()))
        }
        return value
    }

    /** Android exposes point and rectangle hit tests. Clip hits from the bounding rectangle
     * against the requested screen polygon, including crossing lines, holes and enclosing areas. */
    private fun intersects(map: MapLibreMap, feature: Feature, selection: List<PointF>): Boolean {
        val geometry = feature.geometry() ?: return false
        fun project(pair: JSONArray): PointF = map.projection.toScreenLocation(LatLng(pair.getDouble(1), pair.getDouble(0)))
        fun points(coordinates: JSONArray): List<PointF> = coordinates.items().map { project(it as JSONArray) }
        fun line(path: List<PointF>): Boolean = path.any { inside(it, selection) } ||
            path.zipWithNext().any { (a, b) -> selection.indices.any { k -> cross(a, b, selection[k], selection[(k + 1) % selection.size]) } }
        fun polygon(coordinates: JSONArray): Boolean {
            val rings = coordinates.items().map { points(it as JSONArray) }
            return rings.any(::line) || selection.any { point -> rings.count { inside(point, it) } % 2 == 1 }
        }
        fun hit(value: JSONObject): Boolean {
            val coords = value.optJSONArray("coordinates")
            return when (value.optString("type")) {
                "Point" -> inside(project(coords!!), selection)
                "MultiPoint" -> points(coords!!).any { inside(it, selection) }
                "LineString" -> line(points(coords!!))
                "MultiLineString" -> coords!!.items().any { line(points(it as JSONArray)) }
                "Polygon" -> polygon(coords!!)
                "MultiPolygon" -> coords!!.items().any { polygon(it as JSONArray) }
                "GeometryCollection" -> value.getJSONArray("geometries").objects().any(::hit)
                else -> false
            }
        }
        return hit(JSONObject(geometry.toJson()))
    }

    private fun orientation(a: PointF, b: PointF, c: PointF): Double =
        (b.x - a.x).toDouble() * (c.y - a.y) - (b.y - a.y).toDouble() * (c.x - a.x)

    private fun onSegment(p: PointF, a: PointF, b: PointF): Boolean =
        abs(orientation(a, b, p)) < 1e-5 && p.x in minOf(a.x,b.x)..maxOf(a.x,b.x) && p.y in minOf(a.y,b.y)..maxOf(a.y,b.y)

    private fun cross(a: PointF, b: PointF, c: PointF, d: PointF): Boolean =
        (orientation(a,b,c) * orientation(a,b,d) < 0 && orientation(c,d,a) * orientation(c,d,b) < 0) ||
            onSegment(a,c,d) || onSegment(b,c,d) || onSegment(c,a,b) || onSegment(d,a,b)

    private fun inside(p: PointF, ring: List<PointF>): Boolean {
        var odd = false
        for (i in ring.indices) {
            val a = ring[i]
            val b = ring[(i+1)%ring.size]
            if (onSegment(p, a, b)) return true
            if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) odd = !odd
        }
        return odd
    }
}
