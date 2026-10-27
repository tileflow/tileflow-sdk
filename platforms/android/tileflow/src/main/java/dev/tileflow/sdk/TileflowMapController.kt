package dev.tileflow.sdk

import androidx.annotation.MainThread
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import java.lang.ref.WeakReference

/** Stable imperative access to one attached Compose map. */
@MainThread
public class TileflowMapController {
    private var view = WeakReference<TileflowMapView>(null)

    public suspend fun camera(): TileflowCamera = attached().camera()

    public suspend fun setCamera(camera: TileflowCamera, durationMillis: Long = 0): Unit =
        attached().setCamera(camera, durationMillis)

    public suspend fun setTheme(
        theme: String?,
        timeOfDay: TileflowTimeOfDay? = null,
        durationMillis: Long = 0,
    ): Unit = attached().setTheme(theme, timeOfDay, durationMillis)

    public suspend fun setBlend(
        themes: List<String>,
        position: Double,
        hold: Boolean = false,
        durationMillis: Long = 0,
    ): Unit = attached().setBlend(themes, position, hold, durationMillis)

    public suspend fun setOptions(options: TileflowMapOptions): Unit =
        attached().setOptions(options)

    public suspend fun setContent(
        annotations: List<TileflowAnnotation> = emptyList(),
        layers: List<TileflowGeoJSONLayer> = emptyList(),
    ): Unit = attached().setContent(annotations, layers)

    public suspend fun query(point: TileflowPoint): List<TileflowRenderedFeature> =
        attached().query(point.x, point.y)

    public suspend fun project(coordinate: TileflowCoordinate): TileflowPoint =
        attached().project(coordinate)

    public suspend fun unproject(point: TileflowPoint): TileflowCoordinate =
        attached().unproject(point)

    public suspend fun fit(
        bounds: TileflowBounds,
        padding: Float = 24f,
        maxZoom: Double = 20.0,
        durationMillis: Long = 0,
    ): Unit = attached().fit(bounds, padding, maxZoom, durationMillis)

    public fun reload(): Unit = attached().reload()

    internal fun attach(next: TileflowMapView) {
        if (view.get() != null && view.get() !== next)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        view = WeakReference(next)
    }

    internal fun detach(previous: TileflowMapView) {
        if (view.get() === previous) view.clear()
    }

    private fun attached(): TileflowMapView =
        view.get() ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
}

@Composable
public fun rememberTileflowMapController(): TileflowMapController = remember {
    TileflowMapController()
}
