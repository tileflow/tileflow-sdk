package dev.tileflow.sdk.bridge

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import org.json.JSONObject

/**
 * Payloads too large for protocol messages, such as GeoJSON, served to one renderer generation
 * through the native transport at `https://tileflow.invalid/data/<id>`.
 *
 * A request registers its payloads before it is sent and releases them when it settles, so data
 * lives only while the renderer may read it. Identifiers are random and single-generation; equal
 * payloads in flight share one entry. Retiring the generation releases everything. The bridge
 * registers on the UI thread while WebView reads on its own threads, so access is synchronized.
 */
internal class DataChannel {
    data class Reference(val id: String, val byteLength: Int, val sha256: String) {
        fun json(): JSONObject =
            JSONObject().put("id", id).put("byteLength", byteLength).put("sha256", sha256)
    }

    class Payload(val bytes: ByteArray, val contentType: String)

    private class Entry(val reference: Reference, val payload: Payload, var holds: Int)

    private val entries = mutableMapOf<String, Entry>()
    private val identifiers = mutableMapOf<String, String>()
    private var totalBytes = 0L
    private var retired = false
    private val random = SecureRandom()

    /** Registers a payload for one request. Release the reference when the request settles. */
    @Synchronized
    fun register(bytes: ByteArray, digest: String, contentType: String): Reference {
        if (retired) throw TileflowMapException(TileflowErrorCode.CANCELLED)
        if (bytes.isEmpty() || bytes.size > ProtocolContract.MAXIMUM_DATA_BYTES)
            throw tooLarge(ProtocolContract.MAXIMUM_DATA_BYTES)
        identifiers[digest]?.let(entries::get)?.let {
            it.holds += 1
            return it.reference
        }
        if (totalBytes + bytes.size > ProtocolContract.MAXIMUM_DATA_TOTAL_BYTES)
            throw tooLarge(ProtocolContract.MAXIMUM_DATA_TOTAL_BYTES)
        if (entries.size >= ProtocolContract.MAXIMUM_DATA_REFERENCES)
            throw tooLarge(ProtocolContract.MAXIMUM_DATA_REFERENCES)
        val id =
            Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(ByteArray(16).also(random::nextBytes))
        val reference = Reference(id, bytes.size, digest)
        entries[id] = Entry(reference, Payload(bytes, contentType), 1)
        identifiers[digest] = id
        totalBytes += bytes.size
        return reference
    }

    @Synchronized
    fun release(references: Iterable<Reference>) {
        for (reference in references) {
            val entry = entries[reference.id] ?: continue
            entry.holds -= 1
            if (entry.holds > 0) continue
            entries.remove(reference.id)
            identifiers.remove(reference.sha256)
            totalBytes -= entry.payload.bytes.size
        }
    }

    /** The payload the transport serves, or null once released. */
    @Synchronized
    fun payload(id: String): Payload? = if (retired) null else entries[id]?.payload

    val isEmpty: Boolean
        @Synchronized get() = entries.isEmpty()

    @Synchronized
    fun retire() {
        retired = true
        entries.clear()
        identifiers.clear()
        totalBytes = 0
    }

    companion object {
        /** The SHA-256 digest the renderer verifies, in lowercase hexadecimal. */
        fun digest(bytes: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {
                "%02x".format(it)
            }

        private fun tooLarge(limit: Int) =
            TileflowMapException(
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorContext.of(ProtocolContract.ErrorReason.DATA_TOO_LARGE, limit),
            )
    }
}
