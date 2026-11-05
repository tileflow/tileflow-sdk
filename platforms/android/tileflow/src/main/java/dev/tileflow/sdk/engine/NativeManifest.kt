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

/** Where a map's documents come from. */
internal enum class NativeRepresentation(val wireName: String) {
    NATIVE("native-v1"),
    WEB_VIEW("webview-v1"),
    SELF_HOSTED("selfHosted"),
}

/** A map's entry in its manifest: its themes, its view and where its family document is. */
internal class NativeMapManifest(
    val map: String,
    val representation: NativeRepresentation,
    val catalog: NativeEvaluators.ThemeCatalog,
    /** Each theme's style address, by name. */
    val styles: Map<String, String>,
    val view: TileflowCamera?,
    /** A Hosted deployment's family document and its SHA-256 revision, from discovery. */
    val family: Pair<String, String?>? = null,
    private val manifestUrl: String,
) {
    /** The style of a theme the catalog resolved. */
    fun theme(name: String): NativeMapDocument =
        NativeMapDocument(
            styles[name]
                ?: throw NativeManifest.failure(
                    manifestUrl,
                    TileflowResourceKind.STYLE,
                    message = "The map has no theme named $name.",
                ),
            name,
            view,
        )

    /**
     * The theme a selection shows: null for the default, `system` by [colorScheme], and the
     * variant of a [timeOfDay]. Unknown themes fail with `resourceFailed`.
     */
    fun resolve(selection: String?, colorScheme: String, timeOfDay: String? = null) =
        try {
            theme(NativeEvaluators.theme(catalog, selection, colorScheme, timeOfDay))
        } catch (error: NativeEvaluators.Failure) {
            throw NativeManifest.failure(
                manifestUrl,
                TileflowResourceKind.STYLE,
                message = error.message,
            )
        }

    /**
     * The map's family document: the one Hosted discovery names, or the `families/<map>.json` a
     * native build writes two levels above its styles.
     */
    fun familyUrl(styleUrl: String): String? =
        when (representation) {
            NativeRepresentation.NATIVE -> family?.first
            NativeRepresentation.SELF_HOSTED -> MapResourceAddress.familyUrl(styleUrl, map)
            NativeRepresentation.WEB_VIEW -> null
        }
}

/**
 * Reads a map's manifest. A self-hosted source's address is its manifest, normally the
 * `manifest.json` that `tileflow build --renderer native` writes. A Hosted source's address is its
 * mobile discovery document, whose `native-v1` representation names the native manifest and the
 * deployment's family document. Only downloaded regions may read the older `webview-v1` representation.
 */
internal object NativeManifest {
    /**
     * The manifest of [source] (`{map, manifestUrl, discoveryMapId?}`, as the view sends it).
     * [load] reads a document through the map's transport and throws unless it answered 200;
     * [fromPacks] says the map opens from its downloaded regions; [allowsNative] false reads the
     * WebView profile even when discovery announces the native one.
     */
    fun read(
        source: JSONObject,
        load: (URI) -> ByteArray,
        fromPacks: Boolean = false,
        allowsNative: Boolean = true,
    ): NativeMapManifest {
        val manifestUrl = source.getString("manifestUrl")
        val map = source.getString("map")
        val discoveryMapId =
            source.optString("discoveryMapId").takeIf { it.isNotEmpty() }
                ?: return parse(
                    document(manifestUrl, load),
                    map,
                    manifestUrl,
                    NativeRepresentation.SELF_HOSTED,
                )
        val discovery = document(manifestUrl, load)
        val representations = discovery.optJSONObject("representations")
        if (discovery.optString("mapId") != discoveryMapId || representations == null)
            throw failure(manifestUrl, message = "The Map's discovery document is not valid.")
        fun profile(representation: NativeRepresentation): String? =
            representations
                .optJSONObject(representation.wireName)
                ?.optString("manifestUrl")
                ?.takeIf { it.isNotEmpty() }
                ?.let { MapResourceAddress.resolve(manifestUrl, it) }
        profile(NativeRepresentation.NATIVE)?.takeIf { allowsNative }?.let { native ->
            try {
                val family =
                    representations
                        .optJSONObject(NativeRepresentation.NATIVE.wireName)
                        ?.optJSONObject("family")
                val familyUrl =
                    family?.optString("url")?.takeIf { it.isNotEmpty() }?.let {
                        MapResourceAddress.resolve(manifestUrl, it)
                    }
                return parse(
                    document(native, load),
                    map,
                    native,
                    NativeRepresentation.NATIVE,
                    familyUrl?.let { it to family.optString("revision").ifEmpty { null } },
                    discoveryMapId,
                )
            } catch (error: TileflowMapException) {
                // Downloaded regions may hold the WebView profile only.
                if (!fromPacks || profile(NativeRepresentation.WEB_VIEW) == null) throw error
            }
        }
        if (!fromPacks)
            throw failure(manifestUrl, message = "This Map has no native representation.")
        val webView =
            profile(NativeRepresentation.WEB_VIEW)
                ?: throw failure(manifestUrl, message = "This Map has no native representation.")
        return parse(document(webView, load), map, webView, NativeRepresentation.WEB_VIEW,
            mapId = discoveryMapId)
    }

    /**
     * The document of [source] for [theme]: null selects the map's default, `system` its theme for
     * [colorScheme].
     */
    fun resolve(
        source: JSONObject,
        theme: String?,
        colorScheme: String,
        load: (URI) -> ByteArray,
    ): NativeMapDocument = read(source, load).resolve(theme, colorScheme)

    private fun parse(
        manifest: JSONObject,
        map: String,
        url: String,
        representation: NativeRepresentation,
        family: Pair<String, String?>? = null,
        mapId: String? = null,
    ): NativeMapManifest {
        val maps = manifest.optJSONObject("maps")
            ?: throw failure(url, message = "The map is not in its manifest.")
        val name = if (mapId == null) map else {
            maps.keys().asSequence()
                .filter { maps.optJSONObject(it)?.optString("mapId") == mapId }
                .toList().singleOrNull()
                ?: throw failure(url, message = "The manifest must contain exactly one entry for the Map's identity.")
        }

        val entry =
            maps.optJSONObject(name)
                ?: throw failure(url, message = "The map is not in its manifest.")
        val themes =
            entry.optJSONObject("themes") ?: throw failure(url, message = "The map has no themes.")
        val styles = LinkedHashMap<String, String>()
        for (name in themes.keys()) {
            val style = themes.optJSONObject(name)?.optString("styleUrl")?.takeIf { it.isNotEmpty() }
            if (style != null) styles[name] = MapResourceAddress.resolve(url, style)
        }
        fun strings(value: JSONObject?): Map<String, String>? =
            value?.let { item ->
                item.keys().asSequence().associateWith { item.optString(it) }.filterValues {
                    it.isNotEmpty()
                }
            }
        val timeOfDay =
            entry.optJSONObject("timeOfDay")?.let { families ->
                families.keys().asSequence().associateWith {
                    strings(families.optJSONObject(it)).orEmpty()
                }
            }
        return NativeMapManifest(
            name,
            representation,
            NativeEvaluators.ThemeCatalog(
                entry.optString("defaultTheme").ifEmpty { styles.keys.firstOrNull() ?: "" },
                strings(entry.optJSONObject("systemThemes")),
                timeOfDay,
                styles.keys,
            ),
            styles,
            entry.optJSONObject("view")?.let(::view),
            family,
            url,
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

    fun failure(
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
