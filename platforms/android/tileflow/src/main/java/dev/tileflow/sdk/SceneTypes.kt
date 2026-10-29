package dev.tileflow.sdk

import android.graphics.Bitmap
import android.util.DisplayMetrics
import dev.tileflow.sdk.bridge.ProtocolContract
import java.io.ByteArrayOutputStream
import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject

private val COLOR = Regex("^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")
private val IMAGE_NAME = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

private fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

/**
 * Where the map's sun stands. The themes keep the sun's colours, strengths and shadow strength;
 * the light turns to the new direction, anchored to the map.
 */
public sealed interface TileflowSun {
    /**
     * @property azimuth Degrees clockwise from north, from −360 to 360.
     * @property altitude Degrees above the horizon, from −90 to 90.
     */
    public data class Direction(val azimuth: Double, val altitude: Double) : TileflowSun

    /** The real sun at [date] over [location], or over the map's centre when it is null. */
    public data class AtDate(val date: Instant, val location: TileflowCoordinate? = null) :
        TileflowSun

    public companion object {
        internal fun json(sun: TileflowSun?): Any =
            when (sun) {
                null -> JSONObject.NULL
                is Direction -> {
                    if (sun.azimuth !in -360.0..360.0 || sun.altitude !in -90.0..90.0) invalid()
                    JSONObject().put("azimuth", sun.azimuth).put("altitude", sun.altitude)
                }
                is AtDate ->
                    JSONObject().put("date", sun.date.toEpochMilli()).apply {
                        sun.location?.let {
                            if (it.longitude !in -180.0..180.0 || it.latitude !in -90.0..90.0)
                                invalid()
                            put(
                                "location",
                                JSONObject()
                                    .put("longitude", it.longitude)
                                    .put("latitude", it.latitude),
                            )
                        }
                    }
            }
    }
}

/** A semantic module of a Tileflow map, such as its roads or water, as emphasis addresses it. */
public data class TileflowMapModule(val name: String) {
    public companion object {
        @JvmField public val ADDRESSES: TileflowMapModule = TileflowMapModule("addresses")
        @JvmField public val AEROWAYS: TileflowMapModule = TileflowMapModule("aeroways")
        @JvmField public val BOUNDARIES: TileflowMapModule = TileflowMapModule("boundaries")
        @JvmField public val BUILDINGS: TileflowMapModule = TileflowMapModule("buildings")
        @JvmField public val LABELS: TileflowMapModule = TileflowMapModule("labels")
        @JvmField public val LAND: TileflowMapModule = TileflowMapModule("land")
        @JvmField public val LANDFORMS: TileflowMapModule = TileflowMapModule("landforms")
        @JvmField public val NAUTICAL: TileflowMapModule = TileflowMapModule("nautical")
        @JvmField public val POI: TileflowMapModule = TileflowMapModule("poi")
        @JvmField public val ROADS: TileflowMapModule = TileflowMapModule("roads")
        @JvmField public val TERRAIN: TileflowMapModule = TileflowMapModule("terrain")
        @JvmField public val TRANSIT: TileflowMapModule = TileflowMapModule("transit")
        @JvmField public val VEGETATION: TileflowMapModule = TileflowMapModule("vegetation")
        @JvmField public val WATER: TileflowMapModule = TileflowMapModule("water")
    }
}

/**
 * How the map steps back so the application's content reads first. Emphasis stays through theme
 * changes and blends.
 *
 * @property recede Modules whose ground recedes towards the map's ground colour, from 0 (as
 *   designed) to 1.
 * @property labels The share of their opacity the map's labels and icons keep, from 0 to 1.
 * @property keepArea A GeoJSON `Polygon` or `MultiPolygon` geometry in which labels and icons keep
 *   their full strength. It travels on the SDK's data channel.
 */
public data class TileflowEmphasis(
    val recede: Map<TileflowMapModule, Double> = emptyMap(),
    val labels: Double? = null,
    val keepArea: String? = null,
)

/** A value an application sets for the whole style, which themes read with `globalState`. */
public sealed interface TileflowStyleValue {
    public data class Bool(val value: Boolean) : TileflowStyleValue

    public data class Number(val value: Double) : TileflowStyleValue

    public data class Text(val value: String) : TileflowStyleValue

    public data object Null : TileflowStyleValue

    public companion object {
        internal fun json(value: TileflowStyleValue): Any =
            when (value) {
                is Bool -> value.value
                is Number -> value.value.also { if (!it.isFinite()) invalid() }
                is Text -> value.value.also { if (it.length > 1024) invalid() }
                Null -> JSONObject.NULL
            }
    }
}

/** One of the inks a theme draws an application's route in. */
public enum class TileflowRouteInk(internal val wireName: String) {
    /** The chosen route's line. */
    LINE("line"),
    /** The edge on each side of the line, which sets it apart from the roads under it. */
    CASING("casing"),
    /** A thin line along the middle of the route; the theme's core opacity scales it. */
    CORE("core"),
    /** A soft halo around the route; the theme's glow opacity scales it. */
    GLOW("glow"),
    /** Other routes offered beside the chosen one. */
    ALTERNATIVE("alternative"),
}

/**
 * The route inks of the theme on screen, mixed between neighbouring themes during a blend. Layers
 * drawn with a [TileflowRouteInk] follow them without the application's help. Colours are
 * `#rrggbb`; [glowOpacity] and [coreOpacity] run from 0, which hides that layer, to 1.
 */
public data class TileflowRouteInks(
    val line: String,
    val casing: String,
    val core: String,
    val glow: String,
    val alternative: String,
    val glowOpacity: Double,
    val coreOpacity: Double,
) {
    /** The colour of an ink. */
    public operator fun get(ink: TileflowRouteInk): String =
        when (ink) {
            TileflowRouteInk.LINE -> line
            TileflowRouteInk.CASING -> casing
            TileflowRouteInk.CORE -> core
            TileflowRouteInk.GLOW -> glow
            TileflowRouteInk.ALTERNATIVE -> alternative
        }

    public companion object {
        /** The inks of a light theme that sets no route inks of its own. */
        @JvmField
        public val LIGHT: TileflowRouteInks =
            TileflowRouteInks("#2563eb", "#1e3a8a", "#dbeafe", "#2563eb", "#94a3b8", 0.16, 0.0)

        /** The inks of a dark theme that sets no route inks of its own. */
        @JvmField
        public val DARK: TileflowRouteInks =
            TileflowRouteInks("#60a5fa", "#0b1220", "#eff6ff", "#60a5fa", "#64748b", 0.4, 0.7)

        internal fun from(json: JSONObject): TileflowRouteInks {
            val inks =
                TileflowRouteInks(
                    json.getString("line"),
                    json.getString("casing"),
                    json.getString("core"),
                    json.getString("glow"),
                    json.getString("alternative"),
                    json.getDouble("glowOpacity"),
                    json.getDouble("coreOpacity"),
                )
            require(inks.glowOpacity in 0.0..1.0 && inks.coreOpacity in 0.0..1.0)
            return inks
        }
    }
}

/** Where an application layer is drawn. */
public enum class TileflowLayerPlacement(internal val wireName: String) {
    /** Above the whole map, its labels and 3D content included. */
    TOP("top"),
    /** On the ground: under the map's labels, and hidden where its 3D content stands in front. */
    GROUND("ground"),
}

/**
 * The stretch of a line that shows, as shares of its length from its start, with a light that can
 * run along it.
 *
 * @property start Where the drawn stretch starts, from 0 to 1.
 * @property end Where the drawn stretch ends, from 0 to 1. While it ends before the line does, its
 *   head shows in [highlight].
 * @property light Where a light sits along the line, from 0 to 1, or null for none.
 * @property opacity The line's opacity, multiplied with the layer's, from 0 to 1.
 * @property highlight The colour of the head and the light, `#rrggbb`; null shows neither.
 *   Animations keep the layer's highlight.
 */
public data class TileflowLineProgress(
    val start: Double = 0.0,
    val end: Double = 1.0,
    val light: Double? = null,
    val opacity: Double = 1.0,
    val highlight: String? = null,
) {
    internal fun validate() {
        if (
            listOf(start, end, opacity).any { it !in 0.0..1.0 } ||
                (light != null && light !in 0.0..1.0) ||
                (highlight != null && !COLOR.matches(highlight))
        )
            invalid()
    }

    internal fun stateJson(): JSONObject =
        JSONObject()
            .put("start", start)
            .put("end", end)
            .put("light", light ?: JSONObject.NULL)
            .put("opacity", opacity)

    internal fun json(): JSONObject = stateJson().apply { highlight?.let { put("highlight", it) } }
}

/** A value a Boundaries choropleth colours: a number for scales, text for categories. */
public sealed interface TileflowBoundaryValue {
    public data class Number(val value: Double) : TileflowBoundaryValue

    public data class Category(val value: String) : TileflowBoundaryValue
}

/**
 * Application values on the map's Boundaries areas, for a choropleth that reads them as feature
 * state, as `useBoundaryFeatureState` sets them on the web. Values survive theme changes.
 *
 * @property labels Also set the values on the areas' label points, for labels styled by value.
 * @property state The feature-state key the choropleth reads; it must match its `state`.
 */
public class TileflowBoundaryValues
private constructor(
    private val ids: Map<Long, TileflowBoundaryValue>?,
    private val refs: Map<String, TileflowBoundaryValue>?,
    public val labels: Boolean,
    public val state: String,
) {
    /** `[[key, value], …]` in key order, so equal values send equal bytes. */
    internal fun rows(): Pair<String, ByteArray> {
        if (!Regex("^[A-Za-z0-9_-]{1,64}$").matches(state)) invalid()
        fun value(value: TileflowBoundaryValue): Any =
            when (value) {
                is TileflowBoundaryValue.Number ->
                    value.value.also { if (!it.isFinite()) invalid() }
                is TileflowBoundaryValue.Category ->
                    value.value.also { if (it.length > 256) invalid() }
            }
        val rows = JSONArray()
        val joinBy: String
        if (ids != null) {
            joinBy = "id"
            for ((key, cell) in ids.toSortedMap()) {
                if (key < 0) invalid()
                rows.put(JSONArray().put(key).put(value(cell)))
            }
        } else {
            joinBy = "ref"
            for ((key, cell) in refs!!.toSortedMap()) {
                if (key.isEmpty() || key.length > 256) invalid()
                rows.put(JSONArray().put(key).put(value(cell)))
            }
        }
        return joinBy to rows.toString().toByteArray(Charsets.UTF_8)
    }

    override fun equals(other: Any?): Boolean =
        other is TileflowBoundaryValues &&
            ids == other.ids &&
            refs == other.refs &&
            labels == other.labels &&
            state == other.state

    override fun hashCode(): Int = listOf(ids, refs, labels, state).hashCode()

    public companion object {
        /** Values keyed by the areas' registry IDs, the polygons' feature IDs by default. */
        @JvmStatic
        @JvmOverloads
        public fun byIds(
            values: Map<Long, TileflowBoundaryValue>,
            labels: Boolean = false,
            state: String = "value",
        ): TileflowBoundaryValues = TileflowBoundaryValues(values.toMap(), null, labels, state)

        /** Values keyed by `ref`, for a map that promotes `ref` to the feature ID. */
        @JvmStatic
        @JvmOverloads
        public fun byRefs(
            values: Map<String, TileflowBoundaryValue>,
            labels: Boolean = false,
            state: String = "value",
        ): TileflowBoundaryValues = TileflowBoundaryValues(null, values.toMap(), labels, state)
    }
}

/**
 * An image the application gives the map by name: for the style's own symbols, such as an icon a
 * theme names, and for [TileflowDepthMarker]. Its variants show while their theme is on screen.
 *
 * @property pixelRatio Physical pixels per density-independent pixel, from 1 to 4.
 */
public class TileflowMapImage
@JvmOverloads
constructor(
    public val name: String,
    data: ByteArray,
    public val pixelRatio: Double = 1.0,
    variants: Map<String, ByteArray> = emptyMap(),
) {
    internal val data: ByteArray = data.copyOf()
    internal val variants: Map<String, ByteArray> = variants.mapValues { it.value.copyOf() }

    init {
        if (
            !IMAGE_NAME.matches(name) ||
                pixelRatio !in 1.0..4.0 ||
                this.data.isEmpty() ||
                this.variants.any { (theme, bytes) ->
                    theme.isEmpty() || theme.length > 128 || bytes.isEmpty()
                }
        )
            invalid()
        if ((listOf(this.data) + this.variants.values).any {
                it.size > ProtocolContract.MAXIMUM_DATA_BYTES
            })
            throw TileflowMapException(
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorContext.of(
                    ProtocolContract.ErrorReason.DATA_TOO_LARGE,
                    ProtocolContract.MAXIMUM_DATA_BYTES,
                ),
            )
    }

    public companion object {
        /**
         * A bitmap at its own density, and variants by theme name, sent as PNG. The variants must
         * have the bitmap's size.
         */
        @JvmStatic
        @JvmOverloads
        public fun fromBitmap(
            name: String,
            bitmap: Bitmap,
            variants: Map<String, Bitmap> = emptyMap(),
        ): TileflowMapImage {
            fun png(bitmap: Bitmap): ByteArray =
                ByteArrayOutputStream().use {
                    if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) invalid()
                    it.toByteArray()
                }
            val density =
                if (bitmap.density == Bitmap.DENSITY_NONE) DisplayMetrics.DENSITY_DEFAULT
                else bitmap.density
            return TileflowMapImage(
                name,
                png(bitmap),
                (density.toDouble() / DisplayMetrics.DENSITY_DEFAULT).coerceIn(1.0, 4.0),
                variants.mapValues { png(it.value) },
            )
        }
    }
}

/**
 * A picture pinned to a position in the map's 3D scene, which nearer 3D buildings hide.
 *
 * @property image The name of a [TileflowMapImage] the map holds.
 * @property width Density-independent pixels for a screen marker, metres for a ground marker.
 * @property height Density-independent pixels for a screen marker, metres for a ground marker.
 * @property offsetX A screen marker's shift to the right, in density-independent pixels.
 * @property offsetY A screen marker's shift down, in density-independent pixels.
 * @property rotation Degrees clockwise: from the screen's up for a screen marker, from north for a
 *   ground one.
 * @property altitude Metres above the ground.
 * @property occluded Whether nearer 3D content hides the marker.
 */
public data class TileflowDepthMarker(
    val id: String,
    val coordinate: TileflowCoordinate,
    val image: String,
    val width: Double,
    val height: Double,
    val alignment: Alignment = Alignment.SCREEN,
    val anchor: Anchor = Anchor.CENTER,
    val offsetX: Double = 0.0,
    val offsetY: Double = 0.0,
    val rotation: Double = 0.0,
    val altitude: Double = 0.0,
    val opacity: Double = 1.0,
    val occluded: Boolean = true,
) {
    public enum class Alignment(internal val wireName: String) {
        /** Faces the viewer at a size in density-independent pixels, as a pin does. */
        SCREEN("screen"),
        /** Lies flat on the ground at a size in metres, as a ring on the street does. */
        GROUND("ground"),
    }

    public enum class Anchor(internal val wireName: String) {
        CENTER("center"),
        BOTTOM("bottom"),
    }

    internal fun json(): JSONObject {
        if (
            !IMAGE_NAME.matches(id) ||
                !IMAGE_NAME.matches(image) ||
                coordinate.longitude !in -180.0..180.0 ||
                coordinate.latitude !in -90.0..90.0 ||
                width !in 0.0..4096.0 ||
                height !in 0.0..4096.0 ||
                offsetX !in -4096.0..4096.0 ||
                offsetY !in -4096.0..4096.0 ||
                rotation !in -360.0..360.0 ||
                altitude !in -1000.0..10_000.0 ||
                opacity !in 0.0..1.0
        )
            invalid()
        return JSONObject()
            .put("id", id)
            .put(
                "coordinate",
                JSONObject()
                    .put("longitude", coordinate.longitude)
                    .put("latitude", coordinate.latitude),
            )
            .put("image", image)
            .put("size", JSONArray().put(width).put(height))
            .put("alignment", alignment.wireName)
            .put("anchor", anchor.wireName)
            .put("offset", JSONArray().put(offsetX).put(offsetY))
            .put("rotation", rotation)
            .put("altitude", altitude)
            .put("opacity", opacity)
            .put("occlude", occluded)
    }
}

/**
 * A timed camera shot: the camera follows its keyframes frame by frame, as Tileflow Capture renders
 * the same shot to video.
 *
 * @property themes Two to eight themes the shot blends between, by each keyframe's blend position.
 */
public data class TileflowShot(
    val keyframes: List<Keyframe>,
    val themes: List<String>? = null,
    val easing: Easing = Easing.SMOOTH,
    val cues: List<Cue> = emptyList(),
) {
    /**
     * @property timeMillis Milliseconds from the start; the first keyframe is at 0 and later ones
     *   rise strictly.
     * @property blendPosition The blend position at this keyframe, when the shot blends [themes].
     */
    public data class Keyframe(
        val timeMillis: Long,
        val camera: TileflowCamera,
        val blendPosition: Double? = null,
    )

    /** A moment of the shot at which [play] calls back, to start the app's own work in time. */
    public data class Cue(val timeMillis: Long, val id: String)

    public enum class Easing(internal val wireName: String) {
        /** Each segment eases in and out. */
        SMOOTH("smooth"),
        LINEAR("linear"),
    }

    internal fun json(): JSONObject {
        val last = keyframes.lastOrNull()?.timeMillis ?: invalid()
        if (
            keyframes.size !in 2..256 ||
                keyframes.first().timeMillis != 0L ||
                keyframes.zipWithNext().any { (a, b) -> a.timeMillis >= b.timeMillis } ||
                last > 3_600_000 ||
                cues.size > 64 ||
                cues.any {
                    it.timeMillis !in 0..last ||
                        !Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$").matches(it.id)
                }
        )
            invalid()
        if (themes != null) {
            if (
                themes.size !in 2..8 ||
                    themes.toSet().size != themes.size ||
                    themes.any { it.isEmpty() || it.length > 128 } ||
                    keyframes.any {
                        val position = it.blendPosition
                        position == null || position !in 0.0..(themes.size - 1).toDouble()
                    }
            )
                invalid()
        } else if (keyframes.any { it.blendPosition != null }) invalid()
        val frames =
            JSONArray(
                keyframes.map { keyframe ->
                    val camera = keyframe.camera
                    if (
                        camera.longitude !in -180.0..180.0 ||
                            camera.latitude !in -90.0..90.0 ||
                            camera.zoom !in 0.0..24.0 ||
                            camera.bearing !in -360.0..360.0 ||
                            camera.pitch !in 0.0..85.0
                    )
                        invalid()
                    JSONObject().put("at", keyframe.timeMillis).put("camera", camera.json()).apply {
                        keyframe.blendPosition?.let { put("blendPosition", it) }
                    }
                }
            )
        return JSONObject()
            .put("keyframes", frames)
            .put("easing", easing.wireName)
            .put(
                "cues",
                JSONArray(cues.map { JSONObject().put("at", it.timeMillis).put("id", it.id) }),
            )
            .apply { themes?.let { put("themes", JSONArray(it)) } }
    }
}

/**
 * A theme change as it happens: the map prepares the target theme, applies it, and settles.
 *
 * @property routeInks The route inks of the theme on screen, once it is ready.
 */
public data class TileflowThemeTransition(
    val phase: Phase,
    val currentTheme: String?,
    val targetTheme: String?,
    val routeInks: TileflowRouteInks? = null,
) {
    public enum class Phase(internal val wireName: String) {
        /** The target theme's style and fonts are loading. */
        PRELOADING("preloading"),
        /** The map is changing to the target theme. */
        APPLYING("applying"),
        /** The theme is on screen. */
        READY("ready"),
        /** The change failed; the map keeps the theme it showed. */
        FAILED("error"),
    }

    internal companion object {
        fun from(json: JSONObject): TileflowThemeTransition {
            val phase =
                requireNotNull(Phase.entries.firstOrNull { it.wireName == json.getString("phase") })
            fun text(key: String): String? = if (json.has(key)) json.getString(key) else null
            return TileflowThemeTransition(
                phase,
                text("currentTheme"),
                text("targetTheme"),
                json.optJSONObject("routeInks")?.let(TileflowRouteInks::from),
            )
        }
    }
}
