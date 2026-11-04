import Foundation

/// The evaluators a native map needs to change its appearance without Tileflow's JavaScript
/// runtime, as the native style artifact contract defines them: theme selection, colours mixed in
/// OKLab, family templates filled at a position, blend layers, emphasis at a strength, and suns and
/// route inks mixed between themes.
///
/// Each one reproduces Core's reference implementation; the golden fixtures that Core generates
/// (`native-evaluators.json`) hold them to it, numbers within 1e-9 and strings exactly.
enum NativeEvaluators {
  /// The key of a template leaf: `{"tileflow:leaf": [v0, v1, …]}`.
  static let leafKey = "tileflow:leaf"

  struct Failure: Error, Equatable {
    let message: String
  }

  // MARK: Themes

  /// What a map's manifest says about its themes.
  struct ThemeCatalog: Sendable {
    var defaultTheme: String
    var systemThemes: [String: String]?
    /// Time-of-day families: a family's name and its theme for each moment.
    var timeOfDay: [String: [String: String]]?
    var themes: Set<String>

    init(
      defaultTheme: String, systemThemes: [String: String]? = nil,
      timeOfDay: [String: [String: String]]? = nil, themes: Set<String>
    ) {
      self.defaultTheme = defaultTheme
      self.systemThemes = systemThemes
      self.timeOfDay = timeOfDay
      self.themes = themes
    }
  }

  /// The concrete theme a selection shows: nil chooses the map's default, `system` follows the
  /// colour scheme, and a time of day picks the moment's variant of the theme's family. Unknown
  /// themes never fall back.
  static func theme(
    _ catalog: ThemeCatalog, selection: String?, colorScheme: String?, timeOfDay: String?
  ) throws -> String {
    var name: String
    switch selection {
    case nil: name = catalog.defaultTheme
    case "system":
      guard let systemThemes = catalog.systemThemes else {
        throw Failure(message: "The map declares no system themes; select a concrete theme.")
      }
      guard let colorScheme, let themed = systemThemes[colorScheme] else {
        throw Failure(message: "Resolving the system theme needs a colour scheme.")
      }
      name = themed
    case let selection?: name = selection
    }
    guard isThemeName(name) else { throw Failure(message: "\(name) is not a theme name.") }
    if catalog.themes.contains(name) {
      name = try timeOfDayTheme(catalog.timeOfDay, theme: name, timeOfDay: timeOfDay)
    }
    guard catalog.themes.contains(name) else {
      throw Failure(message: "The map has no theme \(name).")
    }
    return name
  }

  static func timeOfDayTheme(
    _ variants: [String: [String: String]]?, theme: String, timeOfDay: String?
  ) throws -> String {
    guard let timeOfDay, let variants else { return theme }
    guard ["day", "dawn", "dusk", "night"].contains(timeOfDay) else {
      throw Failure(message: "Expected day, dawn, dusk or night.")
    }
    // A theme outside every family is unaffected. Families keep their names' order.
    let family =
      variants[theme]
      ?? variants.keys.sorted().lazy.compactMap { variants[$0] }.first {
        $0.values.contains(theme)
      }
    guard let family else { return theme }
    guard let result = family[timeOfDay] else {
      throw Failure(message: "The theme \(theme) offers no \(timeOfDay) variant.")
    }
    return result
  }

  /// A portable identifier other than `system`.
  static func isThemeName(_ value: String) -> Bool {
    value != "system" && value.utf8.count <= 64
      && value.range(of: #"^[a-z][a-z0-9-]{0,63}$"#, options: .regularExpression) != nil
      && !["constructor", "prototype"].contains(value)
      && value.range(
        of: #"^(?:AUX|CON|NUL|PRN|COM[1-9]|LPT[1-9])$"#,
        options: [.regularExpression, .caseInsensitive]) == nil
  }

  // MARK: Colours

  /// Two CSS colours mixed in premultiplied OKLab, as in Core.
  static func mixColours(_ from: String, _ to: String, _ t: Double) -> String? {
    guard let a = oklab(from), let b = oklab(to) else { return nil }
    let alpha = a[3] + (b[3] - a[3]) * t
    guard alpha > 0 else { return "rgba(0, 0, 0, 0)" }
    let channels = (0..<3).map { i in
      let first = a[i] * a[3]
      return (first + (b[i] * b[3] - first) * t) / alpha
    }
    return colour(fromOklab: channels + [alpha])
  }

  /// A hex, `rgb(a)` or `hsl(a)` colour as OKLab lightness, a, b and alpha.
  static func oklab(_ colour: String) -> [Double]? {
    guard let rgba = parseColour(colour) else { return nil }
    let linear = rgba[0..<3].map { channel -> Double in
      let value = channel / 255
      return value <= 0.04045 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
    }
    let (r, g, b) = (linear[0], linear[1], linear[2])
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
      rgba[3],
    ]
  }

  /// `rgba(r, g, b, a)` with rounded channels and the alpha to three decimals.
  static func colour(fromOklab value: [Double]) -> String {
    let (lightness, a, b, alpha) = (value[0], value[1], value[2], value[3])
    let l = pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
    let m = pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
    let s = pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3)
    let channels = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map { linear -> Int in
      let clamped = min(1, max(0, linear))
      let encoded = clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * pow(clamped, 1 / 2.4) - 0.055
      return Int((encoded * 255).rounded(.toNearestOrAwayFromZero))
    }
    return "rgba(\(channels[0]), \(channels[1]), \(channels[2]), \(threeDecimals(alpha)))"
  }

  /// A number rounded to three decimals as the web writes it: the nearer decimal (the larger on a
  /// tie), then in its shortest form, `1` rather than `1.000`.
  static func threeDecimals(_ value: Double) -> String {
    guard value.isFinite else { return value.isNaN ? "NaN" : value < 0 ? "-Infinity" : "Infinity" }
    let magnitude = abs(value)
    var text = String(format: "%.3f", magnitude)
    // Exact ties at the third decimal are odd multiples of 1/16; printf rounds them to even.
    let sixteenths = magnitude * 16
    if sixteenths == sixteenths.rounded(), Int(sixteenths) % 2 == 1 {
      let thousandths = (Int(sixteenths) * 125 + 1) / 2
      text = String(format: "%d.%03d", thousandths / 1000, thousandths % 1000)
    }
    guard let rounded = Double(text), rounded != 0 else { return "0" }
    return number(value < 0 ? -rounded : rounded)
  }

  /// A number as the web writes it in text, for the values these evaluators produce.
  static func number(_ value: Double) -> String {
    if value == 0 { return "0" }
    if value == value.rounded(), abs(value) < 1e21 { return String(format: "%.0f", value) }
    return "\(value)"
  }

  /// Hex, `rgb(a)` and `hsl(a)` colours as 0–255 channels and 0–1 alpha.
  static func parseColour(_ colour: String) -> [Double]? {
    let text = colour.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if text.hasPrefix("#") {
      let hex = text.dropFirst()
      guard [3, 4, 6, 8].contains(hex.count), hex.allSatisfy(\.isHexDigit) else { return nil }
      let full = hex.count <= 4 ? hex.map { "\($0)\($0)" }.joined() : String(hex)
      var channels: [Double] = []
      var index = full.startIndex
      while index < full.endIndex {
        let next = full.index(index, offsetBy: 2)
        channels.append(Double(UInt8(full[index..<next], radix: 16) ?? 0))
        index = next
      }
      return [channels[0], channels[1], channels[2], channels.count > 3 ? channels[3] / 255 : 1]
    }
    guard
      let match = text.range(of: #"^(rgba?|hsla?)\(([^)]+)\)$"#, options: .regularExpression),
      match == text.startIndex..<text.endIndex,
      let open = text.firstIndex(of: "(")
    else { return nil }
    let function = String(text[..<open])
    let inner = text[text.index(after: open)..<text.index(before: text.endIndex)]
    let parts = inner.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == "/" })
      .map(String.init)
    guard (3...4).contains(parts.count) else { return nil }
    let alpha = parts.count == 4 ? parseUnit(parts[3], scale: 1) : 1
    if function.hasPrefix("rgb") {
      let channels = parts[0..<3].map { parseUnit($0, scale: 255) }
      guard let r = channels[0], let g = channels[1], let b = channels[2], let alpha else {
        return nil
      }
      return [r, g, b, alpha]
    }
    guard let hue = parseFloat(parts[0]), hue.isFinite,
      let saturation = parseUnit(parts[1], scale: 1), let light = parseUnit(parts[2], scale: 1),
      let alpha
    else { return nil }
    let chroma = (1 - abs(2 * light - 1)) * saturation
    let sector =
      ((hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)) / 60
    let x = chroma * (1 - abs(sector.truncatingRemainder(dividingBy: 2) - 1))
    let (r1, g1, b1): (Double, Double, Double) =
      sector < 1
      ? (chroma, x, 0)
      : sector < 2
        ? (x, chroma, 0)
        : sector < 3 ? (0, chroma, x) : sector < 4 ? (0, x, chroma) : sector < 5 ? (x, 0, chroma) : (chroma, 0, x)
    let offset = light - chroma / 2
    return [(r1 + offset) * 255, (g1 + offset) * 255, (b1 + offset) * 255, alpha]
  }

  /// A CSS number or percentage scaled to `scale`; nil when it is neither.
  static func parseUnit(_ part: String, scale: Double) -> Double? {
    guard let value = parseFloat(part), value.isFinite else { return nil }
    return part.hasSuffix("%") ? value / 100 * scale : value
  }

  /// The number at the start of `text`, as the web's `parseFloat` reads it.
  static func parseFloat(_ text: String) -> Double? {
    let trimmed = text.drop { $0.isWhitespace }
    if let infinity = trimmed.range(of: #"^[+-]?Infinity"#, options: .regularExpression) {
      return trimmed[infinity].hasPrefix("-") ? -.infinity : .infinity
    }
    guard
      let match = trimmed.range(
        of: #"^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"#, options: .regularExpression)
    else { return nil }
    var literal = String(trimmed[match])
    if literal.hasSuffix(".") { literal.removeLast() }
    literal = literal.replacingOccurrences(of: ".e", with: "e").replacingOccurrences(
      of: ".E", with: "E")
    return Double(literal)
  }

  // MARK: Templates

  /// The values of a template leaf, or nil for anything else.
  static func leafValues(_ node: JSONValue) -> [JSONValue]? {
    guard case .object(let object) = node, object.count == 1,
      case .array(let values)? = object[leafKey], !values.isEmpty,
      values.allSatisfy({
        if case .number = $0 { return true }
        if case .string = $0 { return true }
        return false
      })
    else { return nil }
    return values
  }

  /// A template filled at a position: each leaf's selected values are mixed `position` of the way
  /// along them, numbers linearly and colours in OKLab. `wrap` replaces each filled leaf.
  static func fill(
    _ template: JSONValue, position: Double, select: [Int]? = nil,
    wrap: ((JSONValue, [JSONValue]) -> JSONValue)? = nil
  ) throws -> JSONValue {
    if let values = leafValues(template) {
      let selected = try select.map { indices in
        try indices.map { index -> JSONValue in
          guard values.indices.contains(index) else {
            throw Failure(message: "A blend selects a theme its leaf does not hold.")
          }
          return values[index]
        }
      } ?? values
      let filled = try mixLeaf(selected, position: position)
      return wrap?(filled, selected) ?? filled
    }
    switch template {
    case .array(let items):
      return .array(try items.map { try fill($0, position: position, select: select, wrap: wrap) })
    case .object(let object):
      return .object(
        try object.mapValues { try fill($0, position: position, select: select, wrap: wrap) })
    default:
      return template
    }
  }

  /// One leaf's values mixed at a position, by Core's blend rule.
  static func mixLeaf(_ values: [JSONValue], position: Double) throws -> JSONValue {
    if values.count == 1 || values.allSatisfy({ $0 == values[0] }) { return values[0] }
    let numbers = values.compactMap(\.number)
    let strings = values.compactMap(\.string)
    guard numbers.count == values.count || (strings.count == values.count && strings.allSatisfy({ oklab($0) != nil }))
    else { throw Failure(message: "A leaf holds values that cannot be mixed.") }
    let at = position.isFinite ? min(Double(values.count - 1), max(0, position)) : 0
    let index = min(values.count - 2, Int(at.rounded(.down)))
    let t = at - Double(index)
    let from = values[index]
    let to = values[index + 1]
    if t <= 0 || from == to { return from }
    if t >= 1 { return to }
    if case .number(let a) = from, case .number(let b) = to { return .number(a + (b - a) * t) }
    guard case .string(let a) = from, case .string(let b) = to,
      let mixed = mixColours(a, b, t)
    else { return t < 0.5 ? from : to }
    return .string(mixed)
  }

  // MARK: Blends

  /// A blend group's layers at a position over selected group themes (indices into the group's
  /// themes, in blend order): ground values follow the position, symbol layers and switches the
  /// nearest selected theme.
  static func blendLayers(group: JSONValue, selection: [Int], position: Double) throws
    -> [JSONValue]
  {
    guard selection.count >= 2 else { throw Failure(message: "A blend selects two or more themes.") }
    let at = position.isFinite ? min(Double(selection.count - 1), max(0, position)) : 0
    let dominant = Int(at.rounded(.toNearestOrAwayFromZero))
    var switches: [String: [JSONValue]] = [:]
    for entry in group["switches"]?.array ?? [] {
      guard let layer = entry["layer"]?.string else { continue }
      switches[layer, default: []].append(entry)
    }
    return try (group["layers"]?.array ?? []).map { layer in
      let symbol = layer["type"]?.string == "symbol"
      guard
        case .object(var filled) = try fill(
          layer, position: symbol ? Double(dominant) : at, select: selection)
      else { throw Failure(message: "A planned layer is not an object.") }
      for entry in switches[layer["id"]?.string ?? ""] ?? [] {
        guard let kind = entry["group"]?.string, let property = entry["property"]?.string,
          let values = entry["values"]?.array
        else { continue }
        var properties: [String: JSONValue] = [:]
        if case .object(let current)? = filled[kind] { properties = current }
        let theme = selection[dominant]
        let value = values.indices.contains(theme) ? values[theme] : .null
        if case .null = value {
          properties.removeValue(forKey: property)
        } else {
          properties[property] = value
        }
        filled[kind] = .object(properties)
      }
      // As Core's own blend: a layer without layout or paint values has no such object.
      for kind in ["layout", "paint"] {
        if case .object(let values)? = filled[kind], values.isEmpty { filled.removeValue(forKey: kind) }
      }
      return .object(filled)
    }
  }

  // MARK: Emphasis

  /// An emphasis target's value at `t` (the module's amount times the emphasis strength), from 0
  /// as designed to 1. With a keep area, a label value keeps its design inside the area.
  static func emphasize(_ target: JSONValue, t: Double, keep: JSONValue? = nil) throws -> JSONValue {
    let at = min(1, max(0, t.isFinite ? t : 0))
    let wrap: ((JSONValue, [JSONValue]) -> JSONValue)? =
      target["kind"]?.string == "label" && keep != nil
      ? { filled, values in
        .array([.string("case"), .array([.string("within"), keep!]), values[0], filled])
      } : nil
    return try fill(target["value"] ?? .null, position: at, wrap: wrap)
  }

  // MARK: Suns and route inks

  /// Blend sun directions in Cartesian space and light colours in OKLab.
  static func mixSuns(_ from: JSONValue, _ to: JSONValue, _ t: Double) -> JSONValue {
    let at = min(1, max(0, t.isFinite ? t : 0))
    if at == 0 { return from }
    if at == 1 { return to }
    let number = { (key: KeyPath<JSONValue, JSONValue?>) -> JSONValue in
      let a = from[keyPath: key]?.number ?? 0
      let b = to[keyPath: key]?.number ?? 0
      return .number(a + (b - a) * at)
    }
    let direction = mixedSunDirection(from, to, at)
    return .object([
      "azimuth": .number(direction.azimuth),
      "altitude": .number(direction.altitude),
      "color": mixedColour(from["color"], to["color"], at),
      "intensity": number(\.["intensity"]),
      "shadowIntensity": number(\.["shadowIntensity"]),
      "ambient": .object([
        "color": mixedColour(from["ambient"]?["color"], to["ambient"]?["color"], at),
        "intensity": number(\.["ambient"]?["intensity"]),
      ]),
    ])
  }

  private static func mixedSunDirection(_ from: JSONValue, _ to: JSONValue, _ t: Double)
    -> (azimuth: Double, altitude: Double)
  {
    let degrees = Double.pi / 180
    func vector(_ azimuth: Double, _ altitude: Double) -> SIMD3<Double> {
      let a = azimuth * degrees
      let h = altitude * degrees
      return SIMD3(sin(a) * cos(h), cos(a) * cos(h), sin(h))
    }

    let azimuthA = from["azimuth"]?.number ?? 0, azimuthB = to["azimuth"]?.number ?? 0
    let altitudeA = from["altitude"]?.number ?? 0, altitudeB = to["altitude"]?.number ?? 0
    let a = vector(azimuthA, altitudeA), b = vector(azimuthB, altitudeB)
    let azimuth = mixAzimuths(azimuthA, azimuthB, t)
    if (a * b).sum() < -0.9995 {
      return (azimuth, altitudeA + (altitudeB - altitudeA) * t)
    }

    let direction = a + (b - a) * t
    let horizontal = hypot(direction.x, direction.y)
    return (
      horizontal < 1e-12 ? azimuth : normalizedAzimuth(atan2(direction.x, direction.y) / degrees),
      atan2(direction.z, horizontal) / degrees
    )
  }

  /// An azimuth `t` of the way from `from` to `to`, turning the short way round.
  static func mixAzimuths(_ from: Double, _ to: Double, _ t: Double) -> Double {
    var delta = normalizedAzimuth(to) - normalizedAzimuth(from)
    if delta > 180 { delta -= 360 }
    if delta < -180 { delta += 360 }
    return normalizedAzimuth(from + delta * t)
  }

  static func normalizedAzimuth(_ azimuth: Double) -> Double {
    let turned = azimuth.truncatingRemainder(dividingBy: 360)
    return turned < 0 ? turned + 360 : turned == 0 ? 0 : turned
  }

  static let routeInkColours = ["line", "casing", "core", "glow", "alternative"]
  static let routeInkNumbers = ["glowOpacity", "coreOpacity"]

  /// Two themes' route inks mixed: colours in OKLab and numbers linearly.
  static func mixRouteInks(_ from: JSONValue, _ to: JSONValue, _ t: Double) -> JSONValue {
    let at = min(1, max(0, t.isFinite ? t : 0))
    if at == 0 { return from }
    if at == 1 { return to }
    var inks: [String: JSONValue] = [:]
    for key in routeInkColours { inks[key] = mixedColour(from[key], to[key], at) }
    for key in routeInkNumbers {
      let a = from[key]?.number ?? 0
      let b = to[key]?.number ?? 0
      inks[key] = .number(a + (b - a) * at)
    }
    return .object(inks)
  }

  /// Values at a blend position over the blended themes' values, in blend order.
  static func at(
    _ values: [JSONValue], position: Double, mix: (JSONValue, JSONValue, Double) -> JSONValue
  ) -> JSONValue? {
    guard !values.isEmpty else { return nil }
    let at = position.isFinite ? min(Double(values.count - 1), max(0, position)) : 0
    let lower = Int(at.rounded(.down))
    let upper = min(values.count - 1, lower + 1)
    return mix(values[lower], values[upper], at - Double(lower))
  }

  private static func mixedColour(_ from: JSONValue?, _ to: JSONValue?, _ t: Double) -> JSONValue {
    let a = from?.string ?? ""
    let b = to?.string ?? ""
    return .string(mixColours(a, b, t) ?? (t < 0.5 ? a : b))
  }
}
