package dev.tileflow.sdk.attribution

import dev.tileflow.sdk.offline.OfflineCredit
import dev.tileflow.sdk.offline.OfflineObligation
import org.json.JSONArray
import org.json.JSONObject

/** One item of a map's attribution: its exact text, and the parts of it that open a page. */
internal data class MapAttributionEntry(
    val kind: Kind,
    val text: String,
    val links: List<Link> = emptyList(),
) {
    enum class Kind(
        /** The position of the kind's group in the attribution. */
        val group: Int
    ) {
        /** A credit from a source's attribution, in the style the map shows. */
        SOURCE(0),
        /** A notice a downloaded source requires wherever its data is shown. */
        OBLIGATION(1),
        /** The page that holds a downloaded source's full notices. */
        PAGE(1),
        /** A downloaded source's credit for the places one of its boxes covers. */
        REGIONAL(2),
        /** A notice the style declares, such as "Not for navigation". */
        NOTICE(3),
        /** World's fair-use notice. */
        FAIR_USE(4),
    }

    /** A part of [text], from [start] to [end] in UTF-16 units, that opens an `https` page. */
    data class Link(val start: Int, val end: Int, val url: String)

    /** The text of the part a link covers. */
    fun text(link: Link): String = text.substring(link.start, link.end)

    companion object {
        /**
         * An entry whose whole text opens [url], when [url] is an `https` page. An `https` address
         * written in the text, such as a licence's, opens itself.
         */
        fun linked(kind: Kind, text: String, url: String?): MapAttributionEntry =
            MapAttributionEntry(
                kind,
                text,
                MapAttributionText.linkingAddresses(
                    text,
                    listOfNotNull(
                        url?.takeIf(MapAttributionText::isPage)?.let { Link(0, text.length, it) }
                    ),
                ),
            )
    }
}

/** A regional credit of a downloaded release, shown while one of its boxes is in view. */
internal class MapCredit(
    val id: String,
    val text: String,
    val href: String,
    /** `[west, south, east, north]` boxes. */
    val regions: List<DoubleArray>,
) {
    constructor(
        credit: OfflineCredit
    ) : this(
        credit.id,
        credit.text,
        credit.href,
        credit.regions.map { box -> DoubleArray(box.size) { box[it] } },
    )

    companion object {
        /** Credits in the form the map view gives a renderer: `{id, text, href, regions}`. */
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
 * A notice of a downloaded source that is shown wherever its data is, or the page that holds the
 * source's full notices (with its [href]).
 */
internal data class MapObligation(val text: String, val href: String? = null) {
    constructor(obligation: OfflineObligation) : this(obligation.text, obligation.href)
}

/**
 * What a map credits in a view. The control shows, in this order and each text once:
 * 1. the attribution of each source of the style the map shows, as its items
 *    ([MapAttributionText]);
 * 2. the obligations and the page of each source its downloaded regions hold, always;
 * 3. each regional credit of those sources while one of its boxes is in view;
 * 4. the notices the style declares;
 * 5. World's fair-use notice while World asks for one.
 *
 * Texts are exact: nothing here rewrites them, and an item whose exact text is already shown is
 * not repeated. Only `https` addresses become links.
 */
internal data class MapAttribution(
    /** Each source's attribution, as the style declares it: plain text or HTML with links. */
    val sources: List<String> = emptyList(),
    /** The obligations and pages of the downloaded sources, in their manifests' order. */
    val obligations: List<MapObligation> = emptyList(),
    /** The regional credits of the downloaded sources. */
    val credits: List<MapCredit> = emptyList(),
    /** The style's notices. */
    val notices: List<String> = emptyList(),
    val fairUse: MapFairUseNotice? = null,
) {
    /**
     * The entries for a view, `[west, south, east, north]`; its longitudes may run past ±180°
     * across the antimeridian. Without a view, no regional credit shows.
     */
    fun entries(view: DoubleArray?): List<MapAttributionEntry> {
        val entries = mutableListOf<MapAttributionEntry>()
        val shown = HashSet<String>()
        fun add(entry: MapAttributionEntry) {
            if (entry.text.isNotEmpty() && shown.add(entry.text)) entries += entry
        }
        for (source in sources)
            for (item in MapAttributionText.items(source))
                add(MapAttributionEntry(MapAttributionEntry.Kind.SOURCE, item.text, item.links))
        for (obligation in obligations) {
            val kind =
                if (obligation.href == null) MapAttributionEntry.Kind.OBLIGATION
                else MapAttributionEntry.Kind.PAGE
            add(MapAttributionEntry.linked(kind, obligation.text, obligation.href))
        }
        if (view != null)
            for (credit in visibleCredits(credits, view[0], view[1], view[2], view[3]))
                add(
                    MapAttributionEntry.linked(
                        MapAttributionEntry.Kind.REGIONAL,
                        credit.text,
                        credit.href,
                    )
                )
        for (notice in notices) add(MapAttributionEntry(MapAttributionEntry.Kind.NOTICE, notice))
        fairUse?.let { notice ->
            val text = "${notice.message} ${notice.action}"
            val start = notice.message.length + 1
            add(
                MapAttributionEntry(
                    MapAttributionEntry.Kind.FAIR_USE,
                    text,
                    listOf(MapAttributionEntry.Link(start, text.length, notice.help)),
                )
            )
        }
        return entries
    }

    companion object {
        /**
         * The credits with a box that intersects the view. The view's longitudes may run past
         * ±180°, as a camera over the antimeridian sees world copies; a view wider than the world
         * sees every box. Touching edges count, as the service's own intersection does.
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
                    if (box.size != 4 || box[1] > north || box[3] < south) false
                    else
                        wide ||
                            listOf(-360.0, 0.0, 360.0).any { shift ->
                                box[0] + shift <= east && box[2] + shift >= west
                            }
                }
            }
        }

        private val identifier = Regex("^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

        /**
         * The notices a style declares in `tileflow:notices`, as Core reads them: at most 8, each
         * with an identifier, the sources it names and a short trimmed text. Malformed entries are
         * ignored.
         */
        fun notices(style: JSONObject): List<String> {
            val values =
                style.optJSONObject("metadata")?.optJSONArray("tileflow:notices")
                    ?: return emptyList()
            val ids = HashSet<String>()
            val notices = mutableListOf<String>()
            for (index in 0 until minOf(values.length(), 8)) {
                val notice = values.optJSONObject(index) ?: continue
                val id = notice.opt("id") as? String ?: continue
                val text = notice.opt("text") as? String ?: continue
                val sources = notice.opt("sources") as? JSONArray ?: continue
                if (
                    !identifier.matches(id) ||
                        text.isEmpty() ||
                        text.length > 120 ||
                        text != text.trim() ||
                        text.any { Character.getType(it) == Character.CONTROL.toInt() } ||
                        sources.length() > 16 ||
                        (0 until sources.length()).any {
                            (sources.opt(it) as? String)?.let(identifier::matches) != true
                        } ||
                        !ids.add(id)
                )
                    continue
                notices += text
            }
            return notices
        }
    }
}
