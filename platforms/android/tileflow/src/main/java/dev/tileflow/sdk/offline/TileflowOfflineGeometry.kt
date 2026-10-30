package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import kotlin.math.abs

/**
 * The area of an offline region, in WGS84 positions.
 *
 * Like the geometry of Mapbox's tile region load options, it describes the area only; zooms and
 * content are chosen separately. A region covers the same tiles at every zoom as the Hosted pack
 * that downloads it: a tile belongs to the region when the region's outline passes through it or
 * the middle of its row lies inside the region, with outlines drawn as straight lines on the Web
 * Mercator map. Latitudes beyond ±85.051129°, which the map cannot show, are clamped.
 */
public sealed class TileflowOfflineGeometry {
    /**
     * A box between two meridians and two parallels. A box whose west edge is greater than its east
     * edge crosses the antimeridian, as in GeoJSON, and downloads as two packs.
     */
    public data class BoundingBox(public val box: TileflowBoundingBox) : TileflowOfflineGeometry()

    /**
     * One ring of 3 to 255 distinct positions, open or closed, without holes. A ring that crosses
     * itself covers the areas an even number of its edges enclose, as GeoJSON renderers draw it.
     */
    public data class Polygon(public val ring: List<TileflowPosition>) : TileflowOfflineGeometry()

    /**
     * The area within half of [width] metres of a line, such as a route. The line has 2 to 10,000
     * positions and [width] is 1 to 100,000 metres. A Hosted corridor downloads as one pack for
     * each stretch whose convex outline stays close to the corridor, so a winding line covers
     * somewhat more than the corridor itself.
     */
    public data class Corridor(public val line: List<TileflowPosition>, public val width: Double) :
        TileflowOfflineGeometry()

    /**
     * Checks the geometry without planning it.
     *
     * @throws TileflowOfflineException with [TileflowOfflineErrorCode.INVALID_REGION] and one of
     *   these reasons: `invalidPosition` (not finite, or beyond ±180° or ±90°),
     *   `tooFewPositions`, `tooManyPositions`, `emptyArea`, `crossesAntimeridian` (consecutive
     *   positions more than 180° of longitude apart; split the region) or `invalidWidth`.
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

    /** The canonical regions of the packs that download this geometry. */
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
            is Polygon -> {
                val ring = validated(ring).toMutableList()
                if (ring.size > 1 && ring.first() == ring.last()) ring.removeAt(ring.size - 1)
                if (ring.size < 3) throw TileflowOfflineException.region("tooFewPositions")
                if (ring.size >= OfflinePackRegion.POSITIONS.last)
                    throw TileflowOfflineException.region("tooManyPositions")
                listOf(
                    OfflinePackRegion.canonical(ring + ring[0])
                        ?: throw TileflowOfflineException.region("emptyArea")
                )
            }
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

    private companion object {
        fun validated(positions: List<TileflowPosition>): List<TileflowPosition> {
            if (positions.any { !isLongitude(it.longitude) || !isLatitude(it.latitude) })
                throw TileflowOfflineException.region("invalidPosition")
            for (index in 1 until positions.size) {
                if (abs(positions[index].longitude - positions[index - 1].longitude) > 180)
                    throw TileflowOfflineException.region("crossesAntimeridian")
            }
            return positions.map { TileflowPosition(it.longitude, clamped(it.latitude)) }
        }

        fun isLongitude(value: Double) = value.isFinite() && abs(value) <= 180

        fun isLatitude(value: Double) = value.isFinite() && abs(value) <= 90

        fun clamped(latitude: Double) =
            latitude.coerceIn(
                -OfflinePackRegion.MAXIMUM_LATITUDE,
                OfflinePackRegion.MAXIMUM_LATITUDE,
            )
    }
}
