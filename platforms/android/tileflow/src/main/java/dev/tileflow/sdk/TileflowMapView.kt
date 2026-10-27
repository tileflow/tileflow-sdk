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
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.transport.ResourceAddress
import dev.tileflow.sdk.transport.ResourceClient
import dev.tileflow.sdk.transport.ResourceLoader
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

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
    private var recoveries = 0
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

    public fun setSource(source: TileflowMapSource, initialCamera: TileflowCamera? = null) {
        check(!destroyed) { "The map is destroyed." }
        if (source == this.source) return
        source.policy()
        hostedSession?.close()
        hostedSession = null
        retireGeneration()
        this.source = source
        if (initialCamera != null) camera = initialCamera
        recoveries = 0
        if (isAttachedToWindow) mount()
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
        this.options = options
        if (initialized) bridge?.call(ProtocolContract.Method.SET_OPTIONS, options.json())
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
        val payload = next.json()
        val previous = content
        val revision = ++contentRevision
        content = next
        try {
            if (initialized) bridge?.call(ProtocolContract.Method.SET_CONTENT, payload)
        } catch (error: Exception) {
            if (contentRevision == revision) content = previous
            throw error
        }
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
        if (!initialized) throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val density = resources.displayMetrics.density
        val result =
            bridge?.call(
                ProtocolContract.Method.QUERY_AT_POINT,
                JSONObject().put("x", (x / density).toDouble()).put("y", (y / density).toDouble()),
            ) as? JSONArray ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
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
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val density = resources.displayMetrics.density
        val coordinate =
            bridge.call(
                ProtocolContract.Method.UNPROJECT,
                JSONObject()
                    .put("x", (point.x / density).toDouble())
                    .put("y", (point.y / density).toDouble()),
            ) as JSONObject
        return TileflowCoordinate(
            coordinate.getDouble("longitude"),
            coordinate.getDouble("latitude"),
        )
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        lifecycleOwner = findViewTreeLifecycleOwner()
        lifecycleOwner?.lifecycle?.addObserver(lifecycleObserver)
        if (webView == null && source != null && !destroyed) mount()
        updateVisibility()
    }

    override fun onDetachedFromWindow() {
        lifecycleOwner?.lifecycle?.removeObserver(lifecycleObserver)
        lifecycleOwner = null
        super.onDetachedFromWindow()
        updateVisibility()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        updateVisibility()
    }

    private fun updateVisibility() {
        if (destroyed) return
        val visible =
            isAttachedToWindow &&
                windowVisibility == View.VISIBLE &&
                (lifecycleOwner?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) !=
                    false)
        hostedSession?.setBackgrounded(!visible)
        if (!initialized || visible == rendererVisible) return
        rendererVisible = visible
        if (visible) webView?.onResume() else webView?.onPause()
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
                if (!destroyed) onEvent(TileflowMapEvent.Failed(error.code))
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
        retireGeneration()
        scope.cancel()
        onEvent = {}
    }

    /** Retry the current source after a recoverable load or renderer failure. */
    public fun reload() {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        retireGeneration()
        recoveries = 0
        if (isAttachedToWindow && source != null) mount()
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
            if (
                !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
                    !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)
            ) {
                throw TileflowMapException(TileflowErrorCode.INCOMPATIBLE_RUNTIME)
            }
            val receipt =
                JSONObject(
                    context.assets.open("tileflow/receipt.json").bufferedReader().use {
                        it.readText()
                    }
                )
            require(receipt.getInt("protocolVersion") == ProtocolContract.VERSION)
            val files = receipt.getJSONObject("files")
            require(
                files.keys().asSequence().toSet() ==
                    setOf(
                        "index.html",
                        "runtime.js",
                        "maplibre.css",
                        "notices.txt",
                        "dependencies.json",
                    )
            )
            for (name in files.keys()) {
                val bytes = context.assets.open("tileflow/$name").use { it.readBytes() }
                val actual =
                    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") {
                        "%02x".format(it)
                    }
                require(actual == files.getString(name))
            }
            generation += 1
            val current = generation
            if (
                hostedSession == null &&
                    source.client != null &&
                    source.mapId != null &&
                    source.surfaceId != null
            ) {
                hostedSession = HostedSession(source.client, source.mapId, source.surfaceId)
            }
            val resourceLoader =
                ResourceLoader(
                    source.policy(),
                    hosted = hostedSession,
                    publicMetadataUrls = source.publicMetadataUrls,
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
                    receipt.getString("runtimeHash"),
                    view,
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
                                                .put("map", source.map)
                                                .put(
                                                    "manifestUrl",
                                                    source.manifestUrl.toASCIIString(),
                                                )
                                                .apply {
                                                    source.mapId?.let { put("discoveryMapId", it) }
                                                },
                                        )
                                        .put("theme", theme ?: JSONObject.NULL)
                                        .put("colorScheme", colorScheme())
                                        .put("interactive", true)
                                        .put("options", options.json())
                                camera?.let { configuration.put("camera", it.json()) }
                                readyBridge.call(ProtocolContract.Method.INITIALIZE, configuration)
                                if (destroyed || generation != current) return@launch
                                initialized = true
                                updateVisibility()
                                readyBridge.call(
                                    ProtocolContract.Method.SET_CONTENT,
                                    content.json(),
                                )
                                if (appearance != null) applyAppearance()
                                else if (theme != startingTheme) setTheme(theme)
                                if (options != startingOptions) setOptions(options)
                                if (camera != startingCamera) camera?.let { setCamera(it) }
                                updateVisibility()
                                readyForEvents = true
                                if (pendingReadyEvent) {
                                    pendingReadyEvent = false
                                    onEvent(TileflowMapEvent.ContentReady)
                                }
                            } catch (error: Exception) {
                                if (error is CancellationException) throw error
                                if (!destroyed && generation == current) {
                                    onEvent(
                                        TileflowMapEvent.Failed(
                                            (error as? TileflowMapException)?.code
                                                ?: TileflowErrorCode.RENDERER_FAILED
                                        )
                                    )
                                }
                            }
                        }
                    },
                    onEvent = { event, result ->
                        if (!destroyed && generation == current) receive(event, result)
                    },
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
                    onFailure = {
                        if (!destroyed && generation == current)
                            onEvent(TileflowMapEvent.Failed(it))
                    },
                ) {
                    if (webView === view && !destroyed) {
                        retireGeneration()
                        if (recoveries++ < 1) mount()
                        else onEvent(TileflowMapEvent.Failed(TileflowErrorCode.RENDERER_FAILED))
                    }
                }
            loader = resourceLoader
            bridge = mapBridge
            webView = view
            addView(view, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            view.loadUrl(ResourceAddress.RUNTIME_URL)
        } catch (error: Exception) {
            retireGeneration()
            onEvent(
                TileflowMapEvent.Failed(
                    (error as? TileflowMapException)?.code ?: TileflowErrorCode.MISSING_RUNTIME
                )
            )
        }
    }

    private fun receive(event: String, result: JSONObject) {
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
        if (parsed is TileflowMapEvent.CameraChanged) camera = parsed.camera
        // Consumer callbacks execute outside parsing guards: never mask application exceptions.
        if (parsed != null) onEvent(parsed)
    }

    private fun retireGeneration() {
        initialized = false
        readyForEvents = false
        pendingReadyEvent = false
        rendererVisible = true
        bridge?.retire()
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
}
