package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.transport.MapResourceAddress
import dev.tileflow.sdk.transport.ResourcePolicy
import java.net.URI
import org.json.JSONObject

/** The theme of a map that a renderer draws, from the map's manifest. */
internal class NativeMapDocument(
    /** The theme's style address. */
    val styleUrl: String,
    /** The theme's name. */
    val theme: String,
    /** The map's authored view, when it declares one. */
    val view: TileflowCamera?,
)

/**
 * Reads a map's manifest and selects its theme. A self-hosted source's address is its manifest. A
 * Hosted source's address is its mobile discovery document, which names the Map and the manifest
 * of each delivery profile.
 */
internal object NativeManifest {
    /** The delivery profile read from Hosted discovery. */
    private const val PROFILE = "webview-v1"

    /**
     * The document of [source] (`{map, manifestUrl, discoveryMapId?}`, as the view sends it) for
     * [theme]: null selects the map's default, `system` its theme for [colorScheme]. [load] reads
     * a document through the map's transport and throws unless it answered 200.
     */
    fun resolve(
        source: JSONObject,
        theme: String?,
        colorScheme: String,
        load: (URI) -> ByteArray,
    ): NativeMapDocument {
        var manifestUrl = source.getString("manifestUrl")
        val discoveryMapId = source.optString("discoveryMapId").takeIf { it.isNotEmpty() }
        if (discoveryMapId != null) {
            val discovery = document(manifestUrl, load)
            val representation =
                discovery.optJSONObject("representations")?.optJSONObject(PROFILE)
            val next = representation?.optString("manifestUrl")?.takeIf { it.isNotEmpty() }
            if (discovery.optString("mapId") != discoveryMapId || next == null)
                throw failure(manifestUrl, message = "The Map has no delivery profile to draw.")
            manifestUrl = MapResourceAddress.resolve(manifestUrl, next)
        }
        val manifest = document(manifestUrl, load)
        val map =
            manifest.optJSONObject("maps")?.optJSONObject(source.getString("map"))
                ?: throw failure(manifestUrl, message = "The map is not in its manifest.")
        val themes =
            map.optJSONObject("themes")
                ?: throw failure(manifestUrl, message = "The map has no themes.")
        val name =
            when (theme) {
                null ->
                    map.optString("defaultTheme").ifEmpty {
                        themes.keys().asSequence().firstOrNull()
                    }
                "system" ->
                    map.optJSONObject("systemThemes")?.optString(colorScheme)?.ifEmpty { null }
                        ?: themes.keys().asSequence().firstOrNull {
                            themes.optJSONObject(it)?.optString("colorScheme") == colorScheme
                        }
                        ?: map.optString("defaultTheme")
                else -> theme
            }
        val styleUrl =
            name
                ?.let { themes.optJSONObject(it) }
                ?.optString("styleUrl")
                ?.takeIf { it.isNotEmpty() }
                ?: throw failure(
                    manifestUrl,
                    resource = TileflowResourceKind.STYLE,
                    message = "The map has no theme named ${name ?: "default"}.",
                )
        return NativeMapDocument(
            MapResourceAddress.resolve(manifestUrl, styleUrl),
            name,
            map.optJSONObject("view")?.let(::view),
        )
    }

    /** Reads a JSON document, failing with the kind of resource it is. */
    fun document(
        url: String,
        load: (URI) -> ByteArray,
        resource: TileflowResourceKind = TileflowResourceKind.MANIFEST,
    ): JSONObject {
        val uri = runCatching { URI(url) }.getOrNull() ?: throw failure(url, resource)
        return try {
            JSONObject(String(load(uri), Charsets.UTF_8))
        } catch (error: TileflowMapException) {
            throw error
        } catch (error: NativeResourceStatus) {
            throw failure(url, resource, error.status)
        } catch (error: Exception) {
            throw failure(url, resource)
        }
    }

    private fun view(value: JSONObject): TileflowCamera? {
        val center = value.optJSONArray("center") ?: return null
        val camera =
            TileflowCamera(
                center.optDouble(0),
                center.optDouble(1),
                value.optDouble("zoom", 0.0),
                value.optDouble("bearing", 0.0),
                value.optDouble("pitch", 0.0),
            )
        return camera.takeIf {
            it.longitude in -180.0..180.0 && it.latitude in -90.0..90.0 && it.zoom in 0.0..24.0
        }
    }

    private fun failure(
        url: String,
        resource: TileflowResourceKind = TileflowResourceKind.MANIFEST,
        status: Int? = null,
        message: String? = null,
    ) =
        TileflowMapException(
            TileflowErrorCode.RESOURCE_FAILED,
            TileflowErrorContext(
                resource = resource,
                origin = runCatching { ResourcePolicy.origin(URI(url)) }.getOrNull(),
                status = status,
                message = message,
            ),
        )
}

/** A document answered with [status] instead of 200. */
internal class NativeResourceStatus(val status: Int) : Exception("Answered $status")
