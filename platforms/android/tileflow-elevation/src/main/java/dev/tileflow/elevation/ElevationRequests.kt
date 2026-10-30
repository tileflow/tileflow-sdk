package dev.tileflow.elevation

import dev.tileflow.configuration.TileflowPosition

/** The unit of every elevation and length in a request and its answer. */
public enum class TileflowElevationUnit(internal val wireName: String) {
    METERS("meters"),
    FEET("feet"),
}

/** The line a profile samples. */
public sealed class TileflowElevationLine {
    /** 2 to 20,000 positions. */
    public data class LineString(public val positions: List<TileflowPosition>) :
        TileflowElevationLine()

    /** 1 to 100 lines of 2 to 20,000 positions each, sampled one after another. */
    public data class MultiLineString(public val lines: List<List<TileflowPosition>>) :
        TileflowElevationLine()

    /** An encoded polyline of 2 to 400,000 characters, with precision 5 or 6. */
    public data class Polyline(public val encoded: String, public val precision: Int = 5) :
        TileflowElevationLine()
}

/**
 * Evenly spaced samples along a line, with a summary of its climbs, drops and grades. Every length
 * is in [unit].
 *
 * @property interval The spacing of the samples, greater than 0; the API chooses it when null.
 * @property maxSamples 2 to 1,000 samples; the API answers at most 500 when it is null.
 * @property climbThreshold The smallest rise or drop counted in the summary, at least 0.
 */
public data class TileflowElevationProfileRequest(
    public val line: TileflowElevationLine,
    public val interval: Double? = null,
    public val maxSamples: Int? = null,
    public val climbThreshold: Double? = null,
    public val unit: TileflowElevationUnit = TileflowElevationUnit.METERS,
) {
    /** The profile of a GPX document's tracks and routes; their recorded heights are not sent. */
    @JvmOverloads
    public constructor(
        gpx: TileflowGpxTrack,
        interval: Double? = null,
        maxSamples: Int? = null,
        climbThreshold: Double? = null,
        unit: TileflowElevationUnit = TileflowElevationUnit.METERS,
    ) : this(
        TileflowElevationLine.MultiLineString(gpx.lines.map { line -> line.map { it.position } }),
        interval,
        maxSamples,
        climbThreshold,
        unit,
    )
}
