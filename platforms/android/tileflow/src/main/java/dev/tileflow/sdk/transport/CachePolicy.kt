package dev.tileflow.sdk.transport

import java.time.Instant
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/**
 * The `Cache-Control` directives a private client cache acts on (RFC 9111). Shared-cache
 * directives such as `s-maxage` and `proxy-revalidate` do not apply to the SDK's cache.
 */
internal data class CacheDirectives(
    val noStore: Boolean = false,
    val noCache: Boolean = false,
    val mustRevalidate: Boolean = false,
    val immutable: Boolean = false,
    val maxAge: Long? = null,
    val staleIfError: Long? = null,
) {
    companion object {
        fun parse(header: String?): CacheDirectives {
            var result = CacheDirectives()
            for (part in header?.split(',').orEmpty()) {
                val pair = part.split('=', limit = 2).map { it.trim() }
                val name = pair[0].lowercase()
                // An unreadable delta counts as zero, which makes the response stale.
                val seconds =
                    pair.getOrNull(1)?.trim('"')?.let { it.toLongOrNull()?.coerceAtLeast(0) ?: 0 }
                result =
                    when (name) {
                        "no-store" -> result.copy(noStore = true)
                        "no-cache" -> result.copy(noCache = true)
                        "must-revalidate" -> result.copy(mustRevalidate = true)
                        "immutable" -> result.copy(immutable = true)
                        "max-age" -> result.copy(maxAge = seconds ?: 0)
                        "stale-if-error" -> result.copy(staleIfError = seconds ?: 0)
                        else -> result
                    }
            }
            return result
        }
    }
}

/**
 * How the transport may store and reuse responses. Every decision is made natively from the
 * response headers; the renderer cannot influence what is stored.
 */
internal object ResourceCachePolicy {
    /** Headers kept with a stored response and replayed when it is served. */
    val storedHeaders =
        listOf(
            "Content-Type",
            "ETag",
            "Last-Modified",
            "Cache-Control",
            "Expires",
            "Date",
            "Age",
            "Tileflow-Fair-Use",
            "Tileflow-Fair-Use-Notice",
            "Tileflow-Protection",
        )

    /** The longest heuristic lifetime for a public response with only `Last-Modified`. */
    const val MAXIMUM_HEURISTIC_LIFETIME_MILLIS = 24L * 60 * 60 * 1000

    /**
     * How long past its lifetime a public response may still answer when the network fails, unless
     * it says otherwise with `stale-if-error`, `must-revalidate` or `no-cache`.
     */
    const val DEFAULT_STALE_IF_ERROR_MILLIS = 30L * 24 * 60 * 60 * 1000

    /**
     * Whether a complete response may be stored. Only GET 200 responses to requests without a
     * `Range` are stored, and `no-store` always wins.
     *
     * A public response without a lifetime or validator is still kept: it is refetched on every
     * use, but can answer when the network fails. A protected (granted) response needs an explicit
     * lifetime or a validator, and a `no-cache` response needs a validator to be useful.
     */
    fun isStorable(status: Int, headers: Map<String, String>, protected: Boolean): Boolean {
        if (status != 200) return false
        val directives = CacheDirectives.parse(headers["Cache-Control"])
        if (directives.noStore) return false
        if (headers["Vary"]?.split(',')?.any { it.trim() == "*" } == true) return false
        val explicit = directives.maxAge != null || headers["Expires"] != null
        val validator = headers["ETag"] != null || headers["Last-Modified"] != null
        if (directives.noCache) return validator
        return if (protected) explicit || validator else true
    }

    /** When a response stored at [responseTime] (epoch milliseconds) stops being fresh. */
    fun expiry(headers: Map<String, String>, responseTime: Long, protected: Boolean): Long {
        val directives = CacheDirectives.parse(headers["Cache-Control"])
        val age = (headers["Age"]?.toLongOrNull()?.coerceAtLeast(0) ?: 0) * 1000
        val date = headers["Date"]?.let(HttpDate::parse) ?: responseTime
        val maxAge = directives.maxAge
        val expires = headers["Expires"]
        val modified = headers["Last-Modified"]?.let(HttpDate::parse)
        val lifetime =
            when {
                directives.noCache -> 0
                maxAge != null -> maxAge * 1000
                expires != null ->
                    HttpDate.parse(expires)?.let { (it - date).coerceAtLeast(0) } ?: 0
                !protected && modified != null ->
                    minOf(
                        MAXIMUM_HEURISTIC_LIFETIME_MILLIS,
                        (date - modified).coerceAtLeast(0) / 10,
                    )
                else -> 0
            }
        return responseTime + lifetime - age
    }

    /**
     * The latest time a stored response may answer a request whose network attempt failed.
     * Protected responses are never served past their lifetime.
     */
    fun staleLimit(headers: Map<String, String>, expiry: Long, protected: Boolean): Long {
        val directives = CacheDirectives.parse(headers["Cache-Control"])
        if (protected || directives.noCache || directives.mustRevalidate) return expiry
        return expiry + (directives.staleIfError?.times(1000) ?: DEFAULT_STALE_IF_ERROR_MILLIS)
    }

    /** Conditional request headers for revalidating a stored response. */
    fun validators(headers: Map<String, String>): Map<String, String> = buildMap {
        headers["ETag"]?.let { put("If-None-Match", it) }
        headers["Last-Modified"]?.let { put("If-Modified-Since", it) }
    }

    /** The stored headers after a `304 Not Modified` refreshed them (RFC 9111 4.3.4). */
    fun merging(
        stored: Map<String, String>,
        notModified: Map<String, String>,
    ): Map<String, String> =
        stored +
            storedHeaders
                .filter { it != "Content-Type" }
                .mapNotNull { name -> notModified[name]?.let { name to it } }

    /** The subset of response headers kept with a stored response. */
    fun storable(headers: Map<String, String>): Map<String, String> =
        headers.filterKeys { it in storedHeaders }
}

/** IMF-fixdate parsing for `Date`, `Expires` and `Last-Modified`. */
internal object HttpDate {
    fun parse(value: String): Long? =
        runCatching {
                ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME)
                    .toInstant()
                    .toEpochMilli()
            }
            .getOrNull()

    fun format(millis: Long): String =
        DateTimeFormatter.RFC_1123_DATE_TIME.format(
            ZonedDateTime.ofInstant(Instant.ofEpochMilli(millis), ZoneOffset.UTC)
        )
}
