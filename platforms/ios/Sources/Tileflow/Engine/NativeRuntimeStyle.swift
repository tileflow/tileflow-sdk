import Foundation
import MapLibre

/// Application objects installed in each loaded native style. Inline data outlives its channel reference.
@MainActor
final class NativeRuntimeStyle {
  private struct Source {
    let id: String
    let shape: MLNShape
    let clustered: Bool

    func make() -> MLNShapeSource {
      MLNShapeSource(identifier: id, shape: shape, options: [.clustered: clustered])
    }
  }

  private struct Circle {
    let id: String
    let source: String
    let paint: [String: JSONValue]

    @MainActor func make(source: MLNSource) throws -> MLNCircleStyleLayer {
      let layer = MLNCircleStyleLayer(identifier: id, source: source)
      for (name, value) in paint {
        guard NativeStyleProperties.set(value, property: name, of: layer) else {
          throw TileflowMapError.invalidRequest
        }
      }
      return layer
    }
  }

  private var sources: [String: Source] = [:]
  private var circles: [Circle] = []

  private static func validateSource(_ spec: [String: JSONValue]) throws {
    guard spec["type"] == .string("geojson"),
      Set(spec.keys).isSubset(of: ["type", "data", "cluster"]),
      spec["cluster"] == nil || spec["cluster"]?.bool != nil
    else { throw TileflowMapError.invalidRequest }
  }

  private static func shape(_ bytes: Data) throws -> MLNShape {
    guard let shape = try? MLNShape(data: bytes, encoding: String.Encoding.utf8.rawValue) else {
      throw TileflowMapError.invalidRequest
    }
    return shape
  }

  /// A view can receive application data before the first style or renderer exists.
  static func validateQueuedSource(_ source: RuntimeStyle.Source) throws {
    try validateSource(source.spec)
    switch source.geoJSON?.base {
    case .bytes(let bytes, _): _ = try shape(bytes)
    case .empty: break
    default: throw TileflowMapError.invalidRequest
    }
  }

  static func circlePaint(_ json: JSONValue, hasSlot: Bool) throws -> [String: JSONValue] {
    guard case .object(let spec) = json, spec["type"] == .string("circle"), !hasSlot,
      Set(spec.keys).isSubset(of: ["id", "type", "source", "paint"]),
      case .object(let paint) = spec["paint"] ?? .object([:])
    else { throw TileflowMapError.invalidRequest }
    for (name, value) in paint {
      let valid: Bool
      switch name {
      case "circle-color", "circle-stroke-color":
        valid = value.string.flatMap(NativeEvaluators.parseColour) != nil
      case "circle-radius", "circle-stroke-width": valid = value.number.map { $0 >= 0 } ?? false
      case "circle-opacity", "circle-stroke-opacity", "circle-blur":
        valid = value.number.map { (0...1).contains($0) } ?? false
      default: valid = false
      }
      guard valid else { throw TileflowMapError.invalidRequest }
    }
    return paint
  }

  func addSource(_ request: JSONValue, channel: DataChannel, style: MLNStyle?) throws {
    guard let id = request["id"]?.string, case .object(let spec) = request["source"]
    else { throw TileflowMapError.invalidRequest }
    try Self.validateSource(spec)
    let bytes: Data
    if let ref = spec["data"]?["id"]?.string, let payload = channel.payload(ref) {
      bytes = payload.bytes
    } else if spec["data"]?["empty"]?.bool == true {
      bytes = Data(#"{"type":"FeatureCollection","features":[]}"#.utf8)
    } else {
      throw TileflowMapError.invalidRequest
    }

    let key = "__tileflow_source_" + id
    guard sources[key] == nil, style?.source(withIdentifier: key) == nil else {
      throw TileflowMapError.invalidRequest
    }
    let source = Source(
      id: key, shape: try Self.shape(bytes), clustered: spec["cluster"]?.bool ?? false)
    style?.addSource(source.make())
    sources[key] = source
  }

  func addLayer(_ request: JSONValue, style: MLNStyle?) throws {
    guard let spec = request["layer"], let id = spec["id"]?.string,
      let sourceID = spec["source"]?.string,
      let source = sources["__tileflow_source_" + sourceID]
    else { throw TileflowMapError.invalidRequest }
    let paint = try Self.circlePaint(spec, hasSlot: request["slot"] != nil)
    let circle = Circle(id: "__tileflow_layer_" + id, source: source.id, paint: paint)
    guard !circles.contains(where: { $0.id == circle.id }),
      style?.layer(withIdentifier: circle.id) == nil
    else { throw TileflowMapError.invalidRequest }
    let index: Int
    if let position = request["position"] {
      guard let relative = (position["above"] ?? position["below"])?.string,
        let at = circles.firstIndex(where: { $0.id == "__tileflow_layer_" + relative })
      else { throw TileflowMapError.invalidRequest }
      index = position["above"] != nil ? at + 1 : at
    } else {
      index = circles.count
    }

    let layer = try circle.make(source: style?.source(withIdentifier: source.id) ?? source.make())
    if let style {
      if index < circles.count, let next = style.layer(withIdentifier: circles[index].id) {
        style.insertLayer(layer, below: next)
      } else {
        style.addLayer(layer)
      }
    }
    circles.insert(circle, at: index)
  }

  func removeLayer(_ request: JSONValue, style: MLNStyle?) throws {
    guard let id = request["id"]?.string,
      let index = circles.firstIndex(where: { $0.id == "__tileflow_layer_" + id })
    else { throw TileflowMapError.invalidRequest }
    let circle = circles.remove(at: index)
    if let layer = style?.layer(withIdentifier: circle.id) { style?.removeLayer(layer) }
  }

  func removeSource(_ request: JSONValue, style: MLNStyle?) throws {
    guard let id = request["id"]?.string else { throw TileflowMapError.invalidRequest }
    let key = "__tileflow_source_" + id
    guard !circles.contains(where: { $0.source == key }), sources.removeValue(forKey: key) != nil
    else { throw TileflowMapError.invalidRequest }
    if let source = style?.source(withIdentifier: key) { style?.removeSource(source) }
  }

  func restore(in style: MLNStyle) throws {
    guard sources.keys.allSatisfy({ style.source(withIdentifier: $0) == nil }),
      circles.allSatisfy({ style.layer(withIdentifier: $0.id) == nil })
    else { throw TileflowMapError.invalidRequest }
    for source in sources.values { style.addSource(source.make()) }
    for circle in circles {
      guard let source = style.source(withIdentifier: circle.source) else {
        throw TileflowMapError.invalidRequest
      }
      style.addLayer(try circle.make(source: source))
    }
  }
}
