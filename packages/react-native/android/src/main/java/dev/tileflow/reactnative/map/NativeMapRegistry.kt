package dev.tileflow.reactnative.map

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowMapView
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import org.json.JSONObject

/** One mounted instance owns the SDK view and every operation using it. */
internal interface NativeMapEndpoint {
    val scope: CoroutineScope
    suspend fun call(method: String, payload: JSONObject): Any
    fun destroy()
}

internal interface MountedMapEndpoint : NativeMapEndpoint {
    val map: TileflowMapView
    suspend fun applyProperties(sourceJson: String, appearanceJson: String, optionsJson: String)
}

/** Accessed on the main thread, including after suspended SDK calls. */
internal class NativeMapRegistry {
    private class Entry(val instanceId: String, val endpoint: NativeMapEndpoint)
    private val views = mutableMapOf<Int, Entry>()

    fun bind(tag: Int, instanceId: String, endpoint: NativeMapEndpoint) {
        require(tag > 0 && instanceId.isNotBlank())
        val old = views[tag]
        if (old?.instanceId == instanceId && old.endpoint === endpoint) return
        views[tag] = Entry(instanceId, endpoint)
        old?.endpoint?.let { it.scope.cancel(); it.destroy() }
    }

    fun unbind(tag: Int, instanceId: String, endpoint: NativeMapEndpoint) {
        val current = views[tag] ?: return
        if (current.instanceId != instanceId || current.endpoint !== endpoint) return
        views.remove(tag)
        endpoint.scope.cancel()
        endpoint.destroy()
    }

    fun clear() {
        val old = views.values.toList()
        views.clear()
        old.forEach { it.endpoint.scope.cancel(); it.endpoint.destroy() }
    }

    suspend fun call(tag: Int, instanceId: String, method: String, payload: JSONObject): Any {
        val entry = views[tag] ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        if (entry.instanceId != instanceId) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val operation = entry.endpoint.scope.async { entry.endpoint.call(method, payload) }
        try {
            val result = operation.await()
            if (views[tag] !== entry) throw TileflowMapException(TileflowErrorCode.DISPOSED)
            return result
        } finally {
            operation.cancel()
        }
    }
}
