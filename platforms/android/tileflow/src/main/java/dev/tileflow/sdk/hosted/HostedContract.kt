package dev.tileflow.sdk.hosted

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.transport.ResourcePolicy
import java.net.URI
import java.net.URLDecoder
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeFormatterBuilder
import org.json.JSONArray
import org.json.JSONObject

internal class HostedAuthority(
    val grant: String,
    val serverTime: Long,
    val expiresAt: Long,
    val origins: Set<String>,
    val scopes: Set<String>,
    val tilesets: Set<String>,
)

/** Native-delivery authority is validated independently of the renderer bridge. */
internal object HostedContract {
    private val keys =
        setOf(
            "ok",
            "kind",
            "version",
            "usageMode",
            "counted",
            "grant",
            "mapId",
            "sessionId",
            "surfaceId",
            "credentialId",
            "credentialRevision",
            "deliveryPolicyRevision",
            "issuedAt",
            "serverTime",
            "expiresAt",
            "meterMode",
            "disposition",
            "resourceOrigins",
            "resourceScopes",
            "tilesetIds",
        )
    private val scopes = setOf("style", "tilejson", "tile", "sprite", "glyph", "font")
    private val instantFormat = DateTimeFormatterBuilder().appendInstant(3).toFormatter()

    fun parse(
        bytes: ByteArray,
        mapId: String,
        sessionId: String,
        surfaceId: String,
    ): HostedAuthority {
        try {
            val value = json(bytes)
            require(value.keys().asSequence().toSet() == keys)
            require(value.opt("ok") == true && value.opt("kind") == "native")
            require(
                value.opt("version") is Number && (value.opt("version") as Number).toDouble() == 1.0
            )
            require(value.opt("usageMode") == "session" && value.opt("counted") == false)
            require(
                value.opt("mapId") == mapId &&
                    value.opt("sessionId") == sessionId &&
                    value.opt("surfaceId") == surfaceId
            )
            require(Regex("^key_[A-Za-z0-9_-]{8,80}$").matches(string(value, "credentialId")))
            require(
                revision(value.opt("credentialRevision")) &&
                    revision(value.opt("deliveryPolicyRevision"))
            )
            val grant = string(value, "grant")
            require(
                grant.length <= 24_576 &&
                    Regex("^tf_native_v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$").matches(grant)
            )
            val meter = string(value, "meterMode")
            val disposition = string(value, "disposition")
            require(meter in setOf("disabled", "shadow", "enforced"))
            require(disposition in setOf("unmetered", "ordinary", "unbilled_fail_open"))
            require(disposition != "unmetered" || meter == "disabled")
            val issued = date(string(value, "issuedAt"))
            val server = date(string(value, "serverTime"))
            val expires = date(string(value, "expiresAt"))
            require(
                issued - server <= 30_000 &&
                    expires > server &&
                    expires > issued &&
                    expires - issued <= 900_000
            )
            val origins = strings(value.opt("resourceOrigins"), 1..2)
            require(origins.all(::canonicalOrigin))
            val resourceScopes = strings(value.opt("resourceScopes"), 1..6)
            require(scopes.containsAll(resourceScopes))
            val tilesets = strings(value.opt("tilesetIds"), 0..18)
            require(
                tilesets.all { Regex("^[A-Za-z0-9._:-]{1,255}$").matches(it) && !secretShaped(it) }
            )
            return HostedAuthority(grant, server, expires, origins, resourceScopes, tilesets)
        } catch (_: Exception) {
            throw TileflowMapException(TileflowErrorCode.INVALID_SESSION_RESPONSE)
        }
    }

    /**
     * Only these 429 bodies mean the Map or Team is out of quota; any other 429 is rate limiting.
     */
    private val quotaCodes =
        setOf("COMMERCIAL_MAP_LIMIT_REACHED", "COMMERCIAL_SPENDING_LIMIT_REACHED")

    /** These will not succeed again without a change outside the device. */
    val terminalCodes =
        setOf(
            TileflowErrorCode.CREDENTIAL_REJECTED,
            TileflowErrorCode.ACCESS_DENIED,
            TileflowErrorCode.QUOTA_EXCEEDED,
        )

    /** Classifies a failed bootstrap or granted resource response. */
    fun failure(status: Int, bytes: ByteArray): TileflowErrorCode =
        when (status) {
            401 -> TileflowErrorCode.CREDENTIAL_REJECTED
            403,
            404 -> TileflowErrorCode.ACCESS_DENIED
            429 ->
                if (runCatching { json(bytes).opt("code") as? String }.getOrNull() in quotaCodes)
                    TileflowErrorCode.QUOTA_EXCEEDED
                else TileflowErrorCode.RATE_LIMITED
            408,
            in 500..599 -> TileflowErrorCode.SESSION_UNAVAILABLE
            else -> TileflowErrorCode.INVALID_SESSION_RESPONSE
        }

    /** Delta-seconds or an HTTP date, bounded so a hostile value cannot park the session. */
    fun retryAfterMillis(value: String?, nowMillis: Long): Long? {
        if (value == null || value.length > 64) return null
        val text = value.trim()
        val delay =
            if (Regex("^[0-9]{1,10}$").matches(text)) text.toLong() * 1_000
            else
                runCatching {
                        ZonedDateTime.parse(text, DateTimeFormatter.RFC_1123_DATE_TIME)
                            .toInstant()
                            .toEpochMilli() - nowMillis
                    }
                    .getOrNull() ?: return null
        return delay.coerceIn(0, 900_000)
    }

    fun isRestart(bytes: ByteArray, sessionId: String): Boolean = runCatching {
        val value = json(bytes)
        value.keys().asSequence().toSet() ==
            setOf("code", "error", "retryWithNewSession", "sessionId") &&
            value.opt("code") == "COMMERCIAL_SESSION_RESTART_REQUIRED" &&
            value.opt("retryWithNewSession") == true &&
            value.opt("sessionId") == sessionId &&
            string(value, "error").length in 1..500
    }
        .getOrDefault(false)

    fun canonicalOrigin(value: String): Boolean = runCatching {
        val url = URI(value)
        value.length <= 2048 &&
            value.all { it.code in 33..126 } &&
            url.scheme == "https" &&
            !url.host.isNullOrEmpty() &&
            url.userInfo == null &&
            url.rawQuery == null &&
            url.rawFragment == null &&
            url.rawPath.isEmpty() &&
            value == ResourcePolicy.origin(url)
    }
        .getOrDefault(false)

    /** Exact resource classes and signed recipients only; the server revalidates current access. */
    fun permits(url: URI, mapId: String, authority: HostedAuthority): Boolean = runCatching {
        ResourcePolicy(authority.origins).validate(url)
        require(!secretShaped(url.toString()))
        val allowed =
            setOf("map", "mapId", "archiveVersion", "worldReleaseId", "worldDescriptorSha256")
        val keys = mutableSetOf<String>()
        url.rawQuery?.split('&')?.forEach {
            val parts = it.split('=', limit = 2)
            require(parts.size == 2)
            val key = URLDecoder.decode(parts[0], "UTF-8")
            val value = URLDecoder.decode(parts[1], "UTF-8")
            require(key in allowed && keys.add(key) && value.length in 1..256)
            require(value.none { char -> char.code <= 32 || char.code == 127 || char == '\\' })
            if (key == "map" || key == "mapId") require(value == mapId)
        }
        val raw = url.rawPath
        val path = url.path
        require(!Regex("(?i)%2f|%5c|%00").containsMatchIn(raw))
        require(path.split('/').none { it == "." || it == ".." })
        require(path.none { it.code < 32 || it.code == 127 || it == '\\' })
        val style =
            Regex(
                    "^/maps/(map_[A-Za-z0-9_-]{16})/mobile/webview-v1/v([1-9][0-9]{0,15})/[A-Za-z][A-Za-z0-9_-]{0,63}\\.json$"
                )
                .matchEntire(path)
        if (style != null)
            return@runCatching raw == path &&
                url.rawQuery == null &&
                style.groupValues[1] == mapId &&
                (style.groupValues[2].toLongOrNull() ?: Long.MAX_VALUE) <= 9_007_199_254_740_991 &&
                "style" in authority.scopes
        val tilejson =
            Regex("^/(?:v1/)?tiles/([A-Za-z0-9_-]{1,128})/tiles\\.json$").matchEntire(path)
        if (tilejson != null)
            return@runCatching "tilejson" in authority.scopes &&
                tilejson.groupValues[1] in authority.tilesets
        val tile =
            Regex(
                    "^/(?:v1/)?tiles/([A-Za-z0-9_-]{1,128})/(?:[A-Za-z0-9._-]{1,128}/)?[0-9]{1,2}/[0-9]{1,10}/[0-9]{1,10}\\.(?:pbf|mvt|png|jpg|jpeg|webp|avif)$"
                )
                .matchEntire(path)
        if (tile != null)
            return@runCatching "tile" in authority.scopes &&
                tile.groupValues[1] in authority.tilesets
        if (Regex("^/sprites/[A-Za-z0-9_-]{1,128}/sprite(?:@2x)?\\.(?:json|png)$").matches(path)) {
            return@runCatching "sprite" in authority.scopes
        }
        if (
            Regex("^/fonts/[\\p{L}\\p{N} _.,-]{1,256}/[0-9]{1,6}-[0-9]{1,6}\\.pbf$")
                .matches(path) ||
                Regex(
                        "^/base/[0-9a-f]{64}/(?:manifest\\.json|glyphs/[\\p{L}\\p{N} _.,-]{1,256}/(?:LICENSE\\.md|[0-9]{1,6}-[0-9]{1,6}\\.pbf))$"
                    )
                    .matches(path)
        ) {
            return@runCatching "glyph" in authority.scopes
        }
        "font" in authority.scopes &&
            Regex("^/font-bundles/fnb_[A-Za-z0-9_-]{16,64}/[A-Za-z0-9_./-]{1,512}$").matches(path)
    }
        .getOrDefault(false)

    fun secretShaped(value: String): Boolean =
        Regex("tf_native_|tf_public_", RegexOption.IGNORE_CASE).containsMatchIn(value)

    private fun string(value: JSONObject, key: String): String =
        value.opt(key) as? String ?: error("Invalid field.")

    private fun revision(value: Any?): Boolean =
        value is Number &&
            value.toDouble().let {
                it > 0 && it <= 9_007_199_254_740_991.0 && it == kotlin.math.floor(it)
            }

    private fun strings(value: Any?, count: IntRange): Set<String> {
        require(value is JSONArray && value.length() in count)
        val result =
            (0 until value.length()).map { value.get(it) as? String ?: error("Invalid field.") }
        require(result.toSet().size == result.size)
        return result.toSet()
    }

    private fun date(value: String): Long {
        require(Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$").matches(value))
        val parsed = Instant.parse(value)
        require(instantFormat.format(parsed) == value)
        return parsed.toEpochMilli()
    }

    private fun json(bytes: ByteArray): JSONObject {
        require(bytes.size <= 65_536)
        val text =
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        return JSONObject(text)
    }
}
