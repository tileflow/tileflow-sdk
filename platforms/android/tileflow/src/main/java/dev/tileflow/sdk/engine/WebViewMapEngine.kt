package dev.tileflow.sdk.engine

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.view.ViewGroup
import android.webkit.WebSettings
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.WebViewRequirement
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.transport.EmbeddedRuntime
import dev.tileflow.sdk.transport.ResourceAddress
import dev.tileflow.sdk.transport.ResourceClient
import dev.tileflow.sdk.transport.ResourceLoader
import org.json.JSONObject

/**
 * Draws a map with the embedded web runtime in a system WebView. The runtime is served from the
 * application's assets, every map resource goes through the generation's [ResourceLoader], and
 * commands and events travel through a [MapBridge].
 *
 * Create one only after [prepare] succeeded: it checks the WebView features the engine uses.
 */
@SuppressLint("SetJavaScriptEnabled", "RequiresFeature")
internal class WebViewMapEngine(
    context: Context,
    instanceId: String,
    generation: Int,
    receipt: EmbeddedRuntime.Receipt,
    private val loader: ResourceLoader,
    private val callbacks: MapEngineCallbacks,
) : MapEngine {
    private val webView = WebView(context)
    private val bridge: MapBridge
    private val bootstrap: ScriptHandler
    private var retired = false

    override val view: WebView
        get() = webView

    override val data: DataChannel
        get() = bridge.data

    init {
        // A long press is the map's gesture, not text selection.
        webView.setOnLongClickListener { true }
        webView.isLongClickable = false
        webView.isHapticFeedbackEnabled = false
        webView.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
            cacheMode = WebSettings.LOAD_NO_CACHE
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        bridge =
            MapBridge(
                instanceId,
                generation,
                receipt.runtimeHash,
                webView,
                DataChannel(),
                onHello = { callbacks.ready(this) },
                onEvent = callbacks.event,
                onFailure = callbacks.failed,
            )
        WebViewCompat.addWebMessageListener(
            webView,
            LISTENER,
            setOf(ResourceAddress.ORIGIN),
        ) { _, message, origin, isMainFrame, _ ->
            if (isMainFrame && origin.toString() == ResourceAddress.ORIGIN && !retired) {
                message.data?.let(bridge::receive)
            }
        }
        val boot =
            JSONObject()
                .put("instanceId", instanceId)
                .put("generation", generation)
                .put("platform", "android")
                .put(
                    "protocol",
                    JSONObject()
                        .put("minimum", ProtocolContract.MINIMUM_VERSION)
                        .put("maximum", ProtocolContract.VERSION),
                )
        bootstrap =
            WebViewCompat.addDocumentStartJavaScript(
                webView,
                "Object.defineProperty(window,'tileflowHost',{value:$boot});",
                setOf(ResourceAddress.ORIGIN),
            )
        webView.webViewClient =
            ResourceClient(
                context.assets,
                loader,
                onExternalLink = { if (!retired) callbacks.externalLink(it) },
                onFailure = callbacks.failed,
                data = bridge.data,
            ) {
                if (!retired) callbacks.rendererGone(this, ProtocolContract.ErrorReason.PROCESS_TERMINATED)
            }
    }

    /**
     * Loads the renderer once the embedded runtime is verified. The WebView's provider and renderer
     * start meanwhile, so verification overlaps their launch.
     */
    override fun start() {
        if (EmbeddedRuntime.isVerified) {
            webView.loadUrl(ResourceAddress.RUNTIME_URL)
            return
        }
        EmbeddedRuntime.verification(webView.context.assets).whenComplete { _, error ->
            webView.post {
                if (retired) return@post
                if (error == null) webView.loadUrl(ResourceAddress.RUNTIME_URL)
                else callbacks.loadFailed(this, EmbeddedRuntime.mapException(error))
            }
        }
    }

    override suspend fun call(
        method: ProtocolContract.Method,
        payload: Any,
        references: List<DataChannel.Reference>,
    ): Any = bridge.call(method, payload, references)

    override fun setVisible(visible: Boolean) {
        if (visible) webView.onResume() else webView.onPause()
    }

    override fun retire(code: TileflowErrorCode) {
        if (retired) return
        retired = true
        bridge.retire(code)
        loader.close()
        bootstrap.remove()
        webView.stopLoading()
        WebViewCompat.removeWebMessageListener(webView, LISTENER)
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    companion object {
        private const val LISTENER = "tileflowNative"

        private var prewarmed = false

        fun prewarm(context: Context) {
            EmbeddedRuntime.verification(context.assets)
            if (prewarmed) return
            val view = runCatching { WebView(context) }.getOrNull() ?: return
            prewarmed = true
            view.settings.javaScriptEnabled = false
            view.loadUrl("about:blank")
            Handler(Looper.getMainLooper()).postDelayed({ view.destroy() }, 10_000)
        }

        /**
         * Checks that the system WebView can run the embedded runtime and reads the runtime's
         * receipt. Its files are verified once per process, off the main thread, while the WebView
         * starts.
         */
        fun prepare(context: Context): EmbeddedRuntime.Receipt {
            if (
                !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
                    !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ||
                    !WebViewRequirement.isSupported(
                        WebViewCompat.getCurrentWebViewPackage(context)?.versionName
                    )
            ) {
                throw TileflowMapException(TileflowErrorCode.INCOMPATIBLE_RUNTIME)
            }
            val receipt = EmbeddedRuntime.receipt(context.assets)
            EmbeddedRuntime.failure?.let { throw it }
            EmbeddedRuntime.verification(context.assets)
            return receipt
        }
    }
}
