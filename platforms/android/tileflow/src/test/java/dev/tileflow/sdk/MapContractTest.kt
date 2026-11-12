package dev.tileflow.sdk

import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.model.EventSubscriptions
import dev.tileflow.sdk.model.MapPayloadStore
import dev.tileflow.sdk.transport.ResourceDigest
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
public class MapContractTest {
    @Test
    public fun payloadReferencesShareCapacityAndKeepTheirDigestAcrossGenerations() {
        val sample = "abc".toByteArray()
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            ResourceDigest.sha256(sample),
        )
        val store = MapPayloadStore()
        fun put(bytes: ByteArray) =
            store.register(bytes, ResourceDigest.sha256(bytes), "application/octet-stream")
        val held = (0 until 64).map { put(byteArrayOf(it.toByte())) }
        val first = held.first()
        assertEquals(first, put(byteArrayOf(0)))
        store.release(listOf(first))
        val full = assertThrows(TileflowMapException::class.java) { put(sample) }
        assertEquals(64, full.context.limit)
        store.release(listOf(first))
        val last = put(sample)
        store.retire()
        assertNull(store.payload(last.id))
        val next =
            MapPayloadStore()
                .register(sample, ResourceDigest.sha256(sample), "application/octet-stream")
        assertEquals(last.sha256, next.sha256)
        assertNotEquals(last.id, next.id)
    }

    @Test
    public fun terminalCodesNeedTheApplicationToAct() {
        assertEquals(
            setOf(
                TileflowErrorCode.INVALID_SOURCE,
                TileflowErrorCode.UNSUPPORTED_DEVICE,
                TileflowErrorCode.INVALID_REQUEST,
                TileflowErrorCode.DISPOSED,
                TileflowErrorCode.NATIVE_PUBLICATION_REQUIRED,
                TileflowErrorCode.CREDENTIAL_REJECTED,
                TileflowErrorCode.ACCESS_DENIED,
                TileflowErrorCode.QUOTA_EXCEEDED,
                TileflowErrorCode.SESSION_REJECTED,
                TileflowErrorCode.MISSING_CREDENTIAL,
                TileflowErrorCode.INVALID_CONFIGURATION,
            ),
            TileflowErrorCode.entries.filterNot { it.isRecoverable }.toSet(),
        )
        for (code in MapContract.RENDERER_ERRORS) assertNotNull(
            code,
            TileflowErrorCode.fromWire(code),
        )
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
        assertEquals(0L, sdk[MapContract.Event.CAMERA_MOVE_STARTED])
        assertNull(sdk[MapContract.Event.CAMERA_MOVED])
        val following =
            EventSubscriptions(TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 250), true)
        assertEquals(0L, following.events[MapContract.Event.CAMERA_MOVED])
        assertNotEquals(EventSubscriptions(), following)
        assertEquals(EventSubscriptions(), EventSubscriptions())
        // Several owners share an event at the shortest interval any of them asks for.
        val shared = EventSubscriptions(TileflowEventOptions(TileflowEventLevel.CONTINUOUS, 1000))
        shared.set(
            EventSubscriptions.Owner.APPLICATION,
            mapOf(MapContract.Event.CAMERA_MOVED to 50L),
        )
        assertEquals(50L, shared.events[MapContract.Event.CAMERA_MOVED])
        for (interval in listOf(-1L, MapContract.MAXIMUM_THROTTLE_MILLIS + 1)) {
            assertThrows(TileflowMapException::class.java) {
                TileflowEventOptions(cameraUpdateIntervalMillis = interval).validate()
            }
        }
    }

    @Test
    public fun dataChannelBoundsSharesAndReleasesPayloads() {
        val channel = MapPayloadStore()
        val bytes = """{"type":"FeatureCollection","features":[]}""".toByteArray()
        val digest = ResourceDigest.sha256(bytes)
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

        val large = ByteArray(MapContract.MAXIMUM_DATA_BYTES)
        val held = channel.register(large, "a", "application/octet-stream")
        channel.register(large, "b", "application/octet-stream")
        val error =
            assertThrows(TileflowMapException::class.java) {
                channel.register(bytes, digest, "application/geo+json")
            }
        assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
        assertEquals("dataTooLarge", error.context.reason)
        assertEquals(MapContract.MAXIMUM_DATA_TOTAL_BYTES, error.context.limit)
        channel.release(listOf(held))
        assertThrows(TileflowMapException::class.java) {
            channel.register(ByteArray(MapContract.MAXIMUM_DATA_BYTES + 1), "c", "x")
        }
        channel.retire()
        assertTrue(channel.isEmpty)
        assertEquals(
            TileflowErrorCode.CANCELLED,
            assertThrows(TileflowMapException::class.java) { channel.register(bytes, digest, "x") }
                .code,
        )
    }
}
