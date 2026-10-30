package dev.tileflow.sdk.offline

import dev.tileflow.sdk.transport.NativeHTTPTransporting
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourcePayload
import dev.tileflow.sdk.transport.sha256Hex
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.zip.GZIPOutputStream
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import okhttp3.Request
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject

/** Builds packs in the service's format. */
internal object OfflinePackBuilder {
    class Entry(
        val name: String,
        val contentType: String,
        val encoding: String?,
        val body: ByteArray,
    )

    /** A pack of [entries]; [offsets] replaces the data offsets the index records. */
    fun build(kind: OfflinePackKind, entries: List<Entry>, offsets: List<Long>? = null): ByteArray {
        val index = ByteArrayOutputStream()
        val data = ByteArrayOutputStream()
        for ((position, entry) in entries.withIndex()) {
            val name = entry.name.toByteArray()
            val type = entry.contentType.toByteArray()
            val encoding = (entry.encoding ?: "").toByteArray()
            index.write(little(name.size.toLong(), 2))
            index.write(name)
            index.write(type.size)
            index.write(type)
            index.write(encoding.size)
            index.write(encoding)
            index.write(little(offsets?.get(position) ?: data.size().toLong(), 8))
            index.write(little(entry.body.size.toLong(), 4))
            data.write(entry.body)
        }
        val pack = ByteArrayOutputStream()
        pack.write("TFPK".toByteArray())
        pack.write(little(1, 2))
        pack.write(kind.code)
        pack.write(0)
        pack.write(little(entries.size.toLong(), 4))
        pack.write(little(index.size().toLong(), 4))
        pack.write(little(data.size().toLong(), 8))
        pack.write(little(0, 8))
        pack.write(index.toByteArray())
        pack.write(data.toByteArray())
        val content = pack.toByteArray()
        return content + MessageDigest.getInstance("SHA-256").digest(content)
    }

    /** A gzip member holding [data]. */
    fun gzip(data: ByteArray): ByteArray =
        ByteArrayOutputStream().also { output -> GZIPOutputStream(output).use { it.write(data) } }
            .toByteArray()

    private fun little(value: Long, width: Int): ByteArray =
        ByteBuffer.allocate(8).order(ByteOrder.LITTLE_ENDIAN).putLong(value).array().copyOf(width)
}

/**
 * A Hosted service in process: it creates downloads from the region's cover, assembles their packs,
 * serves them and the public files with the contract's headers and statuses, and records every
 * request.
 */
internal class OfflineServiceStub : NativeHTTPTransporting, OfflineResourceFetching {
    class Download(val url: String, val headers: Map<String, String>, val status: Int)

    data class Refusal(val at: Int, val status: Int, val code: String, val retryAfter: String?)

    val clock = AtomicLong(1_793_188_800_000) // 2026-10-28T12:00:00Z
    val creations = AtomicInteger()
    val revalidations = AtomicInteger()
    val downloads = CopyOnWriteArrayList<Download>()
    /** What each delivered pack entry and public file holds, decoded, by address. */
    val served = ConcurrentHashMap<String, ByteArray>()
    private val publicUrls = ConcurrentHashMap.newKeySet<String>()
    private val lock = Any()
    private var deployment = 1
    private var release = 1
    private val changes = HashMap<String, Int>()
    private val grants = HashMap<String, Pair<Long, Int>>()
    private val packs = HashMap<String, Map<String, ByteArray>>()
    @Volatile var revalidationState = "current"
    @Volatile var online = true
    @Volatile var freezeAfter: Int? = null
    @Volatile var expireGrantAfter: Int? = null
    @Volatile var refuseOnce: Refusal? = null
    @Volatile var tileLimit: Int? = null
    @Volatile var documentsPublicOnly = false
    @Volatile var maximumPackResources = 10_000
    /** The next pack responses with bytes carry a damaged byte. */
    @Volatile var corruptPacks = 0
    @Volatile var onDownload: ((Int) -> Unit)? = null
    @Volatile var billable = 0L

    /** The z17 tile a new World release changes. */
    val changedTile: OfflineTileId = run {
        val cover = OfflineTileCover(OfflinePackRegion.canonical(-3.71, 40.41, -3.69, 40.425)!!, 17)
        val y = cover.rows!!.first
        OfflineTileId(17, cover.row(y)[0].first, y)
    }

    val styleUrl: String
        get() = "$MAP_PATH/webview-v1/v${synchronized(lock) { deployment }}/light.json"

    val template: String
        get() = template(synchronized(lock) { release })

    fun tileUrl(tile: OfflineTileId): String =
        OfflineTileTemplate.of(template)!!.url(tile).toASCIIString()

    fun isPublic(url: String) = url in publicUrls

    fun key(url: String) =
        ResourceCacheKey(
            URI(url),
            if (isPublic(url) || !url.startsWith(ORIGIN)) ResourceCacheScope.Shared
            else ResourceCacheScope.grant(URI(ORIGIN), MAP_ID),
        )

    /** A new deployment: a new versioned style and a new profile. */
    fun deploy() =
        synchronized(lock) {
            deployment += 1
            changes["profile"] = deployment
        }

    /** A new deployment and a new World release, which changes one tile. */
    fun publish() {
        deploy()
        synchronized(lock) {
            release += 1
            changes["tile"] = release
        }
    }

    /** The pack holding [changedTile], at the current release. */
    val changedPackUrl: String
        get() {
            val anchor = changedTile.ancestor(OfflinePackBand.anchor(changedTile.z))
            return "$ORIGIN/v1/offline/tiles/world/r${synchronized(lock) { release }}/" +
                "${anchor.z}/${anchor.x}/${anchor.y}.tfpack"
        }

    // Bodies.

    private fun body(url: String): ByteArray {
        if (url.endsWith("/webview-v1/manifest.json"))
            return "$url#${changes["profile"] ?: 1}".toByteArray()
        if (url == "https://tiles.example.com/manifest.json")
            return """{"version":1,"maps":{"streets":{"defaultTheme":"day","themes":{"day":{"styleUrl":"./style.json","fontFaces":[{"family":"Face","source":"./fonts/face.woff2"}]}}}}}"""
                .toByteArray()
        if (url == "https://tiles.example.com/style.json")
            return """{"version":8,"sprite":"https://tiles.example.com/sprites/base","glyphs":"https://tiles.example.com/fonts/{fontstack}/{range}.pbf","sources":{"places":{"type":"geojson","data":"./data/places.json"}},"layers":[{"id":"l","type":"symbol","layout":{"text-font":["Noto Sans Regular"],"text-field":"x"}}]}"""
                .toByteArray()
        return "$url#1".toByteArray()
    }

    /** A tile's body: equal in every release unless the release changed it. */
    private fun tile(tile: OfflineTileId): ByteArray =
        "tile ${tile.name}#${if (tile == changedTile) changes["tile"] ?: 1 else 1}".toByteArray()

    // NativeHTTPTransporting.

    override fun send(request: Request, timeoutMillis: Long): ResourcePayload {
        if (!online) throw IOException("offline")
        if (request.url.encodedPath.endsWith("/revalidate")) {
            revalidations.incrementAndGet()
            val checked = date(clock.get())
            val body =
                if (revalidationState == "not_updatable")
                    """{"state":"not_updatable","reason":"credential_revoked","checkedAt":"$checked"}"""
                else
                    """{"state":"$revalidationState","checkedAt":"$checked","intervalSeconds":86400}"""
            return ResourcePayload(body.toByteArray(), 200, emptyMap())
        }
        val buffer = Buffer().also { request.body!!.writeTo(it) }
        return ResourcePayload(
            created(OfflinePackRequest.fromJson(buffer.readByteArray())!!),
            201,
            emptyMap(),
        )
    }

    override fun cancelActive() {}

    override fun close() {}

    /** Creates a download of [request], as `POST /v1/offline/packs` answers. */
    fun created(request: OfflinePackRequest): ByteArray =
        synchronized(lock) {
            creations.incrementAndGet()
            revalidationState = "current"
            created(request, clock.get())
        }

    private fun created(request: OfflinePackRequest, now: Long): ByteArray {
        val packOrigin = "$ORIGIN/v1/offline"
        val publicResources = JSONArray()
        fun file(kind: String, url: String) {
            val body = body(url)
            publicUrls.add(url)
            publicResources.put(
                JSONObject()
                    .put("kind", kind)
                    .put("url", url)
                    .put("bytes", body.size)
                    .put("sha256", sha256Hex(body))
            )
        }
        file("discovery", "$MAP_PATH/manifest.json")
        file("profile", "$MAP_PATH/webview-v1/manifest.json")

        val list = JSONArray()
        val bodies = HashMap<String, ByteArray>()
        fun pack(
            id: String,
            kind: OfflinePackKind,
            url: String,
            entries: List<OfflinePackBuilder.Entry>,
            extra: JSONObject.() -> Unit = {},
        ) {
            val data = OfflinePackBuilder.build(kind, entries)
            bodies[url] = data
            list.put(
                JSONObject()
                    .put("id", id)
                    .put("kind", if (kind == OfflinePackKind.TILES) "tiles" else "documents")
                    .put("url", url)
                    .put("bytes", data.size)
                    .put("resources", entries.size)
                    .put("billableResources", entries.size)
                    .apply(extra)
            )
        }
        val template = template(release)
        if (!documentsPublicOnly) {
            file("landmark", "$ORIGIN/landmarks/2026-10/notice.txt")
            val styles =
                request.themes.map { theme ->
                    OfflinePackBuilder.Entry(
                        "$MAP_PATH/webview-v1/v$deployment/$theme.json",
                        "application/json",
                        null,
                        """{"version":8,"theme":"$theme","deployment":$deployment}""".toByteArray(),
                    )
                } +
                    OfflinePackBuilder.Entry(
                        "$ORIGIN/tiles/world/tiles.json?map=$MAP_ID",
                        "application/json",
                        null,
                        """{"tilejson":"3.0.0","tiles":["$template"]}""".toByteArray(),
                    )
            pack("style", OfflinePackKind.DOCUMENTS, "$packOrigin/documents/style.tfpack", styles)
            pack(
                "glyphs/Noto Sans Regular/0",
                OfflinePackKind.DOCUMENTS,
                "$packOrigin/documents/glyphs/Noto%20Sans%20Regular/0.tfpack",
                listOf(
                    OfflinePackBuilder.Entry(
                        "$ORIGIN/fonts/Noto%20Sans%20Regular/0-255.pbf",
                        "application/x-protobuf",
                        null,
                        "glyphs".toByteArray(),
                    )
                ),
            )
        }

        val anchors = LinkedHashMap<OfflineTileId, MutableList<OfflineTileId>>()
        var count = 0
        zooms@ for (zoom in request.minZoom..request.maxZoom) {
            val cover = OfflineTileCover(request.region, zoom)
            val rows = cover.rows ?: continue
            for (y in rows) for (xs in cover.row(y)) for (x in xs) {
                if (tileLimit?.let { count >= it } == true) break@zooms
                val tile = OfflineTileId(zoom, x, y)
                anchors.getOrPut(tile.ancestor(OfflinePackBand.anchor(zoom))) { mutableListOf() }
                    .add(tile)
                count += 1
            }
        }
        for ((anchor, tiles) in anchors) {
            val band = OfflinePackBand.zooms(anchor.z)!!
            val zooms = maxOf(band.first, request.minZoom)..minOf(band.last, request.maxZoom)
            pack(
                "tiles/world/${anchor.z}/${anchor.x}/${anchor.y}",
                OfflinePackKind.TILES,
                "$packOrigin/tiles/world/r$release/${anchor.z}/${anchor.x}/${anchor.y}.tfpack",
                tiles.map {
                    OfflinePackBuilder.Entry(
                        it.name,
                        "application/x-protobuf",
                        "gzip",
                        OfflinePackBuilder.gzip(tile(it)),
                    )
                },
            ) {
                put("source", "world")
                put("anchor", JSONArray().put(anchor.z).put(anchor.x).put(anchor.y))
                put("zooms", JSONArray().put(zooms.first).put(zooms.last))
            }
        }
        val packList = (0 until list.length()).map { list.getJSONObject(it) }
        billable = packList.sumOf { it.getLong("billableResources") }
        val resources = packList.sumOf { it.getLong("resources") } + publicResources.length()
        val bytes =
            packList.sumOf { it.getLong("bytes") } +
                (0 until publicResources.length()).sumOf {
                    publicResources.getJSONObject(it).getLong("bytes")
                }
        grants.clear()
        val grant = "tf_offline_v2.g${creations.get()}.sig"
        grants[grant] = (now + 86_400_000) to 0
        packs[grant] = bodies
        val manifest =
            JSONObject()
                .put("version", 2)
                .put("downloadId", "odl_" + "%022d".format(creations.get()))
                .put("mapId", request.mapId)
                .put("profile", request.profile)
                .put("deploymentVersion", deployment)
                .put("themes", JSONArray(request.themes))
                .put("region", request.region.toJson())
                .put("minZoom", request.minZoom)
                .put("maxZoom", request.maxZoom)
                .put("terrainMaxZoom", request.terrainMaxZoom)
                .put("createdAt", date(now))
                .put(
                    "sources",
                    JSONArray()
                        .put(
                            JSONObject()
                                .put("source", "world")
                                .put("version", "r$release")
                                .put("template", template)
                                .put("zooms", JSONArray().put(request.minZoom).put(request.maxZoom))
                                .put("contentType", "application/x-protobuf")
                                .put("contentEncoding", "gzip")
                                .put("absentStatus", 404)
                        ),
                )
                .put("packs", list)
                .put("publicResources", publicResources)
                .put("origins", JSONArray().put(ORIGIN))
                .put("excluded", JSONArray())
                .put(
                    "totals",
                    JSONObject()
                        .put("packs", list.length())
                        .put("resources", resources)
                        .put("billableResources", billable)
                        .put("bytes", bytes),
                )
                .put(
                    "attribution",
                    JSONObject()
                        .put(
                            "sources",
                            JSONArray()
                                .put(
                                    JSONObject()
                                        .put("source", "world")
                                        .put("text", "OpenStreetMap")
                                        .put(
                                            "regionalObligations",
                                            JSONArray()
                                                .put(
                                                    JSONObject()
                                                        .put("id", "es-ign")
                                                        .put("exact", "IGN España")
                                                        .put("href", "https://www.ign.es")
                                                        .put(
                                                            "regions",
                                                            JSONArray()
                                                                .put(JSONArray("[-9.4,35.9,4.4,43.8]")),
                                                        )
                                                ),
                                        )
                                ),
                        ),
                )
                .put(
                    "limits",
                    JSONObject()
                        .put("maxPackResources", maximumPackResources)
                        .put("dailyDownloads", 200_000)
                        .put("teamDailyDownloads", 200_000),
                )
                .put(
                    "revalidation",
                    JSONObject()
                        .put("url", "$ORIGIN/v1/offline/packs/revalidate")
                        .put("intervalSeconds", 86_400),
                )
                .put("download", JSONObject().put("expiresAt", date(now + 86_400_000)))
        return JSONObject()
            .put("version", 2)
            .put("kind", "offline_download")
            .put("grant", grant)
            .put("manifest", manifest)
            .toString()
            .toByteArray()
    }

    // OfflineResourceFetching.

    override suspend fun fetch(request: OfflineFetchRequest): OfflineFetchResponse {
        val url = request.url.toASCIIString()
        val context = currentCoroutineContext()
        var freeze = false
        val response =
            synchronized(lock) {
                // A request cancelled before a test changes the stub never reaches it.
                if (!context.isActive) return@synchronized null
                if (!online) return@synchronized null
                if (freezeAfter?.let { downloads.size >= it } == true) {
                    freeze = true
                    return@synchronized null
                }
                respond(url, request.headers, request.destination)
            }
        currentCoroutineContext().ensureActive()
        if (freeze) {
            delay(Long.MAX_VALUE)
            error("unreachable")
        }
        return response ?: throw IOException("offline")
    }

    private fun respond(
        url: String,
        headers: Map<String, String>,
        destination: File?,
    ): OfflineFetchResponse {
        val count = downloads.size + 1
        fun record(response: OfflineFetchResponse): OfflineFetchResponse {
            downloads.add(Download(url, headers, response.status))
            onDownload?.invoke(count)
            return response
        }
        fun refusal(status: Int, code: String) =
            OfflineFetchResponse(
                status,
                mapOf("Cache-Control" to "no-store"),
                """{"code":"$code","error":"refused"}""".toByteArray(),
                null,
                null,
            )
        refuseOnce
            ?.takeIf { it.at == count }
            ?.let { refused ->
                refuseOnce = null
                return record(
                    OfflineFetchResponse(
                        refused.status,
                        listOfNotNull(
                                "Cache-Control" to "no-store",
                                refused.retryAfter?.let { "Retry-After" to it },
                            )
                            .toMap(),
                        """{"code":"${refused.code}","error":"refused"}""".toByteArray(),
                        null,
                        null,
                    )
                )
            }
        if (url.endsWith(".tfpack")) {
            val grant = headers[GRANT] ?: ""
            val entry = grants[grant]
            var expired = entry == null || clock.get() >= entry.first
            val limit = expireGrantAfter
            if (entry != null && limit != null && entry.second >= limit) {
                expireGrantAfter = null
                grants.remove(grant)
                expired = true
            }
            if (expired) return record(refusal(401, "OFFLINE_PACK_GRANT_EXPIRED"))
            grants[grant] = entry!!.first to entry.second + 1
            val data =
                packs[grant]?.get(url)?.copyOf()
                    ?: return record(refusal(403, "OFFLINE_PACK_RESOURCE_DENIED"))
            val etag = "\"${data.copyOfRange(data.size - 32, data.size).joinToString("") { "%02x".format(it) }}\""
            val responseHeaders =
                mapOf(
                    "ETag" to etag,
                    "Cache-Control" to "private, no-cache, no-transform",
                    "Content-Type" to OfflinePackFormat.MEDIA_TYPE,
                )
            if (headers["If-None-Match"] == etag)
                return record(OfflineFetchResponse(304, responseHeaders, ByteArray(0), 0, null))
            val scratch = File.createTempFile("pack", ".tfpack")
            try {
                scratch.writeBytes(data)
                val index = OfflinePackFormat.index(scratch)
                for (item in index.entries.values) {
                    val raw = OfflinePackFormat.body(item, scratch)
                    val address =
                        when {
                            index.kind == OfflinePackKind.DOCUMENTS -> item.name
                            "/r$release/" in url ->
                                tileUrl(OfflineTileId.ofName(item.name)!!)
                            else -> null
                        } ?: continue
                    served[address] =
                        if (item.contentEncoding == "gzip") OfflinePackFormat.gunzip(raw) else raw
                }
            } finally {
                scratch.delete()
            }
            if (corruptPacks > 0) {
                corruptPacks -= 1
                data[data.size / 2] = (data[data.size / 2].toInt() xor 0xff).toByte()
            }
            destination!!.parentFile?.mkdirs()
            destination.writeBytes(data)
            return record(
                OfflineFetchResponse(200, responseHeaders, ByteArray(0), data.size.toLong(), null)
            )
        }
        val body = body(url)
        val etag = "\"${sha256Hex(body)}\""
        if (headers["If-None-Match"] == etag)
            return record(OfflineFetchResponse(304, mapOf("ETag" to etag), ByteArray(0), 0, null))
        if (url.startsWith("https://tiles.example.com/streets/") && "/14/" in url)
            return record(OfflineFetchResponse(404, emptyMap(), ByteArray(0), 0, null))
        if (url in publicUrls) served[url] = body
        return record(
            OfflineFetchResponse(
                200,
                mapOf(
                    "ETag" to etag,
                    "Cache-Control" to "private, no-cache",
                    "Content-Type" to "application/octet-stream",
                ),
                body,
                body.size.toLong(),
                sha256Hex(body),
            )
        )
    }

    companion object {
        const val MAP_ID = "map_offlineofflineof"
        const val ORIGIN = "https://api.tileflow.test"
        const val GRANT = "X-Tileflow-Offline-Grant"
        const val MAP_PATH = "$ORIGIN/maps/$MAP_ID/mobile"

        fun template(release: Int) = "$ORIGIN/tiles/world/r$release/{z}/{x}/{y}.pbf?map=$MAP_ID"

        fun date(millis: Long): String =
            SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
                .apply { timeZone = TimeZone.getTimeZone("UTC") }
                .format(millis)
    }
}

/**
 * The service's pack fixture as a service: its creation answer and packs for the current release,
 * with each pack's digest as `ETag` and `If-None-Match` answered with 304.
 */
internal class OfflinePlatformFixture : NativeHTTPTransporting, OfflineResourceFetching {
    class Pack(val id: String, val url: String, val file: String, val bytes: Long, val etag: String)

    @Volatile var release = 1
    val downloads = CopyOnWriteArrayList<OfflineServiceStub.Download>()

    fun packs(release: Int): List<Pack> {
        val list = JSONObject(text("release-$release/packs.json")).getJSONArray("packs")
        return (0 until list.length()).map {
            val item = list.getJSONObject(it)
            Pack(
                item.getString("id"),
                item.getString("url"),
                item.getString("file"),
                item.getLong("bytes"),
                item.getString("etag"),
            )
        }
    }

    fun manifest(release: Int): OfflineDownloadManifest =
        OfflinePackContract.download(text("release-$release/create-response.json").toByteArray(), request, false)
            .manifest

    override fun send(request: Request, timeoutMillis: Long): ResourcePayload =
        if (request.url.encodedPath.endsWith("/revalidate"))
            ResourcePayload(
                """{"state":"current","checkedAt":"2026-10-30T12:00:00.000Z","intervalSeconds":86400}"""
                    .toByteArray(),
                200,
                emptyMap(),
            )
        else ResourcePayload(text("release-$release/create-response.json").toByteArray(), 201, emptyMap())

    override fun cancelActive() {}

    override fun close() {}

    override suspend fun fetch(request: OfflineFetchRequest): OfflineFetchResponse {
        val url = request.url.toASCIIString()
        val pack = packs(release).firstOrNull { it.url == url }
        val response =
            when {
                pack != null -> {
                    val headers = mapOf("ETag" to pack.etag, "Content-Type" to OfflinePackFormat.MEDIA_TYPE)
                    if (request.headers["If-None-Match"] == pack.etag)
                        OfflineFetchResponse(304, headers, ByteArray(0), 0, null)
                    else {
                        file(pack.file).copyTo(request.destination!!, overwrite = true)
                        OfflineFetchResponse(200, headers, ByteArray(0), pack.bytes, null)
                    }
                }
                url.endsWith("/mobile/manifest.json") -> {
                    val body = "{}".toByteArray()
                    OfflineFetchResponse(200, mapOf("ETag" to "\"${sha256Hex(body)}\""), body, 2, sha256Hex(body))
                }
                else -> OfflineFetchResponse(404, emptyMap(), ByteArray(0), 0, null)
            }
        downloads.add(OfflineServiceStub.Download(url, request.headers, response.status))
        return response
    }

    companion object {
        const val MAP_ID = "map_offlinefixture00"
        /** The fixture's creation time. */
        const val NOW = 1_793_361_600_000L

        val request: OfflinePackRequest =
            OfflinePackRequest.requests(
                MAP_ID,
                listOf("default"),
                TileflowOfflineGeometry.BoundingBox(
                    dev.tileflow.configuration.TileflowBoundingBox(-3.71, 40.41, -3.69, 40.425)
                ),
                OfflineZooms(10..14),
            )[0]

        /** A file of the service's pack fixture, generated by its own code. */
        fun file(path: String): File =
            File(OfflinePlatformFixture::class.java.classLoader!!.getResource("packs-v2/$path")!!.toURI())

        private fun text(path: String) = file(path).readText()
    }
}
