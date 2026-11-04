package dev.tileflow.sdk

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.DisplayMetrics
import android.util.SizeF
import dev.tileflow.sdk.engine.NativeFamily
import dev.tileflow.sdk.engine.NativeMapPreparation
import dev.tileflow.sdk.engine.NativeSceneMath
import dev.tileflow.sdk.engine.NativeStyleSource
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.snapshotter.MapSnapshot

/** An application image anchored to geography, with its output size in logical units. */
public data class TileflowSnapshotImage(
    public val bitmap: Bitmap,
    public val coordinate: TileflowCoordinate,
    public val anchor: TileflowIconAnchor = TileflowIconAnchor.CENTER,
    public val size: SizeF? = null,
) {
    internal fun validate() {
        if (
            bitmap.isRecycled ||
                coordinate.latitude !in -90.0..90.0 ||
                coordinate.longitude !in -180.0..180.0 ||
                size?.let {
                    !it.width.isFinite() || it.width <= 0 || !it.height.isFinite() || it.height <= 0
                } == true
        )
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
    }

    internal fun draw(canvas: Canvas, snapshot: MapSnapshot, scale: Float) {
        val p = snapshot.pixelForLatLng(LatLng(coordinate.latitude, coordinate.longitude))
        if (!p.x.isFinite() || !p.y.isFinite()) return
        val density =
            if (bitmap.density > 0) bitmap.density.toFloat() / DisplayMetrics.DENSITY_DEFAULT
            else 1f
        val width = (size?.width ?: (bitmap.width / density)) * scale
        val height = (size?.height ?: (bitmap.height / density)) * scale
        val x =
            p.x -
                width *
                    when {
                        "left" in anchor.value -> 0f
                        "right" in anchor.value -> 1f
                        else -> 0.5f
                    }
        val y =
            p.y -
                height *
                    when {
                        "top" in anchor.value -> 0f
                        "bottom" in anchor.value -> 1f
                        else -> 0.5f
                    }
        canvas.drawBitmap(
            bitmap,
            null,
            RectF(x, y, x + width, y + height),
            Paint(Paint.FILTER_BITMAP_FLAG),
        )
    }
}

/** Optional data rendered in the map. Interaction handlers are unused in an image. */
public data class TileflowMapSnapshotContent(
    public val annotations: List<TileflowAnnotation> = emptyList(),
    public val overlays: List<TileflowGeoJSONLayer> = emptyList(),
    public val points: List<TileflowPointAnnotation> = emptyList(),
    public val circles: List<TileflowCircleAnnotation> = emptyList(),
    public val polylines: List<TileflowPolylineAnnotation> = emptyList(),
    public val polygons: List<TileflowPolygonAnnotation> = emptyList(),
    public val images: List<TileflowSnapshotImage> = emptyList(),
) {
    internal fun apply(
        map: NativeMapPreparation.Map,
        scheme: String,
        family: NativeFamily? = null,
    ): Pair<String, Map<String, Bitmap>> {
        MapContent(annotations, overlays).validate()
        val original = map.projected.style.toString()
        if (
            annotations.isEmpty() &&
                overlays.isEmpty() &&
                points.isEmpty() &&
                circles.isEmpty() &&
                polylines.isEmpty() &&
                polygons.isEmpty()
        ) {
            return original to emptyMap()
        }
        val style = JSONObject(original)
        val sources = style.getJSONObject("sources")
        val layers = style.getJSONArray("layers")
        val before =
            style
                .optJSONObject("metadata")
                ?.optJSONObject("tileflow:overlay-placement-manifest")
                ?.optJSONObject("anchors")
        val result = (0 until layers.length()).mapTo(mutableListOf()) { layers.getJSONObject(it) }
        fun add(
            id: String,
            features: JSONObject,
            layer: JSONObject,
            ground: Boolean = false,
            measured: Boolean = false,
        ) {
            if (sources.has(id) || result.any { it.optString("id") == id })
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            sources.put(
                id,
                JSONObject().put("type", "geojson").put("data", features).apply {
                    if (measured) put("lineMetrics", true)
                },
            )
            val at =
                if (ground)
                    result.indexOfFirst {
                        if (before != null) it.optString("id") == before.optString("below-labels")
                        else it.optString("type") == "symbol"
                    }
                else -1
            if (at < 0) result.add(layer) else result.add(at, layer)
        }
        val route =
            family?.routeInks(listOf(map.document.theme)) ?: NativeFamily.defaultRouteInks(scheme)
        for (overlay in overlays) {
            val raw = overlay.bytes.toString(Charsets.UTF_8)
            NativeStyleSource.validateGeoJSON(raw)
            val data = JSONObject(raw)
            if (data.optString("type") != "FeatureCollection")
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            val kind = overlay.kind.wireName
            val color =
                overlay.ink?.let { route.optString(it.wireName, overlay.color) } ?: overlay.color
            val opacity =
                overlay.opacity *
                    (overlay.ink?.let { route.optDouble(it.wireName + "Opacity", 1.0) } ?: 1.0)
            val paint = JSONObject().put("$kind-color", color).put("$kind-opacity", opacity)
            val layer =
                JSONObject()
                    .put("type", kind)
                    .put("id", overlay.id)
                    .put("source", overlay.id)
                    .put("paint", paint)
            if (kind == "circle") paint.put("circle-radius", overlay.size)
            if (kind == "line") {
                paint.put("line-width", overlay.size)
                layer.put("layout", JSONObject().put("line-join", "round").put("line-cap", "round"))
                overlay.progress?.let {
                    val progress = it.json()
                    paint.put(
                        "line-gradient",
                        NativeSceneMath.gradient(
                            progress,
                            color,
                            progress.opt("highlight") as? String,
                        ),
                    )
                    paint.put("line-opacity", opacity * progress.optDouble("opacity", 1.0))
                }
            }
            add(
                overlay.id,
                data,
                layer,
                overlay.placement == TileflowLayerPlacement.GROUND,
                overlay.progress != null,
            )
        }
        val bitmaps = mutableMapOf<String, Bitmap>()
        for (point in points) {
            val bitmap = point.iconImageBitmap ?: continue
            val id = point.iconImage ?: continue
            if (
                bitmap.isRecycled ||
                    bitmap.width !in 1..2048 ||
                    bitmap.height !in 1..2048 ||
                    bitmaps.put(id, bitmap)?.let { it !== bitmap } == true
            )
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        fun annotations(
            id: String,
            kind: String,
            group: List<TileflowBaseAnnotation>,
            properties: List<AnnotationProperty>,
        ) {
            if (group.isEmpty()) return
            if (group.distinctBy { it.id }.size != group.size)
                throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            val name = "tileflow-snapshot-$id"
            val layout = if (kind == "line") mapOf("line-join" to "round") else emptyMap()
            val layer =
                annotationLayer(
                    name,
                    kind,
                    properties,
                    group.flatMapTo(mutableSetOf()) { it.styleProperties().keys },
                    layout,
                )
            add(
                name,
                JSONObject()
                    .put("type", "FeatureCollection")
                    .put("features", JSONArray(group.map { it.feature() })),
                layer,
            )
        }
        annotations("polygon", "fill", polygons, polygonAnnotationProperties)
        annotations("polyline", "line", polylines, lineAnnotationProperties)
        annotations("circle", "circle", circles, circleAnnotationProperties)
        annotations("point", "symbol", points, pointAnnotationProperties)
        if (this.annotations.isNotEmpty()) {
            val id = "tileflow-snapshot-markers"
            val features =
                this.annotations.map { marker ->
                    JSONObject()
                        .put("type", "Feature")
                        .put(
                            "geometry",
                            JSONObject()
                                .put("type", "Point")
                                .put(
                                    "coordinates",
                                    JSONArray(
                                        listOf(
                                            marker.coordinate.longitude,
                                            marker.coordinate.latitude,
                                        )
                                    ),
                                ),
                        )
                        .put("properties", JSONObject().put("color", marker.color))
                }
            val paint =
                JSONObject()
                    .put("circle-radius", 6)
                    .put("circle-color", JSONArray(listOf("get", "color")))
            add(
                id,
                JSONObject().put("type", "FeatureCollection").put("features", JSONArray(features)),
                JSONObject()
                    .put("id", id)
                    .put("source", id)
                    .put("type", "circle")
                    .put("paint", paint),
            )
        }
        style.put("layers", JSONArray(result))
        return style.toString() to bitmaps
    }
}
