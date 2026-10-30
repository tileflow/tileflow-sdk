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

/// An application-owned GeoJSON FeatureCollection drawn as one layer.
///
/// The GeoJSON travels to the renderer over the SDK's data channel rather than in a message, up to
/// 32 MiB per layer and 64 MiB per update. The renderer validates it against RFC 7946 (without
/// GeometryCollection or foreign members, with closed rings and positions within range); invalid
/// GeoJSON makes ``TileflowMapView/setContent(annotations:layers:)`` fail with
/// ``TileflowMapError/invalidRequest`` and the reason `invalidGeoJSON`, leaving the content as it
/// was.
public struct TileflowGeoJSONLayer: Sendable {
  public let id: String
  public let kind: TileflowGeoJSONLayerKind
  public let color: String
  public let size: Double
  public let opacity: Double
  /// A route ink of the theme on screen, drawn instead of ``color`` and following theme changes
  /// and blends.
  public let ink: TileflowRouteInk?
  public let placement: TileflowLayerPlacement
  /// For a line on the ground: how much of it shows where 3D content hides it, from 0 to 1.
  public let occludedOpacity: Double
  /// For a line: the stretch of it that shows. ``TileflowMapView/animateLineProgress(layers:to:duration:)``
  /// moves it.
  public internal(set) var progress: TileflowLineProgress?
  let geoJSON: Data
  /// Identifies the data, so layers that share it, or keep it across updates, send it once.
  let digest: String

  /// - Parameters:
  ///   - ink: Draws the layer in a route ink of the theme on screen instead of `color`; the glow
  ///     and core inks also take the theme's opacity for them.
  ///   - placement: `.top` draws above the whole map; `.ground` lies under its labels and 3D
  ///     content.
  ///   - occludedOpacity: For a line on the ground, how much shows where buildings hide it.
  ///   - progress: For a line, draws only a stretch of it, with an optional head and light.
  public init(
    id: String, geoJSON: Data, kind: TileflowGeoJSONLayerKind,
    color: String = "#e9573f", size: Double = 6, opacity: Double = 1,
    ink: TileflowRouteInk? = nil, placement: TileflowLayerPlacement = .top,
    occludedOpacity: Double = 0, progress: TileflowLineProgress? = nil
  ) throws {
    guard HostedContract.matches(id, #"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"#),
      HostedContract.matches(color, #"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"#),
      (0...64).contains(size), (0...1).contains(opacity), (0...1).contains(occludedOpacity),
      progress == nil || kind == .line,
      occludedOpacity == 0 || (kind == .line && placement == .ground)
    else { throw TileflowMapError.invalidRequest }
    try progress?.validate()
    guard !geoJSON.isEmpty, geoJSON.count <= ProtocolContract.maximumDataBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataBytes)
    }
    self.id = id
    self.kind = kind
    self.color = color
    self.size = size
    self.opacity = opacity
    self.ink = ink
    self.placement = placement
    self.occludedOpacity = occludedOpacity
    self.progress = progress
    self.geoJSON = geoJSON
    self.digest = DataChannel.digest(geoJSON)
  }

  func wireValue(data: DataChannel.Reference) -> JSONValue {
    var value: [String: JSONValue] = [
      "id": .string(id), "data": data.wireValue, "kind": .string(kind.rawValue),
      "color": .string(color), "size": .number(size), "opacity": .number(opacity),
      "placement": .string(placement.rawValue), "occludedOpacity": .number(occludedOpacity),
    ]
    if let ink { value["ink"] = .string(ink.rawValue) }
    if let progress { value["progress"] = progress.wireValue }
    return .object(value)
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

  func validate() throws {
    guard annotations.count <= 128, overlays.count <= 16,
      Set(annotations.map(\.id)).count == annotations.count,
      Set(overlays.map(\.id)).count == overlays.count
    else { throw TileflowMapError.invalidRequest }
    for annotation in annotations { _ = try annotation.wireValue() }
    var total = 0
    for (_, layer) in Dictionary(overlays.map { ($0.digest, $0) }, uniquingKeysWith: { a, _ in a })
    {
      total += layer.geoJSON.count
    }
    guard total <= ProtocolContract.maximumDataTotalBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataTotalBytes)
    }
  }

  /// The command payload, with each distinct layer's GeoJSON registered on the data channel. The
  /// caller releases the references when the request settles.
  @MainActor
  func wireValue(data channel: DataChannel) throws -> (JSONValue, [DataChannel.Reference]) {
    try validate()
    let annotations = try annotations.map { try $0.wireValue() }
    var references: [DataChannel.Reference] = []
    do {
      let overlays = try overlays.map { layer in
        let reference = try channel.register(
          layer.geoJSON, digest: layer.digest, contentType: "application/geo+json")
        references.append(reference)
        return layer.wireValue(data: reference)
      }
      return (
        .object(["annotations": .array(annotations), "overlays": .array(overlays)]), references
      )
    } catch {
      channel.release(references)
      throw error
    }
  }
}
