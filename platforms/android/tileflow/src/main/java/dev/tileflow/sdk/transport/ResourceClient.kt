package dev.tileflow.sdk.transport

import android.content.res.AssetManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import java.io.ByteArrayInputStream
import java.net.URI

internal class ResourceClient(
    private val assets: AssetManager,
    private val loader: ResourceLoader,
    private val onExternalLink: (URI) -> Unit,
    private val onFailure: (TileflowErrorCode) -> Unit,
    private val onProcessGone: () -> Unit,
) : WebViewClient() {
    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse {
        return try {
            val url = URI(request.url.toString())
            require(url.scheme == "https" && url.host == "tileflow.invalid" && url.port == -1)
            require(url.userInfo == null && url.rawQuery == null && url.rawFragment == null)
            if (url.rawPath.startsWith("/runtime/")) {
                val name = url.rawPath.removePrefix("/runtime/")
                require(Regex("^[a-zA-Z0-9_-]+\\.(html|js|css|json)$").matches(name))
                val type =
                    when (name.substringAfterLast('.')) {
                        "html" -> "text/html"
                        "js" -> "text/javascript"
                        "css" -> "text/css"
                        else -> "application/json"
                    }
                WebResourceResponse(
                    type,
                    "UTF-8",
                    200,
                    "OK",
                    mapOf("Cache-Control" to "no-store"),
                    assets.open("tileflow/$name"),
                )
            } else {
                val range =
                    request.requestHeaders.entries
                        .firstOrNull { it.key.equals("Range", ignoreCase = true) }
                        ?.value
                val payload = loader.load(ResourceAddress.decode(url), request.method, range)
                WebResourceResponse(
                    payload.headers["Content-Type"]?.substringBefore(';')
                        ?: "application/octet-stream",
                    null,
                    payload.status,
                    if (payload.status < 400) "OK" else "Resource error",
                    payload.headers + ("Access-Control-Allow-Origin" to ResourceAddress.ORIGIN),
                    ByteArrayInputStream(payload.bytes),
                )
            }
        } catch (error: Exception) {
            if (error is TileflowMapException) view.post { onFailure(error.code) }
            // Fail closed, including unexpected origins. Never allow WebView to fetch them itself.
            WebResourceResponse(
                "text/plain",
                "UTF-8",
                403,
                "Resource denied",
                mapOf("Cache-Control" to "no-store"),
                ByteArrayInputStream(ByteArray(0)),
            )
        }
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (request.hasGesture() && request.isForMainFrame) {
            val uri = runCatching { URI(request.url.toString()) }.getOrNull()
            if (uri != null && uri.scheme in setOf("https", "http") && uri.userInfo == null)
                onExternalLink(uri)
        }
        return true
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onProcessGone()
        return true
    }
}
