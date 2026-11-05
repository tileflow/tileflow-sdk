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

    data class BoundaryJoin(val rows: List<TileflowBoundaryRow>, val options: JoinBoundaryRowsOptions)

    fun boundaryJoin(value: JSONObject): BoundaryJoin {
        val rows = MapValues.list(value.getJSONArray("rows")) { raw ->
            val row = raw as? JSONObject ?: MapValues.invalid()
            val key = when (val key = row.get("key")) {
                is String -> TileflowBoundaryKey.Text(key)
                is Number -> TileflowBoundaryKey.Number(MapValues.number(key))
                else -> MapValues.invalid()
            }
            val cell = when (val cell = row.get("value")) {
                JSONObject.NULL -> null
                is String -> TileflowBoundaryValue.Category(cell)
                is Number -> TileflowBoundaryValue.Number(MapValues.number(cell))
                else -> MapValues.invalid()
            }
            TileflowBoundaryRow(key, cell)
        }
        val input = value.getJSONObject("options")
        val code = MapValues.string(input.get("joinBy"))
        val joinBy = TileflowBoundaryCode.entries.firstOrNull { it.wireName == code } ?: MapValues.invalid()
        val to = MapValues.optionalString(input, "to") ?: "id"
        val target = TileflowBoundaryTarget.entries.firstOrNull { it.wireName == to } ?: MapValues.invalid()
        val classes = MapValues.arrayValue(input, "classes")?.let { array ->
            MapValues.list(array) { boundaryClass(MapValues.string(it)) }.toSet()
        }
        val lookup = MapValues.objectValue(input, "lookup")?.let { lookup ->
            TileflowBoundaryLookup(MapValues.list(lookup.getJSONArray("rows")) { raw ->
                val row = raw as? JSONObject ?: MapValues.invalid()
                TileflowBoundaryLookupRow(
                    id = MapValues.number(row.get("id")),
                    boundaryClass = boundaryClass(MapValues.string(row.get("class"))),
                    adminLevel = MapValues.optionalNumber(row, "admin_level")?.let {
                        if (it != Math.rint(it) || it !in -9007199254740991.0..9007199254740991.0)
                            MapValues.invalid()
                        it.toLong()
                    },
                    classTier = MapValues.optionalString(row, "class_tier"),
                    iso31661 = MapValues.optionalString(row, "iso_3166_1"),
                    iso31662 = MapValues.optionalString(row, "iso_3166_2"),
                    name = MapValues.optionalString(row, "name"),
                    nameEn = MapValues.optionalString(row, "name_en"),
                    nuts = MapValues.optionalString(row, "nuts"),
                    ref = MapValues.optionalString(row, "ref"),
                    wikidata = MapValues.optionalString(row, "wikidata"),
                )
            })
        }
        return BoundaryJoin(rows, JoinBoundaryRowsOptions(joinBy, target, classes, lookup))
    }

    fun boundaryJoin(result: TileflowBoundaryJoinResult): JSONObject {
        fun key(value: TileflowBoundaryKey): Any = when (value) {
            is TileflowBoundaryKey.Number -> value.value
            is TileflowBoundaryKey.Text -> value.value
        }
        val rows = result.rows.map { row ->
            val cell = when (val value = row.value) {
                null -> JSONObject.NULL
                is TileflowBoundaryValue.Number -> value.value
                is TileflowBoundaryValue.Category -> value.value
            }
            JSONObject().put("key", key(row.key)).put("value", cell)
        }
        return JSONObject().put("joinBy", result.joinBy.wireName)
            .put("rows", JSONArray(rows))
            .put("ambiguous", JSONArray(result.ambiguous.map(::key)))
            .put("duplicates", JSONArray(result.duplicates.map(::key)))
            .put("unmatched", JSONArray(result.unmatched.map(::key)))
    }

    private fun boundaryClass(value: String): TileflowBoundaryClass =
        TileflowBoundaryClass.entries.firstOrNull { it.wireName == value } ?: MapValues.invalid()

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
