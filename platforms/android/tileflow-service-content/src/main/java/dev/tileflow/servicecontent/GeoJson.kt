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
