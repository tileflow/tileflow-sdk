package dev.tileflow.reactnative.map

import dev.tileflow.sdk.*
import dev.tileflow.sdk.location.TileflowLocation
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

/** Conversions between the shared React Native contract and public SDK values. */
internal object MapValues {
    fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

    fun number(value: Any?): Double =
        (value as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: invalid()

    fun string(value: Any?): String = value as? String ?: invalid()

    fun optionalNumber(value: JSONObject, key: String): Double? =
        if (value.isNull(key)) null else number(value.get(key))

    fun optionalString(value: JSONObject, key: String): String? =
        if (value.isNull(key)) null else string(value.get(key))

    fun objectValue(value: JSONObject, key: String): JSONObject? =
        if (value.isNull(key)) null else value.get(key) as? JSONObject ?: invalid()

    fun arrayValue(value: JSONObject, key: String): JSONArray? =
        if (value.isNull(key)) null else value.get(key) as? JSONArray ?: invalid()

    fun only(value: JSONObject, vararg keys: String) {
        val allowed = keys.toSet()
        if (value.keys().asSequence().any { it !in allowed }) invalid()
    }

    fun boolean(value: JSONObject, key: String, default: Boolean): Boolean =
        if (value.isNull(key)) default else value.get(key) as? Boolean ?: invalid()

    fun integer(value: Any?): Int {
        val number = number(value)
        if (number != Math.rint(number) || number !in Int.MIN_VALUE.toDouble()..Int.MAX_VALUE.toDouble()) invalid()
        return number.toInt()
    }

    fun coordinate(value: JSONArray): TileflowCoordinate {
        if (value.length() != 2) invalid()
        return TileflowCoordinate(number(value.get(0)), number(value.get(1)))
    }

    fun coordinate(value: TileflowCoordinate): JSONArray = JSONArray().put(value.longitude).put(value.latitude)

    fun point(value: JSONArray, density: Float): TileflowPoint {
        if (value.length() != 2) invalid()
        return TileflowPoint((number(value.get(0)) * density).toFloat(), (number(value.get(1)) * density).toFloat())
    }

    fun point(value: TileflowPoint, density: Float): JSONArray = JSONArray().put(value.x / density).put(value.y / density)

    fun bounds(value: JSONObject): TileflowBounds {
        val ne = coordinate(value.getJSONArray("ne"))
        val sw = coordinate(value.getJSONArray("sw"))
        return TileflowBounds(sw.longitude, sw.latitude, ne.longitude, ne.latitude)
    }

    fun bounds(value: TileflowBounds): JSONObject = JSONObject()
        .put("ne", JSONArray().put(value.east).put(value.north))
        .put("sw", JSONArray().put(value.west).put(value.south))

    fun padding(value: JSONObject?, density: Float): TileflowEdgeInsets {
        fun side(name: String): Float {
            val side = value?.let { optionalNumber(it, name) } ?: 0.0
            if (side < 0 || side * density > Float.MAX_VALUE) invalid()
            return (side * density).toFloat()
        }
        return TileflowEdgeInsets(side("paddingLeft"), side("paddingTop"), side("paddingRight"), side("paddingBottom"))
    }

    fun source(value: JSONObject, surfaceId: String?): TileflowMapSource {
        if (value.has("mapId")) {
            only(value, "mapId")
            if (value.has("manifestUrl") || value.has("map")) invalid()
            return TileflowMapSource.hosted(string(value.get("mapId")), surfaceId ?: "mobile-map")
        }
        only(value, "map", "manifestUrl", "resourceOrigins", "allowsLoopbackHttp")
        val origins = arrayValue(value, "resourceOrigins")
        return TileflowMapSource(
            map = string(value.get("map")),
            manifestUrl = URI(string(value.get("manifestUrl"))),
            resourceOrigins = origins?.let { list(it) { raw -> URI(string(raw)) }.toSet() } ?: emptySet(),
            allowsLoopbackHttp = boolean(value, "allowsLoopbackHttp", false),
        )
    }

    fun camera(value: JSONObject): TileflowCameraUpdate = TileflowCameraUpdate(
        center = arrayValue(value, "centerCoordinate")?.let(::coordinate),
        zoom = optionalNumber(value, "zoomLevel"),
        bearing = optionalNumber(value, "heading"),
        pitch = optionalNumber(value, "pitch"),
    )

    fun camera(value: TileflowCamera): JSONObject = JSONObject()
        .put("centerCoordinate", JSONArray().put(value.longitude).put(value.latitude))
        .put("zoomLevel", value.zoom).put("heading", value.bearing).put("pitch", value.pitch)

    fun cameraEvent(change: TileflowCameraChange, timestamp: Long, gestureActive: Boolean): JSONObject? {
        val visible = change.bounds ?: return null
        val camera = change.camera
        val phase = when (change.phase) {
            TileflowCameraChangePhase.STARTED -> "started"
            TileflowCameraChangePhase.MOVING -> "moving"
            TileflowCameraChangePhase.ENDED -> "ended"
        }
        return JSONObject().put("properties", JSONObject()
            .put("center", JSONArray().put(camera.longitude).put(camera.latitude))
            .put("bounds", bounds(visible)).put("zoom", camera.zoom)
            .put("heading", camera.bearing).put("pitch", camera.pitch))
            .put("gestures", JSONObject().put("isGestureActive", gestureActive))
            .put("timestamp", timestamp).put("phase", phase)
    }

    fun options(value: JSONObject, current: TileflowMapOptions, rightToLeft: Boolean): TileflowMapOptions {
        val quality = when (optionalString(value, "quality")) {
            null, "auto" -> null
            "low" -> TileflowQuality.LOW
            "medium" -> TileflowQuality.BALANCED
            "high" -> TileflowQuality.HIGH
            else -> invalid()
        }
        val level = when (optionalString(value, "eventLevel")) {
            null, "essential" -> TileflowEventLevel.ESSENTIAL
            "camera" -> TileflowEventLevel.CAMERA
            "continuous" -> TileflowEventLevel.CONTINUOUS
            else -> invalid()
        }
        val corner = when (optionalString(value, "attributionPosition") ?: "bottomRight") {
            "topLeft" -> if (rightToLeft) TileflowControlPosition.TOP_END else TileflowControlPosition.TOP_START
            "topRight" -> if (rightToLeft) TileflowControlPosition.TOP_START else TileflowControlPosition.TOP_END
            "bottomLeft" -> if (rightToLeft) TileflowControlPosition.BOTTOM_END else TileflowControlPosition.BOTTOM_START
            "bottomRight" -> if (rightToLeft) TileflowControlPosition.BOTTOM_START else TileflowControlPosition.BOTTOM_END
            else -> invalid()
        }
        val limits = objectValue(value, "cameraLimits") ?: JSONObject()
        return current.copy(
            quality = quality,
            gestures = TileflowGestures(
                pan = boolean(value, "scrollEnabled", true),
                zoom = boolean(value, "zoomEnabled", true),
                rotate = boolean(value, "rotateEnabled", true),
                pitch = boolean(value, "pitchEnabled", true),
                doubleTapZoom = boolean(value, "zoomEnabled", true),
            ),
            controls = TileflowMapControls(
                compass = if (boolean(value, "compassEnabled", true)) TileflowCompassVisibility.ADAPTIVE else TileflowCompassVisibility.HIDDEN,
                scaleBar = boolean(value, "scaleBarEnabled", false),
                attributionPosition = corner,
            ),
            cameraLimits = TileflowCameraLimits(
                minZoom = optionalNumber(limits, "minZoomLevel") ?: 0.0,
                maxZoom = optionalNumber(limits, "maxZoomLevel") ?: 24.0,
                bounds = objectValue(limits, "maxBounds")?.let(::bounds),
            ),
            events = TileflowEventOptions(level),
        )
    }

    fun slot(value: String?): TileflowLayerSlot? = when (value) {
        null -> null
        "above-water" -> TileflowLayerSlot.ABOVE_WATER
        "below-roads" -> TileflowLayerSlot.BELOW_ROADS
        "above-roads" -> TileflowLayerSlot.ABOVE_ROADS
        "above-buildings" -> TileflowLayerSlot.ABOVE_BUILDINGS
        "below-labels" -> TileflowLayerSlot.BELOW_LABELS
        "above-labels" -> TileflowLayerSlot.ABOVE_LABELS
        else -> invalid()
    }

    fun layerPosition(value: JSONObject?, layerId: String? = null, operation: String = "addLayer"): TileflowLayerPosition {
        if (value == null) return TileflowLayerPosition.Default
        val before = optionalString(value, "belowLayerId")
        val after = optionalString(value, "aboveLayerId")
        val at = optionalNumber(value, "slotIndex")
        if (listOf(before, after, at).count { it != null } > 1) throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext(reason = "invalidLayerPosition", operation = operation, path = "position",
                layerId = layerId, slot = optionalString(value, "slot"), rule = "onePosition",
                corrections = listOf(TileflowErrorCorrection("chooseOnePosition", "Choose one layer position."))),
        )
        return when {
            before != null -> TileflowLayerPosition.Below(before)
            after != null -> TileflowLayerPosition.Above(after)
            at != null -> TileflowLayerPosition.AtSlotIndex(integer(at))
            else -> TileflowLayerPosition.Default
        }
    }

    fun queryGeometry(value: JSONObject, density: Float): TileflowQueryGeometry = when (string(value.get("type"))) {
        "point" -> TileflowQueryGeometry.Point(point(value.getJSONArray("point"), density))
        "box" -> {
            val box = value.getJSONArray("box")
            if (box.length() != 4) invalid()
            TileflowQueryGeometry.Box(
                point(JSONArray().put(box.get(0)).put(box.get(1)), density),
                point(JSONArray().put(box.get(2)).put(box.get(3)), density),
            )
        }
        "polygon" -> TileflowQueryGeometry.Polygon(list(value.getJSONArray("points")) { point(it as? JSONArray ?: invalid(), density) })
        "view" -> TileflowQueryGeometry.View
        else -> invalid()
    }

    fun marker(value: JSONObject, density: Float, width: Int, height: Int): TileflowViewAnnotationOptions {
        val anchor = objectValue(value, "anchor")
        val x = anchor?.let { optionalNumber(it, "x") } ?: .5
        val y = anchor?.let { optionalNumber(it, "y") } ?: .5
        if (x !in 0.0..1.0 || y !in 0.0..1.0) invalid()
        val offset = arrayValue(value, "offset")?.let { point(it, density) } ?: TileflowPoint(0f, 0f)
        return TileflowViewAnnotationOptions(
            coordinate = coordinate(value.getJSONArray("coordinate")),
            variableAnchors = listOf(TileflowViewAnnotationAnchorConfig(
                TileflowViewAnnotationAnchor.CENTER,
                (.5 - x) * width + offset.x,
                (y - .5) * height - offset.y,
            )),
            allowOverlap = boolean(value, "allowOverlap", false),
            selected = boolean(value, "isSelected", false),
            priority = value.opt("priority")?.takeUnless { it == JSONObject.NULL }?.let(::integer) ?: 0,
        )
    }

    fun styleState(value: JSONObject): Map<String, TileflowStyleValue> = value.keys().asSequence().associateWith {
        when (val raw = value.get(it)) {
            JSONObject.NULL -> TileflowStyleValue.Null
            is Boolean -> TileflowStyleValue.Bool(raw)
            is Number -> TileflowStyleValue.Number(number(raw))
            is String -> TileflowStyleValue.Text(raw)
            else -> invalid()
        }
    }

    fun styleState(value: Map<String, TileflowStyleValue>): JSONObject = JSONObject().also { json ->
        value.forEach { (key, cell) -> json.put(key, when (cell) {
            is TileflowStyleValue.Bool -> cell.value
            is TileflowStyleValue.Number -> cell.value
            is TileflowStyleValue.Text -> cell.value
            TileflowStyleValue.Null -> JSONObject.NULL
        }) }
    }

    fun location(value: TileflowLocation): JSONObject = JSONObject().put("timestamp", value.timestamp)
        .put("coords", JSONObject().put("longitude", value.coordinate.longitude).put("latitude", value.coordinate.latitude)
            .put("accuracy", value.horizontalAccuracy ?: JSONObject.NULL)
            .put("altitude", value.altitude).put("heading", value.course).put("speed", value.speed))

    fun tap(coordinate: TileflowCoordinate, point: TileflowPoint, density: Float): JSONObject = JSONObject()
        .put("type", "Feature").put("geometry", JSONObject().put("type", "Point").put("coordinates", coordinate(coordinate)))
        .put("properties", JSONObject().put("screenPointX", point.x / density).put("screenPointY", point.y / density))

    fun code(code: TileflowErrorCode): String = code.name.lowercase().split('_').mapIndexed { index, part ->
        if (index == 0) part else part.replaceFirstChar { it.uppercase() }
    }.joinToString("")

    fun context(value: TileflowErrorContext): JSONObject = JSONObject()
        .put("reason", value.reason).put("resource", value.resource?.name?.lowercase())
        .put("origin", value.origin).put("status", value.status).put("limit", value.limit)
        .put("message", value.message).put("count", value.count).put("feature", value.feature).put("rule", value.rule)
        .put("operation", value.operation).put("path", value.path)
        .put("layerId", value.layerId).put("referenceLayerId", value.referenceLayerId)
        .apply {
            if (value.operation != null) {
                put("slot", value.slot ?: JSONObject.NULL)
                put("referenceSlot", value.referenceSlot ?: JSONObject.NULL)
                put("corrections", JSONArray(value.corrections.map { JSONObject().put("code", it.code).put("message", it.message) }))
            }
        }

    fun failure(error: Throwable): JSONObject {
        val failure = error as? TileflowMapException
        val code = failure?.code ?: TileflowErrorCode.INVALID_REQUEST
        return JSONObject().put("code", code(code))
            .put("message", failure?.context?.message ?: "The native map request failed.")
            .put("recoverable", code.isRecoverable)
            .put("context", failure?.context?.let(::context) ?: JSONObject())
    }

    fun <T> list(array: JSONArray, transform: (Any) -> T): List<T> = (0 until array.length()).map { transform(array.get(it)) }
}
