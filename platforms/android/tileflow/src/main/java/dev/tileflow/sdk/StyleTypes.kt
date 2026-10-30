package dev.tileflow.sdk

import org.json.JSONArray
import org.json.JSONObject

/**
 * A layer of the application's runtime style. The SDK generates one type per MapLibre layer type,
 * such as [TileflowCircleLayer] and [TileflowSymbolLayer], with every layout and paint property of
 * the MapLibre style specification.
 *
 * @property id The layer's identifier among the application's layers.
 * @property type The MapLibre layer type, such as `circle`.
 */
public abstract class TileflowLayer internal constructor(
    public val id: String,
    public val type: String,
) {
    /** Where the layer lies among the map's own layers; null lies above them all. */
    public var slot: TileflowLayerSlot? = null

    /** The layer's MapLibre JSON. */
    internal abstract fun json(): JSONObject
}

/**
 * Where an application layer lies among the map's own layers. Every Tileflow map resolves each slot
 * to its own layers, so a layer keeps its place across themes. A style without these placements
 * puts every slot but [ABOVE_LABELS] under its labels.
 */
public enum class TileflowLayerSlot(internal val wireName: String) {
    /** Above water, under roads and everything above them. */
    ABOVE_WATER("above-water"),
    /** Under the roads. */
    BELOW_ROADS("below-roads"),
    /** Above the roads, under the buildings. */
    ABOVE_ROADS("above-roads"),
    /** Above the buildings, including the 3D scene's, under the labels. */
    ABOVE_BUILDINGS("above-buildings"),
    /** Under the labels. */
    BELOW_LABELS("below-labels"),
    /** Above the labels. */
    ABOVE_LABELS("above-labels"),
}

/**
 * Where a layer goes relative to the application's other layers. A layer placed above or below
 * another takes that layer's slot.
 */
public sealed interface TileflowLayerPosition {
    /** On top of the layers of its slot. */
    public data object Default : TileflowLayerPosition

    /** Directly above an application layer. */
    public data class Above(val layerId: String) : TileflowLayerPosition

    /** Directly below an application layer. */
    public data class Below(val layerId: String) : TileflowLayerPosition
}

internal fun TileflowLayerPosition.json(): JSONObject? =
    when (this) {
        TileflowLayerPosition.Default -> null
        is TileflowLayerPosition.Above -> JSONObject().put("above", layerId)
        is TileflowLayerPosition.Below -> JSONObject().put("below", layerId)
    }

/**
 * A style property's value: a constant, or an expression evaluated for each feature, zoom level or
 * feature state.
 */
public sealed interface TileflowValue<out T> {
    public data class Constant<out T>(val value: T) : TileflowValue<T>

    public data class Expression(val expression: TileflowExpression) : TileflowValue<Nothing>

    public companion object {
        public fun <T> constant(value: T): TileflowValue<T> = Constant(value)

        public fun expression(expression: TileflowExpression): TileflowValue<Nothing> =
            Expression(expression)
    }
}

/** An enumerated style value; [value] is its MapLibre name. */
public interface TileflowStyleEnum {
    public val value: String
}

/**
 * A colour of the runtime style, sent to the map as CSS `rgba()`.
 *
 * @property red From 0 to 255, as are [green] and [blue].
 * @property alpha From 0 to 1.
 */
public data class TileflowColor(
    val red: Int,
    val green: Int,
    val blue: Int,
    val alpha: Double = 1.0,
) {
    init {
        if (listOf(red, green, blue).any { it !in 0..255 } || alpha !in 0.0..1.0)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
    }

    internal val css: String
        get() = "rgba($red, $green, $blue, ${Math.round(alpha * 1000) / 1000.0})"

    public companion object {
        /** An Android colour integer, `0xAARRGGBB`. */
        @JvmStatic
        public fun fromArgb(argb: Int): TileflowColor =
            TileflowColor(
                (argb shr 16) and 0xff,
                (argb shr 8) and 0xff,
                argb and 0xff,
                ((argb ushr 24) and 0xff) / 255.0,
            )

        /**
         * `#rrggbb` or `#rrggbbaa`.
         *
         * @throws TileflowMapException with [TileflowErrorCode.INVALID_REQUEST] for any other text.
         */
        @JvmStatic
        public fun fromHex(hex: String): TileflowColor {
            if (!Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$").matches(hex))
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            val value = hex.drop(1).toLong(16)
            val long = hex.length == 9
            val rgb = if (long) value shr 8 else value
            return TileflowColor(
                ((rgb shr 16) and 0xff).toInt(),
                ((rgb shr 8) and 0xff).toInt(),
                (rgb and 0xff).toInt(),
                if (long) (value and 0xff) / 255.0 else 1.0,
            )
        }
    }
}

/** How a property moves to a new value: over [durationMillis], after [delayMillis]. */
public data class TileflowTransition(val durationMillis: Long, val delayMillis: Long = 0)

/**
 * Anchors to try for a label, in order, each with its offset in ems: the value of
 * `textVariableAnchorOffset`.
 */
public data class TileflowTextAnchorOffsets(val entries: List<Entry>) {
    /** [offset] is `[x, y]` in ems; positive values move right and down. */
    public data class Entry(val anchor: TileflowTextAnchor, val offset: List<Double>)
}

/** A constant style value as MapLibre JSON. */
internal fun styleConstantJson(value: Any?): Any =
    when (value) {
        null -> JSONObject.NULL
        is Double ->
            value.also { if (!it.isFinite()) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST) }
        is Number -> value.toDouble()
        is Boolean,
        is String -> value
        is TileflowStyleEnum -> value.value
        is TileflowColor -> value.css
        is TileflowExpression -> value.json
        is TileflowTransition ->
            JSONObject().put("duration", value.durationMillis).put("delay", value.delayMillis)
        is TileflowTextAnchorOffsets ->
            JSONArray().apply {
                value.entries.forEach {
                    put(it.anchor.value)
                    put(styleConstantJson(it.offset))
                }
            }
        is TileflowValue.Constant<*> -> styleConstantJson(value.value)
        is TileflowValue.Expression -> value.expression.json
        is List<*> -> JSONArray().apply { value.forEach { put(styleConstantJson(it)) } }
        is Map<*, *> ->
            JSONObject().apply { value.forEach { (key, item) -> put(key.toString(), styleConstantJson(item)) } }
        else -> throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
    }

/** A generated layer's MapLibre JSON. */
internal fun styleLayerJson(
    layer: TileflowLayer,
    source: String?,
    sourceLayer: String?,
    filter: TileflowExpression?,
    minZoom: Double?,
    maxZoom: Double?,
    layout: List<Pair<String, Any?>>,
    paint: List<Pair<String, Any?>>,
): JSONObject {
    fun group(properties: List<Pair<String, Any?>>): JSONObject? {
        val values = properties.filter { it.second != null }
        if (values.isEmpty()) return null
        return JSONObject().apply { values.forEach { (name, value) -> put(name, styleConstantJson(value)) } }
    }
    return JSONObject().put("id", layer.id).put("type", layer.type).apply {
        source?.let { put("source", it) }
        sourceLayer?.let { put("source-layer", it) }
        filter?.let { put("filter", it.json) }
        minZoom?.let { put("minzoom", it) }
        maxZoom?.let { put("maxzoom", it) }
        group(layout)?.let { put("layout", it) }
        group(paint)?.let { put("paint", it) }
    }
}
