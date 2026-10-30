package dev.tileflow.sdk.bridge

import android.webkit.WebView
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONObject

/** Accessed only on the UI dispatcher. A bridge is never reused for a new document generation. */
internal class MapBridge(
    private val instanceId: String,
    private val generation: Int,
    private val runtimeHash: String,
    private val webView: WebView,
    private val onHello: (MapBridge) -> Unit,
    private val onEvent: (String, JSONObject) -> Unit,
) {
    private val pending = mutableMapOf<String, CompletableDeferred<Any>>()
    private var sequence = 0L
    private var ready = false
    private var retired = false
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handshakeTimeout = scope.launch {
        delay(ProtocolContract.REQUEST_TIMEOUT_MILLIS)
        if (!ready && !retired) {
            onEvent("error", JSONObject().put("code", "timeout"))
            retire()
        }
    }

    fun receive(text: String) {
        if (
            retired ||
                text.toByteArray(Charsets.UTF_8).size > ProtocolContract.MAXIMUM_MESSAGE_BYTES
        )
            return
        val message =
            try {
                JSONObject(text)
            } catch (_: Exception) {
                return
            }
        if (
            message.optInt("protocolVersion") != ProtocolContract.VERSION ||
                message.optString("instanceId") != instanceId ||
                message.optInt("generation") != generation
        )
            return
        val id = message.optString("requestId")
        if (id.isNotEmpty()) {
            val request = pending.remove(id) ?: return
            val error = message.optJSONObject("error")
            if (error == null) request.complete(message.opt("result") ?: JSONObject.NULL)
            else request.completeExceptionally(TileflowMapException(error(error.optString("code"))))
            return
        }
        val event = message.optString("event")
        val result = message.optJSONObject("result") ?: JSONObject()
        if (event == "hello") {
            if (ready) return
            if (result.optString("runtimeHash") != runtimeHash) {
                onEvent("error", JSONObject().put("code", "incompatibleRuntime"))
                retire()
                return
            }
            ready = true
            handshakeTimeout.cancel()
            onHello(this)
        } else if (ready) {
            onEvent(event, result)
        }
    }

    suspend fun call(method: ProtocolContract.Method, payload: Any = JSONObject.NULL): Any {
        if (retired) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        if (!ready) throw TileflowMapException(TileflowErrorCode.NOT_READY)
        if (pending.size >= ProtocolContract.MAXIMUM_PENDING_REQUESTS)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val id = (++sequence).toString()
        val message =
            JSONObject()
                .put("protocolVersion", ProtocolContract.VERSION)
                .put("instanceId", instanceId)
                .put("generation", generation)
                .put("requestId", id)
                .put("command", JSONObject().put("method", method.wireName).put("payload", payload))
                .toString()
        if (message.toByteArray(Charsets.UTF_8).size > ProtocolContract.MAXIMUM_MESSAGE_BYTES) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        val result = CompletableDeferred<Any>()
        pending[id] = result
        try {
            // Only a JSON-quoted string is interpolated; method names and user values are data.
            webView.evaluateJavascript(
                "window.tileflow.receive(${JSONObject.quote(message)});",
                null,
            )
            return withTimeout(ProtocolContract.REQUEST_TIMEOUT_MILLIS) { result.await() }
        } catch (_: TimeoutCancellationException) {
            throw TileflowMapException(TileflowErrorCode.TIMEOUT)
        } finally {
            pending.remove(id)
        }
    }

    fun retire() {
        if (retired) return
        retired = true
        ready = false
        scope.cancel()
        val requests = pending.values.toList()
        pending.clear()
        requests.forEach {
            it.completeExceptionally(TileflowMapException(TileflowErrorCode.DISPOSED))
        }
    }

    companion object {
        fun error(code: String): TileflowErrorCode =
            when (code) {
                "notReady" -> TileflowErrorCode.NOT_READY
                "disposed",
                "cancelled" -> TileflowErrorCode.DISPOSED
                "timeout" -> TileflowErrorCode.TIMEOUT
                "resourceFailed" -> TileflowErrorCode.RESOURCE_FAILED
                "invalidRequest" -> TileflowErrorCode.INVALID_REQUEST
                "versionMismatch",
                "incompatibleRuntime" -> TileflowErrorCode.INCOMPATIBLE_RUNTIME
                else -> TileflowErrorCode.RENDERER_FAILED
            }
    }
}
