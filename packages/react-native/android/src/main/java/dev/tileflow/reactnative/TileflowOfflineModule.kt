package dev.tileflow.reactnative

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule
import dev.tileflow.reactnative.bridge.BridgeObject
import dev.tileflow.reactnative.bridge.OfflineBridge
import dev.tileflow.sdk.offline.TileflowOfflineStore
import dev.tileflow.sdk.offline.TileflowOfflineSubscription
import dev.tileflow.sdk.offline.TileflowOfflineSwitch
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

/** The native offline store and network switch. Arguments and regions are converted in [OfflineBridge]. */
@ReactModule(name = TileflowOfflineModule.NAME)
class TileflowOfflineModule(context: ReactApplicationContext) : NativeTileflowOfflineSpec(context) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val main = Handler(Looper.getMainLooper())
    private var subscription: TileflowOfflineSubscription? = null
    // The store opens on first use, never when the module is created.
    private val store by lazy { TileflowOfflineStore.get(context.applicationContext) }

    override fun getName(): String = NAME

    private fun run(promise: Promise, work: suspend () -> Any?) =
        scope.settle(promise, OfflineBridge::failure, work)

    override fun estimateRegion(options: ReadableMap, promise: Promise) {
        val values = options.toHashMap()
        run(promise) { OfflineBridge.encode(store.estimateRegion(OfflineBridge.options(values))) }
    }

    override fun loadRegion(id: String, options: ReadableMap, promise: Promise) {
        val values = options.toHashMap()
        run(promise) { OfflineBridge.encode(store.loadRegion(id, OfflineBridge.options(values))) }
    }

    override fun updateRegionMetadata(id: String, metadata: ReadableMap, promise: Promise) {
        val values = metadata.toHashMap()
        run(promise) {
            val parsed = BridgeObject(mapOf("metadata" to values), "arguments").optionalStringMap("metadata")
            store.updateRegionMetadata(id, parsed ?: emptyMap())
        }
    }

    override fun allRegions(promise: Promise) = run(promise) { store.allRegions().map(OfflineBridge::encode) }

    override fun region(id: String, promise: Promise) =
        run(promise) { store.region(id)?.let { mapOf("region" to OfflineBridge.encode(it)) } ?: emptyMap<String, Any?>() }

    override fun pauseRegion(id: String, promise: Promise) = run(promise) { store.pauseRegion(id) }

    override fun resumeRegion(id: String, promise: Promise) = run(promise) { store.resumeRegion(id) }

    override fun cancelRegion(id: String, promise: Promise) = run(promise) { store.cancelRegion(id) }

    override fun removeRegion(id: String, promise: Promise) = run(promise) { store.removeRegion(id) }

    override fun automaticUpdatesEnabled(promise: Promise) = run(promise) { store.isAutomaticUpdatesEnabled() }

    override fun setAutomaticUpdates(enabled: Boolean, promise: Promise) =
        run(promise) { store.setAutomaticUpdates(enabled) }

    override fun isNetworkEnabled(): Boolean = TileflowOfflineSwitch.isNetworkEnabled

    override fun setNetworkEnabled(enabled: Boolean) {
        TileflowOfflineSwitch.isNetworkEnabled = enabled
    }

    override fun startObserving() {
        if (subscription != null) return
        // The store calls handlers on a background thread; JavaScript receives them in order.
        subscription =
            store.subscribe { event ->
                val encoded = OfflineBridge.encode(event)
                main.post { emitOnRegionEvent(writableMap(encoded)) }
            }
    }

    override fun stopObserving() {
        subscription?.cancel()
        subscription = null
    }

    override fun invalidate() {
        stopObserving()
        scope.cancel()
        super.invalidate()
    }

    companion object {
        const val NAME = "TileflowOffline"
    }
}
