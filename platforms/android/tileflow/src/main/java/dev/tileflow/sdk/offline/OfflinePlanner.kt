package dev.tileflow.sdk.offline

import dev.tileflow.sdk.TileflowErrorContext
import java.net.URI

/** One resource a region needs. */
internal data class OfflineResource(
    val url: URI,
    /** Exact bytes on the wire, when known before download. */
    val bytes: Long?,
    /** Lowercase hexadecimal SHA-256, when known before download. A tile's hash is its `ETag`. */
    val sha256: String?,
    val billable: Boolean,
    /** Fetched without the pack grant. */
    val isPublic: Boolean,
)

/**
 * What downloading a region costs, after Mapbox's tile region estimates: resources, bytes and, for
 * Hosted content, the map views it is billed.
 *
 * @property resourceCount Every resource of the region, including free public ones. A self-hosted
 *   estimate counts tiles only: the style's sprites and glyphs are known once the style is read.
 * @property billableResourceCount Resources counted toward map views and the plan's limits.
 * @property publicResourceCount Free public resources, such as landmarks, which count toward
 *   nothing.
 * @property bytes Exact bytes on the wire for Hosted content; null when sizes are unknown.
 * @property tileCounts Tiles per source: those each source stores in the region for Hosted
 *   content, and the region's cover for a self-hosted source.
 * @property mapViews Map views the download is billed: one per started 1,000 billable resources
 *   the device does not hold yet, per pack. Resources already stored are revalidated for free.
 */
public data class TileflowOfflineRegionEstimate(
    public val resourceCount: Long,
    public val billableResourceCount: Long,
    public val publicResourceCount: Long,
    public val bytes: Long?,
    public val tileCounts: Map<String, Long>,
    public val mapViews: Long,
)

/** Plans a region from a Hosted manifest or from self-hosted sources. */
internal object OfflinePlanner {
    /** Billable resources per map view. */
    const val RESOURCES_PER_MAP_VIEW = 1_000L

    /** The pack's resources, documents first, then each source's tiles. Built as it is iterated. */
    fun resources(manifest: OfflinePackManifest): Sequence<OfflineResource> =
        manifest.documents.asSequence().map {
            OfflineResource(it.url, it.bytes, it.sha256, it.billable, it.isPublic)
        } +
            manifest.tiles.asSequence().flatMap { set ->
                set.entries.asSequence().map {
                    OfflineResource(set.url(it), it.bytes, null, billable = true, isPublic = false)
                }
            }

    /**
     * The estimate of a created pack. [isStored] names resources the device already holds, which an
     * update revalidates for free instead of downloading again.
     */
    fun estimate(
        manifest: OfflinePackManifest,
        isStored: (URI) -> Boolean = { false },
    ): TileflowOfflineRegionEstimate {
        val counts = mutableMapOf<String, Long>()
        for (set in manifest.tiles)
            counts[set.source] = (counts[set.source] ?: 0) + set.entries.size
        val newBillable = newBillableResources(manifest, isStored)
        return TileflowOfflineRegionEstimate(
            resourceCount = manifest.resourceCount,
            billableResourceCount = manifest.billableResourceCount,
            publicResourceCount = manifest.documents.count { it.isPublic }.toLong(),
            bytes = manifest.bytes,
            tileCounts = counts,
            mapViews = (newBillable + RESOURCES_PER_MAP_VIEW - 1) / RESOURCES_PER_MAP_VIEW,
        )
    }

    /** Billable resources of the pack the device does not hold yet. */
    fun newBillableResources(manifest: OfflinePackManifest, isStored: (URI) -> Boolean): Long =
        resources(manifest).count { it.billable && !isStored(it.url) }.toLong()

    /**
     * A source a self-hosted style uses, with its own zooms and, optionally, a deepest zoom to
     * download, as a terrain source might stop before its deepest zoom.
     */
    data class SelfHostedSource(
        val id: String,
        val minZoom: Int,
        val maxZoom: Int,
        val maximumDownloadZoom: Int? = null,
    )

    /**
     * The estimate of a self-hosted region: every tile of the cover at each source's zooms. Bytes
     * stay unknown, since a TileJSON does not list tile sizes, and nothing is billed.
     */
    fun estimate(
        geometry: TileflowOfflineGeometry,
        zooms: OfflineZooms,
        sources: List<SelfHostedSource>,
    ): TileflowOfflineRegionEstimate {
        val regions = geometry.packRegions()
        val cover = mutableMapOf<Int, Long>()
        val counts = mutableMapOf<String, Long>()
        for (source in sources) {
            if (
                source.minZoom !in 0..OfflineZooms.MAXIMUM ||
                    source.maxZoom !in source.minZoom..OfflineZooms.MAXIMUM ||
                    (source.maximumDownloadZoom ?: source.maxZoom) !in
                        source.minZoom..OfflineZooms.MAXIMUM
            )
                throw TileflowOfflineException.options("invalidSourceZoom")
            counts.putIfAbsent(source.id, 0)
            val deepest = minOf(source.maxZoom, source.maximumDownloadZoom ?: source.maxZoom)
            val range = zooms.zooms(source.minZoom, deepest) ?: continue
            for (zoom in range) {
                val tiles = cover.getOrPut(zoom) { OfflineTileCover.count(regions, zoom) }
                counts[source.id] = counts.getValue(source.id) + tiles
            }
        }
        return TileflowOfflineRegionEstimate(
            resourceCount = counts.values.sum(),
            billableResourceCount = 0,
            publicResourceCount = 0,
            bytes = null,
            tileCounts = counts,
            mapViews = 0,
        )
    }
}

/**
 * The per-device limit on billable Hosted resources. The service limits each pack to the plan's
 * limit; the device's total is the SDK's to keep.
 */
internal object OfflineDeviceLimit {
    /**
     * Accepts a download unless it would leave the device holding more than [limit] billable
     * resources. [deviceTotal] is what the device holds now, [adding] what the download stores that
     * it does not hold yet and [releasing] what the download makes unneeded, such as the previous
     * version of the pack it updates. A download that does not grow the total is accepted even
     * above the limit, so a lower limit never stops updates.
     */
    fun check(deviceTotal: Long, adding: Long, releasing: Long = 0, limit: Long) {
        if (deviceTotal < 0 || adding < 0 || releasing !in 0..deviceTotal || limit < 1)
            throw TileflowOfflineException.options("invalidDeviceTotal")
        val total = deviceTotal - releasing + adding
        if (total > limit && total > deviceTotal)
            throw TileflowOfflineException(
                TileflowOfflineErrorCode.DEVICE_LIMIT_EXCEEDED,
                TileflowErrorContext(limit = limit.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()),
            )
    }
}
