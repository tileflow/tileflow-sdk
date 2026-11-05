package dev.tileflow.sdk.engine

import android.graphics.PointF
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.style.expressions.Expression
import org.maplibre.geojson.Feature

/** The semantic POI lookup declared by the compiler in the finalized style. */
internal class NativePoiManifest
private constructor(
    private val categoryField: String,
    private val nameField: String,
    private val layers: Map<String, Representation>,
) {
    private data class Representation(val rank: Int, val priority: Int) {
        fun preferredTo(other: Representation) =
            rank < other.rank || rank == other.rank && priority > other.priority
    }

    private data class Identity(val value: String, val numeric: Boolean)

    private data class Hit(
        val id: Identity?,
        val category: String,
        val name: String?,
        val layer: Representation,
    )

    fun at(map: MapLibreMap, point: PointF, coordinate: JSONObject): JSONObject? {
        val style = map.style ?: return null
        var winner: Hit? = null
        for (native in style.layers.asReversed()) {
            val representation = layers[native.id] ?: continue
            if (native.visibility.value == "none") continue
            val hits = map.queryRenderedFeatures(point, native.id)
            // Android's JNI returns textual IDs for both numbers and strings. Ask the renderer
            // for their original type when it can affect semantic identity or validation.
            val numbers =
                if (hits.any { it.id()?.toDoubleOrNull() != null })
                    map.queryRenderedFeatures(point, numericIDs, native.id)
                        .groupingBy { it }
                        .eachCount()
                        .toMutableMap()
                else mutableMapOf()
            for (feature in hits) {
                val count = numbers[feature] ?: 0
                if (count > 0) numbers[feature] = count - 1
                val category = feature.text(categoryField)?.takeIf { it in categories } ?: continue
                val id = identity(feature.id(), count > 0)
                val selected = winner
                // The first rendered identity wins. Only a better representation of that same
                // identity can replace it; an anonymous feature stands on its own.
                if (
                    selected == null ||
                        id != null &&
                            id == selected.id &&
                            representation.preferredTo(selected.layer)
                ) {
                    winner =
                        Hit(
                            id,
                            category,
                            feature.text(nameField)?.takeIf { it.length <= 4096 },
                            representation,
                        )
                }
            }
        }
        return winner?.let {
            JSONObject()
                .put("id", it.id?.value ?: JSONObject.NULL)
                .put("name", it.name ?: JSONObject.NULL)
                .put("category", it.category)
                .put("coordinate", coordinate)
        }
    }

    private fun identity(raw: String?, numeric: Boolean): Identity? {
        if (raw.isNullOrEmpty()) return null
        if (!numeric) return raw.takeIf { it.length <= 128 }?.let { Identity(it, false) }
        val n = raw.toDoubleOrNull() ?: return null
        return if (
            n.isFinite() &&
                n == kotlin.math.floor(n) &&
                kotlin.math.abs(n) <= 9_007_199_254_740_991.0
        )
            Identity(n.toLong().toString(), true)
        else null
    }

    private fun Feature.text(name: String): String? =
        properties()
            ?.get(name)
            ?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }
            ?.asString

    companion object {
        private val numericIDs = Expression.raw("""["==",["typeof",["id"]],"number"]""")
        private val representations = setOf("marker", "icon", "combined", "label")
        private val categories =
            setOf(
                "arts-entertainment",
                "education",
                "food-drink",
                "landmark",
                "lodging",
                "medical",
                "park-nature",
                "public-services",
                "religion",
                "retail",
                "sport-leisure",
                "transport",
                "visitor-amenity",
            )
        private val fields = listOf("category", "filterRank", "icon", "name", "sizeRank", "type")

        private fun name(value: Any?): String? =
            (value as? String)?.takeIf {
                it.length in 1..256 && it.none { c -> c.code < 32 || c.code == 127 }
            }

        private fun strings(array: JSONArray?): List<String> {
            if (array == null) return emptyList()
            return (0 until array.length()).map { array.opt(it) as? String ?: return emptyList() }
        }

        fun read(style: JSONObject): NativePoiManifest? {
            val artifact =
                style.optJSONObject("metadata")?.optJSONObject("tileflow:interaction-manifest")
                    ?: return null
            if ((artifact.opt("version") as? Number)?.toDouble() != 3.0) return null
            val poi = artifact.optJSONObject("domains")?.optJSONObject("poi") ?: return null
            val property = poi.optJSONObject("fields") ?: return null
            val hitTest = poi.optJSONObject("hitTesting") ?: return null
            val deduplication = poi.optJSONObject("deduplication") ?: return null
            val ranks = strings(deduplication.optJSONArray("representationPriority"))
            if (
                poi.opt("identity") != "maplibre-feature-id-if-present" ||
                    hitTest.opt("order") != "rendered-topmost" ||
                    hitTest.opt("frequency") != "animation-frame" ||
                    strings(deduplication.optJSONArray("identity")) !=
                        listOf("source", "source-layer", "feature-id") ||
                    ranks.size != representations.size ||
                    ranks.toSet() != representations ||
                    fields.any { name(property.opt(it)) == null }
            )
                return null
            val definitions = poi.optJSONArray("layers") ?: return null
            if (definitions.length() !in 1..256) return null
            val styleLayers = style.optJSONArray("layers") ?: return null
            val installed = buildMap {
                for (i in 0 until styleLayers.length()) {
                    val layer = styleLayers.optJSONObject(i) ?: continue
                    put(layer.optString("id"), layer)
                }
            }
            val layers = mutableMapOf<String, Representation>()
            var namespace: Pair<String, String?>? = null
            for (i in 0 until definitions.length()) {
                val def = definitions.optJSONObject(i) ?: return null
                val id = name(def.opt("layerId")) ?: return null
                val source = name(def.opt("source")) ?: return null
                val sourceLayer =
                    if (def.has("sourceLayer")) name(def.opt("sourceLayer")) ?: return null
                    else null
                val rank = ranks.indexOf(def.opt("representation"))
                val priority = (def.opt("priority") as? Number)?.toDouble() ?: return null
                val declared = installed[id] ?: return null
                if (
                    id in layers ||
                        rank < 0 ||
                        priority !in 0.0..100_000.0 ||
                        priority != priority.toInt().toDouble() ||
                        def.opt("anchor") != "pointer-coordinate" ||
                        declared.opt("source") != source ||
                        declared.opt("source-layer") != sourceLayer
                )
                    return null
                val next = source to sourceLayer
                if (namespace != null && next != namespace) return null
                namespace = next
                layers[id] = Representation(rank, priority.toInt())
            }
            return NativePoiManifest(
                property.getString("category"),
                property.getString("name"),
                layers,
            )
        }
    }
}
