package dev.tileflow.sdk.engine

import android.view.View
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.model.MapPayloadStore
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

/** What an engine reports to the view that owns it. Every callback runs on the main thread. */
internal class MapEngineCallbacks(
    /** The engine takes `initialize` now. */
    val ready: (MapEngine) -> Unit,
    /** An event in the SDK's event vocabulary, such as `contentReady` or `cameraMoveEnded`. */
    val event: (String, JSONObject) -> Unit,
    /** The engine, or a resource it needs, failed; the view decides whether to report it now. */
    val failed: (TileflowMapException) -> Unit,
    /**
     * The engine could not start drawing. The view retires it and reports the failure at once.
     */
    val loadFailed: (MapEngine, TileflowMapException) -> Unit,
    /** A person activated a link the map shows. */
    val externalLink: (URI) -> Unit,
    /**
     * The renderer lost its graphics context. The view decides how to recover.
     */
    val rendererGone: (MapEngine, MapContract.ErrorReason) -> Unit,
)

/**
 * What draws one generation of a map. The view owns everything the application asked for and
 * gives it again to each engine it creates; an engine only draws, answers requests and reports
 * events. A replaced or destroyed map retires its engine and never reuses it.
 *
 */
internal interface MapEngine {
    /** Updates only the pins if this engine can do so independently of scene overlays. */
    suspend fun updateContentAnnotations(annotations: JSONArray): Boolean = false

    /** The view that shows the map, placed under the annotation overlay and the controls. */
    val view: View

    /**
     * Payloads that requests refer to, such as GeoJSON and images. A request releases its own
     * when it ends; retiring the engine releases the rest.
     */
    val data: MapPayloadStore

    /** Native renderers can project all tracked points synchronously at Android draw time. */
    val annotationProjection: AnnotationProjection?
        get() = null

    /** Starts loading. [MapEngineCallbacks.ready] follows once the engine takes `initialize`. */
    fun start()

    /**
     * Sends one command and returns its result: a [JSONObject], a [org.json.JSONArray], a
     * primitive or [JSONObject.NULL]. Cancelling the calling coroutine cancels the command.
     */
    suspend fun call(
        method: MapContract.Method,
        payload: Any = JSONObject.NULL,
        references: List<MapPayloadStore.Reference> = emptyList(),
    ): Any

    /** Whether the map is on screen; a hidden engine stops drawing. */
    fun setVisible(visible: Boolean)

    /**
     * The host's lifecycle: whether its activity or fragment is started and resumed. An engine
     * that draws in a native view forwards it to that view.
     */
    fun hostLifecycle(started: Boolean, resumed: Boolean) {}

    /** The system is low on memory; the engine releases what it can. */
    fun lowMemory() {}

    /** Pending calls fail with [code]: cancelled when replaced, disposed when destroyed. */
    fun retire(code: TileflowErrorCode)
}
