package dev.tileflow.sdk.transport

import android.content.Context
import android.os.Handler
import android.os.Looper
import androidx.annotation.MainThread
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.attribution.MapFairUseSignal
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import org.maplibre.android.MapLibre
import org.maplibre.android.offline.OfflineManager

/** One request's outcome for the map that owns it. It never holds a path, query or credential. */
internal class MapResourceOutcome(
    val resource: TileflowResourceKind,
    /** The scheme, host and port of the remote resource. */
    val origin: String,
    /** The status the SDK answered, or null when it could not answer. */
    val status: Int?,
    /** Why the SDK could not answer, when it could not. */
    val error: Throwable? = null,
    /** What a World tile's response says about fair use. */
    val fairUse: MapFairUseSignal? = null,
)

/** How a mounted map answers MapLibre's requests for its resources. */
internal class MapResourceRoute(
    /** The map generation's resource owner: policy, credentials, session, cache and packs. */
    val loader: ResourceLoader,
    /** The kind of the resource a remote URL addresses, for diagnostics. */
    val classify: (URI) -> TileflowResourceKind,
    /** Called on a worker thread after each request. */
    val report: (MapResourceOutcome) -> Unit,
)

/**
 * The process-wide link between MapLibre Native and the mounted Tileflow maps. MapLibre's network
 * configuration belongs to the process, so every Tileflow map shares one interception: each map
 * registers a route under a random context, and its style addresses carry that context (see
 * [MapResourceAddress]). Requests that are not Tileflow addresses keep MapLibre's own client, so
 * other MapLibre maps in the application are not affected.
 */
internal object MapResourceContexts {
    private val routes = ConcurrentHashMap<String, MapResourceRoute>()
    val activeCount: Int get() = routes.size
    private val main = Handler(Looper.getMainLooper())

    /**
     * Observes each request MapLibre sends to its own client instead of the SDK. Null outside
     * tests; maps never need it.
     */
    @Volatile var onDelegated: ((String) -> Unit)? = null

    /**
     * Observes each Tileflow request MapLibre made: the remote resource and the status the SDK
     * answered, or null when it could not answer. Null outside tests; maps never need it.
     */
    @Volatile var onRequest: ((URI, Int?) -> Unit)? = null

    fun register(route: MapResourceRoute): String {
        while (true) {
            val context = MapResourceAddress.newContext()
            if (routes.putIfAbsent(context, route) == null) return context
        }
    }

    fun retire(context: String) {
        routes.remove(context)
    }

    fun route(context: String): MapResourceRoute? = routes[context]

    private var installed = false
    private var installing = false
    private val waiting = mutableListOf<(Throwable?) -> Unit>()

    /**
     * Prepares MapLibre once per process, before the first Tileflow map draws: its module provider
     * answers Tileflow addresses through the SDK's transport, and its ambient cache is turned off,
     * because MapLibre stores responses whatever their `Cache-Control` and the SDK's cache must be
     * the only one. [done] runs on the main thread, with the failure when MapLibre refused.
     *
     * The ambient cache size is a setting of MapLibre's database, shared by every MapLibre map in
     * the application.
     */
    @MainThread
    fun install(context: Context, done: (Throwable?) -> Unit) {
        if (installed) {
            done(null)
            return
        }
        waiting += done
        if (installing) return
        installing = true
        val application = context.applicationContext ?: context
        try {
            MapLibre.getInstance(application)
            val previous = MapLibre.getModuleProvider()
            if (previous !is MapLibreModuleProvider)
                MapLibre.setModuleProvider(MapLibreModuleProvider(previous))
            OfflineManager.getInstance(application)
                .setMaximumAmbientCacheSize(
                    0,
                    object : OfflineManager.FileSourceCallback {
                        override fun onSuccess() {
                            main.post { finish(null) }
                        }

                        override fun onError(message: String) {
                            val error =
                                IllegalStateException(
                                    "MapLibre's ambient cache could not be turned off: $message"
                                )
                            main.post { finish(error) }
                        }
                    },
                )
        } catch (error: Exception) {
            finish(error)
        }
    }

    private fun finish(error: Throwable?) {
        installing = false
        installed = error == null
        val callbacks = waiting.toList()
        waiting.clear()
        callbacks.forEach { it(error) }
    }

    private var mounted = 0

    /**
     * Treats the device as connected while a Tileflow map drawn by MapLibre is mounted.
     *
     * MapLibre follows the system's connectivity by default and sends no request at all while the
     * system reports no network, so a map could not open from downloaded regions in airplane mode.
     * Whether a request may use the network is the SDK's decision ([TileflowHttpClient],
     * `TileflowOfflineSwitch`, the offline serving rule), so MapLibre is told it is connected and
     * always asks.
     *
     * The setting is process-wide: it applies to every MapLibre map in the application. When the
     * last Tileflow map unmounts, MapLibre follows the system's connectivity again; a value the
     * application set itself is not restored, because MapLibre does not expose it.
     */
    @MainThread
    fun acquire() {
        if (mounted++ == 0) MapLibre.setConnected(true)
    }

    /** Ends one [acquire]. */
    @MainThread
    fun release() {
        if (mounted == 0) return
        if (--mounted == 0) MapLibre.setConnected(null)
    }
}
