package dev.tileflow.sdk.engine

import org.json.JSONObject
import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.model.MapPayloadStore
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeDataLayersTest {
    @Test fun fillsCompiledDataAndPlacesOverlayWithoutChangingAuthoredSources() {
        val style = JSONObject("""{"version":8,"sources":{"places":{"type":"geojson","data":{"type":"FeatureCollection","features":[]},"cluster":true}},"layers":[{"id":"labels","type":"symbol","source":"places","layout":{"text-font":["Noto Sans"]}}],"metadata":{"tileflow:overlay-placement-manifest":{"anchors":{"below-labels":"labels"}}}}""")
        val input = JSONObject("""{"dataSources":{"places":{"kind":"geojson","data":"https://data.example/places.json","cluster":false}},"dataOverlays":{"dots":{"kind":"maplibre-overlay","source":"places","placement":"below-labels","layers":[{"id":"counts","type":"symbol","metadata":{"tileflow:cluster":{"role":"count"}},"layout":{}}]}}}""")
        val result = NativeDataLayers(input).apply(style)
        assertTrue(result.getJSONObject("sources").getJSONObject("places").getBoolean("cluster"))
        assertEquals("https://data.example/places.json", result.getJSONObject("sources").getJSONObject("places").getString("data"))
        val layer = result.getJSONArray("layers").getJSONObject(0)
        assertEquals("counts", layer.getString("id"))
        assertEquals("Noto Sans", layer.getJSONObject("layout").getJSONArray("text-font").getString(0))
        assertTrue(style.getJSONObject("sources").getJSONObject("places").get("data") is JSONObject)
    }

    @Test fun runtimeSourceProjectionDoesNotReplayDeclarativeOverlays() {
        val input = JSONObject("""{"dataOverlays":{"dots":{"kind":"maplibre-overlay","source":"authored","placement":"above-labels","layers":[{"id":"dots","type":"circle"}]}}}""")
        val preparation = NativeMapPreparation("abcdefghijklmnopqrstuv", { error("Unexpected resource read") }, null, NativeDataLayers(input))
        val source = JSONObject("""{"sources":{"app":{"type":"vector","tiles":["https://tiles.example/{z}/{x}/{y}.pbf"]}}}""")
        val result = preparation.projectSource(source, "https://maps.example/style.json").style
        assertEquals(setOf("app"), result.getJSONObject("sources").keys().asSequence().toSet())
        assertEquals(0, result.optJSONArray("layers")?.length() ?: 0)
    }

    @Test fun cannotReplaceCompiledVectorSource() {
        val input = JSONObject("""{"dataSources":{"world":{"kind":"geojson","data":{}}}}""")
        assertThrows(Exception::class.java) { NativeDataLayers(input).apply(JSONObject("""{"sources":{"world":{"type":"vector"}},"layers":[]}""")) }
    }

    @Test fun brandingUsesVisibleCatalogSourcesAndMapIdentity() {
        val map = "map_AbCdEfGhIjKlMnOp"
        val style = JSONObject("""{"sources":{"world":{"url":"https://api.tileflow.dev/tiles/world/tiles.json?map=$map"},"unused":{"url":"https://api.tileflow.dev/tiles/terrain/tiles.json"}},"layers":[{"id":"land","source":"world"}]}""")
        assertEquals(setOf(NativeBrandingSource("https://api.tileflow.dev", map)), NativeBrandingSource.read(style, "https://api.tileflow.dev"))
        assertTrue(NativeBrandingSource.read(style, "https://other.example").isEmpty())
    }
    @Test fun hostedCatalogBrandingUsesDiscoveryIdentityWithoutUrlSelectors() {
        val map = "map_AbCdEfGhIjKlMnOp"
        val style = JSONObject("""{"sources":{"world":{"url":"https://api.tileflow.dev/tiles/world/tiles.json"}},"layers":[{"id":"land","source":"world"}]}""")
        assertEquals(setOf(NativeBrandingSource("https://api.tileflow.dev", map)), NativeBrandingSource.read(style, "https://api.tileflow.dev", map))
    }

    @Test fun inlineDataUsesRequestOwnedReferences() {
        val input = JSONObject("""{"dataSources":{"places":{"kind":"geojson","data":{"type":"FeatureCollection","features":[]}}},"dataOverlays":{}}""")
        val channel = MapPayloadStore()
        val (wire, references) = NativeDataLayers.wire(input, channel)
        assertFalse(wire.getJSONObject("dataSources").getJSONObject("places").has("data"))
        assertEquals(input.toString(), NativeDataLayers.decode(wire, channel, references).toString())
        assertThrows(Exception::class.java) { NativeDataLayers.decode(wire, channel, emptyList()) }
        channel.release(references)
        assertTrue(channel.isEmpty)
        assertThrows(Exception::class.java) { NativeDataLayers.decode(wire, channel, references) }
    }

    @Test fun failedBatchReleasesItsDataReferences() {
        val sources = JSONObject()
        for (i in 0..MapContract.MAXIMUM_DATA_REFERENCES) {
            sources.put("s$i", JSONObject("""{"kind":"geojson","data":{"type":"FeatureCollection","features":[{"type":"Feature","id":$i,"properties":{},"geometry":{"type":"Point","coordinates":[0,0]}}]}}"""))
        }
        val channel = MapPayloadStore()
        val input = JSONObject().put("dataSources", sources).put("dataOverlays", JSONObject())
        assertThrows(Exception::class.java) { NativeDataLayers.wire(input, channel) }
        assertTrue(channel.isEmpty)
    }

}
