package dev.tileflow.elevation

import dev.tileflow.configuration.TileflowPosition
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min

/** The Terrain release read and the tile zoom sampled. */
public data class TileflowElevationDataset(public val releaseId: String, public val zoom: Int)

/** A position with its elevation, or null where there is no data. */
public data class TileflowElevatedPosition(
    public val position: TileflowPosition,
    public val elevation: Double?,
)

/**
 * The elevations of up to 100 positions, in request order.
 *
 * @property attribution The credit to show with the data.
 * @property units The API units the operation consumed.
 */
public data class TileflowElevationPointsResponse(
    public val positions: List<TileflowElevatedPosition>,
    public val unit: TileflowElevationUnit,
    public val dataset: TileflowElevationDataset,
    public val attribution: String,
    public val units: Int,
)

/**
 * The elevations of any number of positions, in order.
 *
 * @property attribution The distinct credits of every request, in the order they first appeared.
 * @property units The API units of every request.
 */
public data class TileflowElevationBatch(
    public val positions: List<TileflowElevatedPosition>,
    public val unit: TileflowElevationUnit,
    public val attribution: String,
    public val units: Int,
)

/** A profile sample and its distance along the line from the start of the first line. */
public data class TileflowElevationSample(
    public val position: TileflowPosition,
    public val elevation: Double?,
    public val distance: Double,
)

/**
 * The climbs and grades of a profile. Grades are percentages over a run of at least 100 m.
 *
 * @property maxGrade The steepest uphill grade.
 * @property minGrade The steepest downhill grade.
 */
public data class TileflowElevationProfileSummary(
    public val distance: Double,
    public val ascent: Double?,
    public val descent: Double?,
    public val minElevation: Double?,
    public val maxElevation: Double?,
    public val startElevation: Double?,
    public val endElevation: Double?,
    public val maxGrade: Double?,
    public val minGrade: Double?,
)

/**
 * A point of a profile, interpolated between its samples.
 *
 * @property distance The distance along the profile, within its length.
 * @property index The index of the sample at or before this point.
 * @property line The index of the line this point is on.
 */
public data class TileflowElevationProfilePoint(
    public val position: TileflowPosition,
    public val elevation: Double?,
    public val distance: Double,
    public val index: Int,
    public val line: Int,
)

/**
 * An elevation profile. Every length is in [unit].
 *
 * @property lines The first and last sample index of each line, in request order.
 */
public data class TileflowElevationProfile(
    public val unit: TileflowElevationUnit,
    public val dataset: TileflowElevationDataset,
    public val attribution: String,
    public val units: Int,
    public val interval: Double,
    public val samples: List<TileflowElevationSample>,
    public val lines: List<IntRange>,
    public val summary: TileflowElevationProfileSummary,
) {
    /**
     * The profile at a distance from its start, clamped to its length and interpolated within one
     * line. Null without samples or for a distance that is not finite.
     */
    public fun point(atDistance: Double): TileflowElevationProfilePoint? {
        if (samples.isEmpty() || lines.isEmpty() || !atDistance.isFinite()) return null
        val clamped = min(samples.last().distance, max(0.0, atDistance))
        var low = 0
        var high = samples.size - 1
        while (high - low > 1) {
            val middle = (low + high) ushr 1
            if (samples[middle].distance <= clamped) low = middle else high = middle
        }
        // Two lines meet at one distance: the earlier line ends where the next one starts.
        val line = lineOf(low)
        val a = samples[low]
        val b = samples[min(high, lines[line].last)]
        val span = b.distance - a.distance
        val t = if (span > 0) ((clamped - a.distance) / span).coerceIn(0.0, 1.0) else 0.0
        return TileflowElevationProfilePoint(
            TileflowPosition(
                a.position.longitude + (b.position.longitude - a.position.longitude) * t,
                a.position.latitude + (b.position.latitude - a.position.latitude) * t,
            ),
            elevationAt(line, clamped),
            clamped,
            low,
            line,
        )
    }

    /**
     * The index of the sample nearest to a position, by straight-line distance in degrees scaled
     * by latitude, or null without samples.
     */
    public fun nearestSampleIndex(to: TileflowPosition): Int? {
        var best: Int? = null
        var bestDistance = Double.POSITIVE_INFINITY
        val scale = cos(to.latitude * PI / 180)
        samples.forEachIndexed { index, sample ->
            val dx = (sample.position.longitude - to.longitude) * scale
            val dy = sample.position.latitude - to.latitude
            val value = dx * dx + dy * dy
            if (value < bestDistance) {
                bestDistance = value
                best = index
            }
        }
        return best
    }

    private fun lineOf(index: Int): Int {
        lines.forEachIndexed { line, range -> if (index <= range.last) return line }
        return lines.size - 1
    }

    /** The elevation at a distance within one line, or null without data on both sides. */
    private fun elevationAt(line: Int, distance: Double): Double? {
        val first = lines[line].first
        val last = lines[line].last
        val clamped = min(samples[last].distance, max(samples[first].distance, distance))
        var low = first
        var high = last
        while (high - low > 1) {
            val middle = (low + high) ushr 1
            if (samples[middle].distance <= clamped) low = middle else high = middle
        }
        val a = samples[low]
        val b = samples[high]
        val from = a.elevation
        val to = b.elevation
        if (from == null || to == null) return from ?: to
        val span = b.distance - a.distance
        return if (span > 0) from + (to - from) * (clamped - a.distance) / span else from
    }
}
