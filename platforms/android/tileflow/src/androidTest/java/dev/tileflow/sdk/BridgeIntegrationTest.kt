package dev.tileflow.sdk

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewCompat
import dev.tileflow.sdk.TileflowGeoJSONLayerKind.CIRCLE
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.transport.ResourceAddress
import dev.tileflow.sdk.transport.ResourceClient
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourcePolicy
import java.io.ByteArrayInputStream
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith

public class BridgeHostActivity : ComponentActivity() {
    lateinit var root: FrameLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        root = FrameLayout(this)
        setContentView(root)
    }
}

/**
 * The bridge and data channel against a stub renderer in System WebView, through the real
 * transport. The stub answers like the embedded runtime but draws nothing, so these tests need
 * neither the fixture server nor a GPU.
 */
@RunWith(AndroidJUnit4::class)
public class BridgeIntegrationTest {
    private class Stub(
        val bridge: MapBridge,
        val webView: WebView,
        val failure: TileflowMapException?,
    )

    private fun page(selected: Int) =
        """
        <!doctype html><meta charset="utf-8"><script>
        const envelope = {protocolVersion: $selected, instanceId: 'stub', generation: 1};
        const post = (value) => tileflowNative.postMessage(JSON.stringify(value));
        const answer = (requestId, result) => post({...envelope, requestId, result});
        const hex = (buffer) => Array.from(new Uint8Array(buffer),
          (byte) => byte.toString(16).padStart(2, '0')).join('');
        const waiting = new Map();
        const cancelled = [];
        window.tileflow = {receive: async (text) => {
          const {requestId, command: {method, payload}} = JSON.parse(text);
          if (method === 'cancel') {
            cancelled.push(payload.requestId);
            waiting.get(payload.requestId)?.();
            return answer(requestId, null);
          }
          if (method === 'getCamera') {
            return waiting.set(requestId, () => post({...envelope, requestId,
              error: {code: 'cancelled', message: 'The request was cancelled.'}}));
          }
          if (method === 'queryAtPoint') return answer(requestId, cancelled);
          if (method === 'project') {
            const response = await fetch('/data/' + payload.id);
            return answer(requestId, {status: response.status});
          }
          if (method === 'setContent') {
            const started = performance.now();
            const results = [];
            const references = new Map(
              payload.overlays.map((overlay) => [overlay.data.id, overlay.data]));
            for (const reference of references.values()) {
              const response = await fetch('/data/' + reference.id);
              const bytes = await response.arrayBuffer();
              const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
              const value = JSON.parse(new TextDecoder().decode(bytes));
              results.push({id: reference.id, bytes: bytes.byteLength,
                verified: digest === reference.sha256, features: value.features.length});
            }
            return answer(requestId, {results, milliseconds: performance.now() - started});
          }
          post({...envelope, requestId, error: {code: 'invalidRequest', message: method}});
        }};
        post({...envelope, event: 'hello', result: {runtimeHash: 'stub', protocol: {
          minimum: $selected, maximum: $selected, selected: $selected}}});
        </script>
        """
            .trimIndent()
            .toByteArray()

    private fun <T> withActivity(body: suspend (BridgeHostActivity) -> T): T {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent =
            Intent(instrumentation.context, BridgeHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as BridgeHostActivity
        try {
            return runBlocking { withContext(Dispatchers.Main) { body(activity) } }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    private suspend fun stub(
        activity: BridgeHostActivity,
        selected: Int = ProtocolContract.VERSION,
    ): Stub {
        val view = WebView(activity)
        view.settings.javaScriptEnabled = true
        val data = DataChannel()
        val resources =
            ResourceClient(
                activity.assets,
                ResourceLoader(ResourcePolicy(emptySet())),
                onExternalLink = {},
                onFailure = {},
                data = data,
            ) {}
        val stubPage = page(selected)
        view.webViewClient =
            object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse? =
                    if (request.url.toString() == ResourceAddress.RUNTIME_URL)
                        WebResourceResponse("text/html", "UTF-8", ByteArrayInputStream(stubPage))
                    else resources.shouldInterceptRequest(view, request)
            }
        val settled = CompletableDeferred<TileflowMapException?>()
        val bridge =
            MapBridge(
                "stub",
                1,
                "stub",
                view,
                data,
                onHello = { settled.complete(null) },
                onEvent = { _, _ -> },
                onFailure = { settled.complete(it) },
            )
        WebViewCompat.addWebMessageListener(view, "tileflowNative", setOf(ResourceAddress.ORIGIN)) {
            _,
            message,
            _,
            _,
            _ ->
            message.data?.let(bridge::receive)
        }
        activity.root.addView(view, FrameLayout.LayoutParams(320, 480))
        view.loadUrl(ResourceAddress.RUNTIME_URL)
        return Stub(bridge, view, withTimeout(30_000) { settled.await() })
    }

    @Test
    public fun aMismatchedRendererFailsWithATypedError(): Unit = withActivity { activity ->
        val stub = stub(activity, ProtocolContract.VERSION + 1)
        // A handshake that ran out of time would fail with TIMEOUT and the reason `handshake`.
        assertEquals(TileflowErrorCode.INCOMPATIBLE_RUNTIME, stub.failure?.code)
        assertEquals("protocolVersion", stub.failure?.context?.reason)
        try {
            stub.bridge.call(ProtocolContract.Method.GET_CAMERA)
            fail("A failed handshake accepted a command.")
        } catch (error: TileflowMapException) {
            assertEquals(TileflowErrorCode.DISPOSED, error.code)
        }
    }

    @Test
    public fun cancellingACallStopsItInTheRenderer(): Unit = withActivity { activity ->
        val stub = stub(activity)
        assertNull(stub.failure)
        coroutineScope {
            val call = async { stub.bridge.call(ProtocolContract.Method.GET_CAMERA) }
            delay(200)
            call.cancel()
            try {
                call.await()
                fail("A cancelled call completed.")
            } catch (_: CancellationException) {}
        }
        var cancelled = JSONArray()
        repeat(20) {
            cancelled = stub.bridge.call(ProtocolContract.Method.QUERY_AT_POINT) as JSONArray
            if (cancelled.length() > 0) return@repeat
            delay(50)
        }
        assertEquals("1", cancelled.getString(0))
        stub.bridge.retire()
    }

    /**
     * Records how a 5 MiB GeoJSON reaches the renderer over the data channel, verified by SHA-256,
     * against the message path protocol 1 used for content: a JSON value parsed and re-encoded by
     * the host, then quoted into a script. Protocol 1 capped that path at 64 KiB.
     */
    @Test
    public fun dataChannelVerifiesAndReleasesLargeGeoJSON(): Unit = withActivity { activity ->
        val stub = stub(activity)
        assertNull(stub.failure)
        val (geoJSON, features) = geoJSON(5 * 1024 * 1024)
        val timings = mutableMapOf<String, MutableList<Long>>()
        suspend fun measure(label: String, work: suspend () -> Unit) {
            val started = SystemClock.elapsedRealtimeNanos()
            work()
            timings.getOrPut(label) { mutableListOf() } +=
                (SystemClock.elapsedRealtimeNanos() - started) / 1_000_000
        }
        suspend fun evaluate(script: String): String = suspendCancellableCoroutine { continuation ->
            stub.webView.evaluateJavascript(script) { continuation.resume(it) }
        }
        repeat(3) { iteration ->
            if (iteration == 0)
                measure("message") {
                    val text = JSONObject.quote(JSONObject(geoJSON).toString())
                    assertEquals("$features", evaluate("JSON.parse($text).features.length"))
                }
            measure("script argument") {
                val text = JSONObject.quote(geoJSON)
                assertEquals("$features", evaluate("JSON.parse($text).features.length"))
            }
            measure("data channel") {
                // Both layers share the payload; it is registered and read once.
                val content =
                    MapContent(
                        overlays =
                            listOf(
                                TileflowGeoJSONLayer("points", geoJSON, CIRCLE),
                                TileflowGeoJSONLayer("outline", geoJSON, CIRCLE),
                            )
                    )
                val (payload, references) = content.json(stub.bridge.data)
                val result =
                    stub.bridge.call(ProtocolContract.Method.SET_CONTENT, payload, references)
                        as JSONObject
                val results = result.getJSONArray("results")
                assertEquals(1, results.length())
                val item = results.getJSONObject(0)
                assertEquals(geoJSON.toByteArray().size, item.getInt("bytes"))
                assertTrue(item.getBoolean("verified"))
                assertEquals(features, item.getInt("features"))
                // Nothing remains once the request settles.
                assertTrue(stub.bridge.data.isEmpty)
                val released =
                    stub.bridge.call(
                        ProtocolContract.Method.PROJECT,
                        JSONObject().put("id", references[0].id),
                    ) as JSONObject
                assertEquals(404, released.getInt("status"))
            }
        }
        val summary =
            timings.toSortedMap().map { (label, values) ->
                "$label ${values.sorted()[values.size / 2]} ms"
            }
        println(
            "Tileflow data channel, %.1f MiB GeoJSON, median of 3: %s."
                .format(geoJSON.length / 1_048_576.0, summary.joinToString(", "))
        )
        stub.bridge.retire()
    }

    internal companion object {
        /** A FeatureCollection of points of at least [bytes], and its feature count. */
        fun geoJSON(bytes: Int): Pair<String, Int> {
            val text = StringBuilder("""{"type":"FeatureCollection","features":[""")
            var count = 0
            while (text.length < bytes) {
                if (count > 0) text.append(',')
                val longitude = -3.75 + (count % 1000) / 10_000.0
                val latitude = 40.40 + (count / 1000) / 1000.0
                text.append(
                    """{"type":"Feature","id":$count,"properties":{"name":"Point $count","rank":${count % 7}},"geometry":{"type":"Point","coordinates":[$longitude,$latitude]}}"""
                )
                count += 1
            }
            return text.append("]}").toString() to count
        }
    }
}
