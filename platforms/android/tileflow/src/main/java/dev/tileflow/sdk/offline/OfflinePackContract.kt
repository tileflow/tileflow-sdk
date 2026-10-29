package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.hosted.HostedContract
import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * The signed authority of one Hosted pack: `tf_offline_v1.<payload>.<signature>`. The SDK cannot
 * verify it and never reads it; it sends it only to download the pack's own resources and to
 * revalidate. [toString] never includes it.
 */
internal class OfflinePackGrant private constructor(val value: String) {
    override fun equals(other: Any?): Boolean = other is OfflinePackGrant && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = "OfflinePackGrant(tf_offline_v1…)"

    companion object {
        private val pattern = Regex("^tf_offline_v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$")

        fun of(value: String): OfflinePackGrant? =
            value.takeIf { it.length <= 16_384 && pattern.matches(it) }?.let(::OfflinePackGrant)
    }
}

/** One non-tile resource of a pack. */
internal data class OfflinePackDocument(
    /**
     * `discovery`, `profile`, `style`, `tilejson`, `glyph`, `license`, `sprite`, `font` or
     * `landmark` today; the service may add kinds.
     */
    val kind: String,
    val url: URI,
    /** Exact bytes on the wire. */
    val bytes: Long,
    /** Lowercase hexadecimal SHA-256 of those bytes, when known before download. */
    val sha256: String?,
    /** Counted toward the pack's map views and limits. */
    val billable: Boolean,
    /** Fetched from its public route without the grant, which never admits it. */
    val isPublic: Boolean,
)

/** Exact bytes on the wire. The download's `ETag` carries the hash. */
internal data class OfflinePackTile(val z: Int, val x: Int, val y: Int, val bytes: Long)

/** The stored tiles of one source inside the region, at the source's zooms. */
internal class OfflinePackTileSet(
    val source: String,
    val template: String,
    /** Null when every pack zoom is below the source's minimum zoom. */
    val zooms: IntRange?,
    val entries: List<OfflinePackTile>,
) {
    /** The URL the renderer requests for the tile. */
    fun url(tile: OfflinePackTile): URI =
        URI(
            template
                .replace("{z}", tile.z.toString())
                .replace("{x}", tile.x.toString())
                .replace("{y}", tile.y.toString())
        )
}

internal data class OfflinePackExclusion(val source: String, val reason: String)

/**
 * The pack's canonical definition and every resource a renderer needs, as the service signed it.
 */
internal class OfflinePackManifest(
    val packId: String,
    val mapId: String,
    val profile: String,
    val deploymentVersion: Long,
    val themes: List<String>,
    val region: OfflinePackRegion,
    val minZoom: Int,
    val maxZoom: Int,
    val terrainMaxZoom: Int,
    val createdAtMillis: Long,
    val documents: List<OfflinePackDocument>,
    val tiles: List<OfflinePackTileSet>,
    /**
     * Sources the styles use that the pack leaves out, with the service's reason, such as
     * `legal_review`, `not_authorized`, `third_party` or `unavailable`.
     */
    val excluded: List<OfflinePackExclusion>,
    val resourceCount: Long,
    val billableResourceCount: Long,
    val bytes: Long,
    /** The attribution to show offline, one entry per source, as the service wrote it. */
    val attribution: List<JSONObject>,
    /** The plan's billable resources per pack, which is also the device's total. */
    val maximumPackResources: Long,
    val dailyDownloads: Long,
    val revalidationIntervalMillis: Long,
    /** The end of the download window. */
    val downloadExpiresAtMillis: Long,
)

/** A created pack; [response] is the service's answer as received, which the store keeps. */
internal class OfflinePack(
    val grant: OfflinePackGrant,
    val manifest: OfflinePackManifest,
    val response: ByteArray,
)

/** Whether a downloaded pack can still be updated. Access ending never deletes it. */
internal sealed class OfflinePackRevalidation {
    abstract val checkedAtMillis: Long

    /** Access continues and nothing changed. */
    data class Current(override val checkedAtMillis: Long, val intervalMillis: Long) :
        OfflinePackRevalidation()

    /**
     * Access continues but the Map changed: create the same pack again and download with
     * `If-None-Match`, so only changed resources are counted.
     */
    data class UpdateAvailable(override val checkedAtMillis: Long, val intervalMillis: Long) :
        OfflinePackRevalidation()

    /** Access ended. The pack stays usable as it is and is no longer updated. */
    data class NotUpdatable(
        /**
         * `credential_revoked`, `map_unavailable`, `plan_unavailable`, `downloads_disabled`,
         * `product_not_downloadable` or `theme_unavailable` today; the service may add reasons.
         */
        val reason: String,
        override val checkedAtMillis: Long,
    ) : OfflinePackRevalidation()
}

/**
 * Reads the Hosted offline pack wire contract. Answers ignore members the SDK does not read and
 * keep values the service may extend open; every member the SDK reads, and the invariants between
 * them, are checked.
 */
internal object OfflinePackContract {
    /** The largest creation answer the service sends; 50,000 resources measure about 1.4 MB. */
    const val MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024

    enum class Operation {
        CREATE,
        REVALIDATE,
        DOWNLOAD,
    }

    /**
     * A created pack. [request] is the canonical request the client sent; the manifest must
     * describe exactly that pack.
     */
    fun pack(
        bytes: ByteArray,
        request: OfflinePackRequest,
        allowsLoopbackHttp: Boolean,
    ): OfflinePack = checked {
            val value = json(bytes)
            require(value.opt("version") == 1 && value.opt("kind") == "offline_pack")
            val grant = OfflinePackGrant.of(value.opt("grant") as? String ?: "")!!
            val manifest = value.getJSONObject("manifest")
            OfflinePack(grant, manifest(manifest, request, allowsLoopbackHttp), bytes)
        }

    fun manifest(
        value: JSONObject,
        request: OfflinePackRequest,
        allowsLoopbackHttp: Boolean,
    ): OfflinePackManifest = checked {
        require(!value.has("version") || value.opt("version") == 1)
        val packId = value.getString("packId")
        require(Regex("^opk_[A-Za-z0-9_-]{22}$").matches(packId))
        require(value.opt("mapId") == request.mapId && value.opt("profile") == request.profile)
        val deploymentVersion = integer(value.opt("deploymentVersion"), 1)!!
        val themes = value.getJSONArray("themes")
        require((0 until themes.length()).map { themes.opt(it) } == request.themes)
        val region = OfflinePackRegion.fromJson(value.opt("region"))!!
        require(region == request.region)
        require(integer(value.opt("minZoom"), 0) == request.minZoom.toLong())
        require(integer(value.opt("maxZoom"), 0) == request.maxZoom.toLong())
        require(integer(value.opt("terrainMaxZoom"), 0) == request.terrainMaxZoom.toLong())
        val createdAt = date(value.opt("createdAt"))!!
        val expiresAt = date(value.getJSONObject("download").opt("expiresAt"))!!
        require(expiresAt > createdAt && expiresAt - createdAt <= 86_400_000)
        val totals = value.getJSONObject("totals")
        val resourceCount = integer(totals.opt("resources"), 1)!!
        val billableCount = integer(totals.opt("billableResources"), 0)!!
        val bytes = integer(totals.opt("bytes"), 0)!!
        val limits = value.getJSONObject("limits")
        val maximum = integer(limits.opt("maxPackResources"), 1)!!
        val daily = integer(limits.opt("dailyDownloads"), 0)!!
        val revalidation = value.getJSONObject("revalidation")
        val interval = integer(revalidation.opt("intervalSeconds"), 1)!!
        // Always absolute on the service's origin; the SDK revalidates at its configured origin.
        requireNotNull(resourceUrl(revalidation.opt("url"), allowsLoopbackHttp))
        val attributionValues = value.getJSONObject("attribution").getJSONArray("sources")
        val attribution =
            (0 until attributionValues.length()).map { attributionValues.opt(it) as JSONObject }

        val urls = mutableSetOf<URI>()
        val documentValues = value.getJSONArray("documents")
        val documents =
            (0 until documentValues.length()).map {
                val item = documentValues.getJSONObject(it)
                val kind = item.getString("kind")
                require(Regex("^[a-z][a-z0-9_-]{0,63}$").matches(kind))
                val url = resourceUrl(item.opt("url"), allowsLoopbackHttp)!!
                require(urls.add(url))
                val size = integer(item.opt("bytes"), 0)!!
                val billable = item.opt("billable") as Boolean
                val access = item.opt("access")
                require(access == "grant" || access == "public")
                require(!(billable && access == "public"))
                val sha256 =
                    when (val digest = item.opt("sha256")) {
                        JSONObject.NULL -> null
                        is String -> digest.also { require(Regex("^[0-9a-f]{64}$").matches(it)) }
                        else -> throw IllegalArgumentException()
                    }
                OfflinePackDocument(kind, url, size, sha256, billable, access == "public")
            }

        val sources = mutableSetOf<String>()
        val covers = mutableMapOf<Int, OfflineTileCover>()
        val rows = mutableMapOf<Pair<Int, Int>, List<IntRange>>()
        val tileValues = value.getJSONArray("tiles")
        val tiles =
            (0 until tileValues.length()).map { index ->
                val item = tileValues.getJSONObject(index)
                val source = item.getString("source")
                require(sources.add(source))
                val template = item.getString("template")
                require(listOf("{z}", "{x}", "{y}").all { template.split(it).size == 2 })
                require(resourceUrl(template, allowsLoopbackHttp, template = true) != null)
                val zooms =
                    when (val pair = item.opt("zooms")) {
                        JSONObject.NULL -> null
                        is JSONArray -> {
                            require(pair.length() == 2)
                            val low = integer(pair.opt(0), 0, 30)!!.toInt()
                            val high = integer(pair.opt(1), 0, 30)!!.toInt()
                            require(low <= high)
                            low..high
                        }
                        else -> throw IllegalArgumentException()
                    }
                val seen = mutableSetOf<Triple<Int, Int, Int>>()
                val entryValues = item.getJSONArray("entries")
                val entries =
                    (0 until entryValues.length()).map {
                        val parts = entryValues.getJSONArray(it)
                        require(parts.length() == 4)
                        val z = integer(parts.opt(0), 0, 30)!!.toInt()
                        require(zooms != null && z in zooms)
                        val x = integer(parts.opt(1), 0, (1L shl z) - 1)!!.toInt()
                        val y = integer(parts.opt(2), 0, (1L shl z) - 1)!!.toInt()
                        val size = integer(parts.opt(3), 0)!!
                        require(seen.add(Triple(z, x, y)))
                        // Every listed tile lies in the region's cover, which is what the grant
                        // admits.
                        val cover = covers.getOrPut(z) { OfflineTileCover(region, z) }
                        require(rows.getOrPut(z to y) { cover.row(y) }.any { x in it })
                        OfflinePackTile(z, x, y, size)
                    }
                OfflinePackTileSet(source, template, zooms, entries)
            }

        val excludedValues = value.getJSONArray("excluded")
        val excluded =
            (0 until excludedValues.length()).map {
                val item = excludedValues.getJSONObject(it)
                OfflinePackExclusion(
                    item.getString("source").also { require(it.isNotEmpty()) },
                    item.getString("reason").also { require(it.isNotEmpty()) },
                )
            }

        // The service's totals must be the sum of what it lists.
        val tileCount = tiles.sumOf { it.entries.size }.toLong()
        require(resourceCount == documents.size + tileCount)
        require(billableCount == documents.count { it.billable } + tileCount)
        require(
            bytes ==
                documents.sumOf { it.bytes } + tiles.sumOf { set -> set.entries.sumOf { it.bytes } }
        )
        require(billableCount <= maximum)

        OfflinePackManifest(
            packId = packId,
            mapId = request.mapId,
            profile = request.profile,
            deploymentVersion = deploymentVersion,
            themes = request.themes,
            region = region,
            minZoom = request.minZoom,
            maxZoom = request.maxZoom,
            terrainMaxZoom = request.terrainMaxZoom,
            createdAtMillis = createdAt,
            documents = documents,
            tiles = tiles,
            excluded = excluded,
            resourceCount = resourceCount,
            billableResourceCount = billableCount,
            bytes = bytes,
            attribution = attribution,
            maximumPackResources = maximum,
            dailyDownloads = daily,
            revalidationIntervalMillis = interval * 1_000,
            downloadExpiresAtMillis = expiresAt,
        )
    }

    fun revalidation(bytes: ByteArray): OfflinePackRevalidation = checked {
        val value = json(bytes)
        val checkedAt = date(value.opt("checkedAt"))!!
        when (value.opt("state")) {
            "current",
            "update_available" -> {
                require(!value.has("reason"))
                val interval = integer(value.opt("intervalSeconds"), 1)!! * 1_000
                if (value.opt("state") == "current")
                    OfflinePackRevalidation.Current(checkedAt, interval)
                else OfflinePackRevalidation.UpdateAvailable(checkedAt, interval)
            }
            "not_updatable" -> {
                val reason = value.getString("reason")
                require(Regex("^[a-z][a-z0-9_]{0,63}$").matches(reason))
                OfflinePackRevalidation.NotUpdatable(reason, checkedAt)
            }
            else -> throw IllegalArgumentException()
        }
    }

    /** Each documented code with the only status it is trusted with. */
    val codes: Map<String, Pair<Int, TileflowOfflineErrorCode>> =
        mapOf(
            "OFFLINE_PACK_INVALID_INPUT" to (400 to TileflowOfflineErrorCode.REJECTED),
            "OFFLINE_PACK_AUTHORITY_CONFLICT" to (400 to TileflowOfflineErrorCode.REJECTED),
            "MOBILE_CREDENTIAL_INVALID" to (401 to TileflowOfflineErrorCode.CREDENTIAL_REJECTED),
            "OFFLINE_PACK_GRANT_INVALID" to (401 to TileflowOfflineErrorCode.GRANT_REJECTED),
            "OFFLINE_PACK_GRANT_EXPIRED" to (401 to TileflowOfflineErrorCode.GRANT_REJECTED),
            "OFFLINE_PACK_GRANT_STALE" to (401 to TileflowOfflineErrorCode.GRANT_REJECTED),
            "MOBILE_MAP_MISMATCH" to (403 to TileflowOfflineErrorCode.ACCESS_DENIED),
            "OFFLINE_PACK_RESOURCE_DENIED" to (403 to TileflowOfflineErrorCode.ACCESS_DENIED),
            "OFFLINE_PACKS_NOT_INCLUDED" to (403 to TileflowOfflineErrorCode.NOT_INCLUDED),
            "OFFLINE_DOWNLOADS_DISABLED" to (403 to TileflowOfflineErrorCode.DOWNLOADS_DISABLED),
            "OFFLINE_PACK_MAP_NOT_FOUND" to (404 to TileflowOfflineErrorCode.NOT_FOUND),
            "OFFLINE_PACK_THEME_NOT_FOUND" to (404 to TileflowOfflineErrorCode.NOT_FOUND),
            "OFFLINE_PACK_SUPERSEDED" to (409 to TileflowOfflineErrorCode.SUPERSEDED),
            "OFFLINE_PACK_BODY_TOO_LARGE" to (413 to TileflowOfflineErrorCode.REJECTED),
            "OFFLINE_PACK_TOO_LARGE" to (422 to TileflowOfflineErrorCode.PACK_TOO_LARGE),
            "OFFLINE_PACK_NOT_DOWNLOADABLE" to (422 to TileflowOfflineErrorCode.NOT_DOWNLOADABLE),
            "OFFLINE_DAILY_LIMIT_REACHED" to (429 to TileflowOfflineErrorCode.DAILY_LIMIT_REACHED),
            "COMMERCIAL_MAP_LIMIT_REACHED" to (429 to TileflowOfflineErrorCode.QUOTA_EXCEEDED),
            "COMMERCIAL_SPENDING_LIMIT_REACHED" to (429 to TileflowOfflineErrorCode.QUOTA_EXCEEDED),
            "RATE_LIMITED" to (429 to TileflowOfflineErrorCode.RATE_LIMITED),
            "OFFLINE_PACKS_DISABLED" to (503 to TileflowOfflineErrorCode.UNAVAILABLE),
            "OFFLINE_PACKS_UNAVAILABLE" to (503 to TileflowOfflineErrorCode.UNAVAILABLE),
            "OFFLINE_PACK_GRANT_UNAVAILABLE" to (503 to TileflowOfflineErrorCode.UNAVAILABLE),
        )

    /**
     * Classifies a refused pack request. A code is trusted only with its documented status;
     * otherwise the status alone decides.
     */
    fun failure(
        status: Int,
        body: ByteArray,
        retryAfter: String?,
        operation: Operation,
        nowMillis: Long,
    ): TileflowOfflineException {
        val serverCode = HostedContract.errorCode(body)
        val known = serverCode?.let(codes::get)?.takeIf { it.first == status }?.second
        val code =
            known
                ?: when (status) {
                    401 ->
                        if (operation == Operation.CREATE)
                            TileflowOfflineErrorCode.CREDENTIAL_REJECTED
                        else TileflowOfflineErrorCode.GRANT_REJECTED
                    403 -> TileflowOfflineErrorCode.ACCESS_DENIED
                    404 -> TileflowOfflineErrorCode.NOT_FOUND
                    409 -> TileflowOfflineErrorCode.SUPERSEDED
                    429 -> TileflowOfflineErrorCode.RATE_LIMITED
                    408,
                    in 500..599 -> TileflowOfflineErrorCode.UNAVAILABLE
                    in 400..499 -> TileflowOfflineErrorCode.REJECTED
                    else -> TileflowOfflineErrorCode.INVALID_RESPONSE
                }
        val limit =
            if (code == TileflowOfflineErrorCode.PACK_TOO_LARGE && body.size <= 4096)
                runCatching { integer(json(body).opt("limit"), 1, Int.MAX_VALUE.toLong())?.toInt() }
                    .getOrNull()
            else null
        val waits =
            setOf(
                TileflowOfflineErrorCode.DAILY_LIMIT_REACHED,
                TileflowOfflineErrorCode.RATE_LIMITED,
                TileflowOfflineErrorCode.UNAVAILABLE,
            )
        return TileflowOfflineException(
            code,
            TileflowErrorContext(reason = serverCode, status = status, limit = limit),
            if (code in waits) retryAfterMillis(retryAfter, nowMillis) else null,
        )
    }

    /** Delta-seconds or an HTTP date, at most one day: a daily limit waits for the next UTC day. */
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
        return delay.coerceIn(0, 86_400_000)
    }

    /**
     * A resource address the grant may travel to: HTTPS, or loopback HTTP for a local development
     * API, without credentials in it.
     */
    fun resourceUrl(value: Any?, allowsLoopbackHttp: Boolean, template: Boolean = false): URI? {
        var text = value as? String ?: return null
        if (text.length > 2048 || Regex("(?i)tf_[a-z]+_").containsMatchIn(text)) return null
        if (template) text = text.replace("{z}", "0").replace("{x}", "0").replace("{y}", "0")
        val url = runCatching { URI(text) }.getOrNull() ?: return null
        val loopback = url.host == "localhost" || url.host == "127.0.0.1"
        if (url.host.isNullOrEmpty() || url.rawUserInfo != null || url.rawFragment != null)
            return null
        if (url.scheme != "https" && !(allowsLoopbackHttp && url.scheme == "http" && loopback))
            return null
        return url
    }

    fun integer(value: Any?, minimum: Long, maximum: Long = 9_007_199_254_740_991): Long? {
        if (value !is Number) return null
        val number = value.toDouble()
        if (number != kotlin.math.floor(number) || number < minimum || number > maximum) return null
        return number.toLong()
    }

    fun date(value: Any?): Long? {
        if (value !is String) return null
        if (!Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$").matches(value))
            return null
        return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
    }

    fun json(bytes: ByteArray): JSONObject {
        val text =
            Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
        val tokener = JSONTokener(text)
        val value = tokener.nextValue() as JSONObject
        require(tokener.nextClean() == 0.toChar())
        return value
    }

    private inline fun <T> checked(block: () -> T): T =
        try {
            block()
        } catch (error: TileflowOfflineException) {
            throw error
        } catch (_: Exception) {
            throw TileflowOfflineException.invalidResponse()
        }
}
