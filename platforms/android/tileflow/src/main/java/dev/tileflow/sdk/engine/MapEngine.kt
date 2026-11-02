package dev.tileflow.sdk.engine

import android.view.View
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.ProtocolContract
import java.net.URI
import org.json.JSONObject

/** Which engine draws a map. Internal: applications always get the default. */
internal enum class MapEngineKind {
    /** The embedded web runtime in a system WebView. */
    WEB_VIEW,
    /** MapLibre Native. */
    NATIVE,
}

/** What an engine reports to the view that owns it. Every callback runs on the main thread. */
internal class MapEngineCallbacks(
    /** The engine takes `initialize` now. */
    val ready: (MapEngine) -> Unit,
    /** An event in the SDK's event vocabulary, such as `contentReady` or `cameraMoveEnded`. */
    val event: (String, JSONObject) -> Unit,
    /** The engine, or a resource it needs, failed; the view decides whether to report it now. */
    val failed: (TileflowMapException) -> Unit,
    /**
     * The engine could not start drawing at all, for example because its embedded resources did
     * not verify. The view retires it and reports the failure at once.
     */
    val loadFailed: (MapEngine, TileflowMapException) -> Unit,
    /** A person activated a link the map shows. */
    val externalLink: (URI) -> Unit,
    /** The system ended the engine's renderer process; the view decides how to recover. */
    val rendererGone: (MapEngine) -> Unit,
)

/**
 * What draws one generation of a map. The view owns everything the application asked for and
 * gives it again to each engine it creates; an engine only draws, answers requests and reports
 * events. A replaced or destroyed map retires its engine and never reuses it.
 *
 * Requests use the map command vocabulary, [ProtocolContract.Method], with the JSON payloads the
 * view already validated, so every engine reads the same request and the same results. The
 * commands fall into these areas:
 *
 * | Area | Commands |
 * | --- | --- |
 * | Load | `initialize`, `dispose`, `cancel`, `readResult` |
 * | Theme | `setTheme`, `setBlend` |
 * | Options and events | `setOptions`, `setEvents`, `setInsets`, `setVisibility` |
 * | Camera | `moveCamera`, `stopCamera`, `getCamera`, `cameraForBounds`, `visibleBounds`, `project`, `unproject` |
 * | Content | `setContent`, `queryAtPoint` |
 * | Scene | `setViewMode`, `setSun`, `setEmphasis`, `setStyleState`, `getRouteInks`, `setBoundaryValues`, `setImages`, `setDepthMarkers`, `animateLineProgress`, `playShot`, `stopAnimation` |
 * | Style | `addSource`, `removeSource`, `setGeoJSONSourceData`, `updateGeoJSONSource`, `addLayer`, `updateLayer`, `moveLayer`, `removeLayer`, `setFeatureState`, `getFeatureState`, `removeFeatureState`, `queryRenderedFeatures`, `querySourceFeatures`, `queryCluster` |
 * | Location | `updateLocation`, `setFollowMode` |
 * | Annotations | `setAnnotationLayers`, `setTrackedPoints` |
 *
 * [MapEngineArea] names each command's area.
 */
internal interface MapEngine {
    /** The view that shows the map, placed under the annotation overlay and the controls. */
    val view: View

    /**
     * Payloads that requests refer to, such as GeoJSON and images. A request releases its own
     * when it ends; retiring the engine releases the rest.
     */
    val data: DataChannel

    /** Starts loading. [MapEngineCallbacks.ready] follows once the engine takes `initialize`. */
    fun start()

    /**
     * Sends one command and returns its result: a [JSONObject], a [org.json.JSONArray], a
     * primitive or [JSONObject.NULL]. Cancelling the calling coroutine cancels the command.
     */
    suspend fun call(
        method: ProtocolContract.Method,
        payload: Any = JSONObject.NULL,
        references: List<DataChannel.Reference> = emptyList(),
    ): Any

    /** Whether the map is on screen; a hidden engine stops drawing. */
    fun setVisible(visible: Boolean)

    /** Pending calls fail with [code]: cancelled when replaced, disposed when destroyed. */
    fun retire(code: TileflowErrorCode)
}

/** The areas of the map command vocabulary, so each engine can say what it supports. */
internal enum class MapEngineArea {
    LOAD,
    THEME,
    OPTIONS,
    CAMERA,
    CONTENT,
    SCENE,
    STYLE,
    LOCATION,
    ANNOTATIONS;

    companion object {
        fun of(method: ProtocolContract.Method): MapEngineArea =
            when (method) {
                ProtocolContract.Method.INITIALIZE,
                ProtocolContract.Method.CANCEL,
                ProtocolContract.Method.READ_RESULT,
                ProtocolContract.Method.DISPOSE -> LOAD
                ProtocolContract.Method.SET_THEME,
                ProtocolContract.Method.SET_BLEND -> THEME
                ProtocolContract.Method.SET_EVENTS,
                ProtocolContract.Method.SET_OPTIONS,
                ProtocolContract.Method.SET_INSETS,
                ProtocolContract.Method.SET_VISIBILITY -> OPTIONS
                ProtocolContract.Method.MOVE_CAMERA,
                ProtocolContract.Method.STOP_CAMERA,
                ProtocolContract.Method.GET_CAMERA,
                ProtocolContract.Method.CAMERA_FOR_BOUNDS,
                ProtocolContract.Method.VISIBLE_BOUNDS,
                ProtocolContract.Method.PROJECT,
                ProtocolContract.Method.UNPROJECT -> CAMERA
                ProtocolContract.Method.SET_CONTENT,
                ProtocolContract.Method.QUERY_AT_POINT -> CONTENT
                ProtocolContract.Method.SET_VIEW_MODE,
                ProtocolContract.Method.SET_SUN,
                ProtocolContract.Method.SET_EMPHASIS,
                ProtocolContract.Method.SET_STYLE_STATE,
                ProtocolContract.Method.GET_ROUTE_INKS,
                ProtocolContract.Method.SET_BOUNDARY_VALUES,
                ProtocolContract.Method.SET_IMAGES,
                ProtocolContract.Method.SET_DEPTH_MARKERS,
                ProtocolContract.Method.ANIMATE_LINE_PROGRESS,
                ProtocolContract.Method.PLAY_SHOT,
                ProtocolContract.Method.STOP_ANIMATION -> SCENE
                ProtocolContract.Method.ADD_SOURCE,
                ProtocolContract.Method.REMOVE_SOURCE,
                ProtocolContract.Method.SET_GEO_JSON_SOURCE_DATA,
                ProtocolContract.Method.UPDATE_GEO_JSON_SOURCE,
                ProtocolContract.Method.ADD_LAYER,
                ProtocolContract.Method.UPDATE_LAYER,
                ProtocolContract.Method.MOVE_LAYER,
                ProtocolContract.Method.REMOVE_LAYER,
                ProtocolContract.Method.SET_FEATURE_STATE,
                ProtocolContract.Method.GET_FEATURE_STATE,
                ProtocolContract.Method.REMOVE_FEATURE_STATE,
                ProtocolContract.Method.QUERY_RENDERED_FEATURES,
                ProtocolContract.Method.QUERY_SOURCE_FEATURES,
                ProtocolContract.Method.QUERY_CLUSTER -> STYLE
                ProtocolContract.Method.UPDATE_LOCATION,
                ProtocolContract.Method.SET_FOLLOW_MODE -> LOCATION
                ProtocolContract.Method.SET_ANNOTATION_LAYERS,
                ProtocolContract.Method.SET_TRACKED_POINTS -> ANNOTATIONS
            }
    }
}
