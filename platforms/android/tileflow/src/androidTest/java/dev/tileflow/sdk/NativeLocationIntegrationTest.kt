package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.location.TileflowFollowMode
import dev.tileflow.sdk.location.TileflowFollowModeChangeReason
import dev.tileflow.sdk.location.TileflowHeading
import dev.tileflow.sdk.location.TileflowLocation
import dev.tileflow.sdk.location.TileflowLocationConsumer
import dev.tileflow.sdk.location.TileflowLocationOptions
import dev.tileflow.sdk.location.TileflowLocationProvider
import dev.tileflow.sdk.location.TileflowPuckBearing
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.location.LocationComponentConstants
import org.maplibre.android.location.modes.CameraMode
import org.maplibre.android.location.modes.RenderMode
import org.maplibre.android.style.layers.SymbolLayer

@RunWith(AndroidJUnit4::class)
public class NativeLocationIntegrationTest {
    private class Provider : TileflowLocationProvider {
        var consumer: TileflowLocationConsumer? = null

        override fun addConsumer(consumer: TileflowLocationConsumer) {
            this.consumer = consumer
        }

        override fun removeConsumer(consumer: TileflowLocationConsumer) {
            if (consumer === this.consumer) this.consumer = null
        }
    }

    private suspend fun until(label: String, condition: suspend () -> Boolean) {
        val complete =
            withTimeoutOrNull(12_000) {
                while (!condition()) delay(50)
                true
            }
        assertTrue(label, complete == true)
        println("Tileflow: $label")
    }

    @Test
    public fun aHiddenPuckKeepsReceivingFixesAndFollowingUntilConsumptionStops() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val activity = instrumentation.startActivitySync(
            Intent(instrumentation.targetContext, SceneHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("map", "appearance")
        ) as SceneHostActivity
        try {
            assertTrue(activity.loaded.await(30, TimeUnit.SECONDS))
            runBlocking { withContext(Dispatchers.Main) {
                val map = activity.map
                val provider = Provider()
                val options = TileflowLocationOptions(enabled = true, showsPuck = true, followZoom = null)
                map.locationProvider = provider
                map.setOptions(map.options.copy(location = options))
                map.followMode = TileflowFollowMode.POSITION
                val consumer = requireNotNull(provider.consumer)
                val first = TileflowLocation(TileflowCoordinate(-3.70, 40.42), horizontalAccuracy = 4.0)
                consumer.locationUpdated(first)
                until("hidden location follows the supplied fix") {
                    map.latestLocation == first && abs(map.camera().longitude - first.coordinate.longitude) < 0.00001
                }
                val native = map.readyEngine as NativeMapEngine
                val renderer = requireNotNull(native.map)
                until("the initial puck is rendered before hiding") {
                    val point = map.project(first.coordinate)
                    !map.isMoving && renderer.queryRenderedFeatures(android.graphics.PointF(point.x, point.y), LocationComponentConstants.FOREGROUND_LAYER).isNotEmpty()
                }
                map.setOptions(map.options.copy(location = options.copy(showsPuck = false)))
                until("hidden puck has no rendered indicator") {
                    val point = map.project(first.coordinate)
                    renderer.queryRenderedFeatures(android.graphics.PointF(point.x, point.y), LocationComponentConstants.FOREGROUND_LAYER).isEmpty()
                }
                assertSame(consumer, provider.consumer)
                val next = first.copy(coordinate = TileflowCoordinate(-3.699, 40.421))
                consumer.locationUpdated(next)
                until("hidden location still receives updates") { map.latestLocation == next }
                map.setOptions(map.options.copy(location = options.copy(showsPuck = true)))
                until("the current puck is visible again") {
                    val point = map.project(next.coordinate)
                    renderer.queryRenderedFeatures(android.graphics.PointF(point.x, point.y), LocationComponentConstants.FOREGROUND_LAYER).isNotEmpty()
                }
                map.setOptions(map.options.copy(location = options.copy(enabled = false)))
                assertEquals(null, provider.consumer)
            } }
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    @Test
    public fun theProviderOwnsTheFixBearingAccuracyAndAgeAcrossStyles() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val activity =
            instrumentation.startActivitySync(
                Intent(instrumentation.targetContext, SceneHostActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    .putExtra("map", "appearance")
            ) as SceneHostActivity
        try {
            assertTrue(activity.loaded.await(30, TimeUnit.SECONDS))
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    val native = map.readyEngine as NativeMapEngine
                    val renderer = requireNotNull(native.map)
                    val component = renderer.locationComponent
                    val origin = TileflowCoordinate(-3.70, 40.42)
                    val provider = Provider()
                    val options =
                        TileflowLocationOptions(
                            enabled = true,
                            puckBearing = TileflowPuckBearing.COURSE,
                            followZoom = null,
                        )
                    val longWindow = options.copy(staleAfterMillis = 3_600_000)
                    suspend fun use(next: TileflowLocationOptions) {
                        map.setOptions(
                            TileflowMapOptions(
                                location = next,
                                events = TileflowEventOptions(TileflowEventLevel.CAMERA),
                            )
                        )
                    }
                    map.jump(TileflowCamera(origin.longitude, origin.latitude, 9.0, bearing = 20.0))
                    map.locationProvider = provider
                    use(options)
                    map.followMode = TileflowFollowMode.HEADING
                    assertEquals(9.0, map.camera().zoom, .01)
                    val consumer = requireNotNull(provider.consumer)
                    val source = TileflowLocation(origin, horizontalAccuracy = 60.0, course = 92.0)
                    consumer.headingUpdated(TileflowHeading(38.0))
                    consumer.locationUpdated(
                        source.copy(timestamp = System.currentTimeMillis() - 120_000)
                    )
                    until(
                        "the camera follows the supplied heading independently of the course puck"
                    ) {
                        component.cameraMode == CameraMode.TRACKING_COMPASS &&
                            abs(map.camera().bearing - 38) < .5 &&
                            component.renderMode == RenderMode.COMPASS &&
                            renderer.style
                                ?.getLayerAs<SymbolLayer>(LocationComponentConstants.BEARING_LAYER)
                                ?.iconRotate
                                ?.value == 92f
                    }
                    assertSame(native.location!!.relay, component.locationEngine)
                    assertSame(native.location!!.relay, component.compassEngine)
                    assertEquals(9.0, map.camera().zoom, .01)
                    suspend fun puck(colour: Int) {
                        until("rendered puck colour ${Integer.toHexString(colour)}") {
                            val point = map.project(origin)
                            val image =
                                suspendCancellableCoroutine<android.graphics.Bitmap> { continuation
                                    ->
                                    renderer.snapshot {
                                        if (continuation.isActive)
                                            continuation.resumeWith(Result.success(it))
                                    }
                                }
                            try {
                                val x = point.x.toInt()
                                val y = point.y.toInt()
                                (-7..7).any { dy ->
                                    (-7..7).any { dx ->
                                        val c = image.getPixel(x + dx, y + dy)
                                        abs(Color.red(c) - Color.red(colour)) < 12 &&
                                            abs(Color.green(c) - Color.green(colour)) < 12 &&
                                            abs(Color.blue(c) - Color.blue(colour)) < 12
                                    }
                                }
                            } finally {
                                image.recycle()
                            }
                        }
                    }
                    val grey = Color.rgb(142, 142, 147)
                    val blue = Color.rgb(26, 115, 232)
                    puck(grey)
                    use(longWindow)
                    puck(blue)
                    map.addSource(
                        TileflowGeoJSONSource(
                            "app",
                            TileflowGeoJSONData.Features(
                                listOf(TileflowFeature("1", TileflowGeometry.Point(origin)))
                            ),
                        )
                    )
                    map.addLayer(
                        TileflowCircleLayer("app", "app")
                            .circleRadius(45.0)
                            .circleColor(TileflowColor.fromHex("#ff00ff"))
                    )
                    val order = renderer.style!!.layers.map { it.id }
                    val appIndex = order.indexOf("__tileflow_layer_app")
                    assertTrue(
                        "The puck stays above new application content",
                        appIndex in
                            0 until order.indexOf(LocationComponentConstants.FOREGROUND_LAYER),
                    )
                    puck(blue)
                    use(longWindow.copy(showsAccuracy = false))
                    until("the accuracy ring is hidden") {
                        renderer.style!!
                            .getLayer(LocationComponentConstants.ACCURACY_LAYER)
                            ?.visibility
                            ?.value == "none"
                    }
                    consumer.locationUpdated(source.copy(timestamp = System.currentTimeMillis()))
                    puck(blue)
                    use(longWindow.copy(showsAccuracy = false, staleAfterMillis = 1_000))
                    puck(grey)
                    use(longWindow)
                    map.setContentPadding(120f, 60f, 20f, 12f)
                    until("follow padding positions the fix at the padded center") {
                        val point = map.project(origin)
                        abs(point.x - (map.width + 120 - 20) / 2f) < 2 &&
                            abs(point.y - (map.height + 60 - 12) / 2f) < 2
                    }
                    assertEquals(TileflowFollowMode.HEADING, map.followMode)
                    map.setTheme("dark")
                    puck(blue)
                    assertTrue(component.isLocationComponentEnabled)
                    map.jump(TileflowCamera(origin.longitude, origin.latitude, 17.0))
                    assertEquals(TileflowFollowMode.NONE, map.followMode)
                    assertTrue(
                        activity.events.filterIsInstance<TileflowMapEvent.FollowModeChanged>().any {
                            it.change.reason == TileflowFollowModeChangeReason.API
                        }
                    )
                    use(options.copy(followZoom = 5.0))
                    map.followMode = TileflowFollowMode.POSITION
                    until("a lower follow minimum retains the current zoom") {
                        component.cameraMode == CameraMode.TRACKING && !map.isMoving
                    }
                    assertEquals(17.0, map.camera().zoom, .01)
                    val loads = activity.loads.size
                    map.reload()
                    until("the replacement map follows with the app's content padding") {
                        if (activity.loads.size <= loads) false
                        else {
                            val replacement =
                                (map.readyEngine as NativeMapEngine).map!!.locationComponent
                            val point = map.project(origin)
                            replacement.cameraMode == CameraMode.TRACKING &&
                                abs(point.x - (map.width + 100) / 2f) < 2 &&
                                abs(point.y - (map.height + 48) / 2f) < 2
                        }
                    }
                    use(options.copy(enabled = false))
                    assertEquals(null, provider.consumer)
                    assertTrue(
                        !(map.readyEngine as NativeMapEngine)
                            .map!!
                            .locationComponent
                            .isLocationComponentEnabled
                    )
                    assertEquals(TileflowFollowMode.NONE, map.followMode)
                }
            }
        } finally {
            activity.finish()
        }
    }
}
