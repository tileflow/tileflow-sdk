package dev.tileflow.sdk.engine

import dev.tileflow.sdk.GeoJSONLog
import dev.tileflow.sdk.RuntimeStyle
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.bridge.DataChannel
import org.json.JSONObject
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.sources.GeoJsonOptions
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.geojson.Feature
import org.maplibre.geojson.FeatureCollection
import org.maplibre.geojson.GeoJson
import org.maplibre.geojson.Geometry
import org.maplibre.geojson.gson.GeometryGeoJson

/** Application objects installed in each loaded native style. Inline data outlives its channel reference. */
internal class NativeRuntimeStyle {
    private class Source(val id: String, val data: GeoJson, val clustered: Boolean) {
        fun make(): GeoJsonSource {
            val options = GeoJsonOptions().withCluster(clustered)
            return when (data) {
                is FeatureCollection -> GeoJsonSource(id, data, options)
                is Feature -> GeoJsonSource(id, data, options)
                is Geometry -> GeoJsonSource(id, data, options)
                else -> invalid()
            }
        }
    }

    private class Circle(val id: String, val source: String, val paint: JSONObject) {
        fun make(): CircleLayer {
            val layer = CircleLayer(id, source)
            for (name in paint.keys()) {
                val value = paint.get(name)
                if (!NativeStyleProperties.set(layer, name, value)) invalid()
            }
            return layer
        }
    }

    private val sources = mutableMapOf<String, Source>()
    private val circles = mutableListOf<Circle>()

    fun addSource(request: JSONObject, channel: DataChannel, style: Style?) {
        val id = "__tileflow_source_" + request.getString("id")
        val spec = request.getJSONObject("source")
        if (id in sources || style?.getSource(id) != null) invalid()
        validateSource(spec)

        val data = spec.getJSONObject("data")
        val text = when {
            data.opt("empty") == true -> """{"type":"FeatureCollection","features":[]}"""
            else -> channel.payload(data.optString("id"))?.bytes?.toString(Charsets.UTF_8) ?: invalid()
        }
        val source = Source(id, parseGeoJSON(text), spec.optBoolean("cluster"))
        style?.addSource(source.make())
        sources[id] = source
    }

    fun addLayer(request: JSONObject, style: Style?) {
        val spec = request.getJSONObject("layer")
        val paint = circlePaint(spec, request.has("slot"))
        val source = "__tileflow_source_" + spec.getString("source")
        val id = "__tileflow_layer_" + spec.getString("id")
        if (source !in sources || circles.any { it.id == id } || style?.getLayer(id) != null) invalid()
        val circle = Circle(id, source, paint)
        val layer = circle.make()
        val position = request.optJSONObject("position")
        val index = if (position == null) circles.size else {
            val above = position.has("above")
            val relative = position.optString(if (above) "above" else "below")
            val at = circles.indexOfFirst { it.id == "__tileflow_layer_" + relative }
            if (at < 0) invalid()
            if (above) at + 1 else at
        }
        if (index < circles.size) style?.addLayerBelow(layer, circles[index].id)
        else style?.addLayer(layer)
        circles.add(index, circle)
    }

    fun removeLayer(request: JSONObject, style: Style?) {
        val id = "__tileflow_layer_" + request.getString("id")
        val index = circles.indexOfFirst { it.id == id }
        if (index < 0 || style != null && !style.removeLayer(id)) invalid()
        circles.removeAt(index)
    }

    fun removeSource(request: JSONObject, style: Style?) {
        val id = "__tileflow_source_" + request.getString("id")
        if (id !in sources || circles.any { it.source == id } || style != null && !style.removeSource(id)) invalid()
        sources.remove(id)
    }

    fun restore(style: Style) {
        if (sources.keys.any { style.getSource(it) != null } || circles.any { style.getLayer(it.id) != null })
            invalid()
        sources.values.forEach { style.addSource(it.make()) }
        circles.forEach { style.addLayer(it.make()) }
    }

    companion object {
        private val sourceKeys = setOf("type", "data", "cluster")
        private val circleKeys = setOf("id", "type", "source", "paint")

        private fun validateSource(spec: JSONObject) {
            if (spec.opt("type") != "geojson" || spec.keys().asSequence().any { it !in sourceKeys } ||
                spec.has("cluster") && spec.opt("cluster") !is Boolean
            ) invalid()
        }

        private fun parseGeoJSON(text: String): GeoJson =
            try {
                when (JSONObject(text).getString("type")) {
                    "FeatureCollection" -> FeatureCollection.fromJson(text)
                    "Feature" -> Feature.fromJson(text)
                    else -> GeometryGeoJson.fromJson(text)
                } ?: invalid()
            } catch (_: RuntimeException) {
                invalid()
            } catch (_: org.json.JSONException) {
                invalid()
            }

        /** Validates a source received before the renderer exists, so a rejected source is never replayed. */
        fun validateQueuedSource(source: RuntimeStyle.Source) {
            validateSource(source.spec)
            when (val base = source.geoJSON?.base) {
                is GeoJSONLog.Base.Bytes -> parseGeoJSON(base.bytes.toString(Charsets.UTF_8))
                GeoJSONLog.Base.Empty -> Unit
                else -> invalid()
            }
        }

        fun circlePaint(spec: JSONObject, hasSlot: Boolean): JSONObject {
            if (spec.opt("type") != "circle" || hasSlot || spec.keys().asSequence().any { it !in circleKeys })
                invalid()
            val paint = if (spec.has("paint")) spec.optJSONObject("paint") ?: invalid() else JSONObject()
            for (name in paint.keys()) {
                val value = paint.get(name)
                val valid = when (name) {
                    "circle-color", "circle-stroke-color" ->
                        value is String && NativeEvaluators.parseColour(value) != null
                    "circle-radius", "circle-stroke-width" ->
                        value is Number && value.toDouble() >= 0
                    "circle-opacity", "circle-stroke-opacity", "circle-blur" ->
                        value is Number && value.toDouble() in 0.0..1.0
                    else -> false
                }
                if (!valid) invalid()
            }
            return paint
        }

        private fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
    }
}
