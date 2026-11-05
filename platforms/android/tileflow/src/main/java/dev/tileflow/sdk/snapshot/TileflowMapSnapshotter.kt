package dev.tileflow.sdk

import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import dev.tileflow.configuration.Tileflow
import dev.tileflow.sdk.attribution.MapAttribution
import dev.tileflow.sdk.attribution.MapCredit
import dev.tileflow.sdk.attribution.MapFairUseState
import dev.tileflow.sdk.attribution.MapObligation
import dev.tileflow.sdk.engine.NativeFamily
import dev.tileflow.sdk.engine.NativeMapPreparation
import dev.tileflow.sdk.engine.NativeStyleProjection
import dev.tileflow.sdk.offline.OfflineReachability
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineServingRule
import dev.tileflow.sdk.transport.MapLibreRuntime
import dev.tileflow.sdk.transport.MapResourceContexts
import dev.tileflow.sdk.transport.MapResourceRoute
import dev.tileflow.sdk.transport.TileflowHttpClient
import dev.tileflow.sdk.transport.grantScope
import dev.tileflow.sdk.transport.makeLoader
import dev.tileflow.sdk.transport.makeSession
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.ceil
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.Style
import org.maplibre.android.snapshotter.MapSnapshot
import org.maplibre.android.snapshotter.MapSnapshotter

/**
 * Width and height are logical units. Scale is at least one. Each physical edge (size × scale) must
 * measure 1 through 4096 pixels, before the renderer allocates the image.
 */
public data class TileflowMapSnapshotOptions(
    public val width: Float,
    public val height: Float,
    public val scale: Float = 1f,
    public val camera: TileflowCamera? = null,
    public val theme: String? = null,
    public val content: TileflowMapSnapshotContent = TileflowMapSnapshotContent(),
) {
    internal fun validate() {
        if (
            scale < 1 ||
                !scale.isFinite() ||
                width * scale !in 1f..4096f ||
                height * scale !in 1f..4096f ||
                ceil(width) * scale > 4096 ||
                ceil(height) * scale > 4096
        )
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        camera?.let {
            if (!it.isValid()) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        content.images.forEach { it.validate() }
    }
}

/** Renders independently of a mounted map. A Hosted source uses its region when offline. */
public class TileflowMapSnapshotter(context: Context) {
    private val application = context.applicationContext

    public suspend fun snapshot(
        source: TileflowMapSource,
        options: TileflowMapSnapshotOptions,
    ): Bitmap =
        withContext(Dispatchers.Main.immediate) {
            options.validate()
            ensureActive()
            val map = source.loadable { Tileflow.configuration(application) }
            val session = map.makeSession()
            val loader = map.makeLoader(application, session)
            val projection = AtomicReference<NativeStyleProjection?>()
            val fairUse = MapFairUseState()
            val owner =
                MapResourceContexts.register(
                    MapResourceRoute(
                        loader,
                        { url -> projection.get()?.classify(url) ?: TileflowResourceKind.TILE },
                    ) { outcome ->
                        outcome.fairUse?.let { synchronized(fairUse) { fairUse.receive(it) } }
                    }
                )
            // A blocking HTTP request in the worker context must stop immediately on cancellation.
            val lifetime =
                launch(start = CoroutineStart.UNDISPATCHED) {
                    try {
                        awaitCancellation()
                    } finally {
                        MapResourceContexts.retire(owner)
                        session?.close()
                        loader.close()
                    }
                }
            var acquired = false
            try {
                suspendCancellableCoroutine<Unit> { waiting ->
                    MapResourceContexts.install(application) { error ->
                        if (waiting.isActive) {
                            if (error == null) waiting.resume(Unit)
                            else
                                waiting.resumeWithException(
                                    error as? TileflowMapException ?: TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
                                )
                        }
                    }
                }
                MapResourceContexts.acquire()
                acquired = true
                val index = OfflineServingIndex.shared(application)
                val fromPacks =
                    map.grantScope != null &&
                        OfflineServingRule.hostedUsesPacks(
                            TileflowHttpClient.networkEnabled,
                            OfflineReachability.isReachable(application),
                        )
                val zooms: ((String) -> IntRange?)? =
                    map.grantScope
                        ?.takeIf { fromPacks }
                        ?.let { scope -> { template -> index.storedZooms(scope, template) } }
                val scheme =
                    if (
                        application.resources.configuration.uiMode and
                            Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
                    )
                        "dark"
                    else "light"
                val prepared =
                    withContext(Dispatchers.IO) {
                        val wire =
                            JSONObject()
                                .put("manifestUrl", map.manifestUrl.toString())
                                .put("map", map.map)
                        map.mapId?.let { wire.put("discoveryMapId", it) }
                        NativeMapPreparation(
                                owner,
                                { url -> NativeMapPreparation.read(loader, url) },
                                zooms,
                            )
                            .map(wire, options.theme, scheme, fromPacks)
                    }
                projection.set(prepared.projected)
                val family =
                    if (options.content.overlays.any { it.ink != null })
                        NativeFamily.load(prepared.manifest, prepared.document.styleUrl, loader)
                    else null
                val content = options.content.apply(prepared, scheme, family)
                val style = Style.Builder().fromJson(content.first)
                for ((id, bitmap) in content.second) style.withImage(id, bitmap)
                val camera =
                    options.camera ?: prepared.document.view ?: TileflowCamera(0.0, 0.0, 0.0)
                val native =
                    MapSnapshotter.Options(
                            ceil(options.width).toInt(),
                            ceil(options.height).toInt(),
                        )
                        .withPixelRatio(options.scale)
                        .withLogo(false)
                        .withAttribution(false)
                        .withStyleBuilder(style)
                        .withCameraPosition(
                            CameraPosition.Builder()
                                .target(LatLng(camera.latitude, camera.longitude))
                                .bearing(camera.bearing)
                                .tilt(camera.pitch)
                                .zoom(camera.zoom)
                                .build()
                        )
                val snapshotter = try {
                    MapSnapshotter(application, native)
                } catch (_: LinkageError) {
                    throw MapLibreRuntime.unsupported("MapLibre could not create its native snapshotter.")
                }
                val result =
                    suspendCancellableCoroutine<MapSnapshot> { waiting ->
                        snapshotter.start(
                            { shot -> if (waiting.isActive) waiting.resume(shot) },
                            {
                                if (waiting.isActive)
                                    waiting.resumeWithException(
                                        TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
                                    )
                            },
                        )
                        waiting.invokeOnCancellation {
                            android.os.Handler(android.os.Looper.getMainLooper()).post {
                                snapshotter.cancel()
                            }
                        }
                    }
                val model =
                    withContext(Dispatchers.IO) {
                        val scope = map.grantScope
                        MapAttribution(
                            sources = prepared.projected.attributions,
                            notices = MapAttribution.notices(prepared.style),
                            obligations =
                                scope?.let { index.obligations(it).map(::MapObligation) }.orEmpty(),
                            credits = scope?.let { index.credits(it).map(::MapCredit) }.orEmpty(),
                            fairUse = synchronized(fairUse) { fairUse.notice },
                        )
                    }
                ensureActive()
                draw(result, model, options)
            } catch (error: Exception) {
                // Closing a blocking HTTP stream can surface as a resource read failure.
                ensureActive()
                if (
                    error is TileflowMapException ||
                        error is kotlinx.coroutines.CancellationException
                )
                    throw error
                throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
            } finally {
                lifetime.cancel()
                if (acquired) MapResourceContexts.release()
            }
        }

    private fun draw(
        snap: MapSnapshot,
        model: MapAttribution,
        options: TileflowMapSnapshotOptions,
    ): Bitmap {
        val bitmap = snap.bitmap
        val width = bitmap.width.toFloat()
        val height = bitmap.height.toFloat()
        val bounds =
            SnapshotBounds.measure(width.toDouble(), height.toDouble()) { x, y ->
                val point = snap.latLngForPixel(android.graphics.PointF(x.toFloat(), y.toFloat()))
                TileflowCoordinate(point.longitude, point.latitude)
            }
        val text = model.entries(bounds).joinToString(" · ") { it.text }
        if (text.isEmpty() && options.content.images.isEmpty()) return bitmap
        val output = bitmap.copy(Bitmap.Config.ARGB_8888, true)
        val canvas = Canvas(output)
        for (image in options.content.images) image.draw(canvas, snap, options.scale)
        if (text.isEmpty()) return output
        val pad = 4 * options.scale
        val available = (width - 2 * pad).toInt()
        if (available <= 0) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val paint =
            TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.BLACK
                textSize = 10 * options.scale
            }
        val layout =
            StaticLayout.Builder.obtain(text, 0, text.length, paint, available)
                .setAlignment(Layout.Alignment.ALIGN_NORMAL)
                .setIncludePad(false)
                .build()
        if (layout.height + pad > height)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val y = height - layout.height - pad
        canvas.drawRect(
            0f,
            y,
            width,
            height,
            Paint().apply { color = Color.argb(235, 255, 255, 255) },
        )
        canvas.translate(pad, y + pad / 2)
        layout.draw(canvas)
        return output
    }
}
