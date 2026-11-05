package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.engine.NativeMapEngine
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.style.layers.CircleLayer

@RunWith(AndroidJUnit4::class)
class NativeSourceUpdateIntegrationTest {
    private suspend fun until(condition: suspend () -> Boolean) {
        withTimeout(15_000) { while (!condition()) delay(50) }
    }

    @Test
    fun rebuildingASourcePreservesEditsStateAndLayersAndRollsBackFailure() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val activity = instrumentation.startActivitySync(
            Intent(instrumentation.targetContext, SceneHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("map", "appearance")
        ) as SceneHostActivity
        try {
            assertTrue(activity.loaded.await(30, TimeUnit.SECONDS))
            runBlocking { withContext(Dispatchers.Main) {
                val map = activity.map
                val origin = TileflowCoordinate(-3.70, 40.42)
                map.jump(TileflowCamera(origin.longitude, origin.latitude, 14.0))
                map.addStyleSource("changing", JSONObject("""{"type":"geojson","cluster":true,"clusterRadius":1,"clusterMaxZoom":20}"""))
                map.addStyleLayer(JSONObject("""{"id":"changing-layer","type":"circle","source":"changing","paint":{"circle-radius":12,"circle-color":["case",["boolean",["feature-state","selected"],false],"#ff0000","#0000ff"]}}"""))
                val a = TileflowFeature("1", TileflowGeometry.Point(origin), mapOf("name" to TileflowJSON.Text("A")))
                val b = TileflowFeature("2", TileflowGeometry.Point(TileflowCoordinate(-3.699, 40.421)))
                map.addGeoJSONSourceFeatures("changing", listOf(a, b))
                until { map.querySourceFeatures("changing").map { it.feature.id }.toSet() == setOf("1", "2") }
                val updated = a.copy(properties = mapOf("name" to TileflowJSON.Text("Updated")))
                map.updateGeoJSONSourceFeatures("changing", listOf(updated, b.copy(id = "3")), listOf("2"))
                map.setFeatureState("changing", featureId = "1", state = mapOf("selected" to TileflowStyleValue.Bool(true)))
                until { map.querySourceFeatures("changing").map { it.feature.id }.toSet() == setOf("1", "3") }
                map.updateSource("changing", JSONObject().put("clusterRadius", 80))
                until {
                    map.querySourceFeatures("changing").any {
                        (it.feature.properties["point_count"] as? TileflowJSON.Number)?.value == 2.0
                    }
                }
                map.updateSource("changing", JSONObject().put("clusterMaxZoom", 4))
                suspend fun unchanged() {
                    until { map.querySourceFeatures("changing").map { it.feature.id }.toSet() == setOf("1", "3") }
                    assertEquals(TileflowStyleValue.Bool(true), map.featureState("changing", featureId = "1")["selected"])
                    val features = map.querySourceFeatures("changing")
                    assertEquals(TileflowJSON.Text("Updated"), features.single { it.feature.id == "1" }.feature.properties["name"])
                    val renderer = (map.readyEngine as NativeMapEngine).map!!
                    assertNotNull(renderer.style!!.getLayer("__tileflow_layer_changing-layer"))
                    until {
                        val point = map.project(origin)
                        val image = suspendCancellableCoroutine<android.graphics.Bitmap> { waiting ->
                            renderer.snapshot { if (waiting.isActive) waiting.resumeWith(Result.success(it)) }
                        }
                        try {
                            val color = image.getPixel(point.x.toInt(), point.y.toInt())
                            Color.red(color) > 240 && Color.green(color) < 20 && Color.blue(color) < 20
                        } finally { image.recycle() }
                    }
                }
                unchanged()
                val renderer = (map.readyEngine as NativeMapEngine).map!!
                val style = renderer.style!!
                // A native dependency outside the SDK's list makes removal fail after its own
                // layers have been detached. The public call must restore those layers.
                style.addLayer(CircleLayer("source-removal-blocker", "__tileflow_source_changing"))
                assertTrue(runCatching { map.updateSource("changing", JSONObject().put("clusterRadius", 120)) }.isFailure)
                assertNotNull(style.getSource("__tileflow_source_changing"))
                assertNotNull(style.getLayer("__tileflow_layer_changing-layer"))
                style.removeLayer("source-removal-blocker")
                unchanged()
                assertTrue(runCatching {
                    map.updateSource("changing", JSONObject().put("data", "${Fixture.ORIGIN}/runtime-style/invalid-tiles.json"))
                }.isFailure)
                unchanged()
                map.updateSource("changing", JSONObject().put("clusterRadius", JSONObject.NULL))
                assertFalse(map.runtimeStyle.sources.single { it.id == "changing" }.spec.has("clusterRadius"))
                map.setTheme("dark")
                unchanged()
                val count = activity.loads.size
                map.reload()
                until { activity.loads.size > count }
                unchanged()
                val mixed = runCatching { map.updateSource("changing", JSONObject().put("data", "${Fixture.ORIGIN}/data.json")) }.exceptionOrNull()
                assertEquals("invalidGeoJSON", (mixed as? TileflowMapException)?.context?.reason)
                unchanged()
                map.updateSource("changing", JSONObject().put("cluster", false).put("data", "${Fixture.ORIGIN}/data.json"))
                until { map.querySourceFeatures("changing").any { it.feature.id == "42" } }
                assertTrue(activity.events.filterIsInstance<TileflowMapEvent.Failed>().isEmpty())
            } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }
}
