import Foundation

/// Tileflow Elevation: heights of positions and elevation profiles along lines.
///
/// Every length in a request or an answer uses the request's unit. The client reads the process
/// configuration on every call unless it is given one. It needs a publishable credential with the
/// Elevation permission that lists this app's bundle identifier.
public struct TileflowElevation: Sendable {
  /// Positions in one points request; ``batch(_:unit:)`` splits larger lists.
  public static let maximumPoints = 100
  /// Requests ``batch(_:unit:)`` runs at the same time.
  static let batchConcurrency = 4

  private let transport: ServiceTransport

  /// - Parameters:
  ///   - configuration: Overrides ``Tileflow/configuration()`` for this client.
  ///   - session: The session that sends requests. Redirects are never followed.
  public init(configuration: TileflowConfiguration? = nil, session: URLSession = .shared) {
    transport = ServiceTransport(
      configuration: configuration, session: session, policy: TileflowElevationError.policy)
  }

  /// The heights of 1 to 100 positions, in order. One request and one API unit.
  public func points(_ positions: [TileflowPosition], unit: TileflowElevationUnit = .meters)
    async throws -> TileflowElevationPointsResponse
  {
    try await run {
      guard (1...Self.maximumPoints).contains(positions.count), positions.allSatisfy(\.isValid)
      else { throw TileflowElevationError.invalid() }
      let body = ServiceJSON.object([
        "positions": .array(positions.map(ServiceJSON.position)), "unit": .string(unit.rawValue),
      ])
      return try await call("points", body) { json in
        let answer = try TileflowElevationPointsResponse(json)
        guard answer.positions.count == positions.count, answer.unit == unit else {
          throw ServiceJSONError.invalid
        }
        return answer
      }
    }
  }

  /// The height of one position, or nil where there is no data.
  public func elevation(at position: TileflowPosition, unit: TileflowElevationUnit = .meters)
    async throws -> Double?
  {
    try await points([position], unit: unit).positions[0].elevation
  }

  /// The heights of any number of positions, in order: 100 per request, up to four requests at a
  /// time. Every request uses one API unit.
  public func batch(_ positions: [TileflowPosition], unit: TileflowElevationUnit = .meters)
    async throws -> TileflowElevationBatch
  {
    guard positions.allSatisfy(\.isValid) else {
      throw TileflowElevationError(TileflowElevationError.invalid())
    }
    let chunks = stride(from: 0, to: positions.count, by: Self.maximumPoints).map {
      Array(positions[$0..<min($0 + Self.maximumPoints, positions.count)])
    }
    var answers = [TileflowElevationPointsResponse?](repeating: nil, count: chunks.count)
    try await withThrowingTaskGroup(of: (Int, TileflowElevationPointsResponse).self) { group in
      var next = 0
      func add() {
        let index = next
        next += 1
        group.addTask { (index, try await points(chunks[index], unit: unit)) }
      }
      while next < min(Self.batchConcurrency, chunks.count) { add() }
      while let (index, answer) = try await group.next() {
        answers[index] = answer
        if next < chunks.count { add() }
      }
    }
    let completed = answers.compactMap { $0 }
    var credits: [String] = []
    for answer in completed where !credits.contains(answer.attribution) {
      credits.append(answer.attribution)
    }
    return TileflowElevationBatch(
      positions: completed.flatMap(\.positions), unit: unit,
      attribution: credits.joined(separator: " "),
      units: completed.reduce(0) { $0 + $1.units })
  }

  /// Evenly spaced samples along a line or an encoded polyline, with their distances and a
  /// summary of its climbs, drops and grades. One API unit for every started 100 samples.
  public func profile(_ request: TileflowElevationProfileRequest) async throws
    -> TileflowElevationProfile
  {
    try await run {
      let body = try request.wireValue()
      return try await call("profile", body) { json in
        let profile = try TileflowElevationProfile(json)
        let samples = profile.samples.count
        guard profile.unit == request.unit, samples <= (request.maxSamples ?? 500),
          let last = profile.lines.last, last.upperBound == samples - 1,
          profile.lines.first?.lowerBound == 0,
          zip(profile.lines, profile.lines.dropFirst()).allSatisfy({
            $1.lowerBound == $0.upperBound + 1
          })
        else { throw ServiceJSONError.invalid }
        return profile
      }
    }
  }

  private func call<Answer>(
    _ operation: String, _ body: ServiceJSON, decode: (ServiceJSON) throws -> Answer
  ) async throws -> Answer {
    try await transport.call(
      ServiceRequest(
        service: .elevation, path: "/v1/elevation/\(operation)", body: body,
        maximumRequestBytes: 1024 * 1024, maximumResponseBytes: 512 * 1024),
      decode: decode)
  }

  private func run<Answer>(_ work: () async throws -> Answer) async throws -> Answer {
    do {
      return try await work()
    } catch let failure as ServiceFailure {
      throw TileflowElevationError(failure)
    }
  }
}

public enum TileflowElevationUnit: String, Sendable, CaseIterable {
  case meters
  case feet
}

/// The line a profile samples.
public enum TileflowElevationLine: Sendable, Equatable {
  /// 2 to 20,000 positions.
  case lineString([TileflowPosition])
  /// 1 to 100 lines of 2 to 20,000 positions, sampled in order.
  case multiLineString([[TileflowPosition]])
  /// An encoded polyline of precision 5 or 6.
  case polyline(encoded: String, precision: Int = 5)
}

public struct TileflowElevationProfileRequest: Sendable, Equatable {
  public var line: TileflowElevationLine
  /// The spacing of the samples in `unit`. The service chooses one when nil.
  public var interval: Double?
  /// 2 to 1,000 samples; 500 when nil.
  public var maxSamples: Int?
  /// The smallest climb or drop the summary counts, in `unit`.
  public var climbThreshold: Double?
  public var unit: TileflowElevationUnit

  public init(
    line: TileflowElevationLine, interval: Double? = nil, maxSamples: Int? = nil,
    climbThreshold: Double? = nil, unit: TileflowElevationUnit = .meters
  ) {
    self.line = line
    self.interval = interval
    self.maxSamples = maxSamples
    self.climbThreshold = climbThreshold
    self.unit = unit
  }

  /// A profile of a GPX document's tracks and routes. Their recorded heights are not sent.
  public init(
    gpx: TileflowGPXTrack, interval: Double? = nil, maxSamples: Int? = nil,
    climbThreshold: Double? = nil, unit: TileflowElevationUnit = .meters
  ) {
    self.init(
      line: .multiLineString(gpx.lines.map { $0.map(\.position) }), interval: interval,
      maxSamples: maxSamples, climbThreshold: climbThreshold, unit: unit)
  }

  func wireValue() throws -> ServiceJSON {
    var body: [String: ServiceJSON] = ["unit": .string(unit.rawValue)]
    func part(_ positions: [TileflowPosition]) throws -> ServiceJSON {
      guard (2...20_000).contains(positions.count), positions.allSatisfy(\.isValid) else {
        throw TileflowElevationError.invalid()
      }
      return .array(positions.map(ServiceJSON.position))
    }
    switch line {
    case .lineString(let positions):
      body["line"] = .object(["type": .string("LineString"), "coordinates": try part(positions)])
    case .multiLineString(let lines):
      guard (1...100).contains(lines.count) else { throw TileflowElevationError.invalid() }
      body["line"] = .object([
        "type": .string("MultiLineString"), "coordinates": .array(try lines.map(part)),
      ])
    case .polyline(let encoded, let precision):
      guard (2...400_000).contains(encoded.utf16.count), precision == 5 || precision == 6 else {
        throw TileflowElevationError.invalid()
      }
      body["polyline"] = .object([
        "encoded": .string(encoded), "precision": .number(Double(precision)),
      ])
    }
    if let interval {
      guard interval.isFinite, interval > 0 else { throw TileflowElevationError.invalid() }
      body["interval"] = .number(interval)
    }
    if let maxSamples {
      guard (2...1000).contains(maxSamples) else { throw TileflowElevationError.invalid() }
      body["maxSamples"] = .number(Double(maxSamples))
    }
    if let climbThreshold {
      guard climbThreshold.isFinite, climbThreshold >= 0 else {
        throw TileflowElevationError.invalid()
      }
      body["climbThreshold"] = .number(climbThreshold)
    }
    return .object(body)
  }
}
