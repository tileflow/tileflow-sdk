package dev.tileflow.sdk

import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
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

private val STYLE_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

private fun invalid(reason: ProtocolContract.ErrorReason? = null): Nothing =
    throw TileflowMapException(
        TileflowErrorCode.INVALID_REQUEST,
        reason?.let { TileflowErrorContext.of(it) } ?: TileflowErrorContext(),
    )

private fun TileflowMapView.styleRenderer(): MapBridge {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    return readyBridge ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
}

/**
 * Keeps a change for later renderers and sends it to the current one. A change the renderer refuses
 * is not kept.
 */
private suspend fun TileflowMapView.changeStyle(
    change: RuntimeStyle.() -> Unit,
    send: suspend (MapBridge) -> Unit,
) {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    val previous = runtimeStyle.copy()
    runtimeStyle.change()
    val bridge = readyBridge ?: return
    try {
        send(bridge)
    } catch (error: TileflowMapException) {
        if (error.code == TileflowErrorCode.INVALID_REQUEST) runtimeStyle.restore(previous)
        throw error
    }
}

// Sources

/**
 * Adds a source to the application's runtime style. GeoJSON data travels over the SDK's data
 * channel, up to 32 MiB. The source and everything drawn from it survive theme changes and a new
 * renderer.
 */
public suspend fun TileflowMapView.addSource(source: TileflowSource) {
    if (!STYLE_ID.matches(source.id) || runtimeStyle.sources.any { it.id == source.id }) invalid()
    val (spec, log) = sourceWire(source)
    val record = RuntimeStyle.Source(source.id, spec, log)
    changeStyle({ sources += record }) { bridge -> bridge.addSource(record) }
}

/** Removes a source no application layer draws. */
public suspend fun TileflowMapView.removeSource(id: String) {
    if (runtimeStyle.sources.none { it.id == id }) invalid(ProtocolContract.ErrorReason.UNKNOWN_SOURCE)
    if (runtimeStyle.layers.any { it.json.optString("source") == id }) invalid()
    changeStyle({
        sources.removeAll { it.id == id }
        states.keys.removeAll { it.startsWith("$id\n") }
    }) { bridge ->
        bridge.call(ProtocolContract.Method.REMOVE_SOURCE, JSONObject().put("id", id))
    }
}

/** Whether the application's runtime style holds a source. */
public fun TileflowMapView.sourceExists(id: String): Boolean =
    runtimeStyle.sources.any { it.id == id }

/** Replaces a GeoJSON source's data; feature state stays with feature identifiers. */
public suspend fun TileflowMapView.setGeoJSONSourceData(sourceId: String, data: TileflowGeoJSONData) {
    val source = geoJSONSource(sourceId)
    val base = geoJSONBase(data)
    changeStyle({
        val log = source.geoJSON!!
        source.geoJSON = GeoJSONLog(base, promoteId = log.promoteId, revision = log.revision + 1)
    }) { bridge ->
        val (value, references) = geoJSONWire(base, bridge.data)
        bridge.call(
            ProtocolContract.Method.SET_GEO_JSON_SOURCE_DATA,
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
public suspend fun TileflowMapView.updateGeoJSONSourceFeatures(
    sourceId: String,
    features: List<TileflowFeature>,
): Unit = updateFeatures(sourceId, features, emptyList())

/** Removes features of a GeoJSON source by identifier; unknown identifiers are ignored. */
public suspend fun TileflowMapView.removeGeoJSONSourceFeatures(
    sourceId: String,
    featureIds: List<String>,
): Unit = updateFeatures(sourceId, emptyList(), featureIds)

private suspend fun TileflowMapView.updateFeatures(
    sourceId: String,
    add: List<TileflowFeature>,
    remove: List<String>,
) {
    val source = geoJSONSource(sourceId)
    val log = source.geoJSON!!
    if (log.base is GeoJSONLog.Base.Url) invalid()
    if (add.isEmpty() && remove.isEmpty()) return
    if (remove.any { it.isEmpty() || it.length > 128 }) invalid()
    if (add.any { feature -> log.promoteId?.let { feature.properties[it] == null } ?: (feature.id == null) })
        invalid()
    val bytes =
        add.takeIf { it.isNotEmpty() }?.let { features ->
            JSONArray(features.map { it.json() }).toString().toByteArray(Charsets.UTF_8)
        }
    if ((bytes?.size ?: 0) > ProtocolContract.MAXIMUM_DATA_BYTES)
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                ProtocolContract.ErrorReason.DATA_TOO_LARGE,
                ProtocolContract.MAXIMUM_DATA_BYTES,
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
    }) { bridge -> bridge.sendUpdate(update, sourceId) }
    compactIfNeeded(source)
}

// Layers

/**
 * Adds a layer of the application's runtime style. A layer placed above or below another takes that
 * layer's slot; otherwise it goes on top of its own slot.
 */
public suspend fun TileflowMapView.addLayer(
    layer: TileflowLayer,
    position: TileflowLayerPosition = TileflowLayerPosition.Default,
) {
    if (
        !STYLE_ID.matches(layer.id) ||
            runtimeStyle.layers.any { it.id == layer.id } ||
            runtimeStyle.layers.size >= 1024
    )
        invalid()
    val json = layer.json()
    if (json.has("source") && !sourceExists(json.getString("source")))
        invalid(ProtocolContract.ErrorReason.UNKNOWN_SOURCE)
    val (at, slot) = insertion(runtimeStyle.layers, position, layer.slot)
    val record = RuntimeStyle.Layer(layer.id, json, slot)
    changeStyle({ layers.add(at, record) }) { bridge ->
        val payload = JSONObject().put("layer", json)
        if (slot != null && position == TileflowLayerPosition.Default)
            payload.put("slot", slot.wireName)
        position.json()?.let { payload.put("position", it) }
        bridge.call(ProtocolContract.Method.ADD_LAYER, payload)
    }
}

/** Replaces a layer's definition in place; only the properties that changed reach the map. */
public suspend fun TileflowMapView.updateLayer(layer: TileflowLayer) {
    val index = runtimeStyle.layers.indexOfFirst { it.id == layer.id }
    if (index < 0) invalid(ProtocolContract.ErrorReason.UNKNOWN_LAYER)
    val json = layer.json()
    if (json.has("source") && !sourceExists(json.getString("source")))
        invalid(ProtocolContract.ErrorReason.UNKNOWN_SOURCE)
    val slot = layer.slot
    changeStyle({ layers[index] = RuntimeStyle.Layer(layer.id, json, slot) }) { bridge ->
        val payload = JSONObject().put("layer", json)
        slot?.let { payload.put("slot", it.wireName) }
        bridge.call(ProtocolContract.Method.UPDATE_LAYER, payload)
    }
}

/**
 * Moves a layer relative to the application's other layers; [TileflowLayerPosition.Default] puts
 * it on top of its slot.
 */
public suspend fun TileflowMapView.moveLayer(id: String, position: TileflowLayerPosition) {
    val index = runtimeStyle.layers.indexOfFirst { it.id == id }
    if (index < 0) invalid(ProtocolContract.ErrorReason.UNKNOWN_LAYER)
    if (
        (position as? TileflowLayerPosition.Above)?.layerId == id ||
            (position as? TileflowLayerPosition.Below)?.layerId == id
    )
        invalid()
    val record = runtimeStyle.layers[index]
    val rest = runtimeStyle.layers.toMutableList().apply { removeAt(index) }
    val (at, slot) = insertion(rest, position, record.slot)
    val moved = RuntimeStyle.Layer(record.id, record.json, slot)
    changeStyle({
        layers.removeAt(index)
        layers.add(at, moved)
    }) { bridge ->
        val payload = JSONObject().put("id", id)
        val wire = position.json()
        if (wire != null) payload.put("position", wire)
        else slot?.let { payload.put("slot", it.wireName) }
        bridge.call(ProtocolContract.Method.MOVE_LAYER, payload)
    }
}

public suspend fun TileflowMapView.removeLayer(id: String) {
    if (runtimeStyle.layers.none { it.id == id }) invalid(ProtocolContract.ErrorReason.UNKNOWN_LAYER)
    changeStyle({ layers.removeAll { it.id == id } }) { bridge ->
        bridge.call(ProtocolContract.Method.REMOVE_LAYER, JSONObject().put("id", id))
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
) {
    if (!sourceExists(sourceId)) invalid(ProtocolContract.ErrorReason.UNKNOWN_SOURCE)
    if (featureId.isEmpty() || featureId.length > 128 || state.size > 64) invalid()
    val wire = JSONObject().apply { state.forEach { (key, value) -> put(key, TileflowStyleValue.json(value)) } }
    val key = RuntimeStyle.stateKey(sourceId, sourceLayer)
    changeStyle({
        states.getOrPut(key) { mutableMapOf() }.getOrPut(featureId) { mutableMapOf() }.putAll(state)
    }) { bridge ->
        bridge.call(
            ProtocolContract.Method.SET_FEATURE_STATE,
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
    if (!sourceExists(sourceId)) invalid(ProtocolContract.ErrorReason.UNKNOWN_SOURCE)
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
) {
    if (!sourceExists(sourceId)) invalid(ProtocolContract.ErrorReason.UNKNOWN_SOURCE)
    if (key != null && featureId == null) invalid()
    val stateKey = RuntimeStyle.stateKey(sourceId, sourceLayer)
    changeStyle({
        when {
            featureId != null && key != null -> states[stateKey]?.get(featureId)?.remove(key)
            featureId != null -> states[stateKey]?.remove(featureId)
            else -> states.remove(stateKey)
        }
    }) { bridge ->
        val payload = JSONObject().put("source", sourceId)
        sourceLayer?.let { payload.put("sourceLayer", it) }
        featureId?.let { payload.put("id", TileflowFeature.wireId(it)) }
        key?.let { payload.put("key", it) }
        bridge.call(ProtocolContract.Method.REMOVE_FEATURE_STATE, payload)
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
    return features(styleRenderer().call(ProtocolContract.Method.QUERY_RENDERED_FEATURES, payload))
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
    return features(styleRenderer().call(ProtocolContract.Method.QUERY_SOURCE_FEATURES, payload))
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
    return styleRenderer().call(ProtocolContract.Method.QUERY_CLUSTER, payload)
}

private fun features(value: Any): List<TileflowQueriedFeature> {
    val array = value as? JSONArray ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    return (0 until array.length()).map { TileflowQueriedFeature.of(array.getJSONObject(it)) }
}

private fun featureTarget(source: String, sourceLayer: String?, id: String): JSONObject =
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
            ?: invalid(ProtocolContract.ErrorReason.UNKNOWN_SOURCE)
    if (source.geoJSON == null) invalid()
    return source
}

/** The index a layer goes at among [layers], and the slot it takes. */
private fun insertion(
    layers: List<RuntimeStyle.Layer>,
    position: TileflowLayerPosition,
    slot: TileflowLayerSlot?,
): Pair<Int, TileflowLayerSlot?> {
    val reference =
        when (position) {
            TileflowLayerPosition.Default -> return layers.size to slot
            is TileflowLayerPosition.Above -> position.layerId
            is TileflowLayerPosition.Below -> position.layerId
        }
    val index = layers.indexOfFirst { it.id == reference }
    if (index < 0) invalid(ProtocolContract.ErrorReason.UNKNOWN_LAYER)
    return (if (position is TileflowLayerPosition.Above) index + 1 else index) to layers[index].slot
}

/** A source's MapLibre specification without its data, and the GeoJSON it starts with. */
internal fun sourceWire(source: TileflowSource): Pair<JSONObject, GeoJSONLog?> {
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
            spec to GeoJSONLog(geoJSONBase(source.data), promoteId = source.promoteId)
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
    if (bytes.isEmpty() || bytes.size > ProtocolContract.MAXIMUM_DATA_BYTES)
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                ProtocolContract.ErrorReason.DATA_TOO_LARGE,
                ProtocolContract.MAXIMUM_DATA_BYTES,
            ),
        )
    return GeoJSONLog.Base.Bytes(bytes, DataChannel.digest(bytes))
}

private fun geoJSONWire(
    base: GeoJSONLog.Base,
    channel: DataChannel,
): Pair<JSONObject, List<DataChannel.Reference>> =
    when (base) {
        is GeoJSONLog.Base.Url -> JSONObject().put("url", base.url) to emptyList()
        GeoJSONLog.Base.Empty -> JSONObject().put("empty", true) to emptyList()
        is GeoJSONLog.Base.Bytes -> {
            val reference = channel.register(base.bytes, base.digest, "application/geo+json")
            reference.json() to listOf(reference)
        }
    }

private suspend fun MapBridge.addSource(record: RuntimeStyle.Source) {
    val spec = JSONObject(record.spec.toString())
    var references = emptyList<DataChannel.Reference>()
    record.geoJSON?.let { log ->
        val (value, registered) = geoJSONWire(log.base, data)
        spec.put("data", value)
        references = registered
    }
    call(
        ProtocolContract.Method.ADD_SOURCE,
        JSONObject().put("id", record.id).put("source", spec),
        references,
    )
}

private suspend fun MapBridge.sendUpdate(update: GeoJSONLog.Update, source: String) {
    val payload = JSONObject().put("id", source)
    val references = mutableListOf<DataChannel.Reference>()
    update.add?.let { bytes ->
        val reference = data.register(bytes, DataChannel.digest(bytes), "application/json")
        references += reference
        payload.put("add", reference.json())
    }
    if (update.remove.isNotEmpty())
        payload.put("remove", JSONArray(update.remove.map { TileflowFeature.wireId(it) }))
    call(ProtocolContract.Method.UPDATE_GEO_JSON_SOURCE, payload, references)
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
                    compacted.size <= ProtocolContract.MAXIMUM_DATA_BYTES
            ) {
                val rest = current.updates.drop(log.updates.size)
                current.copy(
                    base = GeoJSONLog.Base.Bytes(compacted, DataChannel.digest(compacted)),
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
internal suspend fun TileflowMapView.replayStyle(bridge: MapBridge) {
    val style = runtimeStyle.copy()
    for (source in style.sources) {
        bridge.addSource(source)
        source.geoJSON?.updates?.forEach { bridge.sendUpdate(it, source.id) }
    }
    for (layer in style.layers) {
        val payload = JSONObject().put("layer", layer.json)
        layer.slot?.let { payload.put("slot", it.wireName) }
        bridge.call(ProtocolContract.Method.ADD_LAYER, payload)
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
                    async { bridge.call(ProtocolContract.Method.SET_FEATURE_STATE, payload) }
                }
                .awaitAll()
        }
}
