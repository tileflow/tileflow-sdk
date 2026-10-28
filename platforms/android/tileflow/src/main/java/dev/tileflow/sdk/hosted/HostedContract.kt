@file:OptIn(TileflowInternalApi::class)

package dev.tileflow.sdk.hosted

import dev.tileflow.configuration.internal.TileflowInternalApi
import dev.tileflow.configuration.internal.tileflowApiOrigin
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

/** How a protected resource's response changes the session. */
internal enum class ResourceReaction {
    NONE,
    /** Discard the grant, bootstrap once and retry the request. */
    REFRESH,
    /** The Map has a newer deployment; reload its discovery and styles. */
    SUPERSEDED,
    /** Wait for `Retry-After`, then retry; this is not quota exhaustion. */
    RATE_LIMITED,
    /** The Map's quota is exhausted; the session ends. */
    QUOTA,
}

internal class HostedAuthority(
    val grant: String,
    val serverTime: Long,
    val expiresAt: Long,
    val origins: Set<String>,
    val scopes: Set<String>,
    val tilesets: Set<String>,
    /** The session of a local development API, whose resource origins may be loopback `http`. */
    val allowsLoopbackHttp: Boolean = false,
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

    /** With [allowsLoopbackHttp], a local development API may grant loopback `http` origins. */
    fun parse(
        bytes: ByteArray,
        mapId: String,
        sessionId: String,
        surfaceId: String,
        allowsLoopbackHttp: Boolean = false,
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
            require(origins.all { canonicalOrigin(it, allowsLoopbackHttp) })
            val resourceScopes = strings(value.opt("resourceScopes"), 1..6)
            require(scopes.containsAll(resourceScopes))
            val tilesets = strings(value.opt("tilesetIds"), 0..18)
            require(
                tilesets.all { Regex("^[A-Za-z0-9._:-]{1,255}$").matches(it) && !secretShaped(it) }
            )
            return HostedAuthority(
                grant,
                server,
                expires,
                origins,
                resourceScopes,
                tilesets,
                allowsLoopbackHttp,
            )
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
            TileflowErrorCode.SESSION_REJECTED,
        )

    /**
     * Classifies a failed bootstrap, with the service's reason code for
     * [TileflowErrorCode.SESSION_REJECTED].
     */
    fun rejection(status: Int, bytes: ByteArray): TileflowMapException =
        failure(status, bytes).let {
            TileflowMapException(
                it,
                if (it == TileflowErrorCode.SESSION_REJECTED) errorCode(bytes) else null,
            )
        }

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
            // Any other refusal, such as a Map without session delivery or a conflicting header,
            // repeats until something outside the device changes.
            in 400..499 -> TileflowErrorCode.SESSION_REJECTED
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

    /**
     * An `https` origin in canonical form. With [allowsLoopbackHttp], also an `http` origin that
     * the configuration accepts, which is one on a loopback host.
     */
    fun canonicalOrigin(value: String, allowsLoopbackHttp: Boolean = false): Boolean = runCatching {
        val url = URI(value)
        value.length <= 2048 &&
            value.all { it.code in 33..126 } &&
            (url.scheme == "https" ||
                (allowsLoopbackHttp &&
                    url.scheme == "http" &&
                    tileflowApiOrigin(url)?.toString() == value)) &&
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
        ResourcePolicy(authority.origins, authority.allowsLoopbackHttp).validate(url)
        require(!secretShaped(url.toString()))
        val allowed =
            setOf("map", "mapId", "archiveVersion", "worldReleaseId", "worldDescriptorSha256") +
                releaseSelectors.keys
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
        // A pinned data product's release selector belongs only to that product's TileJSON.
        val pinned = keys.mapNotNull(releaseSelectors::get)
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
        val tileset =
            when {
                demTileJson.matches(path) -> "tilejson" to "bathymetry-dem"
                demTile.matches(path) -> "tile" to "bathymetry-dem"
                else ->
                    tileJson.matchEntire(path)?.let { "tilejson" to it.groupValues[1] }
                        ?: tile.matchEntire(path)?.let { "tile" to it.groupValues[1] }
            }
        if (tileset != null)
            return@runCatching tileset.first in authority.scopes &&
                tileset.second in authority.tilesets &&
                pinned.all { tileset.first == "tilejson" && tileset.second in it }
        require(pinned.isEmpty())
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

    /**
     * Landmarks and Team models are public web resources on the API origin: a Map's view already
     * counts its session, so they never carry a grant and are admitted by exact path only.
     */
    fun isPublicApiResource(url: URI): Boolean =
        url.rawQuery == null &&
            url.rawFragment == null &&
            url.rawUserInfo == null &&
            publicApiPaths.any { it.matches(url.rawPath ?: "") }

    /** A Team model's stable address redirects once to its current version's immutable file. */
    fun redirect(from: URI, location: String?, apiOrigin: URI): URI? = runCatching {
        val model = currentModel.matchEntire(from.rawPath)
        if (
            model == null ||
                ResourcePolicy.origin(from) != ResourcePolicy.origin(apiOrigin) ||
                location == null ||
                location.length > 2048
        )
            return@runCatching null
        val target = from.resolve(location)
        val version = modelVersion.matchEntire(target.rawPath ?: "")
        target.takeIf {
            ResourcePolicy.origin(it) == ResourcePolicy.origin(apiOrigin) &&
                isPublicApiResource(it) &&
                version?.groupValues?.get(1) == model.groupValues[1]
        }
    }
        .getOrNull()

    /** A Map deployment's versioned WebView style, which a later deployment supersedes. */
    fun isVersionedStyle(url: URI): Boolean = versionedStyle.matches(url.rawPath ?: "")

    /** The `code` of a delivery failure body, when it has a well-formed one. */
    fun errorCode(bytes: ByteArray): String? = runCatching {
        require(bytes.size <= 4096)
        (json(bytes).opt("code") as? String)?.takeIf { Regex("^[A-Z][A-Z0-9_]{0,63}$").matches(it) }
    }
        .getOrNull()

    /**
     * Only bootstrap is authoritative: a grant the service no longer accepts is renewed once, and
     * a superseded deployment reloads.
     */
    fun reaction(status: Int, bytes: ByteArray, url: URI, refreshed: Boolean): ResourceReaction {
        val code = errorCode(bytes)
        val style = isVersionedStyle(url)
        return when {
            status == 401 -> if (refreshed) ResourceReaction.NONE else ResourceReaction.REFRESH
            // Before the service reported superseded deployments distinctly, it denied them.
            status == 403 && code == "NATIVE_GRANT_RESOURCE_DENIED" ->
                if (style) ResourceReaction.SUPERSEDED else ResourceReaction.NONE
            // A binding mismatch can be a credential or policy revision that a new grant repairs.
            status == 403 ->
                when {
                    !refreshed -> ResourceReaction.REFRESH
                    style -> ResourceReaction.SUPERSEDED
                    else -> ResourceReaction.NONE
                }
            status == 409 -> if (style) ResourceReaction.SUPERSEDED else ResourceReaction.NONE
            status == 429 ->
                if (failure(status, bytes) == TileflowErrorCode.QUOTA_EXCEEDED)
                    ResourceReaction.QUOTA
                else ResourceReaction.RATE_LIMITED
            else -> ResourceReaction.NONE
        }
    }

    private val releaseSelectors =
        mapOf(
            "boundariesReleaseId" to setOf("boundaries"),
            "bathymetryReleaseId" to setOf("bathymetry", "bathymetry-dem"),
            "nauticalReleaseId" to setOf("nautical"),
        )
    private val tileJson = Regex("^/(?:v1/)?tiles/([A-Za-z0-9_-]{1,128})/tiles\\.json$")
    private val tile =
        Regex(
            "^/(?:v1/)?tiles/([A-Za-z0-9_-]{1,128})/(?:[A-Za-z0-9._-]{1,128}/)?[0-9]{1,2}/[0-9]{1,10}/[0-9]{1,10}\\.(?:pbf|mvt|png|jpg|jpeg|webp|avif)$"
        )
    private val demTileJson = Regex("^/(?:v1/)?tiles/bathymetry/dem/tiles\\.json$")
    private val demTile =
        Regex(
            "^/(?:v1/)?tiles/bathymetry/dem/[A-Za-z0-9._-]{1,128}/[0-9]{1,2}/[0-9]{1,10}/[0-9]{1,10}\\.(?:pbf|mvt|png|jpg|jpeg|webp|avif)$"
        )
    private val versionedStyle =
        Regex(
            "^/maps/map_[A-Za-z0-9_-]{16}/mobile/webview-v1/v[1-9][0-9]{0,15}/[A-Za-z][A-Za-z0-9_-]{0,63}\\.json$"
        )
    private val currentModel = Regex("^/team-models/(tmd_[A-Za-z0-9_-]{16,76})/current\\.glb$")
    private val modelVersion =
        Regex("^/team-models/(tmd_[A-Za-z0-9_-]{16,76})/versions/tmv_[A-Za-z0-9_-]{16,76}\\.glb$")
    private val publicApiPaths =
        listOf(
            Regex("^/landmarks/tiles\\.json$"),
            Regex(
                "^/landmarks/releases/[0-9a-f]{64}/regions/6/(?:0|[1-9][0-9]{0,4})/(?:0|[1-9][0-9]{0,4})\\.json$"
            ),
            Regex("^/landmarks/releases/[0-9a-f]{64}/NOTICE\\.md$"),
            Regex("^/landmarks/tiles/[0-9a-f]{64}\\.glb$"),
            currentModel,
            modelVersion,
        )

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
