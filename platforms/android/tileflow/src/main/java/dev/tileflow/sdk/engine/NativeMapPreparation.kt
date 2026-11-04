package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.transport.ResourceLoader
import java.net.URI
import org.json.JSONObject

/**
 * Resolves and projects a map for a view or a snapshot, using the same profile when opening a pack.
 */
internal class NativeMapPreparation(
    val context: String,
    private val load: (URI) -> ByteArray,
    private val storedZooms: ((String) -> IntRange?)?,
) {
    class Map(
        val manifest: NativeMapManifest,
        val document: NativeMapDocument,
        val style: JSONObject,
        val projected: NativeStyleProjection,
    )

    fun map(source: JSONObject, theme: String?, colorScheme: String, fromPacks: Boolean): Map {
        var manifest = NativeManifest.read(source, load, fromPacks)
        var document = manifest.resolve(theme, colorScheme)
        val (style, projected) =
            try {
                style(document.styleUrl)
            } catch (error: TileflowMapException) {
                if (!fromPacks || manifest.representation != NativeRepresentation.NATIVE)
                    throw error
                // A cached native manifest can name a style that the older pack did not download.
                manifest = NativeManifest.read(source, load, fromPacks = true, allowsNative = false)
                document = manifest.resolve(theme, colorScheme)
                style(document.styleUrl)
            }
        return Map(manifest, document, style, projected)
    }

    fun style(url: String): Pair<JSONObject, NativeStyleProjection> {
        val style = NativeManifest.document(url, load, TileflowResourceKind.STYLE)
        return style to project(style, url)
    }

    fun project(style: JSONObject, url: String): NativeStyleProjection =
        NativeStyleDocument.project(style, url, context, load, storedZooms)

    companion object {
        fun read(loader: ResourceLoader, url: URI): ByteArray {
            val payload = loader.load(url)
            if (payload.status != 200) throw NativeResourceStatus(payload.status)
            return payload.bytes
        }
    }
}
