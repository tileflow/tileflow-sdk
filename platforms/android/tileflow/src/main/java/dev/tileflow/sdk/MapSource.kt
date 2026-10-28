package dev.tileflow.sdk

import dev.tileflow.sdk.transport.ResourcePolicy
import java.net.URI
import org.json.JSONObject

public data class TileflowRenderedFeature(val id: String?, val source: String, val layer: String)

/** One logical Tileflow map, using the same manifest as the web adapters. */
@ConsistentCopyVisibility
public data class TileflowMapSource
internal constructor(
    val map: String,
    val manifestUrl: URI,
    val resourceOrigins: Set<URI>,
    val allowsLoopbackHttp: Boolean,
    internal val client: TileflowClient?,
    internal val mapId: String?,
    internal val surfaceId: String?,
) {
    public constructor(
        map: String,
        manifestUrl: URI,
        resourceOrigins: Set<URI> = emptySet(),
        allowsLoopbackHttp: Boolean = false,
    ) : this(map, manifestUrl, resourceOrigins.toSet(), allowsLoopbackHttp, null, null, null)

    internal val publicMetadataUrls: Set<URI>
        get() =
            if (client != null && mapId != null)
                setOf(
                    manifestUrl,
                    client.apiOrigin.resolve("/maps/$mapId/mobile/webview-v1/manifest.json"),
                )
            else setOf(manifestUrl)

    internal fun policy(): ResourcePolicy {
        require(map.isNotBlank() && map.length <= 128)
        val policy =
            ResourcePolicy(
                (resourceOrigins + manifestUrl).map(ResourcePolicy::origin).toSet(),
                allowsLoopbackHttp,
            )
        policy.validate(manifestUrl)
        resourceOrigins.forEach(policy::validate)
        return policy
    }
}

public data class TileflowCamera(
    val longitude: Double,
    val latitude: Double,
    val zoom: Double,
    val bearing: Double = 0.0,
    val pitch: Double = 0.0,
) {
    internal fun json(): JSONObject =
        JSONObject()
            .put("longitude", longitude)
            .put("latitude", latitude)
            .put("zoom", zoom)
            .put("bearing", bearing)
            .put("pitch", pitch)

    internal companion object {
        fun from(json: JSONObject): TileflowCamera =
            TileflowCamera(
                json.getDouble("longitude"),
                json.getDouble("latitude"),
                json.getDouble("zoom"),
                json.getDouble("bearing"),
                json.getDouble("pitch"),
            )
    }
}

public enum class TileflowErrorCode {
    INVALID_SOURCE,
    MISSING_RUNTIME,
    INCOMPATIBLE_RUNTIME,
    NOT_READY,
    DISPOSED,
    TIMEOUT,
    RESOURCE_FAILED,
    RENDERER_FAILED,
    INVALID_REQUEST,
    CREDENTIAL_REJECTED,
    ACCESS_DENIED,
    QUOTA_EXCEEDED,
    RATE_LIMITED,
    SESSION_UNAVAILABLE,
    INVALID_SESSION_RESPONSE,
}

public class TileflowMapException(public val code: TileflowErrorCode) :
    Exception("Tileflow map operation failed: ${code.name}")

public sealed interface TileflowMapEvent {
    /** A user activated an attribution link. The application chooses how to present it. */
    public data class ExternalLinkRequested(val url: URI) : TileflowMapEvent

    public data class AnnotationActivated(val id: String, val coordinate: TileflowCoordinate) :
        TileflowMapEvent

    public data class PoiActivated(val selection: TileflowPoiSelection) : TileflowMapEvent

    public data object Loading : TileflowMapEvent

    /** The renderer's load event; it does not guarantee presentation by the native compositor. */
    public data object ContentReady : TileflowMapEvent

    public data class CameraChanged(val camera: TileflowCamera, val isFinal: Boolean) :
        TileflowMapEvent

    public data class Tap(val longitude: Double, val latitude: Double) : TileflowMapEvent

    public data class ThemeChanged(val theme: String) : TileflowMapEvent

    public data class Failed(val code: TileflowErrorCode) : TileflowMapEvent
}
