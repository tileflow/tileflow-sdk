import Foundation

/// The area of an offline region, in WGS84 positions.
///
/// Like the geometry of Mapbox's tile region load options, it describes the area only; zooms and
/// content are chosen separately. A region covers the same tiles at every zoom as the Hosted pack
/// that downloads it: a tile belongs to the region when the region's outline passes through it or
/// the middle of its row lies inside the region, with outlines drawn as straight lines on the Web
/// Mercator map. Latitudes beyond ±85.051129°, which the map cannot show, are clamped.
public enum TileflowOfflineGeometry: Sendable, Hashable {
  /// A box between two meridians and two parallels. A box whose west edge is greater than its
  /// east edge crosses the antimeridian, as in GeoJSON, and downloads as two packs.
  case boundingBox(TileflowBoundingBox)
  /// One ring of 3 to 255 distinct positions, open or closed, without holes. A ring that crosses
  /// itself covers the areas an even number of its edges enclose, as GeoJSON renderers draw it.
  case polygon([TileflowPosition])
  /// The area within half of `width` metres of a line, such as a route. The line has 2 to 10,000
  /// positions and `width` is 1 to 100,000 metres. A Hosted corridor downloads as one pack for each
  /// stretch whose convex outline stays close to the corridor, so a winding line covers somewhat
  /// more than the corridor itself.
  case corridor(line: [TileflowPosition], width: Double)

  /// Checks the geometry without planning it.
  ///
  /// - Throws: ``TileflowOfflineError`` with code `invalidRegion` and one of these reasons:
  ///   `invalidPosition` (not finite, or beyond ±180° or ±90°), `tooFewPositions`,
  ///   `tooManyPositions`, `emptyArea`, `crossesAntimeridian` (consecutive positions more than
  ///   180° of longitude apart; split the region) or `invalidWidth`.
  public func validate() throws {
    _ = try packRegions()
  }

  /// The number of tiles the region covers at `zoom`, 0 to 22: the tiles a pack of every source
  /// at that zoom would list if each source stored all of them.
  public func tileCount(zoom: Int) throws -> Int {
    guard (0...OfflineZooms.maximum).contains(zoom) else {
      throw TileflowOfflineError.options("invalidZoom")
    }
    return OfflineTileCover.count(try packRegions(), zoom: zoom)
  }

  /// The number of tiles the region covers over a range of zooms.
  public func tileCount(zoomRange: ClosedRange<Int>) throws -> Int {
    try zoomRange.reduce(0) { $0 + (try tileCount(zoom: $1)) }
  }

  /// The canonical regions of the packs that download this geometry.
  func packRegions() throws -> [OfflinePackRegion] {
    switch self {
    case .boundingBox(let box):
      guard [box.west, box.east].allSatisfy(Self.isLongitude),
        [box.south, box.north].allSatisfy(Self.isLatitude)
      else { throw TileflowOfflineError.region("invalidPosition") }
      let south = Self.clamped(box.south)
      let north = Self.clamped(box.north)
      let spans: [(Double, Double)] =
        box.west <= box.east ? [(box.west, box.east)] : [(box.west, 180), (-180, box.east)]
      let regions = spans.compactMap { OfflinePackRegion.canonical($0.0, south, $0.1, north) }
      guard !regions.isEmpty else { throw TileflowOfflineError.region("emptyArea") }
      return regions
    case .polygon(let positions):
      var ring = try Self.validated(positions)
      if ring.count > 1, ring.first == ring.last { ring.removeLast() }
      guard ring.count >= 3 else { throw TileflowOfflineError.region("tooFewPositions") }
      guard ring.count < OfflinePackRegion.positions.upperBound else {
        throw TileflowOfflineError.region("tooManyPositions")
      }
      guard let region = OfflinePackRegion.canonical(ring + [ring[0]]) else {
        throw TileflowOfflineError.region("emptyArea")
      }
      return [region]
    case .corridor(let line, let width):
      guard width.isFinite, OfflineCorridor.widths.contains(width) else {
        throw TileflowOfflineError.region("invalidWidth")
      }
      guard line.count <= OfflineCorridor.maximumPositions else {
        throw TileflowOfflineError.region("tooManyPositions")
      }
      let valid = try Self.validated(line)
      let distinct = valid.indices.filter { $0 == 0 || valid[$0 - 1] != valid[$0] }.map {
        valid[$0]
      }
      guard distinct.count >= 2 else { throw TileflowOfflineError.region("tooFewPositions") }
      let regions = OfflineCorridor.regions(line: distinct, width: width)
      guard !regions.isEmpty else { throw TileflowOfflineError.region("emptyArea") }
      return regions
    }
  }

  private static func validated(_ positions: [TileflowPosition]) throws -> [TileflowPosition] {
    guard positions.allSatisfy({ isLongitude($0.longitude) && isLatitude($0.latitude) }) else {
      throw TileflowOfflineError.region("invalidPosition")
    }
    for index in positions.indices.dropFirst()
    where abs(positions[index].longitude - positions[index - 1].longitude) > 180 {
      throw TileflowOfflineError.region("crossesAntimeridian")
    }
    return positions.map {
      TileflowPosition(longitude: $0.longitude, latitude: clamped($0.latitude))
    }
  }

  private static func isLongitude(_ value: Double) -> Bool { value.isFinite && abs(value) <= 180 }
  private static func isLatitude(_ value: Double) -> Bool { value.isFinite && abs(value) <= 90 }
  private static func clamped(_ latitude: Double) -> Double {
    min(max(latitude, -OfflinePackRegion.maximumLatitude), OfflinePackRegion.maximumLatitude)
  }
}
