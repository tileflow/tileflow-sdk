package dev.tileflow.sdk

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.util.AttributeSet
import android.view.View
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.annotation.MainThread
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.tileflow.configuration.Tileflow
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.EventSubscriptions
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.transport.EmbeddedRuntime
import dev.tileflow.sdk.transport.MapPrewarmer
import dev.tileflow.sdk.transport.ResourceAddress
import dev.tileflow.sdk.transport.ResourceClient
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.grantScope
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * A Tileflow map in a View hierarchy. Declared in a layout, `app:tileflowMapId` selects a Hosted
 * map, `app:tileflowSurfaceId` names where the application shows it and `app:tileflowTheme` sets
 * its initial theme. Otherwise select a map with [setSource].
 */
@MainThread
public class TileflowMapView
@JvmOverloads
constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {
    public var onEvent: (TileflowMapEvent) -> Unit = {}
    public var source: TileflowMapSource? = null
        private set

    public var theme: String? = null
        private set

    public var options: TileflowMapOptions = TileflowMapOptions()
        private set

    private var appearance: Pair<ProtocolContract.Method, JSONObject>? = null
    private var content = MapContent()
    private var contentRevision = 0
    private var subscriptions = EventSubscriptions(options.events)
    private var camera: TileflowCamera? = null
    private var webView: WebView? = null
    private var bridge: MapBridge? = null
    private var loader: ResourceLoader? = null
    private var bootstrap: ScriptHandler? = null
    private var scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val instanceId = UUID.randomUUID().toString()
    private var generation = 0
    private var destroyed = false
    private var initialized = false
    private var readyForEvents = false
    private var pendingReadyEvent = false
    /** Renderer replacements since content last loaded; a crash loop stops after one. */
    private var recoveries = 0
    /** Whether this load may still reload itself once for a superseded Map deployment. */
    private val automaticReloadAvailable = AtomicBoolean(true)
    private var generationReady = false
    /** A renderer to replace once the view is visible again. */
    private var pendingRemount = false
    // View.isAttachedToWindow stays true until onDetachedFromWindow returns.
    private var attached = false
    /** The current source with its configuration read, kept with its Hosted session. */
    private var loadable: LoadableMapSource? = null
    private var hostedSession: HostedSession? = null
    private var lifecycleOwner: LifecycleOwner? = null
    private var rendererVisible = true
    private val lifecycleObserver =
        object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                updateVisibility()
            }

            override fun onStop(owner: LifecycleOwner) {
                updateVisibility()
            }

            override fun onDestroy(owner: LifecycleOwner) {
                destroy()
            }
        }

    init {
        // A layout selects a Hosted map with `app:tileflowMapId`; an invalid value fails inflation.
        if (attrs != null) {
            val values = context.obtainStyledAttributes(attrs, R.styleable.TileflowMapView)
            try {
                values.getString(R.styleable.TileflowMapView_tileflowTheme)?.let {
                    require(it.isNotEmpty() && it.length <= 128) { "Invalid tileflowTheme." }
                    theme = it
                }
                val surfaceId = values.getString(R.styleable.TileflowMapView_tileflowSurfaceId)
                val mapId = values.getString(R.styleable.TileflowMapView_tileflowMapId)
                require(surfaceId == null || mapId != null) {
                    "tileflowSurfaceId needs tileflowMapId."
                }
                if (mapId != null) {
                    setSource(TileflowMapSource.hosted(mapId, surfaceId ?: "mobile-map"))
                }
            } finally {
                values.recycle()
            }
        }
    }

    /**
     * Shows a Hosted map. Its credential and API origin come from
     * `Tileflow.configuration(context)`; use [TileflowMapSource.hosted] with [setSource] to pass a
     * configuration for this map only.
     */
    public constructor(context: Context, mapId: String) : this(context) {
        setSource(TileflowMapSource.hosted(mapId))
    }

    public fun setSource(source: TileflowMapSource, initialCamera: TileflowCamera? = null) {
        check(!destroyed) { "The map is destroyed." }
        if (source == this.source) return
        source.validate()
        hostedSession?.close()
        hostedSession = null
        loadable = null
        retireGeneration()
        this.source = source
        if (initialCamera != null) camera = initialCamera
        resetRecovery()
        if (attached) mount()
    }

    /** Null selects the authored default. "system" follows the map's declared system themes. */
    public suspend fun setTheme(
        theme: String?,
        timeOfDay: TileflowTimeOfDay? = null,
        durationMillis: Long = 0,
    ) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        if (
            (theme != null && (theme.isEmpty() || theme.length > 128)) || durationMillis !in 0..5000
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        this.theme = theme
        val payload =
            JSONObject()
                .put("theme", theme ?: JSONObject.NULL)
                .put("colorScheme", colorScheme())
                .put("duration", durationMillis)
        timeOfDay?.let { payload.put("timeOfDay", it.wireName) }
        appearance = ProtocolContract.Method.SET_THEME to payload
        applyAppearance()
    }

    public suspend fun setBlend(
        themes: List<String>,
        position: Double,
        hold: Boolean = false,
        durationMillis: Long = 0,
    ) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        if (
            themes.size !in 2..8 ||
                themes.toSet().size != themes.size ||
                themes.any { it.isEmpty() || it.length > 128 || it == "system" } ||
                position !in 0.0..(themes.size - 1).toDouble() ||
                durationMillis !in 0..5000
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        appearance =
            ProtocolContract.Method.SET_BLEND to
                JSONObject()
                    .put("themes", JSONArray(themes))
                    .put("position", position)
                    .put("hold", hold)
                    .put("duration", durationMillis)
        applyAppearance()
    }

    public suspend fun setOptions(options: TileflowMapOptions) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        options.events.validate()
        val previous = this.options
        this.options = options
        subscriptions = EventSubscriptions(options.events)
        val bridge = bridge?.takeIf { initialized } ?: return
        bridge.call(ProtocolContract.Method.SET_OPTIONS, options.json())
        if (options.events != previous.events)
            bridge.call(
                ProtocolContract.Method.SET_EVENTS,
                JSONObject().put("events", subscriptions.json()),
            )
    }

    private suspend fun applyAppearance() {
        val request = appearance ?: return
        if (initialized) bridge?.call(request.first, request.second)
    }

    /** Replaces application content, preserving it across theme and renderer replacement. */
    public suspend fun setContent(
        annotations: List<TileflowAnnotation> = emptyList(),
        layers: List<TileflowGeoJSONLayer> = emptyList(),
    ) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val next = MapContent(annotations.toList(), layers.toList())
        next.validate()
        val previous = content
        val revision = ++contentRevision
        content = next
        try {
            if (initialized) bridge?.let { send(next, it) }
        } catch (error: Exception) {
            if (contentRevision == revision) content = previous
            throw error
        }
    }

    private suspend fun send(content: MapContent, bridge: MapBridge) {
        val (payload, references) = content.json(bridge.data)
        bridge.call(ProtocolContract.Method.SET_CONTENT, payload, references)
    }

    public suspend fun setCamera(camera: TileflowCamera, durationMillis: Long = 0) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        if (
            camera.longitude !in -180.0..180.0 ||
                camera.latitude !in -90.0..90.0 ||
                camera.zoom !in 0.0..24.0 ||
                camera.bearing !in -360.0..360.0 ||
                camera.pitch !in 0.0..85.0 ||
                durationMillis !in 0..60_000
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        this.camera = camera
        if (initialized)
            bridge?.call(
                ProtocolContract.Method.SET_CAMERA,
                JSONObject().put("camera", camera.json()).put("duration", durationMillis),
            )
    }

    public suspend fun camera(): TileflowCamera {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        if (!initialized) throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val result =
            bridge?.call(ProtocolContract.Method.GET_CAMERA) as? JSONObject
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        return TileflowCamera.from(result)
    }

    /** Returns rendered feature identities at physical pixels relative to this view. */
    public suspend fun query(x: Float, y: Float): List<TileflowRenderedFeature> {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val point = cssPoint(x, y)
        if (!initialized) throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val result =
            bridge?.call(ProtocolContract.Method.QUERY_AT_POINT, point) as? JSONArray
                ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
        return (0 until result.length()).map { index ->
            val feature = result.getJSONObject(index)
            TileflowRenderedFeature(
                if (feature.isNull("id")) null else feature.getString("id"),
                feature.getString("source"),
                feature.getString("layer"),
            )
        }
    }

    public suspend fun fit(
        bounds: TileflowBounds,
        padding: Float = 24f,
        maxZoom: Double = 20.0,
        durationMillis: Long = 0,
    ) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        if (
            bounds.west !in -180.0..180.0 ||
                bounds.east !in -180.0..180.0 ||
                bounds.south !in -90.0..90.0 ||
                bounds.north !in -90.0..90.0 ||
                bounds.south > bounds.north ||
                padding !in 0f..1000f ||
                maxZoom !in 0.0..24.0 ||
                durationMillis !in 0..5000
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        bridge.call(
            ProtocolContract.Method.FIT_BOUNDS,
            JSONObject()
                .put("west", bounds.west)
                .put("east", bounds.east)
                .put("south", bounds.south)
                .put("north", bounds.north)
                .put("padding", (padding / resources.displayMetrics.density).toDouble())
                .put("maxZoom", maxZoom)
                .put("duration", durationMillis),
        )
    }

    /** Physical pixels relative to this view. */
    public suspend fun project(coordinate: TileflowCoordinate): TileflowPoint {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val point =
            bridge.call(
                ProtocolContract.Method.PROJECT,
                JSONObject()
                    .put("longitude", coordinate.longitude)
                    .put("latitude", coordinate.latitude),
            ) as JSONObject
        val density = resources.displayMetrics.density
        return TileflowPoint(
            point.getDouble("x").toFloat() * density,
            point.getDouble("y").toFloat() * density,
        )
    }

    public suspend fun unproject(point: TileflowPoint): TileflowCoordinate {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val css = cssPoint(point.x, point.y)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val coordinate = bridge.call(ProtocolContract.Method.UNPROJECT, css) as JSONObject
        return TileflowCoordinate(
            coordinate.getDouble("longitude"),
            coordinate.getDouble("latitude"),
        )
    }

    /** Points may lie outside the view, within the renderer's coordinate range. */
    private fun cssPoint(x: Float, y: Float): JSONObject {
        val density = resources.displayMetrics.density
        val cssX = (x / density).toDouble()
        val cssY = (y / density).toDouble()
        if (!cssX.isFinite() || !cssY.isFinite() || abs(cssX) > 32_768 || abs(cssY) > 32_768)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        return JSONObject().put("x", cssX).put("y", cssY)
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        attached = true
        lifecycleOwner = findViewTreeLifecycleOwner()
        lifecycleOwner?.lifecycle?.addObserver(lifecycleObserver)
        if (webView == null && source != null && !destroyed && !pendingRemount) mount()
        updateVisibility()
    }

    override fun onDetachedFromWindow() {
        attached = false
        lifecycleOwner?.lifecycle?.removeObserver(lifecycleObserver)
        lifecycleOwner = null
        super.onDetachedFromWindow()
        updateVisibility()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        updateVisibility()
    }

    private fun isVisibleToUser(): Boolean =
        attached &&
            windowVisibility == View.VISIBLE &&
            (lifecycleOwner?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) != false)

    private fun updateVisibility() {
        if (destroyed) return
        val visible = isVisibleToUser()
        hostedSession?.setBackgrounded(!visible)
        if (visible == rendererVisible) return
        rendererVisible = visible
        if (visible && pendingRemount) {
            retireGeneration()
            mount()
            return
        }
        if (visible) webView?.onResume() else webView?.onPause()
        if (!initialized) return
        scope.launch {
            try {
                bridge?.call(
                    ProtocolContract.Method.SET_VISIBILITY,
                    JSONObject().put("visible", visible),
                )
            } catch (_: TileflowMapException) {
                /* Initial visibility may precede the handshake. */
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (
            destroyed || theme != "system" || appearance?.first == ProtocolContract.Method.SET_BLEND
        )
            return
        scope.launch {
            try {
                val previous = appearance
                if (previous == null) setTheme(theme)
                else {
                    appearance =
                        previous.first to
                            JSONObject(previous.second.toString()).put("colorScheme", colorScheme())
                    applyAppearance()
                }
            } catch (error: TileflowMapException) {
                // The theme is applied again to the next renderer if this one was replaced.
                if (!destroyed && error.code != TileflowErrorCode.CANCELLED)
                    onEvent(TileflowMapEvent.Failed(error.code, error.context))
            }
        }
    }

    public fun destroy() {
        if (destroyed) return
        destroyed = true
        lifecycleOwner?.lifecycle?.removeObserver(lifecycleObserver)
        lifecycleOwner = null
        hostedSession?.close()
        hostedSession = null
        loadable = null
        retireGeneration(TileflowErrorCode.DISPOSED)
        scope.cancel()
        onEvent = {}
    }

    /**
     * Retry the current source after a load or renderer failure. A Hosted session stopped by
     * [TileflowErrorCode.CREDENTIAL_REJECTED], [TileflowErrorCode.ACCESS_DENIED],
     * [TileflowErrorCode.QUOTA_EXCEEDED] or [TileflowErrorCode.SESSION_REJECTED] bootstraps again.
     * Reloading also skips the delay that follows a temporary session failure
     * ([TileflowErrorCode.RATE_LIMITED], [TileflowErrorCode.SESSION_UNAVAILABLE] or
     * [TileflowErrorCode.INVALID_SESSION_RESPONSE]), so call it in response to a user action rather
     * than from every failure event.
     */
    public fun reload() {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        hostedSession?.retry()
        resetRecovery()
        retireGeneration()
        if (attached && source != null) mount()
    }

    private fun resetRecovery() {
        recoveries = 0
        automaticReloadAvailable.set(true)
        pendingRemount = false
    }

    /** Replace the renderer, keeping the Hosted session; a hidden view replaces it once visible. */
    private fun remount() {
        retireGeneration()
        if (isVisibleToUser()) mount() else pendingRemount = true
    }

    /**
     * A load that fails while hidden, for example because the system suspended its networking,
     * reloads once visible instead of reporting a failure nobody saw.
     */
    private fun report(
        code: TileflowErrorCode,
        current: Int,
        context: TileflowErrorContext = TileflowErrorContext.NONE,
    ) {
        if (destroyed || generation != current) return
        if (!generationReady && !isVisibleToUser()) {
            pendingRemount = true
            return
        }
        onEvent(TileflowMapEvent.Failed(code, context))
    }

    private fun contentReady() {
        generationReady = true
        resetRecovery()
        onEvent(TileflowMapEvent.ContentReady)
    }

    private fun colorScheme(): String =
        if (
            resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
                Configuration.UI_MODE_NIGHT_YES
        )
            "dark"
        else "light"

    @SuppressLint("SetJavaScriptEnabled")
    private fun mount() {
        val source = source ?: return
        try {
            // A failed read is not kept, so reload() reads a corrected configuration.
            val loadable =
                this.loadable
                    ?: source
                        .loadable { Tileflow.configuration(context) }
                        .also { this.loadable = it }
            if (
                !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
                    !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ||
                    !WebViewRequirement.isSupported(
                        WebViewCompat.getCurrentWebViewPackage(context)?.versionName
                    )
            ) {
                throw TileflowMapException(TileflowErrorCode.INCOMPATIBLE_RUNTIME)
            }
            // The receipt is read once per process; the files are verified once, off the main
            // thread, while the WebView starts.
            val receipt = EmbeddedRuntime.receipt(context.assets)
            EmbeddedRuntime.failure?.let { throw it }
            EmbeddedRuntime.verification(context.assets)
            TileflowDeviceProfile.current(context)
            generation += 1
            val current = generation
            pendingRemount = false
            // A new document starts shown; it is hidden after initialization if the view is not.
            rendererVisible = true
            val endpoint = loadable.hosted
            if (
                hostedSession == null &&
                    endpoint != null &&
                    loadable.mapId != null &&
                    loadable.surfaceId != null
            ) {
                hostedSession = HostedSession(endpoint, loadable.mapId, loadable.surfaceId)
            }
            hostedSession?.setBackgrounded(!isVisibleToUser())
            val resourceLoader =
                ResourceLoader(
                    loadable.policy,
                    hosted = hostedSession,
                    apiOrigin = endpoint?.apiOrigin,
                    publicMetadataUrls = loadable.publicMetadataUrls,
                    cache = TileflowMapCache.get(context).store,
                    grantScope = loadable.grantScope,
                    onDeploymentSuperseded = {
                        // A protected style belongs to a superseded deployment: reload once.
                        automaticReloadAvailable.compareAndSet(true, false).also { reload ->
                            if (reload)
                                post { if (!destroyed && generation == current) remount() }
                        }
                    },
                )
            val view = WebView(context)
            view.settings.apply {
                javaScriptEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                domStorageEnabled = false
                cacheMode = WebSettings.LOAD_NO_CACHE
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }
            val mapBridge =
                MapBridge(
                    instanceId,
                    current,
                    receipt.runtimeHash,
                    view,
                    DataChannel(),
                    onHello = { readyBridge ->
                        scope.launch {
                            if (destroyed || generation != current) return@launch
                            try {
                                val startingTheme = theme
                                val startingCamera = camera
                                val startingOptions = options
                                val configuration =
                                    JSONObject()
                                        .put(
                                            "source",
                                            JSONObject()
                                                .put("map", loadable.map)
                                                .put(
                                                    "manifestUrl",
                                                    loadable.manifestUrl.toASCIIString(),
                                                )
                                                .apply {
                                                    loadable.mapId?.let {
                                                        put("discoveryMapId", it)
                                                    }
                                                },
                                        )
                                        .put("theme", theme ?: JSONObject.NULL)
                                        .put("colorScheme", colorScheme())
                                        .put("interactive", true)
                                        .put("options", options.json())
                                        .put("events", subscriptions.json())
                                camera?.let { configuration.put("camera", it.json()) }
                                readyBridge.call(ProtocolContract.Method.INITIALIZE, configuration)
                                if (destroyed || generation != current) return@launch
                                initialized = true
                                send(content, readyBridge)
                                if (appearance != null) applyAppearance()
                                else if (theme != startingTheme) setTheme(theme)
                                if (options != startingOptions) setOptions(options)
                                if (camera != startingCamera) camera?.let { setCamera(it) }
                                if (!rendererVisible)
                                    readyBridge.call(
                                        ProtocolContract.Method.SET_VISIBILITY,
                                        JSONObject().put("visible", false),
                                    )
                                readyForEvents = true
                                if (pendingReadyEvent) {
                                    pendingReadyEvent = false
                                    contentReady()
                                }
                            } catch (error: Exception) {
                                if (error is CancellationException) throw error
                                report(
                                    (error as? TileflowMapException)?.code
                                        ?: TileflowErrorCode.RENDERER_FAILED,
                                    current,
                                    (error as? TileflowMapException)?.context
                                        ?: TileflowErrorContext.NONE,
                                )
                            }
                        }
                    },
                    onEvent = { event, result ->
                        if (!destroyed && generation == current) receive(event, result, current)
                    },
                    onFailure = { error -> report(error.code, current, error.context) },
                )
            WebViewCompat.addWebMessageListener(
                view,
                "tileflowNative",
                setOf(ResourceAddress.ORIGIN),
            ) { _, message, origin, isMainFrame, _ ->
                if (
                    isMainFrame &&
                        origin.toString() == ResourceAddress.ORIGIN &&
                        !destroyed &&
                        generation == current
                ) {
                    message.data?.let(mapBridge::receive)
                }
            }
            val boot =
                JSONObject()
                    .put("instanceId", instanceId)
                    .put("generation", current)
                    .put("platform", "android")
                    .put(
                        "protocol",
                        JSONObject()
                            .put("minimum", ProtocolContract.MINIMUM_VERSION)
                            .put("maximum", ProtocolContract.VERSION),
                    )
            bootstrap =
                WebViewCompat.addDocumentStartJavaScript(
                    view,
                    "Object.defineProperty(window,'tileflowHost',{value:$boot});",
                    setOf(ResourceAddress.ORIGIN),
                )
            view.webViewClient =
                ResourceClient(
                    context.assets,
                    resourceLoader,
                    onExternalLink = {
                        if (!destroyed && generation == current)
                            onEvent(TileflowMapEvent.ExternalLinkRequested(it))
                    },
                    onFailure = { report(it.code, current, it.context) },
                    data = mapBridge.data,
                ) {
                    // The system may end a hidden renderer to reclaim memory. Replace it once
                    // visible; a renderer that ends again before its content loads is reported.
                    if (webView === view && !destroyed) {
                        if (recoveries++ < 1) remount()
                        else {
                            retireGeneration()
                            onEvent(
                                TileflowMapEvent.Failed(
                                    TileflowErrorCode.RENDERER_FAILED,
                                    TileflowErrorContext.of(
                                        ProtocolContract.ErrorReason.PROCESS_TERMINATED
                                    ),
                                )
                            )
                        }
                    }
                }
            loader = resourceLoader
            bridge = mapBridge
            webView = view
            addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            loadRuntime(view, current)
            updateVisibility()
        } catch (error: Exception) {
            retireGeneration()
            onEvent(
                TileflowMapEvent.Failed(
                    (error as? TileflowMapException)?.code ?: TileflowErrorCode.MISSING_RUNTIME,
                    (error as? TileflowMapException)?.context ?: TileflowErrorContext.NONE,
                )
            )
        }
    }

    /**
     * Loads the renderer once the embedded runtime is verified. The WebView's provider and renderer
     * start meanwhile, so verification overlaps their launch.
     */
    private fun loadRuntime(view: WebView, current: Int) {
        if (EmbeddedRuntime.isVerified) {
            view.loadUrl(ResourceAddress.RUNTIME_URL)
            return
        }
        EmbeddedRuntime.verification(context.assets).whenComplete { _, error ->
            post {
                if (destroyed || generation != current || webView !== view) return@post
                if (error == null) view.loadUrl(ResourceAddress.RUNTIME_URL)
                else {
                    val failure = EmbeddedRuntime.mapException(error)
                    retireGeneration()
                    onEvent(TileflowMapEvent.Failed(failure.code, failure.context))
                }
            }
        }
    }

    private fun receive(event: String, result: JSONObject, current: Int) {
        if (event == "contentReady" && !readyForEvents) {
            pendingReadyEvent = true
            return
        }
        val parsed =
            try {
                parseMapEvent(event, result)
            } catch (_: org.json.JSONException) {
                TileflowMapEvent.Failed(TileflowErrorCode.RENDERER_FAILED)
            } catch (_: IllegalArgumentException) {
                TileflowMapEvent.Failed(TileflowErrorCode.RENDERER_FAILED)
            }
        if (parsed is TileflowMapEvent.CameraChanged) camera = parsed.change.camera
        // Consumer callbacks execute outside parsing guards: never mask application exceptions.
        when (parsed) {
            null -> Unit
            TileflowMapEvent.ContentReady -> contentReady()
            is TileflowMapEvent.Failed -> report(parsed.code, current, parsed.context)
            else -> onEvent(parsed)
        }
    }

    /** Pending calls fail with `cancelled` when replaced and with `disposed` when destroyed. */
    private fun retireGeneration(code: TileflowErrorCode = TileflowErrorCode.CANCELLED) {
        initialized = false
        readyForEvents = false
        pendingReadyEvent = false
        generationReady = false
        rendererVisible = false
        bridge?.retire(code)
        loader?.close()
        bootstrap?.remove()
        webView?.let {
            it.stopLoading()
            WebViewCompat.removeWebMessageListener(it, "tileflowNative")
            removeView(it)
            it.destroy()
        }
        bridge = null
        loader = null
        bootstrap = null
        webView = null
    }

    public companion object {
        /**
         * Prepares what every map needs before the first one is shown: verifies the embedded
         * renderer, reads the device profile, opens the shared HTTP client and resource cache, and
         * loads the WebView provider. Call it on the main thread early, for example in
         * `Application.onCreate` or before navigating to a screen with a map; calling it again only
         * repeats the cheap checks. Maps work without it, but the first one then pays these costs
         * while it loads.
         */
        @JvmStatic
        @MainThread
        public fun prewarm(context: Context) {
            MapPrewarmer.start(context)
        }
    }

}
