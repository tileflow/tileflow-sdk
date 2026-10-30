package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowPosition
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin
import kotlin.math.sinh

/**
 * Turns a corridor into the convex rings Hosted packs accept.
 *
 * A Hosted pack covers one simple ring of at most 256 positions, while a buffered route is neither
 * small nor, in general, simple. The line is simplified, then cut into consecutive pieces whose
 * convex hull stays close to the corridor's own area; each piece becomes one ring.
 *
 * Distances use the Web Mercator scale at the piece's highest latitude, so the rings always contain
 * every point within the corridor's half width of the line. They cover more where the line bends:
 * a hull may cover up to [MAXIMUM_EXCESS] times the area of the corridor it holds, or more when the
 * extra area is at most [MAXIMUM_EXTRA_TILES] tiles of World's deepest zoom. More area means more
 * tiles; more pieces mean more packs, each of which rounds its billing up to a whole map view.
 */
internal object OfflineCorridor {
    val WIDTHS = 1.0..100_000.0
    const val MAXIMUM_POSITIONS = 10_000
    const val MAXIMUM_EXCESS = 2.0
    const val MAXIMUM_EXTRA_TILES = 256.0
    /** Tiles per world unit of area at World's deepest zoom, 15. */
    val TILES_PER_AREA = (1L shl 30).toDouble()
    /**
     * Line positions per ring. With the eight sides of each position's octagon and the four sides
     * clipping can add, a ring stays well within the service's 256 positions.
     */
    const val MAXIMUM_PIECE_POSITIONS = 200
    /** Simplification moves the line by at most this share of the half width, which rings add. */
    const val SIMPLIFICATION = 0.1
    const val EARTH_RADIUS = 6_378_137.0
    private const val MERCATOR_LIMIT = 85.0511287798066

    class Point(val x: Double, val y: Double, val latitude: Double)

    /**
     * The rings that cover the corridor, in the line's order. The line has valid, distinct
     * consecutive positions without antimeridian jumps, and [width] is in metres.
     */
    fun regions(line: List<TileflowPosition>, width: Double): List<OfflinePackRegion> {
        // One metre more covers the rounding of each ring to six decimals.
        val radius = width / 2 + 1
        val points =
            line.map {
                val latitude = it.latitude.coerceIn(-MERCATOR_LIMIT, MERCATOR_LIMIT)
                val world =
                    OfflineTileCover.mercator(TileflowPosition(it.longitude, latitude), 1.0)
                Point(world.first, world.second, abs(latitude))
            }
        val lowest = points.minOfOrNull { it.latitude } ?: 0.0
        val tolerance = SIMPLIFICATION * radius * scale(lowest)
        val simplified = simplify(points, tolerance)
        val regions = mutableListOf<OfflinePackRegion>()
        var start = 0
        do {
            var end = start
            var reach = pieceRadius(simplified.subList(start, start + 1), radius, tolerance)
            var hull = octagon(simplified[start], reach)
            while (end + 1 < simplified.size && end + 1 - start < MAXIMUM_PIECE_POSITIONS) {
                val piece = simplified.subList(start, end + 2)
                val pieceReach = pieceRadius(piece, radius, tolerance)
                // The hull grows by the next octagon unless the piece's radius grew with latitude.
                val candidate =
                    if (pieceReach == reach) hull(hull + octagon(simplified[end + 1], pieceReach))
                    else hull(piece.flatMap { octagon(it, pieceReach) })
                val covered = area(candidate)
                val own = corridorArea(piece, pieceReach)
                if (
                    end > start &&
                        covered > MAXIMUM_EXCESS * own &&
                        (covered - own) * TILES_PER_AREA > MAXIMUM_EXTRA_TILES
                )
                    break
                hull = candidate
                reach = pieceReach
                end += 1
            }
            region(hull)?.let(regions::add)
            start = end
        } while (start + 1 < simplified.size)
        return regions
    }

    /** World units (the Web Mercator square as 1) per metre at [latitude] degrees. */
    fun scale(latitude: Double): Double =
        1 / (2 * PI * EARTH_RADIUS * cos(minOf(latitude, MERCATOR_LIMIT) * PI / 180))

    /**
     * The radius in world units that covers the piece: at its highest latitude, and that far again
     * toward the pole, plus the simplification tolerance.
     */
    fun pieceRadius(piece: List<Point>, radius: Double, tolerance: Double): Double {
        val highest = piece.maxOfOrNull { it.latitude } ?: 0.0
        return radius * scale(highest + radius / 111_320) + tolerance
    }

    /** Douglas–Peucker in world units, keeping the first and last positions. */
    fun simplify(points: List<Point>, tolerance: Double): List<Point> {
        if (points.size <= 2) return points
        val keep = BooleanArray(points.size)
        keep[0] = true
        keep[points.size - 1] = true
        val stack = ArrayDeque<Pair<Int, Int>>()
        stack.addLast(0 to points.size - 1)
        while (stack.isNotEmpty()) {
            val (first, last) = stack.removeLast()
            var farthest = 0.0
            var index = first
            for (candidate in first + 1 until last) {
                val distance = segmentDistance(points[candidate], points[first], points[last])
                if (distance > farthest) {
                    farthest = distance
                    index = candidate
                }
            }
            if (farthest > tolerance) {
                keep[index] = true
                if (index - first > 1) stack.addLast(first to index)
                if (last - index > 1) stack.addLast(index to last)
            }
        }
        return points.filterIndexed { index, _ -> keep[index] }
    }

    fun segmentDistance(point: Point, a: Point, b: Point): Double {
        val dx = b.x - a.x
        val dy = b.y - a.y
        val length = dx * dx + dy * dy
        val t =
            if (length == 0.0) 0.0
            else (((point.x - a.x) * dx + (point.y - a.y) * dy) / length).coerceIn(0.0, 1.0)
        return hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy))
    }

    /**
     * An octagon around the position that circumscribes a circle of radius [reach]. The hull of
     * the octagons of a piece contains every point within [reach] of its segments.
     */
    fun octagon(point: Point, reach: Double): List<Pair<Double, Double>> {
        val corner = reach / cos(PI / 8)
        return (0 until 8).map { k ->
            val angle = PI / 8 + k * PI / 4
            Pair(point.x + corner * cos(angle), point.y + corner * sin(angle))
        }
    }

    /** The corridor's own area: each segment's band plus one disk for the ends and joins. */
    fun corridorArea(piece: List<Point>, radius: Double): Double {
        var length = 0.0
        for (index in 1 until piece.size)
            length +=
                hypot(piece[index].x - piece[index - 1].x, piece[index].y - piece[index - 1].y)
        return 2 * radius * length + PI * radius * radius
    }

    /** Andrew's monotone chain: counterclockwise, without repeating the first point. */
    fun hull(points: List<Pair<Double, Double>>): List<Pair<Double, Double>> {
        val sorted = points.sortedWith(compareBy({ it.first }, { it.second }))
        if (sorted.size <= 2) return sorted
        fun cross(o: Pair<Double, Double>, a: Pair<Double, Double>, b: Pair<Double, Double>) =
            (a.first - o.first) * (b.second - o.second) -
                (a.second - o.second) * (b.first - o.first)
        val lower = mutableListOf<Pair<Double, Double>>()
        for (point in sorted) {
            while (
                lower.size >= 2 && cross(lower[lower.size - 2], lower[lower.size - 1], point) <= 0
            )
                lower.removeAt(lower.size - 1)
            lower.add(point)
        }
        val upper = mutableListOf<Pair<Double, Double>>()
        for (point in sorted.asReversed()) {
            while (
                upper.size >= 2 && cross(upper[upper.size - 2], upper[upper.size - 1], point) <= 0
            )
                upper.removeAt(upper.size - 1)
            upper.add(point)
        }
        return lower.dropLast(1) + upper.dropLast(1)
    }

    fun area(ring: List<Pair<Double, Double>>): Double {
        var area = 0.0
        for (index in ring.indices) {
            val a = ring[index]
            val b = ring[(index + 1) % ring.size]
            area += a.first * b.second - b.first * a.second
        }
        return abs(area) / 2
    }

    /** Clips a convex ring to the Web Mercator square and converts it to a canonical pack ring. */
    fun region(hull: List<Pair<Double, Double>>): OfflinePackRegion? {
        var ring = hull
        ring = clip(ring, 0, 0.0, keepBelow = false)
        ring = clip(ring, 0, 1.0, keepBelow = true)
        ring = clip(ring, 1, 0.0, keepBelow = false)
        ring = clip(ring, 1, 1.0, keepBelow = true)
        val positions = mutableListOf<TileflowPosition>()
        for ((x, y) in ring) {
            val latitude = atan(sinh(PI * (1 - 2 * y))) * 180 / PI
            val position =
                TileflowPosition(
                    OfflinePackRegion.round(x * 360 - 180).coerceIn(-180.0, 180.0),
                    OfflinePackRegion.round(latitude)
                        .coerceIn(
                            -OfflinePackRegion.MAXIMUM_LATITUDE,
                            OfflinePackRegion.MAXIMUM_LATITUDE,
                        ),
                )
            if (positions.lastOrNull() != position) positions.add(position)
        }
        while (positions.size > 1 && positions.first() == positions.last())
            positions.removeAt(positions.size - 1)
        if (positions.size < 3) return null
        return OfflinePackRegion.canonical(positions + positions[0])
    }

    private fun clip(
        ring: List<Pair<Double, Double>>,
        axis: Int,
        bound: Double,
        keepBelow: Boolean,
    ): List<Pair<Double, Double>> {
        fun value(point: Pair<Double, Double>) = if (axis == 0) point.first else point.second
        fun inside(point: Pair<Double, Double>) =
            if (keepBelow) value(point) <= bound else value(point) >= bound
        val clipped = mutableListOf<Pair<Double, Double>>()
        for (index in ring.indices) {
            val current = ring[index]
            val next = ring[(index + 1) % ring.size]
            if (inside(current)) clipped.add(current)
            if (inside(current) != inside(next)) {
                val t = (bound - value(current)) / (value(next) - value(current))
                clipped.add(
                    Pair(
                        current.first + t * (next.first - current.first),
                        current.second + t * (next.second - current.second),
                    )
                )
            }
        }
        return clipped
    }
}
