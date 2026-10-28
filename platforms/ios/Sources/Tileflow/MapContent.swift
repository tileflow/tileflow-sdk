import Foundation

public struct TileflowAnnotation: Equatable, Sendable {
  public var id: String
  public var coordinate: TileflowCoordinate
  public var title: String
  public var color: String

  public init(id: String, coordinate: TileflowCoordinate, title: String, color: String = "#e9573f")
  {
    self.id = id
    self.coordinate = coordinate
    self.title = title
    self.color = color
  }
  func wireValue() throws -> JSONValue {
    guard HostedContract.matches(id, #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"#),
      !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, title.count <= 256,
      (-180...180).contains(coordinate.longitude), (-90...90).contains(coordinate.latitude),
      HostedContract.matches(color, #"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"#)
    else { throw TileflowMapError.invalidRequest }
    return .object([
      "id": .string(id), "kind": .string("marker"), "ariaLabel": .string(title),
      "coordinate": .array([.number(coordinate.longitude), .number(coordinate.latitude)]),
      "marker": .object(["color": .string(color)]),
    ])
  }
}

public enum TileflowGeoJSONLayerKind: String, Sendable { case circle, line, fill }

/// An application-owned GeoJSON FeatureCollection. Updates are bounded by the native protocol.
public struct TileflowGeoJSONLayer: Sendable {
  public let id: String
  public let kind: TileflowGeoJSONLayerKind
  public let color: String
  public let size: Double
  public let opacity: Double
  private let data: JSONValue

  public init(
    id: String, geoJSON: Data, kind: TileflowGeoJSONLayerKind,
    color: String = "#e9573f", size: Double = 6, opacity: Double = 1
  ) throws {
    guard HostedContract.matches(id, #"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"#),
      geoJSON.count <= 49_152,
      HostedContract.matches(color, #"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"#),
      (0...64).contains(size), (0...1).contains(opacity),
      let data = try? JSONDecoder().decode(JSONValue.self, from: geoJSON),
      GeoJSONContract.isFeatureCollection(data)
    else { throw TileflowMapError.invalidRequest }
    self.id = id
    self.kind = kind
    self.color = color
    self.size = size
    self.opacity = opacity
    self.data = data
  }
  func wireValue() -> JSONValue {
    .object([
      "id": .string(id), "data": data, "kind": .string(kind.rawValue), "color": .string(color),
      "size": .number(size), "opacity": .number(opacity),
    ])
  }
}

public struct TileflowPoiSelection: Decodable, Sendable {
  public let id: String?
  public let coordinate: TileflowCoordinate
  public let name: String?
  public let category: String
}

struct MapContent: Sendable {
  var annotations: [TileflowAnnotation] = []
  var overlays: [TileflowGeoJSONLayer] = []
  func wireValue() throws -> JSONValue {
    guard annotations.count <= 128, overlays.count <= 16,
      Set(annotations.map(\.id)).count == annotations.count,
      Set(overlays.map(\.id)).count == overlays.count
    else { throw TileflowMapError.invalidRequest }
    let value = JSONValue.object([
      "annotations": .array(try annotations.map { try $0.wireValue() }),
      "overlays": .array(overlays.map { $0.wireValue() }),
    ])
    guard try JSONEncoder().encode(value).count <= 60_000 else {
      throw TileflowMapError.invalidRequest
    }
    return value
  }
}

/// The renderer's GeoJSON contract, checked before content crosses the bridge so invalid content
/// fails at the call instead of in the renderer.
enum GeoJSONContract {
  static func isFeatureCollection(_ value: JSONValue) -> Bool {
    guard case .object(let object) = value, object["type"]?.string == "FeatureCollection",
      Set(object.keys).isSubset(of: ["type", "features", "bbox"]), isBoundingBox(object["bbox"]),
      case .array(let features) = object["features"], features.count <= 2000
    else { return false }
    return features.allSatisfy(isFeature)
  }

  private static func isFeature(_ value: JSONValue) -> Bool {
    guard case .object(let object) = value, object["type"]?.string == "Feature",
      Set(object.keys).isSubset(of: ["type", "id", "geometry", "properties", "bbox"]),
      isBoundingBox(object["bbox"]), let geometry = object["geometry"],
      let properties = object["properties"]
    else { return false }
    switch object["id"] {
    case nil: break
    case .string(let id)?: guard id.utf16.count <= 128 else { return false }
    case .number(let id)?:
      guard id.rounded(.towardZero) == id, abs(id) <= 9_007_199_254_740_991 else { return false }
    default: return false
    }
    switch properties {
    case .null: break
    case .object(let values):
      guard values.allSatisfy({ $0.key.utf16.count <= 128 && depth($0.value) <= 64 }) else {
        return false
      }
    default: return false
    }
    if case .null = geometry { return true }
    return isGeometry(geometry)
  }

  private static func isGeometry(_ value: JSONValue) -> Bool {
    guard case .object(let object) = value,
      Set(object.keys).isSubset(of: ["type", "coordinates", "bbox"]),
      isBoundingBox(object["bbox"]), let coordinates = object["coordinates"]
    else { return false }
    switch object["type"]?.string {
    case "Point": return isPosition(coordinates)
    case "MultiPoint": return items(coordinates, 0...2000).map { $0.allSatisfy(isPosition) } == true
    case "LineString": return isLine(coordinates)
    case "MultiLineString": return items(coordinates, 0...128).map { $0.allSatisfy(isLine) } == true
    case "Polygon": return isPolygon(coordinates)
    case "MultiPolygon":
      return items(coordinates, 0...128).map { $0.allSatisfy(isPolygon) } == true
    default: return false
    }
  }

  private static func isPosition(_ value: JSONValue) -> Bool {
    guard let values = items(value, 2...3) else { return false }
    let numbers = values.compactMap(\.number)
    return numbers.count == values.count && numbers.allSatisfy(\.isFinite)
      && (-180...180).contains(numbers[0]) && (-90...90).contains(numbers[1])
  }
  private static func isLine(_ value: JSONValue) -> Bool {
    items(value, 2...4000).map { $0.allSatisfy(isPosition) } == true
  }
  private static func isRing(_ value: JSONValue) -> Bool {
    guard let positions = items(value, 4...4000), positions.allSatisfy(isPosition) else {
      return false
    }
    return positions.first.flatMap { items($0, 2...3) }?.map(\.number)
      == positions.last.flatMap { items($0, 2...3) }?.map(\.number)
  }
  private static func isPolygon(_ value: JSONValue) -> Bool {
    items(value, 1...128).map { $0.allSatisfy(isRing) } == true
  }
  private static func isBoundingBox(_ value: JSONValue?) -> Bool {
    guard let value else { return true }
    guard case .array(let values) = value, [4, 6].contains(values.count) else { return false }
    return values.allSatisfy { $0.number?.isFinite == true }
  }
  private static func items(_ value: JSONValue, _ count: ClosedRange<Int>) -> [JSONValue]? {
    guard case .array(let values) = value, count.contains(values.count) else { return nil }
    return values
  }
  private static func depth(_ value: JSONValue) -> Int {
    switch value {
    case .array(let values): 1 + (values.map(depth).max() ?? 0)
    case .object(let values): 1 + (values.values.map(depth).max() ?? 0)
    default: 0
    }
  }
}
