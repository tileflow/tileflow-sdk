package dev.tileflow.sdk.offline

import java.util.concurrent.atomic.AtomicReference

/** What an offline region holds. */
public sealed class TileflowOfflineContent {
    /**
     * Themes of a Hosted Map, downloaded as Hosted offline packs with the configured map
     * credential. A single-style Map's theme is `default`.
     */
    public data class Hosted(public val mapId: String, public val themes: List<String>) :
        TileflowOfflineContent()

    /**
     * A map of a versioned manifest you serve, as a map source names it: the manifest, every
     * theme's style with the fonts, sprites, glyph ranges and source documents it references, and
     * the tiles of [sources] inside the region. Nothing is billed, and sizes are known only once
     * downloaded.
     */
    public data class Manifest(
        public val url: String,
        public val map: String,
        public val sources: List<TileflowOfflineTileSource>,
    ) : TileflowOfflineContent()
}

/**
 * A self-hosted tile source to download with its style.
 *
 * @property id The source's name in the style.
 * @property template The tile URL template with `{z}`, `{x}` and `{y}`, exactly as the style
 *   requests tiles.
 * @property minZoom The source's own zooms. Deeper region zooms overzoom its deepest tiles.
 */
public data class TileflowOfflineTileSource
@JvmOverloads
constructor(
    public val id: String,
    public val template: String,
    public val minZoom: Int = 0,
    public val maxZoom: Int,
)

/** The networks a download may use. */
public enum class TileflowOfflineNetworkRestriction {
    /** Any network. */
    NONE,

    /** Only unmetered networks, such as Wi-Fi. The download waits on metered networks. */
    DISALLOW_EXPENSIVE,
}

/**
 * What a region downloads, after Mapbox's tile region load options: the area, the content and the
 * zooms.
 *
 * Hosted World tiles stop at zoom 15, their deepest; deeper zooms add only sources that go deeper,
 * such as Team Tilesets. Terrain stops at [terrainMaxZoom], 12 unless a region opts in to 13 or 14,
 * which hold most of a pack's bytes.
 *
 * @property metadata Application data kept with the region, such as a display name.
 */
public data class TileflowOfflineRegionLoadOptions
@JvmOverloads
constructor(
    public val geometry: TileflowOfflineGeometry,
    public val content: TileflowOfflineContent,
    public val minZoom: Int = 0,
    public val maxZoom: Int = 15,
    public val terrainMaxZoom: Int = 12,
    public val networkRestriction: TileflowOfflineNetworkRestriction =
        TileflowOfflineNetworkRestriction.NONE,
    public val metadata: Map<String, String> = emptyMap(),
) {
    internal val zooms: OfflineZooms
        get() {
            if (minZoom > maxZoom) throw TileflowOfflineException.options("invalidZoom")
            return OfflineZooms(minZoom..maxZoom, terrainMaxZoom)
        }
}

/**
 * A downloaded or downloading region, after Mapbox's tile regions.
 *
 * A region is usable offline once a download completes: [isAvailable] stays true while a later
 * update downloads, and the stored version is replaced only when the update is complete and
 * verified. Access ending never removes what the device holds.
 *
 * @property options The options of the version downloading, or else of the stored version.
 * @property isAvailable A complete version is stored and maps use it without a network. False
 *   once access to a Hosted region ended ([UpdateState.NotUpdatable]): its files stay on the
 *   device, and maps stop using them.
 * @property requiredResourceBytes Bytes on the wire; null for self-hosted content until it is
 *   downloaded.
 * @property loadedResourceCount Resources the download received from the network, after Mapbox's
 *   loaded resource count: of the version downloading, or else of the stored version. Resources
 *   found stored already or unchanged (`304`) are completed without being loaded.
 * @property loadedResourceBytes Bytes on the wire of the loaded resources.
 * @property billableResourceCount Resources counted toward the plan's per-device limit.
 * @property error Why the download failed or waits.
 * @property retryAtMillis When a waiting download continues, when the service asked for a wait.
 * @property completedAtMillis When the stored version completed.
 * @property updateState Null until a Hosted region is first checked, and for self-hosted content.
 */
public data class TileflowOfflineRegion(
    public val id: String,
    public val options: TileflowOfflineRegionLoadOptions,
    public val state: DownloadState,
    public val isAvailable: Boolean,
    public val requiredResourceCount: Long,
    public val completedResourceCount: Long,
    public val requiredResourceBytes: Long?,
    public val completedResourceBytes: Long,
    public val loadedResourceCount: Long,
    public val loadedResourceBytes: Long,
    public val billableResourceCount: Long,
    public val error: TileflowOfflineException?,
    public val retryAtMillis: Long?,
    public val completedAtMillis: Long?,
    public val updateState: UpdateState?,
    public val checkedAtMillis: Long?,
) {
    public enum class DownloadState {
        /** Resources are downloading. */
        DOWNLOADING,

        /**
         * The download continues by itself: when the network returns, when an allowed network is
         * available or at [retryAtMillis].
         */
        WAITING,

        /** Paused by the application. [TileflowOfflineStore.resumeRegion] continues it. */
        PAUSED,

        /** Stopped by [error]. Resuming tries again. */
        FAILED,

        /** Every resource is stored and verified. */
        COMPLETE,
    }

    /** What the last check found for a Hosted region. */
    public sealed class UpdateState {
        /** Nothing changed. */
        public object Current : UpdateState()

        /** The Map changed. Loading the region again downloads only what changed. */
        public object UpdateAvailable : UpdateState()

        /**
         * Access ended, for the service's [reason], such as `credential_revoked` or
         * `map_unavailable`. The region stays on the device as it is and is no longer updated.
         */
        public data class NotUpdatable(public val reason: String) : UpdateState()
    }
}

/** A change to the store's regions. */
public sealed class TileflowOfflineRegionEvent {
    /** A region was created, progressed or changed state. */
    public data class Changed(public val region: TileflowOfflineRegion) :
        TileflowOfflineRegionEvent()

    public data class Removed(public val id: String) : TileflowOfflineRegionEvent()
}

/** A subscription to region events. Cancelling it stops the events. */
public class TileflowOfflineSubscription internal constructor(onCancel: () -> Unit) {
    private val onCancel = AtomicReference<(() -> Unit)?>(onCancel)

    public fun cancel() {
        onCancel.getAndSet(null)?.invoke()
    }
}
