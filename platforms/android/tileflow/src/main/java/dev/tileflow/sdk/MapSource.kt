package dev.tileflow.sdk

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowConfigurationException
import dev.tileflow.sdk.hosted.HostedContract
import dev.tileflow.sdk.hosted.HostedEndpoint
import dev.tileflow.sdk.transport.ResourcePolicy
import java.net.URI
import org.json.JSONObject

public data class TileflowRenderedFeature(val id: String?, val source: String, val layer: String)

/**
 * The map a view shows: a Hosted map selected by its ID with [hosted], or a versioned manifest you
 * serve, the same manifest the web adapters use.
 */
@ConsistentCopyVisibility
public data class TileflowMapSource
internal constructor(
    val map: String,
    /**
     * The manifest of a map you serve. Null for a Hosted map, whose manifest the configured API
     * origin serves.
     */
    val manifestUrl: URI?,
    val resourceOrigins: Set<URI>,
    val allowsLoopbackHttp: Boolean,
    /** The ID of a Hosted map. Null for a manifest you serve. */
    val mapId: String?,
    internal val surfaceId: String?,
    internal val configuration: TileflowConfiguration?,
) {
    /** A map in a versioned manifest you serve. It needs no credential. */
    public constructor(
        map: String,
        manifestUrl: URI,
        resourceOrigins: Set<URI> = emptySet(),
        allowsLoopbackHttp: Boolean = false,
    ) : this(map, manifestUrl, resourceOrigins.toSet(), allowsLoopbackHttp, null, null, null)

    /** Checks what does not depend on the configuration. */
    internal fun validate() {
        require(map.isNotBlank() && map.length <= 128)
        if (mapId != null) {
            require(Regex("^map_[A-Za-z0-9_-]{16}$").matches(mapId))
            require(
                surfaceId != null &&
                    Regex("^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$").matches(surfaceId) &&
                    !HostedContract.secretShaped(surfaceId)
            )
        }
        policy(manifestUrl)
    }

    private fun policy(manifestUrl: URI?): ResourcePolicy {
        val urls = resourceOrigins + listOfNotNull(manifestUrl)
        val policy = ResourcePolicy(urls.map(ResourcePolicy::origin).toSet(), allowsLoopbackHttp)
        urls.forEach(policy::validate)
        return policy
    }

    /**
     * What a view loads. A Hosted map reads its endpoint from [configuration], or else from
     * [fallback], which is the process configuration outside tests.
     *
     * @throws TileflowMapException with [TileflowErrorCode.MISSING_CREDENTIAL] or
     *   [TileflowErrorCode.INVALID_CONFIGURATION].
     */
    internal fun loadable(fallback: () -> TileflowConfiguration): LoadableMapSource {
        validate()
        var hosted: HostedEndpoint? = null
        var manifest = manifestUrl
        val publicMetadataUrls = mutableSetOf<URI>()
        if (mapId != null) {
            val resolved =
                configuration
                    ?: try {
                        fallback()
                    } catch (_: TileflowConfigurationException) {
                        throw TileflowMapException(TileflowErrorCode.INVALID_CONFIGURATION)
                    }
            val endpoint = HostedEndpoint(resolved)
            hosted = endpoint
            manifest = endpoint.manifestUrl(mapId)
            publicMetadataUrls += endpoint.discoveryUrl(mapId)
        }
        val url = requireNotNull(manifest)
        publicMetadataUrls += url
        return LoadableMapSource(
            map,
            url,
            mapId,
            surfaceId,
            policy(url),
            publicMetadataUrls,
            hosted,
        )
    }

    public companion object {
        /**
         * A Hosted map, selected by its ID.
         *
         * When the map loads, it reads its credential and API origin from [configuration], or
         * else from `Tileflow.configuration(context)`: the configuration set with
         * `Tileflow.configure`, or else the `tileflow_map_credential` and `tileflow_api_origin`
         * string resources. Only the map credential authorizes a map; a services credential never
         * does. Without a map credential the map fails with
         * [TileflowErrorCode.MISSING_CREDENTIAL], and with an unreadable configuration with
         * [TileflowErrorCode.INVALID_CONFIGURATION].
         *
         * @param mapId The map's ID, such as `map_0123456789abcdef`.
         * @param surfaceId A stable name for where the application shows the map, which divides
         *   the map's session analytics when it appears in several places.
         * @param publicResourceOrigins Origins of public resources the map's styles use. They
         *   never receive a Hosted grant.
         * @param configuration Overrides the process configuration for this map.
         */
        @JvmStatic
        @JvmOverloads
        public fun hosted(
            mapId: String,
            surfaceId: String = "mobile-map",
            publicResourceOrigins: Set<URI> = emptySet(),
            configuration: TileflowConfiguration? = null,
        ): TileflowMapSource =
            TileflowMapSource(
                "map",
                null,
                publicResourceOrigins.toSet(),
                false,
                mapId,
                surfaceId,
                configuration,
            )
    }
}

/**
 * A source with its configuration read: the manifest, resource policy and Hosted endpoint a view
 * loads. A view keeps it, and its Hosted session, until its source changes.
 */
internal class LoadableMapSource(
    val map: String,
    val manifestUrl: URI,
    val mapId: String?,
    val surfaceId: String?,
    val policy: ResourcePolicy,
    val publicMetadataUrls: Set<URI>,
    val hosted: HostedEndpoint?,
)

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
