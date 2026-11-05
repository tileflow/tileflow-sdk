package dev.tileflow.sdk.model

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.bridge.ProtocolContract
import java.security.SecureRandom
import java.util.Base64
import org.json.JSONObject

/**
 * Payloads held by one map generation while its commands run. Equal digests share one entry;
 * references are random and stay valid until their last request releases them or the map retires.
 */
internal class MapPayloadStore {
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
    @Synchronized fun payload(id: String): Payload? = if (retired) null else entries[id]?.payload

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
        private fun tooLarge(limit: Int) =
            TileflowMapException(
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorContext.of(ProtocolContract.ErrorReason.DATA_TOO_LARGE, limit),
            )
    }
}
