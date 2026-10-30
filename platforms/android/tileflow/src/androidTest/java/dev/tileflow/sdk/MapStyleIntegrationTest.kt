package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.os.Build
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The application's runtime style through the embedded renderer: 100 000 clustered points with an
 * interactive cluster, feature state, images and queries, all surviving a theme change and a new
 * renderer. Run with the online fixture server and `adb reverse tcp:18645 tcp:<port>`. The test
 * prints its measurements for the device it runs on.
 */
@RunWith(AndroidJUnit4::class)
public class MapStyleIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()

    private fun show(): SceneHostActivity {
        val intent =
            Intent(instrumentation.context, SceneHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("map", "fixture")
        val activity = instrumentation.startActivitySync(intent) as SceneHostActivity
        assertTrue("The map did not load.", activity.loaded.await(30, TimeUnit.SECONDS))
        return activity
    }

    private suspend fun javascript(map: TileflowMapView, script: String): String =
        suspendCancellableCoroutine { continuation ->
            (map.getChildAt(0) as WebView).evaluateJavascript(script) {
                if (continuation.isActive) continuation.resume(it)
            }
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
        javascript(
            map,
            """
            window.tileflowFrames = [];
            (() => {
              let last;
              const frame = (time) => {
                if (last !== undefined) window.tileflowFrames.push(time - last);
                last = time;
                if (window.tileflowFrames.length < 90) requestAnimationFrame(frame);
              };
              requestAnimationFrame(frame);
            })();
            """
                .trimIndent(),
        )
        map.ease(update, durationMillis = 1500)
        until("frames sampled") {
            javascript(map, "window.tileflowFrames.length").toIntOrNull()?.let { it >= 60 } == true
        }
        val values = JSONArray(javascript(map, "window.tileflowFrames"))
        val sorted = (0 until values.length()).map { values.getDouble(it) }.sorted()
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
    public fun hundredThousandClusteredPointsSurviveAThemeChangeAndANewRenderer() {
        val activity = show()
        val map = activity.map
        val measurements = mutableListOf<String>()
        val e = TileflowExpression
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
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
                        TileflowHeatmapLayer("heat", "points").maxZoom(9.0),
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
                    val loads = activity.loads.size
                    map.reload()
                    val replay = millis {
                        until("the new renderer") { activity.loads.size > loads }
                        until("the style on the new renderer") {
                            selected().any { it.state["selected"] == TileflowStyleValue.Bool(true) }
                        }
                    }
                    measurements += "new renderer with the style replayed $replay ms"
                }
            }
            val failures = activity.events.filterIsInstance<TileflowMapEvent.Failed>()
            assertTrue("Map errors: $failures", failures.isEmpty())
            println(
                "Tileflow runtime style on ${Build.MODEL} API ${Build.VERSION.SDK_INT}: ${measurements.joinToString(", ")}."
            )
        } finally {
            activity.finish()
        }
    }
}
