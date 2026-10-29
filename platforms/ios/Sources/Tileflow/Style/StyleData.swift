import Foundation
import UIKit

/// A JSON value, such as a feature property.
public enum TileflowJSON: Sendable, Equatable, ExpressibleByStringLiteral,
  ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral,
  ExpressibleByNilLiteral
{
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([TileflowJSON])
  case object([String: TileflowJSON])

  public init(stringLiteral value: String) { self = .string(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(nilLiteral: ()) { self = .null }

  init(_ value: JSONValue) {
    switch value {
    case .null: self = .null
    case .bool(let value): self = .bool(value)
    case .number(let value): self = .number(value)
    case .string(let value): self = .string(value)
    case .array(let value): self = .array(value.map(TileflowJSON.init))
    case .object(let value): self = .object(value.mapValues(TileflowJSON.init))
    }
  }

  var wireValue: JSONValue {
    switch self {
    case .null: .null
    case .bool(let value): .bool(value)
    case .number(let value): .number(value)
    case .string(let value): .string(value)
    case .array(let value): .array(value.map(\.wireValue))
    case .object(let value): .object(value.mapValues(\.wireValue))
    }
  }

  public var string: String? {
    guard case .string(let value) = self else { return nil }
    return value
  }
  public var number: Double? {
    guard case .number(let value) = self else { return nil }
    return value
  }
  public var bool: Bool? {
    guard case .bool(let value) = self else { return nil }
    return value
  }
}

/// A GeoJSON geometry, with positions as coordinates; altitudes are not kept.
public enum TileflowGeometry: Sendable, Equatable {
  case point(TileflowCoordinate)
  case multiPoint([TileflowCoordinate])
  case lineString([TileflowCoordinate])
  case multiLineString([[TileflowCoordinate]])
  /// Rings, the first outer and the rest holes, each closed.
  case polygon([[TileflowCoordinate]])
  case multiPolygon([[[TileflowCoordinate]]])

  init?(_ value: JSONValue) {
    func position(_ value: JSONValue) -> TileflowCoordinate? {
      guard case .array(let items) = value, items.count >= 2, let longitude = items[0].number,
        let latitude = items[1].number
      else { return nil }
      return TileflowCoordinate(longitude: longitude, latitude: latitude)
    }
    func list<T>(_ value: JSONValue?, _ item: (JSONValue) -> T?) -> [T]? {
      guard case .array(let items) = value else { return nil }
      let mapped = items.compactMap(item)
      return mapped.count == items.count ? mapped : nil
    }
    let coordinates = value["coordinates"]
    switch value["type"]?.string {
    case "Point": guard let point = coordinates.flatMap(position) else { return nil }
      self = .point(point)
    case "MultiPoint": guard let points = list(coordinates, position) else { return nil }
      self = .multiPoint(points)
    case "LineString": guard let line = list(coordinates, position) else { return nil }
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
    default: return nil
    }
  }

  var wireValue: JSONValue {
    func position(_ coordinate: TileflowCoordinate) -> JSONValue {
      .array([.number(coordinate.longitude), .number(coordinate.latitude)])
    }
    func line(_ line: [TileflowCoordinate]) -> JSONValue { .array(line.map(position)) }
    func rings(_ rings: [[TileflowCoordinate]]) -> JSONValue { .array(rings.map(line)) }
    let (type, coordinates): (String, JSONValue) =
      switch self {
      case .point(let point): ("Point", position(point))
      case .multiPoint(let points): ("MultiPoint", line(points))
      case .lineString(let points): ("LineString", line(points))
      case .multiLineString(let lines): ("MultiLineString", rings(lines))
      case .polygon(let polygon): ("Polygon", rings(polygon))
      case .multiPolygon(let polygons): ("MultiPolygon", .array(polygons.map(rings)))
      }
    return .object(["type": .string(type), "coordinates": coordinates])
  }
}

/// A GeoJSON feature. An identifier that is a whole number, such as `"42"`, travels as a number,
/// which the map needs to keep feature state for it; other identifiers need the source's
/// `promoteId`.
public struct TileflowFeature: Sendable, Equatable {
  public var id: String?
  public var geometry: TileflowGeometry?
  public var properties: [String: TileflowJSON]

  public init(
    id: String? = nil, geometry: TileflowGeometry?, properties: [String: TileflowJSON] = [:]
  ) {
    self.id = id
    self.geometry = geometry
    self.properties = properties
  }

  init(wire value: JSONValue) {
    switch value["id"] {
    case .number(let number): id = TileflowFeature.text(number)
    case .string(let text): id = text
    default: id = nil
    }
    geometry = value["geometry"].flatMap(TileflowGeometry.init)
    if case .object(let properties) = value["properties"] {
      self.properties = properties.mapValues(TileflowJSON.init)
    } else {
      properties = [:]
    }
  }

  static func text(_ number: Double) -> String {
    number.rounded() == number && abs(number) < 1e15 ? String(Int64(number)) : String(number)
  }

  /// A whole number travels as a number.
  static func wireID(_ id: String) -> JSONValue {
    if HostedContract.matches(id, #"^(0|[1-9][0-9]{0,14})$"#), let number = Double(id) {
      return .number(number)
    }
    return .string(id)
  }

  var wireValue: JSONValue {
    var value: [String: JSONValue] = [
      "type": .string("Feature"), "geometry": geometry?.wireValue ?? .null,
      "properties": .object(properties.mapValues(\.wireValue)),
    ]
    if let id { value["id"] = Self.wireID(id) }
    return .object(value)
  }

  /// For a cluster of a clustering source: the identifier its cluster queries take.
  public var clusterID: Int? {
    properties["cluster_id"]?.number.flatMap { Int(exactly: $0) }
  }
}

/// A feature a query found, with where it came from and its state.
public struct TileflowQueriedFeature: Sendable, Equatable {
  public let feature: TileflowFeature
  /// The application source; nil for a feature of the map's own style.
  public let source: String?
  public let sourceLayer: String?
  /// The application layer that drew it, for rendered features.
  public let layer: String?
  public let state: [String: TileflowStyleValue]

  init(wire value: JSONValue) {
    feature = TileflowFeature(wire: value)
    source = value["source"]?.string
    sourceLayer = value["sourceLayer"]?.string
    layer = value["layer"]?.string
    if case .object(let state) = value["state"] {
      self.state = state.compactMapValues(TileflowStyleValue.init(wire:))
    } else {
      state = [:]
    }
  }
}

extension TileflowStyleValue {
  init?(wire value: JSONValue) {
    switch value {
    case .bool(let value): self = .bool(value)
    case .number(let value): self = .number(value)
    case .string(let value): self = .string(value)
    case .null: self = .null
    default: return nil
    }
  }
}

/// The part of the view a rendered query reads, in points of the view.
public enum TileflowQueryGeometry: Sendable, Equatable {
  case point(CGPoint)
  case box(CGRect)
  /// At least three points; the polygon closes itself.
  case polygon([CGPoint])
  /// The whole view.
  case view

  func wireValue() throws -> JSONValue? {
    func point(_ point: CGPoint) throws -> JSONValue {
      try TileflowMapView.validate(point)
      return .object(["x": .number(point.x), "y": .number(point.y)])
    }
    switch self {
    case .point(let value): return .object(["point": try point(value)])
    case .box(let rect):
      return .object([
        "box": .array([
          try point(CGPoint(x: rect.minX, y: rect.minY)),
          try point(CGPoint(x: rect.maxX, y: rect.maxY)),
        ])
      ])
    case .polygon(let points):
      guard (3...1024).contains(points.count) else { throw TileflowMapError.invalidRequest }
      return .object(["polygon": .array(try points.map(point))])
    case .view: return nil
    }
  }
}

/// Which rendered features a query returns.
public struct TileflowRenderedQueryOptions: Sendable, Equatable {
  /// Application layers to read; nil reads every application layer.
  public var layerIds: [String]?
  public var filter: TileflowExpression?
  /// At most this many features, up to 100,000.
  public var limit: Int

  public init(layerIds: [String]? = nil, filter: TileflowExpression? = nil, limit: Int = 1000) {
    self.layerIds = layerIds
    self.filter = filter
    self.limit = limit
  }
}

/// Which features of a source a query returns, whether or not they are drawn.
public struct TileflowSourceQueryOptions: Sendable, Equatable {
  /// For a vector source, the layers to read.
  public var sourceLayerIds: [String]?
  public var filter: TileflowExpression?
  /// At most this many features, up to 100,000.
  public var limit: Int

  public init(
    sourceLayerIds: [String]? = nil, filter: TileflowExpression? = nil, limit: Int = 1000
  ) {
    self.sourceLayerIds = sourceLayerIds
    self.filter = filter
    self.limit = limit
  }
}

/// A source of the application's runtime style: ``TileflowGeoJSONSource``,
/// ``TileflowVectorSource``, ``TileflowRasterSource``, ``TileflowRasterDEMSource`` or
/// ``TileflowImageSource``. Addresses go through the SDK's transport, so their origins must be
/// among the map source's `resourceOrigins`.
public protocol TileflowSource: Sendable {
  var id: String { get }
}

/// The data of a GeoJSON source.
public enum TileflowGeoJSONData: Sendable, Equatable {
  /// A GeoJSON FeatureCollection, sent over the SDK's data channel (up to 32 MiB).
  case geoJSON(Data)
  case features([TileflowFeature])
  /// GeoJSON the map loads itself.
  case url(URL)
  /// No features yet.
  case empty
}

/// GeoJSON, inline or by address, optionally clustered. MapLibre source type `geojson`.
public struct TileflowGeoJSONSource: TileflowSource, Equatable {
  public var id: String
  public var data: TileflowGeoJSONData
  public var maxZoom: Double?
  public var attribution: String?
  /// Tile buffer on each side, from 0 to 512.
  public var buffer: Int?
  /// Simplification tolerance; higher is simpler and faster.
  public var tolerance: Double?
  /// Draws only the features this expression accepts.
  public var filter: TileflowExpression?
  /// Groups nearby points into clusters, which carry `point_count` and `cluster_id`.
  public var cluster: Bool
  /// Cluster radius in pixels.
  public var clusterRadius: Double?
  /// The zoom level up to which points cluster.
  public var clusterMaxZoom: Double?
  public var clusterMinPoints: Int?
  /// Aggregates of clustered points, as MapLibre's `clusterProperties`: for example
  /// `["total": .sum(.get("count"))]` adds each point's `count` into a cluster's `total`.
  public var clusterProperties: [String: TileflowExpression]
  /// Measures distance along lines, for `line-progress` and `lineGradient`.
  public var lineMetrics: Bool
  /// Numbers features that have no identifier.
  public var generateId: Bool
  /// A property whose value identifies each feature, for feature state and updates.
  public var promoteId: String?

  public init(
    id: String, data: TileflowGeoJSONData, cluster: Bool = false,
    clusterRadius: Double? = nil, clusterMaxZoom: Double? = nil,
    clusterProperties: [String: TileflowExpression] = [:], promoteId: String? = nil
  ) {
    self.id = id
    self.data = data
    self.cluster = cluster
    self.clusterRadius = clusterRadius
    self.clusterMaxZoom = clusterMaxZoom
    self.clusterProperties = clusterProperties
    self.lineMetrics = false
    self.generateId = false
    self.promoteId = promoteId
  }
}

/// How a tiled source names its tiles.
public enum TileflowTiles: Sendable, Equatable {
  /// A TileJSON document.
  case tileJSON(URL)
  /// Tile address templates with `{z}`, `{x}` and `{y}`.
  case templates([String])
}

/// Vector tiles. MapLibre source type `vector`.
public struct TileflowVectorSource: TileflowSource, Equatable {
  public var id: String
  public var tiles: TileflowTiles
  public var minZoom: Double?
  public var maxZoom: Double?
  public var bounds: TileflowBounds?
  public var attribution: String?
  /// A property whose value identifies each feature, for feature state.
  public var promoteId: String?

  public init(id: String, tiles: TileflowTiles) {
    self.id = id
    self.tiles = tiles
  }
}

/// Raster tiles, such as imagery. MapLibre source type `raster`.
public struct TileflowRasterSource: TileflowSource, Equatable {
  public var id: String
  public var tiles: TileflowTiles
  /// Tile size in pixels; 512 by default.
  public var tileSize: Int?
  public var minZoom: Double?
  public var maxZoom: Double?
  public var bounds: TileflowBounds?
  public var attribution: String?

  public init(id: String, tiles: TileflowTiles, tileSize: Int? = nil) {
    self.id = id
    self.tiles = tiles
    self.tileSize = tileSize
  }
}

/// Elevation tiles for hillshade and colour relief layers. MapLibre source type `raster-dem`.
public struct TileflowRasterDEMSource: TileflowSource, Equatable {
  public enum Encoding: String, Sendable, Equatable { case mapbox, terrarium, custom }
  public var id: String
  public var tiles: TileflowTiles
  public var tileSize: Int?
  public var encoding: Encoding?
  public var minZoom: Double?
  public var maxZoom: Double?
  public var bounds: TileflowBounds?
  public var attribution: String?

  public init(id: String, tiles: TileflowTiles, encoding: Encoding? = nil) {
    self.id = id
    self.tiles = tiles
    self.encoding = encoding
  }
}

/// An image laid on the map by its corners. MapLibre source type `image`.
public struct TileflowImageSource: TileflowSource, Equatable {
  public var id: String
  public var url: URL
  /// Top left, top right, bottom right and bottom left.
  public var coordinates: [TileflowCoordinate]

  public init(id: String, url: URL, coordinates: [TileflowCoordinate]) {
    self.id = id
    self.url = url
    self.coordinates = coordinates
  }
}
