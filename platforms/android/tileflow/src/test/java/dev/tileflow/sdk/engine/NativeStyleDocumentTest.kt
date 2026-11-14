package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.transport.MapResourceAddress
import java.net.URI
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** MapLibre receives the style itself, with every address it requests owned by the map. */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeStyleDocumentTest {
    @Test fun inlineWorldTilesPreserveCreditsAndTransportWithoutTileJSON() {
        val template = "https://world.tileflow.dev/tiles/world/world-v1-11111111-1111-1111-1111-111111111111/{z}/{x}/{y}.pbf?worldDescriptorSha256=${"a".repeat(64)}"
        val document = JSONObject("""{"version":8,"sources":{"world":{"type":"vector","tiles":["$template"],"minzoom":0,"maxzoom":15,"bounds":[-180,-85,180,85],"attribution":"© OpenStreetMap contributors"}},"layers":[]}""")
        val url = "https://maps.example/style.json"
        val projected = NativeStyleDocument.project(document, url, context, { error("Inline sources must not fetch TileJSON") })
        val source = projected.style.getJSONObject("sources").getJSONObject("world")
        assertFalse(source.has("url"))
        assertEquals(MapResourceAddress.encode(template, context), source.getJSONArray("tiles").getString(0))
        assertEquals(15, source.getInt("maxzoom"))
        assertEquals("[-180,-85,180,85]", source.getJSONArray("bounds").toString())
        assertEquals(listOf("© OpenStreetMap contributors"), projected.attributions)
        assertEquals(listOf(URI(url)), dev.tileflow.sdk.offline.OfflineSelfHosted.documents(URI(url), document.toString().toByteArray()))
        val tile = template.replace("{z}", "14").replace("{x}", "8023").replace("{y}", "6181")
        org.junit.Assert.assertTrue(dev.tileflow.sdk.attribution.MapFairUseSignal.isWorldTile(URI(tile)))
    }
    private val context = "BBBBBBBBBBBBBBBBBBBBBB"
    private val api = "https://api.tileflow.test"
    private val styleUrl = "$api/maps/m/mobile/webview-v1/v1/day.json"
    private val documents =
        mapOf(
            "$api/tiles/world/tiles.json?map=m" to
                """
                {"tiles": ["$api/tiles/world/1/{z}/{x}/{y}.pbf?map=m"],
                 "minzoom": 0, "maxzoom": 15, "attribution": "© World",
                 "vector_layers": [{"id": "building"}]}
                """,
            "$api/tiles/dem/tiles.json?map=m" to
                """
                {"tiles": ["dem/{z}/{x}/{y}.webp?map=m"], "minzoom": 0, "maxzoom": 9,
                 "attribution": "© Depths", "encoding": "mapbox"}
                """,
        )
    private val loads = mutableListOf<URI>()

    private fun load(url: URI): ByteArray {
        loads += url
        return documents[url.toString()]?.toByteArray() ?: throw NativeResourceStatus(404)
    }

    @Test
    fun tileJSONCreditsCannotBeReplacedByStyleAttribution() {
        for (supplied in listOf("", " ", "Author credit", JSONObject.NULL)) {
            val style = JSONObject("""{"version":8,"sources":{"world":{"type":"vector","url":"https://api.tileflow.dev/tiles/world/tiles.json"}},"layers":[]}""")
            style.getJSONObject("sources").getJSONObject("world").put("attribution", supplied)
            val projected = NativeStyleDocument.project(style, "https://api.tileflow.dev/maps/test/light.json", context, {
                """{"tiles":["https://api.tileflow.dev/tiles/world/{z}/{x}/{y}.pbf"],"attribution":"© OpenStreetMap contributors"}""".toByteArray()
            })
            org.junit.Assert.assertTrue(projected.attributions.any { it.contains("© OpenStreetMap contributors") })
            assertFalse(projected.attributions.any { it.isBlank() || it == "null" })
            if (supplied == "Author credit") org.junit.Assert.assertTrue(projected.attributions.any { it.contains("Author credit") })
        }
    }

    @Test
    fun aRemoteAddressTheSdkCannotOwnIsRejectedBeforeRendering() {
        for (source in listOf(
            """{"type":"geojson","data":"https://app@blocked.test/points.geojson"}""",
            """{"type":"vector","url":"pmtiles://https://app@blocked.test/tiles.pmtiles"}""",
        )) {
            val document = JSONObject("""{"version":8,"sources":{"bad":$source},"layers":[]}""")
            val error =
                runCatching { NativeStyleDocument.project(document, styleUrl, context, ::load) }
                    .exceptionOrNull() as? TileflowMapException
            assertEquals(TileflowErrorCode.RESOURCE_FAILED, error?.code)
            assertEquals(emptyList<URI>(), loads)
        }
    }

    @Test
    fun aProviderAliasCannotEscapeTheMapTransport() {
        val document = JSONObject(
            """{"version":8,"glyphs":"maplibre://fonts/{fontstack}/{range}.pbf","sources":{},"layers":[]}"""
        )
        val error =
            runCatching { NativeStyleDocument.project(document, styleUrl, context, ::load) }
                .exceptionOrNull() as? TileflowMapException
        assertEquals(TileflowErrorCode.RESOURCE_FAILED, error?.code)
        assertEquals(emptyList<URI>(), loads)
    }

    private val style =
        JSONObject(
            """
            {"version":8,
             "sprite":"../../../../../sprites/fixture/sprite",
             "glyphs":"$api/fonts/{fontstack}/{range}.pbf",
             "font-faces":{"Noto Sans Regular":"../fonts/noto.ttf",
               "DINish":[{"url":"https://cdn.test/dinish.ttf","unicode-range":["U+0000-024F"]}]},
             "sources":{
               "world":{"type":"vector","url":"$api/tiles/world/tiles.json?map=m"},
               "depths":{"type":"raster-dem","url":"$api/tiles/dem/tiles.json?map=m",
                 "encoding":"terrarium","tileSize":512},
               "places":{"type":"geojson","data":"./data.json"},
               "inline":{"type":"geojson","data":{"type":"FeatureCollection","features":[]}},
               "photo":{"type":"image","url":"photo.png","coordinates":[[0,1],[1,1],[1,0],[0,0]]},
               "archive":{"type":"vector","url":"pmtiles://https://cdn.test/a.pmtiles"},
               "again":{"type":"vector","tiles":["https://x.test/{z}/{x}/{y}.pbf"],
                 "attribution":"© World"}
             },
             "layers":[
               {"id":"background","type":"background"},
               {"id":"buildings","type":"fill","source":"world","source-layer":"building"},
               {"id":"relief","type":"hillshade","source":"depths"},
               {"id":"poi","type":"circle","source":"places"}
             ]}
            """
        )

    private fun address(remote: String) = MapResourceAddress.encode(remote, context)!!

    private fun minzoom(projection: NativeStyleProjection, source: String) =
        projection.style.getJSONObject("sources").getJSONObject(source).getInt("minzoom")

    @Test
    fun everyAddressBecomesATransportAddressOfTheMap() {
        val projected = NativeStyleDocument.project(style, styleUrl, context, ::load)
        val out = projected.style
        assertEquals(address("$api/sprites/fixture/sprite"), out.getString("sprite"))
        assertEquals(
            address("https://api.tileflow.test/fonts/{fontstack}/{range}.pbf"),
            out.getString("glyphs"),
        )
        val faces = out.getJSONObject("font-faces")
        assertEquals(
            address("https://api.tileflow.test/maps/m/mobile/webview-v1/fonts/noto.ttf"),
            faces.getString("Noto Sans Regular"),
        )
        val dinish = faces.getJSONArray("DINish").getJSONObject(0)
        assertEquals(address("https://cdn.test/dinish.ttf"), dinish.getString("url"))
        assertEquals("U+0000-024F", dinish.getJSONArray("unicode-range").getString(0))
        val sources = out.getJSONObject("sources")
        val world = sources.getJSONObject("world")
        assertFalse("TileJSON is embedded", world.has("url"))
        assertEquals(
            address("https://api.tileflow.test/tiles/world/1/{z}/{x}/{y}.pbf?map=m"),
            world.getJSONArray("tiles").getString(0),
        )
        assertEquals(15, world.getInt("maxzoom"))
        val layer = world.getJSONArray("vector_layers").getJSONObject(0)
        assertEquals("building", layer.getString("id"))
        val depths = sources.getJSONObject("depths")
        // Tiles resolve against their TileJSON; the style's own values win over the TileJSON's.
        assertEquals(
            address("https://api.tileflow.test/tiles/dem/dem/{z}/{x}/{y}.webp?map=m"),
            depths.getJSONArray("tiles").getString(0),
        )
        assertEquals("terrarium", depths.getString("encoding"))
        assertEquals(0, depths.getInt("minzoom"))
        assertEquals(
            address("https://api.tileflow.test/maps/m/mobile/webview-v1/v1/data.json"),
            sources.getJSONObject("places").getString("data"),
        )
        val inline = sources.getJSONObject("inline").getJSONObject("data")
        assertEquals("FeatureCollection", inline.getString("type"))
        assertEquals(
            address("https://api.tileflow.test/maps/m/mobile/webview-v1/v1/photo.png"),
            sources.getJSONObject("photo").getString("url"),
        )
        assertEquals(
            "pmtiles://" + address("https://cdn.test/a.pmtiles"),
            sources.getJSONObject("archive").getString("url"),
        )
        assertFalse(
            "Nothing the engine requests leaves the transport",
            out.toString().contains("api.tileflow.test"),
        )
        assertEquals(
            listOf(
                URI("https://api.tileflow.test/tiles/world/tiles.json?map=m"),
                URI("https://api.tileflow.test/tiles/dem/tiles.json?map=m"),
            ),
            loads,
        )
        assertEquals(listOf("© World", "© Depths"), projected.attributions)
        assertEquals(
            listOf("buildings" to "world", "relief" to "depths", "poi" to "places"),
            projected.layerSources.toList(),
        )
    }

    @Test
    fun requestsAreClassifiedByTheStyleThatMadeThem() {
        val projected = NativeStyleDocument.project(style, styleUrl, context, ::load)
        fun kind(url: String) = projected.classify(URI(url))
        assertEquals(TileflowResourceKind.TILE, kind("$api/tiles/world/1/15/1/2.pbf?map=m"))
        assertEquals(TileflowResourceKind.SPRITE, kind("$api/sprites/fixture/sprite@2x.png"))
        assertEquals(TileflowResourceKind.GLYPHS, kind("$api/fonts/Noto%20Sans/0-255.pbf"))
        assertEquals(TileflowResourceKind.FONT, kind("https://cdn.test/dinish.ttf"))
        assertEquals(TileflowResourceKind.DATA, kind("$api/maps/m/mobile/webview-v1/v1/data.json"))
        assertEquals(TileflowResourceKind.OTHER, kind("https://elsewhere.test/a"))
    }

    @Test
    fun anElevationSourceStartsAtItsLowestStoredZoomOnlyWhenTheMapOpensFromPacks() {
        val template = "https://api.tileflow.test/tiles/dem/dem/{z}/{x}/{y}.webp?map=m"
        val asked = mutableListOf<String>()
        val offline =
            NativeStyleDocument.project(style, styleUrl, context, ::load) {
                asked += it
                if (it == template) 8..9 else null
            }
        assertEquals(8, minzoom(offline, "depths"))
        // Only elevation sources ask; vector sources keep their zooms.
        assertEquals(listOf(template), asked)
        assertEquals(0, minzoom(offline, "world"))
        val online = NativeStyleDocument.project(style, styleUrl, context, ::load)
        assertEquals(0, minzoom(online, "depths"))
        // A higher declared minimum stays.
        style.getJSONObject("sources").getJSONObject("depths").put("minzoom", 10)
        val declared = NativeStyleDocument.project(style, styleUrl, context, ::load) { 8..9 }
        assertEquals(10, minzoom(declared, "depths"))
    }

    /**
     * An image covering the Web Mercator world reaches MapLibre as a raster source whose one zoom-0
     * tile is the image: MapLibre Native counts a raster source no layer needs as loaded, but an
     * image source only once it has drawn it. Any other image stays an image source.
     */
    @Test
    fun aWorldImageBecomesTheOneTileOfARasterSource() {
        val latitude = NativeStyleDocument.MERCATOR_LATITUDE
        val images =
            JSONObject(
                """{"version":8,"sources":{
                    "underlay":{"type":"image","url":"underlay.png","attribution":"© Climate",
                      "coordinates":[[-180,$latitude],[180,$latitude],[180,-$latitude],
                        [-180,-$latitude]]},
                    "photo":{"type":"image","url":"photo.png",
                      "coordinates":[[0,1],[1,1],[1,0],[0,0]]},
                    "mirrored":{"type":"image","url":"mirrored.png",
                      "coordinates":[[180,$latitude],[-180,$latitude],[-180,-$latitude],
                        [180,-$latitude]]}},
                    "layers":[{"id":"underlay","type":"raster","source":"underlay","maxzoom":11}]}"""
            )
        val projected = NativeStyleDocument.project(images, styleUrl, context, ::load)
        val sources = projected.style.getJSONObject("sources")
        val underlay = sources.getJSONObject("underlay")
        assertEquals("raster", underlay.getString("type"))
        assertEquals(0, underlay.getInt("minzoom"))
        assertEquals(0, underlay.getInt("maxzoom"))
        assertEquals("© Climate", underlay.getString("attribution"))
        assertFalse(underlay.has("coordinates"))
        val remote = "https://api.tileflow.test/maps/m/mobile/webview-v1/v1/underlay.png"
        assertEquals(1, underlay.getJSONArray("tiles").length())
        assertEquals(address(remote), underlay.getJSONArray("tiles").getString(0))
        assertEquals(TileflowResourceKind.IMAGE, projected.classify(URI(remote)))
        assertEquals("image", sources.getJSONObject("photo").getString("type"))
        assertEquals("image", sources.getJSONObject("mirrored").getString("type"))
        assertEquals(listOf("© Climate"), projected.attributions)
    }

    @Test
    fun labelsWithoutGlyphsOrFontFacesDrawNoText() {
        val projected = NativeStyleDocument.project(style, styleUrl, context, ::load)
        assertEquals(emptyList<String>(), projected.omitted)
        val labelled =
            JSONObject(
                """{"version":8,"sources":{"places":{"type":"geojson","data":"./data.json"}},
                    "layers":[{"id":"label","type":"symbol","source":"places",
                    "layout":{"text-field":["get","name"],"text-font":["Noto Sans"],
                              "icon-image":"dot"}}]}"""
            )
        val textless = NativeStyleDocument.project(labelled, styleUrl, context, ::load)
        assertEquals(listOf("text"), textless.omitted)
        val layout = textless.style.getJSONArray("layers").getJSONObject(0).getJSONObject("layout")
        assertFalse(layout.has("text-field"))
        assertEquals("dot", layout.getString("icon-image"))
        labelled.put("glyphs", "https://api.tileflow.test/fonts/{fontstack}/{range}.pbf")
        val withGlyphs = NativeStyleDocument.project(labelled, styleUrl, context, ::load)
        assertEquals(emptyList<String>(), withGlyphs.omitted)
    }

    @Test
    fun aMissingSourceDescriptionFailsTheMapWithItsOrigin() {
        style.getJSONObject("sources")
            .put("broken", JSONObject("""{"type":"vector","url":"$api/missing.json"}"""))
        try {
            NativeStyleDocument.project(style, styleUrl, context, ::load)
            fail("A source without its description cannot draw")
        } catch (error: TileflowMapException) {
            assertEquals(TileflowErrorCode.RESOURCE_FAILED, error.code)
            assertEquals(TileflowResourceKind.SOURCE, error.context.resource)
            assertEquals("https://api.tileflow.test", error.context.origin)
            assertEquals(404, error.context.status)
        }
    }
}
