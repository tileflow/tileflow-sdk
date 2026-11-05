package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Build
import dev.tileflow.sdk.engine.NativeMapEngine
import org.maplibre.android.maps.MapView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The application's runtime style through MapLibre Native: 100 000 clustered points with an
 * interactive cluster, feature state, images and queries, all surviving a theme change and a new
 * renderer. Run with the online fixture server and `adb reverse tcp:18645 tcp:<port>`. The test
 * prints its measurements for the device it runs on.
 */
@RunWith(AndroidJUnit4::class)
public class MapStyleIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun show(): NativeViewHostActivity {
        val intent = Intent(instrumentation.context, NativeViewHostActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return instrumentation.startActivitySync(intent) as NativeViewHostActivity
    }

    private suspend fun until(label: String, condition: suspend () -> Boolean) {
        withTimeout(30_000) {
            while (!condition()) delay(100)
        }
        println("Tileflow: $label")
    }

    private suspend fun millis(work: suspend () -> Unit): Long {
        val started = System.nanoTime()
        work()
        return (System.nanoTime() - started) / 1_000_000
    }

    /** Frame intervals in the renderer while the camera eases, as p50 and p95 in milliseconds. */
    private suspend fun frames(
        map: TileflowMapView,
        update: TileflowCameraUpdate,
    ): Pair<Double, Double> {
        val view = (map.readyEngine as NativeMapEngine).mapView
        var previous = 0L
        val intervals = mutableListOf<Double>()
        val listener = MapView.OnWillStartRenderingFrameListener {
            val now = System.nanoTime()
            if (previous > 0) intervals += (now - previous) / 1_000_000.0
            previous = now
        }
        view.addOnWillStartRenderingFrameListener(listener)
        try {
            map.ease(update, durationMillis = 1500)
            until("native frames sampled") { intervals.size >= 2 }
        } finally {
            view.removeOnWillStartRenderingFrameListener(listener)
        }
        val sorted = intervals.sorted()
        return sorted[sorted.size / 2] to sorted[((sorted.size - 1) * 0.95).toInt()]
    }

    private fun points(count: Int): String {
        val text = StringBuilder(count * 120).append("""{"type":"FeatureCollection","features":[""")
        for (index in 0 until count) {
            if (index > 0) text.append(',')
            val longitude = -3.9 + (index % 400) / 1000.0
            val latitude = 40.3 + (index / 400) / 1000.0
            text.append(
                """{"type":"Feature","id":$index,"properties":{"rank":${index % 10}},"geometry":{"type":"Point","coordinates":[$longitude,$latitude]}}"""
            )
        }
        return text.append("]}").toString()
    }

    private fun disc(): TileflowMapImage {
        val bitmap = Bitmap.createBitmap(24, 24, Bitmap.Config.ARGB_8888)
        Canvas(bitmap).drawCircle(12f, 12f, 8f, Paint().apply { color = android.graphics.Color.WHITE })
        return TileflowMapImage.fromBitmap("disc", bitmap, sdf = true)
    }

    @Test
    public fun inFlightSourceReportsCallerCancellationAndRendererRetirement() {
        for (operation in listOf("cancel", "reload", "destroy")) {
            val activity = show()
            try {
                runBlocking {
                    withContext(Dispatchers.Main) {
                        val map = activity.views.single()
                        val events = activity.recorded.single()
                        events.waitForLoads(1)
                        val loads = events.loads
                        val outcome = CompletableDeferred<Throwable?>()
                        val job = launch(start = CoroutineStart.UNDISPATCHED) {
                            outcome.complete(runCatching {
                                map.addStyleSource(operation, JSONObject()
                                    .put("type", "vector")
                                    .put("url", "${Fixture.ORIGIN}/runtime-style/invalid-tiles.json"))
                            }.exceptionOrNull())
                        }
                        when (operation) {
                            "cancel" -> job.cancel()
                            "reload" -> map.reload()
                            "destroy" -> map.destroy()
                        }
                        val failure = withTimeout(10_000) { outcome.await() }
                        when (operation) {
                            "cancel" -> {
                                assertTrue("Expected caller cancellation, got $failure", failure is CancellationException)
                                assertTrue("Cancelled source was retained", !map.sourceExists(operation))
                            }
                            "reload" -> {
                                assertEquals(TileflowErrorCode.CANCELLED, (failure as TileflowMapException).code)
                                assertTrue("Retired renderer's source was retained", !map.sourceExists(operation))
                                events.waitForLoads(loads + 1)
                                val style = requireNotNull(activity.engine?.map?.style)
                                assertTrue("Cancelled source reached the new renderer", style.getSource("__tileflow_source_$operation") == null)
                            }
                            "destroy" -> assertEquals(TileflowErrorCode.DISPOSED, (failure as TileflowMapException).code)
                        }
                    }
                }
            } finally {
                instrumentation.runOnMainSync { activity.finish() }
            }
        }
    }

    @Test
    public fun hundredThousandClusteredPointsSurviveAThemeChangeAndANewRenderer() {
        val activity = show()
        val map = activity.views.single()
        val events = activity.recorded.single()
        val measurements = mutableListOf<String>()
        val e = TileflowExpression
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    events.waitForLoads(1)
                    map.jump(TileflowCamera(-3.7, 40.42, 9.0))
                    // The same movement without the points, for comparison on this device.
                    val (baseP50, baseP95) =
                        frames(map, TileflowCameraUpdate(center = TileflowCoordinate(-3.65, 40.42)))
                    measurements += "frames while panning without points p50 %.1f / p95 %.1f ms".format(baseP50, baseP95)
                    map.jump(TileflowCamera(-3.7, 40.42, 9.0))
                    val data = points(100_000)
                    val add = millis {
                        map.addSource(
                            TileflowGeoJSONSource(
                                "points",
                                TileflowGeoJSONData.GeoJSON(data),
                                cluster = true,
                                clusterRadius = 50.0,
                                clusterProperties = mapOf("rankSum" to e.sum(e.get("rank"))),
                            )
                        )
                    }
                    measurements += "addSource 100k points (%.1f MiB) $add ms".format(data.length / 1_048_576.0)
                    map.addLayer(
                        TileflowCircleLayer("clusters", "points")
                            .filter(e.has("point_count"))
                            .circleColor(
                                e.step(
                                    e.get("point_count"),
                                    e.literal("#51bbd6"),
                                    e.literal(100.0),
                                    e.literal("#f1f075"),
                                    e.literal(750.0),
                                    e.literal("#f28cb1"),
                                )
                            )
                            .circleRadius(
                                e.step(
                                    e.get("point_count"),
                                    e.literal(16.0),
                                    e.literal(100.0),
                                    e.literal(22.0),
                                    e.literal(750.0),
                                    e.literal(30.0),
                                )
                            )
                            .slot(TileflowLayerSlot.ABOVE_LABELS)
                    )
                    map.addLayer(
                        TileflowCircleLayer("point", "points")
                            .filter(e.not(e.has("point_count")))
                            .circleRadius(5.0)
                            .circleColor(
                                e.switchCase(
                                    e.boolean(e.featureState("selected"), e.literal(false)),
                                    e.literal("#ff0000"),
                                    e.literal("#11b4da"),
                                )
                            )
                    )
                    map.addLayer(
                        TileflowHeatmapLayer("heat", "points").maxZoom(9.0).slot(TileflowLayerSlot.ABOVE_LABELS),
                        TileflowLayerPosition.Below("clusters"),
                    )
                    map.addImage(disc())
                    map.addLayer(
                        TileflowSymbolLayer("marks", "points")
                            .filter(e.not(e.has("point_count")))
                            .iconImage("disc")
                            .iconColor(TileflowColor.fromHex("#2a9d8f"))
                            .iconAllowOverlap(true)
                    )
                    assertEquals(
                        listOf("heat", "clusters", "point", "marks"),
                        map.runtimeStyle.layers.map { it.id },
                    )

                    var found = emptyList<TileflowQueriedFeature>()
                    val first = millis {
                        until("clusters") {
                            found =
                                map.queryRenderedFeatures(
                                    options = TileflowRenderedQueryOptions(listOf("clusters"))
                                )
                            found.isNotEmpty()
                        }
                    }
                    measurements += "first clusters queried $first ms"
                    val count = { feature: TileflowQueriedFeature ->
                        (feature.feature.properties["point_count"] as? TileflowJSON.Number)?.value ?: 0.0
                    }
                    val largest = found.maxBy(count)
                    assertEquals("clusters", largest.layer)
                    assertTrue((largest.feature.properties["rankSum"] as TileflowJSON.Number).value > 0)
                    val cluster = largest.feature.clusterId!!
                    val center = (largest.feature.geometry as TileflowGeometry.Point).coordinate
                    assertTrue(map.clusterChildren("points", cluster).size > 1)
                    assertEquals(
                        minOf(2000, count(largest).toInt()),
                        map.clusterLeaves("points", cluster, limit = 2000).size,
                    )
                    val tapped = map.project(center)
                    var zoom = 0.0
                    val tap = millis {
                        val hits =
                            map.queryRenderedFeatures(
                                TileflowQueryGeometry.Point(tapped),
                                TileflowRenderedQueryOptions(listOf("clusters")),
                            )
                        zoom = map.clusterExpansionZoom("points", hits.first().feature.clusterId!!)
                    }
                    measurements += "cluster tap to expansion zoom $tap ms"
                    assertTrue(zoom > 9)
                    val (p50, p95) = frames(map, TileflowCameraUpdate(center = center, zoom = zoom))
                    measurements += "frames while zooming into a cluster p50 %.1f / p95 %.1f ms".format(p50, p95)
                    val (panP50, panP95) =
                        frames(
                            map,
                            TileflowCameraUpdate(
                                center = TileflowCoordinate(center.longitude + 0.05, center.latitude)
                            ),
                        )
                    measurements += "frames while panning p50 %.1f / p95 %.1f ms".format(panP50, panP95)
                    val steep = millis {
                        map.jump(TileflowCamera(-3.7, 40.42, 12.0, pitch = 80.0))
                        until("features at pitch 80") {
                            map.queryRenderedFeatures(
                                    options = TileflowRenderedQueryOptions(limit = 100_000)
                                )
                                .isNotEmpty()
                        }
                    }
                    measurements += "whole-view query at pitch 80 $steep ms"

                    // Feature state and images survive a theme change.
                    map.setFeatureState(
                        "points",
                        featureId = "5",
                        state = mapOf("selected" to TileflowStyleValue.Bool(true)),
                    )
                    map.jump(TileflowCamera(-3.895, 40.3, 17.0))
                    val theme = millis { map.setTheme("dark") }
                    measurements += "theme change with 100k points $theme ms"
                    val selected = suspend {
                        val at = map.project(TileflowCoordinate(-3.895, 40.3))
                        map.queryRenderedFeatures(
                            TileflowQueryGeometry.Point(at),
                            TileflowRenderedQueryOptions(listOf("point", "marks")),
                        )
                    }
                    until("the selected point after a theme change") {
                        val hits = selected()
                        hits.any { it.layer == "point" && it.state["selected"] == TileflowStyleValue.Bool(true) } &&
                            hits.any { it.layer == "marks" }
                    }

                    // A new renderer receives the whole style again.
                    val loads = events.loads
                    map.reload()
                    val replay = millis {
                        until("the new renderer") { events.loads > loads }
                        until("the style on the new renderer") {
                            selected().any { it.state["selected"] == TileflowStyleValue.Bool(true) }
                        }
                    }
                    measurements += "new renderer with the style replayed $replay ms"
                }
            }
            val failures = events.failures
            assertTrue("Map errors: $failures", failures.isEmpty())
            println(
                "Tileflow runtime style on ${Build.MODEL} API ${Build.VERSION.SDK_INT}: ${measurements.joinToString(", ")}."
            )
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
