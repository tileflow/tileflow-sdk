import Foundation
import MapLibre
import TileflowStyleBridge
import UIKit

extension NativeRuntimeStyle {
  static func predicate(_ value: JSONValue) throws -> NSPredicate {
    guard let predicate = TFStylePredicate(value.foundation) else {
      throw TileflowMapError.invalidRequest
    }
    return predicate
  }

  static func validateQueuedLayer(_ layer: RuntimeStyle.Layer) throws {
    let source = MLNShapeSource(identifier: "validation", shape: nil, options: nil)
    _ = try makeLayer(layer.json, source: source)
  }

  private static func makeLayer(_ json: JSONValue, source: MLNSource?, identifier: String? = nil)
    throws -> MLNStyleLayer
  {
    guard case .object(let fields) = json, let id = json["id"]?.string,
      let type = json["type"]?.string,
      Set(fields.keys).isSubset(of: [
        "id", "type", "source", "source-layer", "filter", "minzoom", "maxzoom", "layout", "paint",
      ])
    else { throw TileflowMapError.invalidRequest }
    let key = identifier ?? "__tileflow_layer_" + id
    let layer: MLNStyleLayer
    if type == "background" {
      layer = MLNBackgroundStyleLayer(identifier: key)
    } else {
      guard let source else { throw TileflowMapError.invalidRequest }
      switch type {
      case "circle": layer = MLNCircleStyleLayer(identifier: key, source: source)
      case "line": layer = MLNLineStyleLayer(identifier: key, source: source)
      case "fill": layer = MLNFillStyleLayer(identifier: key, source: source)
      case "fill-extrusion": layer = MLNFillExtrusionStyleLayer(identifier: key, source: source)
      case "symbol": layer = MLNSymbolStyleLayer(identifier: key, source: source)
      case "heatmap": layer = MLNHeatmapStyleLayer(identifier: key, source: source)
      case "hillshade": layer = MLNHillshadeStyleLayer(identifier: key, source: source)
      case "raster": layer = MLNRasterStyleLayer(identifier: key, source: source)
      case "color-relief": layer = MLNColorReliefStyleLayer(identifier: key, source: source)
      default: throw TileflowMapError.invalidRequest
      }
    }
    if let sourceLayer = json["source-layer"] {
      guard let name = sourceLayer.string, let vector = layer as? MLNVectorStyleLayer else {
        throw TileflowMapError.invalidRequest
      }
      vector.sourceLayerIdentifier = name
    }
    if let filter = json["filter"] {
      guard let vector = layer as? MLNVectorStyleLayer else {
        throw TileflowMapError.invalidRequest
      }
      let predicate = try predicate(filter)
      guard TFStylePerform({ vector.predicate = predicate }) else {
        throw TileflowMapError.invalidRequest
      }
    }
    for (key, minimum) in [("minzoom", true), ("maxzoom", false)] {
      if let value = json[key] {
        guard let number = value.number, (0...24).contains(number) else {
          throw TileflowMapError.invalidRequest
        }
        if minimum {
          layer.minimumZoomLevel = Float(number)
        } else {
          layer.maximumZoomLevel = Float(number)
        }
      }
    }
    for group in ["layout", "paint"] {
      guard let object = json[group] else { continue }
      guard case .object(let properties) = object else { throw TileflowMapError.invalidRequest }
      for (name, value) in properties {
        let transition = name.hasSuffix("-transition")
        let base = transition ? String(name.dropLast("-transition".count)) : name
        guard let info = NativeStyleSpecification.property(layer: type, group: group, name: base)
        else { throw TileflowMapError.invalidRequest }
        if transition {
          guard info.transition, case .object(let settings) = value,
            Set(settings.keys).isSubset(of: ["delay", "duration"]),
            settings.values.allSatisfy({ ($0.number ?? -1) >= 0 })
          else { throw TileflowMapError.invalidRequest }
          let transition = MLNTransition(
            duration: (settings["duration"]?.number ?? 0) / 1000,
            delay: (settings["delay"]?.number ?? 0) / 1000)
          guard
            TFStylePerform({
              layer.setValue(
                NSValue(mlnTransition: transition), forKey: info.cocoaKey + "Transition")
            })
          else { throw TileflowMapError.invalidRequest }
        } else {
          try set(value, property: info, layer: layer)
        }
      }
    }
    return layer
  }

  private static func set(_ value: JSONValue, property: NativeStyleProperty, layer: MLNStyleLayer)
    throws
  {
    let literal = value.array?.first == .string("literal")
    let constant: JSONValue
    if literal {
      guard let items = value.array, items.count == 2 else { throw TileflowMapError.invalidRequest }
      constant = items[1]
    } else {
      constant = value
    }
    let expression =
      !literal
      && value.array?.first?.string.map { NativeStyleSpecification.isExpressionOperator(name: $0) }
        == true
    if expression {
      guard property.expressions,
        TFStyleSetProperty(layer, property.cocoaKey, value.foundation, true)
      else { throw TileflowMapError.invalidRequest }
      return
    }
    let input: Any
    var asExpression = false
    switch (property.kind, constant) {
    case ("number", .number(let value)):
      guard value >= (property.minimum ?? -Double.greatestFiniteMagnitude),
        value <= (property.maximum ?? Double.greatestFiniteMagnitude), Float(value).isFinite
      else { throw TileflowMapError.invalidRequest }
      input = NSNumber(value: value)
    case ("boolean", .bool(let flag)): input = NSNumber(value: flag)
    case ("enum", .string(let name)):
      guard property.values.contains(name) else { throw TileflowMapError.invalidRequest }
      input = name
    case ("color", .string(let text)):
      if let rgb = NativeEvaluators.parseColour(text) {
        input = UIColor(red: rgb[0] / 255, green: rgb[1] / 255, blue: rgb[2] / 255, alpha: rgb[3])
      } else {
        input = ["to-color", text]
        asExpression = true
      }
    case ("string", .string(let string)), ("formatted", .string(let string)),
      ("resolvedImage", .string(let string)):
      input = string
    case ("array", .array(let values)):
      guard property.length == nil || property.length == values.count else {
        throw TileflowMapError.invalidRequest
      }
      // Let the native style parser convert vectors, padding, enums and other typed arrays.
      let literal: [Any] = ["literal", values.map(\.foundation)]
      input = ["case", true, literal, literal] as [Any]
      asExpression = true
    default: throw TileflowMapError.invalidRequest
    }
    guard TFStyleSetProperty(layer, property.cocoaKey, input, asExpression) else {
      throw TileflowMapError.invalidRequest
    }
  }

  /// Copy only changed public MapLibre properties from a validated layer to the one being drawn.
  private func update(_ prior: Layer, to next: Layer, native: MLNStyleLayer, in style: MLNStyle)
    throws
  {
    let source = next.json["source"]?.string.flatMap {
      style.source(withIdentifier: sourceID($0))
    }
    let validated = try Self.makeLayer(next.json, source: source, identifier: layerID(next.id))
    let type = next.json["type"]?.string ?? ""
    var keys: [String] = []
    for (name, key) in [
      ("minzoom", "minimumZoomLevel"), ("maxzoom", "maximumZoomLevel"),
      ("source-layer", "sourceLayerIdentifier"), ("filter", "predicate"),
    ] where prior.json[name] != next.json[name] { keys.append(key) }
    for group in ["layout", "paint"] {
      let old =
        if case .object(let object) = prior.json[group] { object } else { [String: JSONValue]() }
      let new =
        if case .object(let object) = next.json[group] { object } else { [String: JSONValue]() }
      for name in Set(old.keys).union(new.keys) where old[name] != new[name] {
        let transition = name.hasSuffix("-transition")
        let base = transition ? String(name.dropLast("-transition".count)) : name
        guard
          let property = NativeStyleSpecification.property(layer: type, group: group, name: base)
        else { throw TileflowMapError.invalidRequest }
        keys.append(property.cocoaKey + (transition ? "Transition" : ""))
      }
    }
    guard
      TFStylePerform({
        for key in keys { native.setValue(validated.value(forKey: key), forKey: key) }
      })
    else { throw TileflowMapError.invalidRequest }
  }

  func install(_ layer: Layer, in style: MLNStyle) throws {
    let source = layer.json["source"]?.string.flatMap {
      style.source(withIdentifier: sourceID($0))
    }
    let native = try Self.makeLayer(layer.json, source: source, identifier: layerID(layer.id))
    let before = beforeLayer(layer, in: style)
    guard
      TFStylePerform({
        if let before { style.insertLayer(native, below: before) } else { style.addLayer(native) }
      })
    else { throw TileflowMapError.invalidRequest }
  }

  func modifyLayer(_ method: MapEngineCommand, request: JSONValue, style: MLNStyle?) throws {
    let value = request["layer"]
    guard let id = (value?["id"] ?? request["id"])?.string else {
      throw TileflowMapError.invalidRequest
    }
    let old = layers
    let at = layers.firstIndex { $0.id == id }
    if method == .addLayer {
      guard at == nil, style?.layer(withIdentifier: layerID(id)) == nil else {
        throw TileflowMapError.invalidRequest
      }
    } else if at == nil {
      throw TileflowMapError.invalidRequest
    }
    let prior = at.map { layers.remove(at: $0) }
    let installed = style?.layer(withIdentifier: layerID(id))
    var removed = false
    do {
      if method != .removeLayer {
        guard let json = value ?? prior?.json else { throw TileflowMapError.invalidRequest }
        if let source = json["source"]?.string, sources[source] == nil {
          throw TileflowMapError.invalidRequest
        }
        var slot = request["slot"]?.string.flatMap(TileflowLayerSlot.init(rawValue:))
        var index = method == .updateLayer ? (at ?? layers.count) : layers.count
        if let position = request["position"] {
          guard let relative = (position["above"] ?? position["below"])?.string,
            let ref = layers.firstIndex(where: { $0.id == relative })
          else { throw TileflowMapError.invalidRequest }
          slot = layers[ref].slot
          index = position["above"] != nil ? ref + 1 : ref
        }
        let record = Layer(id: id, json: json, slot: slot)
        layers.insert(record, at: index)
        if let style {
          if method == .updateLayer, let prior, let installed, prior.slot == record.slot,
            prior.json["type"] == json["type"], prior.json["source"] == json["source"]
          {
            do { try update(prior, to: record, native: installed, in: style) } catch {
              style.removeLayer(installed)
              removed = true
              throw error
            }
          } else {
            if let installed {
              style.removeLayer(installed)
              removed = true
            }
            try install(record, in: style)
          }
        } else {
          try Self.validateQueuedLayer(.init(id: id, json: json, slot: slot))
        }
      } else if let style, let installed {
        style.removeLayer(installed)
      }
    } catch {
      layers = old
      if removed, let style, let prior { try install(prior, in: style) }
      throw error
    }
  }
}
