package dev.tileflow.servicecontent

import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.sdk.TileflowGeoJSONLayer
import dev.tileflow.sdk.TileflowGeoJSONLayerKind
import java.math.BigDecimal
import kotlin.math.roundToLong

/** A layer before it becomes a [TileflowGeoJSONLayer]. Its GeoJSON is ASCII. */
internal class LayerSpec(
    val id: String,
    val geoJson: String,
    val kind: TileflowGeoJSONLayerKind,
    val color: String,
    val size: Double,
    val opacity: Double,
) {
    fun layer(): TileflowGeoJSONLayer =
        TileflowGeoJSONLayer(id, geoJson, kind, color, size, opacity)
}

/** Compact GeoJSON with at most six decimals per coordinate. */
internal object GeoJson {
    /** The map's limit for the GeoJSON of one layer. */
    const val MAXIMUM_LAYER_BYTES = 49_152

    fun number(value: Double): String =
        BigDecimal.valueOf((value * 1e6).roundToLong(), 6).stripTrailingZeros().toPlainString()

    fun StringBuilder.position(position: TileflowPosition): StringBuilder =
        append('[')
            .append(number(position.longitude))
            .append(',')
            .append(number(position.latitude))
            .append(']')

    fun StringBuilder.positions(positions: List<TileflowPosition>): StringBuilder {
        append('[')
        positions.forEachIndexed { index, position ->
            if (index > 0) append(',')
            position(position)
        }
        return append(']')
    }

    /** A FeatureCollection with one LineString feature per line, identified by its number. */
    fun lines(lines: List<Pair<Int, List<TileflowPosition>>>): String {
        val text = StringBuilder("{\"type\":\"FeatureCollection\",\"features\":[")
        lines.forEachIndexed { index, (id, positions) ->
            if (index > 0) text.append(',')
            text.append("{\"type\":\"Feature\",\"id\":").append(id)
            text.append(",\"properties\":{},\"geometry\":{\"type\":\"LineString\",\"coordinates\":")
            text.positions(positions).append("}}")
        }
        return text.append("]}").toString()
    }

    /** A FeatureCollection with one Polygon or MultiPolygon feature. */
    fun area(minutes: Int, polygons: List<List<List<TileflowPosition>>>): String {
        val text = StringBuilder("{\"type\":\"FeatureCollection\",\"features\":[")
        text.append("{\"type\":\"Feature\",\"properties\":{\"minutes\":").append(minutes)
        text.append("},\"geometry\":{\"type\":")
        fun StringBuilder.polygon(rings: List<List<TileflowPosition>>) {
            append('[')
            rings.forEachIndexed { index, ring ->
                if (index > 0) append(',')
                positions(ring)
            }
            append(']')
        }
        if (polygons.size == 1) {
            text.append("\"Polygon\",\"coordinates\":")
            text.polygon(polygons.single())
        } else {
            text.append("\"MultiPolygon\",\"coordinates\":[")
            polygons.forEachIndexed { index, rings ->
                if (index > 0) text.append(',')
                text.polygon(rings)
            }
            text.append(']')
        }
        return text.append("}}]}").toString()
    }
}

/** Douglas–Peucker simplification in degrees. */
internal object Simplification {
    /** The tolerances tried in turn: none, then 1e-6 degrees doubling up to a whole turn. */
    val tolerances: Sequence<Double> =
        sequenceOf(0.0) + generateSequence(1e-6) { it * 2 }.takeWhile { it <= 360.0 }

    /** A line that keeps its ends and every position farther than [tolerance] from the result. */
    fun line(positions: List<TileflowPosition>, tolerance: Double): List<TileflowPosition> {
        if (tolerance <= 0 || positions.size <= 2) return positions
        val keep = BooleanArray(positions.size)
        keep[0] = true
        keep[positions.size - 1] = true
        val squared = tolerance * tolerance
        val stack = ArrayDeque<Pair<Int, Int>>()
        stack.addLast(0 to positions.size - 1)
        while (stack.isNotEmpty()) {
            val (first, last) = stack.removeLast()
            var farthest = -1
            var distance = squared
            for (index in first + 1 until last) {
                val value = squaredDistance(positions[index], positions[first], positions[last])
                if (value > distance) {
                    distance = value
                    farthest = index
                }
            }
            if (farthest != -1) {
                keep[farthest] = true
                stack.addLast(first to farthest)
                stack.addLast(farthest to last)
            }
        }
        return positions.filterIndexed { index, _ -> keep[index] }
    }

    /**
     * A closed ring simplified like [line] but never below four positions: when it would collapse,
     * it keeps its first position, the position farthest from it and the position farthest from
     * the line between those two.
     */
    fun ring(positions: List<TileflowPosition>, tolerance: Double): List<TileflowPosition> {
        if (positions.size <= 4) return positions
        val simplified = line(positions, tolerance)
        if (simplified.size >= 4) return simplified
        val start = positions.first()
        val inner = 1 until positions.size - 1
        val opposite = inner.maxBy { squaredDistance(positions[it], start, start) }
        val third =
            inner
                .filter { it != opposite }
                .maxBy { squaredDistance(positions[it], start, positions[opposite]) }
        return listOf(0, minOf(opposite, third), maxOf(opposite, third), positions.size - 1).map {
            positions[it]
        }
    }

    private fun squaredDistance(
        point: TileflowPosition,
        start: TileflowPosition,
        end: TileflowPosition,
    ): Double {
        val dx = end.longitude - start.longitude
        val dy = end.latitude - start.latitude
        val length = dx * dx + dy * dy
        val projection =
            (point.longitude - start.longitude) * dx + (point.latitude - start.latitude) * dy
        val t = if (length == 0.0) 0.0 else (projection / length).coerceIn(0.0, 1.0)
        val x = start.longitude + t * dx - point.longitude
        val y = start.latitude + t * dy - point.latitude
        return x * x + y * y
    }
}
