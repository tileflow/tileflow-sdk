package dev.tileflow.sdk

import androidx.annotation.MainThread
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import java.lang.ref.WeakReference

/**
 * Stable imperative access to one attached Compose map. Points and padding are in [Dp], which equal
 * the renderer's CSS pixels; each call forwards to [TileflowMapView], which uses physical pixels.
 */
@MainThread
public class TileflowMapController {
    private var view = WeakReference<TileflowMapView>(null)

    /**
     * The map's annotation managers; see [TileflowMapView.annotations]. The controller keeps them,
     * so they can be created before the map appears and reach whichever map it attaches to.
     */
    public val annotations: TileflowAnnotations = TileflowAnnotations()

    /**
     * Native views anchored to coordinates; see [TileflowMapView.viewAnnotationManager]. Offsets,
     * sizes and positions are in dp.
     */
    public val viewAnnotationManager: TileflowViewAnnotationManager =
        TileflowViewAnnotationManager(unitsInDp = true)

    /** The camera the map last reported, or null while no map is attached or before it is known. */
    public val currentCamera: TileflowCamera?
        get() = view.get()?.currentCamera

    /** Whether the attached map's camera is moving. */
    public val isMoving: Boolean
        get() = view.get()?.isMoving ?: false

    /**
     * How the attached map's camera follows the location; see [TileflowMapView.followMode]. Setting
     * it without an attached map does nothing.
     */
    public var followMode: dev.tileflow.sdk.location.TileflowFollowMode
        get() = view.get()?.followMode ?: dev.tileflow.sdk.location.TileflowFollowMode.NONE
        set(value) {
            view.get()?.followMode = value
        }

    /** The latest position the attached map received. */
    public val latestLocation: dev.tileflow.sdk.location.TileflowLocation?
        get() = view.get()?.latestLocation

    public suspend fun camera(): TileflowCamera = attached().camera()

    public suspend fun setCamera(camera: TileflowCamera, durationMillis: Long = 0): Unit =
        attached().setCamera(camera, durationMillis)

    public suspend fun move(
        update: TileflowCameraUpdate,
        animation: TileflowCameraAnimation = TileflowCameraAnimation.None,
    ): TileflowCameraAnimationResult = attached().move(update, animation)

    public suspend fun move(
        camera: TileflowCamera,
        animation: TileflowCameraAnimation = TileflowCameraAnimation.None,
    ): TileflowCameraAnimationResult = attached().move(camera, animation)

    public suspend fun jump(update: TileflowCameraUpdate): TileflowCameraAnimationResult =
        attached().jump(update)

    public suspend fun jump(camera: TileflowCamera): TileflowCameraAnimationResult =
        attached().jump(camera)

    public suspend fun ease(
        update: TileflowCameraUpdate,
        durationMillis: Long = 500,
        easing: TileflowEasing = TileflowEasing.STANDARD,
    ): TileflowCameraAnimationResult = attached().ease(update, durationMillis, easing)

    public suspend fun ease(
        camera: TileflowCamera,
        durationMillis: Long = 500,
        easing: TileflowEasing = TileflowEasing.STANDARD,
    ): TileflowCameraAnimationResult = attached().ease(camera, durationMillis, easing)

    public suspend fun fly(
        update: TileflowCameraUpdate,
        options: TileflowFlyOptions = TileflowFlyOptions(),
    ): TileflowCameraAnimationResult = attached().fly(update, options)

    public suspend fun fly(
        camera: TileflowCamera,
        options: TileflowFlyOptions = TileflowFlyOptions(),
    ): TileflowCameraAnimationResult = attached().fly(camera, options)

    /** Frames [bounds] with [padding] around them, inside the map's content padding. */
    public suspend fun fit(
        bounds: TileflowBounds,
        padding: PaddingValues,
        bearing: Double? = null,
        pitch: Double? = null,
        maxZoom: Double? = null,
        animation: TileflowCameraAnimation = TileflowCameraAnimation.None,
    ): TileflowCameraAnimationResult {
        val view = attached()
        return view.fit(bounds, padding.pixels(view), bearing, pitch, maxZoom, animation)
    }

    /** Frames [bounds] with [padding] on every side; a [durationMillis] above 0 eases there. */
    public suspend fun fit(
        bounds: TileflowBounds,
        padding: Dp = 24.dp,
        maxZoom: Double = 20.0,
        durationMillis: Long = 0,
    ) {
        val view = attached()
        view.fit(bounds, padding.value * view.density(), maxZoom, durationMillis)
    }

    public fun stopCamera() {
        view.get()?.stopCamera()
    }

    public suspend fun camera(
        bounds: TileflowBounds,
        padding: PaddingValues = PaddingValues(0.dp),
        bearing: Double? = null,
        pitch: Double? = null,
        maxZoom: Double? = null,
    ): TileflowCamera? {
        val view = attached()
        return view.camera(bounds, padding.pixels(view), bearing, pitch, maxZoom)
    }

    public suspend fun cameraFitting(
        coordinates: List<TileflowCoordinate>,
        padding: PaddingValues = PaddingValues(0.dp),
        bearing: Double? = null,
        pitch: Double? = null,
        maxZoom: Double? = null,
    ): TileflowCamera? {
        val view = attached()
        return view.cameraFitting(coordinates, padding.pixels(view), bearing, pitch, maxZoom)
    }

    public suspend fun visibleBounds(): TileflowBounds = attached().visibleBounds()

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

    /** Rendered feature identities at a point relative to the map. */
    public suspend fun query(point: DpOffset): List<TileflowRenderedFeature> {
        val view = attached()
        return view.query(point.x.value * view.density(), point.y.value * view.density())
    }

    /** The point of a coordinate relative to the map; it may lie outside the map. */
    public suspend fun project(coordinate: TileflowCoordinate): DpOffset {
        val view = attached()
        val point = view.project(coordinate)
        return DpOffset((point.x / view.density()).dp, (point.y / view.density()).dp)
    }

    public suspend fun unproject(point: DpOffset): TileflowCoordinate {
        val view = attached()
        return view.unproject(
            TileflowPoint(point.x.value * view.density(), point.y.value * view.density())
        )
    }

    public fun reload(): Unit = attached().reload()

    internal fun attach(next: TileflowMapView) {
        if (view.get() != null && view.get() !== next)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        view = WeakReference(next)
        next.adopt(annotations, viewAnnotationManager)
    }

    internal fun detach(previous: TileflowMapView) {
        if (view.get() !== previous) return
        view.clear()
        previous.release(annotations, viewAnnotationManager)
    }

    internal fun attached(): TileflowMapView =
        view.get() ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
}

private fun TileflowMapView.density(): Float = resources.displayMetrics.density

@Composable
public fun rememberTileflowMapController(): TileflowMapController = remember {
    TileflowMapController()
}
