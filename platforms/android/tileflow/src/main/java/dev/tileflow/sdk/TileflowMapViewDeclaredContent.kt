package dev.tileflow.sdk

import dev.tileflow.sdk.bridge.ProtocolContract
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

private typealias UndoContentEdit = suspend () -> Unit

/** A declared revision shares one turn with imperative edits and style replay. */
internal suspend fun TileflowMapView.applyDeclaredContent(
    prior: DeclaredMapContent,
    next: DeclaredMapContent,
    options: TileflowMapOptions?,
): Unit =
    styleEdits.withLock {
        if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        options?.validate()
        val originalEngine = styleEngine
        val needsStyle = !next.empty || !prior.empty
        if (needsStyle && originalEngine == null)
            throw TileflowMapException(TileflowErrorCode.CANCELLED)
        val before = runtimeStyle.copy()
        val beforeMarkers = content.annotations
        val beforeOptions = this.options
        val dropped =
            prior.sources.keys.filterTo(mutableSetOf()) { key ->
                prior.sources.getValue(key).spec.toString() != next.sources[key]?.spec?.toString()
            }
        validateOwners(prior, next, dropped)
        val undo = mutableListOf<UndoContentEdit>()
        try {
            for (layer in before.layers.asReversed()) {
                if (
                    layer.id !in prior.layers ||
                        (layer.id in next.layers && layer.json.optString("source") !in dropped)
                )
                    continue
                deleteStyleLayer(layer.id)
                undo += { insertStyleLayer(layer, previousPosition(layer.id, before.layers)) }
            }
            for (source in before.sources.filter { it.id in dropped }) {
                deleteStyleSource(source.id)
                undo += { restoreSource(source, before) }
            }
            for ((id, source) in next.sources) {
                if (!sourceExists(id)) {
                    insertStyleSource(RuntimeStyle.Source(id, source.spec, source.geoJSON?.copy()))
                    undo += { deleteStyleSource(id) }
                } else if (!sameBase(source.geoJSON?.base, prior.sources[id]?.geoJSON?.base)) {
                    val original = before.sources.first { it.id == id }.geoJSON!!
                    replaceStyleData(id, source.geoJSON!!.base)
                    undo += {
                        replaceStyleData(id, original.base)
                        styleEngine?.let { engine ->
                            original.updates.forEach { engine.sendUpdate(it, id) }
                        }
                    }
                }
            }
            for ((id, layer) in next.layers) {
                val previous = prior.layers[id]
                if (!layerExists(id)) {
                    insertStyleLayer(layer, TileflowLayerPosition.Default)
                    undo += { deleteStyleLayer(id) }
                } else if (
                    previous != null &&
                        (previous.slot != layer.slot ||
                            previous.json.toString() != layer.json.toString())
                ) {
                    val original = before.layers.first { it.id == id }
                    replaceStyleLayer(layer)
                    undo += { replaceStyleLayer(original) }
                }
            }
            reconcileDeclaredOrder(next, undo)
            if (prior.markers != next.markers) {
                val oldIds = prior.markers.map { it.id }.toSet()
                val markers = content.annotations.filter { it.id !in oldIds } + next.markers
                replaceContent(content.copy(annotations = markers), markersOnly = true)
                undo += {
                    replaceContent(content.copy(annotations = beforeMarkers), markersOnly = true)
                }
            }
            if (needsStyle && styleEngine !== originalEngine)
                throw TileflowMapException(TileflowErrorCode.CANCELLED)
            if (options != null && this.options != options) {
                undo += { replaceOptions(beforeOptions) }
                replaceOptions(options)
            }
        } catch (error: Exception) {
            val restored =
                if (styleEngine !== originalEngine) true
                else
                    withContext(NonCancellable) {
                        runCatching { undo.asReversed().forEach { it() } }.isSuccess
                    }
            runtimeStyle.restore(before)
            content = content.copy(annotations = beforeMarkers)
            if (!restored && !isDestroyed && styleEngine === originalEngine) reload()
            throw error
        }
    }

private fun TileflowMapView.validateOwners(
    prior: DeclaredMapContent,
    next: DeclaredMapContent,
    dropped: Set<String>,
) {
    val markers = content.annotations.map { it.id }.toSet() - prior.markers.map { it.id }.toSet()
    if (
        (next.sources.keys - prior.sources.keys).any(::sourceExists) ||
            (next.layers.keys - prior.layers.keys).any(::layerExists) ||
            next.markers.any { it.id in markers } ||
            runtimeStyle.layers.any {
                it.id !in prior.layers && it.json.optString("source") in dropped
            }
    ) {
        throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
    }
    val available = runtimeStyle.sources.map { it.id }.toSet() - dropped + next.sources.keys
    if (
        next.layers.values.any {
            it.json.has("source") && it.json.getString("source") !in available
        }
    ) {
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(ProtocolContract.ErrorReason.UNKNOWN_SOURCE),
        )
    }
}

private fun TileflowMapView.previousPosition(
    id: String,
    order: List<RuntimeStyle.Layer>,
): TileflowLayerPosition {
    val index = order.indexOfFirst { it.id == id }
    val next =
        order.drop(index + 1).firstOrNull { it.slot == order[index].slot && layerExists(it.id) }
    return next?.let { TileflowLayerPosition.Below(it.id) } ?: TileflowLayerPosition.Default
}

/**
 * Keeping the longest ordered subsequence avoids moving unchanged layers past imperative
 * neighbours.
 */
private suspend fun TileflowMapView.reconcileDeclaredOrder(
    next: DeclaredMapContent,
    undo: MutableList<UndoContentEdit>,
) {
    for ((slot, layers) in next.layers.values.groupBy { it.slot }) {
        val wanted = layers.map { it.id }
        val current =
            runtimeStyle.layers.filter { it.id in next.layers && it.slot == slot }.map { it.id }
        if (current == wanted) continue
        val stable = orderedSubsequence(current, wanted)
        for (i in wanted.indices.reversed()) {
            val id = wanted[i]
            if (id in stable) continue
            val position =
                wanted.getOrNull(i + 1)?.let { TileflowLayerPosition.Below(it) }
                    ?: TileflowLayerPosition.Default
            val previous = runtimeStyle.layers.toList()
            positionStyleLayer(id, position)
            undo += { positionStyleLayer(id, previousPosition(id, previous)) }
        }
    }
}

private fun orderedSubsequence(current: List<String>, wanted: List<String>): Set<String> {
    val rank = wanted.withIndex().associate { (index, id) -> id to index }
    val tails = mutableListOf<Int>()
    val predecessor = IntArray(current.size) { -1 }
    for ((i, id) in current.withIndex()) {
        val order = rank.getValue(id)
        val found = tails.binarySearchBy(order) { rank.getValue(current[it]) }
        val place = if (found >= 0) found else -found - 1
        if (place > 0) predecessor[i] = tails[place - 1]
        if (place == tails.size) tails += i else tails[place] = i
    }
    var last = tails.lastOrNull() ?: -1
    return buildSet {
        while (last >= 0) {
            add(current[last])
            last = predecessor[last]
        }
    }
}

private suspend fun TileflowMapView.restoreSource(
    source: RuntimeStyle.Source,
    before: RuntimeStyle,
) {
    insertStyleSource(source)
    val engine = styleEngine ?: return
    source.geoJSON?.updates?.forEach { engine.sendUpdate(it, source.id) }
    for ((key, features) in before.states) {
        val (id, layer) = key.split("\n", limit = 2)
        if (id != source.id) continue
        for ((feature, state) in features) {
            if (state.isEmpty()) continue
            val wire =
                JSONObject().apply {
                    state.forEach { (name, value) -> put(name, TileflowStyleValue.json(value)) }
                }
            engine.call(
                ProtocolContract.Method.SET_FEATURE_STATE,
                featureTarget(id, layer.ifEmpty { null }, feature).put("state", wire),
            )
        }
    }
}
