package dev.tileflow.reactnative

import androidx.test.core.app.ApplicationProvider
import dev.tileflow.reactnative.map.NativeMapSession
import dev.tileflow.reactnative.map.MapValues
import dev.tileflow.sdk.*
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeMapSessionTest {
    @Test
    fun sourceMutationsRetainStateAndRejectMixedClusterDataAtomically() = runBlocking {
        val map = TileflowMapView(ApplicationProvider.getApplicationContext())
        val session = NativeMapSession(map, { error("No media requested") }, { JSONObject() }, { _, _ -> })
        try {
            session.call("addSource", JSONObject("""{"id":"points","properties":{"type":"geojson","cluster":true}}"""))
            session.call("updateGeoJSONSource", JSONObject("""{"id":"points","update":{"add":[{"type":"Feature","id":"a","geometry":{"type":"Point","coordinates":[1,2]},"properties":{}}],"remove":["b"]}}"""))
            session.call("setFeatureState", JSONObject("""{"sourceId":"points","featureId":"a","state":{"selected":true}}"""))
            session.call("updateSource", JSONObject("""{"id":"points","properties":{"clusterRadius":60}}"""))
            val state = session.call("getFeatureState", JSONObject("""{"sourceId":"points","featureId":"a"}""")) as JSONObject
            assertTrue(state.getBoolean("selected"))
            val error = runCatching { session.call("setGeoJSONSourceData", JSONObject("""{"id":"points","data":{"type":"LineString","coordinates":[[1,2],[2,3]]}}""")) }.exceptionOrNull() as TileflowMapException
            assertEquals("invalidGeoJSON", error.context.reason)
            assertTrue(map.sourceExists("points"))
        } finally { session.destroy() }
        assertEquals(TileflowErrorCode.DISPOSED, (runCatching { session.call("removeSource", JSONObject().put("id", "points")) }.exceptionOrNull() as TileflowMapException).code)
    }

    @Test
    fun hiddenLocationUpdatesDoNotShowPuckAndStopWithoutConsumers() = runBlocking {
        val map = TileflowMapView(ApplicationProvider.getApplicationContext())
        val session = NativeMapSession(map, { error("No media requested") }, { JSONObject() }, { _, _ -> })
        try {
            session.call("setUserLocation", JSONObject("""{"visible":false,"emitsUpdates":true}"""))
            assertTrue(map.options.location.enabled)
            assertFalse(map.options.location.showsPuck)
            session.call("setUserLocation", JSONObject("""{"visible":false,"emitsUpdates":false,"followUserLocation":true}"""))
            assertTrue(map.options.location.enabled)
            assertFalse(map.options.location.showsPuck)
            assertEquals(dev.tileflow.sdk.location.TileflowFollowMode.POSITION, map.followMode)
            session.call("setUserLocation", JSONObject("""{"visible":false,"emitsUpdates":false}"""))
            assertFalse(map.options.location.enabled)
        } finally { session.destroy() }
    }

    @Test
    fun positionConflictsIncludeCorrectionsAndNullableSlots() {
        val error = runCatching { MapValues.layerPosition(JSONObject("""{"aboveLayerId":"a","slotIndex":0}"""), "b", "moveLayer") }.exceptionOrNull() as TileflowMapException
        val context = MapValues.failure(error).getJSONObject("context")
        assertEquals("invalidLayerPosition", context.getString("reason"))
        assertEquals("onePosition", context.getString("rule"))
        assertEquals("moveLayer", context.getString("operation"))
        assertEquals("b", context.getString("layerId"))
        assertTrue(context.isNull("slot"))
        assertEquals("chooseOnePosition", context.getJSONArray("corrections").getJSONObject(0).getString("code"))
    }
}
