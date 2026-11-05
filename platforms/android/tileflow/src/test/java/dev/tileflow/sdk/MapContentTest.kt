package dev.tileflow.sdk

import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.location.TileflowLocationOptions
import dev.tileflow.sdk.model.MapPayloadStore
import dev.tileflow.sdk.transport.ResourceDigest
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
    fun aNewDeclarationObservesEditsToTheSameFeatureList() {
        val features = mutableListOf<TileflowFeature>()
        val source = TileflowGeoJSONSource("places", TileflowGeoJSONData.Features(features))
        val block = TileflowMapContentBuilder().apply { source(source) }
        val before = DeclaredMapContent(block)
        features += TileflowFeature("id", TileflowGeometry.Point(TileflowCoordinate(1.0, 2.0)))
        val after = DeclaredMapContent(block, before)
        assertTrue(!before.matches(after))
    }

    @Test
    fun declaredIdsAreUniquePerKindAndOnlyOneLocationCanOwnTheMap() {
        val source = TileflowGeoJSONSource("one", TileflowGeoJSONData.Empty)
        val layer = TileflowCircleLayer("one", "one")
        val marker = TileflowAnnotation("one", TileflowCoordinate(0.0, 0.0), "First")
        val location = TileflowLocationOptions(enabled = true)
        val builder =
            TileflowMapContentBuilder().apply {
                source(source)
                layer(layer)
                annotation(marker)
                location(location)
            }
        val content = DeclaredMapContent(builder)
        assertTrue(
            content.sources.containsKey("one") &&
                content.layers.containsKey("one") &&
                content.markers.single() == marker
        )
        for (duplicate in
            listOf<TileflowMapContentBuilder.() -> Unit>(
                { source(source) },
                { layer(layer) },
                { annotation(marker) },
                { location(location) },
            )) {
            val invalid =
                TileflowMapContentBuilder().apply {
                    source(source)
                    layer(layer)
                    annotation(marker)
                    location(location)
                    duplicate()
                }
            assertEquals(
                TileflowErrorCode.INVALID_REQUEST,
                assertThrows(TileflowMapException::class.java) { DeclaredMapContent(invalid) }.code,
            )
        }
    }

    @Test
    fun layersCheckTheirParametersAndLeaveGeoJSONToTheRenderer() {
        val layer = TileflowGeoJSONLayer("content", text, TileflowGeoJSONLayerKind.FILL)
        assertEquals(ResourceDigest.sha256(text.toByteArray()), layer.digest)
        for (invalid in
            listOf(
                { TileflowGeoJSONLayer("../style", text, TileflowGeoJSONLayerKind.FILL) },
                { TileflowGeoJSONLayer("a", text, TileflowGeoJSONLayerKind.FILL, color = "red") },
                { TileflowGeoJSONLayer("a", text, TileflowGeoJSONLayerKind.LINE, size = 65.0) },
                { TileflowGeoJSONLayer("a", "", TileflowGeoJSONLayerKind.FILL) },
                {
                    TileflowGeoJSONLayer(
                        "a",
                        "x".repeat(MapContract.MAXIMUM_DATA_BYTES + 1),
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
        val channel = MapPayloadStore()
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
            ResourceDigest.sha256(text.toByteArray()),
            overlays.getJSONObject(1).getJSONObject("data").getString("sha256"),
        )
        channel.release(references)
        assertTrue(channel.isEmpty)
    }
}
