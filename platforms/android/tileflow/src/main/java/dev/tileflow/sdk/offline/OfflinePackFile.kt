package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import java.io.ByteArrayInputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.charset.CodingErrorAction
import java.security.MessageDigest
import java.util.zip.GZIPInputStream

/** What a Hosted pack holds: a source's tiles under one anchor tile, or documents. */
internal enum class OfflinePackKind(val code: Int) {
    TILES(1),
    DOCUMENTS(2);

    companion object {
        fun of(code: Int): OfflinePackKind? = entries.firstOrNull { it.code == code }

        /** The manifest's name for the kind. */
        fun ofManifest(value: Any?): OfflinePackKind? =
            when (value) {
                "tiles" -> TILES
                "documents" -> DOCUMENTS
                else -> null
            }
    }
}

/** One entry of a pack: where its body lies in the pack file and how its route serves it. */
internal data class OfflinePackEntry(
    val name: String,
    val contentType: String,
    /** `gzip`, or null for a body served as it is. */
    val contentEncoding: String?,
    /** The body's offset from the start of the file. */
    val offset: Long,
    val length: Int,
)

/** A pack's entries by name, read from its header and index. */
internal class OfflinePackIndex(val kind: OfflinePackKind, val entries: Map<String, OfflinePackEntry>)

/**
 * The pack format (`application/vnd.tileflow.pack`), little-endian:
 * ```
 * header   "TFPK", version u16 = 1, kind u8, reserved u8 = 0, entry count u32,
 *          index length u32, data length u64, reserved u64 = 0
 * index    per entry: name length u16 + UTF-8 name, content type length u8 + ASCII,
 *          content encoding length u8 + ASCII (empty for none), data offset u64, data length u32
 * data     the bodies in index order, each its own range
 * trailer  SHA-256 of every preceding byte
 * ```
 *
 * The trailer is the pack's digest and its `ETag`. A pack is verified once, when it arrives, and
 * stored under its digest; serving reads only its header, its index and the one body asked for.
 */
internal object OfflinePackFormat {
    const val HEADER_LENGTH = 32
    const val TRAILER_LENGTH = 32
    const val VERSION = 1
    /** No pack the service delivers is larger. */
    const val MAXIMUM_BYTES = 32 * 1024 * 1024
    const val MEDIA_TYPE = "application/vnd.tileflow.pack"
    const val MAXIMUM_ENTRIES = 65_536
    const val MAXIMUM_NAME_BYTES = 4096

    fun invalid(): TileflowOfflineException =
        TileflowOfflineException(
            TileflowOfflineErrorCode.INVALID_RESPONSE,
            TileflowErrorContext(reason = "verificationFailed"),
        )

    /**
     * Verifies a received pack: exactly [bytes] long, its trailer the SHA-256 of what precedes it,
     * and a well-formed header and index of [kind] whose bodies fill the data section in order.
     * Returns its digest, in lowercase hexadecimal, and its index.
     */
    fun verify(file: File, bytes: Long, kind: OfflinePackKind): Pair<String, OfflinePackIndex> =
        checked {
            RandomAccessFile(file, "r").use { handle ->
                val size = handle.length()
                require(size == bytes && size >= HEADER_LENGTH + TRAILER_LENGTH)
                require(size <= MAXIMUM_BYTES)
                val digest = MessageDigest.getInstance("SHA-256")
                val buffer = ByteArray(1 shl 16)
                var remaining = size - TRAILER_LENGTH
                while (remaining > 0) {
                    val read = handle.read(buffer, 0, minOf(remaining, buffer.size.toLong()).toInt())
                    require(read > 0)
                    digest.update(buffer, 0, read)
                    remaining -= read
                }
                val trailer = ByteArray(TRAILER_LENGTH)
                handle.readFully(trailer)
                val hash = digest.digest()
                require(hash.contentEquals(trailer))
                val index = read(handle, size)
                require(index.kind == kind)
                hash.joinToString("") { "%02x".format(it) } to index
            }
        }

    /** The index of a stored pack, which was verified when it arrived. */
    fun index(file: File): OfflinePackIndex = checked {
        RandomAccessFile(file, "r").use { read(it, it.length()) }
    }

    /** An entry's body, exactly as its route serves it. */
    fun body(entry: OfflinePackEntry, file: File): ByteArray = checked {
        RandomAccessFile(file, "r").use { handle ->
            handle.seek(entry.offset)
            ByteArray(entry.length).also(handle::readFully)
        }
    }

    private fun read(handle: RandomAccessFile, size: Long): OfflinePackIndex {
        handle.seek(0)
        val header = ByteArray(HEADER_LENGTH).also(handle::readFully)
        require(String(header, 0, 4, Charsets.US_ASCII) == "TFPK")
        val fields = ByteBuffer.wrap(header, 4, HEADER_LENGTH - 4).order(ByteOrder.LITTLE_ENDIAN)
        require(fields.short.toInt() and 0xffff == VERSION)
        val kind = OfflinePackKind.of(fields.get().toInt() and 0xff)!!
        require(fields.get().toInt() == 0)
        val count = fields.int.toLong() and 0xffff_ffffL
        val indexLength = fields.int.toLong() and 0xffff_ffffL
        val dataLength = fields.long
        require(fields.long == 0L && count <= MAXIMUM_ENTRIES && dataLength >= 0)
        require(HEADER_LENGTH + indexLength + dataLength + TRAILER_LENGTH == size)
        val records =
            ByteBuffer.wrap(ByteArray(indexLength.toInt()).also(handle::readFully))
                .order(ByteOrder.LITTLE_ENDIAN)
        val dataStart = HEADER_LENGTH + indexLength
        val entries = LinkedHashMap<String, OfflinePackEntry>()
        var next = 0L
        repeat(count.toInt()) {
            val nameLength = records.short.toInt() and 0xffff
            require(nameLength in 1..MAXIMUM_NAME_BYTES)
            val name = utf8(ByteArray(nameLength).also(records::get))
            val typeLength = records.get().toInt() and 0xff
            require(typeLength > 0)
            val type = ascii(ByteArray(typeLength).also(records::get))
            val encodingLength = records.get().toInt() and 0xff
            val encoding = ascii(ByteArray(encodingLength).also(records::get))
            val offset = records.long
            val length = records.int.toLong() and 0xffff_ffffL
            require(offset == next && !entries.containsKey(name))
            next += length
            require(next <= dataLength)
            entries[name] =
                OfflinePackEntry(
                    name,
                    type,
                    encoding.ifEmpty { null },
                    dataStart + offset,
                    length.toInt(),
                )
        }
        require(!records.hasRemaining() && next == dataLength)
        return OfflinePackIndex(kind, entries)
    }

    private fun utf8(bytes: ByteArray): String =
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()

    /** Printable ASCII, as content types and encodings are. */
    private fun ascii(bytes: ByteArray): String {
        require(bytes.all { it in 0x20..0x7e })
        return String(bytes, Charsets.US_ASCII)
    }

    /**
     * The body a gzip member holds. Pack entries keep their stored compression, while the renderer
     * receives bodies as the platform's HTTP stack delivers them, decoded.
     */
    fun gunzip(bytes: ByteArray): ByteArray = checked {
        GZIPInputStream(ByteArrayInputStream(bytes)).use { stream ->
            val output = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(1 shl 14)
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
                require(output.size() <= MAXIMUM_BYTES)
            }
            output.toByteArray()
        }
    }

    private inline fun <T> checked(block: () -> T): T =
        try {
            block()
        } catch (error: TileflowOfflineException) {
            throw error
        } catch (_: Exception) {
            throw invalid()
        }
}

/** A tile's address. */
internal data class OfflineTileId(val z: Int, val x: Int, val y: Int) {
    val name: String
        get() = "$z/$x/$y"

    /** The tile's ancestor at [zoom], which is at most its own zoom. */
    fun ancestor(zoom: Int): OfflineTileId = OfflineTileId(zoom, x shr (z - zoom), y shr (z - zoom))

    companion object {
        /** A pack entry's name, `z/x/y` in decimal without leading zeros. */
        fun ofName(name: String): OfflineTileId? {
            val parts = name.split("/")
            if (parts.size != 3) return null
            val z = number(parts[0]) ?: return null
            val x = number(parts[1]) ?: return null
            val y = number(parts[2]) ?: return null
            if (z > OfflineZooms.MAXIMUM || x >= 1 shl z || y >= 1 shl z) return null
            return OfflineTileId(z, x, y)
        }

        fun number(text: String): Int? {
            if (text.isEmpty() || text.length > 7 || !text.all { it in '0'..'9' }) return null
            if (text != "0" && text.startsWith("0")) return null
            return text.toInt()
        }
    }
}

/** The service's fixed zoom bands: a tile pack holds one anchor's covered tiles within its band. */
internal object OfflinePackBand {
    val anchors = listOf(0, 7, 11, 16, 21)

    /** The anchor zoom of the band holding [zoom]. */
    fun anchor(zoom: Int): Int = anchors.last { it <= zoom }

    /** The zooms of the band anchored at [anchor], or null when no band is. */
    fun zooms(anchor: Int): IntRange? {
        val index = anchors.indexOf(anchor)
        if (index < 0) return null
        val end = if (index + 1 < anchors.size) anchors[index + 1] - 1 else OfflineZooms.MAXIMUM
        return anchor..end
    }
}

/** A source's tile URL template with `{z}`, `{x}` and `{y}`, read in both directions. */
internal class OfflineTileTemplate private constructor(
    val text: String,
    /** The literal runs around the placeholders, and the placeholders in order. */
    private val literals: List<String>,
    private val order: List<Char>,
) {
    override fun equals(other: Any?): Boolean = other is OfflineTileTemplate && other.text == text

    override fun hashCode(): Int = text.hashCode()

    fun url(tile: OfflineTileId): URI =
        URI(
            text
                .replace("{z}", tile.z.toString())
                .replace("{x}", tile.x.toString())
                .replace("{y}", tile.y.toString())
        )

    /** The tile a URL this template produced addresses. */
    fun tile(url: String): OfflineTileId? {
        if (!url.startsWith(literals[0])) return null
        var rest = url.substring(literals[0].length)
        val values = mutableMapOf<Char, Int>()
        for ((index, name) in order.withIndex()) {
            val digits = rest.takeWhile { it in '0'..'9' }
            values[name] = OfflineTileId.number(digits) ?: return null
            rest = rest.substring(digits.length)
            val literal = literals[index + 1]
            if (!rest.startsWith(literal)) return null
            rest = rest.substring(literal.length)
        }
        if (rest.isNotEmpty()) return null
        val z = values.getValue('z')
        val x = values.getValue('x')
        val y = values.getValue('y')
        if (z > OfflineZooms.MAXIMUM || x >= 1 shl z || y >= 1 shl z) return null
        return OfflineTileId(z, x, y)
    }

    companion object {
        fun of(text: String): OfflineTileTemplate? {
            val literals = mutableListOf<String>()
            val order = mutableListOf<Char>()
            var rest = text
            while (true) {
                val open = rest.indexOf('{')
                if (open < 0) break
                if (open + 2 >= rest.length || rest[open + 2] != '}') return null
                val name = rest[open + 1]
                if (name !in "zxy" || name in order) return null
                literals += rest.substring(0, open)
                order += name
                rest = rest.substring(open + 3)
            }
            literals += rest
            // Adjacent placeholders cannot be told apart in a URL.
            if (order.size != 3) return null
            if (literals.drop(1).dropLast(1).any { it.isEmpty() }) return null
            if (literals.drop(1).any { it.firstOrNull()?.let { c -> c in '0'..'9' } == true }) return null
            return OfflineTileTemplate(text, literals, order)
        }
    }
}
