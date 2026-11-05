package dev.tileflow.sdk

import android.webkit.WebView
import org.robolectric.RuntimeEnvironment
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
public class ProtocolTest {
    private fun hello(version: Int, selected: Int?, hash: String = "runtime-hash"): String =
        JSONObject()
            .put("protocolVersion", version)
            .put("instanceId", "view")
            .put("generation", 1)
            .put("event", "hello")
            .put(
                "result",
                JSONObject()
                    .put("runtimeHash", hash)
                    .put(
                        "protocol",
                        JSONObject()
                            .put("minimum", version)
                            .put("maximum", version)
                            .put("selected", selected ?: JSONObject.NULL),
                    ),
            )
            .toString()

    private fun handshake(
        message: String,
        instance: String = "view",
    ): Pair<Boolean, TileflowMapException?> {
        var ready = false
        var failure: TileflowMapException? = null
        val bridge =
            MapBridge(
                instance,
                1,
                "runtime-hash",
                WebView(RuntimeEnvironment.getApplication()),
                onHello = { ready = true },
                onEvent = { _, _ -> },
                onFailure = { failure = it },
            )
        bridge.receive(message)
        bridge.retire()
        return ready to failure
    }

    @Test
    public fun handshakeAcceptsOnlyTheEmbeddedRendererAtASharedVersion() {
        val version = ProtocolContract.VERSION
        assertTrue(handshake(hello(version, version)).first)
        // A renderer of another version is a typed incompatibility, never a silent timeout.
        for (message in
            listOf(
                hello(version + 1, version + 1),
                hello(version, null),
                hello(version, version + 1),
            )) {
            val (ready, failure) = handshake(message)
            assertFalse(ready)
            assertEquals(TileflowErrorCode.INCOMPATIBLE_RUNTIME, failure?.code)
            assertEquals("protocolVersion", failure?.context?.reason)
            assertEquals(false, failure?.isRecoverable)
        }
        assertEquals(
            "runtimeHash",
            handshake(hello(version, version, "other")).second?.context?.reason,
        )
        // Messages for another view are not this bridge's handshake.
        assertEquals(false to null, handshake(hello(version + 1, null), instance = "other"))
    }
}
