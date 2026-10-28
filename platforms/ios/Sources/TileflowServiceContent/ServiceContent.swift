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

/// The largest GeoJSON a single map layer accepts.
let layerByteLimit = 49_152

extension TileflowGeoJSONLayer {
  /// Layers that draw a Routing answer, bottom to top: alternatives, glow, casing, line and core.
  ///
  /// Lines are simplified until the layers together fit `maximumBytes`, so that other content
  /// fits beside them in one ``TileflowMapController/setContent(annotations:layers:)`` call.
  /// - Parameters:
  ///   - selected: The index of the chosen route; the others are drawn as alternatives.
  ///   - idPrefix: The layers are `<prefix>-alternatives`, `-glow`, `-casing`, `-line`, `-core`.
  public static func route(
    _ response: TileflowRouteResponse, selected: Int = 0, inks: TileflowRouteInks = .light,
    idPrefix: String = "route", maximumBytes: Int = 40_000
  ) throws -> [TileflowGeoJSONLayer] {
    guard response.routes.indices.contains(selected) else { throw TileflowMapError.invalidRequest }
    let chosen = response.routes[selected].geometry
    // Each line feature's id is its route's index, so a tap on the map can tell routes apart.
    let others = response.routes.indices.filter { $0 != selected }.map {
      ($0, response.routes[$0].geometry)
    }
    var tolerance = 0.0
    while true {
      let line = GeoJSONText.lines([(selected, Simplify.line(chosen, tolerance: tolerance))])
      let alternatives = GeoJSONText.lines(
        others.map { ($0.0, Simplify.line($0.1, tolerance: tolerance)) })
      var layers: [(String, String, String, Double, Double)] = []
      if !others.isEmpty { layers.append(("alternatives", alternatives, inks.alternative, 5, 1)) }
      if inks.glowOpacity > 0 { layers.append(("glow", line, inks.glow, 16, inks.glowOpacity)) }
      layers.append(("casing", line, inks.casing, 9, 1))
      layers.append(("line", line, inks.line, 6, 1))
      if inks.coreOpacity > 0 { layers.append(("core", line, inks.core, 2, inks.coreOpacity)) }
      if Simplify.fits(layers.map(\.1), maximumBytes: maximumBytes) {
        return try layers.map { suffix, data, color, size, opacity in
          try TileflowGeoJSONLayer(
            id: "\(idPrefix)-\(suffix)", geoJSON: Data(data.utf8), kind: .line, color: color,
            size: size, opacity: opacity)
        }
      }
      tolerance = try Simplify.next(tolerance)
    }
  }

  /// One fill layer per isochrone, the longest time first so shorter times draw on top. Equal
  /// translucent fills darken where they overlap, so nearer areas read stronger.
  /// - Parameter idPrefix: The layers are `<prefix>-<minutes>`.
  public static func isochrones(
    _ response: TileflowIsochroneResponse, inks: TileflowRouteInks = .light,
    opacity: Double = 0.18, idPrefix: String = "isochrone", maximumBytes: Int = 40_000
  ) throws -> [TileflowGeoJSONLayer] {
    let isochrones = response.isochrones.sorted { $0.minutes > $1.minutes }
    var tolerance = 0.0
    while true {
      let data = isochrones.map { isochrone in
        GeoJSONText.polygons(
          isochrone.polygons.compactMap { polygon -> [[TileflowPosition]]? in
            let rings = polygon.map { Simplify.ring($0, tolerance: tolerance) }
            guard let outer = rings.first, let kept = outer else { return nil }
            return [kept] + rings.dropFirst().compactMap { $0 }
          })
      }
      if Simplify.fits(data, maximumBytes: maximumBytes) {
        return try zip(isochrones, data).map { isochrone, geoJSON in
          try TileflowGeoJSONLayer(
            id: "\(idPrefix)-\(isochrone.minutes)", geoJSON: Data(geoJSON.utf8), kind: .fill,
            color: inks.line, opacity: opacity)
        }
      }
      tolerance = try Simplify.next(tolerance)
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

/// Douglas–Peucker simplification in degrees, raising the tolerance until content fits.
enum Simplify {
  /// The next tolerance to try. A budget too small for even the simplest shapes is invalid.
  static func next(_ tolerance: Double) throws -> Double {
    guard tolerance < 360 else { throw TileflowMapError.invalidRequest }
    return tolerance == 0 ? 1e-6 : tolerance * 2
  }

  static func fits(_ layers: [String], maximumBytes: Int) -> Bool {
    let sizes = layers.map(\.utf8.count)
    return sizes.allSatisfy { $0 <= layerByteLimit } && sizes.reduce(0, +) <= maximumBytes
  }

  static func line(_ positions: [TileflowPosition], tolerance: Double) -> [TileflowPosition] {
    guard tolerance > 0, positions.count > 2 else { return positions }
    var keep = [Bool](repeating: false, count: positions.count)
    keep[0] = true
    keep[positions.count - 1] = true
    var stack = [(0, positions.count - 1)]
    while let (first, last) = stack.popLast() {
      guard last - first > 1 else { continue }
      var farthest = first
      var distance = 0.0
      for index in (first + 1)..<last {
        let value = offset(positions[index], positions[first], positions[last])
        if value > distance {
          distance = value
          farthest = index
        }
      }
      if distance > tolerance {
        keep[farthest] = true
        stack.append((first, farthest))
        stack.append((farthest, last))
      }
    }
    return positions.indices.filter { keep[$0] }.map { positions[$0] }
  }

  /// A closed ring simplified, or nil when it would no longer enclose an area.
  static func ring(_ positions: [TileflowPosition], tolerance: Double) -> [TileflowPosition]? {
    guard tolerance > 0 else { return positions }
    // Split the ring at its farthest point from the start so neither half is degenerate.
    let start = positions[0]
    let far =
      positions.indices.max {
        offset(positions[$0], start, start) < offset(positions[$1], start, start)
      } ?? 0
    guard far > 0, far < positions.count - 1 else { return nil }
    let first = line(Array(positions[0...far]), tolerance: tolerance)
    let second = line(Array(positions[far...]), tolerance: tolerance)
    let ring = first + second.dropFirst()
    return ring.count >= 4 ? ring : nil
  }

  /// The distance in degrees from a point to the segment between two others.
  static func offset(_ point: TileflowPosition, _ a: TileflowPosition, _ b: TileflowPosition)
    -> Double
  {
    let dx = b.longitude - a.longitude
    let dy = b.latitude - a.latitude
    let length = dx * dx + dy * dy
    var t = 0.0
    if length > 0 {
      t = ((point.longitude - a.longitude) * dx + (point.latitude - a.latitude) * dy) / length
      t = min(1, max(0, t))
    }
    let x = a.longitude + t * dx - point.longitude
    let y = a.latitude + t * dy - point.latitude
    return (x * x + y * y).squareRoot()
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
