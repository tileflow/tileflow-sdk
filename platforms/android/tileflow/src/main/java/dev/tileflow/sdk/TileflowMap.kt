package dev.tileflow.sdk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView

/** Recomposition preserves the renderer; source replacement is an explicit resource transition. */
@Composable
public fun TileflowMap(
    source: TileflowMapSource,
    modifier: Modifier = Modifier,
    theme: String? = null,
    initialCamera: TileflowCamera? = null,
    options: TileflowMapOptions = TileflowMapOptions(),
    controller: TileflowMapController? = null,
    onEvent: (TileflowMapEvent) -> Unit = {},
) {
    val context = LocalContext.current
    val latestEvent = rememberUpdatedState(onEvent)
    val view =
        remember(context) {
            TileflowMapView(context).apply {
                this.onEvent = { latestEvent.value(it) }
                setSource(source, initialCamera)
            }
        }
    LaunchedEffect(view, theme) {
        try {
            view.setTheme(theme)
        } catch (error: TileflowMapException) {
            latestEvent.value(TileflowMapEvent.Failed(error.code))
        }
    }
    LaunchedEffect(view, options) {
        try {
            view.setOptions(options)
        } catch (error: TileflowMapException) {
            latestEvent.value(TileflowMapEvent.Failed(error.code))
        }
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
    AndroidView(
        factory = { view },
        modifier = modifier,
        update = {
            it.onEvent = { event -> latestEvent.value(event) }
            it.setSource(source, initialCamera)
        },
    )
}
