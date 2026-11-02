package dev.tileflow.sdk.nativeengine

import android.graphics.Bitmap
import android.os.Bundle
import androidx.activity.ComponentActivity
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style

/** Shows one MapLibre Native map with the style JSON and camera in [Companion]. */
public class EngineHostActivity : ComponentActivity() {
    lateinit var mapView: MapView
    @Volatile var map: MapLibreMap? = null
    val styleLoaded = CountDownLatch(1)
    val idleCount = AtomicInteger()
    val fullyRendered = AtomicInteger()
    val failures = CopyOnWriteArrayList<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MapLibre.getInstance(this)
        val options =
            MapLibreMapOptions.createFromAttributes(this)
                .attributionEnabled(false)
                .logoEnabled(false)
                .textureMode(textureMode)
        camera?.let { options.camera(it) }
        mapView = MapView(this, options)
        mapView.onCreate(savedInstanceState)
        mapView.addOnDidFailLoadingMapListener { failures.add(it) }
        mapView.addOnDidBecomeIdleListener { idleCount.incrementAndGet() }
        mapView.addOnDidFinishRenderingMapListener { fully -> if (fully) fullyRendered.incrementAndGet() }
        setContentView(mapView)
        val json = requireNotNull(style)
        mapView.getMapAsync { loaded ->
            map = loaded
            loaded.setStyle(Style.Builder().fromJson(json)) { styleLoaded.countDown() }
        }
    }

    override fun onStart() {
        super.onStart()
        mapView.onStart()
    }

    override fun onResume() {
        super.onResume()
        mapView.onResume()
    }

    override fun onPause() {
        mapView.onPause()
        super.onPause()
    }

    override fun onStop() {
        mapView.onStop()
        super.onStop()
    }

    override fun onLowMemory() {
        super.onLowMemory()
        mapView.onLowMemory()
    }

    override fun onDestroy() {
        mapView.onDestroy()
        super.onDestroy()
    }

    /** Waits until the engine reports idle after [after] earlier idle events. */
    fun awaitIdle(after: Int, timeoutMillis: Long): Boolean {
        val deadline = System.currentTimeMillis() + timeoutMillis
        while (System.currentTimeMillis() < deadline) {
            if (idleCount.get() > after) return true
            Thread.sleep(50)
        }
        return false
    }

    /** The engine's own snapshot of what it drew. */
    fun snapshot(): Bitmap? {
        val done = CountDownLatch(1)
        var result: Bitmap? = null
        runOnUiThread {
            val current = map
            if (current == null) done.countDown()
            else
                current.snapshot {
                    result = it
                    done.countDown()
                }
        }
        done.await(15, TimeUnit.SECONDS)
        return result
    }

    internal companion object {
        @Volatile var style: String? = null
        @Volatile var camera: CameraPosition? = null
        @Volatile var textureMode: Boolean = false
    }
}
