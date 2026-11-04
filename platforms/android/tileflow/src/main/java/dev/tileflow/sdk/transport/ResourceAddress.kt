package dev.tileflow.sdk.transport

import java.net.URI
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.Base64

internal object ResourceAddress {
    const val ORIGIN = "https://tileflow.invalid"
    const val RUNTIME_URL = "$ORIGIN/runtime/index.html"

    fun encode(url: URI): URI {
        val token =
            Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(url.toASCIIString().toByteArray(Charsets.UTF_8))
        return URI("$ORIGIN/resource/$token")
    }

    fun decode(url: URI): URI {
        require(url.scheme == "https" && url.host == "tileflow.invalid" && url.port == -1)
        require(url.userInfo == null && url.rawQuery == null && url.rawFragment == null)
        require(url.rawPath.startsWith("/resource/"))
        val parts = url.rawPath.removePrefix("/resource/").split('/')
        require(parts.size == 1 || parts.size == 4)
        val token = parts[0]
        require(
            token.length in 1..8192 &&
                token.all {
                    it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it == '-' || it == '_'
                }
        )
        var text =
            Charsets.UTF_8.newDecoder()
                .decode(java.nio.ByteBuffer.wrap(Base64.getUrlDecoder().decode(token)))
                .toString()
        val remote = URI(text)
        require(encode(remote).toASCIIString() == "$ORIGIN/resource/$token")
        if (parts.size == 1) return remote
        val coordinates = parts.drop(1)
        require(coordinates.all { Regex("^(0|[1-9][0-9]{0,7})$").matches(it) })
        val (z, x, y) = coordinates.map(String::toInt)
        require(z <= 24 && x < (1 shl z) && y < (1 shl z))
        for ((axis, coordinate) in listOf("z", "x", "y").zip(coordinates)) {
            val placeholder = "%7B$axis%7D"
            require(text.contains(placeholder))
            text = text.replace(placeholder, coordinate)
        }
        return URI(text)
    }
}

/**
 * The addresses MapLibre Native requests and the SDK answers:
 * `https://tileflow.invalid/<context>/<origin>/<path>?<query>`, with the origin as base64url
 * without padding. The context names the mounted map that owns the request; it is random, carries
 * no credential and never leaves the process.
 *
 * The path and query are the remote resource's, so the engine's own substitutions
 * (`{z}/{x}/{y}`, `{fontstack}/{range}`, the suffixes it appends to a sprite) land where it would
 * put them on the remote address. The addresses are `https` because MapLibre Native on Android
 * completes no other scheme.
 */
internal object MapResourceAddress {
    const val HOST = "tileflow.invalid"
    const val PREFIX = "https://$HOST/"

    /** A self-hosted build keeps its family in the same generation as its theme styles. */
    fun familyUrl(style: String, map: String): String =
        resolve(style, "../../families/${URLEncoder.encode(map, "UTF-8").replace("+", "%20")}.json")

    private val absolute = Regex("^([A-Za-z][A-Za-z0-9+.-]*)://([^/?#]+)([^?#]*)(\\?[^#]*)?(#.*)?$")
    private val origin = Regex("^https?://[^/?#@\\s]+$")
    private val context = Regex("^[A-Za-z0-9_-]{22}$")
    private val token = Regex("^[A-Za-z0-9_-]{1,2048}$")
    private val random = SecureRandom()

    /** The address of an absolute `http` or `https` [remote] for [context], or null. */
    fun encode(remote: String, context: String): String? {
        val match = absolute.matchEntire(remote) ?: return null
        val scheme = match.groupValues[1].lowercase()
        val authority = match.groupValues[2]
        if ((scheme != "https" && scheme != "http") || '@' in authority) return null
        val path = match.groupValues[3].ifEmpty { "/" }
        return "$PREFIX$context/${base64("$scheme://$authority")}$path${match.groupValues[4]}"
    }

    /** The context and remote URL of an address, or null for any other URL. */
    fun decode(address: String): Pair<String, URI>? {
        if (!address.startsWith(PREFIX)) return null
        val rest = address.substring(PREFIX.length)
        val first = rest.indexOf('/')
        if (first < 0) return null
        val context = rest.substring(0, first)
        if (!this.context.matches(context)) return null
        val afterContext = rest.substring(first + 1)
        val end = afterContext.indexOfFirst { it == '/' || it == '?' }.let {
            if (it < 0) afterContext.length else it
        }
        val token = afterContext.substring(0, end)
        if (!this.token.matches(token)) return null
        val origin =
            runCatching { String(Base64.getUrlDecoder().decode(token), Charsets.UTF_8) }.getOrNull()
                ?: return null
        if (!this.origin.matches(origin) || base64(origin) != token) return null
        val tail = afterContext.substring(end).let { if (it.startsWith("/")) it else "/$it" }
        val remote = runCatching { URI(origin + tail) }.getOrNull() ?: return null
        return context to remote
    }

    /** Resolves [reference] against [base], keeping placeholders such as `{z}` or `{fontstack}`. */
    fun resolve(base: String, reference: String): String {
        if (absolute.matches(reference)) return reference
        fun escape(value: String) = value.replace("{", "%7B").replace("}", "%7D")
        fun unescape(value: String) = value.replace("%7B", "{").replace("%7D", "}")
        return runCatching {
                unescape(URI(escape(base)).resolve(URI(escape(reference))).toString())
            }
            .getOrDefault(reference)
    }

    /** A new random context: 16 bytes, base64url without padding. */
    fun newContext(): String {
        val bytes = ByteArray(16)
        random.nextBytes(bytes)
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun base64(text: String): String =
        Base64.getUrlEncoder().withoutPadding().encodeToString(text.toByteArray(Charsets.UTF_8))
}
