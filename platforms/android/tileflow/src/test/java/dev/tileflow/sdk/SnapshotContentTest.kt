package dev.tileflow.sdk

import dev.tileflow.sdk.engine.NativeFamily
import dev.tileflow.sdk.engine.NativeMapPreparation
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class SnapshotContentTest {
    @Test
    fun routeInkFallsBackToTheSameThemeInkAsAView() {
        val manifest =
            """{"maps":{"map":{"defaultTheme":"day","themes":{"day":{"styleUrl":"day.json"}}}}}"""
        val style = """{"version":8,"sources":{},"layers":[]}"""
        val preparation =
            NativeMapPreparation(
                "A".repeat(22),
                { url ->
                    (if (url.path.endsWith("manifest.json")) manifest else style).toByteArray()
                },
                null,
            )
        val source =
            JSONObject().put("map", "map").put("manifestUrl", "https://maps.example/manifest.json")
        val map = preparation.map(source, null, "light", false)
        val content =
            TileflowMapSnapshotContent(
                overlays =
                    listOf(
                        TileflowGeoJSONLayer(
                            "ink",
                            """{"type":"FeatureCollection","features":[]}""",
                            TileflowGeoJSONLayerKind.CIRCLE,
                            color = "#ff0000",
                            ink = TileflowRouteInk.LINE,
                        )
                    )
            )
        fun ink(family: NativeFamily? = null): String {
            val projected = JSONObject(content.apply(map, "light", family).first)
            return projected
                .getJSONArray("layers")
                .getJSONObject(0)
                .getJSONObject("paint")
                .getString("circle-color")
        }
        assertEquals("#2563eb", ink())
        val family =
            NativeFamily.parse(
                JSONObject(
                    """{"kind":"tileflow-native-family","schemaVersion":1,
          "themes":[{"name":"day","routeInks":{"line":"#abcdef"}}]}"""
                )
            )
        assertEquals("#abcdef", ink(requireNotNull(family)))
    }
}
