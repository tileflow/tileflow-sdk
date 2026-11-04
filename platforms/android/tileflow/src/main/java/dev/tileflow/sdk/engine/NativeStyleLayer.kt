package dev.tileflow.sdk.engine

import dev.tileflow.sdk.NativeStyleProperty
import dev.tileflow.sdk.NativeStyleSpecification
import dev.tileflow.sdk.TileflowLayerSlot
import java.util.concurrent.ConcurrentHashMap
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.*

/** A style-spec layer using application ids. Only the renderer sees the private ids. */
internal class NativeStyleLayer(val json: JSONObject, val slot: TileflowLayerSlot?) {
    val name: String = json.getString("id")
    val id = "__tileflow_layer_$name"
    val type: String = json.getString("type")
    val source: String? = json.opt("source") as? String
    val sourceLayer: String? = json.opt("source-layer") as? String
    val rank = slot?.ordinal ?: TileflowLayerSlot.entries.size

    fun validate() {
        json.checkKeys(keys)
        if ((type == "background") != (source == null)) styleInvalid("Invalid layer source")
        if (type !in setOf("background", "fill", "line", "circle", "symbol", "heatmap", "fill-extrusion",
            "raster", "hillshade", "color-relief")) styleInvalid(type)
        if (json.has("source-layer") && sourceLayer.isNullOrEmpty()) styleInvalid("source-layer")
        if (json.has("filter") && json.optJSONArray("filter") == null) styleInvalid("filter")
        json.numberOr("minzoom", 0.0, 0.0, 24.0)
        json.numberOr("maxzoom", 24.0, 0.0, 24.0)
        for (group in listOf("paint", "layout")) {
            if (!json.has(group)) continue
            val properties = json.optJSONObject(group) ?: styleInvalid(group)
            for (key in properties.keys()) {
                val base = key.removeSuffix("-transition")
                val spec = NativeStyleSpecification.property(type, group, base) ?: styleInvalid(key)
                if (base == key) propertyValue(spec, properties.get(key), key)
                else if (!spec.transition || properties.optJSONObject(key) == null) styleInvalid(key)
            }
        }
    }

    fun make(): Layer {
        val sourceId = "__tileflow_source_$source"
        val layer = when (type) {
            "background" -> BackgroundLayer(id)
            "fill" -> FillLayer(id, sourceId)
            "line" -> LineLayer(id, sourceId)
            "circle" -> CircleLayer(id, sourceId)
            "symbol" -> SymbolLayer(id, sourceId)
            "heatmap" -> HeatmapLayer(id, sourceId)
            "fill-extrusion" -> FillExtrusionLayer(id, sourceId)
            "raster" -> RasterLayer(id, sourceId)
            "hillshade" -> HillshadeLayer(id, sourceId)
            "color-relief" -> ColorReliefLayer(id, sourceId)
            else -> styleInvalid(type)
        }
        json.checkKeys(keys)
        if (json.has("source-layer")) {
            val value = sourceLayer ?: styleInvalid("source-layer")
            method(layer, "setSourceLayer", String::class.java).invoke(layer, value)
        }
        if (json.has("filter")) {
            val array = json.optJSONArray("filter") ?: styleInvalid("filter")
            val filter = Expression.raw(array.toString())
            method(layer, "setFilter", Expression::class.java).invoke(layer, filter)
            if (method(layer, "getFilter").invoke(layer) == null) styleInvalid("filter")
        }
        if (json.has("minzoom")) layer.minZoom = json.numberOr("minzoom", 0.0, 0.0, 24.0).toFloat()
        if (json.has("maxzoom")) layer.maxZoom = json.numberOr("maxzoom", 24.0, 0.0, 24.0).toFloat()
        for (group in listOf("paint", "layout")) {
            if (!json.has(group)) continue
            val properties = json.optJSONObject(group) ?: styleInvalid(group)
            for (key in properties.keys()) apply(layer, group, key, properties.get(key))
        }
        return layer
    }

    private fun apply(layer: Layer, group: String, key: String, raw: Any) {
        val base = key.removeSuffix("-transition")
        val property = NativeStyleSpecification.property(type, group, base) ?: styleInvalid(key)
        val suffix = base.split('-').joinToString("") { it.replaceFirstChar(Char::uppercaseChar) }
        if (base != key) {
            if (group != "paint" || !property.transition || raw !is JSONObject) styleInvalid(key)
            raw.checkKeys(setOf("duration", "delay"))
            val timing = TransitionOptions(
                raw.numberOr("duration", 0.0, 0.0, Int.MAX_VALUE.toDouble()).toLong(),
                raw.numberOr("delay", 0.0, 0.0, Int.MAX_VALUE.toDouble()).toLong(),
            )
            method(layer, "set${suffix}Transition", TransitionOptions::class.java).invoke(layer, timing)
            return
        }

        val value = propertyValue(property, raw, key)
        layer.setProperties(
            if (group == "layout") LayoutPropertyValue(key, value) else PaintPropertyValue(key, value)
        )
        // MapLibre logs a conversion error instead of throwing. Inspect the new detached layer
        // before installing it so an invalid expression cannot silently replace a working layer.
        val observed = method(layer, "get$suffix").invoke(layer) as? PropertyValue<*> ?: styleInvalid(key)
        if (observed.isNull || value is Expression && !observed.isExpression && raw is JSONArray && raw.optString(0) != "literal") {
            // Native folds constant expressions into a literal. Their presence is verified by the
            // getter; data expressions, in particular feature-state, must remain expressions.
            if (observed.isNull || containsFeatureOrCameraInput(raw)) styleInvalid(key)
        }
    }

    companion object {
        private val keys = setOf("id", "type", "source", "source-layer", "minzoom", "maxzoom", "filter", "paint", "layout")
        private val methods = ConcurrentHashMap<Pair<Class<*>, String>, java.lang.reflect.Method>()

        private fun method(layer: Layer, name: String, vararg args: Class<*>): java.lang.reflect.Method =
            methods.getOrPut(layer.javaClass to name) {
                try { layer.javaClass.getMethod(name, *args) } catch (_: NoSuchMethodException) { styleInvalid(name) }
            }

        fun slot(value: Any?): TileflowLayerSlot? = value?.let {
            TileflowLayerSlot.entries.firstOrNull { slot -> slot.wireName == it } ?: styleInvalid("slot")
        }

        private fun containsFeatureOrCameraInput(value: Any): Boolean {
            if (value !is JSONArray || value.length() == 0 || value.optString(0) == "literal") return false
            return value.optString(0) in setOf("get", "has", "id", "properties", "zoom", "feature-state", "geometry-type",
                "line-progress", "heatmap-density", "elevation", "global-state") ||
                value.items().drop(1).any(::containsFeatureOrCameraInput)
        }

        private fun propertyValue(property: NativeStyleProperty, raw: Any, name: String): Any {
            if (raw is JSONArray && NativeStyleSpecification.isExpressionOperator(raw.optString(0))) {
                if (!property.expressions) styleInvalid(name)
                return Expression.raw(raw.toString())
            }
            fun constant(value: Any, kind: String): Any = when (kind) {
                "number" -> {
                    val n = (value as? Number)?.toDouble() ?: styleInvalid(name)
                    if (!n.isFinite() || n < (property.minimum ?: -Double.MAX_VALUE) ||
                        n > (property.maximum ?: Double.MAX_VALUE) || !n.toFloat().isFinite()) styleInvalid(name)
                    n.toFloat()
                }
                "boolean" -> value as? Boolean ?: styleInvalid(name)
                "enum" -> (value as? String)?.takeIf { it in property.values } ?: styleInvalid(name)
                "string", "color", "resolvedImage", "formatted" -> value as? String ?: styleInvalid(name)
                else -> styleInvalid(name)
            }
            if (property.kind != "array") return constant(raw, property.kind)
            val items = raw as? JSONArray ?: styleInvalid(name)
            if (property.length != null && items.length() != property.length) styleInvalid(name)
            return items.items().map { constant(it, property.elementKind ?: styleInvalid(name)) }.toTypedArray()
        }
    }
}
