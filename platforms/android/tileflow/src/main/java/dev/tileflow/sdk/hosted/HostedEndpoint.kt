@file:OptIn(TileflowInternalApi::class)

package dev.tileflow.sdk.hosted

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.configuration.internal.TileflowInternalApi
import dev.tileflow.configuration.internal.credentialHeader
import dev.tileflow.configuration.internal.tileflowApiOrigin
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import java.net.URI
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Where a Hosted map starts its sessions, and the map credential it presents there. Only the map
 * credential authorizes a map; services credentials never do.
 *
 * The credential stays in native memory. It is sent only in the session-start request, never to
 * the renderer, a resource request or a URL, and [toString] never includes it.
 *
 * The API origin follows the configuration's own rule, the one the service clients use: `https`,
 * or `http` on a loopback host for local development.
 *
 * @throws TileflowMapException with [TileflowErrorCode.MISSING_CREDENTIAL] when [configuration]
 *   has no map credential, or [TileflowErrorCode.INVALID_CONFIGURATION] when its API origin breaks
 *   that rule.
 */
internal class HostedEndpoint(configuration: TileflowConfiguration) {
    private val credential: TileflowCredential =
        configuration.mapCredential
            ?: throw TileflowMapException(TileflowErrorCode.MISSING_CREDENTIAL)

    val apiOrigin: URI =
        tileflowApiOrigin(configuration.apiOrigin)?.takeIf {
            it.scheme == "http" || HostedContract.canonicalOrigin(it.toString())
        } ?: throw TileflowMapException(TileflowErrorCode.INVALID_CONFIGURATION)

    /**
     * A local development API: `http` on a loopback host. Only then may the session's resource
     * origins be loopback `http` origins too.
     */
    val isLoopbackHttp: Boolean = apiOrigin.scheme == "http"

    fun manifestUrl(mapId: String): URI = apiOrigin.resolve("/maps/$mapId/mobile/manifest.json")

    fun discoveryUrl(mapId: String): URI =
        apiOrigin.resolve("/maps/$mapId/mobile/webview-v1/manifest.json")

    fun sessionRequest(mapId: String, sessionId: String, surfaceId: String): Request {
        val body =
            JSONObject()
                .put("mapId", mapId)
                .put("sessionId", sessionId)
                .put("surfaceId", surfaceId)
                .toString()
        return Request.Builder()
            .url(apiOrigin.resolve("/v1/sessions/start").toASCIIString())
            .credentialHeader("X-Tileflow-Mobile-Client", credential)
            .post(body.toRequestBody("application/json".toMediaType()))
            .build()
    }

    override fun toString(): String = "HostedEndpoint(apiOrigin=$apiOrigin)"
}
