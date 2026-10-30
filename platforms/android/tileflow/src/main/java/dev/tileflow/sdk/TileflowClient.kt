package dev.tileflow.sdk

import dev.tileflow.sdk.hosted.HostedContract
import java.net.URI
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/** Application-owned Hosted configuration. Reuse one client outside view construction. */
public class TileflowClient(public val apiOrigin: URI, private val mobileCredential: String) {
    init {
        require(HostedContract.canonicalOrigin(apiOrigin.toString()))
        require(Regex("^tf_public_[0-9a-f]{48}$").matches(mobileCredential))
    }

    /** Additional origins are public resources; they never receive a Hosted grant. */
    public fun map(
        mapId: String,
        surfaceId: String = "mobile-map",
        publicResourceOrigins: Set<URI> = emptySet(),
    ): TileflowMapSource {
        require(Regex("^map_[A-Za-z0-9_-]{16}$").matches(mapId))
        require(Regex("^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$").matches(surfaceId))
        require(!HostedContract.secretShaped(surfaceId))
        return TileflowMapSource(
            "map",
            apiOrigin.resolve("/maps/$mapId/mobile/manifest.json"),
            publicResourceOrigins.toSet(),
            allowsLoopbackHttp = false,
            client = this,
            mapId = mapId,
            surfaceId = surfaceId,
        )
    }

    override fun toString(): String = "TileflowClient"

    internal fun sessionRequest(mapId: String, sessionId: String, surfaceId: String): Request {
        val body =
            JSONObject()
                .put("mapId", mapId)
                .put("sessionId", sessionId)
                .put("surfaceId", surfaceId)
                .toString()
        return Request.Builder()
            .url(apiOrigin.resolve("/v1/sessions/start").toASCIIString())
            .header("X-Tileflow-Mobile-Client", mobileCredential)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
    }
}
