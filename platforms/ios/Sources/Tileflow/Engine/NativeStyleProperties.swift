import Foundation
import MapLibre
import UIKit

/// Writes a style specification value to a layer of the style MapLibre draws, so a blend position,
/// an emphasis or the view mode changes without loading the style again.
///
/// MapLibre's iOS layers name their properties in Cocoa style (`fill-color` is `fillColor`) and
/// raise an Objective-C exception for a value of the wrong type, which Swift cannot catch. The
/// writer therefore sets only the properties whose types it knows: a constant colour becomes a
/// `UIColor` (or an array of them where MapLibre takes several), a number an `NSNumber`, an image
/// name a string, and an expression goes through MapLibre's JSON expressions, as in a style. Any
/// other property returns false, and the caller loads the whole style instead.
@MainActor
enum NativeStyleProperties {
  enum Kind {
    case colour, colours, number, image
  }

  /// The properties the writer sets, with their Cocoa names and kinds.
  static let properties: [String: (key: String, kind: Kind)] = {
    var table: [String: (key: String, kind: Kind)] = [:]
    for name in [
      "background-color", "fill-color", "fill-outline-color", "line-color", "circle-color",
      "circle-stroke-color", "text-color", "text-halo-color", "icon-color", "icon-halo-color",
      "fill-extrusion-color", "hillshade-accent-color",
    ] { table[name] = (camelCase(name), .colour) }
    for name in ["hillshade-highlight-color", "hillshade-shadow-color"] {
      table[name] = (camelCase(name), .colours)
    }
    for name in [
      "background-opacity", "fill-opacity", "line-opacity", "circle-opacity",
      "circle-stroke-opacity", "text-opacity", "icon-opacity", "fill-extrusion-opacity",
      "raster-opacity", "heatmap-opacity", "line-width", "line-gap-width", "line-blur",
      "line-offset", "circle-radius", "circle-stroke-width", "circle-blur", "text-halo-width",
      "text-halo-blur", "icon-halo-width", "icon-halo-blur", "fill-extrusion-height",
      "fill-extrusion-base", "hillshade-exaggeration", "raster-saturation", "raster-contrast",
    ] { table[name] = (camelCase(name), .number) }
    table["raster-brightness-min"] = ("minimumRasterBrightness", .number)
    table["raster-brightness-max"] = ("maximumRasterBrightness", .number)
    table["raster-hue-rotate"] = ("rasterHueRotation", .number)
    table["icon-image"] = ("iconImageName", .image)
    return table
  }()

  /// Sets `property` of `layer` to `value`; nil resets it to MapLibre's default.
  static func set(_ value: JSONValue?, property: String, of layer: MLNStyleLayer) -> Bool {
    if property == "visibility" {
      layer.isVisible = value?.string != "none"
      return true
    }
    guard let (key, kind) = properties[property] else { return false }
    let setter = NSSelectorFromString("set\(key.prefix(1).uppercased())\(key.dropFirst()):")
    guard layer.responds(to: setter) else { return false }
    guard let value, value != .null else {
      layer.setValue(nil, forKey: key)
      return true
    }
    guard let expression = expression(value, kind: kind) else { return false }
    layer.setValue(expression, forKey: key)
    return true
  }

  private static func expression(_ value: JSONValue, kind: Kind) -> NSExpression? {
    switch (value, kind) {
    case (.number(let number), .number): return NSExpression(forConstantValue: NSNumber(value: number))
    case (.string(let name), .image): return NSExpression(forConstantValue: name)
    case (.string(let text), .colour): return colour(text).map { NSExpression(forConstantValue: $0) }
    case (.string(let text), .colours): return colour(text).map { NSExpression(forConstantValue: [$0]) }
    case (.array(let items), _):
      // An expression, as a style holds it; a literal array would need a typed value. MapLibre
      // converts expressions through `NSExpression`, which cannot hold every shape: only one that
      // comes back as the same JSON is set, so MapLibre parses it as it parsed the style.
      guard case .string(let head)? = items.first, head != "literal" else { return nil }
      let expression = NSExpression(mglJSONObject: value.foundation)
      let back = expression.mgl_jsonExpressionObject
      guard JSONSerialization.isValidJSONObject([back]),
        normalized(JSONValue(foundation: back)) == normalized(value)
      else { return nil }
      return expression
    default:
      return nil
    }
  }

  /// An expression without the comparisons with `true` that `NSExpression` adds to conditions.
  private static func normalized(_ value: JSONValue) -> JSONValue {
    guard case .array(let items) = value else { return value }
    if items.count == 3, items[0] == .string("=="), items[2] == .bool(true) {
      return normalized(items[1])
    }
    return .array(items.map(normalized))
  }

  private static func colour(_ text: String) -> UIColor? {
    guard let rgba = NativeEvaluators.parseColour(text) else { return nil }
    return UIColor(red: rgba[0] / 255, green: rgba[1] / 255, blue: rgba[2] / 255, alpha: rgba[3])
  }

  private static func camelCase(_ name: String) -> String {
    let parts = name.split(separator: "-")
    guard let first = parts.first else { return name }
    return String(first) + parts.dropFirst().map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined()
  }
}
