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
      data["type"]?.string == "FeatureCollection", case .array(let features) = data["features"],
      features.count <= 2000
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
