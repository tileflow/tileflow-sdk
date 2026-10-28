package dev.tileflow.example

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import dev.tileflow.configuration.Tileflow
import dev.tileflow.configuration.TileflowConfigurationException
import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceException
import dev.tileflow.routing.TileflowRouteRequest
import dev.tileflow.routing.TileflowRouting
import dev.tileflow.routing.TileflowRoutingMode
import dev.tileflow.sdk.TileflowAnnotation
import dev.tileflow.sdk.TileflowMap
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.rememberTileflowMapController
import dev.tileflow.search.TileflowGeocodeRequest
import dev.tileflow.search.TileflowSearch
import dev.tileflow.servicecontent.TileflowBounds
import dev.tileflow.servicecontent.TileflowCoordinate
import dev.tileflow.servicecontent.TileflowRouteLayers
import dev.tileflow.servicecontent.searchProximity
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * Geocodes two places, routes between them and draws the route. Pass a publishable credential as
 * the `servicesCredential` extra, or add the `tileflow_services_credential` string resource, and,
 * optionally, an API origin as `apiOrigin`.
 */
class ServicesExample : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.configureTileflow()
        val source = intent.mapSource()
        val configured = servicesConfigured(this)
        setContent { MaterialTheme { ServicesScreen(source, configured) } }
    }
}

/** Whether Search and Routing have a credential. */
private fun servicesConfigured(context: Context): Boolean =
    try {
        val configuration = Tileflow.configuration(context)
        configuration.credential(TileflowService.SEARCH) != null &&
            configuration.credential(TileflowService.ROUTING) != null
    } catch (_: TileflowConfigurationException) {
        false
    }

@Composable
private fun ServicesScreen(source: TileflowMapSource, configured: Boolean) {
    val context = LocalContext.current
    val search = remember { TileflowSearch(context) }
    val routing = remember { TileflowRouting(context) }
    val controller = rememberTileflowMapController()
    val scope = rememberCoroutineScope()
    var from by remember { mutableStateOf("Puerta del Sol, Madrid") }
    var to by remember { mutableStateOf("Museo del Prado, Madrid") }
    var status by remember {
        mutableStateOf(
            if (configured) "Enter two places to route between them."
            else
                "A publishable Tileflow credential is needed: pass it as the " +
                    "servicesCredential extra or add the tileflow_services_credential resource."
        )
    }
    var attribution by remember { mutableStateOf("") }

    fun route() {
        scope.launch {
            status = "Searching…"
            try {
                // At city scale, the map centre helps Search rank nearby places first.
                val proximity =
                    try {
                        controller.camera().searchProximity
                    } catch (_: TileflowMapException) {
                        null
                    }
                val start =
                    search.geocode(TileflowGeocodeRequest(from, limit = 1, proximity = proximity))
                val end =
                    search.geocode(TileflowGeocodeRequest(to, limit = 1, proximity = proximity))
                val first = start.results.firstOrNull()
                val last = end.results.firstOrNull()
                if (first == null || last == null) {
                    status = "No place matches one of the searches."
                    return@launch
                }
                status = "Routing…"
                val response =
                    routing.route(
                        TileflowRouteRequest(
                            listOf(first.position, last.position),
                            TileflowRoutingMode.DRIVING,
                        )
                    )
                val route = response.routes.first()
                controller.setContent(
                    annotations =
                        listOf(
                            TileflowAnnotation(
                                "from",
                                TileflowCoordinate(first.position),
                                first.label,
                            ),
                            TileflowAnnotation(
                                "to",
                                TileflowCoordinate(last.position),
                                last.label,
                            ),
                        ),
                    layers = TileflowRouteLayers.build(response),
                )
                controller.fit(TileflowBounds(route.bounds), padding = 48f)
                val kilometres = (route.distance / 100).roundToInt() / 10.0
                status = "$kilometres km · ${(route.duration / 60).roundToInt()} min"
                attribution =
                    (start.attribution + end.attribution).map { it.text }.plus(response.attribution)
                        .distinct()
                        .joinToString(" · ")
            } catch (error: TileflowServiceException) {
                status = "The request failed: ${error.kind}"
            } catch (error: TileflowMapException) {
                status = "Map error: ${error.code}"
            }
        }
    }

    Column(Modifier.fillMaxSize().safeDrawingPadding()) {
        OutlinedTextField(
            value = from,
            onValueChange = { from = it },
            label = { Text("From") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        OutlinedTextField(
            value = to,
            onValueChange = { to = it },
            label = { Text("To") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
        )
        Button(onClick = ::route, enabled = configured, modifier = Modifier.padding(16.dp)) {
            Text("Route")
        }
        Text(status, Modifier.padding(horizontal = 16.dp))
        TileflowMap(source, Modifier.weight(1f), controller = controller)
        if (attribution.isNotEmpty()) Text(attribution, Modifier.padding(8.dp))
    }
}
