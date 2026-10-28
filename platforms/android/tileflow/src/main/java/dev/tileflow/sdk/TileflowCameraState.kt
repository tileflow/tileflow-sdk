package dev.tileflow.sdk

import android.view.View
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import java.lang.ref.WeakReference

/**
 * The camera of a controlled Compose map, hoisted so the application can read and write it.
 *
 * The map writes [camera] whenever the application receives a camera event (each time the camera
 * settles, and more often at higher event levels). Writing a different camera jumps the map
 * there; the map's own writes never move it again. Remember it with [rememberTileflowCameraState]
 * to keep the camera across configuration changes and process recreation.
 */
@Stable
public class TileflowCameraState(initial: TileflowCamera? = null) {
    /**
     * The camera. Before the map loads, the camera it starts at, or null for the map's authored
     * view.
     */
    public var camera: TileflowCamera? by mutableStateOf(initial)

    /** Whether the camera is moving, for an animation or a gesture. */
    public var isMoving: Boolean by mutableStateOf(false)
        private set

    /** The last camera change the application received. */
    public var lastChange: TileflowCameraChange? by mutableStateOf(null)
        private set

    private var view = WeakReference<TileflowMapView>(null)

    /** The camera the map and this state last agreed on. */
    internal var synced: TileflowCamera? = initial

    internal fun attach(next: TileflowMapView) {
        view = WeakReference(next)
    }

    internal fun detach(previous: TileflowMapView) {
        if (view.get() === previous) view.clear()
    }

    /** A change the application receives: the map's camera, which must not move it again. */
    internal fun record(change: TileflowCameraChange) {
        synced = change.camera
        camera = change.camera
        lastChange = change
    }

    internal fun moving(value: Boolean) {
        isMoving = value
    }

    private fun attached(): TileflowMapView =
        view.get() ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)

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

    public suspend fun ease(
        update: TileflowCameraUpdate,
        durationMillis: Long = 500,
        easing: TileflowEasing = TileflowEasing.STANDARD,
    ): TileflowCameraAnimationResult = attached().ease(update, durationMillis, easing)

    public suspend fun fly(
        update: TileflowCameraUpdate,
        options: TileflowFlyOptions = TileflowFlyOptions(),
    ): TileflowCameraAnimationResult = attached().fly(update, options)

    /** Frames [bounds] with [padding] around them, inside the map's content padding. */
    public suspend fun fit(
        bounds: TileflowBounds,
        padding: PaddingValues = PaddingValues(0.dp),
        bearing: Double? = null,
        pitch: Double? = null,
        maxZoom: Double? = null,
        animation: TileflowCameraAnimation = TileflowCameraAnimation.None,
    ): TileflowCameraAnimationResult {
        val view = attached()
        return view.fit(bounds, padding.pixels(view), bearing, pitch, maxZoom, animation)
    }

    /** Stops the camera, whether the application or a person moved it. */
    public fun stopCamera() {
        view.get()?.stopCamera()
    }

    public companion object {
        /** Saves the camera, so it survives configuration changes and process recreation. */
        public val Saver: Saver<TileflowCameraState, List<Double>> =
            Saver(
                save = { state ->
                    state.camera?.let {
                        listOf(it.longitude, it.latitude, it.zoom, it.bearing, it.pitch)
                    } ?: emptyList()
                },
                restore = { values ->
                    TileflowCameraState(
                        if (values.size == 5)
                            TileflowCamera(values[0], values[1], values[2], values[3], values[4])
                        else null
                    )
                },
            )
    }
}

/**
 * A [TileflowCameraState] that keeps its camera across configuration changes and process
 * recreation. [initial] is the camera of a new state, or null for the map's authored view.
 */
@Composable
public fun rememberTileflowCameraState(initial: TileflowCamera? = null): TileflowCameraState =
    rememberSaveable(saver = TileflowCameraState.Saver) { TileflowCameraState(initial) }

/** Physical pixels for the view's density and layout direction. */
internal fun PaddingValues.pixels(view: View): TileflowEdgeInsets {
    val density = view.resources.displayMetrics.density
    val direction =
        if (view.layoutDirection == View.LAYOUT_DIRECTION_RTL) LayoutDirection.Rtl
        else LayoutDirection.Ltr
    return TileflowEdgeInsets(
        calculateLeftPadding(direction).value * density,
        calculateTopPadding().value * density,
        calculateRightPadding(direction).value * density,
        calculateBottomPadding().value * density,
    )
}
