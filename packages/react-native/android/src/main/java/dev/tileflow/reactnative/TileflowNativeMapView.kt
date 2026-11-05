package dev.tileflow.reactnative

import android.view.View
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.events.Event
import dev.tileflow.reactnative.map.MapValues
import dev.tileflow.reactnative.map.MountedMapEndpoint
import dev.tileflow.reactnative.map.NativeMapRegistry
import dev.tileflow.sdk.TileflowMapView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject

/** Fabric owns the outer view; the SDK owns its renderer and the anchored children. */
internal class TileflowNativeMapView(
    private val reactContext: ThemedReactContext,
    private val registry: NativeMapRegistry,
    private val makeSession: (TileflowMapView, (String, JSONObject) -> Unit) -> MountedMapEndpoint,
) : FrameLayout(reactContext), LifecycleEventListener {
    var instanceId = ""
    var sourceJson = ""
    var appearanceJson = "{}"
    var optionsJson = "{}"

    private data class Properties(val source: String, val appearance: String, val options: String)

    private var mountedId: String? = null
    private var mountedSource: String? = null
    private var session: MountedMapEndpoint? = null
    private var pending: Properties? = null
    private var applied: Properties? = null
    private var applying: Job? = null
    private var disposed = false
    private val reactChildren = mutableListOf<View>()

    init {
        reactContext.addLifecycleEventListener(this)
    }

    fun commitProperties() {
        if (disposed) return
        if (instanceId.isBlank() || sourceJson.isBlank()) {
            retireSession()
            return
        }
        if (mountedId != instanceId || mountedSource != sourceJson) retireSession()
        val properties = Properties(sourceJson, appearanceJson, optionsJson)
        if (properties == applied && pending == null) return
        pending = properties

        if (session == null) {
            val identity = instanceId
            val sdk = TileflowMapView(context)
            val next =
                makeSession(sdk) { type, payload ->
                    if (!disposed && mountedId == identity && session?.map === sdk)
                        emit(type, payload)
                }
            session = next
            mountedId = identity
            mountedSource = sourceJson
            registry.bind(id, identity, next)
        }
        if (applying != null) return
        val current = session ?: return
        applying =
            current.scope.launch {
                try {
                    while (session === current) {
                        val next = pending ?: break
                        pending = null
                        try {
                            current.applyProperties(next.source, next.appearance, next.options)
                            if (session !== current) return@launch
                            applied = next
                            attachMap(current.map)
                            reactChildren
                                .filterIsInstance<TileflowNativeMarkerView>()
                                .forEach(::syncMarker)
                        } catch (error: CancellationException) {
                            throw error
                        } catch (error: Throwable) {
                            if (session === current) emit("failed", MapValues.failure(error))
                        }
                    }
                } finally {
                    if (session === current) applying = null
                }
            }
        if (applying?.isCompleted == true) applying = null
    }

    private fun attachMap(map: TileflowMapView) {
        if (map.parent != null) return
        super.addView(map, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        map.layout(0, 0, width, height)
    }

    fun addReactChild(child: View, index: Int) {
        reactChildren.add(index, child)
        if (child is TileflowNativeMarkerView) {
            child.owner = this
            syncMarker(child)
        } else super.addView(child)
    }

    fun reactChildCount(): Int = reactChildren.size

    fun reactChild(index: Int): View = reactChildren[index]

    fun removeReactChild(index: Int) {
        val child = reactChildren.removeAt(index)
        if (child is TileflowNativeMarkerView) {
            session?.map?.viewAnnotationManager?.removeViewAnnotation(child)
            child.owner = null
        } else super.removeView(child)
    }

    fun syncMarker(marker: TileflowNativeMarkerView) {
        val current = session ?: return
        if (marker.instanceId != mountedId || marker.optionsJson.isBlank()) {
            current.map.viewAnnotationManager.removeViewAnnotation(marker)
            return
        }
        try {
            val options =
                MapValues.marker(
                        JSONObject(marker.optionsJson),
                        resources.displayMetrics.density,
                        marker.measuredWidth,
                        marker.measuredHeight,
                    )
                    .copy(
                        width = marker.measuredWidth.toFloat(),
                        height = marker.measuredHeight.toFloat(),
                    )
            val manager = current.map.viewAnnotationManager
            if (!manager.updateViewAnnotation(marker, options))
                manager.addViewAnnotation(marker, options)
        } catch (error: Throwable) {
            emit("failed", MapValues.failure(error))
        }
    }

    private fun emit(type: String, payload: JSONObject) {
        val identity = mountedId ?: return
        UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
            ?.dispatchEvent(
                MapEvent(UIManagerHelper.getSurfaceId(this), id, identity, type, payload.toString())
            )
    }

    private fun retireSession() {
        val old = session
        val identity = mountedId
        session = null
        mountedId = null
        mountedSource = null
        pending = null
        applied = null
        applying?.cancel()
        applying = null
        if (old != null && identity != null) {
            old.map.viewAnnotationManager.removeAllViewAnnotations()
            registry.unbind(id, identity, old)
            super.removeView(old.map)
        }
    }

    fun dispose() {
        if (disposed) return
        disposed = true
        retireSession()
        reactChildren.filterIsInstance<TileflowNativeMarkerView>().forEach { it.owner = null }
        reactContext.removeLifecycleEventListener(this)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        session?.map?.layout(0, 0, right - left, bottom - top)
    }

    override fun onHostResume() = Unit

    override fun onHostPause() = Unit

    override fun onHostDestroy() = dispose()
}

private class MapEvent(
    surface: Int,
    tag: Int,
    private val identity: String,
    private val type: String,
    private val payload: String,
) : Event<MapEvent>(surface, tag) {
    override fun getEventName(): String = "topMapEvent"

    override fun canCoalesce(): Boolean = false

    override fun getEventData(): WritableMap =
        Arguments.createMap().apply {
            putString("instanceId", identity)
            putString("type", type)
            putString("payload", payload)
        }
}
