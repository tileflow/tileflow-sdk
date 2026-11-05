package dev.tileflow.sdk.transport

import java.security.MessageDigest

/** Lowercase SHA-256 used for resource addresses, stored records and in-flight payloads. */
internal object ResourceDigest {
    fun sha256(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
}
