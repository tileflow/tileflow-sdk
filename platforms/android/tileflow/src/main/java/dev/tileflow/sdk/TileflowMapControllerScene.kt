package dev.tileflow.sdk

/** See [TileflowMapView.setViewMode]. */
public suspend fun TileflowMapController.setViewMode(
    mode: TileflowViewMode,
    durationMillis: Long = 0,
): Unit = attached().setViewMode(mode, durationMillis)

/** See [TileflowMapView.setSun]. */
public suspend fun TileflowMapController.setSun(sun: TileflowSun?, durationMillis: Long = 0): Unit =
    attached().setSun(sun, durationMillis)

/** See [TileflowMapView.setEmphasis]. */
public suspend fun TileflowMapController.setEmphasis(
    emphasis: TileflowEmphasis?,
    durationMillis: Long = 0,
): Unit = attached().setEmphasis(emphasis, durationMillis)

/** See [TileflowMapView.setStyleState]. */
public suspend fun TileflowMapController.setStyleState(
    name: String,
    value: TileflowStyleValue,
    durationMillis: Long = 0,
): Unit = attached().setStyleState(name, value, durationMillis)

/** See [TileflowMapView.routeInks]. */
public suspend fun TileflowMapController.routeInks(): TileflowRouteInks = attached().routeInks()

/** See [TileflowMapView.setBoundaryValues]. */
public suspend fun TileflowMapController.setBoundaryValues(values: TileflowBoundaryValues?): Unit =
    attached().setBoundaryValues(values)

/** See [TileflowMapView.setImages]. */
public suspend fun TileflowMapController.setImages(images: List<TileflowMapImage>): Unit =
    attached().setImages(images)

/** See [TileflowMapView.setDepthMarkers]. */
public suspend fun TileflowMapController.setDepthMarkers(markers: List<TileflowDepthMarker>): Unit =
    attached().setDepthMarkers(markers)

/** See [TileflowMapView.animateLineProgress]. */
public suspend fun TileflowMapController.animateLineProgress(
    layers: List<String>,
    to: TileflowLineProgress,
    durationMillis: Long,
): Boolean = attached().animateLineProgress(layers, to, durationMillis)

/** See [TileflowMapView.play]. */
public suspend fun TileflowMapController.play(
    shot: TileflowShot,
    onCue: ((String) -> Unit)? = null,
): Boolean = attached().play(shot, onCue)
