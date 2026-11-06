package dev.tileflow.measure

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.RectF
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowMapEvent
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.TileflowMapView
import java.net.URI
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView

internal fun installMap(activity: Activity, root: FrameLayout, run: String): () -> Unit {
    val scope = CoroutineScope(Dispatchers.Main)
    val map = TileflowMapView(activity)
    val intent = activity.intent
    val manifest = intent.getStringExtra("manifest") ?: "http://127.0.0.1:18645/native/manifest.json"
    val camera = TileflowCamera(
        intent.getStringExtra("longitude")?.toDouble() ?: -3.7,
        intent.getStringExtra("latitude")?.toDouble() ?: 40.42,
        intent.getStringExtra("zoom")?.toDouble() ?: 16.0,
    )
    root.addView(map, FrameLayout.LayoutParams(-1, -1))

    var recorded = false
    map.onEvent = { event ->
        when (event) {
            TileflowMapEvent.ContentReady -> if (!recorded) {
                recorded = true
                Log.i(TAG, "CONTENT_READY $run")
                scope.launch {
                    runCatching {
                        val nativeView = withTimeout(15_000) { usefulFrame(map, run) }
                        activity.reportFullyDrawn()
                        if (activity.intent.getBooleanExtra("motion", false)) {
                            delay(5_000)
                            motion(nativeView, map, run, camera)
                        }
                    }.onFailure { Log.e(TAG, "ERROR $run", it) }
                }
            }
            is TileflowMapEvent.Warning -> Log.w(TAG, "WARNING $run ${event.code} ${event.context}")
            is TileflowMapEvent.Failed -> Log.e(TAG, "MAP_FAILED $run ${event.code} ${event.context}")
            else -> Unit
        }
    }

    val source = TileflowMapSource(
        map = intent.getStringExtra("map") ?: "streets",
        manifestUrl = URI(manifest),
        allowsLoopbackHttp = URI(manifest).host == "127.0.0.1",
    )
    map.setSource(source, camera)
    return { scope.cancel(); map.destroy() }
}

private suspend fun usefulFrame(map: TileflowMapView, run: String): MapView {
    while (true) {
        val nativeView = descendant<MapView>(map)
        val surface = nativeView?.let { descendant<SurfaceView>(it) }
        if (nativeView != null && surface != null && surface.holder.surface.isValid) {
            val renderer = suspendCancellableCoroutine<MapLibreMap> { pending ->
                nativeView.getMapAsync { if (pending.isActive) pending.resume(it) }
            }
            val viewport = RectF(0f, 0f, nativeView.width.toFloat(), nativeView.height.toFloat())
            val building = renderer.queryRenderedFeatures(
                viewport, "tileflow-buildings-fill", "tileflow-buildings-native-extrusion",
            ).firstOrNull()
            if (building != null) {
                val colors = countSurfaceColors(surface)
                if (colors >= 3) {
                    Log.i(TAG, "USEFUL $run building=${building.id()} colors=$colors")
                    return nativeView
                }
            }
        }
        delay(16)
    }
}

private suspend fun countSurfaceColors(surface: SurfaceView): Int =
    suspendCancellableCoroutine { result ->
        val bitmap = Bitmap.createBitmap(135, 270, Bitmap.Config.ARGB_8888)
        PixelCopy.request(
            surface, bitmap,
            { status ->
                val colors = mutableSetOf<Int>()
                if (status == PixelCopy.SUCCESS && result.isActive) {
                    for (y in 20 until bitmap.height - 20 step 3) {
                        for (x in 10 until bitmap.width - 10 step 3) colors += bitmap.getPixel(x, y)
                    }
                }
                bitmap.recycle()
                if (result.isActive) result.resume(colors.size)
            },
            Handler(Looper.getMainLooper()),
        )
    }

private inline fun <reified T : View> descendant(view: View): T? =
    findDescendant(view, T::class.java)

private fun <T : View> findDescendant(view: View, type: Class<T>): T? {
    if (type.isInstance(view)) return type.cast(view)
    if (view is ViewGroup) {
        for (index in 0 until view.childCount) {
            findDescendant(view.getChildAt(index), type)?.let { return it }
        }
    }
    return null
}

private suspend fun motion(nativeView: MapView, map: TileflowMapView, run: String, camera: TileflowCamera) {
    val offset = camera.copy(longitude = camera.longitude + .0006, latitude = camera.latitude + .0004)
    val zoomed = offset.copy(zoom = camera.zoom + .6)
    val positions = listOf(
        "pan" to offset,
        "zoom" to zoomed,
        "pan" to camera.copy(zoom = zoomed.zoom),
        "zoom" to camera,
    )
    repeat(3) { round ->
        for ((segment, camera) in positions) {
            val timestamps = mutableListOf<Long>()
            val listener = MapView.OnWillStartRenderingFrameListener {
                timestamps += SystemClock.elapsedRealtimeNanos()
            }
            nativeView.addOnWillStartRenderingFrameListener(listener)
            val start = SystemClock.elapsedRealtimeNanos()
            try {
                withTimeout(8_000) { map.setCamera(camera, durationMillis = 1500) }
            } finally {
                nativeView.removeOnWillStartRenderingFrameListener(listener)
            }
            val end = SystemClock.elapsedRealtimeNanos()
            Log.i(TAG, "MOTION $run $segment $round $start $end ${timestamps.joinToString(",")}")
            delay(150)
        }
    }
    Log.i(TAG, "MOTION_DONE $run")
}
