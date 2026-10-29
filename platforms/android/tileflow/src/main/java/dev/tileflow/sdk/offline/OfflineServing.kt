package dev.tileflow.sdk.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.TileflowHttpClient
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject

/**
 * When maps use downloaded regions. Every decision about serving offline content is made here, so
 * a change of policy changes one place.
 */
internal object OfflineServingRule {
    /**
     * Whether a Hosted map serves its protected resources from its stored packs instead of its
     * session. With a network, the map starts its normal session, billed as any other, and the
     * packs only save downloads; without one, or with the network switched off, it opens from the
     * packs without a session, and nothing is billed.
     */
    fun hostedUsesPacks(networkEnabled: Boolean, reachable: Boolean): Boolean =
        !networkEnabled || !reachable

    /**
     * Whether a region whose access ended (`not_updatable`) is still served. Off: its files stay on
     * the device, untouched, and maps stop using them.
     */
    const val SERVES_REGIONS_AFTER_ACCESS_ENDS = false
}

/** A regional credit of a stored release: shown while one of its boxes is in view. */
internal data class OfflineCredit(
    val id: String,
    val text: String,
    val href: String,
    /** `[west, south, east, north]` boxes that touch the pack's region. */
    val regions: List<List<Double>>,
) {
    /** The renderer's form: `{id, text, href, regions}`. */
    fun toJson(): JSONObject =
        JSONObject()
            .put("id", id)
            .put("text", text)
            .put("href", href)
            .put("regions", JSONArray(regions.map { JSONArray(it) }))

    companion object {
        fun of(value: JSONObject): OfflineCredit? {
            val id = value.optString("id").takeIf { it.isNotEmpty() && it.length <= 192 }
            val text = value.optString("exact").takeIf { it.isNotEmpty() && it.length <= 1024 }
            val href =
                value.optString("href").takeIf { it.startsWith("https://") && it.length <= 2048 }
            val boxes = value.optJSONArray("regions")
            if (id == null || text == null || href == null || boxes == null) return null
            val regions = ArrayList<List<Double>>()
            for (index in 0 until minOf(boxes.length(), 256)) {
                val box = boxes.optJSONArray(index) ?: return null
                if (box.length() != 4) return null
                val numbers = List(4) { box.optDouble(it) }
                if (
                    numbers.any { !it.isFinite() } ||
                        numbers[0] >= numbers[2] ||
                        numbers[1] >= numbers[3]
                )
                    return null
                regions.add(numbers)
            }
            return if (regions.isEmpty()) null else OfflineCredit(id, text, href, regions)
        }

        /** The regional credits of a pack's World attribution. */
        fun credits(attribution: List<JSONObject>): List<OfflineCredit> =
            attribution.flatMap { source ->
                val items = source.optJSONArray("regionalObligations") ?: return@flatMap emptyList()
                (0 until items.length()).mapNotNull { items.optJSONObject(it)?.let(::of) }
            }
    }
}

/**
 * What stored regions a map may use without a network: the cache paths of every available region's
 * resources, and the regional credits of each Hosted Map's releases by the cache scope of the Map.
 */
internal data class OfflineServingSnapshot(
    val paths: Set<String> = emptySet(),
    val credits: Map<String, List<OfflineCredit>> = emptyMap(),
)

/**
 * The process's view of stored regions for the transport. The store publishes it whenever a region
 * becomes available, changes or goes; a map reads it without waiting for the network.
 */
internal class OfflineServingIndex {
    @Volatile private var state: OfflineServingSnapshot? = null
    private val published = CountDownLatch(1)

    /** Opens the store, which publishes; set once a store exists for the process. */
    @Volatile var open: (() -> Unit)? = null

    fun publish(snapshot: OfflineServingSnapshot) {
        state = snapshot
        published.countDown()
    }

    /** The current snapshot, once the store has read its records. Blocks a resource thread. */
    fun snapshot(): OfflineServingSnapshot {
        state?.let {
            return it
        }
        open?.invoke()
        published.await(10, TimeUnit.SECONDS)
        return state ?: OfflineServingSnapshot()
    }

    fun serves(key: ResourceCacheKey): Boolean = key.relativePath in snapshot().paths

    fun credits(scope: ResourceCacheScope): List<OfflineCredit> =
        snapshot().credits[scope.directory].orEmpty()

    companion object {
        val shared = OfflineServingIndex()

        /** The shared index, able to open the process's store when a map first needs it. */
        fun shared(context: Context): OfflineServingIndex {
            val application = context.applicationContext ?: context
            if (shared.open == null)
                shared.open = { runBlocking { TileflowOfflineStore.get(application).core.open() } }
            return shared
        }
    }
}

/** Whether the device has a validated network path, as the system reports it. */
internal object OfflineReachability {
    fun isReachable(context: Context): Boolean {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return true
        return runCatching {
                val capabilities =
                    manager.getNetworkCapabilities(manager.activeNetwork) ?: return false
                capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            }
            .getOrDefault(true)
    }
}

/**
 * Turns Tileflow's network use off and on for the whole process, after Mapbox's offline switch.
 *
 * Switched off, no map, session or download reaches the network. Maps use only downloaded regions
 * and the shared cache, whatever their freshness; a resource that neither holds answers at once as
 * a cache miss, with status 504 as an HTTP cache answers `only-if-cached`, and the map reports it
 * as a `RESOURCE_FAILED` warning instead of waiting. Hosted maps open from their downloaded regions
 * without starting a session. Downloads wait, and continue when the network is switched on again.
 */
public object TileflowOfflineSwitch {
    /** True by default. */
    @JvmStatic
    public var isNetworkEnabled: Boolean
        get() = TileflowHttpClient.networkEnabled
        set(value) {
            val changed = TileflowHttpClient.networkEnabled != value
            TileflowHttpClient.networkEnabled = value
            if (changed && value) TileflowOfflineStore.instance?.reconnected()
        }
}
