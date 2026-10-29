import Foundation

/// One resource a region needs.
struct OfflineResource: Sendable, Hashable {
  let url: URL
  /// Exact bytes on the wire, when known before download.
  let bytes: Int?
  /// Lowercase hexadecimal SHA-256, when known before download. A tile's hash is its `ETag`.
  let sha256: String?
  let billable: Bool
  /// Fetched without the pack grant.
  let isPublic: Bool
}

/// What downloading a region costs, after Mapbox's tile region estimates: resources, bytes and,
/// for Hosted packs, the map views it is billed.
struct TileflowOfflineRegionEstimate: Sendable, Hashable {
  /// Every resource of the region, including free public ones.
  let resourceCount: Int
  /// Resources counted toward map views and the plan's limits.
  let billableResourceCount: Int
  /// Free public resources, such as landmarks, which count toward nothing.
  let publicResourceCount: Int
  /// Exact bytes on the wire for a Hosted pack; nil when a source does not expose its sizes.
  let bytes: Int?
  /// Tiles per source, the tiles each source stores in the region for a Hosted pack and the
  /// region's cover for a self-hosted source.
  let tileCounts: [String: Int]
  /// Map views a complete download is billed: one per started 1,000 billable resources. An update
  /// is billed only for the resources that changed.
  let mapViews: Int
}

/// Plans a region from a Hosted manifest or from self-hosted sources.
enum OfflinePlanner {
  /// Billable resources per map view.
  static let resourcesPerMapView = 1_000

  /// The pack's resources, documents first, then each source's tiles. Built as it is iterated.
  static func resources(_ manifest: OfflinePackManifest) -> some Sequence<OfflineResource> {
    let documents = manifest.documents.lazy.map {
      OfflineResource(
        url: $0.url, bytes: $0.bytes, sha256: $0.sha256, billable: $0.billable,
        isPublic: $0.isPublic)
    }
    let tiles = manifest.tiles.lazy.flatMap { set in
      set.entries.lazy.compactMap { tile in
        set.url(tile).map {
          OfflineResource(url: $0, bytes: tile.bytes, sha256: nil, billable: true, isPublic: false)
        }
      }
    }
    return [AnySequence(documents), AnySequence(tiles)].joined()
  }

  /// The estimate of a created pack. `isStored` names resources the device already holds, which
  /// an update revalidates for free instead of downloading again.
  static func estimate(
    _ manifest: OfflinePackManifest, isStored: (URL) -> Bool = { _ in false }
  ) -> TileflowOfflineRegionEstimate {
    var counts: [String: Int] = [:]
    for set in manifest.tiles { counts[set.source, default: 0] += set.entries.count }
    let newBillable = newBillableResources(manifest, isStored: isStored)
    return TileflowOfflineRegionEstimate(
      resourceCount: manifest.resourceCount,
      billableResourceCount: manifest.billableResourceCount,
      publicResourceCount: manifest.documents.filter(\.isPublic).count,
      bytes: manifest.bytes, tileCounts: counts,
      mapViews: (newBillable + resourcesPerMapView - 1) / resourcesPerMapView)
  }

  /// Billable resources of the pack the device does not hold yet.
  static func newBillableResources(
    _ manifest: OfflinePackManifest, isStored: (URL) -> Bool
  ) -> Int {
    resources(manifest).reduce(0) { $0 + ($1.billable && !isStored($1.url) ? 1 : 0) }
  }

  /// A source a self-hosted style uses, with its own zooms and, optionally, a deepest zoom to
  /// download, as a terrain source might stop before its deepest zoom.
  struct SelfHostedSource: Sendable, Hashable {
    let id: String
    let minZoom: Int
    let maxZoom: Int
    var maximumDownloadZoom: Int?
  }

  /// The estimate of a self-hosted region: every tile of the cover at each source's zooms. Bytes
  /// stay unknown, since a TileJSON does not list tile sizes, and nothing is billed.
  static func estimate(
    geometry: TileflowOfflineGeometry, zooms: OfflineZooms, sources: [SelfHostedSource]
  ) throws -> TileflowOfflineRegionEstimate {
    let regions = try geometry.packRegions()
    var cover: [Int: Int] = [:]
    var counts: [String: Int] = [:]
    for source in sources {
      guard (0...OfflineZooms.maximum).contains(source.minZoom),
        (source.minZoom...OfflineZooms.maximum).contains(source.maxZoom),
        (source.minZoom...OfflineZooms.maximum).contains(
          source.maximumDownloadZoom ?? source.maxZoom)
      else { throw TileflowOfflineError.options("invalidSourceZoom") }
      counts[source.id] = counts[source.id] ?? 0
      let deepest = min(source.maxZoom, source.maximumDownloadZoom ?? source.maxZoom)
      guard let range = zooms.zooms(sourceMinimum: source.minZoom, sourceMaximum: deepest) else {
        continue
      }
      for zoom in range {
        if cover[zoom] == nil { cover[zoom] = OfflineTileCover.count(regions, zoom: zoom) }
        counts[source.id, default: 0] += cover[zoom]!
      }
    }
    let tiles = counts.values.reduce(0, +)
    return TileflowOfflineRegionEstimate(
      resourceCount: tiles, billableResourceCount: 0, publicResourceCount: 0, bytes: nil,
      tileCounts: counts, mapViews: 0)
  }
}

/// The per-device limit on billable Hosted resources. The service limits each pack to the plan's
/// limit; the device's total is the SDK's to keep.
enum OfflineDeviceLimit {
  /// Accepts a download unless it would leave the device holding more than `limit` billable
  /// resources. `deviceTotal` is what the device holds now, `adding` what the download stores
  /// that it does not hold yet and `releasing` what the download makes unneeded, such as the
  /// previous version of the pack it updates. A download that does not grow the total is
  /// accepted even above the limit, so a lower limit never stops updates.
  static func check(deviceTotal: Int, adding: Int, releasing: Int = 0, limit: Int) throws {
    guard deviceTotal >= 0, adding >= 0, (0...deviceTotal).contains(releasing), limit >= 1 else {
      throw TileflowOfflineError.options("invalidDeviceTotal")
    }
    let total = deviceTotal - releasing + adding
    guard total <= limit || total <= deviceTotal else {
      throw TileflowOfflineError(.deviceLimitExceeded, context: .init(limit: limit))
    }
  }
}
