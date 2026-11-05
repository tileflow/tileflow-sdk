package dev.tileflow.sdk.engine

import android.graphics.Bitmap
import android.util.DisplayMetrics
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.model.MapPayloadStore
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.maps.Style
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.*
import org.maplibre.android.style.sources.GeoJsonOptions
import org.maplibre.android.style.sources.GeoJsonSource

/** The scene's content ids are private to setContent, independent of public runtime style ids. */
internal class NativeSceneContent(
    private val style: () -> Style?,
    private val inks: () -> JSONObject,
    private val image: (String) -> Bitmap?,
    private val degraded: (String, String) -> Unit,
) {
    private data class Overlay(
        val definition: JSONObject,
        val data: String,
        val digest: String,
        var shown: JSONObject?,
    ) {
        val name: String = definition.getString("id")
        val id = "__tileflow_app_$name"
        val metrics = definition.has("progress")
    }

    private var overlays = emptyList<Overlay>()
    private var markers = emptyList<JSONObject>()
    private val markerLayers = mutableListOf<String>()
    private val markerImages = mutableListOf<String>()
    private var markerSource = false
    private var document = JSONObject()
    private var revision = 0
    private val markerSourceId = "__tileflow_depth_points"

    suspend fun setContent(request: JSONObject, data: MapPayloadStore) {
        val run = ++revision
        val previous = overlays.associateBy { it.name }
        val candidates =
            request.getJSONArray("overlays").objects().map { def ->
                val ref = def.getJSONObject("data")
                val existing = previous[def.getString("id")]
                val digest = ref.getString("sha256")
                val declared = def.optJSONObject("progress")
                val text =
                    existing?.takeIf { it.digest == digest }?.data
                        ?: run {
                            val bytes =
                                data.payload(ref.getString("id"))?.bytes
                                    ?: styleInvalid("Missing overlay data")
                            withContext(Dispatchers.Default) {
                                bytes
                                    .toString(Charsets.UTF_8)
                                    .also(NativeStyleSource::validateGeoJSON)
                            }
                        }
                val progress =
                    if (
                        existing?.definition?.optJSONObject("progress")?.toString() ==
                            declared?.toString()
                    )
                        existing?.shown
                    else declared
                Overlay(def, text, digest, progress)
            }
        if (run != revision) return
        val current = style()
        if (current != null) {
            candidates
                .filter { it.name !in previous }
                .forEach { next ->
                    if (current.getLayer(next.id) != null || current.getSource(next.id) != null)
                        styleInvalid("Overlay id already in style")
                }
            for (old in overlays) current.removeLayer(old.id)
            for (old in overlays) {
                if (candidates.none { it.id == old.id && it.metrics == old.metrics })
                    current.removeSource(old.id)
            }
            for (next in candidates) addOverlay(current, next, previous[next.name])
        }
        overlays = candidates
    }

    private fun addOverlay(style: Style, item: Overlay, old: Overlay? = null) {
        val def = item.definition
        var source = style.getSourceAs<GeoJsonSource>(item.id)
        if (source == null) {
            source = GeoJsonSource(item.id, GeoJsonOptions().withLineMetrics(item.metrics))
            source.setGeoJson(item.data)
            style.addSource(source)
        } else if (old?.digest != item.digest) source.setGeoJson(item.data)
        val layer =
            when (def.getString("kind")) {
                "circle" -> CircleLayer(item.id, item.id)
                "line" ->
                    LineLayer(item.id, item.id)
                        .withProperties(
                            PropertyFactory.lineCap("round"),
                            PropertyFactory.lineJoin("round"),
                        )
                "fill" -> FillLayer(item.id, item.id)
                else -> styleInvalid("Unknown overlay kind")
            }
        paint(layer, item)
        val ground = def.optString("placement") == "ground"
        val anchor = if (ground) groundAnchor(style) else null
        if (anchor != null) style.addLayerBelow(layer, anchor) else style.addBelowLocation(layer)
        if (ground && def.optDouble("occludedOpacity", 0.0) > 0)
            degraded(
                "sceneOcclusion",
                "Native maps draw ground overlays and markers without scene occlusion.",
            )
    }

    /** Core places ground content above the road band but before its first 3D building. */
    private fun groundAnchor(style: Style): String? {
        val anchors =
            document
                .optJSONObject("metadata")
                ?.optJSONObject("tileflow:overlay-placement-manifest")
                ?.optJSONObject("anchors")
        val order = style.layers.filterNot { it.id.startsWith("__tileflow_app_") }
        val floor = order.indexOfFirst { it.id == anchors?.opt("above-roads") }.coerceAtLeast(0)
        var ceiling = order.indexOfFirst { it.id == anchors?.opt("above-buildings") }
        if (ceiling < 0)
            ceiling =
                (floor until order.size).firstOrNull { order[it] is SymbolLayer } ?: order.size
        if (ceiling < floor) ceiling = order.size
        return (floor until ceiling)
            .firstOrNull { order[it] is FillExtrusionLayer }
            ?.let { order[it].id } ?: order.getOrNull(ceiling)?.id
    }

    private fun paint(layer: Layer, overlay: Overlay) {
        val def = overlay.definition
        val role = def.opt("ink") as? String
        val inks = inks()
        val color =
            role?.let { inks.optString(it, def.getString("color")) } ?: def.getString("color")
        val share =
            if (role == "glow" || role == "core") inks.optDouble("${role}Opacity", 1.0) else 1.0
        val opacity = (share * def.getDouble("opacity")).toFloat()
        val size = def.getDouble("size").toFloat()
        when (layer) {
            is FillLayer ->
                layer.setProperties(
                    PropertyFactory.fillColor(color),
                    PropertyFactory.fillOpacity(opacity),
                )
            is CircleLayer ->
                layer.setProperties(
                    PropertyFactory.circleColor(color),
                    PropertyFactory.circleRadius(size),
                    PropertyFactory.circleOpacity(opacity),
                )
            is LineLayer -> {
                layer.setProperties(
                    PropertyFactory.lineColor(color),
                    PropertyFactory.lineWidth(size),
                    PropertyFactory.lineOpacity(opacity),
                )
                val progress = overlay.shown ?: return
                val highlight = def.optJSONObject("progress")?.opt("highlight") as? String
                val expression = NativeSceneMath.gradient(progress, color, highlight)
                layer.setProperties(
                    PropertyFactory.lineGradient(Expression.raw(expression.toString())),
                    PropertyFactory.lineOpacity(
                        opacity * progress.optDouble("opacity", 1.0).toFloat()
                    ),
                )
            }
        }
    }

    fun progress(names: List<String>, goal: JSONObject): (Double) -> Unit {
        val targets =
            names.map { name ->
                val item =
                    overlays.firstOrNull { it.name == name && it.metrics }
                        ?: throw TileflowMapException(
                            TileflowErrorCode.INVALID_REQUEST,
                            TileflowErrorContext.of(MapContract.ErrorReason.UNKNOWN_LAYER),
                        )
                item to (item.shown ?: JSONObject())
            }
        return { t ->
            for ((item, start) in targets) {
                val shown = JSONObject()
                for ((name, fallback) in
                    listOf("start" to 0.0, "end" to 1.0, "opacity" to 1.0)) shown.put(
                    name,
                    NativeSceneMath.mix(
                        start.optDouble(name, fallback),
                        goal.optDouble(name, fallback),
                        t,
                    ),
                )
                if (!goal.isNull("light"))
                    shown.put(
                        "light",
                        NativeSceneMath.mix(
                            start.optDouble("light", start.optDouble("start", 0.0)),
                            goal.getDouble("light"),
                            t,
                        ),
                    )
                else if (t < 1 && !start.isNull("light")) shown.put("light", start.get("light"))
                item.shown = shown
                style()?.getLayer(item.id)?.let { paint(it, item) }
            }
        }
    }

    fun refreshInks() {
        val style = style() ?: return
        overlays
            .filter { it.definition.has("ink") }
            .forEach { item -> style.getLayer(item.id)?.let { paint(it, item) } }
    }

    fun setMarkers(request: JSONObject) {
        val wanted = request.getJSONArray("markers").objects()
        if (wanted.any { image(it.getString("image")) == null })
            styleInvalid("Unknown marker image")
        style()?.let { applyMarkers(it, wanted) }
        markers = wanted
    }

    fun imagesChanged() {
        markers = markers.filter { image(it.getString("image")) != null }
        style()?.let { applyMarkers(it, markers) }
    }

    private fun applyMarkers(style: Style, wanted: List<JSONObject>) {
        val replacing = markerLayers.toSet()
        val names = wanted.map { "__tileflow_depth_" + it.getString("id") }
        if (
            names.any { it !in replacing && style.getLayer(it) != null } ||
                !markerSource && wanted.isNotEmpty() && style.getSource(markerSourceId) != null ||
                names.any { it !in markerImages && style.getImage(it) != null }
        )
            styleInvalid("Marker id already in style")
        markerLayers.forEach(style::removeLayer)
        markerLayers.clear()
        if (markerSource) style.removeSource(markerSourceId)
        markerSource = false
        markerImages.forEach(style::removeImage)
        markerImages.clear()
        if (wanted.isEmpty()) return
        val entries = wanted.zip(names)
        val features =
            JSONArray(
                entries.map { (m, id) ->
                    val coord = m.getJSONObject("coordinate")
                    JSONObject()
                        .put("type", "Feature")
                        .put("properties", JSONObject().put("marker", id))
                        .put(
                            "geometry",
                            JSONObject()
                                .put("type", "Point")
                                .put(
                                    "coordinates",
                                    JSONArray(
                                        listOf(
                                            coord.getDouble("longitude"),
                                            coord.getDouble("latitude"),
                                        )
                                    ),
                                ),
                        )
                }
            )
        style.addSource(
            GeoJsonSource(markerSourceId).also {
                it.setGeoJson(
                    JSONObject()
                        .put("type", "FeatureCollection")
                        .put("features", features)
                        .toString()
                )
            }
        )
        markerSource = true
        for ((marker, id) in entries) {
            val bitmap = image(marker.getString("image")) ?: continue
            val size = marker.getJSONArray("size")
            val width = size.getDouble(0)
            val height = size.getDouble(1)
            val factor = maxOf(width, height) / maxOf(bitmap.width, bitmap.height)
            val textureWidth =
                if (factor == 0.0) 1 else (width / factor).roundToInt().coerceAtLeast(1)
            val textureHeight =
                if (factor == 0.0) 1 else (height / factor).roundToInt().coerceAtLeast(1)
            val scaled = Bitmap.createScaledBitmap(bitmap, textureWidth, textureHeight, true)
            // createScaledBitmap can return its argument; keep the original sprite's pixel ratio.
            val icon =
                if (scaled === bitmap && bitmap.density != DisplayMetrics.DENSITY_DEFAULT)
                    bitmap.copy(Bitmap.Config.ARGB_8888, false)
                else scaled
            icon.density = DisplayMetrics.DENSITY_DEFAULT
            style.addImage(id, icon)
            markerImages += id
            val offset = marker.getJSONArray("offset")
            val ground = marker.optString("alignment") == "ground"
            val align = if (ground) "map" else "viewport"
            val offsetScale = if (ground || factor == 0.0) 0.0 else 1.0 / factor
            val visibleScale = if (width == 0.0 || height == 0.0) 0.0 else factor
            val layer =
                SymbolLayer(id, markerSourceId)
                    .withFilter(Expression.eq(Expression.get("marker"), Expression.literal(id)))
                    .withProperties(
                        PropertyFactory.iconImage(id),
                        PropertyFactory.iconAnchor(marker.getString("anchor")),
                        PropertyFactory.iconPitchAlignment(align),
                        PropertyFactory.iconRotationAlignment(align),
                        PropertyFactory.iconOffset(
                            arrayOf(
                                (offset.getDouble(0) * offsetScale).toFloat(),
                                (offset.getDouble(1) * offsetScale).toFloat(),
                            )
                        ),
                        PropertyFactory.iconRotate(marker.getDouble("rotation").toFloat()),
                        PropertyFactory.iconAllowOverlap(true),
                        PropertyFactory.iconIgnorePlacement(true),
                        PropertyFactory.iconOpacity(marker.getDouble("opacity").toFloat()),
                    )
            if (ground) {
                val latitude =
                    marker
                        .getJSONObject("coordinate")
                        .getDouble("latitude")
                        .coerceIn(
                            -NativeCameraMath.MAXIMUM_LATITUDE,
                            NativeCameraMath.MAXIMUM_LATITUDE,
                        )
                val atZero =
                    visibleScale * 512 /
                        (40_075_016.68557849 * kotlin.math.cos(Math.toRadians(latitude)))
                val scale =
                    JSONArray()
                        .put("interpolate")
                        .put(JSONArray().put("exponential").put(2))
                        .put(JSONArray().put("zoom"))
                        .put(0)
                        .put(atZero)
                        .put(24)
                        .put(atZero * 16_777_216)
                layer.setProperties(PropertyFactory.iconSize(Expression.raw(scale.toString())))
            } else layer.setProperties(PropertyFactory.iconSize(visibleScale.toFloat()))
            style.addBelowLocation(layer)
            markerLayers += id
            if (marker.optBoolean("occlude"))
                degraded(
                    "sceneOcclusion",
                    "Native maps draw ground overlays and markers without scene occlusion.",
                )
            if (marker.optDouble("altitude", 0.0) != 0.0)
                degraded(
                    "markerAltitude",
                    "Native maps draw elevated markers as symbols at ground level.",
                )
        }
    }

    fun restore(style: Style, document: JSONObject) {
        this.document = document
        if (overlays.any { style.getLayer(it.id) != null || style.getSource(it.id) != null })
            styleInvalid("Overlay id already in style")
        overlays.forEach { addOverlay(style, it) }
        markerLayers.clear()
        markerImages.clear()
        markerSource = false
        applyMarkers(style, markers)
    }
}
