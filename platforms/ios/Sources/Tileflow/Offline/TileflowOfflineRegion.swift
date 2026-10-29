import Foundation

/// What an offline region holds.
public enum TileflowOfflineContent: Sendable, Hashable {
  /// Themes of a Hosted Map, downloaded as Hosted offline packs with the configured map
  /// credential. A single-style Map's theme is `default`.
  case hosted(mapID: String, themes: [String])
  /// A self-hosted style, the sprites and glyph ranges it references, and the tiles of `sources`
  /// inside the region. Nothing is billed, and sizes are known only once downloaded.
  case style(url: URL, sources: [TileflowOfflineTileSource])
}

/// A self-hosted tile source to download with its style.
public struct TileflowOfflineTileSource: Sendable, Hashable {
  /// The source's name in the style.
  public var id: String
  /// The tile URL template with `{z}`, `{x}` and `{y}`, exactly as the style requests tiles.
  public var template: String
  /// The source's own zooms. Deeper region zooms overzoom its deepest tiles.
  public var minZoom: Int
  public var maxZoom: Int

  public init(id: String, template: String, minZoom: Int = 0, maxZoom: Int) {
    self.id = id
    self.template = template
    self.minZoom = minZoom
    self.maxZoom = maxZoom
  }
}

/// The networks a download may use.
public enum TileflowOfflineNetworkRestriction: String, Sendable, Hashable {
  /// Any network.
  case none
  /// Only networks the system does not mark as expensive, such as Wi-Fi without a personal
  /// hotspot. The download waits on cellular networks.
  case disallowExpensive
}

/// What a region downloads, after Mapbox's tile region load options: the area, the content and
/// the zooms.
///
/// Hosted World tiles stop at zoom 15, their deepest; deeper zooms add only sources that go
/// deeper, such as Team Tilesets. Terrain stops at ``terrainMaxZoom``, 12 unless a region opts in
/// to 13 or 14, which hold most of a pack's bytes.
public struct TileflowOfflineRegionLoadOptions: Sendable, Hashable {
  public var geometry: TileflowOfflineGeometry
  public var content: TileflowOfflineContent
  public var minZoom: Int
  public var maxZoom: Int
  public var terrainMaxZoom: Int
  public var networkRestriction: TileflowOfflineNetworkRestriction
  /// Application data kept with the region, such as a display name.
  public var metadata: [String: String]

  public init(
    geometry: TileflowOfflineGeometry, content: TileflowOfflineContent, minZoom: Int = 0,
    maxZoom: Int = 15, terrainMaxZoom: Int = 12,
    networkRestriction: TileflowOfflineNetworkRestriction = .none, metadata: [String: String] = [:]
  ) {
    self.geometry = geometry
    self.content = content
    self.minZoom = minZoom
    self.maxZoom = maxZoom
    self.terrainMaxZoom = terrainMaxZoom
    self.networkRestriction = networkRestriction
    self.metadata = metadata
  }

  var zooms: OfflineZooms {
    get throws {
      guard minZoom <= maxZoom else { throw TileflowOfflineError.options("invalidZoom") }
      return try OfflineZooms(range: minZoom...maxZoom, terrainMaximum: terrainMaxZoom)
    }
  }
}

/// A downloaded or downloading region, after Mapbox's tile regions.
///
/// A region is usable offline once a download completes: ``isAvailable`` stays true while a later
/// update downloads, and the stored version is replaced only when the update is complete and
/// verified. Access ending never removes what the device holds.
public struct TileflowOfflineRegion: Sendable, Hashable, Identifiable {
  public enum DownloadState: String, Sendable, Hashable {
    /// Resources are downloading.
    case downloading
    /// The download continues by itself: when the network returns, when an allowed network is
    /// available or at ``TileflowOfflineRegion/retryDate``.
    case waiting
    /// Paused by the application. ``TileflowOfflineStore/resumeRegion(id:)`` continues it.
    case paused
    /// Stopped by ``TileflowOfflineRegion/error``. Resuming tries again.
    case failed
    /// Every resource is stored and verified.
    case complete
  }

  /// What the last check found for a Hosted region.
  public enum UpdateState: Sendable, Hashable {
    /// Nothing changed.
    case current
    /// The Map changed. Loading the region again downloads only what changed.
    case updateAvailable
    /// Access ended, for the service's `reason`, such as `credential_revoked` or
    /// `map_unavailable`. The region stays on the device as it is and is no longer updated.
    case notUpdatable(reason: String)
  }

  public let id: String
  /// The options of the version downloading, or else of the stored version.
  public let options: TileflowOfflineRegionLoadOptions
  public let state: DownloadState
  /// A complete version is stored.
  public let isAvailable: Bool
  public let requiredResourceCount: Int
  public let completedResourceCount: Int
  /// Bytes on the wire; nil for self-hosted content, whose sizes are unknown until downloaded.
  public let requiredResourceBytes: Int64?
  public let completedResourceBytes: Int64
  /// Resources counted toward the plan's per-device limit.
  public let billableResourceCount: Int
  /// Why the download failed or waits.
  public let error: TileflowOfflineError?
  /// When a waiting download continues, when the service asked for a wait.
  public let retryDate: Date?
  /// When the stored version completed.
  public let completedAt: Date?
  /// Nil until a Hosted region is first checked, and for self-hosted content.
  public let updateState: UpdateState?
  public let checkedAt: Date?
}

/// A change to the store's regions.
public enum TileflowOfflineRegionEvent: Sendable, Hashable {
  /// A region was created, progressed or changed state.
  case changed(TileflowOfflineRegion)
  case removed(id: String)
}

/// A subscription to region events. Cancelling it, or releasing it, stops the events.
public final class TileflowOfflineSubscription: Sendable {
  private let onCancel: LockedValue<(@Sendable () -> Void)?>

  init(_ onCancel: @escaping @Sendable () -> Void) {
    self.onCancel = LockedValue(onCancel)
  }

  deinit { cancel() }

  public func cancel() {
    let handler = onCancel.withLock { value in
      defer { value = nil }
      return value
    }
    handler?()
  }
}
