package dev.tileflow.reactnative

import dev.tileflow.reactnative.map.MapValues
import dev.tileflow.sdk.*
import dev.tileflow.sdk.location.TileflowLocation
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeMapValuesTest {
    private val fixture = JSONObject(javaClass.classLoader!!.getResourceAsStream("map-bridge.json")!!.reader().readText())

    @Test
    fun sourceAndOptionsUseOnlyNativeSdkConfiguration() {
        val sources = fixture.getJSONObject("sources")
        assertEquals("map_offlinefixture01", MapValues.source(sources.getJSONObject("hosted"), "surface").mapId)
        val source = MapValues.source(sources.getJSONObject("manifest"), null)
        assertEquals("fixture", source.map)
        assertEquals(2, source.resourceOrigins.size)
        val options = MapValues.options(fixture.getJSONObject("options"), TileflowMapOptions(), false)
        assertEquals(TileflowQuality.BALANCED, options.quality)
        assertFalse(options.gestures.zoom)
        assertFalse(options.gestures.doubleTapZoom)
        assertTrue(options.gestures.pan)
        assertEquals(TileflowEventLevel.CONTINUOUS, options.events.level)
        assertEquals(TileflowControlPosition.BOTTOM_END, options.controls.attributionPosition)
        assertEquals(2.0, options.cameraLimits.minZoom, 0.0)
        assertThrows(TileflowMapException::class.java) {
            MapValues.source(JSONObject("""{"mapId":"map_offlinefixture01","credential":"secret"}"""), null)
        }
    }

    @Test
    fun screenCoordinatesInsetsAndQueriesConvertAtTheBoundary() {
        val stop = fixture.getJSONObject("camera").getJSONObject("command")
        assertEquals(TileflowPoint(94.5f, 138.75f), MapValues.point(JSONArray("[31.5,46.25]"), 3f))
        assertEquals(TileflowEdgeInsets(51f, 21f, 33f, 39f), MapValues.padding(stop.getJSONObject("padding"), 3f))
        val box = MapValues.queryGeometry(fixture.getJSONObject("queries").getJSONObject("box").getJSONObject("geometry"), 3f)
        assertEquals(TileflowQueryGeometry.Box(TileflowPoint(30f, 60f), TileflowPoint(330f, 240f)), box)
        val options = MapValues.marker(fixture.getJSONObject("marker"), 3f, 100, 60)
        assertEquals(12.0, options.variableAnchors.single().offsetX, 0.0)
        assertEquals(48.0, options.variableAnchors.single().offsetY, 0.0)
        assertTrue(options.selected)
        assertTrue(options.allowOverlap)
        val tap = MapValues.tap(TileflowCoordinate(-3.7038, 40.4168), TileflowPoint(94.5f, 138.75f), 3f)
        assertEquals(31.5, tap.getJSONObject("properties").getDouble("screenPointX"), 0.0)
    }

    @Test
    fun cameraAndLocationEventsUseTheSdkSnapshot() {
        val expected = fixture.getJSONObject("camera").getJSONObject("event").getJSONObject("payload")
        val camera = TileflowCamera(-3.7038, 40.4168, 16.0, 22.5, 45.0)
        val change = TileflowCameraChange(
            camera, TileflowCameraChangeReason.GESTURE, TileflowCameraChangePhase.MOVING,
            MapValues.bounds(expected.getJSONObject("properties").getJSONObject("bounds")),
        )
        val actual = MapValues.cameraEvent(change, 1700000000123, true)!!
        assertEquals(expected.getJSONObject("properties").toString(), actual.getJSONObject("properties").toString())
        assertEquals("moving", actual.getString("phase"))
        assertTrue(actual.getJSONObject("gestures").getBoolean("isGestureActive"))
        assertEquals(1700000000123, actual.getLong("timestamp"))
        val location = MapValues.location(TileflowLocation(
            TileflowCoordinate(-3.7038, 40.4168), 1700000000123, 4.0, 640.0, 67.0, 1.2,
        ))
        assertEquals(67.0, location.getJSONObject("coords").getDouble("heading"), 0.0)
        assertEquals(4.0, location.getJSONObject("coords").getDouble("accuracy"), 0.0)
    }
}
