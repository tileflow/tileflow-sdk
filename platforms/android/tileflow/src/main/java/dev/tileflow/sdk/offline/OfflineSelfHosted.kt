package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import java.net.URI
import java.net.URLEncoder
import org.json.JSONArray
import org.json.JSONObject

/** Resolves what a self-hosted style needs besides tiles. */
internal object OfflineSelfHosted {
    /** Glyph ranges as renderers request them: 256 code points each, up to U+FFFF. */
    val GLYPH_RANGES = List(256) { "${it * 256}-${it * 256 + 255}" }

    /** The font stack renderers use for text without `text-font`. */
    val DEFAULT_FONT_STACK = listOf("Open Sans Regular", "Arial Unicode MS Regular")

    fun validate(sources: List<TileflowOfflineTileSource>) {
        val ids = HashSet<String>()
        for (source in sources)
            if (
                source.id.isEmpty() ||
                    !ids.add(source.id) ||
                    tileUrl(source.template, 0, 0, 0) == null ||
                    source.minZoom !in 0..OfflineZooms.MAXIMUM ||
                    source.minZoom > source.maxZoom
            )
                throw TileflowOfflineException.options("invalidSource")
    }

    /** The manifest's address, once it and the map's name are valid. */
    fun validate(text: String, map: String): URI {
        val url = runCatching { URI(text) }.getOrNull()
        if (url == null || url.scheme !in setOf("https", "http") || url.host == null)
            throw TileflowOfflineException.options("invalidManifestURL")
        if (map.isEmpty() || map.length > 128) throw TileflowOfflineException.options("invalidMap")
        return url
    }

    /**
     * The map's theme styles, and the manifest with the font files its themes name, as absolute
     * URLs.
     */
    fun manifest(url: URI, data: ByteArray, map: String): Pair<List<URI>, List<URI>> {
        val themes =
            runCatching {
                    JSONObject(String(data, Charsets.UTF_8))
                        .getJSONObject("maps")
                        .getJSONObject(map)
                        .getJSONObject("themes")
                }
                .getOrNull() ?: throw invalid("invalidManifest")
        val styles = mutableListOf<URI>()
        val documents = mutableListOf(url)
        for (name in themes.keys().asSequence().sorted()) {
            val theme = themes.optJSONObject(name) ?: continue
            (theme.opt("styleUrl") as? String)?.let { resolve(it, url) }?.let {
                if (it !in styles) styles.add(it)
            }
            documents += fontFiles(theme.opt("fontFaces"), url)
        }
        if (styles.isEmpty()) throw invalid("invalidManifest")
        return styles to documents
    }

    /**
     * The style, the font files and source documents it names, its sprite sheets at 1x and 2x, and
     * every glyph range of the font stacks its layers name literally, as absolute URLs.
     */
    fun documents(style: URI, data: ByteArray): List<URI> {
        val value =
            runCatching { JSONObject(String(data, Charsets.UTF_8)) }.getOrNull()
                ?: throw invalid("invalidStyle")
        val documents = mutableListOf(style)
        documents += fontFiles(value.optJSONObject("metadata")?.opt("tileflow:fontFaces"), style)
        value.optJSONObject("sources")?.let { sources ->
            for (name in sources.keys().asSequence().sorted()) {
                // TileJSON documents and GeoJSON data; tiles come from the region's tile sources.
                for (member in listOf("url", "data")) {
                    val text = sources.optJSONObject(name)?.opt(member) as? String ?: continue
                    resolve(text, style)?.let(documents::add)
                }
            }
        }
        val sprites =
            when (val sprite = value.opt("sprite")) {
                is String -> listOf(sprite)
                is JSONArray ->
                    List(sprite.length()) { sprite.optJSONObject(it)?.optString("url") }
                        .filterNotNull()
                else -> emptyList()
            }
        for (base in sprites)
            for (suffix in listOf(".json", ".png", "@2x.json", "@2x.png"))
                resolve(base, style, suffix)?.let(documents::add)
        val glyphs = value.opt("glyphs") as? String
        if (glyphs != null)
            for (stack in fontStacks(value)) {
                val name =
                    URLEncoder.encode(stack.joinToString(","), "UTF-8")
                        .replace("+", "%20")
                        .replace("%21", "!")
                        .replace("%27", "'")
                        .replace("%28", "(")
                        .replace("%29", ")")
                        .replace("%7E", "~")
                for (range in GLYPH_RANGES)
                    resolve(glyphs.replace("{fontstack}", name).replace("{range}", range), style)
                        ?.let(documents::add)
            }
        return documents
    }

    fun tileUrl(template: String, z: Int, x: Int, y: Int): URI? {
        if (listOf("{z}", "{x}", "{y}").any { template.split(it).size != 2 }) return null
        val url =
            runCatching {
                    URI(
                        template
                            .replace("{z}", z.toString())
                            .replace("{x}", x.toString())
                            .replace("{y}", y.toString())
                    )
                }
                .getOrNull() ?: return null
        return url.takeIf { it.scheme in setOf("https", "http") && it.host != null }
    }

    /** The font files of `tileflow:fontFaces` entries: each face's `source`, or its `sources`. */
    private fun fontFiles(value: Any?, base: URI): List<URI> {
        val faces = value as? JSONArray ?: return emptyList()
        val files = mutableListOf<URI>()
        for (index in 0 until faces.length()) {
            val face = faces.optJSONObject(index) ?: continue
            val names = mutableListOf<String>()
            (face.opt("source") as? String)?.let(names::add)
            face.optJSONArray("sources")?.let { sources ->
                for (item in 0 until sources.length())
                    ((sources.optJSONObject(item)?.opt("url") ?: sources.opt(item)) as? String)
                        ?.let(names::add)
            }
            names.mapNotNullTo(files) { resolve(it, base) }
        }
        return files
    }

    private fun invalid(reason: String) =
        TileflowOfflineException(
            TileflowOfflineErrorCode.INVALID_RESPONSE,
            TileflowErrorContext(reason = reason),
        )

    /**
     * Font stacks of symbol layers: literal `text-font` arrays, or the default stack for text
     * without one. Stacks chosen by data expressions are not resolved.
     */
    private fun fontStacks(style: JSONObject): List<List<String>> {
        val layers = style.optJSONArray("layers") ?: return emptyList()
        val stacks = mutableListOf<List<String>>()
        fun add(stack: List<String>) {
            if (stack.isNotEmpty() && stack !in stacks) stacks.add(stack)
        }
        fun strings(array: JSONArray): List<String>? {
            val names = List(array.length()) { array.opt(it) as? String }
            return if (names.all { it != null }) names.filterNotNull() else null
        }
        for (index in 0 until layers.length()) {
            val layer = layers.optJSONObject(index) ?: continue
            if (layer.optString("type") != "symbol") continue
            val layout = layer.optJSONObject("layout")
            val font = layout?.opt("text-font")
            when {
                font is JSONArray && strings(font) != null -> add(strings(font)!!)
                font is JSONArray && font.length() == 2 && font.opt(0) == "literal" ->
                    (font.opt(1) as? JSONArray)?.let(::strings)?.let(::add)
                font == null && layout?.has("text-field") == true -> add(DEFAULT_FONT_STACK)
            }
        }
        return stacks
    }

    private fun resolve(text: String, base: URI, suffix: String = ""): URI? {
        val url = runCatching { base.resolve(text) }.getOrNull() ?: return null
        if (url.scheme !in setOf("https", "http")) return null
        val query = url.rawQuery?.let { "?$it" } ?: ""
        return runCatching { URI("${url.scheme}://${url.rawAuthority}${url.rawPath}$suffix$query") }
            .getOrNull()
    }
}
