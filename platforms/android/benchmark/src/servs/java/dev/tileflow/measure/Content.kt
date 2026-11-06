package dev.tileflow.measure

import android.app.Activity
import android.util.Log
import android.widget.FrameLayout
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.elevation.TileflowElevation
import dev.tileflow.geoip.TileflowGeoIP
import dev.tileflow.routing.TileflowIsochroneRequest
import dev.tileflow.routing.TileflowRouteRequest
import dev.tileflow.routing.TileflowRouting
import dev.tileflow.routing.TileflowRoutingMode
import dev.tileflow.search.TileflowGeocodeRequest
import dev.tileflow.search.TileflowSearch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

internal fun installContent(activity: Activity, root: FrameLayout, run: String): () -> Unit {
    val close = installMap(activity, root, run)
    val scope = CoroutineScope(Dispatchers.Main)
    if (activity.intent.getBooleanExtra("exerciseServices", false)) {
        scope.launch {
            val start = TileflowPosition(-3.70, 40.42)
            val end = TileflowPosition(-3.71, 40.41)
            val mode = TileflowRoutingMode.WALKING
            val result = listOf(
                runCatching { TileflowSearch(activity).geocode(TileflowGeocodeRequest("Madrid")) },
                runCatching { TileflowRouting(activity).route(TileflowRouteRequest(listOf(start, end), mode)) },
                runCatching { TileflowRouting(activity).isochrone(TileflowIsochroneRequest(start, mode, listOf(10))) },
                runCatching { TileflowElevation(activity).elevation(start) },
                runCatching { TileflowGeoIP(activity).locate() },
            )
            Log.i(TAG, "SERVICES $run ${result.map { it.isSuccess }}")
        }
    }
    return { scope.cancel(); close() }
}
