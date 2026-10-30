package dev.tileflow.sdk

import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class MapContentTest {
    private fun layer(geoJSON: String) =
        TileflowGeoJSONLayer("content", geoJSON, TileflowGeoJSONLayerKind.FILL)

    @Test
    fun geoJSONFollowsTheRendererContract() {
        val ring = "[[0,0],[1,0],[1,1],[0,1],[0,0]]"
        layer(
            """{"type":"FeatureCollection","bbox":[0,0,1,1],"features":[{"type":"Feature","id":7,"bbox":[0,0,1,1],"geometry":{"type":"Polygon","bbox":[0,0,1,1],"coordinates":[$ring]},"properties":{"name":"Park","tags":["a"]}}]}"""
        )
        layer(
            """{"type":"FeatureCollection","features":[{"type":"Feature","geometry":null,"properties":null}]}"""
        )
        for (invalid in
            listOf(
                """{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"GeometryCollection","geometries":[]},"properties":{}}]}""",
                """{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[181,0]},"properties":{}}]}""",
                """{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,1]]]},"properties":{}}]}""",
                """{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[0,0]}}]}""",
                """{"type":"FeatureCollection","features":[{"type":"Feature","id":1.5,"geometry":null,"properties":null}]}""",
                """{"type":"FeatureCollection","features":[],"bbox":[0,0,1]}""",
                """{"type":"FeatureCollection","features":[],"crs":{}}""",
            )) {
            assertThrows(invalid, TileflowMapException::class.java) { layer(invalid) }
        }
    }
}
