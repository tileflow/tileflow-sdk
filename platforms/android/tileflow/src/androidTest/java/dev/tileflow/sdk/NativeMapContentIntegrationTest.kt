package dev.tileflow.sdk

import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ComposeView
import androidx.test.core.app.ActivityScenario
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.model.MapContract.Method
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.location.TileflowLocationOptions
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.style.layers.CircleLayer

public class MapContentHostActivity : ComponentActivity() {
    internal enum class Stage {
        EMPTY,
        ACTIVE,
        REORDERED,
        COLLISION,
        INVALID,
        REMOVED,
    }

    internal val controller = TileflowMapController()
    internal val events = CopyOnWriteArrayList<TileflowMapEvent>()
    internal val loaded = CountDownLatch(1)
    internal var stage by mutableStateOf(Stage.EMPTY)
    internal var tick by mutableIntStateOf(0)
    internal val center = TileflowCoordinate(-3.70, 40.42)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (intent.getBooleanExtra("invalid", false)) stage = Stage.INVALID
        setContentView(
            ComposeView(this).apply {
                setContent {
                    TileflowMap(
                        NativeViewHostActivity.CITY,
                        content = {
                            if (stage != Stage.EMPTY && stage != Stage.REMOVED) {
                                val data =
                                    TileflowGeoJSONData.GeoJSON(
                                        """{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"properties":{"tick":${tick / 2}},"geometry":{"type":"Point","coordinates":[-3.7,40.42]}}]}"""
                                    )
                                source(
                                    TileflowGeoJSONSource(
                                        "places",
                                        data,
                                        buffer = if (stage == Stage.INVALID) 64 else null,
                                    )
                                )
                                val a = TileflowCircleLayer("a", "places").circleRadius(6.0 + tick)
                                val b = TileflowCircleLayer("b", "places").circleRadius(3.0)
                                if (stage == Stage.ACTIVE) {
                                    layer(a)
                                    layer(b)
                                } else {
                                    layer(b)
                                    layer(a)
                                }
                                annotation(TileflowAnnotation("stop", center, "Stop $tick"))
                                location(TileflowLocationOptions(enabled = true))
                                if (stage == Stage.COLLISION)
                                    source(
                                        TileflowGeoJSONSource(
                                            "imperative",
                                            TileflowGeoJSONData.Empty,
                                        )
                                    )
                                if (stage == Stage.INVALID)
                                    source(
                                        TileflowVectorSource(
                                            "invalid",
                                            TileflowTiles.TileJSON(
                                                "${Fixture.ORIGIN}/runtime-style/invalid-tiles.json"
                                            ),
                                        )
                                    )
                            }
                        },
                        modifier = Modifier.fillMaxSize(),
                        options = TileflowMapOptions(antialias = false),
                        controller = controller,
                        onEvent = {
                            events.add(it)
                            if (it == TileflowMapEvent.ContentReady) loaded.countDown()
                        },
                    )
                }
            }
        )
    }
}

@RunWith(AndroidJUnit4::class)
public class NativeMapContentIntegrationTest {
    private suspend fun until(label: String, condition: suspend () -> Boolean) {
        val completed =
            withTimeoutOrNull(12_000) {
                while (!condition()) delay(30)
                true
            }
        assertTrue(label, completed == true)
    }

    private fun mounted(
        initiallyInvalid: Boolean = false,
        body: suspend (MapContentHostActivity, TileflowMapView, NativeMapEngine) -> Unit,
    ) {
        val intent =
            Intent(
                    InstrumentationRegistry.getInstrumentation().targetContext,
                    MapContentHostActivity::class.java,
                )
                .putExtra("invalid", initiallyInvalid)
        ActivityScenario.launch<MapContentHostActivity>(intent).use { scenario ->
            lateinit var activity: MapContentHostActivity
            scenario.onActivity { activity = it }
            assertTrue(activity.loaded.await(30, TimeUnit.SECONDS))
            runBlocking {
                withContext(Dispatchers.Main) {
                    val view = activity.controller.attached()
                    body(activity, view, view.readyEngine as NativeMapEngine)
                }
            }
        }
    }

    @Test
    public fun changesAtTenHertzPreserveTheRendererAndImperativeContent() =
        mounted { screen, view, engine ->
            val point = screen.center
            val external = TileflowAnnotation("external", point, "External")
            val line =
                TileflowGeoJSONLayer(
                    "line",
                    """{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-3.7,40.42],[-3.69,40.42]]}}""",
                    TileflowGeoJSONLayerKind.LINE,
                    progress = TileflowLineProgress(end = 0.0),
                )
            view.setContent(listOf(external), listOf(line))
            view.addSource(TileflowGeoJSONSource("imperative", TileflowGeoJSONData.Empty))
            screen.stage = MapContentHostActivity.Stage.ACTIVE
            until("declared features and location") {
                view.layerExists("b") &&
                    view.options.location.enabled &&
                    view.content.annotations.size == 2
            }
            view.addLayer(
                TileflowCircleLayer("outside", "imperative"),
                TileflowLayerPosition.Above("a"),
            )
            val counts = engine.received.toMap()
            fun changes(method: Method) = (engine.received[method] ?: 0) - (counts[method] ?: 0)
            val start = SystemClock.uptimeMillis()
            kotlinx.coroutines.coroutineScope {
                val motion =
                    async(start = CoroutineStart.UNDISPATCHED) {
                        view.animateLineProgress(
                            listOf("line"),
                            TileflowLineProgress(end = 1.0),
                            1400,
                        )
                    }
                for (tick in 1..10) {
                    screen.tick = tick
                    delay((start + tick * 100 - SystemClock.uptimeMillis()).coerceAtLeast(0))
                }
                println(
                    "Tileflow: 10 Compose revisions scheduled in ${SystemClock.uptimeMillis() - start} ms"
                )
                until("last layer and marker rendered") {
                    engine.map
                        ?.style
                        ?.getLayerAs<CircleLayer>("__tileflow_layer_a")
                        ?.circleRadius
                        ?.value == 16f && view.content.annotations.any { it.title == "Stop 10" }
                }
                assertTrue("Marker edits preserve an imperative line animation", motion.await())
            }
            assertEquals(10, changes(Method.UPDATE_LAYER))
            assertEquals(5, changes(Method.SET_GEO_JSON_SOURCE_DATA))
            assertEquals(10, changes(Method.SET_CONTENT))
            for (command in
                listOf(
                    Method.ADD_SOURCE,
                    Method.REMOVE_SOURCE,
                    Method.ADD_LAYER,
                    Method.REMOVE_LAYER,
                    Method.MOVE_LAYER,
                )) assertEquals(command.toString(), 0, changes(command))
            assertSame(view, screen.controller.attached())
            assertSame(engine, view.readyEngine)
            assertEquals(1, screen.events.count { it == TileflowMapEvent.ContentReady })
            assertTrue(view.content.annotations.contains(external))
            val style = engine.map!!.style!!
            fun declaredOrder() =
                style.layers
                    .map { it.id }
                    .filter { it == "__tileflow_layer_a" || it == "__tileflow_layer_b" }
            screen.stage = MapContentHostActivity.Stage.REORDERED
            until("layer order changes") {
                declaredOrder() == listOf("__tileflow_layer_b", "__tileflow_layer_a")
            }
            assertEquals(1, changes(Method.MOVE_LAYER))
            val selected = mapOf("selected" to TileflowStyleValue.Bool(true))
            view.setFeatureState("places", featureId = "1", state = selected)
            screen.stage = MapContentHostActivity.Stage.COLLISION
            until("source collision rejected") {
                screen.events.filterIsInstance<TileflowMapEvent.Failed>().size == 1
            }
            assertTrue(view.sourceExists("imperative"))
            screen.stage = MapContentHostActivity.Stage.INVALID
            until("remote declaration is in flight") { view.sourceExists("invalid") }
            kotlinx.coroutines.coroutineScope {
                val imperative = async {
                    view.addSource(TileflowGeoJSONSource("concurrent", TileflowGeoJSONData.Empty))
                }
                screen.stage = MapContentHostActivity.Stage.REORDERED
                screen.tick = 11
                delay(50)
                screen.tick = 12
                until("partial declaration rejected") {
                    screen.events.filterIsInstance<TileflowMapEvent.Failed>().size == 2
                }
                imperative.await()
            }
            until("latest pending changes drawn") {
                style.getLayerAs<CircleLayer>("__tileflow_layer_a")?.circleRadius?.value == 18f
            }
            until("the renderer restores feature state after rollback") {
                val data =
                    style.getSourceAs<org.maplibre.android.style.sources.GeoJsonSource>(
                        "__tileflow_source_places"
                    )
                data?.getFeatureState("1")?.get("selected")?.asBoolean == true
            }
            assertFalse(view.sourceExists("invalid"))
            assertTrue(view.sourceExists("concurrent"))
            assertEquals(selected, view.featureState("places", featureId = "1"))
            assertEquals(listOf("__tileflow_layer_b", "__tileflow_layer_a"), declaredOrder())
            assertEquals(
                18f,
                style.getLayerAs<CircleLayer>("__tileflow_layer_a")!!.circleRadius.value,
            )
            screen.stage = MapContentHostActivity.Stage.REORDERED
            val loads = screen.events.count { it == TileflowMapEvent.ContentReady }
            view.reload()
            until("content replayed") {
                screen.events.count { it == TileflowMapEvent.ContentReady } > loads
            }
            assertTrue(view.options.location.enabled && view.layerExists("a"))
            screen.stage = MapContentHostActivity.Stage.REMOVED
            until("declarative content removed") {
                !view.options.location.enabled && !view.sourceExists("places")
            }
            assertEquals(listOf(external), view.content.annotations)
            assertTrue(view.sourceExists("imperative") && view.layerExists("outside"))
            assertTrue(view.content.overlays.any { it.id == "line" })
        }

    @Test
    public fun aRejectedInitialDeclarationLeavesTheBaseMapReady() =
        mounted(initiallyInvalid = true) { screen, view, engine ->
            until("initial rejection is reported once") {
                screen.events.filterIsInstance<TileflowMapEvent.Failed>().size == 1
            }
            assertTrue(screen.events.contains(TileflowMapEvent.ContentReady))
            assertFalse(
                view.sourceExists("invalid") || view.sourceExists("places") || view.layerExists("a")
            )
            assertFalse(view.options.location.enabled)
            assertFalse(
                "The base map has its own renderer options even if its declaration fails",
                view.options.antialias,
            )
            screen.stage = MapContentHostActivity.Stage.ACTIVE
            until("corrected declaration drawn") {
                view.layerExists("b") && view.options.location.enabled
            }
            assertSame(engine, view.readyEngine)
        }

    @Test
    public fun screenReaderActionsMoveTheRotatedMapWithoutReplacingItsChildren() =
        mounted { screen, view, engine ->
            view.jump(
                TileflowCamera(
                    screen.center.longitude,
                    screen.center.latitude,
                    15.0,
                    bearing = 75.0,
                    pitch = 25.0,
                )
            )
            view.setContentPadding(120f, 40f, 25f, 65f)
            val marker = TileflowAnnotation("station", screen.center, "Station")
            view.setContent(listOf(marker))
            val node = view.accessibilitySummary.createAccessibilityNodeInfo()
            assertTrue(node.contentDescription.toString().contains("latitude 40.4200"))
            val actions =
                listOf(
                    R.id.tileflow_zoom_in,
                    R.id.tileflow_zoom_out,
                    R.id.tileflow_pan_north,
                    R.id.tileflow_pan_south,
                    R.id.tileflow_pan_east,
                    R.id.tileflow_pan_west,
                )
            assertTrue(node.actionList.map { it.id }.containsAll(actions))
            for (action in actions) {
                val before = view.camera()
                assertTrue(view.accessibilitySummary.performAccessibilityAction(action, null))
                until("directional camera action $action") {
                    val after = view.camera()
                    !view.isMoving &&
                        when (action) {
                            R.id.tileflow_zoom_in -> abs(after.zoom - before.zoom - 1) < .01
                            R.id.tileflow_zoom_out -> abs(after.zoom - before.zoom + 1) < .01
                            R.id.tileflow_pan_north ->
                                after.latitude > before.latitude &&
                                    abs(after.longitude - before.longitude) < 1e-5
                            R.id.tileflow_pan_south ->
                                after.latitude < before.latitude &&
                                    abs(after.longitude - before.longitude) < 1e-5
                            R.id.tileflow_pan_east ->
                                after.longitude > before.longitude &&
                                    abs(after.latitude - before.latitude) < 1e-5
                            else ->
                                after.longitude < before.longitude &&
                                    abs(after.latitude - before.latitude) < 1e-5
                        }
                }
            }
            assertSame(engine, view.readyEngine)
            val found = arrayListOf<android.view.View>()
            view.findViewsWithText(
                found,
                marker.title,
                android.view.View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION,
            )
            assertTrue(found.any { it.isClickable })
            assertTrue(view.controlsView.parent === view)
            assertTrue(engine.attribution.view.isShown)
        }
}
