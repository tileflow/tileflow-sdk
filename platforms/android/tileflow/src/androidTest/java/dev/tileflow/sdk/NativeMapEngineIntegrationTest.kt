package dev.tileflow.sdk

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.engine.MapEngineKind
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.maps.MapView

/** Hosts a map drawn by MapLibre Native, starting at a known camera. */
public class NativeMapHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loaded = CountDownLatch(1)
    val failures = CopyOnWriteArrayList<TileflowErrorCode>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        map =
            TileflowMapView(this).apply {
                engineKind = MapEngineKind.NATIVE
                onEvent = {
                    when (it) {
                        TileflowMapEvent.ContentReady -> loaded.countDown()
                        is TileflowMapEvent.Failed -> failures.add(it.code)
                        else -> Unit
                    }
                }
                setSource(
                    TileflowMapSource(
                        map = "fixture",
                        manifestUrl = URI("http://127.0.0.1:18645/manifest.json"),
                        allowsLoopbackHttp = true,
                    ),
                    initialCamera = TileflowCamera(-3.70, 40.42, 12.0),
                )
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }
}

/** The map mounts MapLibre Native through the same view and lifecycle as its default engine. */
@RunWith(AndroidJUnit4::class)
public class NativeMapEngineIntegrationTest {
    @Test
    public fun theNativeEngineMountsAndReportsItsCamera() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent =
            Intent(instrumentation.context, NativeMapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as NativeMapHostActivity
        try {
            assertTrue(
                "Map did not load. Errors: ${activity.failures}",
                activity.loaded.await(30, TimeUnit.SECONDS),
            )
            assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    val engines =
                        (0 until map.childCount).map(map::getChildAt).filterIsInstance<MapView>()
                    assertEquals("One MapLibre view draws the map", 1, engines.size)
                    val camera = map.camera()
                    assertEquals(-3.70, camera.longitude, 0.0001)
                    assertEquals(40.42, camera.latitude, 0.0001)
                    assertEquals(12.0, camera.zoom, 0.0001)
                    assertEquals(camera, map.currentCamera)
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
        instrumentation.waitForIdleSync()
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
    }
}
