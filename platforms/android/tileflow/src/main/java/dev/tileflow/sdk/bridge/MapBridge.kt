package dev.tileflow.sdk.bridge

import android.webkit.WebView
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.TileflowMapException
import kotlinx.coroutines.CancellationException
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
import org.json.JSONTokener

/** Accessed only on the UI dispatcher. A bridge is never reused for a new document generation. */
internal class MapBridge(
    private val instanceId: String,
    private val generation: Int,
    private val runtimeHash: String,
    private val webView: WebView,
    /** Payloads this generation's requests carry; the transport serves them to the renderer. */
    val data: DataChannel = DataChannel(),
    private val onHello: (MapBridge) -> Unit,
    private val onEvent: (String, JSONObject) -> Unit,
    /** The handshake failed: the renderer is not usable in this generation. */
    private val onFailure: (TileflowMapException) -> Unit = {},
) {
    private val pending = mutableMapOf<String, CompletableDeferred<Any>>()
    private var sequence = 0L
    private var version: Int? = null
    private var retired = false
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val handshakeTimeout =
        scope.launch {
            delay(ProtocolContract.REQUEST_TIMEOUT_MILLIS)
            if (version == null && !retired)
                fail(
                    TileflowMapException(
                        TileflowErrorCode.TIMEOUT,
                        TileflowErrorContext.of(ProtocolContract.ErrorReason.HANDSHAKE),
                    )
                )
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
            message.optString("instanceId") != instanceId ||
                message.optInt("generation") != generation
        )
            return
        val negotiated = version
        if (negotiated == null) {
            if (!message.has("requestId") && message.optString("event") == "hello") hello(message)
            return
        }
        if (message.optInt("protocolVersion") != negotiated) return
        val id = message.optString("requestId")
        if (id.isNotEmpty()) {
            val request = pending.remove(id) ?: return
            val error = message.optJSONObject("error")
            val chunks = message.optInt("chunks", 0)
            when {
                error != null -> request.completeExceptionally(TileflowMapException.fromWire(error))
                chunks > 0 && !message.has("result") -> request.complete(Chunks(chunks))
                else -> request.complete(message.opt("result") ?: JSONObject.NULL)
            }
            return
        }
        val event = message.optString("event")
        if (event.isNotEmpty() && event != "hello")
            onEvent(event, message.optJSONObject("result") ?: JSONObject())
    }

    /**
     * Accepts the renderer only when it is the embedded one and both sides chose one version. A
     * mismatch is reported as a typed error rather than left to time out.
     */
    private fun hello(message: JSONObject) {
        val result = message.optJSONObject("result") ?: JSONObject()
        val selected = result.optJSONObject("protocol")?.opt("selected") as? Int
        if (
            selected == null ||
                selected != message.optInt("protocolVersion") ||
                selected !in ProtocolContract.MINIMUM_VERSION..ProtocolContract.VERSION
        ) {
            fail(incompatible(ProtocolContract.ErrorReason.PROTOCOL_VERSION))
            return
        }
        if (result.optString("runtimeHash") != runtimeHash) {
            fail(incompatible(ProtocolContract.ErrorReason.RUNTIME_HASH))
            return
        }
        version = selected
        handshakeTimeout.cancel()
        onHello(this)
    }

    private fun incompatible(reason: ProtocolContract.ErrorReason) =
        TileflowMapException(
            TileflowErrorCode.INCOMPATIBLE_RUNTIME,
            TileflowErrorContext.of(reason),
        )

    private fun fail(error: TileflowMapException) {
        retire(TileflowErrorCode.CANCELLED)
        onFailure(error)
    }

    /** A result larger than a control message, read in this many parts. */
    private class Chunks(val count: Int)

    /**
     * Sends a command. [references] are payloads this request carries; they are released however
     * the request ends. Cancelling the calling coroutine cancels the command in the renderer too.
     *
     * A payload larger than a control message travels on the data channel, and a result larger
     * than one is read in parts, up to the data channel's limit.
     */
    suspend fun call(
        method: ProtocolContract.Method,
        payload: Any = JSONObject.NULL,
        references: List<DataChannel.Reference> = emptyList(),
    ): Any {
        try {
            val (id, reply) = send(method, payload)
            if (reply !is Chunks) return reply
            val text = StringBuilder()
            for (index in 0 until reply.count) {
                val (_, part) =
                    send(
                        ProtocolContract.Method.READ_RESULT,
                        JSONObject().put("requestId", id).put("index", index),
                    )
                text.append(
                    part as? String ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
                )
            }
            return try {
                JSONTokener(text.toString()).nextValue()
            } catch (_: Exception) {
                throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
            }
        } finally {
            data.release(references)
        }
    }

    /** Sends one request and answers its identifier with its reply. */
    private suspend fun send(method: ProtocolContract.Method, payload: Any): Pair<String, Any> {
        if (retired) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val negotiated = version ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        if (pending.size >= ProtocolContract.MAXIMUM_PENDING_REQUESTS)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val id = (++sequence).toString()
        var carried = emptyList<DataChannel.Reference>()
        try {
            val message =
                message(negotiated, id, command(method).put("payload", payload))
                    ?: run {
                        // The payload's JSON goes on the data channel; the renderer reads it first.
                        val bytes = payload.toString().toByteArray(Charsets.UTF_8)
                        val reference =
                            data.register(bytes, DataChannel.digest(bytes), "application/json")
                        carried = listOf(reference)
                        message(negotiated, id, command(method).put("payloadData", reference.json()))
                            ?: throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
                    }
            val result = CompletableDeferred<Any>()
            pending[id] = result
            try {
                send(message)
                return id to withTimeout(ProtocolContract.REQUEST_TIMEOUT_MILLIS) { result.await() }
            } catch (_: TimeoutCancellationException) {
                cancelInRenderer(id)
                throw TileflowMapException(TileflowErrorCode.TIMEOUT)
            } catch (cancellation: CancellationException) {
                cancelInRenderer(id)
                throw cancellation
            } finally {
                pending.remove(id)
            }
        } finally {
            data.release(carried)
        }
    }

    private fun command(method: ProtocolContract.Method): JSONObject =
        JSONObject().put("method", method.wireName)

    /** Stops a request's work in the renderer; nobody waits for its answer. */
    private fun cancelInRenderer(id: String) {
        val negotiated = version ?: return
        if (retired || pending.remove(id) == null) return
        send(
            message(
                negotiated,
                (++sequence).toString(),
                ProtocolContract.Method.CANCEL,
                JSONObject().put("requestId", id),
            )
        )
    }

    private fun message(
        negotiated: Int,
        id: String,
        method: ProtocolContract.Method,
        payload: Any,
    ): String =
        message(negotiated, id, command(method).put("payload", payload))
            ?: throw TileflowMapException(
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorContext(limit = ProtocolContract.MAXIMUM_MESSAGE_BYTES),
            )

    /** A request's text, or null when it exceeds a control message. */
    private fun message(negotiated: Int, id: String, command: JSONObject): String? {
        val message =
            JSONObject()
                .put("protocolVersion", negotiated)
                .put("instanceId", instanceId)
                .put("generation", generation)
                .put("requestId", id)
                .put("command", command)
                .toString()
        return message.takeIf {
            it.toByteArray(Charsets.UTF_8).size <= ProtocolContract.MAXIMUM_MESSAGE_BYTES
        }
    }

    private fun send(message: String) {
        // Only a JSON-quoted string is interpolated; method names and user values are data.
        webView.evaluateJavascript("window.tileflow.receive(${JSONObject.quote(message)});", null)
    }

    /** Pending calls fail with [code]: `cancelled` when replaced, `disposed` when destroyed. */
    fun retire(code: TileflowErrorCode = TileflowErrorCode.DISPOSED) {
        if (retired) return
        retired = true
        version = null
        scope.cancel()
        val requests = pending.values.toList()
        pending.clear()
        requests.forEach { it.completeExceptionally(TileflowMapException(code)) }
        data.retire()
    }
}
