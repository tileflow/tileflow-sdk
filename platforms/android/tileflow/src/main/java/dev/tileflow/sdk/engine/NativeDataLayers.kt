package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.model.MapPayloadStore
import dev.tileflow.sdk.transport.ResourceDigest
import org.json.JSONArray
import org.json.JSONObject

/** Declarative data fills an authored GeoJSON source without replacing its cluster options. */
internal class NativeDataLayers(value: JSONObject = JSONObject()) {
    private val input = JSONObject(value.toString())
    private val sources = objectField(input, "dataSources")
    private val overlays = objectField(input, "dataOverlays")

    fun apply(style: JSONObject): JSONObject {
        val result = JSONObject(style.toString())
        val sourceValues = result.optJSONObject("sources") ?: JSONObject()
        val layers = result.optJSONArray("layers")?.let { array ->
            (0 until array.length()).map { array.getJSONObject(it) }.toMutableList()
        } ?: mutableListOf()
        val originalIds = layers.map { it.getString("id") }.toSet()
        val anchors = result.optJSONObject("metadata")
            ?.optJSONObject("tileflow:overlay-placement-manifest")?.optJSONObject("anchors")
        val font = layers.asSequence().mapNotNull { it.optJSONObject("layout")?.optJSONArray("text-font") }
            .firstOrNull { values -> values.length() > 0 && (0 until values.length()).all {
                values.opt(it) is String && !values.getString(it).startsWith("tileflow-line-background")
            } }

        for (id in sources.keys().asSequence().sorted()) {
            val value = sources.optJSONObject(id) ?: invalid()
            if (value.optString("kind") != "geojson" || !value.has("data")) invalid()
            val existing = sourceValues.optJSONObject(id)
            if (existing != null) {
                if (existing.optString("type") != "geojson") invalid()
                existing.put("data", value.get("data"))
            } else {
                val definition = JSONObject(value.toString())
                definition.remove("kind")
                sourceValues.put(id, definition.put("type", "geojson"))
            }
        }

        val added = mutableSetOf<String>()
        for (id in overlays.keys().asSequence().sorted()) {
            val overlay = overlays.optJSONObject(id) ?: invalid()
            val source = overlay.optString("source")
            val slot = overlay.optString("placement")
            if (overlay.optString("kind") != "maplibre-overlay" || !sourceValues.has(source) ||
                slot !in setOf("above-water", "below-roads", "above-roads", "above-buildings", "below-labels", "above-labels")) invalid()
            val definitions = overlay.optJSONArray("layers") ?: invalid()
            for (i in 0 until definitions.length()) {
                val layer = JSONObject((definitions.optJSONObject(i) ?: invalid()).toString())
                val layerId = layer.optString("id")
                if (layerId.isEmpty() || layer.opt("type") !is String) invalid()
                if (layerId in originalIds) continue
                if (!added.add(layerId)) invalid()
                layer.put("source", source)
                if (layer.optJSONObject("metadata")?.optJSONObject("tileflow:cluster")?.optString("role") == "count") {
                    val layout = layer.optJSONObject("layout") ?: JSONObject()
                    if (!layout.has("text-font")) layout.put("text-font", font ?: invalid())
                    layer.put("layout", layout)
                }
                val anchor = anchors?.optString(slot)
                val index = layers.indexOfFirst { it.optString("id") == anchor }
                layers.add(if (index < 0) layers.size else index, layer)
            }
        }
        return result.put("sources", sourceValues).put("layers", JSONArray(layers))
    }

    companion object {
        fun wire(input: JSONObject, channel: MapPayloadStore): Pair<JSONObject, List<MapPayloadStore.Reference>> {
            val value = JSONObject(input.toString())
            val sources = value.getJSONObject("dataSources")
            val references = mutableListOf<MapPayloadStore.Reference>()
            try {
                for (id in sources.keys()) {
                    val source = sources.getJSONObject(id)
                    if (source.has("dataReference")) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                    val data = source.get("data")
                    if (data is String) continue
                    if (data !is JSONObject) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                    val bytes = data.toString().toByteArray(Charsets.UTF_8)
                    val reference = channel.register(bytes, ResourceDigest.sha256(bytes), "application/geo+json")
                    references += reference
                    source.remove("data")
                    source.put("dataReference", reference.json())
                }
                return value to references
            } catch (error: Exception) {
                channel.release(references)
                throw error
            }
        }

        fun decode(input: JSONObject, channel: MapPayloadStore, references: List<MapPayloadStore.Reference>): JSONObject {
            val value = JSONObject(input.toString())
            val sources = value.getJSONObject("dataSources")
            for (id in sources.keys()) {
                val source = sources.getJSONObject(id)
                if (!source.has("dataReference")) continue
                val ref = source.getJSONObject("dataReference")
                val reference = references.firstOrNull { it.id == ref.optString("id") && it.byteLength == ref.optInt("byteLength") && it.sha256 == ref.optString("sha256") }
                    ?: throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                if (source.has("data")) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                val payload = channel.payload(reference.id) ?: throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                source.remove("dataReference")
                source.put("data", JSONObject(String(payload.bytes, Charsets.UTF_8)))
            }
            return value
        }
    }

    private fun objectField(value: JSONObject, key: String): JSONObject =
        if (!value.has(key)) JSONObject() else value.optJSONObject(key) ?: invalid()

    private fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
}
