package dev.tileflow.sdk

import android.app.Activity
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class SourceUpdateTest {
    @Test
    fun clusteringRejectsNonPointsWithoutKeepingPartialMutations() = runBlocking {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val map = TileflowMapView(activity)
        val line = """{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"geometry":{"type":"LineString","coordinates":[[1,2],[2,3]]},"properties":{}}]}"""
        val point = """{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"geometry":{"type":"Point","coordinates":[1,2]},"properties":{}}]}"""
        suspend fun rejects(work: suspend () -> Unit) {
            val error = runCatching { work() }.exceptionOrNull() as? TileflowMapException
            assertEquals(TileflowErrorCode.INVALID_REQUEST, error?.code)
            assertEquals("invalidGeoJSON", error?.context?.reason)
            assertEquals("pointFeatures", error?.context?.rule)
        }
        try {
            rejects { map.addStyleSource("bad", JSONObject().put("type", "geojson").put("cluster", true).put("data", JSONObject(line))) }
            assertFalse(map.sourceExists("bad"))
            map.addStyleSource("line", JSONObject().put("type", "geojson").put("data", JSONObject(line)))
            rejects { map.updateSource("line", JSONObject().put("cluster", true)) }
            assertFalse(map.runtimeStyle.sources.single().spec.has("cluster"))
            map.addStyleSource("points", JSONObject().put("type", "geojson").put("cluster", true).put("data", JSONObject(point)))
            val before = map.runtimeStyle.sources.single { it.id == "points" }.geoJSON
            rejects { map.setGeoJSONSourceData("points", TileflowGeoJSONData.GeoJSON(line)) }
            val feature = TileflowFeature("2", TileflowGeometry.LineString(listOf(TileflowCoordinate(1.0,2.0),TileflowCoordinate(2.0,3.0))))
            rejects { map.addGeoJSONSourceFeatures("points", listOf(feature)) }
            rejects { map.updateGeoJSONSourceFeatures("points", listOf(feature), listOf("1")) }
            assertEquals(before, map.runtimeStyle.sources.single { it.id == "points" }.geoJSON)
            map.updateSource("line", JSONObject().put("cluster", true).put("data", JSONObject(point)))
            assertTrue(map.runtimeStyle.sources.single { it.id == "line" }.spec.getBoolean("cluster"))
        } finally { map.destroy(); activity.finish() }
    }

    @Test
    fun sourcePatchesPreserveDataEditsLayersAndStateAndRejectInvalidResults() = runBlocking {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val map = TileflowMapView(activity)
        try {
            map.addStyleSource("points", JSONObject("""{"type":"geojson","cluster":true,"clusterRadius":40}"""))
            map.addLayer(TileflowCircleLayer("points-layer", "points"))
            map.updateGeoJSONSourceFeatures("points", listOf(TileflowFeature("a", TileflowGeometry.Point(TileflowCoordinate(1.0, 2.0)))), listOf("b"))
            map.setFeatureState("points", featureId = "a", state = mapOf("selected" to TileflowStyleValue.Bool(true)))
            val edits = map.runtimeStyle.sources.single().geoJSON!!.updates
            map.updateSource("points", JSONObject().put("clusterRadius", 80))
            assertEquals(80, map.runtimeStyle.sources.single().spec.getInt("clusterRadius"))
            assertEquals(edits, map.runtimeStyle.sources.single().geoJSON!!.updates)
            assertEquals(listOf("points-layer"), map.runtimeStyle.layers.map { it.id })
            assertEquals(TileflowStyleValue.Bool(true), map.featureState("points", featureId = "a")["selected"])
            val before = map.runtimeStyle.sources.single()
            assertTrue(runCatching { map.updateSource("points", JSONObject().put("clusterRadius", -1)) }.isFailure)
            assertSame(before, map.runtimeStyle.sources.single())
            map.updateSource("points", JSONObject().put("clusterRadius", JSONObject.NULL))
            assertFalse(map.runtimeStyle.sources.single().spec.has("clusterRadius"))
            assertTrue(map.runtimeStyle.sources.single().spec.getBoolean("cluster"))
            assertEquals(edits, map.runtimeStyle.sources.single().geoJSON!!.updates)
            map.updateSource("points", JSONObject().put("data", "https://maps.example.test/data.geojson"))
            assertEquals(GeoJSONLog.Base.Url("https://maps.example.test/data.geojson"), map.runtimeStyle.sources.single().geoJSON!!.base)
            assertTrue(map.runtimeStyle.sources.single().geoJSON!!.updates.isEmpty())
            assertEquals(TileflowStyleValue.Bool(true), map.featureState("points", featureId = "a")["selected"])
        } finally { map.destroy(); activity.finish() }
    }
}
