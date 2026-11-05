package dev.tileflow.sdk

import android.content.Intent
import android.graphics.PointF
import android.os.SystemClock
import android.view.MotionEvent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.engine.NativePoiManifest
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.style.expressions.Expression
import org.maplibre.android.style.layers.CircleLayer
import org.maplibre.android.style.sources.GeoJsonSource

/** The public point query and POI activation use the same fixture as the original renderer. */
@RunWith(AndroidJUnit4::class)
public class NativeMapInteractionsIntegrationTest {
    private val center = TileflowCoordinate(-3.7, 40.42)

    private suspend fun until(label: String, condition: suspend () -> Boolean) {
        val complete =
            withTimeoutOrNull(5_000) {
                while (!condition()) delay(50)
                true
            }
        assertTrue(label, complete == true)
    }

    private fun mounted(body: suspend (SceneHostActivity, TileflowMapView) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent =
            Intent(instrumentation.targetContext, SceneHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("map", "fixture")
                .putExtra("nativeEngine", true)
        val activity = instrumentation.startActivitySync(intent) as SceneHostActivity
        try {
            assertTrue("Fixture map loaded", activity.loaded.await(30, TimeUnit.SECONDS))
            runBlocking { withContext(Dispatchers.Main) { body(activity, activity.map) } }
        } finally {
            activity.finish()
        }
    }

    private suspend fun tap(map: TileflowMapView, point: TileflowPoint) {
        val down = SystemClock.uptimeMillis()
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, point.x, point.y, 0).also {
                map.dispatchTouchEvent(it)
                it.recycle()
            }
            delay(80)
        }
    }

    @Test
    public fun tappingTheMapActivatesItsSemanticPointOfInterest() = mounted { activity, map ->
        val point = map.project(center)
        val native = (map.readyEngine as NativeMapEngine).map!!
        until("MapLibre renders fixture POI 42") {
            native.queryRenderedFeatures(PointF(point.x, point.y), "poi").any { it.id() == "42" }
        }
        val contact = TileflowPoint(point.x + 6f, point.y)
        val expected = map.unproject(contact)
        tap(map, contact)
        until("The application receives the semantic POI") {
            activity.events.any { it is TileflowMapEvent.PoiActivated }
        }
        val hit =
            activity.events.filterIsInstance<TileflowMapEvent.PoiActivated>().single().selection
        assertEquals("42", hit.id)
        assertEquals("Tileflow", hit.name)
        assertEquals("food-drink", hit.category)
        assertEquals(expected.longitude, hit.coordinate.longitude, 1e-5)
        assertEquals(expected.latitude, hit.coordinate.latitude, 1e-5)

        fun pois() = activity.events.count { it is TileflowMapEvent.PoiActivated }
        fun taps() = activity.events.count { it is TileflowMapEvent.Tap }
        val tapsBefore = taps()
        assertEquals("A POI produces its activation without a background tap", 0, tapsBefore)
        val pins =
            map.annotations.createCircleAnnotationManager(TileflowAnnotationConfig("selectable"))
        val pin =
            pins.create(TileflowCircleAnnotationOptions().withPoint(center).withCircleRadius(16.0))
        var annotatedTaps = 0
        var takePress = true
        pins.addClickListener {
            if (it.id == pin.id) annotatedTaps++
            takePress
        }
        until("The manager draws its annotation over the POI") {
            native
                .queryRenderedFeatures(PointF(point.x, point.y), "__tileflow_layer_selectable")
                .isNotEmpty()
        }
        tap(map, point)
        until("The annotation listener consumes the tap") { annotatedTaps == 1 }
        assertEquals(1, pois())
        assertEquals(tapsBefore, taps())
        takePress = false
        delay(android.view.ViewConfiguration.getDoubleTapTimeout().toLong() + 30)
        tap(map, point)
        until("An annotation that declines the tap lets the POI activate") {
            annotatedTaps == 2 && pois() == 2
        }
        assertEquals(0, taps())
        map.annotations.removeAnnotationManager(pins)

        val down = SystemClock.uptimeMillis()
        fun send(action: Int) {
            MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, point.x, point.y, 0).also {
                map.dispatchTouchEvent(it)
                it.recycle()
            }
        }
        send(MotionEvent.ACTION_DOWN)
        delay(android.view.ViewConfiguration.getLongPressTimeout().toLong() + 150)
        send(MotionEvent.ACTION_UP)
        until("Holding a POI delivers a long press") {
            activity.events.any { it is TileflowMapEvent.LongPress }
        }
        assertEquals(2, pois())
        val background = TileflowPoint(point.x + 160f, point.y + 100f)
        tap(map, background)
        until("The background delivers an ordinary tap") { taps() > tapsBefore }
        assertEquals(2, pois())
    }

    @Test
    public fun pointQueriesIncludeApplicationOverlaysAcrossThemeAndReload() =
        mounted { activity, map ->
            val data =
                """{"type":"FeatureCollection","features":[{"type":"Feature","id":73,"geometry":{"type":"Point","coordinates":[-3.70,40.42]},"properties":{}}]}"""
            map.setContent(
                layers =
                    listOf(
                        TileflowGeoJSONLayer(
                            "selection",
                            data,
                            TileflowGeoJSONLayerKind.CIRCLE,
                            placement = TileflowLayerPlacement.TOP,
                        )
                    )
            )
            suspend fun assertHits() {
                val point = map.project(center)
                val native = (map.readyEngine as NativeMapEngine).map!!
                until("MapLibre draws the application overlay") {
                    native
                        .queryRenderedFeatures(PointF(point.x, point.y), "__tileflow_app_selection")
                        .isNotEmpty()
                }
                val hits = map.query(point.x, point.y)
                val overlay =
                    hits.indexOfFirst {
                        it.layer == "__tileflow_app_selection" &&
                            it.source == "__tileflow_app_selection" &&
                            it.id == "73"
                    }
                val poi = hits.indexOfFirst { it.layer == "poi" && it.id == "42" }
                assertTrue(
                    "The point query returns the overlay above the POI: $hits",
                    overlay >= 0 && poi > overlay,
                )
            }
            assertHits()
            map.setTheme("dark")
            assertHits()
            val loads = activity.loads.size
            map.reload()
            until("The replacement map is ready") { activity.loads.size > loads }
            assertHits()

            val points =
                TileflowGeoJSONData.Features(
                    (1..65).map { TileflowFeature(it.toString(), TileflowGeometry.Point(center)) }
                )
            map.addSource(TileflowGeoJSONSource("live", points))
            map.addLayer(TileflowCircleLayer("top", "live").circleRadius(8.0))
            val point = map.project(center)
            until("The top runtime layer fills the public query limit") {
                val hits = map.query(point.x, point.y)
                hits.size == 50 &&
                    hits.all {
                        it.layer == "__tileflow_layer_top" && it.source == "__tileflow_source_live"
                    }
            }
        }

    @Test
    public fun pointDataIsSharedReleasedAndPreservedAfterRejection() = mounted { _, map ->
        val engine = map.readyEngine as NativeMapEngine
        val (geojson, count) = largeFeatureCollection(5 * 1024 * 1024)
        assertTrue(count > 20_500)
        val overlays =
            listOf("base", "outline").map {
                TileflowGeoJSONLayer(
                    it,
                    geojson,
                    TileflowGeoJSONLayerKind.CIRCLE,
                    placement = TileflowLayerPlacement.TOP,
                )
            }
        map.setContent(layers = overlays)
        assertTrue("Each reference was released after its request", engine.data.isEmpty)
        val at = map.project(center)
        suspend fun rendered() = map.query(at.x, at.y).any { it.layer == "__tileflow_app_outline" }
        until("5 MiB of data renders after its handles were released") { rendered() }
        val refused =
            runCatching {
                    map.setContent(
                        layers =
                            listOf(
                                TileflowGeoJSONLayer(
                                    "invalid",
                                    """{"type":"FeatureCollection","features":false}""",
                                    TileflowGeoJSONLayerKind.CIRCLE,
                                )
                            )
                    )
                }
                .exceptionOrNull()
        assertEquals(TileflowErrorCode.INVALID_REQUEST, (refused as TileflowMapException).code)
        assertTrue(engine.data.isEmpty)
        assertTrue(rendered())
    }

    @Test
    public fun renderingOrderAndTypedIdentityChooseThePoiRepresentation() = mounted { _, map ->
        val native = (map.readyEngine as NativeMapEngine).map!!
        val style = requireNotNull(native.style)
        val entries =
            listOf("string-label" to "label", "numeric-marker" to "marker", "string-icon" to "icon")
        val features = JSONArray()
        for ((kind, _) in entries) features.put(
            JSONObject()
                .put("type", "Feature")
                .put("id", if (kind == "numeric-marker") 42 else "42")
                .put("properties", JSONObject().put("title", kind).put("group", "food-drink"))
                .put(
                    "geometry",
                    JSONObject()
                        .put("type", "Point")
                        .put("coordinates", JSONArray().put(center.longitude).put(center.latitude)),
                )
        )
        style.addSource(
            GeoJsonSource(
                "typed",
                JSONObject().put("type", "FeatureCollection").put("features", features).toString(),
            )
        )
        for ((name, _) in entries.asReversed()) style.addLayer(
            CircleLayer(name, "typed")
                .withFilter(Expression.eq(Expression.get("title"), Expression.literal(name)))
        )
        val fields =
            JSONObject().apply {
                for (field in listOf("filterRank", "icon", "sizeRank", "type")) put(field, field)
                put("name", "title")
                put("category", "group")
            }
        val definitions =
            JSONArray(
                entries.map { (id, rep) ->
                    JSONObject()
                        .put("layerId", id)
                        .put("source", "typed")
                        .put("anchor", "pointer-coordinate")
                        .put("priority", 20)
                        .put("representation", rep)
                }
            )
        val poi =
            JSONObject()
                .put("identity", "maplibre-feature-id-if-present")
                .put("fields", fields)
                .put("layers", definitions)
                .put(
                    "hitTesting",
                    JSONObject()
                        .put("order", "rendered-topmost")
                        .put("frequency", "animation-frame"),
                )
                .put(
                    "deduplication",
                    JSONObject()
                        .put("identity", JSONArray(listOf("source", "source-layer", "feature-id")))
                        .put(
                            "representationPriority",
                            JSONArray(listOf("marker", "icon", "combined", "label")),
                        ),
                )
        val document =
            JSONObject()
                .put(
                    "layers",
                    JSONArray(
                        entries.map { (id, _) -> JSONObject().put("id", id).put("source", "typed") }
                    ),
                )
                .put(
                    "metadata",
                    JSONObject()
                        .put(
                            "tileflow:interaction-manifest",
                            JSONObject()
                                .put("version", 3)
                                .put("domains", JSONObject().put("poi", poi)),
                        ),
                )
        val spec = requireNotNull(NativePoiManifest.read(document))
        val at = map.project(center)
        val pixel = PointF(at.x, at.y)
        until("All three overlapping representations are rendered") {
            entries.all { native.queryRenderedFeatures(pixel, it.first).isNotEmpty() }
        }
        val hit = requireNotNull(spec.at(native, pixel, JSONObject()))
        assertEquals("string-icon", hit.getString("name"))
        assertEquals("42", hit.getString("id"))
        definitions.getJSONObject(0).put("sourceLayer", "other")
        assertEquals(null, NativePoiManifest.read(document))
    }
}
