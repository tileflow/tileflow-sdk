package dev.tileflow.sdk

import kotlin.math.abs
import kotlin.math.ceil

/**
 * Follows the image edge across repeated worlds. If it reaches the sky, keep all regional credits.
 */
internal object SnapshotBounds {
    fun measure(
        width: Double,
        height: Double,
        coordinate: (Double, Double) -> TileflowCoordinate,
    ): DoubleArray {
        val corners = listOf(0.0 to 0.0, width to 0.0, width to height, 0.0 to height, 0.0 to 0.0)
        var previous: Double? = null
        var west = Double.POSITIVE_INFINITY
        var east = Double.NEGATIVE_INFINITY
        var south = Double.POSITIVE_INFINITY
        var north = Double.NEGATIVE_INFINITY
        for ((a, b) in corners.zipWithNext()) {
            val dx = b.first - a.first
            val dy = b.second - a.second
            val steps = maxOf(1, ceil(maxOf(abs(dx), abs(dy)) / 64).toInt())
            for (step in 0 until steps) {
                val t = step.toDouble() / steps
                val p = coordinate(a.first + dx * t, a.second + dy * t)
                if (!p.longitude.isFinite() || p.latitude !in -90.0..90.0)
                    return doubleArrayOf(-180.0, -90.0, 180.0, 90.0)
                val lon =
                    previous?.let { it + (((p.longitude - it) % 360 + 540) % 360) - 180 }
                        ?: p.longitude
                previous = lon
                west = minOf(west, lon)
                east = maxOf(east, lon)
                south = minOf(south, p.latitude)
                north = maxOf(north, p.latitude)
            }
        }
        return doubleArrayOf(west, south, east, north)
    }
}
