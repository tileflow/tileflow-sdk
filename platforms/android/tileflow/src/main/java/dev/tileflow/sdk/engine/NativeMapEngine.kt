package dev.tileflow.sdk.engine

import android.content.Context
import android.graphics.PointF
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.attribution.MapAttribution
import dev.tileflow.sdk.attribution.MapAttributionEntry
import dev.tileflow.sdk.attribution.MapCredit
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.offline.OfflineReachability
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineServingRule
import dev.tileflow.sdk.transport.MapResourceContexts
import dev.tileflow.sdk.transport.MapResourceOutcome
import dev.tileflow.sdk.transport.MapResourceRoute
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.TileflowHttpClient
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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
 * Draws a map with MapLibre Native.
 *
 * MapLibre never receives a style URL. The engine reads the map's manifest and its theme's style
 * through the generation's [ResourceLoader], projects the style ([NativeStyleDocument]) so that
 * every address MapLibre requests is a transport address of this map, and gives MapLibre the
 * document. MapLibre's requests then come back to the same loader ([MapResourceContexts]), with
 * its credentials, Hosted session, cache and downloaded regions. Until the map initializes,
 * MapLibre has no style and requests nothing.
 *
 * Commands this engine does not draw yet fail with [TileflowErrorCode.INVALID_REQUEST].
 */
internal class NativeMapEngine(
    context: Context,
    /** The generation's resource owner; the engine closes it when it retires. */
    private val loader: ResourceLoader,
    /** The cache scope of a Hosted map's protected resources, or null for a self-hosted map. */
    private val grantScope: ResourceCacheScope?,
    private val callbacks: MapEngineCallbacks,
) : MapEngine {
    private val application: Context = context.applicationContext ?: context
    private val mapView: MapView
    private var map: MapLibreMap? = null
    private val main = Handler(Looper.getMainLooper())
    private val density = context.resources.displayMetrics.density
    private var started = false
    private var shown = false
    private var retired = false
    private var retiredCode = TileflowErrorCode.DISPOSED
    private var connected = false
    /** The context of this map's transport addresses, while its route is registered. */
    private var resourceContext: String? = null
    /** The style MapLibre draws, once the map initialized. */
    @Volatile private var projection: NativeStyleProjection? = null
    /** Whether MapLibre finished loading the current style and its resources. */
    private var loaded = false
    /** Whether MapLibre loaded the map's style. */
    private var contentStyleLoaded = false
    /** Whether the view initialized this engine and waits for its content. */
    private var awaitingContent = false
    private var attributionModel = MapAttribution()
    /** The theme the map initialized with, as the view asked for it. */
    private var initialTheme: String? = null
    private val warnings =
        MapWarnings(
            report = { warning -> if (!retired) callbacks.event("warning", warning) },
            schedule = { delay, block -> main.postDelayed(block, delay) },
        )

    /** What the map's attribution shows for the current view; empty before the content is ready. */
    internal var attribution: List<MapAttributionEntry> = emptyList()
        private set

    override val view: MapView
        get() = mapView

    override val data: DataChannel = DataChannel()

    init {
        MapLibre.getInstance(application)
        mapView = MapView(context)
        mapView.onCreate(null)
        mapView.addOnWillStartLoadingMapListener { loaded = false }
        mapView.addOnDidFinishLoadingMapListener {
            if (retired) return@addOnDidFinishLoadingMapListener
            loaded = true
            reportContentReady()
        }
        // A fully rendered map also means its style and the resources in view have loaded.
        mapView.addOnDidFinishRenderingMapListener { fully ->
            if (retired || !fully) return@addOnDidFinishRenderingMapListener
            loaded = true
            reportContentReady()
        }
        mapView.addOnDidFailLoadingMapListener { message ->
            if (retired || !awaitingContent) return@addOnDidFailLoadingMapListener
            awaitingContent = false
            callbacks.failed(
                TileflowMapException(
                    TileflowErrorCode.RESOURCE_FAILED,
                    TileflowErrorContext(resource = TileflowResourceKind.STYLE, message = message),
                )
            )
        }
    }

    override fun start() {
        if (started || retired) return
        started = true
        setVisible(true)
        resourceContext =
            MapResourceContexts.register(
                MapResourceRoute(
                    loader,
                    classify = { projection?.classify(it) ?: TileflowResourceKind.OTHER },
                    report = { outcome -> main.post { received(outcome) } },
                )
            )
        // Every style the engine sets waits for the network configuration and the cache setting.
        MapResourceContexts.install(application) { error ->
            if (retired) return@install
            if (error != null) {
                callbacks.loadFailed(
                    this,
                    TileflowMapException(
                        TileflowErrorCode.RENDERER_FAILED,
                        TileflowErrorContext(message = error.message),
                    ),
                )
                return@install
            }
            MapResourceContexts.acquire()
            connected = true
            mapView.getMapAsync { ready ->
                if (retired) return@getMapAsync
                map = ready
                ready.uiSettings.isLogoEnabled = false
                ready.uiSettings.isAttributionEnabled = false
                ready.addOnCameraIdleListener { updateAttribution() }
                // No style until the map initializes: MapLibre draws and requests nothing, and its
                // first load is the map's own style.
                callbacks.ready(this)
            }
        }
    }

    override suspend fun call(
        method: ProtocolContract.Method,
        payload: Any,
        references: List<DataChannel.Reference>,
    ): Any {
        try {
            if (retired) throw TileflowMapException(retiredCode)
            val map = map ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
            val request = payload as? JSONObject
            return when (method) {
                ProtocolContract.Method.INITIALIZE -> initialize(map, request ?: invalid())
                ProtocolContract.Method.GET_CAMERA -> camera(map)
                ProtocolContract.Method.PROJECT -> {
                    val request = request ?: invalid()
                    val point =
                        map.projection.toScreenLocation(
                            LatLng(request.getDouble("latitude"), request.getDouble("longitude"))
                        )
                    JSONObject().put("x", point.x / density).put("y", point.y / density)
                }
                ProtocolContract.Method.UNPROJECT -> {
                    val coordinate = map.projection.fromScreenLocation(point(request)).wrap()
                    JSONObject()
                        .put("longitude", coordinate.longitude)
                        .put("latitude", coordinate.latitude)
                }
                ProtocolContract.Method.QUERY_AT_POINT -> query(map, point(request))
                ProtocolContract.Method.SET_INSETS -> {
                    pad(map, request ?: invalid())
                    JSONObject.NULL
                }
                ProtocolContract.Method.SET_VISIBILITY,
                ProtocolContract.Method.SET_EVENTS,
                ProtocolContract.Method.SET_OPTIONS -> JSONObject.NULL
                // A theme the application chose before the map loaded is the one it loaded with.
                ProtocolContract.Method.SET_THEME ->
                    if (request != null && themeRequest(request) == initialTheme) JSONObject.NULL
                    else unsupported(method)
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

    /** Reads the map, projects its style and gives it to MapLibre. */
    private suspend fun initialize(map: MapLibreMap, options: JSONObject): Any {
        val context = resourceContext ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val source = options.getJSONObject("source")
        val theme = themeRequest(options)
        val colorScheme = options.optString("colorScheme", "light")
        val credits = MapCredit.list(options.optJSONArray("credits"))
        // A Hosted map without a usable network opens from its downloaded regions.
        val packScope =
            grantScope?.takeIf {
                OfflineServingRule.hostedUsesPacks(
                    TileflowHttpClient.networkEnabled,
                    OfflineReachability.isReachable(application),
                )
            }
        val (document, projected) =
            withContext(Dispatchers.IO) {
                val load = { url: URI ->
                    val payload = loader.load(url)
                    if (payload.status != 200) throw NativeResourceStatus(payload.status)
                    payload.bytes
                }
                val document = NativeManifest.resolve(source, theme, colorScheme, load)
                val style =
                    NativeManifest.document(document.styleUrl, load, TileflowResourceKind.STYLE)
                val stored: ((String) -> IntRange?)? =
                    packScope?.let { scope ->
                        val index = OfflineServingIndex.shared(application)
                        val lookup: (String) -> IntRange? = { index.storedZooms(scope, it) }
                        lookup
                    }
                document to
                    NativeStyleDocument.project(style, document.styleUrl, context, load, stored)
            }
        if (retired) throw TileflowMapException(retiredCode)
        initialTheme = theme
        projection = projected
        attributionModel = MapAttribution(projected.attributions, credits)
        options.optJSONObject("insets")?.let { pad(map, it) }
        (options.optJSONObject("camera") ?: document.view?.let(::cameraJson))?.let { move(map, it) }
        awaitingContent = true
        contentStyleLoaded = false
        loaded = false
        map.setStyle(Style.Builder().fromJson(projected.style.toString())) {
            if (retired) return@setStyle
            contentStyleLoaded = true
            reportContentReady()
        }
        return JSONObject.NULL
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
        retiredCode = code
        awaitingContent = false
        main.removeCallbacksAndMessages(null)
        warnings.retire()
        resourceContext?.let(MapResourceContexts::retire)
        resourceContext = null
        if (connected) MapResourceContexts.release()
        connected = false
        data.retire()
        loader.close()
        (mapView.parent as? ViewGroup)?.removeView(mapView)
        mapView.onDestroy()
        map = null
    }

    /** A request this map's style made has been answered or has failed. */
    private fun received(outcome: MapResourceOutcome) {
        if (retired) return
        warnings.resource(outcome)
        // A refused session ends the map, as it does for the web engine.
        (outcome.error as? TileflowMapException)?.let(callbacks.failed)
    }

    private fun reportContentReady() {
        val map = map ?: return
        if (retired || !awaitingContent || !contentStyleLoaded || !loaded) return
        awaitingContent = false
        updateAttribution()
        callbacks.event("contentReady", JSONObject().put("camera", camera(map)))
    }

    private fun updateAttribution() {
        val map = map ?: return
        if (retired || projection == null) return
        val region = map.projection.visibleRegion
        val left = listOfNotNull(region.farLeft, region.nearLeft)
        val right = listOfNotNull(region.farRight, region.nearRight)
        if (left.isEmpty() || right.isEmpty()) return
        val latitudes = (left + right).map { it.latitude }
        val west = left.minOf { it.longitude }
        var east = right.maxOf { it.longitude }
        // A view across the antimeridian has its east edge west of its west edge.
        if (east < west) east += 360
        attribution = attributionModel.entries(west, latitudes.min(), east, latitudes.max())
    }

    /** Rendered features at a point, topmost layer first: MapLibre's features carry no layer. */
    private fun query(map: MapLibreMap, point: PointF): JSONArray {
        val result = JSONArray()
        val layers = projection?.layerSources ?: return result
        for ((layer, source) in layers.entries.reversed()) {
            for (feature in map.queryRenderedFeatures(point, layer)) {
                result.put(
                    JSONObject()
                        .put("id", feature.id() ?: JSONObject.NULL)
                        .put("source", source)
                        .put("layer", layer)
                )
            }
        }
        return result
    }

    /** A point in the view's density-independent pixels, as MapLibre's screen pixels. */
    private fun point(request: JSONObject?): PointF {
        val request = request ?: invalid()
        return PointF(
            (request.getDouble("x") * density).toFloat(),
            (request.getDouble("y") * density).toFloat(),
        )
    }

    private fun pad(map: MapLibreMap, insets: JSONObject) {
        map.moveCamera(
            CameraUpdateFactory.paddingTo(
                insets.optDouble("left", 0.0) * density,
                insets.optDouble("top", 0.0) * density,
                insets.optDouble("right", 0.0) * density,
                insets.optDouble("bottom", 0.0) * density,
            )
        )
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
            .put("longitude", target.wrap().longitude)
            .put("latitude", target.latitude)
            .put("zoom", position.zoom)
            .put("bearing", normalizedBearing(position.bearing))
            .put("pitch", position.tilt)
    }

    private fun cameraJson(camera: dev.tileflow.sdk.TileflowCamera): JSONObject =
        JSONObject()
            .put("longitude", camera.longitude)
            .put("latitude", camera.latitude)
            .put("zoom", camera.zoom)
            .put("bearing", camera.bearing)
            .put("pitch", camera.pitch)

    private fun themeRequest(request: JSONObject): String? =
        if (request.isNull("theme")) null else request.optString("theme")

    /** Whether every list [keys] names in the request is empty or absent. */
    private fun isEmpty(payload: Any, vararg keys: String): Boolean {
        val request = payload as? JSONObject ?: return false
        return keys.all { (request.optJSONArray(it) ?: JSONArray()).length() == 0 }
    }

    private fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

    private fun unsupported(method: ProtocolContract.Method): Nothing =
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext(
                message = "The native map engine does not support ${method.wireName} yet."
            ),
        )

    private companion object {
        /** MapLibre reports bearings in [0, 360); the SDK's cameras use (-180, 180]. */
        fun normalizedBearing(bearing: Double): Double =
            if (bearing > 180) bearing - 360 else bearing
    }
}
