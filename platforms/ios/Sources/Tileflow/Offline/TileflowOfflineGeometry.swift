import Foundation

/// The area of an offline region, in WGS84 positions.
///
/// Like the geometry of Mapbox's tile region load options, it describes the area only, and zooms
/// and content are chosen separately; it takes any GeoJSON geometry, a box or a corridor, with no
/// limit on its positions. As Mapbox computes tile regions, the SDK turns a Hosted region into the
/// list of tile packs it needs, which is what it sends: one download whose tiles at every zoom are
/// the union of the tiles each of its parts touches, counted once. A point covers the tile it lies in, a line every tile it passes
/// through, and a polygon every tile one of its rings passes through or whose row's middle lies
/// inside it, holes excluded. Lines and rings are straight on the Web Mercator map, and tile bounds
/// are closed: a position on a tile's top or bottom edge touches the tiles on both sides of it.
/// Latitudes beyond ±85.051129°, which the map cannot show, are clamped.
public enum TileflowOfflineGeometry: Sendable, Hashable {
  /// A box between two meridians and two parallels. A box whose west edge is greater than its
  /// east edge crosses the antimeridian, as in GeoJSON, and covers both sides.
  case boundingBox(TileflowBoundingBox)
  /// A GeoJSON geometry, as Mapbox's tile region load options take: a point, a line or a polygon,
  /// or their multi-part forms. A polygon's first ring is its outline and the others are holes;
  /// rings may be open or closed. A ring that crosses itself covers the areas an even number of
  /// its edges enclose, as GeoJSON renderers draw it. Parts may overlap.
  ///
  /// No line or ring may cross the antimeridian: give each side as its own part.
  case geometry(TileflowGeometry)
  /// A GeoJSON geometry collection.
  case geometryCollection([TileflowGeometry])
  /// The area within half of `width` metres of a line, such as a route. The line has 2 to 10,000
  /// positions and `width` is 1 to 100,000 metres. It covers the convex outlines of consecutive
  /// stretches that stay close to the corridor, so a winding line covers somewhat more than the
  /// corridor itself.
  case corridor(line: [TileflowPosition], width: Double)

  /// A GeoJSON geometry object, such as `{"type": "Polygon", "coordinates": […]}`, or a
  /// geometry collection. Altitudes are not kept.
  ///
  /// - Throws: ``TileflowOfflineError`` with code `invalidRegion` and reason `invalidGeoJSON`
  ///   when the text is not a GeoJSON geometry, or is a collection inside another.
  public init(geoJSON: String) throws {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(geoJSON.utf8)),
      let geometry = Self(geoJSON: value)
    else { throw TileflowOfflineError.region("invalidGeoJSON") }
    self = geometry
  }

  init?(geoJSON value: JSONValue) {
    if value["type"]?.string == "GeometryCollection" {
      guard case .array(let items) = value["geometries"] else { return nil }
      let geometries = items.compactMap(TileflowGeometry.init)
      guard geometries.count == items.count else { return nil }
      self = .geometryCollection(geometries)
    } else {
      guard let geometry = TileflowGeometry(value) else { return nil }
      self = .geometry(geometry)
    }
  }

  /// The GeoJSON object of a geometry or a collection; nil for a box or a corridor.
  var geoJSON: JSONValue? {
    switch self {
    case .geometry(let geometry): geometry.wireValue
    case .geometryCollection(let geometries):
      .object([
        "type": .string("GeometryCollection"), "geometries": .array(geometries.map(\.wireValue)),
      ])
    case .boundingBox, .corridor: nil
    }
  }

  /// Checks the geometry without planning it.
  ///
  /// - Throws: ``TileflowOfflineError`` with code `invalidRegion` and one of these reasons:
  ///   `invalidPosition` (not finite, or beyond ±180° or ±90°), `tooFewPositions`,
  ///   `tooManyPositions` (a corridor's line), `emptyArea` (a ring whose positions all lie on one
  ///   line), `crossesAntimeridian` (consecutive positions more than 180° of longitude apart; split
  ///   the region) or `invalidWidth`. A Hosted region too large to list as packs is
  ///   `regionTooComplex` when it is loaded or estimated.
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

  /// The canonical parts whose tiles together form the region's cover.
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
    case .geometry(let geometry):
      return [.geometry(try OfflineRegionShape.canonical(OfflineRegionShape(geometry)))]
    case .geometryCollection(let geometries):
      let shape = OfflineRegionShape.geometryCollection(geometries.map(OfflineRegionShape.init))
      return [.geometry(try OfflineRegionShape.canonical(shape))]
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

  static func isLongitude(_ value: Double) -> Bool { value.isFinite && abs(value) <= 180 }
  static func isLatitude(_ value: Double) -> Bool { value.isFinite && abs(value) <= 90 }
  static func clamped(_ latitude: Double) -> Double {
    min(max(latitude, -OfflinePackRegion.maximumLatitude), OfflinePackRegion.maximumLatitude)
  }
}
