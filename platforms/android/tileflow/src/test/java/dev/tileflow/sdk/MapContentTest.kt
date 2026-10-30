package dev.tileflow.sdk

import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.ProtocolContract
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class MapContentTest {
    private val text = """{"type":"FeatureCollection","features":[]}"""

    @Test
    fun layersCheckTheirParametersAndLeaveGeoJSONToTheRenderer() {
        val layer = TileflowGeoJSONLayer("content", text, TileflowGeoJSONLayerKind.FILL)
        assertEquals(DataChannel.digest(text.toByteArray()), layer.digest)
        for (invalid in
            listOf(
                { TileflowGeoJSONLayer("../style", text, TileflowGeoJSONLayerKind.FILL) },
                { TileflowGeoJSONLayer("a", text, TileflowGeoJSONLayerKind.FILL, color = "red") },
                { TileflowGeoJSONLayer("a", text, TileflowGeoJSONLayerKind.LINE, size = 65.0) },
                { TileflowGeoJSONLayer("a", "", TileflowGeoJSONLayerKind.FILL) },
                {
                    TileflowGeoJSONLayer(
                        "a",
                        "x".repeat(ProtocolContract.MAXIMUM_DATA_BYTES + 1),
                        TileflowGeoJSONLayerKind.FILL,
                    )
                },
            )) {
            val error = assertThrows(TileflowMapException::class.java) { invalid() }
            assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
        }
    }

    @Test
    fun layersSharingDataRegisterItOnce() {
        val channel = DataChannel()
        val content =
            MapContent(
                overlays =
                    listOf(
                        TileflowGeoJSONLayer("fill", text, TileflowGeoJSONLayerKind.FILL),
                        TileflowGeoJSONLayer("outline", text, TileflowGeoJSONLayerKind.LINE),
                    )
            )
        val (payload, references) = content.json(channel)
        assertEquals(1, references.toSet().size)
        val overlays = payload.getJSONArray("overlays")
        assertEquals(
            references[0].id,
            overlays.getJSONObject(0).getJSONObject("data").getString("id"),
        )
        assertEquals(
            DataChannel.digest(text.toByteArray()),
            overlays.getJSONObject(1).getJSONObject("data").getString("sha256"),
        )
        channel.release(references)
        assertTrue(channel.isEmpty)
    }
}
