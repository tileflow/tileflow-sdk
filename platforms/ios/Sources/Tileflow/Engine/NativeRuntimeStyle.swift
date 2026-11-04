import Foundation
import MapLibre
import TileflowStyleBridge
import UIKit

/// The application's style objects, kept across MapLibre's replacement of the base style.
@MainActor
final class NativeRuntimeStyle {
  static func sourceID(_ id: String) -> String { "__tileflow_source_" + id }
  static func layerID(_ id: String) -> String { "__tileflow_layer_" + id }

  struct Source {
    let id: String
    var spec: [String: JSONValue]
    var features: FeatureIndex?
    var shape: MLNShape?
    var resourceKinds: [(prefix: String, kind: TileflowResourceKind)] = []
  }

  struct Layer {
    let id: String
    let json: JSONValue
    var slot: TileflowLayerSlot?
  }

  struct Image {
    let base: UIImage
    let variants: [String: UIImage]
  }

  var sources: [String: Source] = [:]
  var layers: [Layer] = []
  var images: [String: Image] = [:]
  var states: [String: [String: [String: JSONValue]]] = [:]

  struct StateTarget: Hashable {
    let source: String
    let layer: String
    let feature: String
  }
  var pendingState: Set<StateTarget> = []
  var stateRetriedLastFrame: Set<StateTarget> = []
  var theme: String?
  private var anchors: [String: String]?

  func configure(theme: String?, metadata: [String: Any]?) {
    self.theme = theme
    let manifest = metadata?["tileflow:overlay-placement-manifest"] as? [String: Any]
    anchors = (manifest?["anchors"] as? [String: Any])?.compactMapValues { $0 as? String }
  }

  func beforeLayer(_ layer: Layer, in style: MLNStyle) -> MLNStyleLayer? {
    // Missing manifest means all non-top slots share the first label as their anchor.
    func anchor(_ slot: TileflowLayerSlot?) -> MLNStyleLayer? {
      guard let slot else { return nil }
      if let anchors { return anchors[slot.rawValue].flatMap(style.layer(withIdentifier:)) }
      return slot == .aboveLabels
        ? nil
        : style.layers.first {
          $0 is MLNSymbolStyleLayer && !$0.identifier.hasPrefix("__tileflow_layer_")
        }
    }
    func rank(_ slot: TileflowLayerSlot?) -> Int {
      slot.flatMap { TileflowLayerSlot.allCases.firstIndex(of: $0) }
        ?? TileflowLayerSlot.allCases.count
    }
    let sorted = layers.enumerated().sorted {
      (rank($0.element.slot), $0.offset) < (rank($1.element.slot), $1.offset)
    }.map(\.element)
    let authored = anchor(layer.slot)
    if let index = sorted.firstIndex(where: { $0.id == layer.id }) {
      for next in sorted.dropFirst(index + 1)
      where anchor(next.slot)?.identifier == authored?.identifier {
        if let installed = style.layer(withIdentifier: Self.layerID(next.id)) { return installed }
      }
    }
    return authored
  }

  func setImages(_ request: JSONValue, channel: DataChannel, style: MLNStyle?) throws {
    guard let entries = request["images"]?.array else { throw TileflowMapError.invalidRequest }
    var next: [String: Image] = [:]
    for entry in entries {
      guard let name = entry["name"]?.string, next[name] == nil else {
        throw TileflowMapError.invalidRequest
      }
      let ratio = entry["pixelRatio"]?.number ?? 1
      let sdf = entry["sdf"]?.bool == true
      func decode(_ ref: JSONValue?) throws -> UIImage {
        guard let id = ref?["id"]?.string, let data = channel.payload(id),
          let image = UIImage(data: data.bytes, scale: CGFloat(ratio))
        else { throw TileflowMapError.invalidRequest }
        return image.withRenderingMode(sdf ? .alwaysTemplate : .alwaysOriginal)
      }
      let variants: [String: UIImage]
      if case .object(let refs) = entry["variants"] {
        variants = try refs.mapValues(decode)
      } else {
        variants = [:]
      }
      next[name] = try Image(base: decode(entry["data"]), variants: variants)
    }
    if let style {
      for name in images.keys where next[name] == nil { style.removeImage(forName: name) }
      for (name, image) in next {
        style.setImage(theme.flatMap { image.variants[$0] } ?? image.base, forName: name)
      }
    }
    images = next
  }

  func restore(in style: MLNStyle) throws {
    guard sources.keys.allSatisfy({ style.source(withIdentifier: Self.sourceID($0)) == nil }),
      layers.allSatisfy({ style.layer(withIdentifier: Self.layerID($0.id)) == nil })
    else { throw TileflowMapError.invalidRequest }
    for item in sources.values { style.addSource(try Self.makeSource(item)) }
    for (name, image) in images {
      style.setImage(theme.flatMap { image.variants[$0] } ?? image.base, forName: name)
    }
    for layer in layers { try install(layer, in: style) }
    for (target, features) in states {
      let parts = target.components(separatedBy: "\n")
      for (id, state) in features {
        try applyState(
          sourceID: parts[0], sourceLayer: parts[1], feature: id, values: state, in: style)
      }
    }
  }
}
