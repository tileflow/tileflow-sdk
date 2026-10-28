package dev.tileflow.sdk

import android.webkit.WebView
import org.robolectric.RuntimeEnvironment
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.EventSubscriptions
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
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

    @Test
    public fun terminalCodesNeedTheApplicationToAct() {
        assertEquals(
            setOf(
                TileflowErrorCode.INVALID_SOURCE,
                TileflowErrorCode.MISSING_RUNTIME,
                TileflowErrorCode.INCOMPATIBLE_RUNTIME,
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorCode.DISPOSED,
                TileflowErrorCode.CREDENTIAL_REJECTED,
                TileflowErrorCode.ACCESS_DENIED,
                TileflowErrorCode.QUOTA_EXCEEDED,
                TileflowErrorCode.SESSION_REJECTED,
                TileflowErrorCode.MISSING_CREDENTIAL,
                TileflowErrorCode.INVALID_CONFIGURATION,
            ),
            TileflowErrorCode.entries.filterNot { it.isRecoverable }.toSet(),
        )
        for (code in ProtocolContract.RUNTIME_ERRORS)
            assertNotNull(code, TileflowErrorCode.fromWire(code))
    }

    @Test
    public fun eventLevelsAreCumulativeAndOnlyChosenEventsAreRequested() {
        // What the application asks for; the SDK's own owners are checked below.
        fun requested(options: TileflowEventOptions) =
            EventSubscriptions.demand(options).mapKeys { it.key.wireName }
        val essential = requested(TileflowEventOptions())
        assertEquals(0L, essential["cameraMoveEnded"])
        assertNull(essential["cameraMoveStarted"])
        assertNull(essential["cameraMoved"])
        assertNull(essential["hello"])
        assertNull(essential["error"])
        val camera = requested(TileflowEventOptions(TileflowEventLevel.CAMERA))
        assertEquals(0L, camera["cameraMoveStarted"])
        assertNull(camera["cameraMoved"])
        val continuous = requested(TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 250))
        assertEquals(250L, continuous["cameraMoved"])
        assertTrue(continuous.keys.containsAll(camera.keys))
        assertTrue(camera.keys.containsAll(essential.keys))
        assertEquals(
            JSONObject().put("throttleMs", 250).toString(),
            EventSubscriptions(TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 250))
                .json()
                .getJSONObject("cameraMoved")
                .toString(),
        )
        // The SDK follows every movement at any level, and every frame while controls follow it.
        val sdk = EventSubscriptions(TileflowEventOptions()).events
        assertEquals(0L, sdk[ProtocolContract.Event.CAMERA_MOVE_STARTED])
        assertNull(sdk[ProtocolContract.Event.CAMERA_MOVED])
        val following =
            EventSubscriptions(TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 250), true)
        assertEquals(0L, following.events[ProtocolContract.Event.CAMERA_MOVED])
        assertNotEquals(EventSubscriptions(), following)
        assertEquals(EventSubscriptions(), EventSubscriptions())
        // Several owners share an event at the shortest interval any of them asks for.
        val shared = EventSubscriptions(TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 1000))
        shared.set(
            EventSubscriptions.Owner.APPLICATION,
            mapOf(ProtocolContract.Event.CAMERA_MOVED to 50L, ProtocolContract.Event.HELLO to 0L),
        )
        assertEquals(50L, shared.events[ProtocolContract.Event.CAMERA_MOVED])
        assertNull(shared.events[ProtocolContract.Event.HELLO])
        for (interval in listOf(-1L, ProtocolContract.MAXIMUM_THROTTLE_MILLIS + 1)) {
            assertThrows(TileflowMapException::class.java) {
                TileflowEventOptions(cameraUpdateIntervalMillis = interval).validate()
            }
        }
    }

    @Test
    public fun dataChannelBoundsSharesAndReleasesPayloads() {
        val channel = DataChannel()
        val bytes = """{"type":"FeatureCollection","features":[]}""".toByteArray()
        val digest = DataChannel.digest(bytes)
        assertEquals(64, digest.length)
        val first = channel.register(bytes, digest, "application/geo+json")
        val second = channel.register(bytes, digest, "application/geo+json")
        // Equal payloads in flight share one entry and stay until every request releases them.
        assertEquals(first, second)
        assertTrue(first.id.length >= 22)
        assertTrue(channel.payload(first.id)?.bytes.contentEquals(bytes))
        channel.release(listOf(first))
        assertNotNull(channel.payload(first.id))
        channel.release(listOf(second))
        assertNull(channel.payload(first.id))
        assertTrue(channel.isEmpty)
        val third = channel.register(bytes, digest, "application/geo+json")
        assertNotEquals(first.id, third.id)
        channel.release(listOf(third, third))
        assertTrue(channel.isEmpty)

        val large = ByteArray(ProtocolContract.MAXIMUM_DATA_BYTES)
        val held = channel.register(large, "a", "application/octet-stream")
        channel.register(large, "b", "application/octet-stream")
        val error =
            assertThrows(TileflowMapException::class.java) {
                channel.register(bytes, digest, "application/geo+json")
            }
        assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
        assertEquals("dataTooLarge", error.context.reason)
        assertEquals(ProtocolContract.MAXIMUM_DATA_TOTAL_BYTES, error.context.limit)
        channel.release(listOf(held))
        assertThrows(TileflowMapException::class.java) {
            channel.register(ByteArray(ProtocolContract.MAXIMUM_DATA_BYTES + 1), "c", "x")
        }
        channel.retire()
        assertTrue(channel.isEmpty)
        assertEquals(
            TileflowErrorCode.CANCELLED,
            assertThrows(TileflowMapException::class.java) {
                    channel.register(bytes, digest, "x")
                }
                .code,
        )
    }
}
