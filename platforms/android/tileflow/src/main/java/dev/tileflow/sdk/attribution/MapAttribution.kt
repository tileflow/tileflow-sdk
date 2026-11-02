package dev.tileflow.sdk.attribution

import org.json.JSONArray

/** One line of a map's attribution: its exact text and, for a credit, the page it links to. */
internal data class MapAttributionEntry(val text: String, val href: String? = null)

/** A regional credit of a downloaded release, shown while one of its boxes is in view. */
internal class MapCredit(
    val id: String,
    val text: String,
    val href: String,
    /** `[west, south, east, north]` boxes. */
    val regions: List<DoubleArray>,
) {
    companion object {
        /** The credits the view gives a map that opens from downloaded regions. */
        fun list(value: JSONArray?): List<MapCredit> {
            if (value == null) return emptyList()
            return (0 until value.length()).mapNotNull { index ->
                val credit = value.optJSONObject(index) ?: return@mapNotNull null
                val id = credit.optString("id").takeIf { it.isNotEmpty() }
                val text = credit.optString("text").takeIf { it.isNotEmpty() }
                if (id == null || text == null) return@mapNotNull null
                val href =
                    credit.optString("href").takeIf { it.startsWith("https://") }
                        ?: return@mapNotNull null
                val boxes = credit.optJSONArray("regions") ?: return@mapNotNull null
                val regions =
                    (0 until boxes.length()).mapNotNull { box ->
                        val numbers = boxes.optJSONArray(box) ?: return@mapNotNull null
                        DoubleArray(4) { numbers.optDouble(it) }.takeIf { values ->
                            numbers.length() == 4 && values.all { it.isFinite() }
                        }
                    }
                if (regions.isEmpty()) null else MapCredit(id, text, href, regions)
            }
        }
    }
}

/**
 * What a map's attribution shows: the attribution of every source of its style, distinct by exact
 * text and in style order, then each regional credit while one of its boxes intersects the view.
 * A credit whose exact text a source attribution already contains is not repeated. The texts are
 * exact; nothing here rewrites them.
 */
internal class MapAttribution(
    val sources: List<String> = emptyList(),
    val credits: List<MapCredit> = emptyList(),
) {
    /** The entries for a view; its longitudes may run past ±180° across the antimeridian. */
    fun entries(
        west: Double,
        south: Double,
        east: Double,
        north: Double,
    ): List<MapAttributionEntry> {
        val distinct = sources.filter { it.isNotEmpty() }.distinct()
        val joined = distinct.joinToString("\n")
        return distinct.map { MapAttributionEntry(it) } +
            visibleCredits(credits, west, south, east, north)
                .filter { !joined.contains(it.text) }
                .map { MapAttributionEntry(it.text, it.href) }
    }

    companion object {
        /**
         * The credits with a box that intersects the view. The view's longitudes may run past
         * ±180°, as a camera over the antimeridian sees world copies; a view wider than the world
         * sees every box. Touching edges count.
         */
        fun visibleCredits(
            credits: List<MapCredit>,
            west: Double,
            south: Double,
            east: Double,
            north: Double,
        ): List<MapCredit> {
            val wide = east - west >= 360
            return credits.filter { credit ->
                credit.regions.any { box ->
                    if (box[1] > north || box[3] < south) false
                    else
                        wide ||
                            listOf(-360.0, 0.0, 360.0).any { shift ->
                                box[0] + shift <= east && box[2] + shift >= west
                            }
                }
            }
        }
    }
}
