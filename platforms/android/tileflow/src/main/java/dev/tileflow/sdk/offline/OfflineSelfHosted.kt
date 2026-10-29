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

    fun styleUrl(text: String): URI {
        val url = runCatching { URI(text) }.getOrNull()
        if (url == null || url.scheme !in setOf("https", "http") || url.host == null)
            throw TileflowOfflineException.options("invalidStyleURL")
        return url
    }

    /**
     * The style, its sprite sheets at 1x and 2x, and every glyph range of the font stacks its
     * layers name literally, as absolute URLs.
     */
    fun documents(style: URI, data: ByteArray): List<URI> {
        val value =
            runCatching { JSONObject(String(data, Charsets.UTF_8)) }.getOrNull()
                ?: throw TileflowOfflineException(
                    TileflowOfflineErrorCode.INVALID_RESPONSE,
                    TileflowErrorContext(reason = "invalidStyle"),
                )
        val documents = mutableListOf(style)
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
