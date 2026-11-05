package dev.tileflow.reactnative.map

import dev.tileflow.sdk.*
import java.time.Instant
import kotlin.math.roundToLong
import org.json.JSONArray
import org.json.JSONObject

internal object SceneValues {
    data class Blend(val themes: List<String>, val position: Double, val hold: Boolean)

    fun milliseconds(value: Double): Long {
        if (value < 0 || value >= Long.MAX_VALUE.toDouble()) MapValues.invalid()
        return value.roundToLong()
    }

    fun duration(value: JSONObject, key: String = "duration", default: Long = 0): Long =
        MapValues.optionalNumber(value, key)?.let(::milliseconds) ?: default

    fun blend(value: JSONObject): Blend =
        if (value.has("themes")) Blend(
            MapValues.list(value.getJSONArray("themes"), MapValues::string),
            MapValues.number(value.get("position")),
            MapValues.boolean(value, "hold", false),
        ) else Blend(
            listOf(MapValues.string(value.get("from")), MapValues.string(value.get("to"))),
            MapValues.number(value.get("mix")),
            false,
        )

    fun themeDuration(value: JSONObject): Long {
        val transition = MapValues.objectValue(value, "themeTransition") ?: return 0
        val result = duration(transition)
        if (result !in 0..5000) MapValues.invalid()
        return result
    }

    fun sun(value: JSONObject?): TileflowSun? {
        if (value == null) return null
        if (value.has("date")) {
            val time = MapValues.number(value.get("date"))
            if (time !in Long.MIN_VALUE.toDouble()..Long.MAX_VALUE.toDouble()) MapValues.invalid()
            return TileflowSun.AtDate(
                Instant.ofEpochMilli(time.roundToLong()),
                MapValues.arrayValue(value, "location")?.let(MapValues::coordinate),
            )
        }
        return TileflowSun.Direction(MapValues.number(value.get("azimuth")), MapValues.number(value.get("altitude")))
    }

    fun emphasis(value: JSONObject?): TileflowEmphasis? {
        if (value == null) return null
        val recede = MapValues.objectValue(value, "recede") ?: JSONObject()
        return TileflowEmphasis(
            recede.keys().asSequence().associate { TileflowMapModule(it) to MapValues.number(recede.get(it)) },
            MapValues.optionalNumber(value, "labels"),
            MapValues.objectValue(value, "keepArea")?.toString(),
        )
    }

    fun boundaries(value: JSONObject?): TileflowBoundaryValues? {
        if (value == null) return null
        if (value.has("ids") == value.has("refs")) MapValues.invalid()
        val ids = value.has("ids")
        val cells = value.getJSONObject(if (ids) "ids" else "refs")
        val converted = cells.keys().asSequence().associateWith { key ->
            when (val cell = cells.get(key)) {
                is String -> TileflowBoundaryValue.Category(cell)
                is Number -> TileflowBoundaryValue.Number(MapValues.number(cell))
                else -> MapValues.invalid()
            }
        }
        val labels = MapValues.boolean(value, "labels", false)
        val state = MapValues.optionalString(value, "state") ?: "value"
        if (!ids) return TileflowBoundaryValues.byRefs(converted, labels, state)
        return TileflowBoundaryValues.byIds(converted.mapKeys { (id, _) ->
            id.toLongOrNull()?.takeIf { it >= 0 && it.toString() == id } ?: MapValues.invalid()
        }, labels, state)
    }

    fun progress(value: JSONObject): TileflowLineProgress = TileflowLineProgress(
        start = MapValues.optionalNumber(value, "start") ?: 0.0,
        end = MapValues.optionalNumber(value, "end") ?: 1.0,
        light = MapValues.optionalNumber(value, "light"),
        opacity = MapValues.optionalNumber(value, "opacity") ?: 1.0,
        highlight = MapValues.optionalString(value, "highlight"),
    )

    fun shot(value: JSONObject): TileflowShot {
        val frames = MapValues.list(value.getJSONArray("keyframes")) { raw ->
            val frame = raw as? JSONObject ?: MapValues.invalid()
            val camera = frame.getJSONObject("camera")
            val center = MapValues.coordinate(camera.getJSONArray("centerCoordinate"))
            TileflowShot.Keyframe(
                milliseconds(MapValues.number(frame.get("time"))),
                TileflowCamera(center.longitude, center.latitude, MapValues.number(camera.get("zoomLevel")),
                    MapValues.optionalNumber(camera, "heading") ?: 0.0, MapValues.optionalNumber(camera, "pitch") ?: 0.0),
                MapValues.optionalNumber(frame, "blendPosition"),
            )
        }
        val cues = MapValues.arrayValue(value, "cues")?.let { array -> MapValues.list(array) { raw ->
            val cue = raw as? JSONObject ?: MapValues.invalid()
            TileflowShot.Cue(milliseconds(MapValues.number(cue.get("time"))), MapValues.string(cue.get("id")))
        } } ?: emptyList()
        val easing = when (MapValues.optionalString(value, "easing")) {
            null, "smooth" -> TileflowShot.Easing.SMOOTH
            "linear" -> TileflowShot.Easing.LINEAR
            else -> MapValues.invalid()
        }
        return TileflowShot(frames, MapValues.arrayValue(value, "themes")?.let { MapValues.list(it, MapValues::string) }, easing, cues)
    }

    fun depthMarker(value: JSONObject): TileflowDepthMarker {
        val size = value.getJSONArray("size")
        val offset = MapValues.arrayValue(value, "offset") ?: JSONArray().put(0).put(0)
        if (size.length() != 2 || offset.length() != 2) MapValues.invalid()
        val alignment = when (MapValues.optionalString(value, "alignment")) {
            null, "screen" -> TileflowDepthMarker.Alignment.SCREEN
            "ground" -> TileflowDepthMarker.Alignment.GROUND
            else -> MapValues.invalid()
        }
        val anchor = when (MapValues.optionalString(value, "anchor")) {
            null, "center" -> TileflowDepthMarker.Anchor.CENTER
            "bottom" -> TileflowDepthMarker.Anchor.BOTTOM
            else -> MapValues.invalid()
        }
        return TileflowDepthMarker(
            id = MapValues.string(value.get("id")), coordinate = MapValues.coordinate(value.getJSONArray("coordinate")),
            image = MapValues.string(value.get("image")), width = MapValues.number(size.get(0)), height = MapValues.number(size.get(1)),
            alignment = alignment, anchor = anchor,
            offsetX = MapValues.number(offset.get(0)), offsetY = MapValues.number(offset.get(1)),
            rotation = MapValues.optionalNumber(value, "rotation") ?: 0.0,
            altitude = MapValues.optionalNumber(value, "altitude") ?: 0.0,
            opacity = MapValues.optionalNumber(value, "opacity") ?: 1.0,
            occluded = MapValues.boolean(value, "occluded", true),
        )
    }

    suspend fun images(value: JSONArray, load: suspend (String) -> ByteArray): List<TileflowMapImage> {
        val items = MapValues.list(value) { it as? JSONObject ?: MapValues.invalid() }
        if (items.map { MapValues.string(it.get("id")) }.toSet().size != items.size) MapValues.invalid()
        var bytes = 0L
        var entries = 0
        suspend fun read(uri: String): ByteArray {
            if (++entries > 64) MapValues.invalid()
            val data = load(uri)
            bytes += data.size
            if (data.size > 32 * 1024 * 1024 || bytes > 64 * 1024 * 1024) MapValues.invalid()
            return data
        }
        return items.map { image ->
            val data = read(MapValues.string(image.get("uri")))
            val variants = MapValues.objectValue(image, "variants") ?: JSONObject()
            val images = mutableMapOf<String, ByteArray>()
            for (name in variants.keys()) images[name] = read(MapValues.string(variants.get(name)))
            TileflowMapImage(
                MapValues.string(image.get("id")), data, MapValues.optionalNumber(image, "scale") ?: 1.0,
                images, MapValues.boolean(image, "sdf", false),
            )
        }
    }

    fun routeInks(value: TileflowRouteInks): JSONObject = JSONObject()
        .put("line", value.line).put("casing", value.casing).put("core", value.core)
        .put("glow", value.glow).put("alternative", value.alternative)
        .put("glowOpacity", value.glowOpacity).put("coreOpacity", value.coreOpacity)
}
