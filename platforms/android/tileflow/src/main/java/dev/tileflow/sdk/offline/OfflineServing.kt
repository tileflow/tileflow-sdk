package dev.tileflow.sdk.offline

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheMetadata
import dev.tileflow.sdk.transport.ResourceCacheRetention
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceCacheStore
import dev.tileflow.sdk.transport.StoredResource
import dev.tileflow.sdk.transport.sha256Hex
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

        /** The regional credits of a download's World attribution. */
        fun credits(attribution: List<JSONObject>): List<OfflineCredit> =
            attribution.flatMap { source ->
                val items = source.optJSONArray("regionalObligations") ?: return@flatMap emptyList()
                (0 until items.length()).mapNotNull { items.optJSONObject(it)?.let(::of) }
            }
    }
}

/**
 * A source's stored tiles: the packs under each anchor, and the covers whose tiles a pack would hold
 * if the archive stored them.
 */
internal data class OfflineServedTiles(
    val template: OfflineTileTemplate,
    val zooms: IntRange,
    val absentStatus: Int,
    val regions: List<OfflinePackRegion> = emptyList(),
    val anchors: Map<OfflineTileId, List<java.io.File>> = emptyMap(),
) {
    fun merging(other: OfflineServedTiles): OfflineServedTiles {
        val files = anchors.toMutableMap()
        for ((anchor, list) in other.anchors)
            files[anchor] = (files[anchor].orEmpty() + list).distinct()
        return copy(
            zooms = minOf(zooms.first, other.zooms.first)..maxOf(zooms.last, other.zooms.last),
            regions = (regions + other.regions).distinct(),
            anchors = files,
        )
    }

    /**
     * Whether the region downloaded [tile], stored or not, or a tile above the downloaded zooms
     * whose ancestor at the deepest one it downloaded.
     */
    fun covers(tile: OfflineTileId): Boolean {
        val held = if (tile.z > zooms.last) tile.ancestor(zooms.last) else tile
        return held.z in zooms &&
            regions.any { OfflineTileCover(it, held.z).contains(held.x, held.y) }
    }
}

/** A Map's stored packs: its documents by address and its sources' tiles by template. */
internal data class OfflineServedPacks(
    val documents: Map<String, Pair<java.io.File, OfflinePackEntry>> = emptyMap(),
    val tiles: Map<String, OfflineServedTiles> = emptyMap(),
) {
    fun merging(other: OfflineServedPacks): OfflineServedPacks {
        val merged = tiles.toMutableMap()
        for ((template, served) in other.tiles)
            merged[template] = merged[template]?.merging(served) ?: served
        return OfflineServedPacks(other.documents + documents, merged)
    }
}

/**
 * What stored regions a map may use without a network: the cache paths of every available region's
 * resources, the packs of each Hosted Map and the regional credits of its releases, by the cache
 * scope of the Map.
 */
internal data class OfflineServingSnapshot(
    val paths: Set<String> = emptySet(),
    val packs: Map<String, OfflineServedPacks> = emptyMap(),
    val credits: Map<String, List<OfflineCredit>> = emptyMap(),
)

/**
 * The process's view of stored regions for the transport. Each store publishes what it holds
 * whenever a region becomes available, changes or goes, and maps see every store's regions; a map
 * reads it without waiting for the network.
 */
internal class OfflineServingIndex {
    private val stores = java.util.IdentityHashMap<Any, OfflineServingSnapshot>()
    @Volatile private var merged: OfflineServingSnapshot? = null
    private val published = CountDownLatch(1)

    /** Opens the store, which publishes; set once a store exists for the process. */
    @Volatile var open: (() -> Unit)? = null

    /** Replaces what [store] publishes. */
    fun publish(snapshot: OfflineServingSnapshot, store: Any) {
        synchronized(stores) {
            stores[store] = snapshot
            val paths = HashSet<String>()
            val packs = HashMap<String, OfflineServedPacks>()
            val credits = HashMap<String, MutableList<OfflineCredit>>()
            for (each in stores.values) {
                paths.addAll(each.paths)
                for ((scope, served) in each.packs)
                    packs[scope] = packs[scope]?.merging(served) ?: served
                for ((scope, list) in each.credits) {
                    val merged = credits.getOrPut(scope) { mutableListOf() }
                    for (credit in list) if (merged.none { it.id == credit.id }) merged.add(credit)
                }
            }
            merged = OfflineServingSnapshot(paths, packs, credits)
        }
        published.countDown()
    }

    /** The current snapshot, once a store has read its records. Blocks a resource thread. */
    fun snapshot(): OfflineServingSnapshot {
        merged?.let {
            return it
        }
        open?.invoke()
        published.await(10, TimeUnit.SECONDS)
        return merged ?: OfflineServingSnapshot()
    }

    fun serves(key: ResourceCacheKey): Boolean = key.relativePath in snapshot().paths

    /** Indexes of packs read recently: reading one is a few file reads. */
    private val indexes = HashMap<java.io.File, OfflinePackIndex>()

    /**
     * A stored region's answer for [key]: its pinned entry, a pack entry, or the status the source
     * answers online for a tile it does not store. That status answers a tile the region covers
     * that no stored pack holds, and a tile inside the region above the zooms it downloaded, so the
     * renderer overzooms the deepest downloaded tile, as it does online where a tile does not exist.
     * Only a resource the region should hold and does not is a miss.
     */
    fun resource(key: ResourceCacheKey, cache: ResourceCacheStore): StoredResource? {
        val snapshot = snapshot()
        if (key.relativePath in snapshot.paths)
            return cache.read(key, ResourceCacheRetention.PINNED)
        val packs = snapshot.packs[key.scope.directory] ?: return null
        val url = key.url.toASCIIString()
        packs.documents[url]?.let { (file, entry) ->
            return stored(entry, file, key.url)
        }
        for (tiles in packs.tiles.values) {
            val tile = tiles.template.tile(url)?.takeIf { it.z >= tiles.zooms.first } ?: continue
            val anchor = tile.ancestor(OfflinePackBand.anchor(tile.z))
            val files = if (tile.z in tiles.zooms) tiles.anchors[anchor].orEmpty() else emptyList()
            for (file in files) {
                val entry = index(file)?.entries?.get(tile.name) ?: continue
                return stored(entry, file, key.url)
            }
            if (tiles.covers(tile))
                return StoredResource(
                    ResourceCacheMetadata.of(
                        key.url,
                        tiles.absentStatus,
                        emptyMap(),
                        System.currentTimeMillis(),
                        true,
                        0,
                        sha256Hex(ByteArray(0)),
                    ),
                    ByteArray(0),
                )
        }
        return null
    }

    private fun index(file: java.io.File): OfflinePackIndex? {
        synchronized(indexes) { indexes[file]?.let { return it } }
        val index = runCatching { OfflinePackFormat.index(file) }.getOrNull() ?: return null
        synchronized(indexes) {
            if (indexes.size >= 256) indexes.clear()
            indexes[file] = index
        }
        return index
    }

    /**
     * A pack entry as the renderer receives it: decoded, with its route's `ETag`, which names the
     * body as stored, so a map online can revalidate it instead of downloading it again.
     */
    private fun stored(entry: OfflinePackEntry, file: java.io.File, url: java.net.URI): StoredResource? {
        val raw = runCatching { OfflinePackFormat.body(entry, file) }.getOrNull() ?: return null
        val body =
            when (entry.contentEncoding) {
                null -> raw
                "gzip" -> runCatching { OfflinePackFormat.gunzip(raw) }.getOrNull() ?: return null
                else -> return null
            }
        return StoredResource(
            ResourceCacheMetadata.of(
                url,
                200,
                mapOf(
                    "Content-Type" to entry.contentType,
                    "ETag" to "\"${sha256Hex(raw)}\"",
                    "Cache-Control" to "private, no-cache",
                ),
                System.currentTimeMillis(),
                true,
                body.size,
                sha256Hex(body),
            ),
            body,
        )
    }

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
