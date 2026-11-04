package dev.tileflow.sdk.engine

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.DisplayMetrics
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dev.tileflow.sdk.TileflowLayerSlot
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.ProtocolContract.Method
import java.net.URI
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.Layer
import org.maplibre.android.style.layers.SymbolLayer
import org.maplibre.android.style.sources.GeoJsonSource
import org.maplibre.android.style.sources.VectorSource

/** Stores app-owned native objects independently of the base style. Each MapLibre style load
 * receives the same source data, images, layer order and feature state. */
internal class NativeRuntimeStyle(
    private val currentStyle: () -> Style?,
    private val currentTheme: () -> String?,
    private val project: suspend (JSONObject) -> Pair<JSONObject, NativeStyleProjection>,
    private val readData: suspend (String) -> String,
) {
    private val sources = linkedMapOf<String, NativeStyleSource>()
    private val layers = mutableListOf<NativeStyleLayer>()
    private val states = mutableMapOf<Target, JsonObject>()
    private val pendingState = mutableSetOf<Target>()
    val attributions: List<String>
        get() = sources.values.mapNotNull { it.spec.opt("attribution") as? String }.distinct()
    private var images = emptyMap<String, Image>()
    private var anchors: JSONObject? = null
    private var defaultAnchor: String? = null
    @Volatile private var projections = emptyList<NativeStyleProjection>()
    private val mutations = Mutex()

    private data class Target(val source: String, val layer: String?, val id: String)
    private data class Image(val bitmap: Bitmap, val variants: Map<String, Bitmap>, val sdf: Boolean, val digest: String) {
        fun forTheme(name: String?): Bitmap = variants[name] ?: bitmap
    }

    fun classify(url: URI): TileflowResourceKind? =
        projections.firstNotNullOfOrNull { it.classify(url).takeUnless { kind -> kind == TileflowResourceKind.OTHER } }

    suspend fun call(method: Method, request: JSONObject, channel: DataChannel, map: MapLibreMap, view: MapView, density: Float): Any =
        mutations.withLock {
            // The map may have retired while a previous source was loading.
            currentStyle()
            try {
                when (method) {
                    Method.ADD_SOURCE -> addSource(request, channel)
                    Method.REMOVE_SOURCE -> removeSource(request.getString("id"))
                    Method.SET_GEO_JSON_SOURCE_DATA -> replaceData(request, channel)
                    Method.UPDATE_GEO_JSON_SOURCE -> editData(request, channel)
                    Method.ADD_LAYER, Method.UPDATE_LAYER, Method.MOVE_LAYER, Method.REMOVE_LAYER -> changeLayer(method, request)
                    Method.SET_FEATURE_STATE, Method.REMOVE_FEATURE_STATE, Method.GET_FEATURE_STATE -> return@withLock state(method, request)
                    Method.SET_IMAGES -> setImages(request.getJSONArray("images"), channel)
                    Method.QUERY_RENDERED_FEATURES -> return@withLock NativeFeatureQueries.rendered(map, view, density, request, layers, sources)
                    Method.QUERY_SOURCE_FEATURES -> return@withLock NativeFeatureQueries.source(map, request, sources)
                    Method.QUERY_CLUSTER -> return@withLock NativeFeatureQueries.cluster(map, request, sources)
                    else -> styleInvalid()
                }
            } catch (error: dev.tileflow.sdk.TileflowMapException) {
                throw error
            } catch (error: kotlinx.coroutines.CancellationException) {
                throw error
            } catch (_: Exception) {
                styleInvalid("Invalid runtime style request: ${method.wireName}")
            }
            JSONObject.NULL
        }

    private suspend fun addSource(request: JSONObject, channel: DataChannel) {
        val name = request.getString("id")
        if (name in sources) styleInvalid(name)
        val spec = JSONObject(request.getJSONObject("source").toString())
        NativeStyleSource.validate(spec)
        val type = spec.getString("type")
        var prepared: NativeStyleProjection? = null
        var projected = spec
        var data: String? = null
        if (type == "geojson") {
            val ref = spec.getJSONObject("data")
            data = geometry(ref, channel, spec)
            spec.remove("data")
        } else {
            val result = project(spec)
            projected = result.first
            prepared = result.second
        }
        val source = NativeStyleSource(name, projected, data, prepared)
        val style = currentStyle()
        if (style?.getSource(source.id) != null) styleInvalid(name)
        val old = projections
        projections = old + listOfNotNull(prepared)
        try {
            style?.addSource(source.make())
        } catch (error: Exception) {
            projections = old
            throw error
        }
        sources[name] = source
    }

    private suspend fun geometry(ref: JSONObject, channel: DataChannel, spec: JSONObject): String {
        val raw = NativeStyleSource.data(ref, channel) ?: readData(ref.getString("url"))
        return withContext(Dispatchers.Default) { NativeStyleSource.edit(raw, spec, null, emptySet(), normalize = true) }
    }

    private fun removeSource(name: String) {
        val source = sources[name] ?: styleInvalid(name)
        if (layers.any { it.source == name } || currentStyle()?.removeSource(source.id) == false) styleInvalid(name)
        sources.remove(name)
        states.keys.removeAll { it.source == name }
        pendingState.removeAll { it.source == name }
        projections = sources.values.mapNotNull { it.projection }
    }

    private suspend fun replaceData(request: JSONObject, channel: DataChannel) {
        val source = geoSource(request)
        val data = geometry(request.getJSONObject("data"), channel, source.spec)
        setData(source, data)
    }

    private suspend fun editData(request: JSONObject, channel: DataChannel) {
        val source = geoSource(request)
        val original = source.geoJSON ?: styleInvalid("Missing GeoJSON")
        val updates = request.optJSONObject("add")?.let {
            channel.payload(it.getString("id"))?.bytes ?: styleInvalid("Unknown feature update")
        }
        val remove = request.optJSONArray("remove")?.items()?.map(Any::toString)?.toSet().orEmpty()
        val data = withContext(Dispatchers.Default) {
            NativeStyleSource.edit(original, source.spec, updates?.let { JSONArray(it.toString(Charsets.UTF_8)) }, remove)
        }
        setData(source, data)
    }

    private fun geoSource(request: JSONObject): NativeStyleSource =
        sources[request.getString("id")]?.takeIf { it.type == "geojson" } ?: styleInvalid("Unknown GeoJSON source")

    private fun setData(source: NativeStyleSource, data: String) {
        currentStyle()?.getSourceAs<GeoJsonSource>(source.id)?.setGeoJson(data)
        source.geoJSON = data
        pendingState += states.keys.filter { it.source == source.name }
    }

    private fun changeLayer(method: Method, request: JSONObject) {
        val json = request.optJSONObject("layer")
        val id = json?.getString("id") ?: request.getString("id")
        val previous = layers.firstOrNull { it.name == id }
        if ((method == Method.ADD_LAYER) != (previous == null)) styleInvalid(id)
        val style = currentStyle()
        val next = layers.toMutableList()
        val previousIndex = next.indexOf(previous)
        if (previous != null) next.removeAt(previousIndex)
        if (method == Method.REMOVE_LAYER) {
            if (style?.removeLayer(previous!!.id) == false) styleInvalid(id)
            layers.removeAt(previousIndex)
            return
        }
        val position = request.optJSONObject("position")
        val relative = position?.let { p -> next.firstOrNull { it.name == (p.opt("above") ?: p.opt("below")) } ?: styleInvalid("Unknown reference layer") }
        val slot = if (relative != null) relative.slot else NativeStyleLayer.slot(request.opt("slot"))
        val layer = NativeStyleLayer(json ?: previous!!.json, slot)
        validateSourceFor(layer)
        val native = layer.make()
        val index = when {
            relative != null -> next.indexOf(relative) + if (position!!.has("above")) 1 else 0
            method == Method.UPDATE_LAYER -> previousIndex
            else -> next.size
        }
        next.add(index, layer)
        if (style != null) {
            if (previous == null && style.getLayer(layer.id) != null) styleInvalid(id)
            if (previous != null && !style.removeLayer(previous.id)) styleInvalid(id)
            try {
                insert(style, layer, native, next)
            } catch (error: Exception) {
                if (previous != null) insert(style, previous, previous.make(), layers)
                throw error
            }
        }
        layers.clear()
        layers.addAll(next)
    }

    private fun validateSourceFor(layer: NativeStyleLayer) {
        if (layer.type == "background") {
            if (layer.source != null) styleInvalid("Background layer cannot name a source")
            return
        }
        val source = sources[layer.source] ?: styleInvalid("Unknown source")
        val valid = when (layer.type) {
            "hillshade", "color-relief" -> source.type == "raster-dem"
            "raster" -> source.type in setOf("raster", "image")
            else -> source.type in setOf("geojson", "vector")
        }
        if (!valid || (source.type == "vector") != (layer.sourceLayer != null)) styleInvalid("Incompatible layer source")
    }

    private fun anchor(style: Style, layer: NativeStyleLayer): String? {
        val slot = layer.slot ?: return null
        val anchor = if (anchors != null) anchors?.opt(slot.wireName) as? String
            else defaultAnchor.takeUnless { slot == TileflowLayerSlot.ABOVE_LABELS }
        return anchor?.takeIf { style.getLayer(it) != null }
    }

    private fun insert(style: Style, layer: NativeStyleLayer, native: Layer, order: List<NativeStyleLayer>) {
        val anchor = anchor(style, layer)
        val sorted = order.sortedBy { it.rank }
        val above = sorted.drop(sorted.indexOf(layer) + 1).firstOrNull {
            anchor(style, it) == anchor && style.getLayer(it.id) != null
        }?.id ?: anchor
        if (above == null) style.addLayer(native) else style.addLayerBelow(native, above)
    }

    private fun state(method: Method, request: JSONObject): Any {
        val name = request.getString("source")
        val source = sources[name] ?: styleInvalid(name)
        val layer = request.opt("sourceLayer") as? String
        if (!(source.type == "geojson" && layer == null || source.type == "vector" && !layer.isNullOrBlank()))
            styleInvalid("Invalid source layer for feature state")
        val id = request.opt("id")?.toString()
        val target = id?.let { Target(name, layer, it) }
        if (method == Method.GET_FEATURE_STATE) return states[target]?.let { JSONObject(it.toString()) } ?: JSONObject()
        val style = currentStyle()
        if (method == Method.SET_FEATURE_STATE) {
            if (target == null) styleInvalid("Missing feature id")
            val patch = JsonParser.parseString(request.getJSONObject("state").toString()).asJsonObject
            val full = states[target]?.deepCopy() ?: JsonObject()
            patch.entrySet().forEach { (key, value) -> full.add(key, value) }
            states[target] = full
            pendingState += target
            if (style != null) applyState(style, source, target, full)
        } else {
            val key = request.opt("key") as? String
            val matching = if (target != null) listOf(target) else states.keys.filter { it.source == name && it.layer == layer }
            for (item in matching) {
                val state = states[item]?.deepCopy() ?: JsonObject()
                if (key != null) state.remove(key)
                if (style != null) {
                    when (val native = style.getSource(source.id)) {
                        is GeoJsonSource -> if (key == null) native.removeFeatureState(item.id) else native.removeFeatureState(item.id, key)
                        is VectorSource -> if (key == null) native.removeFeatureState(layer!!, item.id) else native.removeFeatureState(layer!!, item.id, key)
                    }
                }
                if (key == null || state.size() == 0) {
                    states.remove(item)
                    pendingState.remove(item)
                } else states[item] = state
            }
        }
        return JSONObject.NULL
    }

    private fun applyState(style: Style, source: NativeStyleSource, target: Target, value: JsonObject): Boolean =
        when (val native = style.getSource(source.id)) {
            is GeoJsonSource -> native.setFeatureState(target.id, value)
            is VectorSource -> native.setFeatureState(target.layer!!, target.id, value)
            else -> false
        }

    /** The first asynchronous GeoJSON tile load may discard state set immediately after addSource.
     * Confirm it once the renderer draws the source and replay only the missing entries. */
    fun confirmState() {
        if (pendingState.isEmpty()) return
        val style = currentStyle() ?: return
        for (target in pendingState.toList()) {
            val source = sources[target.source] ?: continue
            val wanted = states[target] ?: continue
            val actual = when (val native = style.getSource(source.id)) {
                is GeoJsonSource -> native.getFeatureState(target.id)
                is VectorSource -> native.getFeatureState(target.layer!!, target.id)
                else -> null
            }
            if (actual == wanted) pendingState.remove(target) else applyState(style, source, target, wanted)
        }
    }

    private suspend fun setImages(list: JSONArray, channel: DataChannel) {
        val next = linkedMapOf<String, Image>()
        for (item in list.objects()) {
            val name = item.getString("name")
            val digest = buildString {
                append(item.getJSONObject("data").getString("sha256"))
                append(':').append(item.optDouble("pixelRatio", 1.0)).append(':').append(item.optBoolean("sdf"))
                item.optJSONObject("variants")?.let { variants ->
                    for (key in variants.keys().asSequence().sorted()) {
                        append(':').append(key.length).append(':').append(key).append(variants.getJSONObject(key).getString("sha256"))
                    }
                }
            }
            val held = images[name]
            if (held?.digest == digest) { next[name] = held; continue }
            val ratio = item.numberOr("pixelRatio", 1.0, 1.0, 4.0)
            suspend fun bitmap(ref: JSONObject): Bitmap {
                val bytes = channel.payload(ref.getString("id"))?.bytes ?: styleInvalid("Unknown image data")
                return withContext(Dispatchers.Default) {
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    if (bounds.outWidth !in 1..2048 || bounds.outHeight !in 1..2048) styleInvalid("Invalid image dimensions")
                    val image = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: styleInvalid("Invalid image")
                    image.density = (DisplayMetrics.DENSITY_DEFAULT * ratio).roundToInt()
                    image
                }
            }
            val base = bitmap(item.getJSONObject("data"))
            val variants = mutableMapOf<String, Bitmap>()
            item.optJSONObject("variants")?.let { definitions ->
                for (theme in definitions.keys()) {
                    val variant = bitmap(definitions.getJSONObject(theme))
                    if (variant.width != base.width || variant.height != base.height) styleInvalid("Image variants differ in size")
                    variants[theme] = variant
                }
            }
            next[name] = Image(base, variants, item.optBoolean("sdf"), digest)
        }
        currentStyle()?.let { style ->
            if (next.keys.any { it !in images && style.getImage(it) != null }) styleInvalid("Image id already in style")
            (images.keys - next.keys).forEach(style::removeImage)
            next.forEach { (id, image) ->
                if (images[id] !== image) style.addImage(id, image.forTheme(currentTheme()), image.sdf)
            }
        }
        images = next
    }

    fun dragFeature(layerName: String, id: String): NativeDragFeature? {
        val layer = layers.firstOrNull { it.name == layerName } ?: return null
        val source = sources[layer.source] ?: return null
        var current = source.geoJSON ?: return null
        val collection = JSONObject(current)
        val feature = collection.optJSONArray("features")?.objects()?.firstOrNull {
            it.opt("id")?.toString() == id
        } ?: return null
        val geometry = feature.optJSONObject("geometry") ?: return null
        return NativeDragFeature(geometry) { moved ->
            if (sources[layer.source] !== source || source.geoJSON !== current) false
            else {
                feature.put("geometry", moved)
                current = collection.toString()
                setData(source,current)
                true
            }
        }
    }

    fun image(name: String): Bitmap? = images[name]?.forTheme(currentTheme())

    fun refreshImageVariants() {
        val style = currentStyle() ?: return
        for ((name, image) in images) if (image.variants.isNotEmpty())
            style.addImage(name, image.forTheme(currentTheme()), image.sdf)
    }

    fun restore(style: Style, document: JSONObject) {
        if (sources.values.any { style.getSource(it.id) != null } || layers.any { style.getLayer(it.id) != null } ||
            images.keys.any { style.getImage(it) != null }) styleInvalid("Application id already in style")
        anchors = document.optJSONObject("metadata")?.optJSONObject("tileflow:overlay-placement-manifest")?.optJSONObject("anchors")
        defaultAnchor = style.layers.firstOrNull { it is SymbolLayer }?.id
        images.forEach { (name, image) -> style.addImage(name, image.forTheme(currentTheme()), image.sdf) }
        sources.values.forEach { style.addSource(it.make()) }
        layers.sortedBy { it.rank }.forEach { insert(style, it, it.make(), layers) }
        pendingState += states.keys
        states.forEach { (key, value) -> applyState(style, sources.getValue(key.source), key, value) }
    }

    companion object {
        val methods = setOf(Method.ADD_SOURCE, Method.REMOVE_SOURCE, Method.SET_GEO_JSON_SOURCE_DATA,
            Method.UPDATE_GEO_JSON_SOURCE, Method.ADD_LAYER, Method.UPDATE_LAYER, Method.MOVE_LAYER, Method.REMOVE_LAYER,
            Method.SET_FEATURE_STATE, Method.GET_FEATURE_STATE, Method.REMOVE_FEATURE_STATE, Method.SET_IMAGES,
            Method.QUERY_RENDERED_FEATURES, Method.QUERY_SOURCE_FEATURES, Method.QUERY_CLUSTER)
    }
}
