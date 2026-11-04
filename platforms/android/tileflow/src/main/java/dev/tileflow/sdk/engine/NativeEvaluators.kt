package dev.tileflow.sdk.engine

import java.math.BigDecimal
import java.math.RoundingMode
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cbrt
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import org.json.JSONArray
import org.json.JSONObject

/**
 * The evaluators a native map needs to change its appearance without Tileflow's JavaScript
 * runtime, as the native style artifact contract defines them: theme selection, colours mixed in
 * OKLab, family templates filled at a position, blend layers, emphasis at a strength, and suns and
 * route inks mixed between themes.
 *
 * Each one reproduces Core's reference implementation; the golden fixtures Core generates
 * (`native-evaluators.json`) hold them to it, numbers within 1e-9 and strings exactly. Values are
 * org.json values: [JSONObject], [JSONArray], [Number], [String], [Boolean] and [JSONObject.NULL].
 */
internal object NativeEvaluators {
    /** The key of a template leaf: `{"tileflow:leaf": [v0, v1, …]}`. */
    const val LEAF_KEY = "tileflow:leaf"

    class Failure(message: String) : Exception(message)

    // Themes

    /** What a map's manifest says about its themes. */
    data class ThemeCatalog(
        val defaultTheme: String,
        val systemThemes: Map<String, String>? = null,
        /** Time-of-day families: a family's name and its theme for each moment. */
        val timeOfDay: Map<String, Map<String, String>>? = null,
        val themes: Set<String>,
    )

    /**
     * The concrete theme a selection shows: null chooses the map's default, `system` follows the
     * colour scheme, and a time of day picks the moment's variant of the theme's family. Unknown
     * themes never fall back.
     */
    fun theme(
        catalog: ThemeCatalog,
        selection: String?,
        colorScheme: String?,
        timeOfDay: String?,
    ): String {
        var name =
            when (selection) {
                null -> catalog.defaultTheme
                "system" -> {
                    val system =
                        catalog.systemThemes
                            ?: throw Failure(
                                "The map declares no system themes; select a concrete theme."
                            )
                    colorScheme?.let { system[it] }
                        ?: throw Failure("Resolving the system theme needs a colour scheme.")
                }
                else -> selection
            }
        if (!isThemeName(name)) throw Failure("$name is not a theme name.")
        if (name in catalog.themes) name = timeOfDayTheme(catalog.timeOfDay, name, timeOfDay)
        if (name !in catalog.themes) throw Failure("The map has no theme $name.")
        return name
    }

    fun timeOfDayTheme(
        variants: Map<String, Map<String, String>>?,
        theme: String,
        timeOfDay: String?,
    ): String {
        if (timeOfDay == null || variants == null) return theme
        if (timeOfDay !in setOf("day", "dawn", "dusk", "night"))
            throw Failure("Expected day, dawn, dusk or night.")
        // A theme outside every family is unaffected. Families keep their declared order.
        val family =
            variants[theme] ?: variants.values.firstOrNull { theme in it.values } ?: return theme
        return family[timeOfDay]
            ?: throw Failure("The theme $theme offers no $timeOfDay variant.")
    }

    private val portableId = Regex("^[a-z][a-z0-9-]{0,63}$")
    private val reservedName = Regex("^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$", RegexOption.IGNORE_CASE)

    /** A portable identifier other than `system`. */
    fun isThemeName(value: String): Boolean =
        value != "system" &&
            portableId.matches(value) &&
            value !in setOf("constructor", "prototype") &&
            !reservedName.matches(value)

    // Colours

    /** Two CSS colours mixed in OKLab, [t] of the way from the first; null unless both parse. */
    fun mixColours(from: String, to: String, t: Double): String? {
        val a = oklab(from) ?: return null
        val b = oklab(to) ?: return null
        val alpha = a[3] + (b[3] - a[3]) * t
        if (alpha <= 0) return "rgba(0, 0, 0, 0)"
        val channels = DoubleArray(4)
        for (i in 0..2) {
            val first = a[i] * a[3]
            channels[i] = (first + (b[i] * b[3] - first) * t) / alpha
        }
        channels[3] = alpha
        return colourFromOklab(channels)
    }

    /** A hex, `rgb(a)` or `hsl(a)` colour as OKLab lightness, a, b and alpha. */
    fun oklab(colour: String): DoubleArray? {
        val rgba = parseColour(colour) ?: return null
        val linear =
            DoubleArray(3) {
                val value = rgba[it] / 255
                if (value <= 0.04045) value / 12.92 else ((value + 0.055) / 1.055).pow(2.4)
            }
        val (r, g, b) = Triple(linear[0], linear[1], linear[2])
        val l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        val m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        val s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return doubleArrayOf(
            0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
            rgba[3],
        )
    }

    /** `rgba(r, g, b, a)` with rounded channels and the alpha to three decimals. */
    fun colourFromOklab(value: DoubleArray): String {
        val (lightness, a, b) = Triple(value[0], value[1], value[2])
        val l = (lightness + 0.3963377774 * a + 0.2158037573 * b).pow(3)
        val m = (lightness - 0.1055613458 * a - 0.0638541728 * b).pow(3)
        val s = (lightness - 0.0894841775 * a - 1.291485548 * b).pow(3)
        val channels =
            listOf(
                    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
                    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
                    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
                )
                .map { linear ->
                    val clamped = min(1.0, max(0.0, linear))
                    val encoded =
                        if (clamped <= 0.0031308) clamped * 12.92
                        else 1.055 * clamped.pow(1 / 2.4) - 0.055
                    // As the web's Math.round: halves round up.
                    Math.round(encoded * 255)
                }
        return "rgba(${channels[0]}, ${channels[1]}, ${channels[2]}, ${threeDecimals(value[3])})"
    }

    /**
     * A number rounded to three decimals as the web writes it: the nearer decimal of its exact
     * value (the larger magnitude on a tie), then in its shortest form, `1` rather than `1.000`.
     */
    fun threeDecimals(value: Double): String {
        if (!value.isFinite())
            return if (value.isNaN()) "NaN" else if (value < 0) "-Infinity" else "Infinity"
        val rounded = BigDecimal(value).setScale(3, RoundingMode.HALF_UP).toDouble()
        return number(rounded)
    }

    /** A number as the web writes it in text, for the values these evaluators produce. */
    fun number(value: Double): String {
        if (value == 0.0) return "0"
        if (value == floor(value) && abs(value) < 1e21) return BigDecimal(value).toPlainString()
        return value.toString()
    }

    /** Hex, `rgb(a)` and `hsl(a)` colours as 0–255 channels and 0–1 alpha. */
    fun parseColour(colour: String): DoubleArray? {
        val text = colour.trim().lowercase()
        if (text.startsWith("#")) {
            val hex = text.substring(1)
            if (hex.length !in setOf(3, 4, 6, 8) || !hex.all { it in "0123456789abcdef" })
                return null
            val full = if (hex.length <= 4) hex.map { "$it$it" }.joinToString("") else hex
            val channels = full.chunked(2).map { it.toInt(16).toDouble() }
            return doubleArrayOf(
                channels[0],
                channels[1],
                channels[2],
                if (channels.size > 3) channels[3] / 255 else 1.0,
            )
        }
        val match = functional.matchEntire(text) ?: return null
        val function = match.groupValues[1]
        val parts = match.groupValues[2].split(separators).filter { it.isNotEmpty() }
        if (parts.size !in 3..4) return null
        val alpha = if (parts.size == 4) parseUnit(parts[3], 1.0) else 1.0
        if (function.startsWith("rgb")) {
            val r = parseUnit(parts[0], 255.0)
            val g = parseUnit(parts[1], 255.0)
            val b = parseUnit(parts[2], 255.0)
            if (r == null || g == null || b == null || alpha == null) return null
            return doubleArrayOf(r, g, b, alpha)
        }
        val hue = parseFloat(parts[0])
        val saturation = parseUnit(parts[1], 1.0)
        val light = parseUnit(parts[2], 1.0)
        if (hue == null || !hue.isFinite() || saturation == null || light == null || alpha == null)
            return null
        val chroma = (1 - abs(2 * light - 1)) * saturation
        val sector = (((hue % 360) + 360) % 360) / 60
        val x = chroma * (1 - abs((sector % 2) - 1))
        val (r1, g1, b1) =
            when {
                sector < 1 -> Triple(chroma, x, 0.0)
                sector < 2 -> Triple(x, chroma, 0.0)
                sector < 3 -> Triple(0.0, chroma, x)
                sector < 4 -> Triple(0.0, x, chroma)
                sector < 5 -> Triple(x, 0.0, chroma)
                else -> Triple(chroma, 0.0, x)
            }
        val offset = light - chroma / 2
        return doubleArrayOf((r1 + offset) * 255, (g1 + offset) * 255, (b1 + offset) * 255, alpha)
    }

    private val functional = Regex("^(rgba?|hsla?)\\(([^)]+)\\)$")
    private val separators = Regex("[\\s,/]+")
    private val floatPrefix = Regex("^[+-]?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE][+-]?[0-9]+)?")

    /** A CSS number or percentage scaled to [scale]; null when it is neither. */
    fun parseUnit(part: String, scale: Double): Double? {
        val value = parseFloat(part)?.takeIf { it.isFinite() } ?: return null
        return if (part.endsWith("%")) value / 100 * scale else value
    }

    /** The number at the start of [text], as the web's `parseFloat` reads it. */
    fun parseFloat(text: String): Double? {
        val trimmed = text.trimStart()
        if (Regex("^[+-]?Infinity").containsMatchIn(trimmed))
            return if (trimmed.startsWith("-")) Double.NEGATIVE_INFINITY else Double.POSITIVE_INFINITY
        val literal = floatPrefix.find(trimmed)?.value ?: return null
        return literal.toDoubleOrNull()
    }

    // Templates

    /** The values of a template leaf, or null for anything else. */
    fun leafValues(node: Any?): List<Any>? {
        if (node !is JSONObject || node.length() != 1) return null
        val values = node.opt(LEAF_KEY) as? JSONArray ?: return null
        if (values.length() == 0) return null
        val list = (0 until values.length()).map { values.get(it) }
        return list.takeIf { items -> items.all { it is Number || it is String } }
    }

    /**
     * A template filled at a position: each leaf's selected values are mixed [position] of the way
     * along them, numbers linearly and colours in OKLab. [wrap] replaces each filled leaf.
     */
    fun fill(
        template: Any?,
        position: Double,
        select: List<Int>? = null,
        wrap: ((Any, List<Any>) -> Any)? = null,
    ): Any? {
        leafValues(template)?.let { values ->
            val selected =
                select?.map { index ->
                    if (index !in values.indices)
                        throw Failure("A blend selects a theme its leaf does not hold.")
                    values[index]
                } ?: values
            val filled = mixLeaf(selected, position)
            return wrap?.invoke(filled, selected) ?: filled
        }
        return when (template) {
            is JSONArray ->
                JSONArray().also { out ->
                    for (index in 0 until template.length())
                        out.put(fill(template.opt(index), position, select, wrap) ?: JSONObject.NULL)
                }
            is JSONObject ->
                JSONObject().also { out ->
                    for (key in template.keys())
                        out.put(key, fill(template.opt(key), position, select, wrap) ?: JSONObject.NULL)
                }
            else -> template
        }
    }

    /** One leaf's values mixed at a position, by Core's blend rule. */
    fun mixLeaf(values: List<Any>, position: Double): Any {
        if (values.size == 1 || values.all { same(it, values[0]) }) return values[0]
        val numbers = values.all { it is Number }
        val colours = values.all { it is String && oklab(it) != null }
        if (!numbers && !colours) throw Failure("A leaf holds values that cannot be mixed.")
        val at = if (position.isFinite()) min((values.size - 1).toDouble(), max(0.0, position)) else 0.0
        val index = min(values.size - 2, floor(at).toInt())
        val t = at - index
        val from = values[index]
        val to = values[index + 1]
        if (t <= 0 || same(from, to)) return from
        if (t >= 1) return to
        if (from is Number && to is Number) {
            val a = from.toDouble()
            val b = to.toDouble()
            return a + (b - a) * t
        }
        return mixColours(from.toString(), to.toString(), t) ?: if (t < 0.5) from else to
    }

    private fun same(a: Any?, b: Any?): Boolean =
        if (a is Number && b is Number) a.toDouble() == b.toDouble() else a == b

    // Blends

    /**
     * A blend group's layers at a position over selected group themes (indices into the group's
     * themes, in blend order): ground values follow the position, symbol layers and switches the
     * nearest selected theme.
     */
    fun blendLayers(group: JSONObject, selection: List<Int>, position: Double): List<JSONObject> {
        if (selection.size < 2) throw Failure("A blend selects two or more themes.")
        val at =
            if (position.isFinite()) min((selection.size - 1).toDouble(), max(0.0, position))
            else 0.0
        val dominant = Math.round(at).toInt()
        val switches = HashMap<String, MutableList<JSONObject>>()
        group.optJSONArray("switches")?.let { entries ->
            for (index in 0 until entries.length()) {
                val entry = entries.optJSONObject(index) ?: continue
                switches.getOrPut(entry.optString("layer")) { mutableListOf() } += entry
            }
        }
        val layers = group.optJSONArray("layers") ?: JSONArray()
        return (0 until layers.length()).map { index ->
            val layer = layers.getJSONObject(index)
            val symbol = layer.optString("type") == "symbol"
            val filled =
                fill(layer, if (symbol) dominant.toDouble() else at, selection) as? JSONObject
                    ?: throw Failure("A planned layer is not an object.")
            for (entry in switches[layer.optString("id")].orEmpty()) {
                val kind = entry.optString("group")
                val property = entry.optString("property")
                val values = entry.optJSONArray("values") ?: continue
                val properties = filled.optJSONObject(kind) ?: JSONObject()
                val value = values.opt(selection[dominant])
                if (value == null || value == JSONObject.NULL) properties.remove(property)
                else properties.put(property, value)
                filled.put(kind, properties)
            }
            // As Core's own blend: a layer without layout or paint values has no such object.
            for (kind in listOf("layout", "paint"))
                if (filled.optJSONObject(kind)?.length() == 0) filled.remove(kind)
            filled
        }
    }

    // Emphasis

    /**
     * An emphasis target's value at [t] (the module's amount times the emphasis strength), from 0
     * as designed to 1. With a keep area, a label value keeps its design inside the area.
     */
    fun emphasize(target: JSONObject, t: Double, keep: Any? = null): Any? {
        val at = min(1.0, max(0.0, if (t.isFinite()) t else 0.0))
        val wrap: ((Any, List<Any>) -> Any)? =
            if (target.optString("kind") == "label" && keep != null && keep != JSONObject.NULL)
                { filled, values ->
                    JSONArray()
                        .put("case")
                        .put(JSONArray().put("within").put(keep))
                        .put(values[0])
                        .put(filled)
                }
            else null
        return fill(target.opt("value"), at, wrap = wrap)
    }

    // Suns and route inks

    /** Blend sun directions in Cartesian space and light colours in OKLab. */
    fun mixSuns(from: JSONObject, to: JSONObject, t: Double): JSONObject {
        val at = min(1.0, max(0.0, if (t.isFinite()) t else 0.0))
        if (at == 0.0) return from
        if (at == 1.0) return to
        fun number(a: JSONObject?, b: JSONObject?, key: String): Double {
            val x = a?.optDouble(key, 0.0) ?: 0.0
            val y = b?.optDouble(key, 0.0) ?: 0.0
            return x + (y - x) * at
        }
        val fromAmbient = from.optJSONObject("ambient")
        val toAmbient = to.optJSONObject("ambient")
        val (azimuth, altitude) = mixedSunDirection(from, to, at)
        return JSONObject()
            .put("azimuth", azimuth)
            .put("altitude", altitude)
            .put("color", mixedColour(from.optString("color"), to.optString("color"), at))
            .put("intensity", number(from, to, "intensity"))
            .put("shadowIntensity", number(from, to, "shadowIntensity"))
            .put(
                "ambient",
                JSONObject()
                    .put(
                        "color",
                        mixedColour(
                            fromAmbient?.optString("color") ?: "",
                            toAmbient?.optString("color") ?: "",
                            at,
                        ),
                    )
                    .put("intensity", number(fromAmbient, toAmbient, "intensity")),
            )
    }

    private fun mixedSunDirection(from: JSONObject, to: JSONObject, t: Double): Pair<Double, Double> =
        mixSunDirections(from.optDouble("azimuth", 0.0), from.optDouble("altitude", 0.0),
            to.optDouble("azimuth", 0.0), to.optDouble("altitude", 0.0), t)

    fun mixSunDirections(azimuthA: Double, altitudeA: Double, azimuthB: Double, altitudeB: Double, t: Double): Pair<Double, Double> {
        fun vector(azimuth: Double, altitude: Double): DoubleArray {
            val a = Math.toRadians(azimuth)
            val h = Math.toRadians(altitude)
            return doubleArrayOf(sin(a) * cos(h), cos(a) * cos(h), sin(h))
        }

        val a = vector(azimuthA, altitudeA)
        val b = vector(azimuthB, altitudeB)
        val azimuth = mixAzimuths(azimuthA, azimuthB, t)
        if (a.indices.sumOf { a[it] * b[it] } < -0.9995) {
            return azimuth to altitudeA + (altitudeB - altitudeA) * t
        }

        val (x, y, z) = DoubleArray(3) { a[it] + (b[it] - a[it]) * t }
        val horizontal = hypot(x, y)
        val bearing = if (horizontal < 1e-12) azimuth else normalizedAzimuth(Math.toDegrees(atan2(x, y)))
        return bearing to Math.toDegrees(atan2(z, horizontal))
    }

    /** An azimuth [t] of the way from [from] to [to], turning the short way round. */
    fun mixAzimuths(from: Double, to: Double, t: Double): Double {
        var delta = normalizedAzimuth(to) - normalizedAzimuth(from)
        if (delta > 180) delta -= 360
        if (delta < -180) delta += 360
        return normalizedAzimuth(from + delta * t)
    }

    fun normalizedAzimuth(azimuth: Double): Double {
        val turned = azimuth % 360
        return if (turned < 0) turned + 360 else if (turned == 0.0) 0.0 else turned
    }

    val routeInkColours = listOf("line", "casing", "core", "glow", "alternative")
    val routeInkNumbers = listOf("glowOpacity", "coreOpacity")

    /** Two themes' route inks mixed: colours in OKLab and numbers linearly. */
    fun mixRouteInks(from: JSONObject, to: JSONObject, t: Double): JSONObject {
        val at = min(1.0, max(0.0, if (t.isFinite()) t else 0.0))
        if (at == 0.0) return from
        if (at == 1.0) return to
        val inks = JSONObject()
        for (key in routeInkColours)
            inks.put(key, mixedColour(from.optString(key), to.optString(key), at))
        for (key in routeInkNumbers) {
            val a = from.optDouble(key, 0.0)
            val b = to.optDouble(key, 0.0)
            inks.put(key, a + (b - a) * at)
        }
        return inks
    }

    /** Values at a blend position over the blended themes' values, in blend order. */
    fun <T> at(values: List<T>, position: Double, mix: (T, T, Double) -> T): T? {
        if (values.isEmpty()) return null
        val at = if (position.isFinite()) min((values.size - 1).toDouble(), max(0.0, position)) else 0.0
        val lower = floor(at).toInt()
        val upper = min(values.size - 1, lower + 1)
        return mix(values[lower], values[upper], at - lower)
    }

    private fun mixedColour(from: String, to: String, t: Double): String =
        mixColours(from, to, t) ?: if (t < 0.5) from else to
}
