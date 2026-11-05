package dev.tileflow.sdk

import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.engine.MapEngine
import dev.tileflow.sdk.engine.NativeStyleSource
import dev.tileflow.sdk.engine.NativeStyleLayer
import dev.tileflow.sdk.model.MapPayloadStore
import dev.tileflow.sdk.transport.ResourceDigest
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/**
 * The application's runtime style the view keeps, so the renderer restores it after a style change
 * and a new renderer receives it again: sources with their data and feature updates, layers in
 * order, and feature state.
 */
internal class RuntimeStyle {
    class Source(val id: String, val spec: JSONObject, var geoJSON: GeoJSONLog?)

    class Layer(val id: String, val json: JSONObject, val slot: TileflowLayerSlot?)

    val sources = mutableListOf<Source>()
    /** Application layers as the application arranged them, bottom to top. */
    val layers = mutableListOf<Layer>()
    /** Feature state by source and source layer, then by feature. */
    val states = mutableMapOf<String, MutableMap<String, MutableMap<String, TileflowStyleValue>>>()

    fun copy(): RuntimeStyle =
        RuntimeStyle().also { copy ->
            sources.forEach { copy.sources += Source(it.id, it.spec, it.geoJSON?.copy()) }
            copy.layers += layers
            states.forEach { (key, features) ->
                copy.states[key] =
                    features.mapValuesTo(mutableMapOf()) { it.value.toMutableMap() }
            }
        }

    fun restore(from: RuntimeStyle) {
        sources.clear()
        sources += from.sources
        layers.clear()
        layers += from.layers
        states.clear()
        states += from.states
    }

    companion object {
        fun stateKey(source: String, sourceLayer: String?): String = "$source\n${sourceLayer ?: ""}"
    }
}

/**
 * A GeoJSON source's data and the feature updates since, compacted into new data in the background
 * once the updates outweigh it.
 */
internal data class GeoJSONLog(
    val base: Base,
    val updates: List<Update> = emptyList(),
    val updateBytes: Long = 0,
    val promoteId: String? = null,
    /** Changes each time the data is replaced, so a compaction of older data is dropped. */
    val revision: Int = 0,
    val compacting: Boolean = false,
) {
    sealed interface Base {
        class Bytes(val bytes: ByteArray, val digest: String) : Base

        data class Url(val url: String) : Base

        data object Empty : Base
    }

    class Update(val add: ByteArray?, val remove: List<String>)

    val needsCompaction: Boolean
        get() {
            if (base is Base.Url || compacting || updates.size < 2) return false
            val size = (base as? Base.Bytes)?.bytes?.size?.toLong() ?: 0
            return updateBytes > maxOf(size, 4L shl 20)
        }

    companion object {
        /** The base and updates applied in order: a FeatureCollection keyed as MapLibre keys them. */
        fun compact(base: ByteArray?, updates: List<Update>, promoteId: String?): ByteArray? {
            return try {
                val features = LinkedHashMap<String, JSONObject>()
                fun add(feature: JSONObject): Boolean {
                    val id =
                        if (promoteId != null) feature.optJSONObject("properties")?.opt(promoteId)
                        else feature.opt("id")
                    val key = (if (id is Boolean) null else TileflowFeature.text(id)) ?: return false
                    features[key] = feature
                    return true
                }
                if (base != null) {
                    val list = JSONObject(String(base, Charsets.UTF_8)).getJSONArray("features")
                    for (index in 0 until list.length())
                        if (!add(list.getJSONObject(index))) return null
                }
                for (update in updates) {
                    update.remove.forEach { features.remove(it) }
                    update.add?.let { bytes ->
                        val list = JSONArray(String(bytes, Charsets.UTF_8))
                        for (index in 0 until list.length())
                            if (!add(list.getJSONObject(index))) return null
                    }
                }
                JSONObject()
                    .put("type", "FeatureCollection")
                    .put("features", JSONArray(features.values))
                    .toString()
                    .toByteArray(Charsets.UTF_8)
            } catch (_: Exception) {
                null
            }
        }
    }
}

internal val STYLE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

private fun invalid(reason: MapContract.ErrorReason? = null): Nothing =
    throw TileflowMapException(
        TileflowErrorCode.INVALID_REQUEST,
        reason?.let { TileflowErrorContext.of(it) } ?: TileflowErrorContext(),
    )

private fun TileflowMapView.styleRenderer(): MapEngine {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    return readyEngine ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
}

/**
 * Keeps a change for later renderers and sends it to the current one. A change the renderer refuses
 * is not kept.
 */
private suspend fun TileflowMapView.changeStyle(
    change: RuntimeStyle.() -> Unit,
    send: suspend (MapEngine) -> Unit,
) {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    val previous = runtimeStyle.copy()
    runtimeStyle.change()
    val engine = styleEngine ?: return
    try {
        send(engine)
    } catch (error: Exception) {
        runtimeStyle.restore(previous)
        throw error
    }
    declaredContent?.ownersChanged()
}

// Sources

/**
 * Adds a source to the application's runtime style. GeoJSON data travels over the SDK's data
 * channel, up to 32 MiB. The source and everything drawn from it survive theme changes and a new
 * renderer.
 */
public suspend fun TileflowMapView.addSource(source: TileflowSource) {
    val (spec, log) = sourceWire(source)
    addSource(RuntimeStyle.Source(source.id, spec, log))
}

private val sourceTypes = setOf("geojson", "vector", "raster", "raster-dem", "image")
private val layerTypes = setOf(
    "fill", "line", "symbol", "circle", "heatmap", "fill-extrusion", "raster",
    "hillshade", "color-relief", "background",
)
private val geoJSONTypes = setOf(
    "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon",
    "GeometryCollection", "Feature", "FeatureCollection",
)

/** Adds a style-spec source supplied as JSON. Inline GeoJSON uses the typed source's data channel. */
public suspend fun TileflowMapView.addStyleSource(id: String, properties: JSONObject) {
    addSource(styleSource(id, properties))
}

private fun styleSource(id: String, properties: JSONObject): RuntimeStyle.Source {
    val type = properties.opt("type")
    if (type !in sourceTypes) invalid()
    // Copy the small specification separately from the potentially large inline geometry.
    val keys = properties.keys().asSequence().filter { type != "geojson" || it != "data" }.toList()
    val spec = JSONObject(JSONObject(properties, keys.toTypedArray()).toString())
    val log = if (type == "geojson") {
        val data = when (val value = properties.opt("data")) {
            is JSONObject -> {
                if (value.opt("type") !in geoJSONTypes) invalid()
                TileflowGeoJSONData.GeoJSON(value.toString())
            }
            is String -> {
                if (!runCatching { java.net.URI(value).isAbsolute }.getOrDefault(false)) invalid()
                TileflowGeoJSONData.Url(value)
            }
            null -> TileflowGeoJSONData.Empty
            else -> invalid()
        }
        GeoJSONLog(geoJSONBase(data), promoteId = spec.opt("promoteId") as? String)
    } else null
    return RuntimeStyle.Source(id, spec, log)
}

private suspend fun TileflowMapView.addSource(record: RuntimeStyle.Source) =
    styleEdits.withLock { insertStyleSource(record) }

internal suspend fun TileflowMapView.insertStyleSource(record: RuntimeStyle.Source) {
    if (!STYLE_ID.matches(record.id) || sourceExists(record.id)) invalid()
    if (styleEngine == null) NativeStyleSource.validateQueued(record)
    changeStyle({ sources += record }) { engine -> engine.addSource(record) }
}

/** Applies a patch to an application source. Null removes an optional property. */
public suspend fun TileflowMapView.updateSource(id: String, properties: JSONObject) {
    val patch = JSONObject(properties.toString())
    styleEdits.withLock {
        val index = runtimeStyle.sources.indexOfFirst { it.id == id }
        if (index < 0) invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
        if (patch.length() == 0) return@withLock
        val previous = runtimeStyle.sources[index]
        val merged = JSONObject(previous.spec.toString())
        patch.keys().forEach { key ->
            if (patch.isNull(key)) merged.remove(key) else merged.put(key, patch.get(key))
        }
        val next = styleSource(id, merged)
        val preserveData = previous.geoJSON != null && next.geoJSON != null && !patch.has("data")
        if (preserveData) {
            val log = previous.geoJSON!!
            val identityChanged = previous.spec.opt("promoteId") != next.spec.opt("promoteId") ||
                previous.spec.optBoolean("generateId") != next.spec.optBoolean("generateId")
            next.geoJSON = if (identityChanged && log.base !is GeoJSONLog.Base.Url) {
                val compacted = withContext(Dispatchers.Default) {
                    val base = (log.base as? GeoJSONLog.Base.Bytes)?.bytes?.toString(Charsets.UTF_8)
                        ?: NativeStyleSource.EMPTY
                    var json = NativeStyleSource.edit(base, previous.spec, null, emptySet(), normalize = true)
                    for (update in log.updates) {
                        val added = update.add?.let { JSONArray(it.toString(Charsets.UTF_8)) }
                        json = NativeStyleSource.edit(json, previous.spec, added, update.remove.toSet())
                    }
                    json.toByteArray(Charsets.UTF_8)
                }
                GeoJSONLog(
                    GeoJSONLog.Base.Bytes(compacted, ResourceDigest.sha256(compacted)),
                    promoteId = next.spec.opt("promoteId") as? String,
                    revision = log.revision + 1,
                )
            } else log.copy(
                promoteId = next.spec.opt("promoteId") as? String,
                revision = log.revision + 1,
                compacting = false,
            )
        }
        NativeStyleSource.validateQueued(next)
        val type = next.spec.getString("type")
        for (layer in runtimeStyle.layers.filter { it.json.opt("source") == id }) {
            val compatible = when (layer.json.getString("type")) {
                "raster" -> type in setOf("raster", "image")
                "hillshade", "color-relief" -> type == "raster-dem"
                else -> type in setOf("vector", "geojson")
            }
            if (!compatible || (type == "vector") != layer.json.has("source-layer")) invalid()
        }
        changeStyle({ sources[index] = next }) { engine ->
            engine.addSource(next, MapContract.Method.UPDATE_SOURCE, preserveData)
        }
        compactIfNeeded(next)
    }
}

/** Removes a source no application layer draws. */
public suspend fun TileflowMapView.removeSource(id: String): Unit =
    styleEdits.withLock { deleteStyleSource(id) }

internal suspend fun TileflowMapView.deleteStyleSource(id: String) {
    if (runtimeStyle.sources.none { it.id == id }) invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
    if (runtimeStyle.layers.any { it.json.optString("source") == id }) invalid()
    changeStyle({
        sources.removeAll { it.id == id }
        states.keys.removeAll { it.startsWith("$id\n") }
    }) { engine ->
        engine.call(MapContract.Method.REMOVE_SOURCE, JSONObject().put("id", id))
    }
}

/** Whether the application's runtime style holds a source. */
public fun TileflowMapView.sourceExists(id: String): Boolean =
    runtimeStyle.sources.any { it.id == id }

/** Replaces a GeoJSON source's data; feature state stays with feature identifiers. */
public suspend fun TileflowMapView.setGeoJSONSourceData(sourceId: String, data: TileflowGeoJSONData): Unit = styleEdits.withLock {
    replaceStyleData(sourceId, geoJSONBase(data))
}

internal suspend fun TileflowMapView.replaceStyleData(sourceId: String, base: GeoJSONLog.Base) {
    val source = geoJSONSource(sourceId)
    NativeStyleSource.validateQueued(RuntimeStyle.Source(source.id, source.spec, GeoJSONLog(base)))
    changeStyle({
        val log = source.geoJSON!!
        source.geoJSON = GeoJSONLog(base, promoteId = log.promoteId, revision = log.revision + 1)
    }) { engine ->
        val (value, references) = geoJSONWire(base, engine.data)
        engine.call(
            MapContract.Method.SET_GEO_JSON_SOURCE_DATA,
            JSONObject().put("id", sourceId).put("data", value),
            references,
        )
    }
}

/**
 * Adds features to a GeoJSON source, or replaces those whose identifier it holds, without sending
 * the rest again. Each feature needs an identifier, or the source's `promoteId`.
 */
public suspend fun TileflowMapView.addGeoJSONSourceFeatures(
    sourceId: String,
    features: List<TileflowFeature>,
): Unit = updateFeatures(sourceId, features, emptyList())

/** Replaces features of a GeoJSON source by identifier. */
@JvmOverloads
public suspend fun TileflowMapView.updateGeoJSONSourceFeatures(
    sourceId: String,
    features: List<TileflowFeature>,
    removeFeatureIds: List<String> = emptyList(),
): Unit = updateFeatures(sourceId, features, removeFeatureIds)

/** Removes features of a GeoJSON source by identifier; unknown identifiers are ignored. */
public suspend fun TileflowMapView.removeGeoJSONSourceFeatures(
    sourceId: String,
    featureIds: List<String>,
): Unit = updateFeatures(sourceId, emptyList(), featureIds)

private suspend fun TileflowMapView.updateFeatures(
    sourceId: String,
    add: List<TileflowFeature>,
    remove: List<String>,
): Unit = styleEdits.withLock {
    val source = geoJSONSource(sourceId)
    val log = source.geoJSON!!
    if (source.spec.optBoolean("cluster") && add.any { it.geometry !is TileflowGeometry.Point })
        NativeStyleSource.invalidClusterGeometry()
    if (log.base is GeoJSONLog.Base.Url) invalid()
    if (add.isEmpty() && remove.isEmpty()) return@withLock
    if (remove.any { it.isEmpty() || it.length > 128 }) invalid()
    if (add.any { feature -> log.promoteId?.let { feature.properties[it] == null } ?: (feature.id == null) })
        invalid()
    val bytes =
        add.takeIf { it.isNotEmpty() }?.let { features ->
            JSONArray(features.map { it.json() }).toString().toByteArray(Charsets.UTF_8)
        }
    if ((bytes?.size ?: 0) > MapContract.MAXIMUM_DATA_BYTES)
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                MapContract.ErrorReason.DATA_TOO_LARGE,
                MapContract.MAXIMUM_DATA_BYTES,
            ),
        )
    val update = GeoJSONLog.Update(bytes, remove)
    changeStyle({
        val current = source.geoJSON!!
        source.geoJSON =
            current.copy(
                updates = current.updates + update,
                updateBytes =
                    current.updateBytes + (bytes?.size ?: 0) + remove.sumOf { it.length },
            )
    }) { engine -> engine.sendUpdate(update, sourceId) }
    compactIfNeeded(source)
}

// Layers

/**
 * Adds a layer of the application's runtime style. A layer placed above or below another must share
 * that layer's slot; otherwise it goes on top of its own slot.
 */
public suspend fun TileflowMapView.addLayer(
    layer: TileflowLayer,
    position: TileflowLayerPosition = TileflowLayerPosition.Default,
) {
    addLayer(layer.id, layer.json(), layer.slot, position)
}

/** Adds a style-spec layer supplied as JSON, using the application's layer identifiers. */
public suspend fun TileflowMapView.addStyleLayer(
    properties: JSONObject,
    position: TileflowLayerPosition = TileflowLayerPosition.Default,
) {
    val layer = styleLayer(properties)
    addLayer(layer.id, layer.json, layer.slot, position)
}

private fun styleLayer(properties: JSONObject): RuntimeStyle.Layer {
    val json = JSONObject(properties.toString())
    val id = json.opt("id") as? String ?: invalid()
    val type = json.opt("type")
    if (type !in layerTypes) invalid()
    if (if (type == "background") json.has("source") else json.opt("source") !is String) invalid()
    val slot = json.remove("slot")?.takeUnless { it == JSONObject.NULL }?.let { name ->
        TileflowLayerSlot.entries.firstOrNull { it.wireName == name } ?: invalid()
    }
    return RuntimeStyle.Layer(id, json, slot)
}

private suspend fun TileflowMapView.addLayer(
    id: String,
    json: JSONObject,
    requestedSlot: TileflowLayerSlot?,
    position: TileflowLayerPosition,
): Unit = styleEdits.withLock { insertStyleLayer(RuntimeStyle.Layer(id, json, requestedSlot), position) }

internal suspend fun TileflowMapView.insertStyleLayer(layer: RuntimeStyle.Layer, position: TileflowLayerPosition) {
    val id = layer.id
    val json = layer.json
    val requestedSlot = layer.slot
    if (!STYLE_ID.matches(id) || layerExists(id) || runtimeStyle.layers.size >= 1024) invalid()
    if (json.has("source") && !sourceExists(json.getString("source")))
        invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
    val (at, slot, resolved) = insertion(runtimeStyle.layers, position, requestedSlot, id, "addLayer")
    val record = RuntimeStyle.Layer(id, json, slot)
    if (styleEngine == null) NativeStyleLayer(record.json, record.slot).validate()
    changeStyle({ layers.add(at, record) }) { engine ->
        val payload = JSONObject().put("layer", json)
        if (slot != null && resolved == TileflowLayerPosition.Default)
            payload.put("slot", slot.wireName)
        resolved.json()?.let { payload.put("position", it) }
        engine.call(MapContract.Method.ADD_LAYER, payload)
    }
}

/** Replaces a layer's definition in place; only the properties that changed reach the map. */
public suspend fun TileflowMapView.updateLayer(layer: TileflowLayer) {
    updateLayer(RuntimeStyle.Layer(layer.id, layer.json(), layer.slot))
}

/** Replaces the definition of an existing application layer with style-spec JSON. */
public suspend fun TileflowMapView.updateStyleLayer(properties: JSONObject) {
    updateLayer(styleLayer(properties))
}

private suspend fun TileflowMapView.updateLayer(layer: RuntimeStyle.Layer) =
    styleEdits.withLock { replaceStyleLayer(layer) }

internal suspend fun TileflowMapView.replaceStyleLayer(layer: RuntimeStyle.Layer) {
    val index = runtimeStyle.layers.indexOfFirst { it.id == layer.id }
    if (index < 0) invalid(MapContract.ErrorReason.UNKNOWN_LAYER)
    if (layer.json.has("source") && !sourceExists(layer.json.getString("source")))
        invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
    if (styleEngine == null) NativeStyleLayer(layer.json, layer.slot).validate()
    changeStyle({ layers[index] = layer }) { engine ->
        val payload = JSONObject().put("layer", layer.json)
        layer.slot?.let { payload.put("slot", it.wireName) }
        engine.call(MapContract.Method.UPDATE_LAYER, payload)
    }
}

/**
 * Moves a layer relative to the application's other layers; [TileflowLayerPosition.Default] puts
 * it on top of its slot.
 */
public suspend fun TileflowMapView.moveLayer(
    id: String,
    position: TileflowLayerPosition,
): Unit = styleEdits.withLock { positionStyleLayer(id, position) }

/** An explicit null moves the layer outside the authored slots. */
public suspend fun TileflowMapView.moveLayer(
    id: String,
    position: TileflowLayerPosition,
    slot: TileflowLayerSlot?,
): Unit = styleEdits.withLock { positionStyleLayer(id, position, slot, true) }

internal suspend fun TileflowMapView.positionStyleLayer(id: String, position: TileflowLayerPosition, slotOverride: TileflowLayerSlot? = null, overridesSlot: Boolean = false) {
    val index = runtimeStyle.layers.indexOfFirst { it.id == id }
    if (index < 0) invalid(MapContract.ErrorReason.UNKNOWN_LAYER)
    if (
        (position as? TileflowLayerPosition.Above)?.layerId == id ||
            (position as? TileflowLayerPosition.Below)?.layerId == id
    )
        invalid()
    val record = runtimeStyle.layers[index]
    val rest = runtimeStyle.layers.toMutableList().apply { removeAt(index) }
    val (at, slot, resolved) = insertion(rest, position, if (overridesSlot) slotOverride else record.slot, id, "moveLayer")
    val moved = RuntimeStyle.Layer(record.id, record.json, slot)
    changeStyle({
        layers.removeAt(index)
        layers.add(at, moved)
    }) { engine ->
        val payload = JSONObject().put("id", id)
        val wire = resolved.json()
        if (wire != null) payload.put("position", wire)
        else slot?.let { payload.put("slot", it.wireName) }
        engine.call(MapContract.Method.MOVE_LAYER, payload)
    }
}

public suspend fun TileflowMapView.removeLayer(id: String): Unit =
    styleEdits.withLock { deleteStyleLayer(id) }

internal suspend fun TileflowMapView.deleteStyleLayer(id: String) {
    if (runtimeStyle.layers.none { it.id == id }) invalid(MapContract.ErrorReason.UNKNOWN_LAYER)
    changeStyle({ layers.removeAll { it.id == id } }) { engine ->
        engine.call(MapContract.Method.REMOVE_LAYER, JSONObject().put("id", id))
    }
}

/** Whether the application's runtime style holds a layer. */
public fun TileflowMapView.layerExists(id: String): Boolean = runtimeStyle.layers.any { it.id == id }

// Feature state

/**
 * Merges [state] into a feature's state, which layers read with `feature-state`. The state survives
 * theme changes and a new renderer. A vector source needs its [sourceLayer].
 */
public suspend fun TileflowMapView.setFeatureState(
    sourceId: String,
    sourceLayer: String? = null,
    featureId: String,
    state: Map<String, TileflowStyleValue>,
): Unit = styleEdits.withLock {
    if (!sourceExists(sourceId)) invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
    if (featureId.isEmpty() || featureId.length > 128 || state.size > 64) invalid()
    val wire = JSONObject().apply { state.forEach { (key, value) -> put(key, TileflowStyleValue.json(value)) } }
    val key = RuntimeStyle.stateKey(sourceId, sourceLayer)
    changeStyle({
        states.getOrPut(key) { mutableMapOf() }.getOrPut(featureId) { mutableMapOf() }.putAll(state)
    }) { engine ->
        engine.call(
            MapContract.Method.SET_FEATURE_STATE,
            featureTarget(sourceId, sourceLayer, featureId).put("state", wire),
        )
    }
}

/** A feature's state, as the application set it. */
public fun TileflowMapView.featureState(
    sourceId: String,
    sourceLayer: String? = null,
    featureId: String,
): Map<String, TileflowStyleValue> {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    if (!sourceExists(sourceId)) invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
    return runtimeStyle.states[RuntimeStyle.stateKey(sourceId, sourceLayer)]?.get(featureId)?.toMap()
        ?: emptyMap()
}

/**
 * Removes one key of a feature's state, all of it, or, without a feature, the state of every
 * feature of the source.
 */
public suspend fun TileflowMapView.removeFeatureState(
    sourceId: String,
    sourceLayer: String? = null,
    featureId: String? = null,
    key: String? = null,
): Unit = styleEdits.withLock {
    if (!sourceExists(sourceId)) invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
    if (key != null && featureId == null) invalid()
    val stateKey = RuntimeStyle.stateKey(sourceId, sourceLayer)
    changeStyle({
        when {
            featureId != null && key != null -> states[stateKey]?.get(featureId)?.remove(key)
            featureId != null -> states[stateKey]?.remove(featureId)
            else -> states.remove(stateKey)
        }
    }) { engine ->
        val payload = JSONObject().put("source", sourceId)
        sourceLayer?.let { payload.put("sourceLayer", it) }
        featureId?.let { payload.put("id", TileflowFeature.wireId(it)) }
        key?.let { payload.put("key", it) }
        engine.call(MapContract.Method.REMOVE_FEATURE_STATE, payload)
    }
}

// Queries

/**
 * Features the application's layers draw in part of the view, in pixels, topmost first. At a steep
 * pitch the renderer reads the view in bands, so features near the horizon are found too.
 */
public suspend fun TileflowMapView.queryRenderedFeatures(
    geometry: TileflowQueryGeometry = TileflowQueryGeometry.View,
    options: TileflowRenderedQueryOptions = TileflowRenderedQueryOptions(),
): List<TileflowQueriedFeature> =
    queryRendered(geometry, options, 1 / resources.displayMetrics.density)

/** [cssPerUnit] converts the geometry's points to CSS pixels: 1 / density for pixels, 1 for dp. */
internal suspend fun TileflowMapView.queryRendered(
    geometry: TileflowQueryGeometry,
    options: TileflowRenderedQueryOptions,
    cssPerUnit: Float,
): List<TileflowQueriedFeature> {
    if (options.limit !in 1..100_000) invalid()
    val payload = JSONObject().put("limit", options.limit)
    geometryJson(geometry, cssPerUnit)?.let { payload.put("geometry", it) }
    options.layerIds?.let { payload.put("layers", JSONArray(it)) }
    options.filter?.let { payload.put("filter", it.json) }
    return features(styleRenderer().call(MapContract.Method.QUERY_RENDERED_FEATURES, payload))
}

/**
 * Features of a source in the tiles the map has loaded, whether or not they are drawn. A feature
 * that crosses tiles is returned once when it has an identifier.
 */
public suspend fun TileflowMapView.querySourceFeatures(
    sourceId: String,
    options: TileflowSourceQueryOptions = TileflowSourceQueryOptions(),
): List<TileflowQueriedFeature> {
    if (options.limit !in 1..100_000) invalid()
    val payload = JSONObject().put("source", sourceId).put("limit", options.limit)
    options.sourceLayerIds?.let { payload.put("sourceLayers", JSONArray(it)) }
    options.filter?.let { payload.put("filter", it.json) }
    return features(styleRenderer().call(MapContract.Method.QUERY_SOURCE_FEATURES, payload))
}

/** The clusters and points one level below a cluster of a clustering GeoJSON source. */
public suspend fun TileflowMapView.clusterChildren(
    sourceId: String,
    clusterId: Int,
): List<TileflowQueriedFeature> = features(cluster(sourceId, clusterId, "children"))

/** The points of a cluster, [limit] of them from [offset]. */
public suspend fun TileflowMapView.clusterLeaves(
    sourceId: String,
    clusterId: Int,
    limit: Int = 10,
    offset: Int = 0,
): List<TileflowQueriedFeature> {
    if (limit !in 1..100_000 || offset < 0) invalid()
    return features(
        cluster(sourceId, clusterId, "leaves") { put("limit", limit).put("offset", offset) }
    )
}

/** The zoom level at which a cluster splits into its children. */
public suspend fun TileflowMapView.clusterExpansionZoom(sourceId: String, clusterId: Int): Double =
    (cluster(sourceId, clusterId, "expansionZoom") as? Number)?.toDouble()
        ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)

// Images

/** Adds an application image, or replaces the one of the same name, keeping the others. */
public suspend fun TileflowMapView.addImage(image: TileflowMapImage): Unit =
    setImages(images.filter { it.name != image.name } + image)

/** Removes an application image. */
public suspend fun TileflowMapView.removeImage(name: String): Unit =
    setImages(images.filter { it.name != name })

// Implementation

private suspend fun TileflowMapView.cluster(
    sourceId: String,
    clusterId: Int,
    query: String,
    extra: JSONObject.() -> Unit = {},
): Any {
    if (clusterId < 0) invalid()
    val payload =
        JSONObject().put("source", sourceId).put("cluster", clusterId).put("query", query).apply(extra)
    return styleRenderer().call(MapContract.Method.QUERY_CLUSTER, payload)
}

private fun features(value: Any): List<TileflowQueriedFeature> {
    val array = value as? JSONArray ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    return (0 until array.length()).map { TileflowQueriedFeature.of(array.getJSONObject(it)) }
}

internal fun featureTarget(source: String, sourceLayer: String?, id: String): JSONObject =
    JSONObject().put("source", source).put("id", TileflowFeature.wireId(id)).apply {
        sourceLayer?.let { put("sourceLayer", it) }
    }

/** The geometry with its points in CSS pixels. */
private fun geometryJson(geometry: TileflowQueryGeometry, cssPerUnit: Float): JSONObject? {
    fun point(point: TileflowPoint): JSONObject {
        val x = (point.x * cssPerUnit).toDouble()
        val y = (point.y * cssPerUnit).toDouble()
        if (!x.isFinite() || !y.isFinite() || abs(x) > 32_768 || abs(y) > 32_768) invalid()
        return JSONObject().put("x", x).put("y", y)
    }
    return when (geometry) {
        is TileflowQueryGeometry.Point -> JSONObject().put("point", point(geometry.point))
        is TileflowQueryGeometry.Box ->
            JSONObject()
                .put("box", JSONArray().put(point(geometry.first)).put(point(geometry.second)))
        is TileflowQueryGeometry.Polygon -> {
            if (geometry.points.size !in 3..1024) invalid()
            JSONObject().put("polygon", JSONArray(geometry.points.map(::point)))
        }
        TileflowQueryGeometry.View -> null
    }
}

private fun TileflowMapView.geoJSONSource(id: String): RuntimeStyle.Source {
    val source =
        runtimeStyle.sources.firstOrNull { it.id == id }
            ?: invalid(MapContract.ErrorReason.UNKNOWN_SOURCE)
    if (source.geoJSON == null) invalid()
    return source
}

/** The index a layer goes at among [layers], and the slot it takes. */
private fun insertion(
    layers: List<RuntimeStyle.Layer>,
    position: TileflowLayerPosition,
    slot: TileflowLayerSlot?,
    layerId: String,
    operation: String,
): Triple<Int, TileflowLayerSlot?, TileflowLayerPosition> {
    val reference =
        when (position) {
            TileflowLayerPosition.Default -> return Triple(layers.size, slot, position)
            is TileflowLayerPosition.AtSlotIndex -> {
                val siblings = layers.filter { it.slot == slot }
                if (position.slotIndex !in 0..siblings.size) throw TileflowMapException(
                    TileflowErrorCode.INVALID_REQUEST,
                    TileflowErrorContext(reason = MapContract.ErrorReason.INVALID_LAYER_POSITION.wireName,
                        operation = operation, path = "position.slotIndex", layerId = layerId,
                        slot = slot?.wireName, rule = "indexRange", limit = siblings.size, count = position.slotIndex,
                        corrections = listOf(TileflowErrorCorrection("chooseSlotIndex", "Choose an index within this slot's application layers."))),
                )
                val resolved = siblings.getOrNull(position.slotIndex)?.let { TileflowLayerPosition.Below(it.id) }
                    ?: siblings.lastOrNull()?.let { TileflowLayerPosition.Above(it.id) }
                    ?: TileflowLayerPosition.Default
                return insertion(layers, resolved, slot, layerId, operation)
            }
            is TileflowLayerPosition.Above -> position.layerId
            is TileflowLayerPosition.Below -> position.layerId
        }
    val index = layers.indexOfFirst { it.id == reference }
    val path = if (position is TileflowLayerPosition.Above) "position.aboveLayerId" else "position.belowLayerId"
    if (index < 0) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST,
        TileflowErrorContext(reason = MapContract.ErrorReason.UNKNOWN_LAYER.wireName, operation = operation,
            path = path, layerId = layerId, referenceLayerId = reference, slot = slot?.wireName,
            rule = "knownReference", corrections = listOf(TileflowErrorCorrection("referenceExistingLayer", "Reference an existing application layer."))))
    val referenceSlot = layers[index].slot
    if (slot != referenceSlot) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST,
        TileflowErrorContext(reason = MapContract.ErrorReason.LAYER_POSITION_CONFLICT.wireName, operation = operation,
            path = path, layerId = layerId, referenceLayerId = reference, slot = slot?.wireName,
            referenceSlot = referenceSlot?.wireName, rule = "sameSlot", corrections = listOf(
                TileflowErrorCorrection("alignSlot", "Choose the reference layer's slot."),
                TileflowErrorCorrection("referenceSameSlot", "Reference a layer in the same slot."))))
    return Triple(if (position is TileflowLayerPosition.Above) index + 1 else index, slot, position)
}

/** A source's MapLibre specification without its data, and the GeoJSON it starts with. */
internal fun sourceWire(source: TileflowSource, inlineBase: GeoJSONLog.Base? = null): Pair<JSONObject, GeoJSONLog?> {
    fun tiled(type: String, tiles: TileflowTiles, bounds: TileflowBounds?, attribution: String?) =
        JSONObject().put("type", type).apply {
            when (tiles) {
                is TileflowTiles.TileJSON -> put("url", tiles.url)
                is TileflowTiles.Templates -> put("tiles", JSONArray(tiles.templates))
            }
            bounds?.let {
                put("bounds", JSONArray(listOf(it.west, it.south, it.east, it.north)))
            }
            attribution?.let { put("attribution", it) }
        }
    fun JSONObject.zooms(minZoom: Double?, maxZoom: Double?) = apply {
        minZoom?.let { put("minzoom", it) }
        maxZoom?.let { put("maxzoom", it) }
    }
    return when (source) {
        is TileflowGeoJSONSource -> {
            val spec =
                JSONObject().put("type", "geojson").apply {
                    source.maxZoom?.let { put("maxzoom", it) }
                    source.attribution?.let { put("attribution", it) }
                    source.buffer?.let { put("buffer", it) }
                    source.tolerance?.let { put("tolerance", it) }
                    source.filter?.let { put("filter", it.json) }
                    if (source.cluster) put("cluster", true)
                    source.clusterRadius?.let { put("clusterRadius", it) }
                    source.clusterMaxZoom?.let { put("clusterMaxZoom", it) }
                    source.clusterMinPoints?.let { put("clusterMinPoints", it) }
                    if (source.clusterProperties.isNotEmpty())
                        put(
                            "clusterProperties",
                            JSONObject().apply {
                                source.clusterProperties.forEach { (key, value) -> put(key, value.json) }
                            },
                        )
                    if (source.lineMetrics) put("lineMetrics", true)
                    if (source.generateId) put("generateId", true)
                    source.promoteId?.let { put("promoteId", it) }
                }
            spec to GeoJSONLog(inlineBase ?: geoJSONBase(source.data), promoteId = source.promoteId)
        }
        is TileflowVectorSource ->
            tiled("vector", source.tiles, source.bounds, source.attribution)
                .zooms(source.minZoom, source.maxZoom)
                .apply { source.promoteId?.let { put("promoteId", it) } } to null
        is TileflowRasterSource ->
            tiled("raster", source.tiles, source.bounds, source.attribution)
                .zooms(source.minZoom, source.maxZoom)
                .apply { source.tileSize?.let { put("tileSize", it) } } to null
        is TileflowRasterDEMSource ->
            tiled("raster-dem", source.tiles, source.bounds, source.attribution)
                .zooms(source.minZoom, source.maxZoom)
                .apply {
                    source.tileSize?.let { put("tileSize", it) }
                    source.encoding?.let { put("encoding", it.wireName) }
                } to null
        is TileflowImageSource -> {
            if (source.coordinates.size != 4) invalid()
            JSONObject()
                .put("type", "image")
                .put("url", source.url)
                .put(
                    "coordinates",
                    JSONArray(
                        source.coordinates.map { JSONArray().put(it.longitude).put(it.latitude) }
                    ),
                ) to null
        }
    }
}

internal fun geoJSONBase(data: TileflowGeoJSONData): GeoJSONLog.Base {
    val bytes =
        when (data) {
            is TileflowGeoJSONData.Url -> return GeoJSONLog.Base.Url(data.url)
            TileflowGeoJSONData.Empty -> return GeoJSONLog.Base.Empty
            is TileflowGeoJSONData.GeoJSON -> data.bytes
            is TileflowGeoJSONData.Features ->
                JSONObject()
                    .put("type", "FeatureCollection")
                    .put("features", JSONArray(data.features.map { it.json() }))
                    .toString()
                    .toByteArray(Charsets.UTF_8)
        }
    if (bytes.isEmpty() || bytes.size > MapContract.MAXIMUM_DATA_BYTES)
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                MapContract.ErrorReason.DATA_TOO_LARGE,
                MapContract.MAXIMUM_DATA_BYTES,
            ),
        )
    return GeoJSONLog.Base.Bytes(bytes, ResourceDigest.sha256(bytes))
}

private fun geoJSONWire(
    base: GeoJSONLog.Base,
    channel: MapPayloadStore,
): Pair<JSONObject, List<MapPayloadStore.Reference>> =
    when (base) {
        is GeoJSONLog.Base.Url -> JSONObject().put("url", base.url) to emptyList()
        GeoJSONLog.Base.Empty -> JSONObject().put("empty", true) to emptyList()
        is GeoJSONLog.Base.Bytes -> {
            val reference = channel.register(base.bytes, base.digest, "application/geo+json")
            reference.json() to listOf(reference)
        }
    }

private suspend fun MapEngine.addSource(
    record: RuntimeStyle.Source,
    method: MapContract.Method = MapContract.Method.ADD_SOURCE,
    preserveData: Boolean = false,
) {
    val spec = JSONObject(record.spec.toString())
    var references = emptyList<MapPayloadStore.Reference>()
    record.geoJSON?.takeUnless { preserveData }?.let { log ->
        val (value, registered) = geoJSONWire(log.base, data)
        spec.put("data", value)
        references = registered
    }
    call(
        method,
        JSONObject().put("id", record.id).put("source", spec).put("preserveData", preserveData),
        references,
    )
}

internal suspend fun MapEngine.sendUpdate(update: GeoJSONLog.Update, source: String) {
    val payload = JSONObject().put("id", source)
    val references = mutableListOf<MapPayloadStore.Reference>()
    update.add?.let { bytes ->
        val reference = data.register(bytes, ResourceDigest.sha256(bytes), "application/json")
        references += reference
        payload.put("add", reference.json())
    }
    if (update.remove.isNotEmpty())
        payload.put("remove", JSONArray(update.remove.map { TileflowFeature.wireId(it) }))
    call(MapContract.Method.UPDATE_GEO_JSON_SOURCE, payload, references)
}

/** Folds a GeoJSON source's updates into its data in the background once they outweigh it. */
private fun TileflowMapView.compactIfNeeded(source: RuntimeStyle.Source) {
    val log = source.geoJSON ?: return
    if (!log.needsCompaction) return
    source.geoJSON = log.copy(compacting = true)
    launchOnView {
        val compacted =
            withContext(Dispatchers.Default) {
                GeoJSONLog.compact(
                    (log.base as? GeoJSONLog.Base.Bytes)?.bytes,
                    log.updates,
                    log.promoteId,
                )
            }
        val current = source.geoJSON ?: return@launchOnView
        source.geoJSON =
            if (
                runtimeStyle.sources.contains(source) &&
                    current.revision == log.revision &&
                    current.updates.size >= log.updates.size &&
                    compacted != null &&
                    compacted.size <= MapContract.MAXIMUM_DATA_BYTES
            ) {
                val rest = current.updates.drop(log.updates.size)
                current.copy(
                    base = GeoJSONLog.Base.Bytes(compacted, ResourceDigest.sha256(compacted)),
                    updates = rest,
                    updateBytes = rest.sumOf { (it.add?.size ?: 0).toLong() + it.remove.sumOf { id -> id.length } },
                    compacting = false,
                )
            } else current.copy(compacting = false)
    }
}

/**
 * Gives a new renderer the application's runtime style: sources and their updates, layers in
 * order, then feature state.
 */
internal suspend fun TileflowMapView.replayStyle(engine: MapEngine): Unit = styleEdits.withLock {
    try {
        restoreStyle(engine)
    } finally {
        if (readyEngine === engine) styleRestored = true
    }
}

private suspend fun TileflowMapView.restoreStyle(engine: MapEngine) {
    val style = runtimeStyle.copy()
    for (source in style.sources) {
        engine.addSource(source)
        source.geoJSON?.updates?.forEach { engine.sendUpdate(it, source.id) }
    }
    for (layer in style.layers) {
        val payload = JSONObject().put("layer", layer.json)
        layer.slot?.let { payload.put("slot", it.wireName) }
        engine.call(MapContract.Method.ADD_LAYER, payload)
    }
    val states =
        style.states.flatMap { (key, features) ->
            val (source, sourceLayer) = key.split("\n", limit = 2)
            features.filter { it.value.isNotEmpty() }.map { (id, state) ->
                featureTarget(source, sourceLayer.ifEmpty { null }, id)
                    .put(
                        "state",
                        JSONObject().apply {
                            state.forEach { (name, value) -> put(name, TileflowStyleValue.json(value)) }
                        },
                    )
            }
        }
    // Feature state goes in groups of requests in flight, well inside the renderer's budget.
    for (group in states.chunked(32))
        coroutineScope {
            group
                .map { payload ->
                    async { engine.call(MapContract.Method.SET_FEATURE_STATE, payload) }
                }
                .awaitAll()
        }
}
