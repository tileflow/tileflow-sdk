import Foundation

/// What a step asks the traveller to do. Values the client does not know yet decode as they are.
public struct TileflowManeuver: RawRepresentable, Hashable, Sendable {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let depart = Self(rawValue: "depart")
  public static let arrive = Self(rawValue: "arrive")
  public static let `continue` = Self(rawValue: "continue")
  public static let slightRight = Self(rawValue: "slight-right")
  public static let right = Self(rawValue: "right")
  public static let sharpRight = Self(rawValue: "sharp-right")
  public static let uTurn = Self(rawValue: "u-turn")
  public static let sharpLeft = Self(rawValue: "sharp-left")
  public static let left = Self(rawValue: "left")
  public static let slightLeft = Self(rawValue: "slight-left")
  public static let rampStraight = Self(rawValue: "ramp-straight")
  public static let rampRight = Self(rawValue: "ramp-right")
  public static let rampLeft = Self(rawValue: "ramp-left")
  public static let exitRight = Self(rawValue: "exit-right")
  public static let exitLeft = Self(rawValue: "exit-left")
  public static let keepStraight = Self(rawValue: "keep-straight")
  public static let keepRight = Self(rawValue: "keep-right")
  public static let keepLeft = Self(rawValue: "keep-left")
  public static let merge = Self(rawValue: "merge")
  public static let mergeRight = Self(rawValue: "merge-right")
  public static let mergeLeft = Self(rawValue: "merge-left")
  public static let roundaboutEnter = Self(rawValue: "roundabout-enter")
  public static let roundaboutExit = Self(rawValue: "roundabout-exit")
  public static let ferryEnter = Self(rawValue: "ferry-enter")
  public static let ferryExit = Self(rawValue: "ferry-exit")
  public static let elevator = Self(rawValue: "elevator")
  public static let stairs = Self(rawValue: "stairs")
  public static let escalator = Self(rawValue: "escalator")
  public static let buildingEnter = Self(rawValue: "building-enter")
  public static let buildingExit = Self(rawValue: "building-exit")
}

/// A road class, from motorway to service. Values the client does not know yet decode as they are.
public struct TileflowRoadClass: RawRepresentable, Hashable, Sendable {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let motorway = Self(rawValue: "motorway")
  public static let trunk = Self(rawValue: "trunk")
  public static let primary = Self(rawValue: "primary")
  public static let secondary = Self(rawValue: "secondary")
  public static let tertiary = Self(rawValue: "tertiary")
  public static let unclassified = Self(rawValue: "unclassified")
  public static let residential = Self(rawValue: "residential")
  public static let service = Self(rawValue: "service")
}

/// A road surface. Values the client does not know yet decode as they are.
public struct TileflowRoadSurface: RawRepresentable, Hashable, Sendable {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let pavedSmooth = Self(rawValue: "paved-smooth")
  public static let paved = Self(rawValue: "paved")
  public static let pavedRough = Self(rawValue: "paved-rough")
  public static let compacted = Self(rawValue: "compacted")
  public static let dirt = Self(rawValue: "dirt")
  public static let gravel = Self(rawValue: "gravel")
  public static let path = Self(rawValue: "path")
  public static let impassable = Self(rawValue: "impassable")
}

/// The traffic an answer used. Values the client does not know yet decode as they are.
public struct TileflowRoutingTrafficKind: RawRepresentable, Hashable, Sendable {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let none = Self(rawValue: "none")
}

/// The road network release that answered.
public struct TileflowRoutingNetwork: Sendable, Hashable {
  public var releaseID: String
}

public struct TileflowRouteStep: Sendable, Hashable {
  public var maneuver: TileflowManeuver
  public var instruction: String
  /// Street names and road numbers the step follows, as OpenStreetMap records them.
  public var names: [String]
  /// The exit number of a highway exit.
  public var exit: String?
  /// Destinations signed at a highway exit or ramp.
  public var toward: [String]
  /// The exit to take at a roundabout, counted from the entry.
  public var roundaboutExit: Int?
  public var distance: Double
  public var duration: Double
  public var location: TileflowPosition
}

public struct TileflowRouteLeg: Sendable, Hashable {
  public var distance: Double
  public var duration: Double
  public var steps: [TileflowRouteStep]
}

public struct TileflowRoute: Sendable, Hashable {
  public var distance: Double
  public var duration: Double
  public var hasTolls: Bool
  public var hasHighways: Bool
  public var hasFerries: Bool
  /// The route's line, at least two positions.
  public var geometry: [TileflowPosition]
  /// One leg between each pair of consecutive locations.
  public var legs: [TileflowRouteLeg]

  /// The smallest box around the route's line.
  public var bounds: TileflowBoundingBox { TileflowBoundingBox(geometry)! }
}

public struct TileflowRouteResponse: Sendable, Hashable {
  /// The chosen route first, then its alternatives.
  public var routes: [TileflowRoute]
  public var network: TileflowRoutingNetwork
  /// The credit to show with the routes.
  public var attribution: String
  public var traffic: TileflowRoutingTrafficKind
  public var units: Int
}

/// The area reachable within a time: one or more polygons, each an outer ring followed by holes.
public struct TileflowIsochrone: Sendable, Hashable {
  public var minutes: Int
  public var polygons: [[[TileflowPosition]]]
}

public struct TileflowIsochroneResponse: Sendable, Hashable {
  /// One isochrone per requested time, in request order.
  public var isochrones: [TileflowIsochrone]
  public var network: TileflowRoutingNetwork
  public var attribution: String
  public var traffic: TileflowRoutingTrafficKind
  public var units: Int
}

public struct TileflowMatrixResponse: Sendable, Hashable {
  /// Seconds from each source (rows) to each target (columns); nil where no route was found.
  public var durations: [[Double?]]
  /// Metres, in the same order; nil where no route was found.
  public var distances: [[Double?]]
  public var network: TileflowRoutingNetwork
  public var attribution: String
  public var traffic: TileflowRoutingTrafficKind
  public var units: Int
}

/// A speed limit as tagged in OpenStreetMap.
public struct TileflowSpeedLimit: Sendable, Hashable {
  public var kmh: Int
  /// `tagged` today.
  public var source: String
}

/// A road and what OpenStreetMap records about it.
public struct TileflowRoad: Sendable, Hashable {
  public var names: [String]
  /// The OpenStreetMap way the road belongs to.
  public var wayID: Int64?
  public var roadClass: TileflowRoadClass
  public var surface: TileflowRoadSurface?
  public var lanes: Int?
  /// Nil where OpenStreetMap records no limit.
  public var speedLimit: TileflowSpeedLimit?
  public var toll: Bool
  public var bridge: Bool
  public var tunnel: Bool
  public var roundabout: Bool
  public var length: Double
}

public struct TileflowMatchedPoint: Sendable, Hashable {
  public var location: TileflowPosition
  /// Metres from the trace position.
  public var distance: Double
}

public struct TileflowMatchResponse: Sendable, Hashable {
  public var distance: Double
  public var duration: Double
  public var geometry: [TileflowPosition]
  /// One entry per trace position: where it matched, or nil when it did not.
  public var points: [TileflowMatchedPoint?]
  /// The roads of the matched path, in order.
  public var roads: [TileflowRoad]
  public var network: TileflowRoutingNetwork
  public var attribution: String
  public var traffic: TileflowRoutingTrafficKind
  public var units: Int
}

public struct TileflowNearestResponse: Sendable, Hashable {
  /// The point of the road nearest to the request.
  public var location: TileflowPosition
  /// Metres from the requested position.
  public var distance: Double
  public var road: TileflowRoad
  public var network: TileflowRoutingNetwork
  public var attribution: String
  public var traffic: TileflowRoutingTrafficKind
  public var units: Int
}

// MARK: Decoding

struct RoutingAnswer {
  var network: TileflowRoutingNetwork
  var attribution: String
  var traffic: TileflowRoutingTrafficKind
  var units: Int

  init(_ json: ServiceJSON) throws {
    _ = try json.object()
    guard try json.required("schemaVersion").integer() == 1 else {
      throw ServiceJSONError.invalid
    }
    let release = try json.required("network").required("releaseId").string()
    guard release.matches("^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$") else {
      throw ServiceJSONError.invalid
    }
    network = TileflowRoutingNetwork(releaseID: release)
    attribution = try json.required("attribution").text(maximum: 512)
    traffic = TileflowRoutingTrafficKind(
      rawValue: try RoutingDecoding.word(json.required("traffic")))
    units = try json.required("usage").required("units").integer(0...Int.max)
  }
}

extension TileflowRouteResponse {
  init(_ json: ServiceJSON) throws {
    let answer = try RoutingAnswer(json)
    self.init(
      routes: try json.required("routes").array(count: 1...3).map { route in
        TileflowRoute(
          distance: try RoutingDecoding.meters(route.required("distance")),
          duration: try RoutingDecoding.meters(route.required("duration")),
          hasTolls: try route.required("hasTolls").bool(),
          hasHighways: try route.required("hasHighways").bool(),
          hasFerries: try route.required("hasFerries").bool(),
          geometry: try RoutingDecoding.line(route.required("geometry")),
          legs: try route.required("legs").array(count: 1...4).map { leg in
            TileflowRouteLeg(
              distance: try RoutingDecoding.meters(leg.required("distance")),
              duration: try RoutingDecoding.meters(leg.required("duration")),
              steps: try leg.required("steps").array(count: 1...2000).map(RoutingDecoding.step))
          })
      },
      network: answer.network, attribution: answer.attribution, traffic: answer.traffic,
      units: answer.units)
  }
}

extension TileflowIsochroneResponse {
  init(_ json: ServiceJSON) throws {
    let answer = try RoutingAnswer(json)
    let collection = try json.required("isochrones")
    guard try collection.required("type").string() == "FeatureCollection" else {
      throw ServiceJSONError.invalid
    }
    self.init(
      isochrones: try collection.required("features").array(count: 1...4).map { feature in
        guard try feature.required("type").string() == "Feature" else {
          throw ServiceJSONError.invalid
        }
        let geometry = try feature.required("geometry")
        let polygons: [ServiceJSON]
        switch try geometry.required("type").string() {
        case "Polygon": polygons = [try geometry.required("coordinates")]
        case "MultiPolygon":
          polygons = try geometry.required("coordinates").array(count: 1...Int.max)
        default: throw ServiceJSONError.invalid
        }
        return TileflowIsochrone(
          minutes: try feature.required("properties").required("minutes").integer(1...60),
          polygons: try polygons.map { polygon in
            try polygon.array(count: 1...Int.max).map { ring in
              try ring.array(count: 4...Int.max).map { try $0.position() }
            }
          })
      },
      network: answer.network, attribution: answer.attribution, traffic: answer.traffic,
      units: answer.units)
  }
}

extension TileflowMatrixResponse {
  init(_ json: ServiceJSON) throws {
    let answer = try RoutingAnswer(json)
    func grid(_ key: String) throws -> [[Double?]] {
      try json.required(key).array(count: 1...25).map { row in
        try row.array(count: 1...25).map { cell in
          cell == .null ? nil : try RoutingDecoding.meters(cell)
        }
      }
    }
    self.init(
      durations: try grid("durations"), distances: try grid("distances"),
      network: answer.network, attribution: answer.attribution, traffic: answer.traffic,
      units: answer.units)
  }
}

extension TileflowMatchResponse {
  init(_ json: ServiceJSON) throws {
    let answer = try RoutingAnswer(json)
    self.init(
      distance: try RoutingDecoding.meters(json.required("distance")),
      duration: try RoutingDecoding.meters(json.required("duration")),
      geometry: try RoutingDecoding.line(json.required("geometry")),
      points: try json.required("points").array(count: 2...100).map { point in
        guard point != .null else { return nil }
        return TileflowMatchedPoint(
          location: try point.required("location").position(),
          distance: try RoutingDecoding.meters(point.required("distance")))
      },
      roads: try json.required("roads").array(count: 1...2000).map(RoutingDecoding.road),
      network: answer.network, attribution: answer.attribution, traffic: answer.traffic,
      units: answer.units)
  }
}

extension TileflowNearestResponse {
  init(_ json: ServiceJSON) throws {
    let answer = try RoutingAnswer(json)
    self.init(
      location: try json.required("location").position(),
      distance: try RoutingDecoding.meters(json.required("distance")),
      road: try RoutingDecoding.road(json.required("road")),
      network: answer.network, attribution: answer.attribution, traffic: answer.traffic,
      units: answer.units)
  }
}

enum RoutingDecoding {
  static func meters(_ json: ServiceJSON) throws -> Double {
    try json.number(0 ... .greatestFiniteMagnitude)
  }

  /// A lowercase word such as a maneuver or a road class.
  static func word(_ json: ServiceJSON) throws -> String {
    let value = try json.string()
    guard value.matches("^[a-z][a-z0-9-]{0,63}$") else { throw ServiceJSONError.invalid }
    return value
  }

  static func names(_ json: ServiceJSON?) throws -> [String] {
    try json?.array(count: 0...8).map { try $0.text(maximum: 200) } ?? []
  }

  static func line(_ json: ServiceJSON) throws -> [TileflowPosition] {
    guard try json.required("type").string() == "LineString" else {
      throw ServiceJSONError.invalid
    }
    return try json.required("coordinates").array(count: 2...200_000).map { try $0.position() }
  }

  static func step(_ json: ServiceJSON) throws -> TileflowRouteStep {
    TileflowRouteStep(
      maneuver: TileflowManeuver(rawValue: try word(json.required("maneuver"))),
      instruction: try json.required("instruction").text(maximum: 500),
      names: try names(json.optional("names")),
      exit: try json.optional("exit")?.text(maximum: 50),
      toward: try names(json.optional("toward")),
      roundaboutExit: try json.optional("roundaboutExit")?.integer(1...32),
      distance: try meters(json.required("distance")),
      duration: try meters(json.required("duration")),
      location: try json.required("location").position())
  }

  static func road(_ json: ServiceJSON) throws -> TileflowRoad {
    TileflowRoad(
      names: try names(json.required("names")),
      wayID: try json.optional("wayId").map { Int64(try $0.integer(1...Int.max)) },
      roadClass: TileflowRoadClass(rawValue: try word(json.required("class"))),
      surface: try json.optional("surface").map { TileflowRoadSurface(rawValue: try word($0)) },
      lanes: try json.optional("lanes")?.integer(1...16),
      speedLimit: try json.optional("speedLimit").map { limit in
        TileflowSpeedLimit(
          kmh: try limit.required("kmh").integer(1...300),
          source: try word(limit.required("source")))
      },
      toll: try json.required("toll").bool(),
      bridge: try json.required("bridge").bool(),
      tunnel: try json.required("tunnel").bool(),
      roundabout: try json.required("roundabout").bool(),
      length: try meters(json.required("length")))
  }
}
