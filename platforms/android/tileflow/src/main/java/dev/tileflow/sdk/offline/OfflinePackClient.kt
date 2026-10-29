@file:OptIn(TileflowInternalApi::class)

package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.configuration.internal.TileflowInternalApi
import dev.tileflow.configuration.internal.credentialHeader
import dev.tileflow.configuration.internal.tileflowApiOrigin
import dev.tileflow.sdk.hosted.HostedContract
import dev.tileflow.sdk.transport.NativeHTTPTransport
import dev.tileflow.sdk.transport.NativeHTTPTransporting
import dev.tileflow.sdk.transport.ResourcePayload
import java.net.URI
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/**
 * The zooms a region downloads, with the per-product limits Hosted packs apply.
 *
 * World stops at its deepest zoom, 15, which has layers no other zoom has; deeper pack zooms
 * overzoom World and add only sources that go deeper, such as Team Tilesets. Terrain stops at zoom
 * 12 unless a region opts in to 13 or 14, which hold most of a pack's bytes.
 */
internal data class OfflineZooms(
    val range: IntRange = 0..WORLD_MAXIMUM,
    val terrainMaximum: Int = DEFAULT_TERRAIN_MAXIMUM,
) {
    init {
        if (range.first < 0 || range.last > MAXIMUM || range.isEmpty())
            throw TileflowOfflineException.options("invalidZoom")
        if (terrainMaximum !in 0..MAXIMUM)
            throw TileflowOfflineException.options("invalidTerrainZoom")
    }

    /**
     * A source's zooms in a pack: clamped to its own range, so deeper pack zooms overzoom its
     * deepest tiles. Null when every pack zoom is below its minimum, where it draws nothing.
     */
    fun zooms(sourceMinimum: Int, sourceMaximum: Int): IntRange? {
        if (range.last < sourceMinimum) return null
        val low = range.first.coerceAtLeast(sourceMinimum).coerceAtMost(sourceMaximum)
        return low..minOf(range.last, sourceMaximum)
    }

    companion object {
        const val MAXIMUM = 22
        const val WORLD_MAXIMUM = 15
        const val DEFAULT_TERRAIN_MAXIMUM = 12
    }
}

/** The renderer whose styles a pack holds. */
internal enum class OfflinePackProfile(val wireName: String) {
    WEB_VIEW("webview-v1"),
    NATIVE("native-v1"),
}

/** One `POST /v1/offline/packs` body in the service's canonical form. */
internal data class OfflinePackRequest(
    val mapId: String,
    val profile: String,
    /** Distinct and sorted, as the service returns them. */
    val themes: List<String>,
    val region: OfflinePackRegion,
    val minZoom: Int,
    val maxZoom: Int,
    val terrainMaxZoom: Int,
) {
    val body: ByteArray
        get() =
            JSONObject()
                .put("mapId", mapId)
                .put("profile", profile)
                .put("themes", JSONArray(themes))
                .put("region", region.toJson())
                .put("minZoom", minZoom)
                .put("maxZoom", maxZoom)
                .put("terrainMaxZoom", terrainMaxZoom)
                .toString()
                .toByteArray()

    companion object {
        const val MAXIMUM_BODY_BYTES = 65_536

        /**
         * One request for each pack the options need: a corridor or a box across the antimeridian
         * downloads as several packs.
         */
        /** Reads a body this SDK wrote with [body]. */
        fun fromJson(bytes: ByteArray): OfflinePackRequest? =
            runCatching {
                    val value = JSONObject(String(bytes, Charsets.UTF_8))
                    val themes = value.getJSONArray("themes")
                    OfflinePackRequest(
                        value.getString("mapId"),
                        value.getString("profile"),
                        List(themes.length()) { themes.getString(it) },
                        OfflinePackRegion.fromJson(value.getJSONObject("region"))!!,
                        value.getInt("minZoom"),
                        value.getInt("maxZoom"),
                        value.getInt("terrainMaxZoom"),
                    )
                }
                .getOrNull()

        fun requests(
            mapId: String,
            themes: List<String>,
            geometry: TileflowOfflineGeometry,
            zooms: OfflineZooms,
            profile: OfflinePackProfile = OfflinePackProfile.WEB_VIEW,
        ): List<OfflinePackRequest> {
            if (!Regex("^map_[A-Za-z0-9_-]{16}$").matches(mapId))
                throw TileflowOfflineException.options("invalidMapID")
            val sorted = themes.distinct().sorted()
            if (
                themes.size !in 1..4 ||
                    sorted.size != themes.size ||
                    sorted.any { !Regex("^[A-Za-z][A-Za-z0-9_-]{0,63}$").matches(it) }
            )
                throw TileflowOfflineException.options("invalidThemes")
            return geometry.packRegions().map {
                OfflinePackRequest(
                        mapId,
                        profile.wireName,
                        sorted,
                        it,
                        zooms.range.first,
                        zooms.range.last,
                        zooms.terrainMaximum,
                    )
                    .also { request ->
                        if (request.body.size > MAXIMUM_BODY_BYTES)
                            throw TileflowOfflineException.region("tooManyPositions")
                    }
            }
        }
    }
}

/**
 * Creates and revalidates Hosted offline packs.
 *
 * Creation presents the map credential exactly as a Hosted map's session start does, in
 * `X-Tileflow-Mobile-Client`, and nothing else. Revalidation presents only the pack grant. Requests
 * are never retried: each refusal comes back as a typed error, with the wait the service asked for,
 * and cancelling the calling coroutine cancels the request. A configuration without a map
 * credential can still revalidate packs.
 */
internal class OfflinePackClient(
    configuration: TileflowConfiguration,
    private val transports: () -> NativeHTTPTransporting = {
        NativeHTTPTransport(OfflinePackContract.MAXIMUM_RESPONSE_BYTES)
    },
    private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
    private val now: () -> Long = System::currentTimeMillis,
) {
    val apiOrigin: URI =
        tileflowApiOrigin(configuration.apiOrigin)?.takeIf {
            it.scheme == "http" || HostedContract.canonicalOrigin(it.toString())
        } ?: throw TileflowOfflineException(TileflowOfflineErrorCode.INVALID_CONFIGURATION)
    val allowsLoopbackHttp: Boolean = apiOrigin.scheme == "http"
    private val credential: TileflowCredential? = configuration.mapCredential

    suspend fun create(request: OfflinePackRequest): OfflinePack {
        val credential =
            credential
                ?: throw TileflowOfflineException(TileflowOfflineErrorCode.MISSING_CREDENTIAL)
        val response =
            send(
                post("/v1/offline/packs", request.body)
                    .credentialHeader("X-Tileflow-Mobile-Client", credential)
                    .build()
            )
        if (response.status != 201) throw failure(response, OfflinePackContract.Operation.CREATE)
        return OfflinePackContract.pack(response.bytes, request, allowsLoopbackHttp)
    }

    suspend fun revalidate(grant: OfflinePackGrant): OfflinePackRevalidation {
        val body = JSONObject().put("grant", grant.value).toString().toByteArray()
        val response = send(post("/v1/offline/packs/revalidate", body).build())
        if (response.status != 200)
            throw failure(response, OfflinePackContract.Operation.REVALIDATE)
        return OfflinePackContract.revalidation(response.bytes)
    }

    private fun post(path: String, body: ByteArray): Request.Builder =
        Request.Builder()
            .url(apiOrigin.resolve(path).toASCIIString())
            .post(body.toRequestBody("application/json".toMediaType()))

    /** A blocking exchange on [dispatcher]; cancellation closes its transport, which stops it. */
    private suspend fun send(request: Request): ResourcePayload {
        val transport = transports()
        try {
            return coroutineScope {
                val exchange = async(dispatcher) { transport.send(request, 30_000) }
                try {
                    exchange.await()
                } catch (error: CancellationException) {
                    transport.close()
                    throw error
                }
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw TileflowOfflineException(TileflowOfflineErrorCode.NETWORK)
        } finally {
            transport.close()
        }
    }

    private fun failure(response: ResourcePayload, operation: OfflinePackContract.Operation) =
        OfflinePackContract.failure(
            response.status,
            response.bytes,
            response.headers["Retry-After"],
            operation,
            now(),
        )
}
