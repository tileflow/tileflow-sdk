import Foundation
import UIKit

/// A layer of the application's runtime style. The SDK generates one type per MapLibre layer
/// type, such as ``TileflowCircleLayer`` and ``TileflowSymbolLayer``, with every layout and paint
/// property of the MapLibre style specification. Encoding a layer gives its MapLibre JSON.
public protocol TileflowLayer: Encodable, Sendable {
  /// The MapLibre layer type, such as `circle`.
  static var type: String { get }
  /// The layer's identifier among the application's layers.
  var id: String { get }
  /// Where the layer lies among the map's own layers; nil lies above them all.
  var slot: TileflowLayerSlot? { get }
}

/// Where an application layer lies among the map's own layers. Every Tileflow map resolves each
/// slot to its own layers, so a layer keeps its place across themes. A style without these
/// placements puts every slot but ``aboveLabels`` under its labels.
public enum TileflowLayerSlot: String, Sendable, Equatable, CaseIterable {
  /// Above water, under roads and everything above them.
  case aboveWater = "above-water"
  /// Under the roads.
  case belowRoads = "below-roads"
  /// Above the roads, under the buildings.
  case aboveRoads = "above-roads"
  /// Above the buildings, including the 3D scene's, under the labels.
  case aboveBuildings = "above-buildings"
  /// Under the labels.
  case belowLabels = "below-labels"
  /// Above the labels.
  case aboveLabels = "above-labels"
}

/// Where a layer goes relative to the application's other layers. A layer placed above or below
/// another takes that layer's slot.
public enum TileflowLayerPosition: Sendable, Equatable {
  /// On top of the layers of its slot.
  case `default`
  /// Directly above an application layer.
  case above(String)
  /// Directly below an application layer.
  case below(String)

  var wireValue: JSONValue? {
    switch self {
    case .default: nil
    case .above(let id): .object(["above": .string(id)])
    case .below(let id): .object(["below": .string(id)])
    }
  }
}

/// A style property's value: a constant, or an expression evaluated for each feature, zoom level
/// or feature state.
public enum TileflowValue<T: Sendable & Equatable>: Sendable, Equatable {
  case constant(T)
  case expression(TileflowExpression)
}

extension TileflowValue: ExpressibleByIntegerLiteral where T == Double {
  public init(integerLiteral value: Int) { self = .constant(Double(value)) }
}
extension TileflowValue: ExpressibleByFloatLiteral where T == Double {
  public init(floatLiteral value: Double) { self = .constant(value) }
}
extension TileflowValue: ExpressibleByBooleanLiteral where T == Bool {
  public init(booleanLiteral value: Bool) { self = .constant(value) }
}
extension TileflowValue: ExpressibleByUnicodeScalarLiteral
where T: ExpressibleByStringLiteral, T.StringLiteralType == String {
  public init(unicodeScalarLiteral value: String) { self = .constant(T(stringLiteral: value)) }
}
extension TileflowValue: ExpressibleByExtendedGraphemeClusterLiteral
where T: ExpressibleByStringLiteral, T.StringLiteralType == String {
  public init(extendedGraphemeClusterLiteral value: String) {
    self = .constant(T(stringLiteral: value))
  }
}
extension TileflowValue: ExpressibleByStringLiteral
where T: ExpressibleByStringLiteral, T.StringLiteralType == String {
  public init(stringLiteral value: String) { self = .constant(T(stringLiteral: value)) }
}

/// A colour of the runtime style, sent to the map as CSS `rgba()`.
public struct TileflowColor: Sendable, Equatable, ExpressibleByStringLiteral {
  /// Channels from 0 to 255.
  public let red: Double
  public let green: Double
  public let blue: Double
  /// From 0 to 1.
  public let alpha: Double

  public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
    self.red = min(255, max(0, red))
    self.green = min(255, max(0, green))
    self.blue = min(255, max(0, blue))
    self.alpha = min(1, max(0, alpha))
  }

  /// `#rrggbb` or `#rrggbbaa`; nil for any other text.
  public init?(hex: String) {
    guard HostedContract.matches(hex, #"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"#),
      let value = UInt64(hex.dropFirst(), radix: 16)
    else { return nil }
    let long = hex.count == 9
    let rgb = long ? value >> 8 : value
    self.init(
      red: Double((rgb >> 16) & 0xff), green: Double((rgb >> 8) & 0xff), blue: Double(rgb & 0xff),
      alpha: long ? Double(value & 0xff) / 255 : 1)
  }

  /// A hexadecimal colour literal, such as `"#e9573f"`; any other text is opaque black.
  public init(stringLiteral value: String) {
    self = TileflowColor(hex: value) ?? TileflowColor(red: 0, green: 0, blue: 0)
  }

  /// A UIKit colour, in sRGB.
  public init(_ color: UIColor) {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    color.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    self.init(red: red * 255, green: green * 255, blue: blue * 255, alpha: alpha)
  }

  var css: String {
    let channels = [red, green, blue].map { String(Int($0.rounded())) }.joined(separator: ", ")
    return "rgba(\(channels), \((alpha * 1000).rounded() / 1000))"
  }
}

/// How a property moves to a new value: over `duration` seconds, after `delay` seconds.
public struct TileflowTransition: Sendable, Equatable {
  public var duration: TimeInterval
  public var delay: TimeInterval

  public init(duration: TimeInterval, delay: TimeInterval = 0) {
    self.duration = duration
    self.delay = delay
  }
}

/// Anchors to try for a label, in order, each with its offset in ems: the value of
/// `textVariableAnchorOffset`.
public struct TileflowTextAnchorOffsets: Sendable, Equatable {
  public struct Entry: Sendable, Equatable {
    public var anchor: TileflowTextAnchor
    /// `[x, y]` in ems; positive values move right and down.
    public var offset: [Double]

    public init(anchor: TileflowTextAnchor, offset: [Double]) {
      self.anchor = anchor
      self.offset = offset
    }
  }
  public var entries: [Entry]

  public init(_ entries: [Entry]) { self.entries = entries }
}

/// A MapLibre style expression: a value computed for each feature, zoom level or feature state.
/// Build one from the operator factories, such as ``get(_:)``, ``match(_:)`` and
/// ``interpolate(_:)``, from literals, or from MapLibre JSON with ``init(json:)``.
///
/// ```swift
/// layer.circleRadius = .expression(
///   .interpolate(.linear(), .zoom(), 10, 2, 16, 8))
/// layer.filter = .eq(.get("kind"), "cafe")
/// ```
public struct TileflowExpression: Sendable, Equatable, ExpressibleByStringLiteral,
  ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral
{
  let json: JSONValue

  init(json: JSONValue) { self.json = json }

  init(operator name: String, _ arguments: [TileflowExpression]) {
    json = .array([.string(name)] + arguments.map(\.json))
  }

  /// An expression in MapLibre's JSON form, such as `["get", "name"]`.
  /// - Throws: ``TileflowMapError/invalidRequest`` when the text is not JSON.
  public init(json text: String) throws {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) else {
      throw TileflowMapError.invalidRequest
    }
    json = value
  }

  public init(stringLiteral value: String) { json = .string(value) }
  public init(integerLiteral value: Int) { json = .number(Double(value)) }
  public init(floatLiteral value: Double) { json = .number(value) }
  public init(booleanLiteral value: Bool) { json = .bool(value) }
  /// A colour.
  public init(_ color: TileflowColor) { json = .string(color.css) }

  /// A list of numbers as one value.
  public static func literal(_ values: [Double]) -> TileflowExpression {
    TileflowExpression(json: .array([.string("literal"), .array(values.map(JSONValue.number))]))
  }

  /// A list of strings as one value.
  public static func literal(_ values: [String]) -> TileflowExpression {
    TileflowExpression(json: .array([.string("literal"), .array(values.map(JSONValue.string))]))
  }

  public static func == (lhs: TileflowExpression, rhs: TileflowExpression) -> Bool {
    lhs.json.text == rhs.json.text
  }
}

extension JSONValue {
  /// Canonical text, for comparisons.
  var text: String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    return (try? encoder.encode(self)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
  }
}

/// A value the runtime style sends to the map.
protocol StyleWire {
  var styleWire: JSONValue { get }
}
extension Double: StyleWire { var styleWire: JSONValue { .number(self) } }
extension Bool: StyleWire { var styleWire: JSONValue { .bool(self) } }
extension String: StyleWire { var styleWire: JSONValue { .string(self) } }
extension Array: StyleWire where Element: StyleWire {
  var styleWire: JSONValue { .array(map(\.styleWire)) }
}
extension TileflowColor: StyleWire { var styleWire: JSONValue { .string(css) } }
extension TileflowExpression: StyleWire { var styleWire: JSONValue { json } }
extension TileflowTransition: StyleWire {
  var styleWire: JSONValue {
    .object([
      "duration": .number((duration * 1000).rounded()), "delay": .number((delay * 1000).rounded()),
    ])
  }
}
extension TileflowTextAnchorOffsets: StyleWire {
  var styleWire: JSONValue {
    .array(entries.flatMap { [.string($0.anchor.rawValue), $0.offset.styleWire] })
  }
}
extension StyleWire where Self: RawRepresentable, RawValue == String {
  var styleWire: JSONValue { .string(rawValue) }
}
extension TileflowValue: StyleWire where T: StyleWire {
  var styleWire: JSONValue {
    switch self {
    case .constant(let value): value.styleWire
    case .expression(let expression): expression.json
    }
  }
}

/// Collects a layer's MapLibre JSON as a generated layer type encodes itself.
struct StyleLayerEncoding: Encodable {
  let id: String
  let type: String
  var source: String?
  var sourceLayer: String?
  var filter: TileflowExpression?
  var minZoom: Double?
  var maxZoom: Double?
  private var layout: [String: JSONValue] = [:]
  private var paint: [String: JSONValue] = [:]

  init(id: String, type: String) {
    self.id = id
    self.type = type
  }

  mutating func layout(_ name: String, _ value: (some StyleWire)?) {
    if let value { layout[name] = value.styleWire }
  }

  mutating func paint(_ name: String, _ value: (some StyleWire)?) {
    if let value { paint[name] = value.styleWire }
  }

  func encode(to encoder: any Encoder) throws {
    var value: [String: JSONValue] = ["id": .string(id), "type": .string(type)]
    if let source { value["source"] = .string(source) }
    if let sourceLayer { value["source-layer"] = .string(sourceLayer) }
    if let filter { value["filter"] = filter.json }
    if let minZoom { value["minzoom"] = .number(minZoom) }
    if let maxZoom { value["maxzoom"] = .number(maxZoom) }
    if !layout.isEmpty { value["layout"] = .object(layout) }
    if !paint.isEmpty { value["paint"] = .object(paint) }
    try JSONValue.object(value).encode(to: encoder)
  }
}
