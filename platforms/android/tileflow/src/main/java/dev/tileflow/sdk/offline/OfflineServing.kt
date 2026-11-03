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
     * Whether a region whose access ended (`not_updatable`) is still served. On: the device keeps
     * using what it downloaded until the region expires, and the region only stops updating. Off:
     * its files stay on the device, untouched, and maps stop using them at once.
     */
    const val SERVES_REGIONS_AFTER_ACCESS_ENDS = true

    /**
     * How long a Hosted region serves after the service last confirmed access to it, after Mapbox
     * and MapTiler: it expires 30 days later and maps keep using it for 7 more days of grace. Only
     * a successful revalidation or a new download confirms access, so a region whose access ended
     * lapses this long after its last success. Self-hosted regions never expire.
     */
    val EXPIRY =
        OfflineExpiryWindow(validityMillis = 30L * 86_400_000, graceMillis = 7L * 86_400_000)
}

/** A Hosted region's validity window, counted from the last time the service confirmed access. */
internal data class OfflineExpiryWindow(val validityMillis: Long, val graceMillis: Long) {
    fun expiresAt(validatedAt: Long): Long = validatedAt + validityMillis

    fun gracePeriodEndsAt(validatedAt: Long): Long = validatedAt + validityMillis + graceMillis

    fun phase(validatedAt: Long, now: Long): OfflineExpiryPhase =
        when {
            now < expiresAt(validatedAt) -> OfflineExpiryPhase.VALID
            now < gracePeriodEndsAt(validatedAt) -> OfflineExpiryPhase.GRACE_PERIOD
            else -> OfflineExpiryPhase.EXPIRED
        }
}

internal enum class OfflineExpiryPhase {
    VALID,
    GRACE_PERIOD,
    EXPIRED,
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

        /**
         * The regional credits of a download's attribution, one per credit: the same credit of two
         * sources or two downloads keeps every box either names.
         */
        fun credits(attribution: List<JSONObject>): List<OfflineCredit> =
            merging(
                emptyList(),
                attribution.flatMap { source ->
                    val items =
                        source.optJSONArray("regionalObligations") ?: return@flatMap emptyList()
                    (0 until items.length()).mapNotNull { items.optJSONObject(it)?.let(::of) }
                },
            )

        /**
         * [list] with [credits] added. A credit is its identifier and its exact text: Nautical's
         * and Bathymetry's NOAA credits share an identifier and differ in text, and both show.
         */
        fun merging(list: List<OfflineCredit>, credits: List<OfflineCredit>): List<OfflineCredit> {
            val result = list.toMutableList()
            for (credit in credits) {
                val index = result.indexOfFirst { it.id == credit.id && it.text == credit.text }
                if (index < 0) {
                    result += credit
                    continue
                }
                val current = result[index]
                val added = credit.regions.filter { it !in current.regions }
                result[index] = current.copy(regions = current.regions + added)
            }
            return result
        }
    }
}

/**
 * A notice of a stored release that maps show wherever its data is: one of a source's
 * `obligations`, or the source's `page`, which holds its full notices online.
 */
internal data class OfflineObligation(
    val id: String,
    val text: String,
    /** The page's address, for a source's page; null for an obligation. */
    val href: String? = null,
) {
    companion object {
        /** The obligations and then the page of each source of a download's attribution. */
        fun obligations(attribution: List<JSONObject>): List<OfflineObligation> {
            var result = emptyList<OfflineObligation>()
            for (source in attribution) {
                val items = mutableListOf<OfflineObligation>()
                val obligations = source.optJSONArray("obligations")
                for (index in 0 until (obligations?.length() ?: 0)) {
                    val value = obligations?.optJSONObject(index) ?: continue
                    val id = value.optString("id").takeIf { it.isNotEmpty() && it.length <= 192 }
                    val text =
                        value.optString("exact").takeIf { it.isNotEmpty() && it.length <= 65_536 }
                    if (id != null && text != null) items += OfflineObligation(id, text)
                }
                source.optJSONObject("page")?.let { page ->
                    val text = page.optString("exact")
                    val href = page.optString("href")
                    if (
                        text.isNotEmpty() &&
                            text.length <= 65_536 &&
                            href.startsWith("https://") &&
                            href.length <= 2048
                    )
                        items += OfflineObligation("page", text, href)
                }
                result = merging(result, items)
            }
            return result
        }

        /** [list] with [obligations] added, each exact text once. */
        fun merging(
            list: List<OfflineObligation>,
            obligations: List<OfflineObligation>,
        ): List<OfflineObligation> {
            val result = list.toMutableList()
            for (obligation in obligations)
                if (result.none { it.text == obligation.text }) result += obligation
            return result
        }
    }
}

/**
 * The credits a Map's stored releases ask its maps to show: obligations and pages always, regional
 * credits while one of their boxes is in view.
 */
internal data class OfflineSourceCredits(
    val regional: List<OfflineCredit> = emptyList(),
    val obligations: List<OfflineObligation> = emptyList(),
) {
    fun merging(other: OfflineSourceCredits): OfflineSourceCredits =
        OfflineSourceCredits(
            OfflineCredit.merging(regional, other.regional),
            OfflineObligation.merging(obligations, other.obligations),
        )

    companion object {
        fun of(attribution: List<JSONObject>): OfflineSourceCredits =
            OfflineSourceCredits(
                OfflineCredit.credits(attribution),
                OfflineObligation.obligations(attribution),
            )
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
    val covers: List<OfflineCover> = emptyList(),
    val anchors: Map<OfflineTileId, List<java.io.File>> = emptyMap(),
) {
    fun merging(other: OfflineServedTiles): OfflineServedTiles {
        val files = anchors.toMutableMap()
        for ((anchor, list) in other.anchors)
            files[anchor] = (files[anchor].orEmpty() + list).distinct()
        return copy(
            zooms = minOf(zooms.first, other.zooms.first)..maxOf(zooms.last, other.zooms.last),
            covers = (covers + other.covers).distinct(),
            anchors = files,
        )
    }

    /**
     * Whether the region downloaded [tile], stored or not, or a tile above the downloaded zooms
     * whose ancestor at the deepest one it downloaded.
     */
    fun covers(tile: OfflineTileId): Boolean {
        val held = if (tile.z > zooms.last) tile.ancestor(zooms.last) else tile
        return held.z in zooms && covers.any { it.contains(held) }
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

    /** [documents] by address with each percent-escape in upper case, built when first needed. */
    private val normalizedDocuments by lazy {
        documents.entries.associate { (url, entry) -> normalizedEscapes(url) to entry }
    }

    /**
     * The document stored for [url]. Addresses match exactly, except for the case of their
     * percent-escapes, which are equivalent: MapLibre Native writes a font stack's comma as `%2c`
     * where the service names the entry with `%2C`.
     */
    fun document(url: String): Pair<java.io.File, OfflinePackEntry>? =
        documents[url] ?: normalizedDocuments[normalizedEscapes(url)]

    companion object {
        private val escape = Regex("%[0-9A-Fa-f]{2}")

        /** [url] with the hexadecimal digits of every percent-escape in upper case. */
        fun normalizedEscapes(url: String): String =
            if ('%' !in url) url else escape.replace(url) { it.value.uppercase() }
    }
}

/**
 * What stored regions a map may use without a network: the cache paths of every available region's
 * resources, the packs of each Hosted Map and the credits of its releases (regional credits, and
 * obligations and pages), by the cache scope of the Map.
 */
internal data class OfflineServingSnapshot(
    val paths: Set<String> = emptySet(),
    val packs: Map<String, OfflineServedPacks> = emptyMap(),
    val credits: Map<String, List<OfflineCredit>> = emptyMap(),
    val obligations: Map<String, List<OfflineObligation>> = emptyMap(),
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
            val credits = HashMap<String, List<OfflineCredit>>()
            val obligations = HashMap<String, List<OfflineObligation>>()
            for (each in stores.values) {
                paths.addAll(each.paths)
                for ((scope, served) in each.packs)
                    packs[scope] = packs[scope]?.merging(served) ?: served
                for ((scope, list) in each.credits)
                    credits[scope] = OfflineCredit.merging(credits[scope].orEmpty(), list)
                for ((scope, list) in each.obligations)
                    obligations[scope] = OfflineObligation.merging(obligations[scope].orEmpty(), list)
            }
            merged = OfflineServingSnapshot(paths, packs, credits, obligations)
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
        packs.document(url)?.let { (file, entry) ->
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

    /**
     * The obligations and pages of the sources [scope]'s Map's stored regions hold, which its maps
     * show whatever they look at. Blocks a resource thread, as [snapshot] does.
     */
    fun obligations(scope: ResourceCacheScope): List<OfflineObligation> =
        snapshot().obligations[scope.directory].orEmpty()

    /**
     * The zooms the regions [scope]'s Map may use store for the source whose tile template is
     * [template], or null when none stores it. A map opened from its packs starts an elevation
     * source at the lowest of them, so the renderer never asks for ancestors no region holds.
     * Blocks a resource thread, as [snapshot] does.
     */
    fun storedZooms(scope: ResourceCacheScope, template: String): IntRange? =
        snapshot().packs[scope.directory]?.tiles?.get(template)?.zooms

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
