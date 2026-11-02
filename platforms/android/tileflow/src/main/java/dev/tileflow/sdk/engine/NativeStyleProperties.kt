package dev.tileflow.sdk.engine

import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.Layer
import org.maplibre.android.style.layers.LayoutPropertyValue
import org.maplibre.android.style.layers.PaintPropertyValue

/**
 * Writes a style specification value to a layer of the style MapLibre draws, so a blend position,
 * an emphasis or the view mode changes without loading the style again. MapLibre Android takes a
 * property by its specification name: a colour as its CSS string, a number as a float, and an
 * expression as JSON, as a style holds it. A value it cannot take returns false, and the caller
 * loads the whole style instead.
 */
internal object NativeStyleProperties {
    /** Sets [property] of [layer] to [value]; null resets it to MapLibre's default. */
    fun set(layer: Layer, property: String, value: Any?, layout: Boolean = false): Boolean {
        val converted: Any? =
            when (value) {
                null,
                JSONObject.NULL -> null
                is Number -> value.toFloat()
                is String,
                is Boolean -> value
                is JSONArray -> {
                    // An expression; a literal array would need a typed value.
                    if (value.optString(0).isEmpty() || value.optString(0) == "literal") return false
                    try {
                        Expression.raw(value.toString())
                    } catch (_: Exception) {
                        return false
                    }
                }
                else -> return false
            }
        return try {
            layer.setProperties(
                if (layout || property == "visibility") LayoutPropertyValue(property, converted)
                else PaintPropertyValue(property, converted)
            )
            true
        } catch (_: Exception) {
            false
        }
    }
}
