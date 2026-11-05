package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.boundaries.BoundaryLookupDescriptor
import dev.tileflow.sdk.transport.MapResourceAddress
import dev.tileflow.sdk.transport.ResourcePolicy
import java.net.URI
import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

/** A style document as MapLibre Native receives it, with what the map needs to know about it. */
internal class NativeStyleProjection(
    /** The document MapLibre draws: every resource address is a transport address. */
    val style: JSONObject,
    /** The distinct attribution of the style's sources, in style order. */
    val attributions: List<String>,
    /** Each layer's source, by layer identifier, in style order. */
    val layerSources: LinkedHashMap<String, String>,
    /** Remote address prefixes and the kind of resource they serve. */
    private val kinds: List<Pair<String, TileflowResourceKind>>,
    /** What the style asks for that MapLibre Native cannot draw from it, such as `text`. */
    val omitted: List<String> = emptyList(),
    /** Lookup resources of the release this style draws, loaded only on request. */
    val boundaryLookup: BoundaryLookupDescriptor? = null,
) {
    /** The kind of the resource [remote] addresses, from the style that referenced it. */
    fun classify(remote: URI): TileflowResourceKind {
        val text = remote.toASCIIString()
        return kinds
            .filter { text.startsWith(it.first) }
            .maxByOrNull { it.first.length }
            ?.second ?: TileflowResourceKind.OTHER
    }
}

/**
 * Turns a style document into the one MapLibre Native receives. MapLibre never gets a style URL:
 * the host reads the style and every TileJSON a source references by `url` through the map's
 * transport, embeds the TileJSONs, and rewrites every address MapLibre will request (tiles,
 * sprites, glyphs, font faces, GeoJSON data, images, PMTiles archives) to a transport address with
 * the map's context. Relative addresses resolve against the style's own address first. An image
 * source that covers the whole Web Mercator world, such as Streets' climate underlay, reaches
 * MapLibre as a raster source whose only tile is that image ([worldImageTile]).
 */
internal object NativeStyleDocument {
    private val tileJsonKeys =
        listOf(
            "tiles",
            "minzoom",
            "maxzoom",
            "bounds",
            "scheme",
            "attribution",
            "encoding",
            "tileSize",
            "vector_layers",
            "redFactor",
            "greenFactor",
            "blueFactor",
            "baseShift",
        )

    /**
     * Projects [style], read from [styleUrl], for the map registered under [context]. [load] reads
     * a document through the map's transport and throws unless it answered 200. [storedZooms] is
     * given when the map opens from its downloaded regions: it answers the zooms they store for a
     * tile template, and each elevation source then starts at the lowest stored zoom, so MapLibre
     * never asks for ancestors no region holds.
     */
    fun project(
        style: JSONObject,
        styleUrl: String,
        context: String,
        load: (URI) -> ByteArray,
        storedZooms: ((String) -> IntRange?)? = null,
    ): NativeStyleProjection {
        val out = JSONObject(style.toString())
        val kinds = mutableListOf<Pair<String, TileflowResourceKind>>()
        fun address(base: String, value: String, kind: TileflowResourceKind): String {
            val remote = MapResourceAddress.resolve(base, value)
            val projected = MapResourceAddress.encode(remote, context) ?: return value
            kinds += prefix(remote) to kind
            return projected
        }
        val attributions = mutableListOf<String>()
        var boundaryLookup: BoundaryLookupDescriptor? = null
        out.optJSONObject("sources")?.let { sources ->
            for (id in sources.keys().asSequence().toList()) {
                val source = sources.optJSONObject(id) ?: continue
                val type = source.optString("type")
                var base = styleUrl
                val url = source.opt("url") as? String
                if (url != null && url.startsWith(PMTILES)) {
                    val archive = url.removePrefix(PMTILES)
                    source.put(
                        "url",
                        PMTILES + address(styleUrl, archive, TileflowResourceKind.TILE),
                    )
                } else if (url != null && type in setOf("vector", "raster", "raster-dem")) {
                    val resolved = MapResourceAddress.resolve(styleUrl, url)
                    val tileJson = tileJson(resolved, load)
                    if (id == "tileflow-boundaries" && type == "vector" && !source.has("tiles")) {
                        boundaryLookup = BoundaryLookupDescriptor.fromTileJson(tileJson, resolved)
                    }
                    for (key in tileJsonKeys) {
                        if (!source.has(key) && tileJson.has(key))
                            source.put(key, tileJson.get(key))
                    }
                    source.remove("url")
                    base = resolved
                } else if (url != null && type == "image") {
                    source.put("url", address(styleUrl, url, TileflowResourceKind.IMAGE))
                }
                val tiles = source.optJSONArray("tiles")
                if (tiles != null) {
                    val first = tiles.optString(0).takeIf { it.isNotEmpty() }
                    if (type == "raster-dem" && storedZooms != null && first != null) {
                        storedZooms(MapResourceAddress.resolve(base, first))?.let { stored ->
                            val minimum = source.optInt("minzoom", 0)
                            source.put("minzoom", maxOf(minimum, stored.first))
                        }
                    }
                    source.put(
                        "tiles",
                        JSONArray(
                            (0 until tiles.length()).map {
                                address(base, tiles.getString(it), TileflowResourceKind.TILE)
                            }
                        ),
                    )
                }
                (source.opt("data") as? String)?.let {
                    source.put("data", address(styleUrl, it, TileflowResourceKind.DATA))
                }
                source.optJSONArray("urls")?.let { urls ->
                    source.put(
                        "urls",
                        JSONArray(
                            (0 until urls.length()).map {
                                address(styleUrl, urls.getString(it), TileflowResourceKind.IMAGE)
                            }
                        ),
                    )
                }
                source.optString("attribution").takeIf { it.isNotEmpty() }?.let {
                    if (it !in attributions) attributions += it
                }
                if (type == "image") worldImageTile(source)?.let { sources.put(id, it) }
            }
        }
        when (val sprite = out.opt("sprite")) {
            is String -> out.put("sprite", address(styleUrl, sprite, TileflowResourceKind.SPRITE))
            is JSONArray ->
                for (index in 0 until sprite.length()) {
                    val entry = sprite.optJSONObject(index) ?: continue
                    entry.optString("url").takeIf { it.isNotEmpty() }?.let {
                        entry.put("url", address(styleUrl, it, TileflowResourceKind.SPRITE))
                    }
                }
        }
        (out.opt("glyphs") as? String)?.let {
            out.put("glyphs", address(styleUrl, it, TileflowResourceKind.GLYPHS))
        }
        out.optJSONObject("font-faces")?.let { faces ->
            for (name in faces.keys().asSequence().toList()) {
                when (val face = faces.get(name)) {
                    is String -> faces.put(name, address(styleUrl, face, TileflowResourceKind.FONT))
                    is JSONArray ->
                        for (index in 0 until face.length()) {
                            val file = face.optJSONObject(index) ?: continue
                            file.optString("url").takeIf { it.isNotEmpty() }?.let {
                                file.put("url", address(styleUrl, it, TileflowResourceKind.FONT))
                            }
                        }
                }
            }
        }
        // Labels need glyphs or font faces. A style that names neither, such as one whose labels
        // use web fonts, would have MapLibre ask for glyphs at an empty address and never finish
        // loading, so its labels draw no text.
        val textless = !out.has("glyphs") && !out.has("font-faces")
        val omitted = mutableListOf<String>()
        val layerSources = LinkedHashMap<String, String>()
        out.optJSONArray("layers")?.let { layers ->
            for (index in 0 until layers.length()) {
                val layer = layers.optJSONObject(index) ?: continue
                if (textless && layer.optString("type") == "symbol") {
                    val layout = layer.optJSONObject("layout")
                    if (layout?.has("text-field") == true) {
                        layout.remove("text-field")
                        if ("text" !in omitted) omitted += "text"
                    }
                }
                val source = layer.opt("source") as? String ?: continue
                layerSources[layer.optString("id")] = source
            }
        }
        return NativeStyleProjection(out, attributions, layerSources, kinds, omitted, boundaryLookup)
    }

    /** The latitude where Web Mercator ends, north and south. */
    internal const val MERCATOR_LATITUDE = 85.0511287798066

    /**
     * An image source that covers exactly the Web Mercator world, as a raster source whose only
     * tile is that image; null for any other source.
     *
     * MapLibre Native counts an image source as loaded only once it has drawn it, and it draws it
     * only while one of its layers is inside its zoom range. Until then the map never finishes
     * loading: no complete frame, no idle state, and so no `contentReady` and no theme change that
     * waits for the new style to draw. Streets' underlay stops at zoom 11, so every map opened at
     * city zoom waited forever. A raster source that no layer needs is complete, and its zoom-0
     * tile covers the same extent as the image at every zoom, so the map draws the same.
     */
    internal fun worldImageTile(source: JSONObject): JSONObject? {
        val url = source.opt("url") as? String ?: return null
        val corners = source.optJSONArray("coordinates") ?: return null
        val world =
            listOf(
                -180.0 to MERCATOR_LATITUDE,
                180.0 to MERCATOR_LATITUDE,
                180.0 to -MERCATOR_LATITUDE,
                -180.0 to -MERCATOR_LATITUDE,
            )
        if (corners.length() != world.size) return null
        for ((index, expected) in world.withIndex()) {
            val corner = corners.optJSONArray(index) ?: return null
            if (corner.length() != 2) return null
            val longitude = (corner.opt(0) as? Number)?.toDouble() ?: return null
            val latitude = (corner.opt(1) as? Number)?.toDouble() ?: return null
            if (abs(longitude - expected.first) > 1e-6 || abs(latitude - expected.second) > 1e-6)
                return null
        }
        return JSONObject()
            .put("type", "raster")
            .put("tiles", JSONArray().put(url))
            .put("tileSize", 512)
            .put("minzoom", 0)
            .put("maxzoom", 0)
            .also { tile -> source.opt("attribution")?.let { tile.put("attribution", it) } }
    }

    private fun tileJson(url: String, load: (URI) -> ByteArray): JSONObject {
        val uri =
            runCatching { URI(url) }.getOrNull()
                ?: throw TileflowMapException(
                    TileflowErrorCode.RESOURCE_FAILED,
                    TileflowErrorContext(resource = TileflowResourceKind.SOURCE),
                )
        return try {
            JSONObject(String(load(uri), Charsets.UTF_8))
        } catch (error: TileflowMapException) {
            throw error
        } catch (error: Exception) {
            throw TileflowMapException(
                TileflowErrorCode.RESOURCE_FAILED,
                TileflowErrorContext(
                    resource = TileflowResourceKind.SOURCE,
                    origin = runCatching { ResourcePolicy.origin(uri) }.getOrNull(),
                    status = (error as? NativeResourceStatus)?.status,
                    message = "A source of the map's style could not be read.",
                ),
            )
        }
    }

    /** The part of a remote address every request for it starts with. */
    private fun prefix(remote: String): String {
        val end = remote.indexOfFirst { it == '{' || it == '?' }
        return if (end < 0) remote else remote.substring(0, end)
    }

    private const val PMTILES = "pmtiles://"
}
