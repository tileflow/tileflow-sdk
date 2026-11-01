package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowGeometry
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

/**
 * A GeoJSON region of a download. [canonical] gives the form whose cover the service plans:
 * latitudes clamped to the map's, positions rounded to six decimals and rings closed.
 */
internal sealed class OfflineRegionShape {
    data class Point(val position: TileflowPosition) : OfflineRegionShape()

    data class MultiPoint(val positions: List<TileflowPosition>) : OfflineRegionShape()

    data class LineString(val positions: List<TileflowPosition>) : OfflineRegionShape()

    data class MultiLineString(val lines: List<List<TileflowPosition>>) : OfflineRegionShape()

    /** Rings, the first the outline and the rest holes. */
    data class Polygon(val rings: List<List<TileflowPosition>>) : OfflineRegionShape()

    data class MultiPolygon(val polygons: List<List<List<TileflowPosition>>>) :
        OfflineRegionShape()

    /** Geometries of any type but another collection. */
    data class GeometryCollection(val geometries: List<OfflineRegionShape>) : OfflineRegionShape()

    /** The parts the cover follows: each polygon on its own, so overlapping polygons form a union. */
    val parts: List<OfflineCoverPart>
        get() =
            when (this) {
                is Point -> listOf(OfflineCoverPart(listOf(listOf(position)), false))
                is MultiPoint -> listOf(OfflineCoverPart(positions.map { listOf(it) }, false))
                is LineString -> listOf(OfflineCoverPart(listOf(positions), false))
                is MultiLineString -> listOf(OfflineCoverPart(lines, false))
                is Polygon -> listOf(OfflineCoverPart(rings, true))
                is MultiPolygon -> polygons.map { OfflineCoverPart(it, true) }
                is GeometryCollection -> geometries.flatMap { it.parts }
            }

    /** The GeoJSON object: only `type` and `coordinates`, or `geometries` for a collection. */
    fun toJson(): JSONObject {
        fun position(position: TileflowPosition) =
            JSONArray().put(position.longitude).put(position.latitude)
        fun line(positions: List<TileflowPosition>) = JSONArray(positions.map(::position))
        fun lines(lines: List<List<TileflowPosition>>) = JSONArray(lines.map(::line))
        val (type, coordinates) =
            when (this) {
                is Point -> "Point" to position(position)
                is MultiPoint -> "MultiPoint" to line(positions)
                is LineString -> "LineString" to line(positions)
                is MultiLineString -> "MultiLineString" to lines(lines)
                is Polygon -> "Polygon" to lines(rings)
                is MultiPolygon -> "MultiPolygon" to JSONArray(polygons.map(::lines))
                is GeometryCollection ->
                    return JSONObject()
                        .put("type", "GeometryCollection")
                        .put("geometries", JSONArray(geometries.map { it.toJson() }))
            }
        return JSONObject().put("type", type).put("coordinates", coordinates)
    }

    companion object {
        fun of(geometry: TileflowGeometry): OfflineRegionShape {
            fun position(coordinate: TileflowCoordinate) =
                TileflowPosition(coordinate.longitude, coordinate.latitude)
            return when (geometry) {
                is TileflowGeometry.Point -> Point(position(geometry.coordinate))
                is TileflowGeometry.MultiPoint -> MultiPoint(geometry.coordinates.map(::position))
                is TileflowGeometry.LineString -> LineString(geometry.coordinates.map(::position))
                is TileflowGeometry.MultiLineString ->
                    MultiLineString(geometry.lines.map { it.map(::position) })
                is TileflowGeometry.Polygon -> Polygon(geometry.rings.map { it.map(::position) })
                is TileflowGeometry.MultiPolygon ->
                    MultiPolygon(geometry.polygons.map { rings -> rings.map { it.map(::position) } })
            }
        }

        /** The canonical form of [shape], or why it has no cover. */
        fun canonical(shape: OfflineRegionShape): OfflineRegionShape {
            fun refuse(reason: String) = TileflowOfflineException.region(reason)
            fun path(positions: List<TileflowPosition>): List<TileflowPosition> {
                if (
                    positions.any {
                        !TileflowOfflineGeometry.isLongitude(it.longitude) ||
                            !TileflowOfflineGeometry.isLatitude(it.latitude)
                    }
                )
                    throw refuse("invalidPosition")
                for (index in 1 until positions.size) {
                    if (abs(positions[index].longitude - positions[index - 1].longitude) > 180)
                        throw refuse("crossesAntimeridian")
                }
                return positions.map {
                    TileflowPosition(
                        OfflinePackRegion.round(it.longitude),
                        OfflinePackRegion.round(TileflowOfflineGeometry.clamped(it.latitude)),
                    )
                }
            }
            fun line(positions: List<TileflowPosition>): List<TileflowPosition> {
                if (positions.size < 2) throw refuse("tooFewPositions")
                return path(positions)
            }
            fun ring(positions: List<TileflowPosition>): List<TileflowPosition> {
                if (positions.isEmpty()) throw refuse("tooFewPositions")
                val ring = path(positions).toMutableList()
                // An open ring is closed, as GeoJSON requires.
                if (ring.first() != ring.last()) {
                    if (abs(positions.last().longitude - positions.first().longitude) > 180)
                        throw refuse("crossesAntimeridian")
                    ring.add(ring.first())
                }
                if (ring.size < 4) throw refuse("tooFewPositions")
                if (OfflinePackRegion.isCollinear(ring)) throw refuse("emptyArea")
                return ring
            }
            fun polygon(rings: List<List<TileflowPosition>>): List<List<TileflowPosition>> {
                if (rings.isEmpty()) throw refuse("tooFewPositions")
                return rings.map(::ring)
            }
            fun <T> parts(parts: List<T>, part: (T) -> T): List<T> {
                if (parts.isEmpty()) throw refuse("tooFewPositions")
                return parts.map(part)
            }
            fun single(shape: OfflineRegionShape): OfflineRegionShape =
                when (shape) {
                    is Point -> Point(path(listOf(shape.position))[0])
                    is MultiPoint -> MultiPoint(parts(shape.positions) { path(listOf(it))[0] })
                    is LineString -> LineString(line(shape.positions))
                    is MultiLineString -> MultiLineString(parts(shape.lines, ::line))
                    is Polygon -> Polygon(polygon(shape.rings))
                    is MultiPolygon -> MultiPolygon(parts(shape.polygons, ::polygon))
                    is GeometryCollection -> throw refuse("nestedCollection")
                }
            return if (shape is GeometryCollection)
                GeometryCollection(parts(shape.geometries, ::single))
            else single(shape)
        }

        /**
         * The region the service returns, read strictly: no members beyond the geometry's own, and
         * two numbers per position.
         */
        fun fromJson(value: Any?): OfflineRegionShape? {
            if (value !is JSONObject || value.length() != 2) return null
            fun position(item: Any?): TileflowPosition? {
                val array = item as? JSONArray ?: return null
                if (array.length() != 2) return null
                val longitude = (array.opt(0) as? Number)?.toDouble() ?: return null
                val latitude = (array.opt(1) as? Number)?.toDouble() ?: return null
                return TileflowPosition(longitude, latitude)
            }
            fun <T> list(item: Any?, map: (Any?) -> T?): List<T>? {
                val array = item as? JSONArray ?: return null
                return (0 until array.length()).map { map(array.opt(it)) ?: return null }
            }
            val coordinates = value.opt("coordinates")
            return when (value.opt("type")) {
                "Point" -> position(coordinates)?.let(::Point)
                "MultiPoint" -> list(coordinates, ::position)?.let(::MultiPoint)
                "LineString" -> list(coordinates, ::position)?.let(::LineString)
                "MultiLineString" ->
                    list(coordinates) { list(it, ::position) }?.let(::MultiLineString)
                "Polygon" -> list(coordinates) { list(it, ::position) }?.let(::Polygon)
                "MultiPolygon" ->
                    list(coordinates) { polygon -> list(polygon) { list(it, ::position) } }
                        ?.let(::MultiPolygon)
                "GeometryCollection" ->
                    list(value.opt("geometries"), ::fromJson)?.let(::GeometryCollection)
                else -> null
            }
        }
    }
}
