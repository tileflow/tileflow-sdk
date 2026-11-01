import Foundation

/// A GeoJSON region of a Hosted download. ``canonical(_:)`` gives the service's form: latitudes
/// clamped to the map's, positions rounded to six decimals and rings closed.
indirect enum OfflineRegionShape: Hashable, Sendable {
  case point(TileflowPosition)
  case multiPoint([TileflowPosition])
  case lineString([TileflowPosition])
  case multiLineString([[TileflowPosition]])
  /// Rings, the first the outline and the rest holes.
  case polygon([[TileflowPosition]])
  case multiPolygon([[[TileflowPosition]]])
  /// Geometries of any type but another collection.
  case geometryCollection([OfflineRegionShape])

  /// Positions in the whole region, closing positions included.
  static let maximumPositions = 256
  static let maximumRings = 16
  static let maximumGeometries = 64

  init(_ geometry: TileflowGeometry) {
    func position(_ coordinate: TileflowCoordinate) -> TileflowPosition {
      TileflowPosition(longitude: coordinate.longitude, latitude: coordinate.latitude)
    }
    switch geometry {
    case .point(let point): self = .point(position(point))
    case .multiPoint(let points): self = .multiPoint(points.map(position))
    case .lineString(let line): self = .lineString(line.map(position))
    case .multiLineString(let lines): self = .multiLineString(lines.map { $0.map(position) })
    case .polygon(let rings): self = .polygon(rings.map { $0.map(position) })
    case .multiPolygon(let polygons):
      self = .multiPolygon(polygons.map { $0.map { $0.map(position) } })
    }
  }

  /// The service's canonical form of `shape`, or the reason the service would refuse it.
  static func canonical(_ shape: OfflineRegionShape) throws -> OfflineRegionShape {
    var count = 0
    func refuse(_ reason: String) -> TileflowOfflineError { .region(reason) }
    func path(_ positions: [TileflowPosition]) throws -> [TileflowPosition] {
      guard
        positions.allSatisfy({
          TileflowOfflineGeometry.isLongitude($0.longitude)
            && TileflowOfflineGeometry.isLatitude($0.latitude)
        })
      else { throw refuse("invalidPosition") }
      for index in positions.indices.dropFirst()
      where abs(positions[index].longitude - positions[index - 1].longitude) > 180 {
        throw refuse("crossesAntimeridian")
      }
      count += positions.count
      return positions.map {
        TileflowPosition(
          longitude: OfflinePackRegion.round($0.longitude),
          latitude: OfflinePackRegion.round(TileflowOfflineGeometry.clamped($0.latitude)))
      }
    }
    func line(_ positions: [TileflowPosition]) throws -> [TileflowPosition] {
      guard positions.count >= 2 else { throw refuse("tooFewPositions") }
      return try path(positions)
    }
    func ring(_ positions: [TileflowPosition]) throws -> [TileflowPosition] {
      guard let first = positions.first, let last = positions.last else {
        throw refuse("tooFewPositions")
      }
      var ring = try path(positions)
      // An open ring is closed, as GeoJSON requires.
      if ring.first != ring.last {
        guard abs(last.longitude - first.longitude) <= 180 else {
          throw refuse("crossesAntimeridian")
        }
        ring.append(ring[0])
        count += 1
      }
      guard ring.count >= 4 else { throw refuse("tooFewPositions") }
      guard !OfflinePackRegion.isCollinear(ring) else { throw refuse("emptyArea") }
      return ring
    }
    func polygon(_ rings: [[TileflowPosition]]) throws -> [[TileflowPosition]] {
      guard !rings.isEmpty else { throw refuse("tooFewPositions") }
      guard rings.count <= maximumRings else { throw refuse("tooManyRings") }
      return try rings.map(ring)
    }
    func parts<T>(_ parts: [T], _ part: (T) throws -> T) throws -> [T] {
      guard !parts.isEmpty else { throw refuse("tooFewPositions") }
      return try parts.map(part)
    }
    func single(_ shape: OfflineRegionShape) throws -> OfflineRegionShape {
      switch shape {
      case .point(let point): return .point(try path([point])[0])
      case .multiPoint(let points): return .multiPoint(try parts(points) { try path([$0])[0] })
      case .lineString(let positions): return .lineString(try line(positions))
      case .multiLineString(let lines): return .multiLineString(try parts(lines, line))
      case .polygon(let rings): return .polygon(try polygon(rings))
      case .multiPolygon(let polygons):
        guard polygons.count <= maximumGeometries else { throw refuse("tooManyGeometries") }
        return .multiPolygon(try parts(polygons, polygon))
      case .geometryCollection: throw refuse("nestedCollection")
      }
    }
    let result: OfflineRegionShape
    if case .geometryCollection(let geometries) = shape {
      guard geometries.count <= maximumGeometries else { throw refuse("tooManyGeometries") }
      result = .geometryCollection(try parts(geometries, single))
    } else {
      result = try single(shape)
    }
    guard count <= maximumPositions else { throw refuse("tooManyPositions") }
    return result
  }

  /// The parts the cover follows: each polygon on its own, so overlapping polygons form a union.
  var parts: [OfflineCoverPart] {
    switch self {
    case .point(let point): return [OfflineCoverPart(paths: [[point]], isFilled: false)]
    case .multiPoint(let points):
      return [OfflineCoverPart(paths: points.map { [$0] }, isFilled: false)]
    case .lineString(let line): return [OfflineCoverPart(paths: [line], isFilled: false)]
    case .multiLineString(let lines): return [OfflineCoverPart(paths: lines, isFilled: false)]
    case .polygon(let rings): return [OfflineCoverPart(paths: rings, isFilled: true)]
    case .multiPolygon(let polygons):
      return polygons.map { OfflineCoverPart(paths: $0, isFilled: true) }
    case .geometryCollection(let geometries): return geometries.flatMap(\.parts)
    }
  }

  /// The GeoJSON object: only `type` and `coordinates`, or `geometries` for a collection.
  var json: JSONValue {
    func position(_ position: TileflowPosition) -> JSONValue {
      .array([.number(position.longitude), .number(position.latitude)])
    }
    func line(_ positions: [TileflowPosition]) -> JSONValue { .array(positions.map(position)) }
    func lines(_ lines: [[TileflowPosition]]) -> JSONValue { .array(lines.map(line)) }
    let (type, coordinates): (String, JSONValue)
    switch self {
    case .point(let point): (type, coordinates) = ("Point", position(point))
    case .multiPoint(let points): (type, coordinates) = ("MultiPoint", line(points))
    case .lineString(let positions): (type, coordinates) = ("LineString", line(positions))
    case .multiLineString(let paths): (type, coordinates) = ("MultiLineString", lines(paths))
    case .polygon(let rings): (type, coordinates) = ("Polygon", lines(rings))
    case .multiPolygon(let polygons):
      (type, coordinates) = ("MultiPolygon", .array(polygons.map(lines)))
    case .geometryCollection(let geometries):
      return .object([
        "type": .string("GeometryCollection"), "geometries": .array(geometries.map(\.json)),
      ])
    }
    return .object(["type": .string(type), "coordinates": coordinates])
  }

  /// The region the service returns, read strictly: no members beyond the geometry's own, and
  /// two numbers per position.
  init?(json value: JSONValue?) {
    guard case .object(let object) = value, object.count == 2, let type = object["type"]?.string
    else { return nil }
    func position(_ value: JSONValue) -> TileflowPosition? {
      guard case .array(let items) = value, items.count == 2, let longitude = items[0].number,
        let latitude = items[1].number
      else { return nil }
      return TileflowPosition(longitude: longitude, latitude: latitude)
    }
    func list<T>(_ value: JSONValue?, _ item: (JSONValue) -> T?) -> [T]? {
      guard case .array(let items) = value else { return nil }
      let mapped = items.compactMap(item)
      return mapped.count == items.count ? mapped : nil
    }
    let coordinates = object["coordinates"]
    switch type {
    case "Point":
      guard let point = coordinates.flatMap(position) else { return nil }
      self = .point(point)
    case "MultiPoint":
      guard let points = list(coordinates, position) else { return nil }
      self = .multiPoint(points)
    case "LineString":
      guard let line = list(coordinates, position) else { return nil }
      self = .lineString(line)
    case "MultiLineString":
      guard let lines = list(coordinates, { list($0, position) }) else { return nil }
      self = .multiLineString(lines)
    case "Polygon":
      guard let rings = list(coordinates, { list($0, position) }) else { return nil }
      self = .polygon(rings)
    case "MultiPolygon":
      guard let polygons = list(coordinates, { list($0, { list($0, position) }) }) else {
        return nil
      }
      self = .multiPolygon(polygons)
    case "GeometryCollection":
      guard let geometries = list(object["geometries"], { OfflineRegionShape(json: $0) }) else {
        return nil
      }
      self = .geometryCollection(geometries)
    default:
      return nil
    }
  }
}
