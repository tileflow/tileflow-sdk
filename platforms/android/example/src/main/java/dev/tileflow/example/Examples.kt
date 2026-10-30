package dev.tileflow.example

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
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
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowEventLevel
import dev.tileflow.sdk.TileflowEventOptions
import dev.tileflow.sdk.TileflowMap
import dev.tileflow.sdk.TileflowMapControls
import dev.tileflow.sdk.TileflowMapEvent
import dev.tileflow.sdk.TileflowMapOptions
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.TileflowMapView
import dev.tileflow.sdk.location.TileflowFollowMode
import dev.tileflow.sdk.location.TileflowLocationAccuracy
import dev.tileflow.sdk.location.TileflowLocationOptions
import dev.tileflow.sdk.location.TileflowLocationPermissions
import dev.tileflow.sdk.location.TileflowLocationProvider
import dev.tileflow.sdk.location.TileflowPuckBearing
import dev.tileflow.sdk.location.TileflowSimulatedLocationProvider
import dev.tileflow.sdk.location.rememberTileflowLocationState
import dev.tileflow.sdk.TileflowPoint
import dev.tileflow.sdk.rememberTileflowCameraState
import dev.tileflow.sdk.rememberTileflowMapController
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

/**
 * With the `simulateLocation` extra, a walk through central Madrid instead of the device's
 * location, for the emulator and for demonstrations.
 */
internal fun Intent.locationProvider(): TileflowLocationProvider? =
    if (!getBooleanExtra("simulateLocation", false)) null
    else
        TileflowSimulatedLocationProvider(
            listOf(
                TileflowCoordinate(-3.7038, 40.4168),
                TileflowCoordinate(-3.6996, 40.4180),
                TileflowCoordinate(-3.6922, 40.4194),
                TileflowCoordinate(-3.6884, 40.4153),
            ),
            speed = 6.0,
            loops = true,
        )

/** Shows the location with the device's heading. */
private val showLocation =
    TileflowLocationOptions(enabled = true, puckBearing = TileflowPuckBearing.HEADING)

/** Where the examples start and where the recenter button returns. */
private val startCamera = TileflowCamera(-3.70, 40.42, 13.0)
private val startCenter = TileflowCoordinate(startCamera.longitude, startCamera.latitude)

private val exampleOptions =
    TileflowMapOptions(
        controls = TileflowMapControls(scaleBar = true, recenterButton = true),
        events = TileflowEventOptions(TileflowEventLevel.CAMERA),
    )

class ViewExample : ComponentActivity() {
    private lateinit var map: TileflowMapView
    private lateinit var status: TextView
    private lateinit var pins: AnnotationExample
    private var dark = false

    /**
     * Asks for the precise location while the app is in use; the person may share an approximate
     * one. With access, the map shows the location and follows it. The recenter button follows it
     * again after the map is moved.
     */
    private val locationRequest =
        registerForActivityResult(TileflowLocationPermissions.RequestWhenInUse()) { authorization ->
            if (!authorization.allowsLocation) {
                status.text = "Location access is off"
                return@registerForActivityResult
            }
            lifecycleScope.launch {
                runCatching {
                    map.setOptions(map.options.copy(location = showLocation))
                    map.followMode = TileflowFollowMode.POSITION
                }
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.configureTileflow()
        setContentView(R.layout.map_screen)
        map = findViewById(R.id.map)
        status = findViewById(R.id.status)
        // The view's annotation API takes pixels.
        pins =
            AnnotationExample(
                this,
                map.annotations,
                map.viewAnnotationManager,
                resources.displayMetrics.density,
            ) {
                status.text = it
            }
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
                // Taps on a pin open its callout; a tap anywhere else closes it.
                is TileflowMapEvent.Tap ->
                    lifecycleScope.launch {
                        pins.hideCallout()
                        val selected =
                            runCatching { ClusterExample.tap(ViewClusterMap(map), it.point) }
                                .getOrNull()
                        status.text = selected ?: "Map selected"
                    }
                is TileflowMapEvent.LongPress -> status.text = "Long press"
                TileflowMapEvent.RecenterRequested ->
                    lifecycleScope.launch { runCatching { map.fly(startCamera) } }
                is TileflowMapEvent.FollowModeChanged ->
                    status.text =
                        if (it.change.mode == TileflowFollowMode.NONE)
                            "Moved away from your location"
                        else "Following you"
                else -> Unit
            }
        }
        map.locationProvider = intent.locationProvider()
        map.setSource(intent.mapSource(), startCamera)
        lifecycleScope.launch { runCatching { map.setOptions(exampleOptions) } }
        findViewById<Button>(R.id.myLocation).setOnClickListener {
            locationRequest.launch(TileflowLocationAccuracy.FULL)
        }
        findViewById<Button>(R.id.places).setOnClickListener {
            lifecycleScope.launch {
                runCatching {
                        ClusterExample.show(ViewClusterMap(map), startCenter)
                        map.ease(TileflowCameraUpdate(zoom = 10.0))
                    }
                    .onSuccess { status.text = "Tap a cluster to zoom in" }
                    .onFailure { status.text = "Places unavailable" }
            }
        }
        findViewById<Button>(R.id.annotations).setOnClickListener { pins.show() }
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
        val locationProvider = intent.locationProvider()
        setContent {
            var dark by remember { mutableStateOf(false) }
            var expanded by remember { mutableStateOf(false) }
            var status by remember { mutableStateOf("Loading Tileflow…") }
            // The camera survives rotation and process recreation.
            val camera = rememberTileflowCameraState(startCamera)
            // The follow mode survives rotation too; the recenter button and gestures change it.
            val location = rememberTileflowLocationState()
            var showsLocation by rememberSaveable { mutableStateOf(false) }
            // Asks for the precise location while the app is in use, then shows and follows it.
            val locationRequest =
                rememberLauncherForActivityResult(TileflowLocationPermissions.RequestWhenInUse()) {
                    if (it.allowsLocation) {
                        showsLocation = true
                        location.followMode = TileflowFollowMode.POSITION
                    } else status = "Location access is off"
                }
            val controller = rememberTileflowMapController()
            val places = remember(controller) { ControllerClusterMap(controller) }
            // The controller's annotation API takes dp.
            val pins =
                remember(controller) {
                    AnnotationExample(
                        this@ComposeExample,
                        controller.annotations,
                        controller.viewAnnotationManager,
                        1f,
                    ) {
                        status = it
                    }
                }
            val density = LocalDensity.current.density
            val scope = rememberCoroutineScope()
            val panel by animateDpAsState(if (expanded) 424.dp else 168.dp, label = "panel")
            MaterialTheme {
                Box(Modifier.fillMaxSize()) {
                    // The panel's height is content padding: the camera centres above it.
                    TileflowMap(
                        source,
                        Modifier.fillMaxSize(),
                        theme = if (dark) "dark" else "light",
                        options =
                            if (showsLocation) exampleOptions.copy(location = showLocation)
                            else exampleOptions,
                        controller = controller,
                        cameraState = camera,
                        contentPadding = PaddingValues(bottom = panel),
                        locationState = location,
                        locationProvider = locationProvider,
                    ) {
                        when (it) {
                            TileflowMapEvent.ContentReady -> status = "Tileflow · Compose"
                            is TileflowMapEvent.Failed -> status = "Map error: ${it.code}"
                            is TileflowMapEvent.Tap ->
                                scope.launch {
                                    pins.hideCallout()
                                    // Taps arrive in pixels; the controller queries in dp.
                                    val point =
                                        TileflowPoint(it.point.x / density, it.point.y / density)
                                    status =
                                        runCatching { ClusterExample.tap(places, point) }.getOrNull()
                                            ?: "Map selected"
                                }
                            TileflowMapEvent.RecenterRequested ->
                                scope.launch {
                                    runCatching { camera.fly(TileflowCameraUpdate(startCamera)) }
                                }
                            is TileflowMapEvent.FollowModeChanged ->
                                status =
                                    if (it.change.mode == TileflowFollowMode.NONE)
                                        "Moved away from your location"
                                    else "Following you"
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
                        Button(
                            onClick = { locationRequest.launch(TileflowLocationAccuracy.FULL) }
                        ) {
                            Text("My location")
                        }
                        if (expanded) {
                            Button(
                                onClick = {
                                    scope.launch {
                                        runCatching {
                                                ClusterExample.show(places, startCenter)
                                                camera.ease(TileflowCameraUpdate(zoom = 10.0))
                                            }
                                            .onSuccess { status = "Tap a cluster to zoom in" }
                                            .onFailure { status = "Places unavailable" }
                                    }
                                }
                            ) {
                                Text("Show 100,000 places")
                            }
                            Button(onClick = { pins.show() }) { Text("Show annotations") }
                        }
                    }
                }
            }
        }
    }
}
