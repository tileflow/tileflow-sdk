package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.transport.ResourceDigest
import java.util.Base64
import org.json.JSONArray

/**
 * A Hosted download's cover: the tile packs it needs, computed on the device from its region, as
 * Mapbox computes tile regions. The service never sees the region; it plans, assembles and bills
 * the download from the cover and signs its digest.
 *
 * Each entry is one anchor tile of a zoom band, with a bit mask of the tiles it covers at its mask
 * zoom, the band's deepest zoom within the download's zooms; the tiles at shallower zooms of the
 * band are their ancestors. Without a mask the whole anchor is covered. For every band that starts
 * at or before the download's deepest zoom, the cover lists each anchor the region covers at the
 * anchor zoom, so the tiles of each zoom are exactly the region's. Bands wholly below the
 * download's first zoom are included: a source whose zooms end before it, or the Bathymetry
 * elevation model's base-zoom parents, download tiles there.
 */
internal data class OfflineCover(
    val minZoom: Int,
    val maxZoom: Int,
    /** In canonical order: anchor zoom, then row, then column. */
    val entries: List<Entry>,
) {
    /**
     * One anchor and its [mask]: the covered tiles at the mask zoom, row-major from the anchor's
     * first, least significant bit first in each byte; null when every tile is covered.
     */
    class Entry(val anchor: OfflineTileId, val mask: ByteArray?) {
        override fun equals(other: Any?): Boolean {
            if (other !is Entry || other.anchor != anchor) return false
            val mine = mask
            val theirs = other.mask
            return if (mine == null || theirs == null) mine == null && theirs == null
            else mine.contentEquals(theirs)
        }

        override fun hashCode(): Int = anchor.hashCode() * 31 + (mask?.contentHashCode() ?: 0)

        override fun toString(): String = "Entry($anchor, ${mask?.let(::encode)})"
    }

    fun toJson(): JSONArray =
        JSONArray(
            entries.map { entry ->
                JSONArray().put(entry.anchor.z).put(entry.anchor.x).put(entry.anchor.y).also {
                    entry.mask?.let { mask -> it.put(encode(mask)) }
                }
            }
        )

    /** The canonical JSON the service stores and digests, as `JSON.stringify` writes it. */
    val text: String
        get() =
            entries.joinToString(",", "[", "]") { entry ->
                val anchor = "${entry.anchor.z},${entry.anchor.x},${entry.anchor.y}"
                entry.mask?.let { "[$anchor,\"${encode(it)}\"]" } ?: "[$anchor]"
            }

    /** The SHA-256 of [text] in lowercase hexadecimal, as the manifest and grant carry it. */
    val sha256: String
        get() = ResourceDigest.sha256(text.toByteArray(Charsets.UTF_8))

    /** The entry for [anchor], if the cover lists one. */
    fun entry(anchor: OfflineTileId): Entry? {
        var low = 0
        var high = entries.size
        while (low < high) {
            val middle = (low + high) / 2
            if (ORDER.compare(entries[middle].anchor, anchor) < 0) low = middle + 1 else high = middle
        }
        return entries.getOrNull(low)?.takeIf { it.anchor == anchor }
    }

    /**
     * Whether the download's cover holds [tile]: a covered tile at its mask zoom, or an ancestor
     * of one within its band, also below the download's first zoom.
     */
    fun contains(tile: OfflineTileId): Boolean {
        if (tile.z !in 0..maxZoom) return false
        val anchorZoom = OfflinePackBand.anchor(tile.z)
        val maskZoom = maskZoom(anchorZoom, maxZoom)
        if (tile.z > maskZoom) return false
        val entry = entry(tile.ancestor(anchorZoom)) ?: return false
        val mask = entry.mask ?: return true
        val side = 1 shl (maskZoom - anchorZoom)
        val span = 1 shl (maskZoom - tile.z)
        val left = tile.x * span - entry.anchor.x * side
        val top = tile.y * span - entry.anchor.y * side
        for (dy in top until top + span) {
            for (dx in left until left + span) {
                val index = dy * side + dx
                if (mask[index shr 3].toInt() and (1 shl (index and 7)) != 0) return true
            }
        }
        return false
    }

    /**
     * The tiles an entry holds within [zooms]: its covered tiles at the mask zoom and their
     * ancestors, by zoom.
     */
    fun tiles(entry: Entry, zooms: IntRange): Map<Int, List<OfflineTileId>> {
        val anchorZoom = entry.anchor.z
        val maskZoom = maskZoom(anchorZoom, maxZoom)
        val low = maxOf(zooms.first, anchorZoom)
        val high = minOf(zooms.last, maskZoom)
        if (low > high) return emptyMap()
        val side = 1 shl (maskZoom - anchorZoom)
        val tiles = HashMap<Int, MutableSet<OfflineTileId>>()
        for (index in 0 until side * side) {
            val mask = entry.mask
            if (mask != null && mask[index shr 3].toInt() and (1 shl (index and 7)) == 0) continue
            val leaf =
                OfflineTileId(
                    maskZoom,
                    entry.anchor.x * side + index % side,
                    entry.anchor.y * side + index / side,
                )
            for (z in low..high) tiles.getOrPut(z) { HashSet() }.add(leaf.ancestor(z))
        }
        return tiles.mapValues { (_, set) -> set.sortedWith(compareBy({ it.y }, { it.x })) }
    }

    companion object {
        /** The most entries the service accepts. */
        const val MAXIMUM_ENTRIES = 16_384

        private val ORDER = compareBy<OfflineTileId>({ it.z }, { it.y }, { it.x })

        /** The zoom an anchor's mask describes: its band's deepest zoom within the download's. */
        fun maskZoom(anchor: Int, maxZoom: Int): Int =
            minOf(OfflinePackBand.zooms(anchor)?.last ?: anchor, maxZoom)

        /**
         * The cover of [regions] together for a download of [minZoom]..[maxZoom]: their union,
         * each tile once.
         *
         * @throws TileflowOfflineException `REGION_TOO_COMPLEX` when it would list more than
         *   [MAXIMUM_ENTRIES] packs.
         */
        fun of(regions: List<OfflinePackRegion>, minZoom: Int, maxZoom: Int): OfflineCover {
            val entries = ArrayList<Entry>()
            for (anchorZoom in OfflinePackBand.anchors) {
                val band = OfflinePackBand.zooms(anchorZoom) ?: continue
                if (band.first > maxZoom) continue
                val maskZoom = maskZoom(anchorZoom, maxZoom)
                val shift = maskZoom - anchorZoom
                val side = 1 shl shift
                // The anchors the region covers at the anchor zoom, in row order.
                val anchors = OfflineCoverRows(regions, anchorZoom)
                val count = entries.size + anchors.count
                if (count > MAXIMUM_ENTRIES)
                    throw TileflowOfflineException(
                        TileflowOfflineErrorCode.REGION_TOO_COMPLEX,
                        TileflowErrorContext(
                            reason = "tooManyPacks",
                            limit = MAXIMUM_ENTRIES,
                            count = count,
                        ),
                    )
                // The tiles it covers at the mask zoom, by anchor.
                val masks = HashMap<OfflineTileId, ByteArray>()
                for ((y, ranges) in OfflineCoverRows(regions, maskZoom).rows) {
                    val anchorY = y shr shift
                    val dy = y - (anchorY shl shift)
                    for (range in ranges) {
                        for (anchorX in (range.first shr shift)..(range.last shr shift)) {
                            if (!anchors.contains(anchorX, anchorY)) continue
                            val anchor = OfflineTileId(anchorZoom, anchorX, anchorY)
                            val mask = masks.getOrPut(anchor) { ByteArray((side * side + 7) / 8) }
                            val first = maxOf(range.first, anchorX shl shift)
                            val last = minOf(range.last, (anchorX shl shift) + side - 1)
                            for (x in first..last) {
                                val index = dy * side + (x - (anchorX shl shift))
                                mask[index shr 3] =
                                    (mask[index shr 3].toInt() or (1 shl (index and 7))).toByte()
                            }
                        }
                    }
                }
                for ((y, ranges) in anchors.rows) {
                    for (range in ranges) {
                        for (x in range) {
                            val anchor = OfflineTileId(anchorZoom, x, y)
                            val mask = masks[anchor] ?: continue
                            entries.add(Entry(anchor, if (isFull(mask, side)) null else mask))
                        }
                    }
                }
            }
            return OfflineCover(minZoom, maxZoom, entries)
        }

        /**
         * A cover as the service reads one, in canonical form: entries sorted and a full mask
         * dropped. Null when the service would refuse it.
         */
        fun fromJson(value: Any?, minZoom: Int, maxZoom: Int): OfflineCover? {
            if (value !is JSONArray || value.length() < 1 || value.length() > MAXIMUM_ENTRIES)
                return null
            val seen = HashSet<OfflineTileId>()
            val entries = ArrayList<Entry>()
            for (index in 0 until value.length()) {
                val item = value.opt(index) as? JSONArray ?: return null
                if (item.length() != 3 && item.length() != 4) return null
                val z = integer(item.opt(0)) ?: return null
                val band = OfflinePackBand.zooms(z) ?: return null
                if (band.first > maxZoom) return null
                val x = integer(item.opt(1)) ?: return null
                val y = integer(item.opt(2)) ?: return null
                if (x !in 0 until (1 shl z) || y !in 0 until (1 shl z)) return null
                val anchor = OfflineTileId(z, x, y)
                if (!seen.add(anchor)) return null
                var mask: ByteArray? = null
                if (item.length() == 4) {
                    val side = 1 shl (maskZoom(z, maxZoom) - z)
                    val decoded = decode(item.opt(3) as? String ?: return null, side) ?: return null
                    mask = if (isFull(decoded, side)) null else decoded
                }
                entries.add(Entry(anchor, mask))
            }
            return OfflineCover(minZoom, maxZoom, entries.sortedWith { a, b ->
                ORDER.compare(a.anchor, b.anchor)
            })
        }

        /** The byte a fully covered mask holds at [index]: every bit but the padding of the last. */
        private fun fullByte(side: Int, index: Int): Int {
            val remaining = side * side - index * 8
            return if (remaining >= 8) 0xFF else (1 shl remaining) - 1
        }

        private fun isFull(mask: ByteArray, side: Int): Boolean =
            mask.indices.all { (mask[it].toInt() and 0xFF) == fullByte(side, it) }

        /** Unpadded base64url. */
        fun encode(mask: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(mask)

        /**
         * A mask for `side × side` tiles in its one valid spelling: the right length, no padding
         * bits set and some tile set.
         */
        private fun decode(text: String, side: Int): ByteArray? {
            val length = (side * side + 7) / 8
            if (text.length != (length * 4 + 2) / 3) return null
            if (!text.all { it in 'A'..'Z' || it in 'a'..'z' || it in '0'..'9' || it == '-' || it == '_' })
                return null
            val mask = runCatching { Base64.getUrlDecoder().decode(text) }.getOrNull() ?: return null
            if (mask.size != length) return null
            if ((mask[length - 1].toInt() and 0xFF) and fullByte(side, length - 1).inv() != 0) return null
            if (mask.all { it.toInt() == 0 } || encode(mask) != text) return null
            return mask
        }

        private fun integer(value: Any?): Int? {
            val number = value as? Number ?: return null
            val double = number.toDouble()
            if (double != Math.rint(double) || kotlin.math.abs(double) >= 1e9) return null
            return double.toInt()
        }
    }
}

/** The covered tiles of several regions at one zoom, row by row: their union. */
internal class OfflineCoverRows(regions: List<OfflinePackRegion>, zoom: Int) {
    val rows: List<Pair<Int, List<IntRange>>>
    private val byRow: Map<Int, List<IntRange>>

    init {
        val covers = regions.map { OfflineTileCover(it, zoom) }
        val spans = covers.mapNotNull { it.rows }
        val rows = ArrayList<Pair<Int, List<IntRange>>>()
        if (spans.isNotEmpty()) {
            for (y in spans.minOf { it.first }..spans.maxOf { it.last }) {
                val ranges = OfflineTileCover.merged(covers.flatMap { it.row(y) })
                if (ranges.isNotEmpty()) rows.add(y to ranges)
            }
        }
        this.rows = rows
        byRow = rows.toMap()
    }

    val count: Int
        get() = rows.sumOf { (_, ranges) -> ranges.sumOf { it.last - it.first + 1 } }

    fun contains(x: Int, y: Int): Boolean = byRow[y]?.any { x in it } ?: false
}
