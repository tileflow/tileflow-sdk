package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowPosition
import kotlin.math.floor
import org.json.JSONArray
import org.json.JSONObject

/**
 * The region of one Hosted pack in the service's canonical form: a box or one closed ring of
 * WGS84 positions rounded to six decimals, never crossing the antimeridian.
 */
internal sealed class OfflinePackRegion {
    data class Bbox(val west: Double, val south: Double, val east: Double, val north: Double) :
        OfflinePackRegion()

    /** A closed ring: its last position repeats the first. */
    data class Polygon(val ring: List<TileflowPosition>) : OfflinePackRegion()

    fun toJson(): JSONObject =
        when (this) {
            is Bbox ->
                JSONObject()
                    .put("type", "bbox")
                    .put("bbox", JSONArray().put(west).put(south).put(east).put(north))
            is Polygon ->
                JSONObject()
                    .put("type", "polygon")
                    .put(
                        "coordinates",
                        JSONArray().also { array ->
                            ring.forEach {
                                array.put(JSONArray().put(it.longitude).put(it.latitude))
                            }
                        },
                    )
        }

    /** The ring the cover follows: a box is its four corners. */
    val positions: List<TileflowPosition>
        get() =
            when (this) {
                is Bbox ->
                    listOf(
                        TileflowPosition(west, south),
                        TileflowPosition(east, south),
                        TileflowPosition(east, north),
                        TileflowPosition(west, north),
                        TileflowPosition(west, south),
                    )
                is Polygon -> ring
            }

    companion object {
        const val MAXIMUM_LATITUDE = 85.051129
        val POSITIONS = 4..256

        /** The canonical box, or null when the service would refuse it. */
        fun canonical(
            west: Double,
            south: Double,
            east: Double,
            north: Double,
        ): OfflinePackRegion? {
            if (!isLongitude(west) || !isLongitude(east)) return null
            if (!isLatitude(south) || !isLatitude(north)) return null
            val (w, s, e, n) = listOf(round(west), round(south), round(east), round(north))
            if (!(w < e) || !(s < n)) return null
            return Bbox(w, s, e, n)
        }

        /**
         * The canonical ring, or null when the service would refuse it: open, too short or long,
         * or without area.
         */
        fun canonical(ring: List<TileflowPosition>): OfflinePackRegion? {
            if (ring.size !in POSITIONS) return null
            if (ring.any { !isLongitude(it.longitude) || !isLatitude(it.latitude) }) return null
            val rounded = ring.map { TileflowPosition(round(it.longitude), round(it.latitude)) }
            if (rounded.first() != rounded.last() || area(rounded) == 0.0) return null
            return Polygon(rounded)
        }

        /** The region the service returns. It must already be canonical. */
        fun fromJson(value: Any?): OfflinePackRegion? {
            if (value !is JSONObject || value.length() != 2) return null
            fun numbers(item: Any?): List<Double>? {
                if (item !is JSONArray) return null
                return (0 until item.length()).map {
                    (item.opt(it) as? Number)?.toDouble() ?: return null
                }
            }
            return when (value.opt("type")) {
                "bbox" -> {
                    val box = numbers(value.opt("bbox"))?.takeIf { it.size == 4 } ?: return null
                    canonical(box[0], box[1], box[2], box[3])?.takeIf {
                        it == Bbox(box[0], box[1], box[2], box[3])
                    }
                }
                "polygon" -> {
                    val items = value.opt("coordinates") as? JSONArray ?: return null
                    val ring =
                        (0 until items.length()).map {
                            val pair =
                                numbers(items.opt(it))?.takeIf { it.size == 2 } ?: return null
                            TileflowPosition(pair[0], pair[1])
                        }
                    canonical(ring)?.takeIf { it == Polygon(ring) }
                }
                else -> null
            }
        }

        private fun isLongitude(value: Double) = value.isFinite() && kotlin.math.abs(value) <= 180
        private fun isLatitude(value: Double) =
            value.isFinite() && kotlin.math.abs(value) <= MAXIMUM_LATITUDE

        /** Six decimals, as the service rounds: halves toward positive infinity, and never -0. */
        fun round(value: Double): Double {
            val rounded = OfflineTileCover.roundHalfUp(value * 1e6) / 1e6
            return if (rounded == 0.0) 0.0 else rounded
        }

        fun area(ring: List<TileflowPosition>): Double {
            var area = 0.0
            for (index in 1 until ring.size) {
                area += ring[index - 1].longitude * ring[index].latitude
                area -= ring[index].longitude * ring[index - 1].latitude
            }
            return area / 2
        }
    }
}

/**
 * The tiles of one zoom that a pack region covers, exactly as the service plans and admits them.
 *
 * Edges are straight lines in Web Mercator. A tile belongs to the region when an edge passes
 * through it (closed tile bounds) or its row's center line lies inside the ring (even-odd).
 */
internal class OfflineTileCover(region: OfflinePackRegion, val zoom: Int) {
    private val limit = (1 shl zoom) - 1
    private val xs: DoubleArray
    private val ys: DoubleArray

    init {
        val scale = (1 shl zoom).toDouble()
        val ring = region.positions.map { mercator(it, scale) }
        xs = DoubleArray(ring.size) { ring[it].first }
        ys = DoubleArray(ring.size) { ring[it].second }
    }

    /** The rows the region can touch; null when it touches none. */
    val rows: IntRange?
        get() {
            val first = maxOf(0, floor(ys.min()).toInt())
            val last = minOf(limit, floor(ys.max()).toInt())
            return if (first <= last) first..last else null
        }

    /** The covered tiles of row `y` as sorted, disjoint, inclusive column ranges. */
    fun row(y: Int): List<IntRange> {
        if (y !in 0..limit) return emptyList()
        val row = y.toDouble()
        val ranges = mutableListOf<IntRange>()
        fun add(from: Double, to: Double) {
            val start = maxOf(0.0, floor(minOf(from, to)))
            val end = minOf(limit.toDouble(), floor(maxOf(from, to)))
            if (start <= end) ranges.add(start.toInt()..end.toInt())
        }
        for (index in 1 until xs.size) {
            val px = xs[index - 1]
            val py = ys[index - 1]
            val qx = xs[index]
            val qy = ys[index]
            if (maxOf(py, qy) < row || minOf(py, qy) > row + 1) continue
            if (py == qy) {
                add(px, qx)
                continue
            }
            val t0 = maxOf(0.0, minOf(1.0, (row - py) / (qy - py)))
            val t1 = maxOf(0.0, minOf(1.0, (row + 1 - py) / (qy - py)))
            add(px + minOf(t0, t1) * (qx - px), px + maxOf(t0, t1) * (qx - px))
        }
        val center = row + 0.5
        val crossings = mutableListOf<Double>()
        for (index in 1 until xs.size) {
            val px = xs[index - 1]
            val py = ys[index - 1]
            val qx = xs[index]
            val qy = ys[index]
            if ((py <= center) != (qy <= center))
                crossings.add(px + ((center - py) / (qy - py)) * (qx - px))
        }
        crossings.sort()
        var index = 0
        while (index + 1 < crossings.size) {
            add(crossings[index], crossings[index + 1])
            index += 2
        }
        return merged(ranges)
    }

    fun contains(x: Int, y: Int): Boolean = row(y).any { x in it }

    /** The number of covered tiles. */
    val count: Long
        get() = rows?.sumOf { y -> row(y).sumOf { (it.last - it.first + 1).toLong() } } ?: 0

    companion object {
        /** The distinct tiles of several regions at `zoom`. */
        fun count(regions: List<OfflinePackRegion>, zoom: Int): Long {
            val covers = regions.map { OfflineTileCover(it, zoom) }
            if (covers.size == 1) return covers[0].count
            val spans = covers.mapNotNull { it.rows }
            if (spans.isEmpty()) return 0
            return (spans.minOf { it.first }..spans.maxOf { it.last }).sumOf { y ->
                merged(covers.flatMap { it.row(y) }).sumOf { (it.last - it.first + 1).toLong() }
            }
        }

        fun merged(ranges: List<IntRange>): List<IntRange> {
            val merged = mutableListOf<IntRange>()
            for (range in ranges.sortedBy { it.first }) {
                val previous = merged.lastOrNull()
                if (previous != null && range.first <= previous.last + 1)
                    merged[merged.size - 1] = previous.first..maxOf(previous.last, range.last)
                else merged.add(range)
            }
            return merged
        }

        /**
         * Fractional Web Mercator tile coordinates at `scale` tiles per side, with the service's
         * floating-point functions.
         */
        fun mercator(position: TileflowPosition, scale: Double): Pair<Double, Double> {
            val phi = position.latitude * Math.PI / 180
            return Pair(
                (position.longitude + 180) / 360 * scale,
                (1 - StrictMath.log(StrictMath.tan(phi) + 1 / StrictMath.cos(phi)) / Math.PI) / 2 *
                    scale,
            )
        }

        /** The nearest integer, with halves toward positive infinity. */
        fun roundHalfUp(value: Double): Double {
            val floor = floor(value)
            return if (value - floor >= 0.5) floor + 1 else floor
        }
    }
}
