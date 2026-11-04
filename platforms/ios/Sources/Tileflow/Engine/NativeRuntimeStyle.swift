import Foundation
import MapLibre
import TileflowStyleBridge
import UIKit

/// The application's style objects, kept across MapLibre's replacement of the base style.
@MainActor
final class NativeRuntimeStyle {
  enum Namespace { case application, overlays, markers }
  private let namespace: Namespace
  init(_ namespace: Namespace = .application) { self.namespace = namespace }

  func sourceID(_ id: String) -> String {
    switch namespace {
    case .application: "__tileflow_source_" + id
    case .overlays: "__tileflow_app_" + id
    case .markers: "__tileflow_depth_" + id
    }
  }
  func layerID(_ id: String) -> String {
    namespace == .application ? "__tileflow_layer_" + id : sourceID(id)
  }

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
    var identity: JSONValue?
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
      if namespace == .overlays {
        let order = style.layers
        let floor =
          anchors?["above-roads"].flatMap { id in order.firstIndex { $0.identifier == id } } ?? 0
        var ceiling =
          anchors?["above-buildings"].flatMap { id in order.firstIndex { $0.identifier == id } }
          ?? order[floor...].firstIndex {
            $0 is MLNSymbolStyleLayer && !$0.identifier.hasPrefix("__tileflow_app_")
          } ?? order.count
        if ceiling < floor { ceiling = order.count }
        return order[floor..<ceiling].first { $0 is MLNFillExtrusionStyleLayer }
          ?? (ceiling == order.count ? nil : order[ceiling])
      }
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
        if let installed = style.layer(withIdentifier: layerID(next.id)) { return installed }
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
      let refs: [String: JSONValue]
      if case .object(let values) = entry["variants"] { refs = values } else { refs = [:] }
      let identity: JSONValue = .object([
        "data": entry["data"]?["sha256"] ?? .null, "ratio": .number(ratio), "sdf": .bool(sdf),
        "variants": .object(refs.mapValues { $0["sha256"] ?? .null }),
      ])
      if let previous = images[name], previous.identity == identity {
        next[name] = previous
        continue
      }
      func decode(_ ref: JSONValue?) throws -> UIImage {
        guard let id = ref?["id"]?.string, let data = channel.payload(id) else {
          throw TileflowMapError.invalidRequest
        }
        guard let image = UIImage(data: data.bytes, scale: CGFloat(ratio)) else {
          throw TileflowMapError(.invalidRequest, reason: .invalidImage)
        }
        return image.withRenderingMode(sdf ? .alwaysTemplate : .alwaysOriginal)
      }
      let variants: [String: UIImage]
      if case .object(let refs) = entry["variants"] {
        variants = try refs.mapValues(decode)
      } else {
        variants = [:]
      }
      let base = try decode(entry["data"])
      guard let pixels = base.cgImage, (1...2048).contains(pixels.width),
        (1...2048).contains(pixels.height),
        variants.values.allSatisfy({
          $0.cgImage?.width == pixels.width && $0.cgImage?.height == pixels.height
        }),
        images[name] != nil || style?.image(forName: name) == nil
      else { throw TileflowMapError(.invalidRequest, reason: .invalidImage) }
      next[name] = Image(base: base, variants: variants, identity: identity)
    }
    if let style {
      for name in images.keys where next[name] == nil { style.removeImage(forName: name) }
      for (name, image) in next where images[name]?.identity != image.identity {
        style.setImage(theme.flatMap { image.variants[$0] } ?? image.base, forName: name)
      }
    }
    images = next
  }

  func showImages(for name: String, style: MLNStyle) {
    guard theme != name else { return }
    theme = name
    for (id, image) in images { style.setImage(image.variants[name] ?? image.base, forName: id) }
  }

  /// Replace the objects owned by one scene component after its new definitions have been validated.
  func replace(with next: NativeRuntimeStyle, in style: MLNStyle) throws {
    for id in next.sources.keys
    where sources[id] == nil && style.source(withIdentifier: next.sourceID(id)) != nil {
      throw TileflowMapError.invalidRequest
    }
    let owned = Set(layers.map(\.id))
    for layer in next.layers
    where !owned.contains(layer.id) && style.layer(withIdentifier: next.layerID(layer.id)) != nil {
      throw TileflowMapError.invalidRequest
    }
    removeInstalled(in: style)
    do { try next.restore(in: style) } catch {
      next.removeInstalled(in: style)
      try restore(in: style)
      throw error
    }
  }

  private func removeInstalled(in style: MLNStyle) {
    for layer in layers.reversed() {
      if let native = style.layer(withIdentifier: layerID(layer.id)) { style.removeLayer(native) }
    }
    for id in images.keys { style.removeImage(forName: id) }
    for id in sources.keys {
      if let source = style.source(withIdentifier: sourceID(id)) { style.removeSource(source) }
    }
  }

  func restore(in style: MLNStyle) throws {
    guard sources.keys.allSatisfy({ style.source(withIdentifier: sourceID($0)) == nil }),
      layers.allSatisfy({ style.layer(withIdentifier: layerID($0.id)) == nil })
    else { throw TileflowMapError.invalidRequest }
    for item in sources.values { style.addSource(try makeSource(item)) }
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
