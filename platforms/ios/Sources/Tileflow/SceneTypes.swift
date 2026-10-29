import CoreGraphics
import Foundation
import UIKit

/// Where the map's sun stands. The themes keep the sun's colours, strengths and shadow strength;
/// the light turns to the new direction, anchored to the map.
public enum TileflowSun: Equatable, Sendable {
  /// `azimuth` in degrees clockwise from north (−360 to 360), `altitude` in degrees above the
  /// horizon (−90 to 90).
  case direction(azimuth: Double, altitude: Double)
  /// The real sun at `date` over `location`, or over the map's centre when `location` is nil.
  case date(Date, location: TileflowCoordinate? = nil)
}

/// A semantic module of a Tileflow map, such as its roads or water, as emphasis addresses it.
public struct TileflowMapModule: RawRepresentable, Hashable, Sendable,
  ExpressibleByStringLiteral
{
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }
  public init(stringLiteral value: String) { self.rawValue = value }

  public static let addresses: Self = "addresses"
  public static let aeroways: Self = "aeroways"
  public static let boundaries: Self = "boundaries"
  public static let buildings: Self = "buildings"
  public static let labels: Self = "labels"
  public static let land: Self = "land"
  public static let landforms: Self = "landforms"
  public static let nautical: Self = "nautical"
  public static let poi: Self = "poi"
  public static let roads: Self = "roads"
  public static let terrain: Self = "terrain"
  public static let transit: Self = "transit"
  public static let vegetation: Self = "vegetation"
  public static let water: Self = "water"
}

/// How the map steps back so the application's content reads first. Emphasis stays through
/// theme changes and blends.
public struct TileflowEmphasis: Equatable, Sendable {
  /// Modules whose ground recedes towards the map's ground colour, from 0 (as designed) to 1.
  public var recede: [TileflowMapModule: Double]
  /// The share of their opacity the map's labels and icons keep, from 0 to 1.
  public var labels: Double?
  /// A GeoJSON `Polygon` or `MultiPolygon` geometry in which labels and icons keep their full
  /// strength. It travels on the SDK's data channel.
  public var keepArea: Data?

  public init(
    recede: [TileflowMapModule: Double] = [:], labels: Double? = nil, keepArea: Data? = nil
  ) {
    self.recede = recede
    self.labels = labels
    self.keepArea = keepArea
  }
}

/// A value an application sets for the whole style, which themes read with `globalState`.
public enum TileflowStyleValue: Equatable, Sendable, ExpressibleByBooleanLiteral,
  ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral, ExpressibleByStringLiteral,
  ExpressibleByNilLiteral
{
  case bool(Bool)
  case number(Double)
  case string(String)
  case null

  public init(booleanLiteral value: Bool) { self = .bool(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(stringLiteral value: String) { self = .string(value) }
  public init(nilLiteral: ()) { self = .null }

  var wireValue: JSONValue {
    switch self {
    case .bool(let value): .bool(value)
    case .number(let value): .number(value)
    case .string(let value): .string(value)
    case .null: .null
    }
  }
}

/// One of the inks a theme draws an application's route in.
public enum TileflowRouteInk: String, CaseIterable, Sendable {
  /// The chosen route's line.
  case line
  /// The edge on each side of the line, which sets it apart from the roads under it.
  case casing
  /// A thin line along the middle of the route; the theme's core opacity scales it.
  case core
  /// A soft halo around the route; the theme's glow opacity scales it.
  case glow
  /// Other routes offered beside the chosen one.
  case alternative
}

/// The route inks of the theme on screen, mixed between neighbouring themes during a blend.
/// Layers drawn with a ``TileflowRouteInk`` follow them without the application's help.
public struct TileflowRouteInks: Equatable, Sendable, Decodable {
  public var line: String
  public var casing: String
  public var core: String
  public var glow: String
  public var alternative: String
  /// 0 (no glow) to 1.
  public var glowOpacity: Double
  /// 0 (no core) to 1.
  public var coreOpacity: Double

  public init(
    line: String, casing: String, core: String, glow: String, alternative: String,
    glowOpacity: Double, coreOpacity: Double
  ) {
    self.line = line
    self.casing = casing
    self.core = core
    self.glow = glow
    self.alternative = alternative
    self.glowOpacity = glowOpacity
    self.coreOpacity = coreOpacity
  }

  /// The colour of an ink.
  public subscript(ink: TileflowRouteInk) -> String {
    switch ink {
    case .line: line
    case .casing: casing
    case .core: core
    case .glow: glow
    case .alternative: alternative
    }
  }

  /// The inks of a light theme that sets no route inks of its own.
  public static let light = TileflowRouteInks(
    line: "#2563eb", casing: "#1e3a8a", core: "#dbeafe", glow: "#2563eb", alternative: "#94a3b8",
    glowOpacity: 0.16, coreOpacity: 0)
  /// The inks of a dark theme that sets no route inks of its own.
  public static let dark = TileflowRouteInks(
    line: "#60a5fa", casing: "#0b1220", core: "#eff6ff", glow: "#60a5fa", alternative: "#64748b",
    glowOpacity: 0.4, coreOpacity: 0.7)
}

/// Where an application layer is drawn.
public enum TileflowLayerPlacement: String, Sendable {
  /// Above the whole map, its labels and 3D content included.
  case top
  /// On the ground: under the map's labels, and hidden where its 3D content stands in front.
  case ground
}

/// The stretch of a line that shows, as shares of its length from its start, with a light that
/// can run along it.
public struct TileflowLineProgress: Equatable, Sendable {
  /// Where the drawn stretch starts, from 0 to 1.
  public var start: Double
  /// Where the drawn stretch ends, from 0 to 1. While it ends before the line does, its head
  /// shows in ``highlight``.
  public var end: Double
  /// Where a light sits along the line, from 0 to 1, or nil for none.
  public var light: Double?
  /// The line's opacity, multiplied with the layer's, from 0 to 1.
  public var opacity: Double
  /// The colour of the head and the light, `#rrggbb`; nil shows neither. Animations keep the
  /// layer's highlight.
  public var highlight: String?

  public init(
    start: Double = 0, end: Double = 1, light: Double? = nil, opacity: Double = 1,
    highlight: String? = nil
  ) {
    self.start = start
    self.end = end
    self.light = light
    self.opacity = opacity
    self.highlight = highlight
  }

  func validate() throws {
    guard [start, end, opacity].allSatisfy({ (0...1).contains($0) }),
      light.map({ (0...1).contains($0) }) ?? true,
      highlight.map({ HostedContract.matches($0, #"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$"#) })
        ?? true
    else { throw TileflowMapError.invalidRequest }
  }

  var stateWireValue: JSONValue {
    .object([
      "start": .number(start), "end": .number(end), "light": light.map(JSONValue.number) ?? .null,
      "opacity": .number(opacity),
    ])
  }

  var wireValue: JSONValue {
    guard case .object(var value) = stateWireValue else { return stateWireValue }
    if let highlight { value["highlight"] = .string(highlight) }
    return .object(value)
  }
}

/// A value a Boundaries choropleth colours: a number for scales, text for categories.
public enum TileflowBoundaryValue: Equatable, Sendable, ExpressibleByIntegerLiteral,
  ExpressibleByFloatLiteral, ExpressibleByStringLiteral
{
  case number(Double)
  case category(String)

  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }
  public init(stringLiteral value: String) { self = .category(value) }

  var wireValue: JSONValue {
    switch self {
    case .number(let value): .number(value)
    case .category(let value): .string(value)
    }
  }
}

/// Application values on the map's Boundaries areas, for a choropleth that reads them as feature
/// state, as `useBoundaryFeatureState` sets them on the web. Values survive theme changes.
public struct TileflowBoundaryValues: Equatable, Sendable {
  enum Rows: Equatable, Sendable {
    case ids([Int: TileflowBoundaryValue])
    case refs([String: TileflowBoundaryValue])
  }
  let rows: Rows
  /// Also set the values on the areas' label points, for labels styled by value.
  public var labels: Bool
  /// The feature-state key the choropleth reads; it must match its `state`.
  public var state: String

  /// Values keyed by the areas' registry IDs, the polygons' feature IDs by default.
  public init(ids values: [Int: TileflowBoundaryValue], labels: Bool = false, state: String = "value")
  {
    self.rows = .ids(values)
    self.labels = labels
    self.state = state
  }

  /// Values keyed by `ref`, for a map that promotes `ref` to the feature ID.
  public init(
    refs values: [String: TileflowBoundaryValue], labels: Bool = false, state: String = "value"
  ) {
    self.rows = .refs(values)
    self.labels = labels
    self.state = state
  }

  /// `[[key, value], …]` in key order, so equal values send equal bytes.
  func rowsJSON() throws -> (joinBy: String, data: Data) {
    guard HostedContract.matches(state, #"^[A-Za-z0-9_-]{1,64}$"#) else {
      throw TileflowMapError.invalidRequest
    }
    let rows: [JSONValue]
    let joinBy: String
    switch self.rows {
    case .ids(let values):
      guard values.keys.allSatisfy({ $0 >= 0 }) else { throw TileflowMapError.invalidRequest }
      joinBy = "id"
      rows = values.sorted { $0.key < $1.key }.map {
        .array([.number(Double($0.key)), $0.value.wireValue])
      }
    case .refs(let values):
      guard values.keys.allSatisfy({ !$0.isEmpty && $0.count <= 256 }) else {
        throw TileflowMapError.invalidRequest
      }
      joinBy = "ref"
      rows = values.sorted { $0.key < $1.key }.map { .array([.string($0.key), $0.value.wireValue]) }
    }
    for row in rows {
      guard case .array(let pair) = row else { continue }
      switch pair[1] {
      case .number(let number) where !number.isFinite: throw TileflowMapError.invalidRequest
      case .string(let text) where text.count > 256: throw TileflowMapError.invalidRequest
      default: break
      }
    }
    return (joinBy, try JSONEncoder().encode(JSONValue.array(rows)))
  }
}

/// An image the application gives the map by name: for the style's own symbols, such as an icon a
/// theme names, and for ``TileflowDepthMarker``. Its variants show while their theme is on screen.
public struct TileflowMapImage: Sendable {
  public let name: String
  /// Physical pixels per point.
  public let pixelRatio: Double
  let data: Data
  let variants: [String: Data]

  /// A PNG or JPEG image and its variants by theme name, each the same size in pixels.
  public init(
    name: String, data: Data, pixelRatio: Double = 1, variants: [String: Data] = [:]
  ) throws {
    guard HostedContract.matches(name, #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"#),
      (1...4).contains(pixelRatio), !data.isEmpty,
      variants.keys.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 }),
      variants.values.allSatisfy({ !$0.isEmpty })
    else { throw TileflowMapError.invalidRequest }
    let largest = ([data] + variants.values).map(\.count).max() ?? 0
    guard largest <= ProtocolContract.maximumDataBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataBytes)
    }
    self.name = name
    self.pixelRatio = pixelRatio
    self.data = data
    self.variants = variants
  }

  /// An image at its own scale, and variants by theme name.
  public init(name: String, image: UIImage, variants: [String: UIImage] = [:]) throws {
    guard let data = image.pngData() else { throw TileflowMapError.invalidRequest }
    var encoded: [String: Data] = [:]
    for (theme, variant) in variants {
      guard let bytes = variant.pngData() else { throw TileflowMapError.invalidRequest }
      encoded[theme] = bytes
    }
    try self.init(
      name: name, data: data, pixelRatio: min(4, max(1, Double(image.scale))), variants: encoded)
  }
}

/// A picture pinned to a position in the map's 3D scene, which nearer 3D buildings hide.
public struct TileflowDepthMarker: Equatable, Sendable {
  public enum Alignment: String, Sendable {
    /// Faces the viewer at a size in points, as a pin does.
    case screen
    /// Lies flat on the ground at a size in metres, as a ring on the street does.
    case ground
  }
  public enum Anchor: String, Sendable { case center, bottom }

  public var id: String
  public var coordinate: TileflowCoordinate
  /// The name of a ``TileflowMapImage`` the map holds.
  public var image: String
  /// Points for a screen marker, metres for a ground marker.
  public var size: CGSize
  public var alignment: Alignment
  public var anchor: Anchor
  /// A screen marker's shift in points, right and down.
  public var offset: CGVector
  /// Degrees clockwise: from the screen's up for a screen marker, from north for a ground one.
  public var rotation: Double
  /// Metres above the ground.
  public var altitude: Double
  public var opacity: Double
  /// Whether nearer 3D content hides the marker.
  public var occluded: Bool

  public init(
    id: String, coordinate: TileflowCoordinate, image: String, size: CGSize,
    alignment: Alignment = .screen, anchor: Anchor = .center, offset: CGVector = .zero,
    rotation: Double = 0, altitude: Double = 0, opacity: Double = 1, occluded: Bool = true
  ) {
    self.id = id
    self.coordinate = coordinate
    self.image = image
    self.size = size
    self.alignment = alignment
    self.anchor = anchor
    self.offset = offset
    self.rotation = rotation
    self.altitude = altitude
    self.opacity = opacity
    self.occluded = occluded
  }

  func wireValue() throws -> JSONValue {
    guard HostedContract.matches(id, #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"#),
      HostedContract.matches(image, #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"#),
      (-180...180).contains(coordinate.longitude), (-90...90).contains(coordinate.latitude),
      (0...4096).contains(size.width), (0...4096).contains(size.height),
      (-4096...4096).contains(offset.dx), (-4096...4096).contains(offset.dy),
      (-360...360).contains(rotation), (-1000...10_000).contains(altitude),
      (0...1).contains(opacity)
    else { throw TileflowMapError.invalidRequest }
    return .object([
      "id": .string(id),
      "coordinate": .object([
        "longitude": .number(coordinate.longitude), "latitude": .number(coordinate.latitude),
      ]),
      "image": .string(image),
      "size": .array([.number(size.width), .number(size.height)]),
      "alignment": .string(alignment.rawValue), "anchor": .string(anchor.rawValue),
      "offset": .array([.number(offset.dx), .number(offset.dy)]),
      "rotation": .number(rotation), "altitude": .number(altitude), "opacity": .number(opacity),
      "occlude": .bool(occluded),
    ])
  }
}

/// A timed camera shot: the camera follows its keyframes frame by frame, as Tileflow Capture
/// renders the same shot to video.
public struct TileflowShot: Equatable, Sendable {
  public struct Keyframe: Equatable, Sendable {
    /// Seconds from the start; the first keyframe is at 0 and later ones rise strictly.
    public var time: TimeInterval
    public var camera: TileflowCamera
    /// The blend position at this keyframe, when the shot blends ``TileflowShot/themes``.
    public var blendPosition: Double?

    public init(time: TimeInterval, camera: TileflowCamera, blendPosition: Double? = nil) {
      self.time = time
      self.camera = camera
      self.blendPosition = blendPosition
    }
  }

  /// A moment of the shot at which ``TileflowMapView/play(_:onCue:)`` calls back, to start the
  /// application's own work in time with the camera.
  public struct Cue: Equatable, Sendable {
    public var time: TimeInterval
    public var id: String
    public init(time: TimeInterval, id: String) {
      self.time = time
      self.id = id
    }
  }

  public enum Easing: String, Sendable {
    /// Each segment eases in and out.
    case smooth
    case linear
  }

  public var keyframes: [Keyframe]
  /// Two to eight themes the shot blends between, by each keyframe's blend position.
  public var themes: [String]?
  public var easing: Easing
  public var cues: [Cue]

  public init(
    keyframes: [Keyframe], themes: [String]? = nil, easing: Easing = .smooth, cues: [Cue] = []
  ) {
    self.keyframes = keyframes
    self.themes = themes
    self.easing = easing
    self.cues = cues
  }

  func wireValue() throws -> JSONValue {
    guard (2...256).contains(keyframes.count), keyframes.first?.time == 0,
      zip(keyframes, keyframes.dropFirst()).allSatisfy({ $0.time < $1.time }),
      let last = keyframes.last, last.time <= 3600, cues.count <= 64,
      cues.allSatisfy({
        (0...last.time).contains($0.time)
          && HostedContract.matches($0.id, #"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"#)
      })
    else { throw TileflowMapError.invalidRequest }
    if let themes {
      guard (2...8).contains(themes.count), Set(themes).count == themes.count,
        themes.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 }),
        keyframes.allSatisfy({
          $0.blendPosition.map { (0...Double(themes.count - 1)).contains($0) } ?? false
        })
      else { throw TileflowMapError.invalidRequest }
    } else {
      guard keyframes.allSatisfy({ $0.blendPosition == nil }) else {
        throw TileflowMapError.invalidRequest
      }
    }
    var value: [String: JSONValue] = [
      "keyframes": .array(
        try keyframes.map { keyframe in
          try keyframe.camera.validate()
          var frame: [String: JSONValue] = [
            "at": .number((keyframe.time * 1000).rounded()),
            "camera": try .encoded(keyframe.camera),
          ]
          if let position = keyframe.blendPosition { frame["blendPosition"] = .number(position) }
          return .object(frame)
        }),
      "easing": .string(easing.rawValue),
      "cues": .array(
        cues.map {
          .object(["at": .number(($0.time * 1000).rounded()), "id": .string($0.id)])
        }),
    ]
    if let themes { value["themes"] = .array(themes.map(JSONValue.string)) }
    return .object(value)
  }
}

/// A theme change as it happens: the map prepares the target theme, applies it, and settles.
public struct TileflowThemeTransition: Equatable, Sendable {
  public enum Phase: String, Sendable {
    /// The target theme's style and fonts are loading.
    case preloading
    /// The map is changing to the target theme.
    case applying
    /// The theme is on screen.
    case ready
    /// The change failed; the map keeps the theme it showed.
    case failed = "error"
  }
  public let phase: Phase
  public let currentTheme: String?
  public let targetTheme: String?
  /// The route inks of the theme on screen, once it is ready.
  public let routeInks: TileflowRouteInks?

  public init(
    phase: Phase, currentTheme: String?, targetTheme: String?, routeInks: TileflowRouteInks? = nil
  ) {
    self.phase = phase
    self.currentTheme = currentTheme
    self.targetTheme = targetTheme
    self.routeInks = routeInks
  }

  init?(wire value: JSONValue) {
    guard let phase = value["phase"]?.string.flatMap(Phase.init(rawValue:)) else { return nil }
    let inks = value["routeInks"].flatMap { raw in
      (try? JSONEncoder().encode(raw)).flatMap {
        try? JSONDecoder().decode(TileflowRouteInks.self, from: $0)
      }
    }
    self.init(
      phase: phase, currentTheme: value["currentTheme"]?.string,
      targetTheme: value["targetTheme"]?.string, routeInks: inks)
  }
}
