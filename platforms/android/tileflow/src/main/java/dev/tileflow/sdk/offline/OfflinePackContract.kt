package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.hosted.HostedContract
import dev.tileflow.sdk.transport.ResourcePolicy
import dev.tileflow.sdk.transport.sha256Hex
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
 * The signed authority of one Hosted download: `tf_offline_v2.<payload>.<signature>`. The SDK
 * cannot verify it and never reads it; it sends it only to download the download's own packs and to
 * revalidate. [toString] never includes it.
 */
internal class OfflinePackGrant private constructor(val value: String) {
    override fun equals(other: Any?): Boolean = other is OfflinePackGrant && other.value == value

    override fun hashCode(): Int = value.hashCode()

    override fun toString(): String = "OfflinePackGrant(tf_offline_v2…)"

    /** A short, stable name for the grant that reveals nothing of it. */
    val tag: String
        get() = sha256Hex(value.toByteArray()).take(12)

    companion object {
        private val pattern = Regex("^tf_offline_v2\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$")

        fun of(value: String): OfflinePackGrant? =
            value.takeIf { it.length <= 16_384 && pattern.matches(it) }?.let(::OfflinePackGrant)
    }
}

/** A free public file a download needs, fetched from its public route without the grant. */
internal data class OfflinePublicResource(
    /** `discovery`, `profile`, `landmark` or `model` today; the service may add kinds. */
    val kind: String,
    val url: URI,
    val bytes: Long,
    /** Lowercase hexadecimal SHA-256 of those bytes. */
    val sha256: String,
)

/** A source whose tiles a download holds. */
internal data class OfflineDownloadSource(
    val source: String,
    /** The source's pinned release. */
    val version: String,
    /** Byte-identical to the tile URL template of the source's TileJSON in the `style` pack. */
    val template: OfflineTileTemplate,
    /**
     * The zooms the download holds; null when every download zoom is below the source's minimum,
     * and the download holds none of its tiles.
     */
    val zooms: IntRange?,
    val contentType: String,
    val contentEncoding: String?,
    /** What the source answers online for a covered tile its archive does not store. */
    val absentStatus: Int,
)

/** One pack of a download, as its manifest lists it. */
internal data class OfflineDownloadPack(
    /**
     * `style`, `assets`, `glyphs/<fontstack>/<n>` or `tiles/<source>/<z>/<x>/<y>`: the same pack
     * keeps its id in every release.
     */
    val id: String,
    val kind: OfflinePackKind,
    val url: URI,
    /** Exact bytes of the pack. */
    val bytes: Long,
    val resources: Int,
    val billableResources: Int,
    /** A tile pack's source, anchor tile and zooms. */
    val source: String? = null,
    val anchor: OfflineTileId? = null,
    val zooms: IntRange? = null,
)

internal data class OfflinePackExclusion(val source: String, val reason: String)

/**
 * The download's canonical definition and everything a renderer needs, as the service signed it.
 */
internal class OfflineDownloadManifest(
    val downloadId: String,
    val mapId: String,
    val profile: String,
    val deploymentVersion: Long,
    val themes: List<String>,
    val region: OfflinePackRegion,
    val minZoom: Int,
    val maxZoom: Int,
    val terrainMaxZoom: Int,
    val createdAtMillis: Long,
    val sources: List<OfflineDownloadSource>,
    val packs: List<OfflineDownloadPack>,
    val publicResources: List<OfflinePublicResource>,
    /** The origins document entries and tile templates may use. */
    val origins: Set<String>,
    /**
     * Sources the styles use that the download leaves out, with the service's reason, such as
     * `legal_review`, `not_authorized`, `third_party` or `unavailable`.
     */
    val excluded: List<OfflinePackExclusion>,
    val resourceCount: Long,
    val billableResourceCount: Long,
    val bytes: Long,
    /** The attribution to show offline, one entry per source, as the service wrote it. */
    val attribution: List<JSONObject>,
    /** The plan's billable resources per download, which is also the device's total. */
    val maximumPackResources: Long,
    val dailyDownloads: Long,
    val revalidationIntervalMillis: Long,
    /** The end of the download window. */
    val downloadExpiresAtMillis: Long,
) {
    fun source(name: String): OfflineDownloadSource? = sources.firstOrNull { it.source == name }
}

/** A created download; [response] is the service's answer as received, which the store keeps. */
internal class OfflineDownload(
    val grant: OfflinePackGrant,
    val manifest: OfflineDownloadManifest,
    val response: ByteArray,
)

/** Whether a stored download can still be updated. Access ending never deletes it. */
internal sealed class OfflinePackRevalidation {
    abstract val checkedAtMillis: Long

    /** Access continues and nothing changed. */
    data class Current(override val checkedAtMillis: Long, val intervalMillis: Long) :
        OfflinePackRevalidation()

    /**
     * Access continues but the Map changed: create the same download again and request each pack
     * of a changed source or document with `If-None-Match`, so only changed packs are counted.
     */
    data class UpdateAvailable(override val checkedAtMillis: Long, val intervalMillis: Long) :
        OfflinePackRevalidation()

    /** Access ended. The download stays usable as it is and is no longer updated. */
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
 * Reads the Hosted offline download wire contract, format 2. Answers ignore members the SDK does
 * not read and keep values the service may extend open; every member the SDK reads, and the
 * invariants between them, are checked.
 */
internal object OfflinePackContract {
    /** The largest creation answer the service sends. */
    const val MAXIMUM_RESPONSE_BYTES = 8 * 1024 * 1024

    enum class Operation {
        CREATE,
        REVALIDATE,
        DOWNLOAD,
    }

    /**
     * A created download. [request] is the canonical request the client sent; the manifest must
     * describe exactly that download.
     */
    fun download(
        bytes: ByteArray,
        request: OfflinePackRequest,
        allowsLoopbackHttp: Boolean,
    ): OfflineDownload = checked {
        val value = json(bytes)
        require(value.opt("version") == 2 && value.opt("kind") == "offline_download")
        val grant = OfflinePackGrant.of(value.opt("grant") as? String ?: "")!!
        val manifest = value.getJSONObject("manifest")
        OfflineDownload(grant, manifest(manifest, request, allowsLoopbackHttp), bytes)
    }

    fun manifest(
        value: JSONObject,
        request: OfflinePackRequest,
        allowsLoopbackHttp: Boolean,
    ): OfflineDownloadManifest = checked {
        require(value.opt("version") == 2)
        val downloadId = value.getString("downloadId")
        require(Regex("^[A-Za-z0-9_-]{8,64}$").matches(downloadId))
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
        val packCount = integer(totals.opt("packs"), 0)!!
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

        val originValues = value.getJSONArray("origins")
        require(originValues.length() > 0)
        val origins =
            (0 until originValues.length())
                .map { originValues.opt(it) as String }
                .onEach { require(HostedContract.canonicalOrigin(it, allowsLoopbackHttp)) }
                .toSet()
        fun onOrigins(url: URI) = ResourcePolicy.origin(url) in origins

        val sourceValues = value.getJSONArray("sources")
        val sources = mutableListOf<OfflineDownloadSource>()
        for (index in 0 until sourceValues.length()) {
            val item = sourceValues.getJSONObject(index)
            val source = item.getString("source")
            require(isName(source) && sources.none { it.source == source })
            val version = item.getString("version").also { require(isName(it)) }
            val text = item.getString("template")
            val template = OfflineTileTemplate.of(text)!!
            require(onOrigins(resourceUrl(text, allowsLoopbackHttp, template = true)!!))
            val contentType = item.getString("contentType")
            require(Regex("^[a-z0-9.+-]+/[a-z0-9.+-]+$").matches(contentType))
            val encoding =
                when (val value = item.opt("contentEncoding")) {
                    null,
                    JSONObject.NULL -> null
                    "gzip" -> "gzip"
                    else -> throw IllegalArgumentException()
                }
            val absent =
                when (val value = item.opt("absentStatus")) {
                    null -> 404
                    204,
                    404 -> value as Int
                    else -> throw IllegalArgumentException()
                }
            val zooms = item.opt("zooms")
            sources +=
                OfflineDownloadSource(
                    source,
                    version,
                    template,
                    if (zooms == JSONObject.NULL) null else zoomRange(zooms)!!,
                    contentType,
                    encoding,
                    absent,
                )
        }

        val packValues = value.getJSONArray("packs")
        val ids = mutableSetOf<String>()
        val covers = mutableMapOf<Int, OfflineTileCover>()
        val packs =
            (0 until packValues.length()).map { index ->
                val item = packValues.getJSONObject(index)
                val id = item.getString("id")
                require(id.length <= 512 && ids.add(id))
                val kind = OfflinePackKind.ofManifest(item.opt("kind"))!!
                val url = resourceUrl(item.opt("url"), allowsLoopbackHttp)!!
                require(onOrigins(url) && url.rawQuery == null && url.path.endsWith(".tfpack"))
                val size =
                    integer(
                        item.opt("bytes"),
                        (OfflinePackFormat.HEADER_LENGTH + OfflinePackFormat.TRAILER_LENGTH)
                            .toLong(),
                        OfflinePackFormat.MAXIMUM_BYTES.toLong(),
                    )!!
                val resources =
                    integer(item.opt("resources"), 1, OfflinePackFormat.MAXIMUM_ENTRIES.toLong())!!
                val billable = integer(item.opt("billableResources"), 0, resources)!!
                when (kind) {
                    OfflinePackKind.TILES -> {
                        val parts = item.getJSONArray("anchor")
                        require(parts.length() == 3)
                        val z = integer(parts.opt(0), 0, OfflineZooms.MAXIMUM.toLong())!!.toInt()
                        require(z in OfflinePackBand.anchors)
                        val x = integer(parts.opt(1), 0, (1L shl z) - 1)!!.toInt()
                        val y = integer(parts.opt(2), 0, (1L shl z) - 1)!!.toInt()
                        val name = item.getString("source")
                        val declared = sources.first { it.source == name }
                        require(id == "tiles/$name/$z/$x/$y")
                        val range = zoomRange(item.opt("zooms"))!!
                        val band = OfflinePackBand.zooms(z)!!
                        require(range.first in band && range.last in band)
                        val held = declared.zooms!!
                        require(range.first in held && range.last in held)
                        // The anchor is covered at its zoom, which is exactly what the grant
                        // admits.
                        require(covers.getOrPut(z) { OfflineTileCover(region, z) }.contains(x, y))
                        OfflineDownloadPack(
                            id,
                            kind,
                            url,
                            size,
                            resources.toInt(),
                            billable.toInt(),
                            name,
                            OfflineTileId(z, x, y),
                            range,
                        )
                    }
                    OfflinePackKind.DOCUMENTS -> {
                        require(!item.has("anchor") && !item.has("source"))
                        require(
                            id == "style" ||
                                id == "assets" ||
                                Regex("^glyphs/[^/]{1,256}/(0|[1-9][0-9]{0,4})$").matches(id)
                        )
                        OfflineDownloadPack(id, kind, url, size, resources.toInt(), billable.toInt())
                    }
                }
            }

        val urls = mutableSetOf<URI>()
        val publicValues = value.getJSONArray("publicResources")
        val publicResources =
            (0 until publicValues.length()).map {
                val item = publicValues.getJSONObject(it)
                val kind = item.getString("kind")
                require(Regex("^[a-z][a-z0-9_-]{0,63}$").matches(kind))
                val url = resourceUrl(item.opt("url"), allowsLoopbackHttp)!!
                require(urls.add(url))
                val sha256 = item.getString("sha256")
                require(Regex("^[0-9a-f]{64}$").matches(sha256))
                OfflinePublicResource(kind, url, integer(item.opt("bytes"), 0)!!, sha256)
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
        require(packCount == packs.size.toLong())
        require(resourceCount == packs.sumOf { it.resources.toLong() } + publicResources.size)
        require(billableCount == packs.sumOf { it.billableResources.toLong() })
        require(bytes == packs.sumOf { it.bytes } + publicResources.sumOf { it.bytes })
        require(billableCount <= maximum)

        OfflineDownloadManifest(
            downloadId = downloadId,
            mapId = request.mapId,
            profile = request.profile,
            deploymentVersion = deploymentVersion,
            themes = request.themes,
            region = region,
            minZoom = request.minZoom,
            maxZoom = request.maxZoom,
            terrainMaxZoom = request.terrainMaxZoom,
            createdAtMillis = createdAt,
            sources = sources,
            packs = packs,
            publicResources = publicResources,
            origins = origins,
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

    /** `[min, max]` zooms. */
    private fun zoomRange(value: Any?): IntRange? {
        val pair = value as? JSONArray ?: return null
        if (pair.length() != 2) return null
        val low = integer(pair.opt(0), 0, OfflineZooms.MAXIMUM.toLong())?.toInt() ?: return null
        val high = integer(pair.opt(1), 0, OfflineZooms.MAXIMUM.toLong())?.toInt() ?: return null
        return if (low <= high) low..high else null
    }

    /** A source or release name: printable, without separators a path or log would split on. */
    private fun isName(text: String): Boolean = Regex("^[A-Za-z0-9._-]{1,128}$").matches(text)

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
            "OFFLINE_TEAM_DAILY_LIMIT_REACHED" to
                (429 to TileflowOfflineErrorCode.DAILY_LIMIT_REACHED),
            "OFFLINE_PACK_REPEAT_LIMIT_REACHED" to (429 to TileflowOfflineErrorCode.RATE_LIMITED),
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
