import Foundation
import Tileflow
@_exported import TileflowElevation
@_exported import TileflowGeoIP
@_exported import TileflowRouting
@_exported import TileflowSearch

/// How a route is drawn, from its outer glow to its bright core. Colours are `#rrggbb`.
///
/// ``light`` and ``dark`` are the inks of a Tileflow theme that sets no route tokens. Pass the
/// inks that suit the theme on screen; themes that set their own route inks will provide them
/// through the map once it publishes them.
public struct TileflowRouteInks: Sendable, Hashable {
  /// The chosen route's line.
  public var line: String
  /// The edge on each side of the line, which sets it apart from the roads under it.
  public var casing: String
  /// A thin line along the middle of the route.
  public var core: String
  /// A soft halo around the route.
  public var glow: String
  /// Other routes offered beside the chosen one.
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

  public static let light = TileflowRouteInks(
    line: "#2563eb", casing: "#1e3a8a", core: "#dbeafe", glow: "#2563eb", alternative: "#94a3b8",
    glowOpacity: 0.16, coreOpacity: 0)
  public static let dark = TileflowRouteInks(
    line: "#60a5fa", casing: "#0b1220", core: "#eff6ff", glow: "#60a5fa", alternative: "#64748b",
    glowOpacity: 0.4, coreOpacity: 0.7)
}

extension TileflowGeoJSONLayer {
  /// Layers that draw a Routing answer, bottom to top: alternatives, glow, casing, line and core.
  ///
  /// Each layer keeps the full geometry, with coordinates rounded to six decimals (about 0.1 m).
  /// The glow, casing, line and core share one GeoJSON, which the map receives once.
  /// - Parameters:
  ///   - selected: The index of the chosen route; the others are drawn as alternatives.
  ///   - idPrefix: The layers are `<prefix>-alternatives`, `-glow`, `-casing`, `-line`, `-core`.
  public static func route(
    _ response: TileflowRouteResponse, selected: Int = 0, inks: TileflowRouteInks = .light,
    idPrefix: String = "route"
  ) throws -> [TileflowGeoJSONLayer] {
    guard response.routes.indices.contains(selected) else { throw TileflowMapError.invalidRequest }
    // Each line feature's id is its route's index, so a tap on the map can tell routes apart.
    let line = GeoJSONText.lines([(selected, response.routes[selected].geometry)])
    let others = response.routes.indices.filter { $0 != selected }
    var layers: [(String, String, String, Double, Double)] = []
    if !others.isEmpty {
      let alternatives = GeoJSONText.lines(others.map { ($0, response.routes[$0].geometry) })
      layers.append(("alternatives", alternatives, inks.alternative, 5, 1))
    }
    if inks.glowOpacity > 0 { layers.append(("glow", line, inks.glow, 16, inks.glowOpacity)) }
    layers.append(("casing", line, inks.casing, 9, 1))
    layers.append(("line", line, inks.line, 6, 1))
    if inks.coreOpacity > 0 { layers.append(("core", line, inks.core, 2, inks.coreOpacity)) }
    return try layers.map { suffix, data, color, size, opacity in
      try TileflowGeoJSONLayer(
        id: "\(idPrefix)-\(suffix)", geoJSON: Data(data.utf8), kind: .line, color: color,
        size: size, opacity: opacity)
    }
  }

  /// One fill layer per isochrone, the longest time first so shorter times draw on top. Equal
  /// translucent fills darken where they overlap, so nearer areas read stronger.
  /// - Parameter idPrefix: The layers are `<prefix>-<minutes>`.
  public static func isochrones(
    _ response: TileflowIsochroneResponse, inks: TileflowRouteInks = .light,
    opacity: Double = 0.18, idPrefix: String = "isochrone"
  ) throws -> [TileflowGeoJSONLayer] {
    try response.isochrones.sorted { $0.minutes > $1.minutes }.map { isochrone in
      try TileflowGeoJSONLayer(
        id: "\(idPrefix)-\(isochrone.minutes)",
        geoJSON: Data(GeoJSONText.polygons(isochrone.polygons).utf8), kind: .fill,
        color: inks.line, opacity: opacity)
    }
  }
}

extension TileflowAnnotation {
  /// A marker at a distance along an elevation profile, for example the point a person touches
  /// on its chart. Nil when the profile has no samples.
  public static func elevationProfilePosition(
    _ profile: TileflowElevationProfile, atDistance distance: Double,
    id: String = "elevation-profile-position", title: String = "Elevation profile position",
    color: String = TileflowRouteInks.light.line
  ) -> TileflowAnnotation? {
    guard let point = profile.point(atDistance: distance) else { return nil }
    return TileflowAnnotation(
      id: id, coordinate: TileflowCoordinate(point.position), title: title, color: color)
  }

  /// A marker at a Search place, titled with its name or label.
  public init(place: TileflowPlace, id: String, color: String = "#e9573f") {
    let title = String((place.name ?? place.label).prefix(256))
    self.init(
      id: id, coordinate: TileflowCoordinate(place.position), title: title, color: color)
  }
}

extension TileflowCamera {
  /// The camera's centre as a Search `proximity` while the map shows a city or closer (zoom 9
  /// and above), and nil at country or world scale, where it would hide better matches.
  public var searchProximity: TileflowPosition? {
    guard zoom >= 9, longitude.isFinite, latitude.isFinite else { return nil }
    // A map that pans across the antimeridian may report a longitude beyond ±180.
    let wrapped =
      (-180...180).contains(longitude)
      ? longitude
      : ((longitude + 180).truncatingRemainder(dividingBy: 360) + 360)
        .truncatingRemainder(dividingBy: 360) - 180
    return TileflowPosition(longitude: wrapped, latitude: min(90, max(-90, latitude)))
  }

  /// An initial camera from an anonymous GeoIP answer: zoom 10 with a city, 7 with a region and
  /// 4 otherwise. Nil without a position. Never replace a camera the person has already moved.
  public init?(approximateLocation location: TileflowGeoIPLocation) {
    guard let position = location.position else { return nil }
    let zoom: Double = location.city != nil ? 10 : location.region != nil ? 7 : 4
    self.init(longitude: position.longitude, latitude: position.latitude, zoom: zoom)
  }
}

extension TileflowCoordinate {
  public init(_ position: TileflowPosition) {
    self.init(longitude: position.longitude, latitude: position.latitude)
  }
}

extension TileflowPosition {
  public init(_ coordinate: TileflowCoordinate) {
    self.init(longitude: coordinate.longitude, latitude: coordinate.latitude)
  }
}

extension TileflowBounds {
  public init(_ box: TileflowBoundingBox) {
    self.init(west: box.west, south: box.south, east: box.east, north: box.north)
  }
}

/// Compact GeoJSON with coordinates rounded to six decimals (about 0.1 m).
enum GeoJSONText {
  static func lines(_ lines: [(id: Int, positions: [TileflowPosition])]) -> String {
    #"{"type":"FeatureCollection","features":["#
      + lines.map {
        #"{"type":"Feature","id":\#($0.id),"properties":{},"geometry":{"type":"LineString","coordinates":"#
          + positions($0.positions) + "}}"
      }.joined(separator: ",") + "]}"
  }

  static func polygons(_ polygons: [[[TileflowPosition]]]) -> String {
    guard !polygons.isEmpty else { return collection([]) }
    let coordinates = polygons.map { "[" + $0.map(positions).joined(separator: ",") + "]" }
    return collection([
      #"{"type":"MultiPolygon","coordinates":["# + coordinates.joined(separator: ",") + "]}"
    ])
  }

  private static func collection(_ geometries: [String]) -> String {
    #"{"type":"FeatureCollection","features":["#
      + geometries.map { #"{"type":"Feature","properties":{},"geometry":"# + $0 + "}" }
      .joined(separator: ",") + "]}"
  }

  private static func positions(_ positions: [TileflowPosition]) -> String {
    "["
      + positions.map { "[\(number($0.longitude)),\(number($0.latitude))]" }
      .joined(separator: ",") + "]"
  }

  static func number(_ value: Double) -> String {
    let scaled = Int64((value * 1_000_000).rounded())
    let sign = scaled < 0 ? "-" : ""
    let magnitude = scaled.magnitude
    let whole = magnitude / 1_000_000
    var fraction = String(magnitude % 1_000_000)
    guard fraction != "0" else { return sign + String(whole) }
    fraction = String(repeating: "0", count: 6 - fraction.count) + fraction
    while fraction.hasSuffix("0") { fraction.removeLast() }
    return "\(sign)\(whole).\(fraction)"
  }
}
