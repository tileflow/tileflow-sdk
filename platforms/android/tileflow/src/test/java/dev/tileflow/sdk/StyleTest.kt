package dev.tileflow.sdk

import android.app.Activity
import android.webkit.WebView
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * The typed runtime style: generated layers and expressions encode to MapLibre JSON, sources to
 * their wire form, and the view keeps what a new renderer needs.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StyleTest {
    private fun same(expected: String, actual: Any) {
        fun canonical(value: Any?): Any? =
            when (value) {
                is JSONObject ->
                    value.keys().asSequence().sorted().associateWith { canonical(value.get(it)) }
                is JSONArray -> (0 until value.length()).map { canonical(value.get(it)) }
                is Number -> value.toDouble()
                else -> value
            }
        val parsed = if (expected.trim().startsWith("[")) JSONArray(expected) else JSONObject(expected)
        assertEquals(canonical(parsed), canonical(actual))
    }

    @Test
    fun generatedLayersEncodeMapLibreJSON() {
        val layer =
            TileflowCircleLayer("points", "places")
                .sourceLayer("poi")
                .filter(TileflowExpression.eq(TileflowExpression.get("kind"), TileflowExpression.literal("cafe")))
                .minZoom(10.0)
                .circleRadius(
                    TileflowExpression.interpolate(
                        TileflowExpression.linear(),
                        TileflowExpression.zoom(),
                        TileflowExpression.literal(10.0),
                        TileflowExpression.literal(2.0),
                        TileflowExpression.literal(16.0),
                        TileflowExpression.literal(8.0),
                    )
                )
                .circleRadiusTransition(TileflowTransition(300))
                .circleColor(TileflowColor.fromHex("#e9573f"))
                .circleStrokeColor(TileflowColor(0, 0, 0, 0.5))
                .circlePitchAlignment(TileflowCirclePitchAlignment.MAP)
                .visibility(TileflowVisibility.VISIBLE)
                .slot(TileflowLayerSlot.BELOW_LABELS)
        same(
            """
            {"id":"points","type":"circle","source":"places","source-layer":"poi",
             "filter":["==",["get","kind"],"cafe"],"minzoom":10,
             "layout":{"visibility":"visible"},
             "paint":{"circle-radius":["interpolate",["linear"],["zoom"],10,2,16,8],
              "circle-radius-transition":{"duration":300,"delay":0},
              "circle-color":"rgba(233, 87, 63, 1.0)",
              "circle-stroke-color":"rgba(0, 0, 0, 0.5)",
              "circle-pitch-alignment":"map"}}
            """,
            layer.json(),
        )
        val symbol =
            TileflowSymbolLayer("labels", "places")
                .textField(TileflowExpression.get("name"))
                .textFont(listOf("Noto Sans Regular"))
                .textVariableAnchorOffset(
                    TileflowTextAnchorOffsets(
                        listOf(
                            TileflowTextAnchorOffsets.Entry(TileflowTextAnchor.TOP, listOf(0.0, 1.0)),
                            TileflowTextAnchorOffsets.Entry(TileflowTextAnchor.LEFT, listOf(1.0, 0.0)),
                        )
                    )
                )
                .iconImage("pin")
                .iconColor(TileflowColor.fromHex("#ffffff"))
        val json = symbol.json()
        same("""["top",[0,1],"left",[1,0]]""", json.getJSONObject("layout").get("text-variable-anchor-offset"))
        assertEquals("rgba(255, 255, 255, 1.0)", json.getJSONObject("paint").get("icon-color"))
        assertFalse(TileflowBackgroundLayer("tint").json().has("source"))
        assertEquals("color-relief", TileflowColorReliefLayer("relief", "dem").type)
    }

    @Test
    fun expressionsUseMapLibreOperatorsAndLiterals() {
        val e = TileflowExpression
        same("""["+",1,["get","count"]]""", e.sum(e.literal(1.0), e.get("count")).json)
        same("""["!",["has","name"]]""", e.not(e.has("name")).json)
        same(
            """["case",["boolean",["feature-state","selected"],false],"#f00","#00f"]""",
            e.switchCase(
                    e.boolean(e.featureState("selected"), e.literal(false)),
                    e.literal("#f00"),
                    e.literal("#00f"),
                )
                .json,
        )
        same("""["in","a",["literal",["a","b"]]]""", e.inExpression(e.literal("a"), e.literal(listOf("a", "b"))).json)
        assertEquals(
            e.step(e.get("point_count"), e.literal(20.0), e.literal(100.0), e.literal(30.0)),
            e.fromJson("""["step",["get","point_count"],20,100,30]"""),
        )
        assertEquals("\"rgba(17, 34, 51, 0.502)\"", e.color(TileflowColor.fromHex("#11223380")).toString())
        assertThrows(TileflowMapException::class.java) { e.fromJson("not json") }
    }

    @Test
    fun coloursParseHexAndCheckChannels() {
        assertThrows(TileflowMapException::class.java) { TileflowColor.fromHex("red") }
        assertThrows(TileflowMapException::class.java) { TileflowColor(300, 0, 0) }
        assertEquals(TileflowColor(255, 0, 0, 1.0), TileflowColor.fromArgb(0xffff0000.toInt()))
    }

    @Test
    fun sourcesTravelInMapLibreForm() {
        val (spec, log) =
            sourceWire(
                TileflowGeoJSONSource(
                    "points",
                    TileflowGeoJSONData.Features(
                        listOf(TileflowFeature("7", TileflowGeometry.Point(TileflowCoordinate(1.0, 2.0))))
                    ),
                    cluster = true,
                    clusterRadius = 40.0,
                    clusterProperties =
                        mapOf("total" to TileflowExpression.sum(TileflowExpression.get("count"))),
                    generateId = true,
                )
            )
        same(
            """{"type":"geojson","cluster":true,"clusterRadius":40,"clusterProperties":{"total":["+",["get","count"]]},"generateId":true}""",
            spec,
        )
        val bytes = (log!!.base as GeoJSONLog.Base.Bytes).bytes
        // A whole-number identifier travels as a number, which feature state needs.
        assertEquals(
            7L,
            (JSONObject(String(bytes)).getJSONArray("features").getJSONObject(0).get("id") as Number)
                .toLong(),
        )
        same(
            """{"type":"vector","tiles":["https://tiles.example/{z}/{x}/{y}.pbf"],"maxzoom":14,"promoteId":"osm_id"}""",
            sourceWire(
                    TileflowVectorSource(
                        "roads",
                        TileflowTiles.Templates(listOf("https://tiles.example/{z}/{x}/{y}.pbf")),
                        maxZoom = 14.0,
                        promoteId = "osm_id",
                    )
                )
                .first,
        )
        assertEquals(
            "terrarium",
            sourceWire(
                    TileflowRasterDEMSource(
                        "dem",
                        TileflowTiles.TileJSON("https://dem.example/tiles.json"),
                        TileflowRasterDEMSource.Encoding.TERRARIUM,
                    )
                )
                .first
                .getString("encoding"),
        )
        assertThrows(TileflowMapException::class.java) {
            sourceWire(TileflowImageSource("plan", "https://img.example/plan.png", emptyList()))
        }
    }

    @Test
    fun queriedFeaturesDecodeTypedValues() {
        val feature =
            TileflowQueriedFeature.of(
                JSONObject(
                    """{"id":12,"source":"points","layer":"clusters","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"properties":{"cluster_id":4,"name":"A","tags":["x"],"nested":{"a":null}},"state":{"selected":true}}"""
                )
            )
        assertEquals("12", feature.feature.id)
        assertEquals(4, feature.feature.clusterId)
        assertEquals("points", feature.source)
        assertEquals("clusters", feature.layer)
        assertNull(feature.sourceLayer)
        assertEquals(TileflowJSON.Array(listOf(TileflowJSON.Text("x"))), feature.feature.properties["tags"])
        assertEquals(TileflowJSON.Object(mapOf("a" to TileflowJSON.Null)), feature.feature.properties["nested"])
        assertEquals(mapOf("selected" to TileflowStyleValue.Bool(true)), feature.state)
        val polygon = feature.feature.geometry as TileflowGeometry.Polygon
        assertEquals(TileflowCoordinate(1.0, 0.0), polygon.rings[0][1])
        assertEquals(polygon, TileflowGeometry.of(TileflowGeometry.json(polygon)))
    }

    @Test
    fun featureUpdatesCompactIntoData() {
        val base =
            """{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"properties":{},"geometry":null},{"type":"Feature","id":2,"properties":{},"geometry":null}]}"""
        val updates =
            listOf(
                GeoJSONLog.Update(
                    """[{"type":"Feature","id":3,"properties":{},"geometry":null}]""".toByteArray(),
                    listOf("1"),
                ),
                GeoJSONLog.Update(
                    """[{"type":"Feature","id":2,"properties":{"v":2},"geometry":null}]""".toByteArray(),
                    emptyList(),
                ),
            )
        val compacted = GeoJSONLog.compact(base.toByteArray(), updates, null)!!
        val features = JSONObject(String(compacted)).getJSONArray("features")
        assertEquals(listOf(2, 3), (0 until features.length()).map { features.getJSONObject(it).getInt("id") })
        assertEquals(2, features.getJSONObject(0).getJSONObject("properties").getInt("v"))
        val promoted =
            """{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"ref":"a"},"geometry":null}]}"""
                .toByteArray()
        assertNotNull(GeoJSONLog.compact(promoted, listOf(GeoJSONLog.Update(null, listOf("a"))), "ref"))
        assertNull(GeoJSONLog.compact(promoted, emptyList(), null))
    }

    @Test
    fun theViewKeepsLayersInOrderAndRefusesUnknownNames(): Unit = runBlocking {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val view = TileflowMapView(activity)
        try {
            view.addSource(TileflowGeoJSONSource("points", TileflowGeoJSONData.Empty))
            val unknown =
                runCatching { view.addLayer(TileflowCircleLayer("a", "missing")) }.exceptionOrNull()
                    as TileflowMapException
            assertEquals("unknownSource", unknown.context.reason)
            view.addLayer(TileflowCircleLayer("top", "points").slot(TileflowLayerSlot.BELOW_LABELS))
            view.addLayer(TileflowHeatmapLayer("heat", "points"), TileflowLayerPosition.Below("top"))
            view.addLayer(TileflowCircleLayer("over", "points"), TileflowLayerPosition.Above("heat"))
            assertEquals(listOf("heat", "over", "top"), view.runtimeStyle.layers.map { it.id })
            // A layer placed relative to another takes its slot.
            assertEquals(
                List(3) { TileflowLayerSlot.BELOW_LABELS },
                view.runtimeStyle.layers.map { it.slot },
            )
            view.moveLayer("heat", TileflowLayerPosition.Above("top"))
            assertEquals(listOf("over", "top", "heat"), view.runtimeStyle.layers.map { it.id })
            view.setFeatureState("points", featureId = "4", state = mapOf("selected" to TileflowStyleValue.Bool(true)))
            view.setFeatureState("points", featureId = "4", state = mapOf("hover" to TileflowStyleValue.Number(1.0)))
            assertEquals(
                mapOf("selected" to TileflowStyleValue.Bool(true), "hover" to TileflowStyleValue.Number(1.0)),
                view.featureState("points", featureId = "4"),
            )
            view.removeFeatureState("points", featureId = "4", key = "hover")
            assertEquals(mapOf("selected" to TileflowStyleValue.Bool(true)), view.featureState("points", featureId = "4"))
            assertTrue(runCatching { view.removeSource("points") }.isFailure)
            assertTrue(
                runCatching {
                        view.addGeoJSONSourceFeatures("points", listOf(TileflowFeature(geometry = null)))
                    }
                    .isFailure
            )
            view.addGeoJSONSourceFeatures("points", listOf(TileflowFeature("1", null)))
            assertEquals(1, view.runtimeStyle.sources.single().geoJSON?.updates?.size)
            for (id in listOf("over", "top", "heat")) view.removeLayer(id)
            view.removeSource("points")
            assertFalse(view.sourceExists("points"))
        } finally {
            view.destroy()
        }
    }

    private fun output(id: String, build: JSONObject.() -> Unit): String =
        JSONObject()
            .put("protocolVersion", ProtocolContract.VERSION)
            .put("instanceId", "view")
            .put("generation", 1)
            .put("requestId", id)
            .apply(build)
            .toString()

    @Test
    fun largePayloadsAndResultsTravelInParts(): Unit = runBlocking {
        val webView = WebView(RuntimeEnvironment.getApplication())
        val bridge = MapBridge("view", 1, "runtime-hash", webView, onHello = {}, onEvent = { _, _ -> })
        bridge.receive(
            JSONObject()
                .put("protocolVersion", ProtocolContract.VERSION)
                .put("instanceId", "view")
                .put("generation", 1)
                .put("event", "hello")
                .put(
                    "result",
                    JSONObject()
                        .put("runtimeHash", "runtime-hash")
                        .put(
                            "protocol",
                            JSONObject()
                                .put("minimum", ProtocolContract.VERSION)
                                .put("maximum", ProtocolContract.VERSION)
                                .put("selected", ProtocolContract.VERSION),
                        ),
                )
                .toString()
        )
        try {
            // A filter of 20,000 identifiers is far past a control message.
            val layer =
                TileflowCircleLayer("chosen", "points")
                    .filter(
                        TileflowExpression.inExpression(
                            TileflowExpression.id(),
                            TileflowExpression.literal((0 until 20_000).map { it.toDouble() }),
                        )
                    )
            val added =
                async(Dispatchers.Unconfined) {
                    bridge.call(ProtocolContract.Method.ADD_LAYER, JSONObject().put("layer", layer.json()))
                }
            val sent = JSONObject(JSONObject("{\"m\":${shadowOf(webView).lastEvaluatedJavascript.removePrefix("window.tileflow.receive(").removeSuffix(");")}}").getString("m"))
            val command = sent.getJSONObject("command")
            assertFalse(command.has("payload"))
            val reference = command.getJSONObject("payloadData")
            val payload = String(bridge.data.payload(reference.getString("id"))!!.bytes)
            assertEquals("chosen", JSONObject(payload).getJSONObject("layer").getString("id"))
            bridge.receive(output(sent.getString("requestId")) { put("result", JSONObject.NULL) })
            added.await()
            assertTrue(bridge.data.isEmpty)
            // A result past a control message is read in parts.
            val result = JSONArray((0 until 3).map { JSONObject().put("id", it).put("name", "é $it") }).toString()
            val parts = result.chunked(result.length / 2 + 1)
            val queried =
                async(Dispatchers.Unconfined) {
                    bridge.call(ProtocolContract.Method.QUERY_SOURCE_FEATURES, JSONObject())
                }
            bridge.receive(output("2") { put("chunks", parts.size) })
            parts.forEachIndexed { index, part ->
                bridge.receive(output((3 + index).toString()) { put("result", part) })
            }
            val features = queried.await() as JSONArray
            assertEquals(3, features.length())
            assertEquals("é 2", features.getJSONObject(2).getString("name"))
        } finally {
            bridge.retire()
        }
    }
}
