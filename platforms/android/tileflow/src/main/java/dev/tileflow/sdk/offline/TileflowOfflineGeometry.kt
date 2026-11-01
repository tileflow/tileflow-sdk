package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.sdk.TileflowGeometry
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

/**
 * The area of an offline region, in WGS84 positions.
 *
 * Like the geometry of Mapbox's tile region load options, it describes the area only, and zooms and
 * content are chosen separately; it takes any GeoJSON geometry, a box or a corridor, with no limit
 * on its positions. As Mapbox computes tile regions, the SDK turns a Hosted region into the list of
 * tile packs it needs, which is what it sends: one download whose tiles at every zoom are the union
 * of the tiles each of its parts touches, counted once. A point covers the tile it lies in, a line every tile it passes
 * through, and a polygon every tile one of its rings passes through or whose row's middle lies
 * inside it, holes excluded. Lines and rings are straight on the Web Mercator map, and tile bounds
 * are closed: a position on a tile's top or bottom edge touches the tiles on both sides of it.
 * Latitudes beyond ±85.051129°, which the map cannot show, are clamped.
 */
public sealed class TileflowOfflineGeometry {
    /**
     * A box between two meridians and two parallels. A box whose west edge is greater than its east
     * edge crosses the antimeridian, as in GeoJSON, and covers both sides.
     */
    public data class BoundingBox(public val box: TileflowBoundingBox) : TileflowOfflineGeometry()

    /**
     * A GeoJSON geometry, as Mapbox's tile region load options take: a point, a line or a polygon,
     * or their multi-part forms. A polygon's first ring is its outline and the others are holes;
     * rings may be open or closed. A ring that crosses itself covers the areas an even number of its
     * edges enclose, as GeoJSON renderers draw it. Parts may overlap.
     *
     * No line or ring may cross the antimeridian: give each side as its own part.
     */
    public data class Geometry(public val geometry: TileflowGeometry) : TileflowOfflineGeometry()

    /** A GeoJSON geometry collection. */
    public data class GeometryCollection(public val geometries: List<TileflowGeometry>) :
        TileflowOfflineGeometry()

    /**
     * The area within half of [width] metres of a line, such as a route. The line has 2 to 10,000
     * positions and [width] is 1 to 100,000 metres. It covers the convex outlines of consecutive
     * stretches that stay close to the corridor, so a winding line covers somewhat more than the
     * corridor itself.
     */
    public data class Corridor(public val line: List<TileflowPosition>, public val width: Double) :
        TileflowOfflineGeometry()

    /**
     * Checks the geometry without planning it.
     *
     * @throws TileflowOfflineException with [TileflowOfflineErrorCode.INVALID_REGION] and one of
     *   these reasons: `invalidPosition` (not finite, or beyond ±180° or ±90°),
     *   `tooFewPositions`, `tooManyPositions` (a corridor's line), `emptyArea` (a ring whose
     *   positions all lie on one line), `crossesAntimeridian` (consecutive positions more than 180°
     *   of longitude apart; split the region) or `invalidWidth`. A Hosted region too large to list
     *   as packs is `REGION_TOO_COMPLEX` when it is loaded or estimated.
     */
    public fun validate() {
        packRegions()
    }

    /**
     * The number of tiles the region covers at [zoom], 0 to 22: the tiles a pack of every source at
     * that zoom would list if each source stored all of them.
     */
    public fun tileCount(zoom: Int): Long {
        if (zoom !in 0..OfflineZooms.MAXIMUM) throw TileflowOfflineException.options("invalidZoom")
        return OfflineTileCover.count(packRegions(), zoom)
    }

    /** The number of tiles the region covers over a range of zooms. */
    public fun tileCount(zoomRange: IntRange): Long = zoomRange.sumOf { tileCount(it) }

    /** The canonical parts whose tiles together form the region's cover. */
    internal fun packRegions(): List<OfflinePackRegion> =
        when (this) {
            is BoundingBox -> {
                if (!isLongitude(box.west) || !isLongitude(box.east))
                    throw TileflowOfflineException.region("invalidPosition")
                if (!isLatitude(box.south) || !isLatitude(box.north))
                    throw TileflowOfflineException.region("invalidPosition")
                val south = clamped(box.south)
                val north = clamped(box.north)
                val spans =
                    if (box.west <= box.east) listOf(box.west to box.east)
                    else listOf(box.west to 180.0, -180.0 to box.east)
                spans
                    .mapNotNull { OfflinePackRegion.canonical(it.first, south, it.second, north) }
                    .ifEmpty { throw TileflowOfflineException.region("emptyArea") }
            }
            is Geometry ->
                listOf(
                    OfflinePackRegion.Geometry(
                        OfflineRegionShape.canonical(OfflineRegionShape.of(geometry))
                    )
                )
            is GeometryCollection ->
                listOf(
                    OfflinePackRegion.Geometry(
                        OfflineRegionShape.canonical(
                            OfflineRegionShape.GeometryCollection(
                                geometries.map(OfflineRegionShape::of)
                            )
                        )
                    )
                )
            is Corridor -> {
                if (!width.isFinite() || width !in OfflineCorridor.WIDTHS)
                    throw TileflowOfflineException.region("invalidWidth")
                if (line.size > OfflineCorridor.MAXIMUM_POSITIONS)
                    throw TileflowOfflineException.region("tooManyPositions")
                val valid = validated(line)
                val distinct =
                    valid.filterIndexed { index, it -> index == 0 || valid[index - 1] != it }
                if (distinct.size < 2) throw TileflowOfflineException.region("tooFewPositions")
                OfflineCorridor.regions(distinct, width).ifEmpty {
                    throw TileflowOfflineException.region("emptyArea")
                }
            }
        }

    public companion object {
        /**
         * A GeoJSON geometry object, such as `{"type": "Polygon", "coordinates": […]}`, or a
         * geometry collection. Altitudes are not kept.
         *
         * @throws TileflowOfflineException with [TileflowOfflineErrorCode.INVALID_REGION] and
         *   reason `invalidGeoJSON` when the text is not a GeoJSON geometry, or is a collection
         *   inside another.
         */
        @JvmStatic
        public fun fromGeoJson(json: String): TileflowOfflineGeometry =
            runCatching { JSONObject(json) }.getOrNull()?.let(::of)
                ?: throw TileflowOfflineException.region("invalidGeoJSON")

        internal fun of(value: JSONObject): TileflowOfflineGeometry? {
            if (value.opt("type") != "GeometryCollection")
                return TileflowGeometry.of(value)?.let(::Geometry)
            val items = value.opt("geometries") as? JSONArray ?: return null
            return GeometryCollection(
                (0 until items.length()).map {
                    TileflowGeometry.of(items.opt(it) as? JSONObject) ?: return null
                }
            )
        }

        /** The GeoJSON object of a geometry or a collection; null for a box or a corridor. */
        internal fun geoJson(geometry: TileflowOfflineGeometry): JSONObject? =
            when (geometry) {
                is Geometry -> TileflowGeometry.json(geometry.geometry)
                is GeometryCollection ->
                    JSONObject()
                        .put("type", "GeometryCollection")
                        .put("geometries", JSONArray(geometry.geometries.map(TileflowGeometry::json)))
                is BoundingBox,
                is Corridor -> null
            }

        private fun validated(positions: List<TileflowPosition>): List<TileflowPosition> {
            if (positions.any { !isLongitude(it.longitude) || !isLatitude(it.latitude) })
                throw TileflowOfflineException.region("invalidPosition")
            for (index in 1 until positions.size) {
                if (abs(positions[index].longitude - positions[index - 1].longitude) > 180)
                    throw TileflowOfflineException.region("crossesAntimeridian")
            }
            return positions.map { TileflowPosition(it.longitude, clamped(it.latitude)) }
        }

        internal fun isLongitude(value: Double) = value.isFinite() && abs(value) <= 180

        internal fun isLatitude(value: Double) = value.isFinite() && abs(value) <= 90

        internal fun clamped(latitude: Double) =
            latitude.coerceIn(
                -OfflinePackRegion.MAXIMUM_LATITUDE,
                OfflinePackRegion.MAXIMUM_LATITUDE,
            )
    }
}
