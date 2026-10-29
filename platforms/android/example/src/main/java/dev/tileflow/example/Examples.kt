package dev.tileflow.example

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updateLayoutParams
import androidx.lifecycle.lifecycleScope
import dev.tileflow.configuration.Tileflow
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.TileflowCamera
import dev.tileflow.sdk.TileflowCameraUpdate
import dev.tileflow.sdk.TileflowEventLevel
import dev.tileflow.sdk.TileflowEventOptions
import dev.tileflow.sdk.TileflowMap
import dev.tileflow.sdk.TileflowMapControls
import dev.tileflow.sdk.TileflowMapEvent
import dev.tileflow.sdk.TileflowMapOptions
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.TileflowMapView
import dev.tileflow.sdk.rememberTileflowCameraState
import java.net.URI
import kotlinx.coroutines.launch

/**
 * Applications usually add the `tileflow_map_credential` and `tileflow_services_credential` string
 * resources. The examples also accept `mapCredential`, `servicesCredential` and `apiOrigin` launch
 * extras, which replace the resource configuration. Call it before showing a map or calling a
 * service.
 */
internal fun Intent.configureTileflow() {
    val mapCredential = getStringExtra("mapCredential")
    val servicesCredential = getStringExtra("servicesCredential")
    if (mapCredential == null && servicesCredential == null) return
    try {
        Tileflow.configure(
            TileflowConfiguration(
                apiOrigin =
                    getStringExtra("apiOrigin")?.let(::URI)
                        ?: TileflowConfiguration.DEFAULT_API_ORIGIN,
                servicesCredential = servicesCredential?.let(::TileflowCredential),
                mapCredential = mapCredential?.let(::TileflowCredential),
            )
        )
    } catch (_: Exception) {
        // An invalid value leaves the resource configuration; the map then reports what is missing.
    }
}

/**
 * With the `mapId` extra, a Hosted map that reads its credential from the configuration. Otherwise
 * the map in the `manifest` extra, by default the fixture that `scripts/mobile-fixture-server.mjs`
 * serves.
 */
internal fun Intent.mapSource(): TileflowMapSource {
    getStringExtra("mapId")?.let {
        return TileflowMapSource.hosted(it)
    }
    val url = URI(getStringExtra("manifest") ?: "http://127.0.0.1:18645/manifest.json")
    return TileflowMapSource(
        map = getStringExtra("map") ?: "fixture",
        manifestUrl = url,
        allowsLoopbackHttp = url.host == "127.0.0.1",
    )
}

/** Where the examples start and where the recenter button returns. */
private val startCamera = TileflowCamera(-3.70, 40.42, 13.0)

private val exampleOptions =
    TileflowMapOptions(
        controls = TileflowMapControls(scaleBar = true, recenterButton = true),
        events = TileflowEventOptions(TileflowEventLevel.CAMERA),
    )

class ViewExample : ComponentActivity() {
    private lateinit var map: TileflowMapView
    private var dark = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.configureTileflow()
        setContentView(R.layout.map_screen)
        map = findViewById(R.id.map)
        val status = findViewById<TextView>(R.id.status)
        // The panel covers the bottom of the map: the camera centres above it and the controls
        // stay clear of it. It sits above the navigation bar, which the map adds on its own.
        val panel = findViewById<View>(R.id.panel)
        ViewCompat.setOnApplyWindowInsetsListener(panel) { view, insets ->
            view.updateLayoutParams<ViewGroup.MarginLayoutParams> {
                bottomMargin = insets.getInsets(WindowInsetsCompat.Type.systemBars()).bottom
            }
            insets
        }
        panel.addOnLayoutChangeListener { _, _, top, _, bottom, _, _, _, _ ->
            map.setContentPadding(0f, 0f, 0f, (bottom - top).toFloat())
        }
        map.onEvent = {
            when (it) {
                TileflowMapEvent.ContentReady -> status.text = "Tileflow · Android View"
                is TileflowMapEvent.Failed -> status.text = "Map error: ${it.code}"
                is TileflowMapEvent.Tap -> status.text = "Map selected"
                is TileflowMapEvent.LongPress -> status.text = "Long press"
                TileflowMapEvent.RecenterRequested ->
                    lifecycleScope.launch { runCatching { map.fly(startCamera) } }
                else -> Unit
            }
        }
        map.setSource(intent.mapSource(), startCamera)
        lifecycleScope.launch { runCatching { map.setOptions(exampleOptions) } }
        findViewById<Button>(R.id.theme).setOnClickListener {
            dark = !dark
            lifecycleScope.launch {
                runCatching { map.setTheme(if (dark) "dark" else "light") }
                    .onFailure { status.text = "Theme unavailable" }
            }
        }
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }
}

class ComposeExample : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.configureTileflow()
        val source = intent.mapSource()
        setContent {
            var dark by remember { mutableStateOf(false) }
            var expanded by remember { mutableStateOf(false) }
            var status by remember { mutableStateOf("Loading Tileflow…") }
            // The camera survives rotation and process recreation.
            val camera = rememberTileflowCameraState(startCamera)
            val scope = rememberCoroutineScope()
            val panel by animateDpAsState(if (expanded) 280.dp else 120.dp, label = "panel")
            MaterialTheme {
                Box(Modifier.fillMaxSize()) {
                    // The panel's height is content padding: the camera centres above it.
                    TileflowMap(
                        source,
                        Modifier.fillMaxSize(),
                        theme = if (dark) "dark" else "light",
                        options = exampleOptions,
                        cameraState = camera,
                        contentPadding = PaddingValues(bottom = panel),
                    ) {
                        when (it) {
                            TileflowMapEvent.ContentReady -> status = "Tileflow · Compose"
                            is TileflowMapEvent.Failed -> status = "Map error: ${it.code}"
                            is TileflowMapEvent.Tap -> status = "Map selected"
                            TileflowMapEvent.RecenterRequested ->
                                scope.launch {
                                    runCatching { camera.fly(TileflowCameraUpdate(startCamera)) }
                                }
                            else -> Unit
                        }
                    }
                    // The panel sits above the navigation bar, which the map adds on its own.
                    Column(
                        Modifier.align(Alignment.BottomCenter)
                            .navigationBarsPadding()
                            .fillMaxWidth()
                            .height(panel)
                            .background(Color.White.copy(alpha = 0.95f))
                            .padding(16.dp)
                    ) {
                        Text(status)
                        camera.camera?.let { Text("Zoom %.1f".format(it.zoom)) }
                        Button(onClick = { expanded = !expanded }) {
                            Text(if (expanded) "Collapse panel" else "Expand panel")
                        }
                        Button(onClick = { dark = !dark }) { Text("Change theme") }
                    }
                }
            }
        }
    }
}
