package dev.tileflow.reactnative

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import dev.tileflow.configuration.Tileflow
import dev.tileflow.elevation.TileflowElevation
import dev.tileflow.geoip.TileflowGeoIP
import dev.tileflow.reactnative.bridge.ServiceClients
import dev.tileflow.reactnative.bridge.ServicesBridge
import dev.tileflow.routing.TileflowRouting
import dev.tileflow.search.TileflowSearch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/**
 * Search, Routing, Elevation and GeoIP through the native clients. Requests and answers are
 * converted in [ServicesBridge]; credentials stay in the app's string resources.
 */
@ReactModule(name = TileflowServicesModule.NAME)
class TileflowServicesModule(context: ReactApplicationContext) : NativeTileflowServicesSpec(context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    // The clients read the process configuration on every call, so creating them reads nothing.
    private val clients by lazy {
        val application = context.applicationContext
        ServiceClients(
            TileflowSearch(application),
            TileflowRouting(application),
            TileflowElevation(application),
            TileflowGeoIP(application),
        )
    }

    override fun getName(): String = NAME

    override fun configuredServices(): WritableMap =
        writableMap(ServicesBridge.configuredServices { Tileflow.configuration(reactApplicationContext) })

    override fun call(service: String, operation: String, request: ReadableMap, promise: Promise) {
        val values = request.toHashMap()
        scope.settle(promise, ServicesBridge::failure) {
            ServicesBridge.call(service, operation, values, clients)
        }
    }

    override fun invalidate() {
        scope.cancel()
        super.invalidate()
    }

    companion object {
        const val NAME = "TileflowServices"
    }
}
