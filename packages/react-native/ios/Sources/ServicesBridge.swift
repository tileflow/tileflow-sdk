import Foundation
import TileflowConfiguration
import TileflowElevation
import TileflowGeoIP
import TileflowRouting
import TileflowSearch

/// The native service clients a bridge call uses. Tests give clients a stub session.
struct ServiceClients: Sendable {
  var search: TileflowSearch
  var routing: TileflowRouting
  var elevation: TileflowElevation
  var geoIP: TileflowGeoIP

  /// Clients that read the process configuration on every call, as the Swift SDK does.
  static let standard = ServiceClients(
    search: TileflowSearch(), routing: TileflowRouting(), elevation: TileflowElevation(),
    geoIP: TileflowGeoIP())
}

/// A failed bridge call as JavaScript receives it: a code, a message and the error's fields.
struct BridgeFailure: Error {
  let code: String
  let message: String
  let info: [String: Any]
}

/// Runs one operation of a native service client from JavaScript arguments.
enum ServicesBridge {
  static func call(
    service: String, operation: String, request value: Any?,
    clients: ServiceClients = .standard
  ) async throws(BridgeFailure) -> [String: Any] {
    do {
      let request = try BridgeObject(value)
      let answer = try await run(service, operation, request, clients)
      return BridgeJSON.encode(answer) as? [String: Any] ?? [:]
    } catch let error as BridgeArgumentError {
      throw BridgeFailure(
        code: "invalidRequest", message: error.description, info: ["kind": "invalidRequest"])
    } catch {
      throw failure(error)
    }
  }

  /// Which services, and the map, have a credential in the configuration. Never the credential.
  static func configuredServices(
    _ configuration: () throws -> TileflowConfiguration = { try Tileflow.configuration() }
  ) -> [String: Bool] {
    let configuration = try? configuration()
    var result = ["map": configuration?.mapCredential != nil]
    for service in TileflowService.allCases {
      result[service.rawValue] = configuration?.credential(for: service) != nil
    }
    return result
  }

  private static func run(
    _ service: String, _ operation: String, _ request: BridgeObject, _ clients: ServiceClients
  ) async throws -> Any {
    switch (service, operation) {
    case ("search", "geocode"): return try await clients.search.geocode(geocode(request))
    case ("search", "reverseGeocode"):
      return try await clients.search.reverseGeocode(reverseGeocode(request))
    case ("search", "autocomplete"):
      return try await clients.search.autocomplete(autocomplete(request))
    case ("search", "resolveSuggestion"):
      return try await clients.search.resolveSuggestion(
        TileflowResolveSuggestionRequest(
          token: request.string("token"),
          include: request.choices("include", TileflowPlaceDetail.self)))
    case ("search", "searchNearby"): return try await clients.search.searchNearby(nearby(request))
    case ("search", "listCategories"): return try await clients.search.listCategories()
    case ("routing", "route"): return try await clients.routing.route(route(request))
    case ("routing", "isochrone"): return try await clients.routing.isochrone(isochrone(request))
    case ("routing", "matrix"): return try await clients.routing.matrix(matrix(request))
    case ("routing", "match"): return try await clients.routing.match(match(request))
    case ("routing", "nearest"):
      return try await clients.routing.nearest(
        TileflowNearestRequest(location: request.position("location"), mode: mode(request)))
    case ("elevation", "points"):
      return try await clients.elevation.points(
        request.positions("positions"), unit: unit(request))
    case ("elevation", "elevation"):
      let height = try await clients.elevation.elevation(
        at: request.position("position"), unit: unit(request))
      return ["elevation": height.map { $0 as Any } ?? NSNull()]
    case ("elevation", "batch"):
      return try await clients.elevation.batch(request.positions("positions"), unit: unit(request))
    case ("elevation", "profile"): return try await clients.elevation.profile(profile(request))
    case ("geoip", "locate"): return try await clients.geoIP.locate()
    default:
      throw BridgeArgumentError(path: "operation", expected: "a Tileflow service operation")
    }
  }

  // MARK: Requests

  static func geocode(_ request: BridgeObject) throws -> TileflowGeocodeRequest {
    TileflowGeocodeRequest(
      query: try request.string("query"), language: try request.optionalString("language"),
      limit: try request.optionalInt("limit"), bounds: try request.optionalBoundingBox("bounds"),
      proximity: try request.optionalPosition("proximity"),
      include: try request.choices("include", TileflowPlaceDetail.self))
  }

  static func reverseGeocode(_ request: BridgeObject) throws -> TileflowReverseGeocodeRequest {
    TileflowReverseGeocodeRequest(
      position: try request.position("position"),
      kinds: try request.choices("kinds", TileflowReverseGeocodingKind.self),
      language: try request.optionalString("language"),
      limit: try request.optionalInt("limit") ?? 1,
      include: try request.choices("include", TileflowPlaceDetail.self))
  }

  static func autocomplete(_ request: BridgeObject) throws -> TileflowAutocompleteRequest {
    TileflowAutocompleteRequest(
      query: try request.string("query"), language: try request.optionalString("language"),
      limit: try request.optionalInt("limit") ?? 5,
      bounds: try request.optionalBoundingBox("bounds"),
      proximity: try request.optionalPosition("proximity"),
      includesPlaces: try request.bool("includesPlaces", default: false))
  }

  static func nearby(_ request: BridgeObject) throws -> TileflowNearbyRequest {
    TileflowNearbyRequest(
      position: try request.position("position"),
      radiusMeters: try request.optionalInt("radiusMeters"),
      bounds: try request.optionalBoundingBox("bounds"),
      includeCategories: try request.strings("includeCategories"),
      excludeCategories: try request.strings("excludeCategories"),
      countries: try request.strings("countries"),
      language: try request.optionalString("language"),
      include: try request.choices("include", TileflowPlaceDetail.self),
      limit: try request.optionalInt("limit") ?? 20, cursor: try request.optionalString("cursor"))
  }

  static func mode(_ request: BridgeObject) throws -> TileflowRoutingMode {
    guard let mode = try request.choice("mode", TileflowRoutingMode.self) else {
      throw BridgeArgumentError(path: "\(request.path).mode", expected: "a routing mode")
    }
    return mode
  }

  static func vehicle(_ request: BridgeObject) throws -> TileflowVehicle? {
    guard let vehicle = try request.optionalObject("vehicle") else { return nil }
    return TileflowVehicle(
      heightMeters: try vehicle.optionalDouble("heightMeters"),
      widthMeters: try vehicle.optionalDouble("widthMeters"),
      lengthMeters: try vehicle.optionalDouble("lengthMeters"),
      weightTonnes: try vehicle.optionalDouble("weightTonnes"),
      axleLoadTonnes: try vehicle.optionalDouble("axleLoadTonnes"),
      axleCount: try vehicle.optionalInt("axleCount"),
      hazardousMaterials: try vehicle.optionalBool("hazardousMaterials"))
  }

  static func route(_ request: BridgeObject) throws -> TileflowRouteRequest {
    TileflowRouteRequest(
      locations: try request.positions("locations"), mode: try mode(request),
      vehicle: try vehicle(request),
      avoid: try request.choices("avoid", TileflowRoutingAvoidance.self),
      traffic: try request.choice("traffic", TileflowRoutingTraffic.self),
      alternatives: try request.optionalInt("alternatives") ?? 0,
      language: try request.choice("language", TileflowRoutingLanguage.self))
  }

  static func isochrone(_ request: BridgeObject) throws -> TileflowIsochroneRequest {
    TileflowIsochroneRequest(
      location: try request.position("location"), mode: try mode(request),
      minutes: try request.ints("minutes"), vehicle: try vehicle(request),
      avoid: try request.choices("avoid", TileflowRoutingAvoidance.self),
      traffic: try request.choice("traffic", TileflowRoutingTraffic.self))
  }

  static func matrix(_ request: BridgeObject) throws -> TileflowMatrixRequest {
    TileflowMatrixRequest(
      sources: try request.positions("sources"), targets: try request.positions("targets"),
      mode: try mode(request), vehicle: try vehicle(request),
      avoid: try request.choices("avoid", TileflowRoutingAvoidance.self),
      traffic: try request.choice("traffic", TileflowRoutingTraffic.self))
  }

  static func match(_ request: BridgeObject) throws -> TileflowMatchRequest {
    TileflowMatchRequest(
      trace: try request.positions("trace"), mode: try mode(request),
      timestamps: request.has("timestamps") ? try request.ints("timestamps") : nil,
      accuracy: try request.optionalDouble("accuracy"), vehicle: try vehicle(request))
  }

  static func unit(_ request: BridgeObject) throws -> TileflowElevationUnit {
    try request.choice("unit", TileflowElevationUnit.self) ?? .meters
  }

  static func profile(_ request: BridgeObject) throws -> TileflowElevationProfileRequest {
    let line = try request.object("line")
    let value: TileflowElevationLine
    switch try line.string("type") {
    case "LineString": value = .lineString(try line.positions("coordinates"))
    case "MultiLineString":
      value = .multiLineString(
        try line.array("coordinates").enumerated().map { index, part in
          guard let part = part as? [Any] else {
            throw BridgeArgumentError(
              path: "\(line.path).coordinates[\(index)]", expected: "a list of positions")
          }
          return try BridgeObject.positions(part, path: "\(line.path).coordinates[\(index)]")
        })
    case "Polyline":
      value = .polyline(
        encoded: try line.string("encoded"), precision: try line.optionalInt("precision") ?? 5)
    default:
      throw BridgeArgumentError(
        path: "\(line.path).type", expected: "LineString, MultiLineString or Polyline")
    }
    return TileflowElevationProfileRequest(
      line: value, interval: try request.optionalDouble("interval"),
      maxSamples: try request.optionalInt("maxSamples"),
      climbThreshold: try request.optionalDouble("climbThreshold"), unit: try unit(request))
  }

  // MARK: Errors

  static func failure(_ error: Error) -> BridgeFailure {
    let fields: (TileflowServiceErrorKind, String?, Int?, String?, TimeInterval?, String)
    switch error {
    case let error as TileflowSearchError:
      fields = (
        error.kind, error.code?.rawValue, error.status, error.requestID, error.retryAfter,
        error.message
      )
    case let error as TileflowRoutingError:
      fields = (
        error.kind, error.code?.rawValue, error.status, error.requestID, error.retryAfter,
        error.message
      )
    case let error as TileflowElevationError:
      fields = (
        error.kind, error.code?.rawValue, error.status, error.requestID, error.retryAfter,
        error.message
      )
    case let error as TileflowGeoIPError:
      fields = (
        error.kind, error.code?.rawValue, error.status, error.requestID, error.retryAfter,
        error.message
      )
    default:
      return BridgeFailure(
        code: "network", message: "Tileflow service request failed", info: ["kind": "network"])
    }
    let kind = "\(fields.0)"
    var info: [String: Any] = ["kind": kind]
    if let code = fields.1 { info["code"] = code }
    if let status = fields.2 { info["status"] = status }
    if let requestID = fields.3 { info["requestId"] = requestID }
    if let retryAfter = fields.4 { info["retryAfter"] = (retryAfter * 1000).rounded() }
    return BridgeFailure(code: fields.1 ?? kind, message: fields.5, info: info)
  }
}
