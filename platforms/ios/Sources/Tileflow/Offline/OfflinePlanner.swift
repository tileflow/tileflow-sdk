import Foundation

/// What downloading a region costs, after Mapbox's tile region estimates: packs, resources, bytes
/// and, for Hosted content, the map views it is billed.
public struct TileflowOfflineRegionEstimate: Sendable, Hashable {
  /// Hosted packs: a source's tiles under one anchor tile, or the styles, assets and glyphs.
  public let packCount: Int
  /// Every resource of the region, including free public ones. A self-hosted estimate counts
  /// tiles only: the style's sprites and glyphs are known once the style is read.
  public let resourceCount: Int
  /// Resources counted toward map views and the plan's limits.
  public let billableResourceCount: Int
  /// Free public resources, such as landmarks, which count toward nothing.
  public let publicResourceCount: Int
  /// Exact bytes to transfer for Hosted content, which is also what the region stores; nil when
  /// sizes are unknown.
  public let bytes: Int?
  /// Tiles per source: those each source stores in the region for Hosted content, and the
  /// region's cover for a self-hosted source.
  public let tileCounts: [String: Int]
  /// Map views the download is billed: one per started 1,000 billable resources of the packs the
  /// device does not hold yet, per download. Packs already stored are kept or revalidated for free.
  public let mapViews: Int
}

/// Plans a region's estimate.
enum OfflinePlanner {
  /// Billable resources per map view.
  static let resourcesPerMapView = 1_000

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
      packCount: 0, resourceCount: tiles, billableResourceCount: 0, publicResourceCount: 0,
      bytes: nil, tileCounts: counts, mapViews: 0)
  }
}

/// The per-device limit on billable Hosted resources. The service limits each download to the
/// plan's limit; the device's total is the SDK's to keep.
enum OfflineDeviceLimit {
  /// Accepts a download unless it would leave the device holding more than `limit` billable
  /// resources. `deviceTotal` is what the device holds now, `adding` what the download stores
  /// that it does not hold yet and `releasing` what the download makes unneeded, such as the
  /// previous version of the region it updates. A download that does not grow the total is
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
