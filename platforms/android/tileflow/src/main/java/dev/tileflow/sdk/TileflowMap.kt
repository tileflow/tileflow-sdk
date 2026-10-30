package dev.tileflow.sdk

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import dev.tileflow.sdk.location.TileflowLocationProvider
import dev.tileflow.sdk.location.TileflowLocationState

/**
 * Recomposition preserves the renderer; source replacement is an explicit resource transition.
 *
 * With a [cameraState] the map is controlled: see [TileflowCameraState]. [contentPadding] is space
 * the application covers at each edge, such as a sheet over the map; the camera centres on the
 * rest of the view and the controls stay inside it, together with the system bars and display
 * cutout. Return false from [touchFilter] to leave a touch that begins at that point to the
 * composables behind the map.
 *
 * With a [locationState] the follow mode is hoisted: see [TileflowLocationState]. Show the location
 * with [TileflowMapOptions.location]; [locationProvider] replaces the SDK's default provider, for
 * example with a [dev.tileflow.sdk.location.TileflowSimulatedLocationProvider].
 */
@Composable
public fun TileflowMap(
    source: TileflowMapSource,
    modifier: Modifier = Modifier,
    theme: String? = null,
    initialCamera: TileflowCamera? = null,
    options: TileflowMapOptions = TileflowMapOptions(),
    controller: TileflowMapController? = null,
    cameraState: TileflowCameraState? = null,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    touchFilter: ((DpOffset) -> Boolean)? = null,
    locationState: TileflowLocationState? = null,
    locationProvider: TileflowLocationProvider? = null,
    onEvent: (TileflowMapEvent) -> Unit = {},
) {
    val context = LocalContext.current
    val latestEvent = rememberUpdatedState(onEvent)
    val latestFilter = rememberUpdatedState(touchFilter)
    val latestState = rememberUpdatedState(cameraState)
    val latestLocation = rememberUpdatedState(locationState)
    val events: (TileflowMapEvent) -> Unit = { event ->
        if (event is TileflowMapEvent.CameraChanged) latestState.value?.record(event.change)
        if (event is TileflowMapEvent.FollowModeChanged)
            latestLocation.value?.record(event.change)
        latestEvent.value(event)
    }
    val view =
        remember(context) {
            TileflowMapView(context).apply {
                this.onEvent = events
                setSource(source, cameraState?.camera ?: initialCamera)
            }
        }
    // A property the view applies again to its next renderer is not lost when the call that
    // carried it is cancelled by a renderer replacement.
    LaunchedEffect(view, theme) {
        try {
            view.setTheme(theme)
        } catch (error: TileflowMapException) {
            if (error.code != TileflowErrorCode.CANCELLED)
                latestEvent.value(TileflowMapEvent.Failed(error.code, error.context))
        }
    }
    LaunchedEffect(view, options) {
        try {
            view.setOptions(options)
        } catch (error: TileflowMapException) {
            if (error.code != TileflowErrorCode.CANCELLED)
                latestEvent.value(TileflowMapEvent.Failed(error.code, error.context))
        }
    }
    // The application's writes move the map; the map's own writes are already where it is.
    LaunchedEffect(view, cameraState) {
        val state = cameraState ?: return@LaunchedEffect
        snapshotFlow { state.camera }
            .collect { target ->
                if (target == null || target == state.synced) return@collect
                state.synced = target
                try {
                    view.move(target)
                } catch (error: TileflowMapException) {
                    if (error.code != TileflowErrorCode.CANCELLED)
                        latestEvent.value(TileflowMapEvent.Failed(error.code, error.context))
                }
            }
    }
    // The application's writes change how the map follows; the map's own writes are in force.
    LaunchedEffect(view, locationState) {
        val state = locationState ?: return@LaunchedEffect
        snapshotFlow { state.followMode }
            .collect { mode ->
                if (mode == state.synced && mode == view.followMode) return@collect
                state.synced = mode
                view.followMode = mode
            }
    }
    DisposableEffect(view, locationState) {
        view.location.observer = locationState?.let { state -> state::received }
        view.latestLocation?.let { locationState?.received(it) }
        onDispose { view.location.observer = null }
    }
    DisposableEffect(view) { onDispose { view.destroy() } }
    DisposableEffect(view, controller) {
        try {
            controller?.attach(view)
        } catch (error: TileflowMapException) {
            latestEvent.value(TileflowMapEvent.Failed(error.code))
        }
        onDispose { controller?.detach(view) }
    }
    DisposableEffect(view, cameraState) {
        cameraState?.attach(view)
        view.onCameraObserved = { change ->
            if (change.phase != TileflowCameraChangePhase.MOVING)
                cameraState?.moving(!change.isFinal)
        }
        onDispose {
            cameraState?.detach(view)
            view.onCameraObserved = null
        }
    }
    val density = LocalDensity.current.density
    val direction = LocalLayoutDirection.current
    val padding =
        TileflowEdgeInsets(
            contentPadding.calculateLeftPadding(direction).value * density,
            contentPadding.calculateTopPadding().value * density,
            contentPadding.calculateRightPadding(direction).value * density,
            contentPadding.calculateBottomPadding().value * density,
        )
    val filtering = touchFilter != null
    AndroidView(
        factory = { view },
        modifier = modifier,
        update = {
            it.onEvent = events
            it.setSource(source, cameraState?.camera ?: initialCamera)
            it.setContentPadding(padding.left, padding.top, padding.right, padding.bottom)
            if (it.locationProvider !== locationProvider) it.locationProvider = locationProvider
            it.touchFilter =
                if (!filtering) null
                else { x, y ->
                    val point = DpOffset((x / density).dp, (y / density).dp)
                    latestFilter.value?.invoke(point) != false
                }
        },
    )
}

/**
 * Shows a Hosted map. Its credential and API origin come from `Tileflow.configuration(context)`;
 * use [TileflowMapSource.hosted] to pass a configuration for this map only.
 */
@Composable
public fun TileflowMap(
    mapId: String,
    modifier: Modifier = Modifier,
    theme: String? = null,
    initialCamera: TileflowCamera? = null,
    options: TileflowMapOptions = TileflowMapOptions(),
    controller: TileflowMapController? = null,
    cameraState: TileflowCameraState? = null,
    contentPadding: PaddingValues = PaddingValues(0.dp),
    touchFilter: ((DpOffset) -> Boolean)? = null,
    locationState: TileflowLocationState? = null,
    locationProvider: TileflowLocationProvider? = null,
    onEvent: (TileflowMapEvent) -> Unit = {},
) {
    TileflowMap(
        TileflowMapSource.hosted(mapId),
        modifier,
        theme,
        initialCamera,
        options,
        controller,
        cameraState,
        contentPadding,
        touchFilter,
        locationState,
        locationProvider,
        onEvent,
    )
}
