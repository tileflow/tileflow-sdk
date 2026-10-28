import Foundation

/// Tileflow Routing: routes, isochrones, matrices, map matching and the nearest road.
///
/// Distances are metres and durations seconds, estimated without traffic. The client reads the
/// process configuration on every call unless it is given one. It needs a publishable credential
/// with the Routing permission that lists this app's bundle identifier.
public struct TileflowRouting: Sendable {
  private let transport: ServiceTransport

  /// - Parameters:
  ///   - configuration: Overrides ``Tileflow/configuration()`` for this client.
  ///   - session: The session that sends requests. Redirects are never followed.
  public init(configuration: TileflowConfiguration? = nil, session: URLSession = .shared) {
    transport = ServiceTransport(
      configuration: configuration, session: session, policy: TileflowRoutingError.policy)
  }

  /// The fastest route through two to five positions, with up to two alternatives between two
  /// positions: its line, distance, duration, steps and whether it uses tolls, highways or ferries.
  public func route(_ request: TileflowRouteRequest) async throws -> TileflowRouteResponse {
    try await run {
      let legs = request.locations.count - 1
      return try await call("route", try request.wireValue()) { json in
        let answer = try TileflowRouteResponse(json)
        guard answer.routes.count <= request.alternatives + 1,
          answer.routes.allSatisfy({ $0.legs.count == legs })
        else { throw ServiceJSONError.invalid }
        return answer
      }
    }
  }

  /// The areas reachable from a position within one to four times, one per time.
  public func isochrone(_ request: TileflowIsochroneRequest) async throws
    -> TileflowIsochroneResponse
  {
    try await run {
      try await call("isochrone", try request.wireValue()) { json in
        let answer = try TileflowIsochroneResponse(json)
        guard answer.isochrones.map(\.minutes) == request.minutes else {
          throw ServiceJSONError.invalid
        }
        return answer
      }
    }
  }

  /// Times and distances from every source (rows) to every target (columns).
  public func matrix(_ request: TileflowMatrixRequest) async throws -> TileflowMatrixResponse {
    try await run {
      try await call("matrix", try request.wireValue()) { json in
        let answer = try TileflowMatrixResponse(json)
        let isGrid = { (grid: [[Double?]]) in
          grid.count == request.sources.count
            && grid.allSatisfy { $0.count == request.targets.count }
        }
        guard isGrid(answer.durations), isGrid(answer.distances) else {
          throw ServiceJSONError.invalid
        }
        return answer
      }
    }
  }

  /// The roads a GPS trace followed: the matched line, where each position matched, and each
  /// road with what OpenStreetMap records about it.
  public func match(_ request: TileflowMatchRequest) async throws -> TileflowMatchResponse {
    try await run {
      try await call("match", try request.wireValue()) { json in
        let answer = try TileflowMatchResponse(json)
        guard answer.points.count == request.trace.count else { throw ServiceJSONError.invalid }
        return answer
      }
    }
  }

  /// The nearest point of a road the mode can use.
  public func nearest(_ request: TileflowNearestRequest) async throws -> TileflowNearestResponse {
    try await run {
      try await call("nearest", try request.wireValue()) { try TileflowNearestResponse($0) }
    }
  }

  private func call<Answer>(
    _ operation: String, _ body: ServiceJSON, decode: (ServiceJSON) throws -> Answer
  ) async throws -> Answer {
    try await transport.call(
      ServiceRequest(
        service: .routing, path: "/v1/routing/\(operation)", body: body,
        maximumRequestBytes: 8 * 1024, maximumResponseBytes: 4 * 1024 * 1024),
      decode: decode)
  }

  private func run<Answer>(_ work: () async throws -> Answer) async throws -> Answer {
    do {
      return try await work()
    } catch let failure as ServiceFailure {
      throw TileflowRoutingError(failure)
    }
  }
}

public enum TileflowRoutingMode: String, Sendable, CaseIterable {
  case driving
  case walking
  case cycling
  case truck

  /// The longest sum of straight-line distances between consecutive route locations, in metres.
  public var maximumRouteDistance: Double {
    switch self {
    case .driving, .truck: 1_000_000
    case .walking: 100_000
    case .cycling: 300_000
    }
  }

  /// The longest straight-line distance between a matrix source and target, in metres.
  public var maximumMatrixDistance: Double {
    switch self {
    case .driving, .truck: 200_000
    case .walking, .cycling: 10_000
    }
  }
}

/// Road kinds a request may avoid. Avoidance is a strong preference, not an exclusion.
public enum TileflowRoutingAvoidance: String, Sendable, CaseIterable {
  case tolls
  case highways
  case ferries
}

/// The traffic a request may use. Only `none` exists today.
public enum TileflowRoutingTraffic: String, Sendable, CaseIterable {
  case none
}

/// Languages the instructions can be written in.
public enum TileflowRoutingLanguage: String, Sendable, CaseIterable {
  case arSA = "ar-SA"
  case bgBG = "bg-BG"
  case caES = "ca-ES"
  case csCZ = "cs-CZ"
  case daDK = "da-DK"
  case deDE = "de-DE"
  case elGR = "el-GR"
  case enAU = "en-AU"
  case enGB = "en-GB"
  case enUS = "en-US"
  case esES = "es-ES"
  case etEE = "et-EE"
  case fiFI = "fi-FI"
  case frFR = "fr-FR"
  case hiIN = "hi-IN"
  case huHU = "hu-HU"
  case itIT = "it-IT"
  case jaJP = "ja-JP"
  case koKR = "ko-KR"
  case mnMN = "mn-MN"
  case nbNO = "nb-NO"
  case nlNL = "nl-NL"
  case plPL = "pl-PL"
  case ptBR = "pt-BR"
  case ptPT = "pt-PT"
  case roRO = "ro-RO"
  case ruRU = "ru-RU"
  case skSK = "sk-SK"
  case slSI = "sl-SI"
  case svSE = "sv-SE"
  case trTR = "tr-TR"
  case ukUA = "uk-UA"
  case viVN = "vi-VN"
}

/// A truck's dimensions, which its route respects where OpenStreetMap records limits.
public struct TileflowVehicle: Sendable, Equatable {
  /// 1 to 10 m.
  public var heightMeters: Double?
  /// 1 to 5 m.
  public var widthMeters: Double?
  /// 1 to 40 m.
  public var lengthMeters: Double?
  /// 0.5 to 100 t.
  public var weightTonnes: Double?
  /// 0.5 to 40 t.
  public var axleLoadTonnes: Double?
  /// 2 to 20.
  public var axleCount: Int?
  public var hazardousMaterials: Bool?

  public init(
    heightMeters: Double? = nil, widthMeters: Double? = nil, lengthMeters: Double? = nil,
    weightTonnes: Double? = nil, axleLoadTonnes: Double? = nil, axleCount: Int? = nil,
    hazardousMaterials: Bool? = nil
  ) {
    self.heightMeters = heightMeters
    self.widthMeters = widthMeters
    self.lengthMeters = lengthMeters
    self.weightTonnes = weightTonnes
    self.axleLoadTonnes = axleLoadTonnes
    self.axleCount = axleCount
    self.hazardousMaterials = hazardousMaterials
  }

  func wireValue() throws -> ServiceJSON {
    var body: [String: ServiceJSON] = [:]
    for (key, value, range) in [
      ("heightMeters", heightMeters, 1.0...10), ("widthMeters", widthMeters, 1...5),
      ("lengthMeters", lengthMeters, 1...40), ("weightTonnes", weightTonnes, 0.5...100),
      ("axleLoadTonnes", axleLoadTonnes, 0.5...40),
    ] {
      guard let value else { continue }
      guard value.isFinite, range.contains(value) else { throw TileflowRoutingError.invalid() }
      body[key] = .number(value)
    }
    if let axleCount {
      guard (2...20).contains(axleCount) else { throw TileflowRoutingError.invalid() }
      body["axleCount"] = .number(Double(axleCount))
    }
    if let hazardousMaterials { body["hazardousMaterials"] = .bool(hazardousMaterials) }
    return .object(body)
  }
}

public struct TileflowRouteRequest: Sendable, Equatable {
  /// Two to five positions, in travel order.
  public var locations: [TileflowPosition]
  public var mode: TileflowRoutingMode
  /// Only for `truck`.
  public var vehicle: TileflowVehicle?
  public var avoid: [TileflowRoutingAvoidance]
  public var traffic: TileflowRoutingTraffic?
  /// 0 to 2 alternatives, only between two locations.
  public var alternatives: Int
  public var language: TileflowRoutingLanguage?

  public init(
    locations: [TileflowPosition], mode: TileflowRoutingMode, vehicle: TileflowVehicle? = nil,
    avoid: [TileflowRoutingAvoidance] = [], traffic: TileflowRoutingTraffic? = nil,
    alternatives: Int = 0, language: TileflowRoutingLanguage? = nil
  ) {
    self.locations = locations
    self.mode = mode
    self.vehicle = vehicle
    self.avoid = avoid
    self.traffic = traffic
    self.alternatives = alternatives
    self.language = language
  }

  func wireValue() throws -> ServiceJSON {
    guard (2...5).contains(locations.count), locations.allSatisfy(\.isValid),
      (0...2).contains(alternatives), alternatives == 0 || locations.count == 2,
      zip(locations, locations.dropFirst()).reduce(0, { $0 + $1.0.distance(to: $1.1) })
        <= mode.maximumRouteDistance
    else { throw TileflowRoutingError.invalid() }
    var body = try RoutingWire.travel(mode: mode, vehicle: vehicle, avoid: avoid, traffic: traffic)
    body["locations"] = .array(locations.map(ServiceJSON.position))
    if alternatives > 0 { body["alternatives"] = .number(Double(alternatives)) }
    if let language { body["language"] = .string(language.rawValue) }
    return .object(body)
  }
}

public struct TileflowIsochroneRequest: Sendable, Equatable {
  public var location: TileflowPosition
  public var mode: TileflowRoutingMode
  /// One to four strictly rising times, each 1 to 60 minutes.
  public var minutes: [Int]
  public var vehicle: TileflowVehicle?
  public var avoid: [TileflowRoutingAvoidance]
  public var traffic: TileflowRoutingTraffic?

  public init(
    location: TileflowPosition, mode: TileflowRoutingMode, minutes: [Int],
    vehicle: TileflowVehicle? = nil, avoid: [TileflowRoutingAvoidance] = [],
    traffic: TileflowRoutingTraffic? = nil
  ) {
    self.location = location
    self.mode = mode
    self.minutes = minutes
    self.vehicle = vehicle
    self.avoid = avoid
    self.traffic = traffic
  }

  func wireValue() throws -> ServiceJSON {
    guard location.isValid, (1...4).contains(minutes.count),
      minutes.allSatisfy({ (1...60).contains($0) }),
      zip(minutes, minutes.dropFirst()).allSatisfy({ $0 < $1 })
    else { throw TileflowRoutingError.invalid() }
    var body = try RoutingWire.travel(mode: mode, vehicle: vehicle, avoid: avoid, traffic: traffic)
    body["location"] = .position(location)
    body["minutes"] = .array(minutes.map { .number(Double($0)) })
    return .object(body)
  }
}

public struct TileflowMatrixRequest: Sendable, Equatable {
  /// 1 to 25 positions.
  public var sources: [TileflowPosition]
  /// 1 to 25 positions.
  public var targets: [TileflowPosition]
  public var mode: TileflowRoutingMode
  public var vehicle: TileflowVehicle?
  public var avoid: [TileflowRoutingAvoidance]
  public var traffic: TileflowRoutingTraffic?

  public init(
    sources: [TileflowPosition], targets: [TileflowPosition], mode: TileflowRoutingMode,
    vehicle: TileflowVehicle? = nil, avoid: [TileflowRoutingAvoidance] = [],
    traffic: TileflowRoutingTraffic? = nil
  ) {
    self.sources = sources
    self.targets = targets
    self.mode = mode
    self.vehicle = vehicle
    self.avoid = avoid
    self.traffic = traffic
  }

  func wireValue() throws -> ServiceJSON {
    guard (1...25).contains(sources.count), (1...25).contains(targets.count),
      sources.allSatisfy(\.isValid), targets.allSatisfy(\.isValid),
      sources.allSatisfy({ source in
        targets.allSatisfy { source.distance(to: $0) <= mode.maximumMatrixDistance }
      })
    else { throw TileflowRoutingError.invalid() }
    var body = try RoutingWire.travel(mode: mode, vehicle: vehicle, avoid: avoid, traffic: traffic)
    body["sources"] = .array(sources.map(ServiceJSON.position))
    body["targets"] = .array(targets.map(ServiceJSON.position))
    return .object(body)
  }
}

/// A GPS trace to match to the roads it followed.
public struct TileflowMatchRequest: Sendable, Equatable {
  /// 2 to 100 positions, each within 2 km of the previous one, 200 km in all.
  public var trace: [TileflowPosition]
  public var mode: TileflowRoutingMode
  /// Seconds since the Unix epoch at each trace position, never decreasing.
  public var timestamps: [Int]?
  /// GPS accuracy in metres, 1 to 100. The service's default suits a phone outdoors.
  public var accuracy: Double?
  public var vehicle: TileflowVehicle?

  public init(
    trace: [TileflowPosition], mode: TileflowRoutingMode, timestamps: [Int]? = nil,
    accuracy: Double? = nil, vehicle: TileflowVehicle? = nil
  ) {
    self.trace = trace
    self.mode = mode
    self.timestamps = timestamps
    self.accuracy = accuracy
    self.vehicle = vehicle
  }

  func wireValue() throws -> ServiceJSON {
    guard (2...100).contains(trace.count), trace.allSatisfy(\.isValid) else {
      throw TileflowRoutingError.invalid()
    }
    var total = 0.0
    for (from, to) in zip(trace, trace.dropFirst()) {
      let gap = from.distance(to: to)
      guard gap <= 2_000 else { throw TileflowRoutingError.invalid() }
      total += gap
    }
    guard total <= 200_000 else { throw TileflowRoutingError.invalid() }
    var body = try RoutingWire.travel(mode: mode, vehicle: vehicle, avoid: [], traffic: nil)
    body["trace"] = .array(trace.map(ServiceJSON.position))
    if let timestamps {
      guard timestamps.count == trace.count,
        timestamps.allSatisfy({ (0...4_102_444_800).contains($0) }),
        zip(timestamps, timestamps.dropFirst()).allSatisfy({ $0 <= $1 })
      else { throw TileflowRoutingError.invalid() }
      body["timestamps"] = .array(timestamps.map { .number(Double($0)) })
    }
    if let accuracy {
      guard accuracy.isFinite, (1...100).contains(accuracy) else {
        throw TileflowRoutingError.invalid()
      }
      body["accuracy"] = .number(accuracy)
    }
    return .object(body)
  }
}

/// The road nearest to a position that the mode can use.
public struct TileflowNearestRequest: Sendable, Equatable {
  public var location: TileflowPosition
  public var mode: TileflowRoutingMode

  public init(location: TileflowPosition, mode: TileflowRoutingMode) {
    self.location = location
    self.mode = mode
  }

  func wireValue() throws -> ServiceJSON {
    guard location.isValid else { throw TileflowRoutingError.invalid() }
    return .object(["location": .position(location), "mode": .string(mode.rawValue)])
  }
}

enum RoutingWire {
  static func travel(
    mode: TileflowRoutingMode, vehicle: TileflowVehicle?, avoid: [TileflowRoutingAvoidance],
    traffic: TileflowRoutingTraffic?
  ) throws -> [String: ServiceJSON] {
    guard vehicle == nil || mode == .truck, Set(avoid).count == avoid.count else {
      throw TileflowRoutingError.invalid()
    }
    var body: [String: ServiceJSON] = ["mode": .string(mode.rawValue)]
    if let vehicle { body["vehicle"] = try vehicle.wireValue() }
    if !avoid.isEmpty { body["avoid"] = .array(avoid.map { .string($0.rawValue) }) }
    if let traffic { body["traffic"] = .string(traffic.rawValue) }
    return body
  }
}
