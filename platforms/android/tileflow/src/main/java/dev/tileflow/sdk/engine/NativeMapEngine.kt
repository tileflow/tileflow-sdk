package dev.tileflow.sdk.engine

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.transport.ResourceLoader
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style

/**
 * Draws a map with MapLibre Native. The engine always gives MapLibre a style document, never a
 * style URL, so MapLibre requests nothing on its own; it starts with an empty style.
 *
 * Commands this engine does not draw yet fail with [TileflowErrorCode.INVALID_REQUEST].
 */
internal class NativeMapEngine(
    context: Context,
    /** The generation's resource owner; the engine closes it when it retires. */
    private val loader: ResourceLoader,
    private val callbacks: MapEngineCallbacks,
) : MapEngine {
    private val mapView: MapView
    private var map: MapLibreMap? = null
    private val main = Handler(Looper.getMainLooper())
    private var started = false
    private var shown = false
    private var retired = false
    /** Whether MapLibre finished loading the current style and its resources. */
    private var loaded = false
    /** Whether the view initialized this engine and waits for its content. */
    private var awaitingContent = false

    override val view: MapView
        get() = mapView

    override val data: DataChannel = DataChannel()

    init {
        MapLibre.getInstance(context.applicationContext)
        mapView = MapView(context)
        mapView.onCreate(null)
        mapView.addOnDidFinishLoadingMapListener {
            if (retired) return@addOnDidFinishLoadingMapListener
            loaded = true
            reportContentReady()
        }
        mapView.addOnWillStartLoadingMapListener { loaded = false }
    }

    override fun start() {
        if (started || retired) return
        started = true
        setVisible(true)
        mapView.getMapAsync { ready ->
            if (retired) return@getMapAsync
            map = ready
            ready.uiSettings.isLogoEnabled = false
            ready.uiSettings.isAttributionEnabled = false
            ready.setStyle(Style.Builder().fromJson(EMPTY_STYLE)) {
                if (!retired) callbacks.ready(this)
            }
        }
    }

    override suspend fun call(
        method: ProtocolContract.Method,
        payload: Any,
        references: List<DataChannel.Reference>,
    ): Any {
        try {
            if (retired) throw TileflowMapException(TileflowErrorCode.DISPOSED)
            val map = map ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
            return when (method) {
                ProtocolContract.Method.INITIALIZE -> {
                    (payload as? JSONObject)?.optJSONObject("camera")?.let { move(map, it) }
                    awaitingContent = true
                    // The view finishes initializing before it reports the content.
                    main.post { reportContentReady() }
                    JSONObject.NULL
                }
                ProtocolContract.Method.GET_CAMERA -> camera(map)
                ProtocolContract.Method.SET_VISIBILITY,
                ProtocolContract.Method.SET_INSETS,
                ProtocolContract.Method.SET_EVENTS,
                ProtocolContract.Method.SET_OPTIONS -> JSONObject.NULL
                ProtocolContract.Method.SET_CONTENT ->
                    if (isEmpty(payload, "annotations", "overlays")) JSONObject.NULL
                    else unsupported(method)
                // The view always tells a new engine its annotation layers and tracked points.
                ProtocolContract.Method.SET_ANNOTATION_LAYERS ->
                    if (isEmpty(payload, "layers")) JSONObject.NULL else unsupported(method)
                ProtocolContract.Method.SET_TRACKED_POINTS ->
                    if (isEmpty(payload, "points")) JSONObject.NULL else unsupported(method)
                else -> unsupported(method)
            }
        } finally {
            data.release(references)
        }
    }

    override fun setVisible(visible: Boolean) {
        if (retired || visible == shown) return
        shown = visible
        if (visible) {
            mapView.onStart()
            mapView.onResume()
        } else {
            mapView.onPause()
            mapView.onStop()
        }
    }

    override fun retire(code: TileflowErrorCode) {
        if (retired) return
        setVisible(false)
        retired = true
        awaitingContent = false
        main.removeCallbacksAndMessages(null)
        data.retire()
        loader.close()
        (mapView.parent as? ViewGroup)?.removeView(mapView)
        mapView.onDestroy()
        map = null
    }

    private fun reportContentReady() {
        val map = map ?: return
        if (retired || !awaitingContent || !loaded) return
        awaitingContent = false
        callbacks.event("contentReady", JSONObject().put("camera", camera(map)))
    }

    private fun move(map: MapLibreMap, camera: JSONObject) {
        map.moveCamera(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder()
                    .target(LatLng(camera.getDouble("latitude"), camera.getDouble("longitude")))
                    .zoom(camera.getDouble("zoom"))
                    .bearing(camera.optDouble("bearing", 0.0))
                    .tilt(camera.optDouble("pitch", 0.0))
                    .build()
            )
        )
    }

    private fun camera(map: MapLibreMap): JSONObject {
        val position = map.cameraPosition
        val target = position.target ?: LatLng(0.0, 0.0)
        return JSONObject()
            .put("longitude", target.longitude)
            .put("latitude", target.latitude)
            .put("zoom", position.zoom)
            .put("bearing", normalizedBearing(position.bearing))
            .put("pitch", position.tilt)
    }

    /** Whether every list [keys] names in the request is empty or absent. */
    private fun isEmpty(payload: Any, vararg keys: String): Boolean {
        val request = payload as? JSONObject ?: return false
        return keys.all { (request.optJSONArray(it) ?: JSONArray()).length() == 0 }
    }

    private fun unsupported(method: ProtocolContract.Method): Nothing =
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext(
                message = "The native map engine does not support ${method.wireName} yet."
            ),
        )

    private companion object {
        const val EMPTY_STYLE = """{"version":8,"sources":{},"layers":[]}"""

        /** MapLibre reports bearings in [0, 360); the SDK's cameras use (-180, 180]. */
        fun normalizedBearing(bearing: Double): Double = if (bearing > 180) bearing - 360 else bearing
    }
}
