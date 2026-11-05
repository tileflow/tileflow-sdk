package dev.tileflow.reactnative

import androidx.test.core.app.ApplicationProvider
import dev.tileflow.reactnative.map.MapCameraOperations
import dev.tileflow.sdk.TileflowCameraAnimation
import dev.tileflow.sdk.TileflowEasing
import dev.tileflow.sdk.TileflowEdgeInsets
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.TileflowMapView
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeMapCameraTest {
    @Test
    fun animationsUseMillisecondsAndFlightsKeepTheirAutomaticDuration() {
        val fixture =
            JSONObject(
                javaClass.classLoader!!.getResourceAsStream("map-bridge.json")!!.reader().readText()
            )
        val command = fixture.getJSONObject("camera").getJSONObject("command")
        assertEquals(TileflowCameraAnimation.Ease(250), MapCameraOperations.animation(command))
        assertEquals(TileflowCameraAnimation.None, MapCameraOperations.animation(JSONObject()))
        assertEquals(
            TileflowCameraAnimation.Ease(500, TileflowEasing.LINEAR),
            MapCameraOperations.animation(JSONObject("""{"animationMode":"linearTo"}""")),
        )
        val fly =
            MapCameraOperations.animation(JSONObject("""{"animationMode":"flyTo"}"""))
                as TileflowCameraAnimation.Fly
        assertNull(fly.options.durationMillis)
        for (duration in listOf(-1, 20_001)) assertThrows(TileflowMapException::class.java) {
            MapCameraOperations.animation(JSONObject().put("animationDuration", duration))
        }
    }

    @Test
    fun initialFitPaddingDoesNotBecomePersistentContentPadding() {
        val map = TileflowMapView(ApplicationProvider.getApplicationContext())
        try {
            map.setContentPadding(2f, 4f, 6f, 8f)
            val operations = MapCameraOperations(map)
            operations.setSource(
                TileflowMapSource.hosted("map_offlinefixture01"),
                JSONObject(
                    """{
              "bounds":{"ne":[-3.69,40.43],"sw":[-3.71,40.41]},
              "padding":{"paddingLeft":10,"paddingTop":20,"paddingRight":30,"paddingBottom":40},
              "zoomLevel":16
            }"""
                ),
            )
            assertEquals(TileflowEdgeInsets(2f, 4f, 6f, 8f), map.effectiveContentPadding)
            operations.setSource(
                TileflowMapSource.hosted("map_offlinefixture02"),
                JSONObject(
                    """{
              "zoomLevel":16,"padding":{"paddingLeft":10,"paddingTop":20,"paddingRight":30,"paddingBottom":40}
            }"""
                ),
            )
            val density = map.resources.displayMetrics.density
            assertEquals(
                TileflowEdgeInsets(10f * density, 20f * density, 30f * density, 40f * density),
                map.effectiveContentPadding,
            )
        } finally {
            map.destroy()
        }
    }

    @Test
    fun aBoundsAndCenterConflictIsRejectedBeforeChangingSourceOrPadding() = runBlocking {
        val map = TileflowMapView(ApplicationProvider.getApplicationContext())
        try {
            val source = TileflowMapSource.hosted("map_offlinefixture01")
            map.setSource(source)
            map.setContentPadding(2f, 4f, 6f, 8f)
            val operations = MapCameraOperations(map)
            val invalid =
                JSONObject(
                    """{"bounds":{"ne":[-3.69,40.43],"sw":[-3.71,40.41]},
              "centerCoordinate":[-3.7,40.42],"padding":{"paddingLeft":100}}"""
                )
            assertThrows(TileflowMapException::class.java) {
                operations.setSource(TileflowMapSource.hosted("map_offlinefixture02"), invalid)
            }
            val rejected =
                runCatching { operations.call("setCamera", invalid) }.exceptionOrNull()
                    as TileflowMapException
            assertEquals(TileflowErrorCode.INVALID_REQUEST, rejected.code)
            assertEquals(source, map.source)
            assertEquals(TileflowEdgeInsets(2f, 4f, 6f, 8f), map.effectiveContentPadding)
        } finally {
            map.destroy()
        }
    }
}
