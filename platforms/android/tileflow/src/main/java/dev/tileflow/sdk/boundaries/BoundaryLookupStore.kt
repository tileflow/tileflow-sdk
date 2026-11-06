package dev.tileflow.sdk.boundaries

import android.content.Context
import dev.tileflow.sdk.LoadableMapSource
import dev.tileflow.sdk.TileflowBoundaryClass
import dev.tileflow.sdk.isSafeBoundaryInteger
import dev.tileflow.sdk.transport.ResourceDigest
import dev.tileflow.sdk.transport.ResourcePolicy
import java.io.DataOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.RandomAccessFile
import java.net.URI
import java.net.URLDecoder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Complete, verified class archives for one map. Independent of the map's HTTP cache and packs. */
internal class BoundaryLookupStore private constructor(
    private val directory: File,
    private val scope: String,
    private val hosted: Boolean,
) {
    data class Record(val bytes: ByteArray, val rows: Long)

    fun key(descriptor: BoundaryLookupDescriptor, boundaryClass: TileflowBoundaryClass): String =
        digest(
            scope,
            descriptor.releaseId,
            descriptor.manifestSha256,
            stableAddress(URI(descriptor.sourceUrl), hosted),
            descriptor.manifestUrl?.let { stableAddress(it, hosted) },
            boundaryClass.wireName,
            stableAddress(descriptor.urls.getValue(boundaryClass), hosted),
        )

    fun read(key: String): Record? {
        try {
            RandomAccessFile(file(key), "r").use { input ->
                val length = input.length()
                if (length <= FOOTER_BYTES ||
                    length > MAXIMUM_ARCHIVE_BYTES + MAXIMUM_METADATA_BYTES + FOOTER_BYTES
                ) return null

                input.seek(length - FOOTER_BYTES)
                val metadataSize = input.readInt()
                if (input.readInt() != MAGIC || metadataSize !in 1..MAXIMUM_METADATA_BYTES)
                    return null
                val bodySize = length - FOOTER_BYTES - metadataSize
                if (bodySize !in 1..MAXIMUM_ARCHIVE_BYTES.toLong()) return null

                input.seek(bodySize)
                val encodedMetadata = ByteArray(metadataSize).also(input::readFully)
                val metadata = JSONObject(encodedMetadata.decodeToString(throwOnInvalidSequence = true))
                if (metadata.opt("key") != key ||
                    (metadata.opt("version") as? Number)?.toDouble() != 1.0 ||
                    (metadata.opt("bytes") as? Number)?.toDouble() != bodySize.toDouble()
                ) return null
                val rows = (metadata.opt("rows") as? Number)?.toDouble()
                    ?.takeIf { it.isSafeBoundaryInteger() && it >= 0 } ?: return null

                input.seek(0)
                val bytes = ByteArray(bodySize.toInt()).also(input::readFully)
                if (metadata.opt("sha256") != ResourceDigest.sha256(bytes)) return null
                return Record(bytes, rows.toLong())
            }
        } catch (_: IOException) {
            return null
        } catch (_: JSONException) {
            return null
        }
    }

    fun write(key: String, record: Record): Boolean {
        val bytes = record.bytes
        require(bytes.size in 1..MAXIMUM_ARCHIVE_BYTES)
        val metadata = JSONObject()
            .put("version", 1)
            .put("key", key)
            .put("bytes", bytes.size)
            .put("rows", record.rows)
            .put("sha256", ResourceDigest.sha256(bytes))
            .toString().encodeToByteArray()

        return try {
            if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) return false
            val pending = File.createTempFile(".lookup-", ".tmp", directory)
            try {
                FileOutputStream(pending).use { stream ->
                    val output = DataOutputStream(stream)
                    output.write(bytes)
                    output.write(metadata)
                    output.writeInt(metadata.size)
                    output.writeInt(MAGIC)
                    output.flush()
                    stream.fd.sync()
                }
                Files.move(pending.toPath(), file(key).toPath(), StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING)
                true
            } finally {
                pending.delete()
            }
        } catch (_: IOException) {
            false
        }
    }

    private fun file(key: String) = File(directory, "$key.lookup")

    companion object {
        const val MAXIMUM_ARCHIVE_BYTES = 16 * 1024 * 1024
        private const val MAXIMUM_METADATA_BYTES = 1024
        private const val FOOTER_BYTES = 8L
        private const val MAGIC = 0x5446424C // TFBL
        private val hostedSelectors = setOf("session", "sessionId", "surface", "surfaceId", "map", "mapId")

        fun forMap(context: Context, source: LoadableMapSource): BoundaryLookupStore =
            forMap(File(context.noBackupFilesDir, "dev.tileflow/boundary-lookups-v1"), source)

        fun forMap(directory: File, source: LoadableMapSource): BoundaryLookupStore {
            val endpoint = source.hosted
            val scope = if (endpoint != null) {
                digest("hosted", ResourcePolicy.origin(endpoint.apiOrigin), requireNotNull(source.mapId))
            } else {
                digest("selfHosted", stableAddress(source.manifestUrl, hosted = false), source.map)
            }
            return BoundaryLookupStore(directory, scope, hosted = endpoint != null)
        }

        private fun stableAddress(url: URI, hosted: Boolean): String {
            val address = url.toASCIIString()
            if (!hosted) return address
            val query = url.rawQuery ?: return address
            val retained = query.split('&').filterNot { part ->
                val name = URLDecoder.decode(part.substringBefore('='), "UTF-8")
                name in hostedSelectors
            }
            val base = address.substringBefore('?')
            return if (retained.isEmpty()) base else "$base?${retained.joinToString("&")}"
        }

        private fun digest(vararg parts: String?): String =
            ResourceDigest.sha256(JSONArray(parts.map { it ?: JSONObject.NULL }).toString().encodeToByteArray())
    }
}
