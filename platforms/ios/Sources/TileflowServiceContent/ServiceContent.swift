import Foundation
import Tileflow
@_exported import TileflowElevation
@_exported import TileflowGeoIP
@_exported import TileflowRouting
@_exported import TileflowSearch

extension TileflowGeoJSONLayer {
  /// Layers that draw a Routing answer, bottom to top: alternatives, glow, casing, line and core.
  ///
  /// By default they are drawn in the route inks of the theme on screen and follow theme changes
  /// and blends; a theme without a glow or a core hides that layer by its opacity. Pass `inks` to
  /// draw them in fixed colours instead. The layers lie on the ground, under the map's labels and
  /// 3D buildings, and the line shows faintly where a building hides it.
  ///
  /// Each layer keeps the full geometry, with coordinates rounded to six decimals (about 0.1 m).
  /// The glow, casing, line and core share one GeoJSON, which the map receives once.
  /// - Parameters:
  ///   - selected: The index of the chosen route; the others are drawn as alternatives.
  ///   - progress: Draws only a stretch of the chosen route, with a white head and light by
  ///     default. ``routeProgressLayers(idPrefix:)`` names the layers to animate.
  ///   - idPrefix: The layers are `<prefix>-alternatives`, `-glow`, `-casing`, `-line`, `-core`.
  public static func route(
    _ response: TileflowRouteResponse, selected: Int = 0, inks: TileflowRouteInks? = nil,
    progress: TileflowLineProgress? = nil, idPrefix: String = "route"
  ) throws -> [TileflowGeoJSONLayer] {
    guard response.routes.indices.contains(selected) else { throw TileflowMapError.invalidRequest }
    // Each line feature's id is its route's index, so a tap on the map can tell routes apart.
    let line = Data(GeoJSONText.lines([(selected, response.routes[selected].geometry)]).utf8)
    let others = response.routes.indices.filter { $0 != selected }
    var drawn = progress
    if drawn != nil, drawn?.highlight == nil { drawn?.highlight = "#ffffff" }
    func layer(
      _ suffix: String, _ data: Data, _ ink: TileflowRouteInk, size: Double,
      occludedOpacity: Double = 0, progress: TileflowLineProgress? = nil
    ) throws -> TileflowGeoJSONLayer {
      let opacity =
        inks.map { inks in
          ink == .glow ? inks.glowOpacity : ink == .core ? inks.coreOpacity : 1
        } ?? 1
      return try TileflowGeoJSONLayer(
        id: "\(idPrefix)-\(suffix)", geoJSON: data, kind: .line,
        color: inks?[ink] ?? TileflowRouteInks.light[ink], size: size, opacity: opacity,
        ink: inks == nil ? ink : nil, placement: .ground, occludedOpacity: occludedOpacity,
        progress: progress)
    }
    var layers: [TileflowGeoJSONLayer] = []
    if !others.isEmpty {
      let alternatives = GeoJSONText.lines(others.map { ($0, response.routes[$0].geometry) })
      layers.append(try layer("alternatives", Data(alternatives.utf8), .alternative, size: 5))
    }
    layers.append(try layer("glow", line, .glow, size: 16, progress: drawn))
    layers.append(try layer("casing", line, .casing, size: 9, progress: drawn))
    layers.append(try layer("line", line, .line, size: 6, occludedOpacity: 0.35, progress: drawn))
    layers.append(try layer("core", line, .core, size: 2, progress: drawn))
    return layers
  }

  /// The layers of ``route(_:selected:inks:progress:idPrefix:)`` drawn with progress, to pass to
  /// ``TileflowMapView/animateLineProgress(layers:to:duration:)``.
  public static func routeProgressLayers(idPrefix: String = "route") -> [String] {
    ["glow", "casing", "line", "core"].map { "\(idPrefix)-\($0)" }
  }

  /// One fill layer per isochrone, the longest time first so shorter times draw on top. Equal
  /// translucent fills darken where they overlap, so nearer areas read stronger. They are drawn in
  /// the route line ink of the theme on screen unless `inks` fixes their colour, and lie on the
  /// ground under the map's labels and 3D buildings.
  /// - Parameter idPrefix: The layers are `<prefix>-<minutes>`.
  public static func isochrones(
    _ response: TileflowIsochroneResponse, inks: TileflowRouteInks? = nil,
    opacity: Double = 0.18, idPrefix: String = "isochrone"
  ) throws -> [TileflowGeoJSONLayer] {
    try response.isochrones.sorted { $0.minutes > $1.minutes }.map { isochrone in
      try TileflowGeoJSONLayer(
        id: "\(idPrefix)-\(isochrone.minutes)",
        geoJSON: Data(GeoJSONText.polygons(isochrone.polygons).utf8), kind: .fill,
        color: (inks ?? .light).line, opacity: opacity, ink: inks == nil ? .line : nil,
        placement: .ground)
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
