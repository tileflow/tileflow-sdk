package dev.tileflow.sdk.engine

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PointF
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.attribution.MapAttributionControl
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
import java.security.MessageDigest
import kotlin.coroutines.resume
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.camera.CameraUpdateFactory
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.geometry.LatLngBounds
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.FillExtrusionLayer

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
 * Themes, blends and emphasis come from the map's family document and the native evaluators
 * ([NativeEvaluators]). Commands this engine does not draw yet fail with
 * [TileflowErrorCode.INVALID_REQUEST].
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
    private val container = FrameLayout(context)
    /** MapLibre's view, inside the engine's container under an image of the map during a change. */
    internal val mapView: MapView
    internal var map: MapLibreMap? = null
        private set
    private val main = Handler(Looper.getMainLooper())
    private val density = context.resources.displayMetrics.density
    private var started = false
    private var retired = false
    private var retiredCode = TileflowErrorCode.DISPOSED
    private var connected = false
    /** Whether the map is on screen, and whether its host is started and resumed. */
    private var shown = false
    private var hostStarted = true
    private var hostResumed = true
    /** What MapLibre's view was told: started, resumed. */
    private var viewStarted = false
    private var viewResumed = false
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
    /** The attribution the map shows, in the SDK's own control. */
    internal val attribution = MapAttributionControl(context)
    /** Reads the downloaded regions' credits off the main thread, which the index may block. */
    private val creditReader =
        java.util.concurrent.Executors.newSingleThreadExecutor { work ->
            Thread(work, "tileflow-attribution").apply { isDaemon = true }
        }
    private val warnings =
        MapWarnings(
            report = { warning -> if (!retired) callbacks.event("warning", warning) },
            schedule = { delay, block -> main.postDelayed(block, delay) },
        )

    // Appearance: the manifest, family document, what the map shows and the emphasis.
    internal var manifest: NativeMapManifest? = null
        private set
    internal var family: NativeFamily? = null
        private set
    private var colorScheme = "light"
    private var storedZooms: ((String) -> IntRange?)? = null
    /** The theme on screen, or a blend; [blend] describes the blend. */
    internal var shownTheme: String? = null
        private set
    internal var blend: NativeBlend? = null
        private set
    private var appearanceRevision = 0
    internal var viewMode = "2d"
        private set
    private var viewModeRun = 0
    /** Layers that stand in for the 3D scene, with their designed height and base. */
    private var toggles: List<Triple<String, Any?, Any?>> = emptyList()
    private var degradations: List<JSONObject> = emptyList()
    /** Degradations already reported for this map, by record ID. */
    private val reported = HashSet<String>()
    private var emphasisGoal: NativeEmphasisRequest? = null
    private var emphasisShown: NativeEmphasisRequest? = null
    private var emphasisStrength = 0.0
    private var emphasisRun = 0
    private val styleWaiters = mutableListOf<CancellableContinuation<Throwable?>>()
    private val renderWaiters = mutableListOf<CancellableContinuation<Unit>>()

    // Camera: the movement the view asked for, until MapLibre finishes it.
    private var movement: Pair<Int, CancellableContinuation<String>>? = null
    private var movements = 0
    private var moveReason: String? = null
    private var cameraMoving = false

    /** How many times the view sent each command, for diagnostics. */
    internal val received = HashMap<ProtocolContract.Method, Int>()

    override val view: FrameLayout
        get() = container

    override val data: DataChannel = DataChannel()

    init {
        MapLibre.getInstance(application)
        mapView = MapView(context)
        mapView.onCreate(null)
        container.addView(
            mapView,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        // The SDK's attribution, over the map and any image of it during a change.
        container.addView(
            attribution.view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        attribution.onLink = { url ->
            if (!retired) runCatching { URI(url) }.getOrNull()?.let(callbacks.externalLink)
        }
        mapView.addOnWillStartLoadingMapListener { loaded = false }
        mapView.addOnDidFinishLoadingMapListener {
            if (retired) return@addOnDidFinishLoadingMapListener
            loaded = true
            reportContentReady()
            rendered()
        }
        // A fully rendered map also means its style and the resources in view have loaded.
        mapView.addOnDidFinishRenderingMapListener { fully ->
            if (retired || !fully) return@addOnDidFinishRenderingMapListener
            loaded = true
            reportContentReady()
            rendered()
        }
        mapView.addOnDidFailLoadingMapListener { message ->
            if (retired) return@addOnDidFailLoadingMapListener
            val failure =
                TileflowMapException(
                    TileflowErrorCode.RESOURCE_FAILED,
                    TileflowErrorContext(resource = TileflowResourceKind.STYLE, message = message),
                )
            // A theme change waits for its style and reports the failure itself.
            if (styleWaiters.isNotEmpty()) {
                styleWaiters.toList().also { styleWaiters.clear() }.forEach { it.resume(failure) }
                return@addOnDidFailLoadingMapListener
            }
            if (!awaitingContent) return@addOnDidFailLoadingMapListener
            awaitingContent = false
            callbacks.failed(failure)
        }
        // A renderer that loses its graphics context is replaced, as a WebView whose process ended.
        mapView.addOnRenderErrorListener { graphicsContextLost() }
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
                ready.addOnCameraMoveStartedListener { reason -> cameraStarted(reason) }
                ready.addOnCameraMoveListener { cameraEvent("cameraMoved") }
                ready.addOnCameraIdleListener {
                    cameraEnded()
                    updateAttribution()
                }
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
            received[method] = (received[method] ?: 0) + 1
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
                    attribution.place(null, request)
                    JSONObject.NULL
                }
                ProtocolContract.Method.SET_VISIBILITY,
                ProtocolContract.Method.SET_EVENTS -> JSONObject.NULL
                ProtocolContract.Method.SET_OPTIONS -> {
                    attribution.place(request?.optString("attribution"), null)
                    request?.optString("viewMode")?.takeIf { it.isNotEmpty() }?.let {
                        setViewMode(it, 0.0)
                    }
                    JSONObject.NULL
                }
                ProtocolContract.Method.MOVE_CAMERA -> moveCamera(map, request ?: invalid())
                ProtocolContract.Method.STOP_CAMERA -> {
                    map.cancelTransitions()
                    finishMovement("cancelled")
                    JSONObject.NULL
                }
                ProtocolContract.Method.CAMERA_FOR_BOUNDS ->
                    fitted(map, request ?: invalid())?.let(::cameraJson) ?: JSONObject.NULL
                ProtocolContract.Method.VISIBLE_BOUNDS -> visibleBounds(map)
                ProtocolContract.Method.SET_THEME -> setTheme(request ?: invalid())
                ProtocolContract.Method.SET_BLEND -> setBlend(request ?: invalid())
                ProtocolContract.Method.GET_ROUTE_INKS -> routeInks()
                ProtocolContract.Method.SET_EMPHASIS -> setEmphasis(request ?: invalid())
                ProtocolContract.Method.SET_VIEW_MODE -> {
                    val mode = request?.optString("viewMode")
                    if (mode != "2d" && mode != "3d") invalid()
                    setViewMode(mode, request.optDouble("duration", 0.0) / 1000)
                    JSONObject.NULL
                }
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

    // Loading

    /** Reads the map, projects its style and gives it to MapLibre. */
    private suspend fun initialize(map: MapLibreMap, options: JSONObject): Any {
        val source = options.getJSONObject("source")
        val theme = if (options.isNull("theme")) null else options.optString("theme")
        colorScheme = options.optString("colorScheme", "light")
        viewMode = options.optJSONObject("options")?.optString("viewMode")?.ifEmpty { null } ?: "2d"
        attribution.place(
            options.optJSONObject("options")?.optString("attribution"),
            options.optJSONObject("insets"),
        )
        // A Hosted map without a usable network opens from its downloaded regions.
        val fromPacks =
            grantScope != null &&
                OfflineServingRule.hostedUsesPacks(
                    TileflowHttpClient.networkEnabled,
                    OfflineReachability.isReachable(application),
                )
        storedZooms =
            grantScope?.takeIf { fromPacks }?.let { scope ->
                val index = OfflineServingIndex.shared(application)
                val lookup: (String) -> IntRange? = { index.storedZooms(scope, it) }
                lookup
            }
        var read = withContext(Dispatchers.IO) { NativeManifest.read(source, ::load, fromPacks) }
        if (retired) throw TileflowMapException(retiredCode)
        var document = read.resolve(theme, colorScheme)
        val (style, projected) =
            try {
                loadStyle(document.styleUrl)
            } catch (error: TileflowMapException) {
                if (!fromPacks || read.representation != NativeRepresentation.NATIVE) throw error
                // An earlier session can leave the native manifest in the cache while the regions
                // hold only the WebView profile's styles.
                read =
                    withContext(Dispatchers.IO) {
                        NativeManifest.read(source, ::load, fromPacks = true, allowsNative = false)
                    }
                document = read.resolve(theme, colorScheme)
                loadStyle(document.styleUrl)
            }
        manifest = read
        family = loadFamily(document.styleUrl)
        if (retired) throw TileflowMapException(retiredCode)
        shownTheme = document.theme
        grantScope?.let { scope ->
            val index = OfflineServingIndex.shared(application)
            val (obligations, regional) =
                withContext(Dispatchers.IO) { index.obligations(scope) to index.credits(scope) }
            attribution.setDownloaded(obligations, regional)
        }
        options.optJSONObject("insets")?.let { pad(map, it) }
        (options.optJSONObject("camera") ?: document.view?.let(::cameraJson))?.let {
            move(map, it)
        }
        awaitingContent = true
        contentStyleLoaded = false
        loaded = false
        show(map, style, projected)
        return JSONObject.NULL
    }

    private fun load(url: URI): ByteArray {
        val payload = loader.load(url)
        if (payload.status != 200) throw NativeResourceStatus(payload.status)
        return payload.bytes
    }

    /** Reads a theme's style through the map's transport and projects it for this map. */
    private suspend fun loadStyle(url: String): Pair<JSONObject, NativeStyleProjection> =
        withContext(Dispatchers.IO) {
            val style = NativeManifest.document(url, ::load, TileflowResourceKind.STYLE)
            style to project(style, url)
        }

    private fun project(style: JSONObject, url: String): NativeStyleProjection {
        val context = resourceContext ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        return NativeStyleDocument.project(style, url, context, ::load, storedZooms)
    }

    /**
     * Reads the map's family document, if it has one, and checks a Hosted document against the
     * revision discovery gave. A map without it draws its themes but cannot blend them or apply an
     * emphasis.
     */
    private suspend fun loadFamily(styleUrl: String): NativeFamily? {
        val manifest = manifest ?: return null
        val url = manifest.familyUrl(styleUrl) ?: return null
        val bytes =
            withContext(Dispatchers.IO) {
                runCatching { loader.load(URI(url)) }.getOrNull()?.takeIf { it.status == 200 }?.bytes
            } ?: return null
        manifest.family?.second?.let { revision ->
            val digest =
                MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {
                    "%02x".format(it)
                }
            if (digest != revision) {
                warnings.warn(
                    "resourceFailed",
                    "The map's family document does not match its revision.",
                    TileflowResourceKind.STYLE,
                    runCatching { dev.tileflow.sdk.transport.ResourcePolicy.origin(URI(url)) }
                        .getOrNull(),
                    null,
                )
                return null
            }
        }
        return runCatching { NativeFamily.parse(JSONObject(String(bytes, Charsets.UTF_8))) }.getOrNull()
    }

    /** Gives MapLibre a projected style; what the engine reads from it applies once it loads. */
    private fun show(map: MapLibreMap, style: JSONObject, projected: NativeStyleProjection) {
        projection = projected
        attribution.setStyle(style, projected.attributions)
        read(style, projected.omitted)
        contentStyleLoaded = false
        map.setStyle(Style.Builder().fromJson(projected.style.toString())) {
            if (retired) return@setStyle
            contentStyleLoaded = true
            styleDidLoad()
            styleWaiters.toList().also { styleWaiters.clear() }.forEach { it.resume(null) }
            reportContentReady()
        }
    }

    /** What the engine reads from a style: stand-in extrusions and degradations. */
    private fun read(style: JSONObject, omitted: List<String>) {
        val layers = style.optJSONArray("layers")?.objects().orEmpty()
        toggles =
            layers
                .filter { it.optJSONObject("metadata")?.has("tileflow:3d-toggle") == true }
                .map {
                    val paint = it.optJSONObject("paint")
                    Triple(
                        it.optString("id"),
                        paint?.opt("fill-extrusion-height"),
                        paint?.opt("fill-extrusion-base"),
                    )
                }
        degradations =
            style
                .optJSONObject("metadata")
                ?.optJSONArray("tileflow:nativeDegradations")
                ?.objects()
                .orEmpty()
                .toMutableList()
                .apply {
                    if ("text" in omitted)
                        add(
                            JSONObject()
                                .put("id", "text")
                                .put("feature", "text")
                                .put("message", TEXT_OMITTED)
                        )
                }
    }

    /** A style finished loading: the view mode, the emphasis and the degradations apply to it. */
    private fun styleDidLoad() {
        viewModeRun += 1
        applyViewMode(if (viewMode == "3d") 1.0 else 0.0)
        applyEmphasis(emphasisStrength, featureData = true)
        for (record in degradations) {
            val id = record.optString("id")
            if (id.isEmpty() || !reported.add(id)) continue
            val feature = record.optString("feature", id)
            warnFeature(
                feature,
                record.optString("message").ifEmpty {
                    degradationMessage(feature, record.optString("fallback"))
                },
            )
        }
    }

    private fun warnFeature(feature: String, message: String) {
        Log.w(TAG, message)
        warnings.feature(feature, message)
    }

    override fun setVisible(visible: Boolean) {
        if (retired) return
        shown = visible
        syncLifecycle()
    }

    override fun hostLifecycle(started: Boolean, resumed: Boolean) {
        hostStarted = started
        hostResumed = resumed
        syncLifecycle()
    }

    override fun lowMemory() {
        if (!retired) mapView.onLowMemory()
    }

    /** MapLibre's view starts and resumes while the map is shown and its host is. */
    private fun syncLifecycle() {
        if (retired) return
        val start = shown && hostStarted
        val resume = start && hostResumed
        if (start && !viewStarted) {
            viewStarted = true
            mapView.onStart()
        }
        if (resume && !viewResumed) {
            viewResumed = true
            mapView.onResume()
        }
        if (!resume && viewResumed) {
            viewResumed = false
            mapView.onPause()
        }
        if (!start && viewStarted) {
            viewStarted = false
            mapView.onStop()
        }
    }

    /**
     * MapLibre lost the graphics resources it draws with. The view replaces the engine: at once
     * while it is visible, otherwise when it is next shown.
     */
    internal fun graphicsContextLost() {
        if (!retired) callbacks.rendererGone(this, ProtocolContract.ErrorReason.GRAPHICS_CONTEXT_LOST)
    }

    override fun retire(code: TileflowErrorCode) {
        if (retired) return
        shown = false
        syncLifecycle()
        retired = true
        retiredCode = code
        awaitingContent = false
        main.removeCallbacksAndMessages(null)
        warnings.retire()
        creditReader.shutdownNow()
        finishMovement("cancelled")
        val failure = TileflowMapException(code)
        styleWaiters.toList().also { styleWaiters.clear() }.forEach { it.resume(failure) }
        renderWaiters.toList().also { renderWaiters.clear() }.forEach { it.resume(Unit) }
        resourceContext?.let(MapResourceContexts::retire)
        resourceContext = null
        if (connected) MapResourceContexts.release()
        connected = false
        data.retire()
        loader.close()
        (container.parent as? ViewGroup)?.removeView(container)
        mapView.onDestroy()
        map = null
    }

    /** A request this map's style made has been answered or has failed. */
    private fun received(outcome: MapResourceOutcome) {
        if (retired) return
        attribution.received(outcome.fairUse)
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

    /**
     * Checks the regional credits against the view, at the end of each camera movement and when the
     * content loads, and reads the downloaded credits again, which a region downloaded or removed
     * meanwhile changes. The map shows them online as well as offline: online its tiles may come
     * from those regions too.
     */
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
        attribution.update(doubleArrayOf(west, latitudes.min(), east, latitudes.max()))
        val scope = grantScope ?: return
        val index = OfflineServingIndex.shared(application)
        runCatching {
            creditReader.execute {
                val obligations = index.obligations(scope)
                val regional = index.credits(scope)
                main.post { if (!retired) attribution.setDownloaded(obligations, regional) }
            }
        }
    }

    // Style changes

    /**
     * Shows a style over an image of the map as drawn, then fades the image out over [duration]
     * seconds once MapLibre has drawn the new style.
     */
    private suspend fun present(style: JSONObject, projected: NativeStyleProjection, duration: Double) {
        val map = map ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val image: Bitmap? =
            if (contentStyleLoaded && mapView.width > 0 && mapView.height > 0)
                withTimeoutOrNull(1_000) {
                    suspendCancellableCoroutine { done -> map.snapshot { done.resume(it) } }
                }
            else null
        val cover =
            image?.let {
                ImageView(container.context).apply {
                    setImageBitmap(it)
                    scaleType = ImageView.ScaleType.FIT_XY
                    // Over the map and under the attribution, which stays shown.
                    container.addView(
                        this,
                        container.indexOfChild(mapView) + 1,
                        FrameLayout.LayoutParams(
                            ViewGroup.LayoutParams.MATCH_PARENT,
                            ViewGroup.LayoutParams.MATCH_PARENT,
                        ),
                    )
                }
            }
        val failure = suspendCancellableCoroutine { waiter ->
            styleWaiters += waiter
            show(map, style, projected)
        }
        if (failure != null) {
            cover?.let(container::removeView)
            throw failure
        }
        withTimeoutOrNull(5_000) { suspendCancellableCoroutine { renderWaiters += it } }
        if (cover == null) return
        // A view off screen does not animate; its image goes at once.
        if (duration <= 0 || retired || !container.isAttachedToWindow) {
            container.removeView(cover)
            return
        }
        val millis = (duration * 1000).roundToInt().toLong()
        withTimeoutOrNull(millis + 1_000) {
            suspendCancellableCoroutine { done ->
                cover
                    .animate()
                    .alpha(0f)
                    .setDuration(millis)
                    .withEndAction { if (done.isActive) done.resume(Unit) }
                    .start()
            }
        }
        container.removeView(cover)
    }

    /** MapLibre drew the style completely. */
    private fun rendered() {
        renderWaiters.toList().also { renderWaiters.clear() }.forEach {
            if (it.isActive) it.resume(Unit)
        }
    }

    private fun transition(phase: String, current: String?, target: String?, inks: JSONObject? = null) {
        val value = JSONObject().put("phase", phase)
        current?.let { value.put("currentTheme", it) }
        target?.let { value.put("targetTheme", it) }
        inks?.let { value.put("routeInks", it) }
        callbacks.event("themeTransition", value)
        if (phase == "ready" && current != null)
            callbacks.event("themeChanged", JSONObject().put("theme", current))
    }

    private fun result(status: String, theme: String) =
        JSONObject().put("status", status).put("theme", theme)

    /** The theme on screen; during a blend, the nearest theme. */
    private val currentTheme: String?
        get() = blend?.let { it.themes[it.dominant] } ?: shownTheme

    private suspend fun setTheme(payload: JSONObject): JSONObject {
        val manifest = manifest ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        appearanceRevision += 1
        val revision = appearanceRevision
        payload.optString("colorScheme").takeIf { it.isNotEmpty() }?.let { colorScheme = it }
        val document =
            try {
                manifest.resolve(
                    if (payload.isNull("theme")) null else payload.optString("theme"),
                    colorScheme,
                    payload.optString("timeOfDay").ifEmpty { null },
                )
            } catch (_: TileflowMapException) {
                throw TileflowMapException(
                    TileflowErrorCode.RESOURCE_FAILED,
                    TileflowErrorContext(
                        resource = TileflowResourceKind.STYLE,
                        message = "The theme is not available.",
                    ),
                )
            }
        // The theme on screen needs no change, as when a new engine replays the view's theme.
        if (blend == null && shownTheme == document.theme) return result("applied", document.theme)
        val current = currentTheme
        transition("preloading", current, document.theme)
        try {
            val (style, projected) = loadStyle(document.styleUrl)
            if (revision != appearanceRevision || retired) return result("superseded", document.theme)
            transition("applying", current, document.theme)
            shownTheme = document.theme
            blend = null
            present(style, projected, payload.optDouble("duration", 0.0) / 1000)
        } catch (error: Exception) {
            if (revision != appearanceRevision || retired) return result("superseded", document.theme)
            transition("error", current, document.theme)
            throw TileflowMapException(
                TileflowErrorCode.RESOURCE_FAILED,
                TileflowErrorContext(
                    resource = TileflowResourceKind.STYLE,
                    message = "The theme could not be applied.",
                ),
            )
        }
        if (revision != appearanceRevision) return result("superseded", document.theme)
        transition("ready", document.theme, document.theme, routeInks())
        return result("applied", document.theme)
    }

    /** The route inks of the theme on screen; during a blend, mixed at its position. */
    private fun routeInks(): JSONObject {
        val inks =
            blend?.let { family?.routeInks(it.themes, it.position) }
                ?: shownTheme?.let { family?.routeInks(listOf(it)) }
        if (inks != null) return inks
        val dark = colorScheme == "dark"
        return JSONObject()
            .put("line", if (dark) "#60a5fa" else "#2563eb")
            .put("casing", if (dark) "#0b1220" else "#1e3a8a")
            .put("core", "#eff6ff")
            .put("glow", if (dark) "#60a5fa" else "#2563eb")
            .put("alternative", "#64748b")
            .put("glowOpacity", if (dark) 0.4 else 0.16)
            .put("coreOpacity", if (dark) 0.7 else 0.0)
    }

    // Blends

    private suspend fun setBlend(payload: JSONObject): JSONObject {
        val manifest = manifest ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val family =
            family
                ?: throw TileflowMapException(
                    TileflowErrorCode.RESOURCE_FAILED,
                    TileflowErrorContext(
                        resource = TileflowResourceKind.STYLE,
                        message = "The map has no native family document.",
                    ),
                )
        val list = payload.optJSONArray("themes") ?: invalid()
        val names = (0 until list.length()).map { list.optString(it) }
        if (names.size < 2 || !payload.has("position")) invalid()
        val plan =
            names.takeIf { all -> all.all { it in manifest.styles } }?.let(family::blend)
                ?: throw TileflowMapException(
                    TileflowErrorCode.INVALID_REQUEST,
                    TileflowErrorContext(message = "The blend contains themes that cannot blend."),
                )
        val (group, selection) = plan
        appearanceRevision += 1
        val revision = appearanceRevision
        val at = payload.optDouble("position").coerceIn(0.0, (names.size - 1).toDouble())
        val nearest = Math.round(at).toInt()
        val hold = payload.optBoolean("hold", false)
        // A move within the blend on screen sets the values that follow the position.
        blend?.takeIf { it.group == group && it.selection == selection }?.let { current ->
            val moved = moved(current, at, if (hold) current.dominant else nearest)
            if (moved != null) {
                blend = moved
                applyEmphasis(emphasisStrength, featureData = true)
                return result("applied", names[moved.dominant])
            }
        }
        val target = names[nearest]
        val current = currentTheme
        transition("preloading", current, target)
        try {
            val style = blendStyle(family, group, selection, names, at)
            val projected =
                withContext(Dispatchers.IO) { project(style, manifest.theme(target).styleUrl) }
            if (revision != appearanceRevision || retired) return result("superseded", target)
            transition("applying", current, target)
            shownTheme = target
            blend = NativeBlend(group, names, selection, at, nearest)
            present(style, projected, payload.optDouble("duration", 0.0) / 1000)
        } catch (error: Exception) {
            if (revision != appearanceRevision || retired) return result("superseded", target)
            transition("error", current, target)
            throw TileflowMapException(
                TileflowErrorCode.RESOURCE_FAILED,
                TileflowErrorContext(
                    resource = TileflowResourceKind.STYLE,
                    message = "The theme blend could not be applied.",
                ),
            )
        }
        if (revision != appearanceRevision) return result("superseded", target)
        transition("ready", target, target, routeInks())
        return result("applied", target)
    }

    /**
     * One style that holds a blend: the nearest theme's style with the group's planned layers and
     * light filled at the position.
     */
    private suspend fun blendStyle(
        family: NativeFamily,
        group: Int,
        selection: List<Int>,
        themes: List<String>,
        position: Double,
    ): JSONObject {
        val manifest = manifest ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val plan = family.groups[group]
        val url = manifest.theme(themes[Math.round(position).toInt()]).styleUrl
        val style =
            withContext(Dispatchers.IO) {
                NativeManifest.document(url, ::load, TileflowResourceKind.STYLE)
            }
        style.put("layers", JSONArray(NativeEvaluators.blendLayers(plan, selection, position)))
        plan.opt("light")?.let {
            style.put("light", NativeEvaluators.fill(it, position, selection))
        }
        plan.optJSONObject("metadata")?.let { entries ->
            val metadata = style.optJSONObject("metadata") ?: JSONObject()
            for (key in entries.keys()) metadata.put(key, entries.get(key))
            style.put("metadata", metadata)
        }
        return style
    }

    /**
     * The blend on screen moved to a position, with each value that changes set on the live
     * style. Null when a value cannot be set that way, so the style loads again.
     */
    private fun moved(current: NativeBlend, position: Double, dominant: Int): NativeBlend? {
        val family = family ?: return null
        val style = map?.style?.takeIf { contentStyleLoaded } ?: return null
        val plan = family.groups[current.group]
        val layers =
            try {
                val live = NativeEvaluators.blendLayers(plan, current.selection, position)
                if (dominant == Math.round(position).toInt()) live
                else {
                    val held =
                        NativeEvaluators.blendLayers(plan, current.selection, dominant.toDouble())
                    live.zip(held).map { (layer, kept) ->
                        if (kept.optString("type") == "symbol") kept else merged(layer, kept, plan)
                    }
                }
            } catch (_: Exception) {
                return null
            }
        val byId = layers.associateBy { it.optString("id") }
        val writes = mutableListOf<Triple<String, String, Pair<Any?, Boolean>>>()
        plan.optJSONArray("paints")?.objects()?.forEach { paint ->
            val id = paint.optString("layer")
            val property = paint.optString("property")
            writes += Triple(id, property, byId[id]?.optJSONObject("paint")?.opt(property) to false)
        }
        if (dominant != current.dominant)
            plan.optJSONArray("switches")?.objects()?.forEach { entry ->
                val id = entry.optString("layer")
                val kind = entry.optString("group")
                val property = entry.optString("property")
                writes +=
                    Triple(
                        id,
                        property,
                        byId[id]?.optJSONObject(kind)?.opt(property) to (kind == "layout"),
                    )
            }
        for ((id, property, value) in writes) {
            val layer = style.getLayer(id) ?: return null
            if (!NativeStyleProperties.set(layer, property, value.first, value.second)) return null
        }
        plan.opt("light")?.let { template ->
            val light = NativeEvaluators.fill(template, position, current.selection) as? JSONObject
            style.light?.let { target ->
                light?.optString("color")?.takeIf { it.isNotEmpty() }?.let(target::setColor)
                if (light?.has("intensity") == true)
                    target.intensity = light.optDouble("intensity").toFloat()
            }
        }
        return current.copy(position = position, dominant = dominant)
    }

    /** A layer at the position whose switched values stay at the held theme's. */
    private fun merged(live: JSONObject, held: JSONObject, plan: JSONObject): JSONObject {
        val layer = JSONObject(live.toString())
        plan.optJSONArray("switches")?.objects()?.forEach { entry ->
            if (entry.optString("layer") != live.optString("id")) return@forEach
            val kind = entry.optString("group")
            val values = layer.optJSONObject(kind) ?: JSONObject()
            val property = entry.optString("property")
            values.put(property, held.optJSONObject(kind)?.opt(property))
            layer.put(kind, values)
        }
        return layer
    }

    // Emphasis

    private suspend fun setEmphasis(payload: JSONObject): JSONObject {
        val value = payload.optJSONObject("emphasis")
        var request: NativeEmphasisRequest? = null
        if (value != null) {
            if (family == null)
                throw TileflowMapException(
                    TileflowErrorCode.RESOURCE_FAILED,
                    TileflowErrorContext(
                        resource = TileflowResourceKind.STYLE,
                        message = "The map has no native family document.",
                    ),
                )
            val recede = HashMap<String, Double>()
            value.optJSONObject("recede")?.let { amounts ->
                for (domain in amounts.keys()) {
                    val amount = amounts.optDouble(domain)
                    if (amount.isNaN() || amount !in 0.0..1.0) invalid()
                    recede[domain] = amount
                }
            }
            val keep =
                value.optJSONObject("keep")?.optString("id")?.takeIf { it.isNotEmpty() }?.let { id ->
                    val area =
                        data.payload(id)?.let {
                            runCatching { JSONObject(String(it.bytes, Charsets.UTF_8)) }.getOrNull()
                        }
                    if (
                        area == null ||
                            area.optString("type") !in setOf("Polygon", "MultiPolygon") ||
                            area.optJSONArray("coordinates") == null
                    )
                        throw TileflowMapException(
                            TileflowErrorCode.INVALID_REQUEST,
                            TileflowErrorContext(
                                message =
                                    "The emphasis keep area must be a GeoJSON Polygon or MultiPolygon."
                            ),
                        )
                    JSONObject()
                        .put("type", area.getString("type"))
                        .put("coordinates", area.getJSONArray("coordinates"))
                }
            request =
                NativeEmphasisRequest(
                    recede,
                    if (value.has("labels")) value.optDouble("labels") else null,
                    keep,
                )
        }
        emphasisRun += 1
        val run = emphasisRun
        emphasisGoal = request
        if (request != null) emphasisShown = request
        val goal = if (request == null) 0.0 else 1.0
        val duration = payload.optDouble("duration", 0.0) / 1000
        // Values read per feature are set once, at their goal.
        applyEmphasis(goal, featureData = true, only = true)
        val from = emphasisStrength
        if (duration > 0 && from != goal) {
            val started = System.nanoTime()
            while (true) {
                if (run != emphasisRun || retired) return JSONObject().put("status", "superseded")
                val t = ((System.nanoTime() - started) / 1e9 / duration).coerceAtMost(1.0)
                val eased = if (t < 0.5) 2 * t * t else 1 - Math.pow(-2 * t + 2, 2.0) / 2
                applyEmphasis(from + (goal - from) * eased, featureData = false)
                if (t >= 1) break
                delay(33)
            }
        }
        applyEmphasis(goal, featureData = true)
        if (request == null) emphasisShown = null
        return JSONObject().put("status", "applied")
    }

    /**
     * Writes the shown emphasis at a strength to the theme on screen. [only] writes just the values
     * that read feature data.
     */
    private fun applyEmphasis(strength: Double, featureData: Boolean, only: Boolean = false) {
        if (!only) emphasisStrength = strength
        val request = emphasisShown ?: return
        val theme = currentTheme ?: return
        val style = map?.style?.takeIf { contentStyleLoaded } ?: return
        val targets =
            family?.theme(theme)?.optJSONObject("emphasis")?.optJSONArray("targets")?.objects()
                ?: return
        for (target in targets) {
            val reads = target.optBoolean("featureData", false)
            if (if (reads) !featureData else only) continue
            val layer = style.getLayer(target.optString("layer")) ?: continue
            val amount =
                if (target.optString("kind") == "label") 1 - (request.labels ?: 1.0)
                else request.recede[target.optString("domain")] ?: 0.0
            val value =
                runCatching { NativeEvaluators.emphasize(target, amount * strength, request.keep) }
                    .getOrNull() ?: continue
            NativeStyleProperties.set(layer, target.optString("property"), value)
        }
    }

    // View mode

    /**
     * Shows the layers that stand in for the 3D scene (`3d`) or hides them (`2d`). With a
     * duration, buildings rise from the ground or sink into it first.
     */
    private fun setViewMode(mode: String, duration: Double) {
        viewModeRun += 1
        val run = viewModeRun
        viewMode = mode
        val goal = if (mode == "3d") 1.0 else 0.0
        if (duration <= 0 || !contentStyleLoaded || toggles.isEmpty()) {
            applyViewMode(goal)
            return
        }
        val started = System.nanoTime()
        val frame =
            object : Runnable {
                override fun run() {
                    if (run != viewModeRun || retired) return
                    val t = ((System.nanoTime() - started) / 1e9 / duration).coerceAtMost(1.0)
                    if (t >= 1) {
                        applyViewMode(goal)
                        return
                    }
                    applyViewMode(if (goal == 1.0) t else 1 - t, visible = true)
                    main.postDelayed(this, 33)
                }
            }
        frame.run()
    }

    /** Scales the stand-in extrusions' heights by [factor]; they show only above 0. */
    private fun applyViewMode(factor: Double, visible: Boolean? = null) {
        val style = map?.style?.takeIf { contentStyleLoaded } ?: return
        for ((id, height, base) in toggles) {
            val layer = style.getLayer(id) ?: continue
            val shown = visible ?: (factor > 0)
            NativeStyleProperties.set(layer, "visibility", if (shown) "visible" else "none")
            if (layer !is FillExtrusionLayer) continue
            val designed = listOf("fill-extrusion-height" to height, "fill-extrusion-base" to base)
            for ((property, value) in designed) {
                if (value == null) continue
                val scaled =
                    if (factor >= 1) value else JSONArray().put("*").put(value).put(factor)
                NativeStyleProperties.set(layer, property, scaled)
            }
        }
    }

    // Camera

    private suspend fun moveCamera(map: MapLibreMap, payload: JSONObject): JSONObject {
        val current = map.cameraPosition
        // MapLibre caps the pitch while it builds a camera; the request says what was asked for.
        payload.optJSONObject("fit")?.optDouble("pitch")?.let(::warnPitch)
        payload.optJSONObject("target")?.optDouble("pitch")?.let(::warnPitch)
        val target: CameraPosition =
            payload.optJSONObject("fit")?.let { fitted(map, it) }?.let(::position)
                ?: run {
                    if (payload.has("fit")) invalid()
                    val update = payload.optJSONObject("target") ?: JSONObject()
                    val center = update.optJSONObject("center")
                    CameraPosition.Builder()
                        .target(
                            center?.let {
                                LatLng(it.getDouble("latitude"), it.getDouble("longitude"))
                            } ?: current.target
                        )
                        .zoom(update.optDouble("zoom", current.zoom))
                        .bearing(update.optDouble("bearing", current.bearing))
                        .tilt(update.optDouble("pitch", current.tilt))
                        .build()
                }
        finishMovement("cancelled")
        val animation = payload.optJSONObject("animation")
        val type = animation?.optString("type") ?: "jump"
        val duration = animation?.optDouble("duration", Double.NaN) ?: Double.NaN
        movements += 1
        val id = movements
        moveReason = payload.optString("reason").ifEmpty { "api" }
        val completion = suspendCancellableCoroutine { waiter ->
            movement = id to waiter
            val update = CameraUpdateFactory.newCameraPosition(target)
            val callback =
                object : MapLibreMap.CancelableCallback {
                    override fun onFinish() {
                        if (movement?.first == id) finishMovement("finished")
                    }

                    override fun onCancel() {
                        if (movement?.first == id) finishMovement("cancelled")
                    }
                }
            when {
                type == "ease" && duration > 0 ->
                    map.easeCamera(update, duration.roundToInt(), true, callback)
                type == "fly" ->
                    map.animateCamera(
                        update,
                        if (duration.isNaN()) 1_500 else duration.roundToInt(),
                        callback,
                    )
                else -> {
                    map.moveCamera(update)
                    finishMovement("finished")
                }
            }
        }
        return JSONObject().put("completion", completion).put("camera", camera(map))
    }

    private fun finishMovement(outcome: String) {
        val (_, waiter) = movement ?: return
        movement = null
        if (waiter.isActive) waiter.resume(outcome)
    }

    /** MapLibre Android draws at most 60 degrees of pitch; a steeper camera is capped once. */
    private fun warnPitch(pitch: Double) {
        if (!pitch.isNaN() && pitch > MAXIMUM_PITCH + 0.01 && reported.add("pitchAbove60"))
            warnFeature(
                "pitchAbove60",
                "Native maps on Android draw at most $MAXIMUM_PITCH degrees of pitch; the camera's " +
                    "pitch is capped.",
            )
    }

    private fun cameraStarted(reason: Int) {
        // A person's gesture interrupts the movement the application asked for.
        if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) {
            if (movement != null) finishMovement("interrupted")
            moveReason = "gesture"
        }
        cameraMoving = true
        cameraEvent("cameraMoveStarted")
    }

    private fun cameraEnded() {
        if (!cameraMoving) return
        cameraMoving = false
        cameraEvent("cameraMoveEnded")
        if (movement == null) moveReason = null
    }

    private fun cameraEvent(event: String) {
        val map = map ?: return
        if (retired) return
        callbacks.event(
            event,
            JSONObject().put("camera", camera(map)).put("reason", moveReason ?: "api"),
        )
    }

    /** The camera that frames bounds with padding inside the insets; null when there is no room. */
    private fun fitted(map: MapLibreMap, fit: JSONObject): TileflowCamera? {
        val bounds = fit.optJSONObject("bounds") ?: return null
        val padding = fit.optJSONObject("padding") ?: JSONObject()
        val edges =
            listOf("left", "top", "right", "bottom").map {
                (padding.optDouble(it, 0.0) * density).roundToInt()
            }
        val insets = map.padding
        if (
            mapView.width - edges[0] - edges[2] - insets[0] - insets[2] <= 0 ||
                mapView.height - edges[1] - edges[3] - insets[1] - insets[3] <= 0
        )
            return null
        var east = bounds.getDouble("east")
        val west = bounds.getDouble("west")
        if (east < west) east += 360
        val position =
            map.getCameraForLatLngBounds(
                LatLngBounds.from(bounds.getDouble("north"), east, bounds.getDouble("south"), west),
                edges.toIntArray(),
                fit.optDouble("bearing", map.cameraPosition.bearing),
                fit.optDouble("pitch", map.cameraPosition.tilt),
            ) ?: return null
        val target = position.target ?: return null
        var zoom = position.zoom
        if (fit.has("maxZoom")) zoom = minOf(zoom, fit.getDouble("maxZoom"))
        return TileflowCamera(
            target.wrap().longitude,
            target.latitude,
            zoom.coerceIn(0.0, 24.0),
            normalizedBearing(position.bearing),
            position.tilt,
        )
    }

    private fun position(camera: TileflowCamera): CameraPosition =
        CameraPosition.Builder()
            .target(LatLng(camera.latitude, camera.longitude))
            .zoom(camera.zoom)
            .bearing(camera.bearing)
            .tilt(camera.pitch)
            .build()

    private fun visibleBounds(map: MapLibreMap): JSONObject {
        val bounds = map.projection.visibleRegion.latLngBounds
        return JSONObject()
            .put("west", bounds.longitudeWest)
            .put("south", bounds.latitudeSouth)
            .put("east", bounds.longitudeEast)
            .put("north", bounds.latitudeNorth)
    }

    /** Rendered features at a point, topmost layer first: MapLibre's features carry no layer. */
    private fun query(map: MapLibreMap, point: PointF): JSONArray {
        val result = JSONArray()
        val layers = projection?.layerSources ?: return result
        val style = map.style
        for ((layer, source) in layers.entries.reversed()) {
            if (style?.getLayer(layer)?.visibility?.value == "none") continue
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
        val pitch = camera.optDouble("pitch", 0.0)
        warnPitch(pitch)
        map.moveCamera(
            CameraUpdateFactory.newCameraPosition(
                CameraPosition.Builder()
                    .target(LatLng(camera.getDouble("latitude"), camera.getDouble("longitude")))
                    .zoom(camera.getDouble("zoom"))
                    .bearing(camera.optDouble("bearing", 0.0))
                    .tilt(pitch)
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

    private fun cameraJson(camera: TileflowCamera): JSONObject =
        JSONObject()
            .put("longitude", camera.longitude)
            .put("latitude", camera.latitude)
            .put("zoom", camera.zoom)
            .put("bearing", camera.bearing)
            .put("pitch", camera.pitch)

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

    internal companion object {
        const val TAG = "Tileflow"
        /** The steepest pitch MapLibre Android draws. */
        const val MAXIMUM_PITCH = 60.0
        const val TEXT_OMITTED =
            "This map's labels have no glyphs or font faces native maps can draw, so they are left out."

        /** MapLibre reports bearings in [0, 360); the SDK's cameras use (-180, 180]. */
        fun normalizedBearing(bearing: Double): Double =
            if (bearing > 180) bearing - 360 else bearing

        fun degradationMessage(feature: String, fallback: String?): String {
            val instead =
                when (fallback) {
                    "extrusions" -> "plain building extrusions stand in for it"
                    "flat" -> "it is drawn flat"
                    "mercator" -> "the map is drawn in Web Mercator"
                    "steady" -> "the lights shine steadily"
                    "allow-overlap" -> "symbols are placed with allowed overlap"
                    "engine-default" -> "the renderer's default is used"
                    "capped" -> "the camera's pitch is capped"
                    else -> "it is left out"
                }
            return "Native maps do not draw this map's $feature feature; $instead."
        }
    }
}

/** A blend on screen: the group, its themes in blend order and the position. */
internal data class NativeBlend(
    val group: Int,
    val themes: List<String>,
    /** The themes as indices into the group's themes, in blend order. */
    val selection: List<Int>,
    val position: Double,
    /** The nearest theme, which symbol layers and switched values follow. */
    val dominant: Int,
)

/** An emphasis: how far each module recedes, how visible labels stay, an area kept as designed. */
internal data class NativeEmphasisRequest(
    val recede: Map<String, Double>,
    val labels: Double?,
    val keep: JSONObject?,
)
