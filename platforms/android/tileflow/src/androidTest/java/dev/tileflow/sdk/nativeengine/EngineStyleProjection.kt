package dev.tileflow.sdk.nativeengine

import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

/**
 * Projects a style document for the engine: every TileJSON a source references by `url` is read
 * through [load] and embedded, and every URL the engine will request (tiles, GeoJSON data, sprite,
 * glyphs, font faces) becomes an engine address with [context]. The engine receives JSON, never a
 * style URL.
 */
internal object EngineStyleProjection {
    class Result(val style: JSONObject, val droppedSources: List<String>)

    /** Why each dropped source was dropped. */
    val reasons = java.util.concurrent.ConcurrentHashMap<String, String>()

    fun project(
        style: JSONObject,
        styleUrl: String,
        context: String,
        load: (URI) -> ByteArray?,
        replaceSource: (id: String, source: JSONObject) -> JSONObject? = { _, source -> source },
    ): Result {
        val out = JSONObject(style.toString())
        fun address(base: String, value: String) =
            EngineAddress.encode(EngineAddress.resolve(base, value), context)
        val dropped = mutableListOf<String>()
        out.optJSONObject("sources")?.let { sources ->
            for (id in sources.keys().asSequence().toList()) {
                val replaced = replaceSource(id, sources.getJSONObject(id))
                if (replaced == null) {
                    sources.remove(id)
                    dropped += id
                    continue
                }
                val source: JSONObject = replaced
                var base = styleUrl
                val tileJsonUrl = source.optString("url").takeIf { it.startsWith("http") || it.startsWith(".") || it.startsWith("/") }
                if (tileJsonUrl != null) {
                    val resolved = EngineAddress.resolve(styleUrl, tileJsonUrl)
                    val loaded = runCatching { load(URI(resolved)) }
                    val bytes = loaded.getOrNull()
                    if (bytes == null) {
                        reasons[id] = "$resolved: ${loaded.exceptionOrNull() ?: "not 200"}"
                        sources.remove(id)
                        dropped += id
                        continue
                    }
                    val tileJson = JSONObject(String(bytes, Charsets.UTF_8))
                    for (key in listOf("tiles", "minzoom", "maxzoom", "bounds", "scheme", "attribution", "encoding"))
                        if (tileJson.has(key) && !source.has(key)) source.put(key, tileJson.get(key))
                    source.remove("url")
                    base = resolved
                }
                source.optJSONArray("tiles")?.let { tiles ->
                    source.put(
                        "tiles",
                        JSONArray((0 until tiles.length()).map { address(base, tiles.getString(it)) }),
                    )
                }
                (source.opt("data") as? String)?.let { source.put("data", address(base, it)) }
                sources.put(id, source)
            }
        }
        if (dropped.isNotEmpty()) {
            val layers = out.optJSONArray("layers") ?: JSONArray()
            val kept = JSONArray()
            for (index in 0 until layers.length()) {
                val layer = layers.getJSONObject(index)
                if (layer.optString("source") !in dropped) kept.put(layer)
            }
            out.put("layers", kept)
        }
        when (val sprite = out.opt("sprite")) {
            is String -> out.put("sprite", address(styleUrl, sprite))
            is JSONArray ->
                for (index in 0 until sprite.length()) {
                    val entry = sprite.getJSONObject(index)
                    entry.put("url", address(styleUrl, entry.getString("url")))
                }
        }
        (out.opt("glyphs") as? String)?.let { out.put("glyphs", address(styleUrl, it)) }
        out.optJSONObject("font-faces")?.let { faces ->
            for (name in faces.keys().asSequence().toList()) {
                when (val face = faces.get(name)) {
                    is String -> faces.put(name, address(styleUrl, face))
                    is JSONArray ->
                        for (index in 0 until face.length()) {
                            val file = face.getJSONObject(index)
                            file.put("url", address(styleUrl, file.getString("url")))
                        }
                }
            }
        }
        return Result(out, dropped)
    }
}
