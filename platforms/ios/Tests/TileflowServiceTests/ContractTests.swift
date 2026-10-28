import Foundation
import TileflowConfiguration
import XCTest

@testable import TileflowElevation
@testable import TileflowGeoIP
@testable import TileflowRouting
@testable import TileflowSearch

/// Every operation against the shared wire contract: the canonical typed request must encode to
/// the documented body and the recorded answer must decode.
final class ContractTests: XCTestCase {
  let contract = ServiceContract.shared
  let session = ServiceStub.session()
  let madrid = TileflowPosition(longitude: -3.7038, latitude: 40.4168)

  var search: TileflowSearch {
    TileflowSearch(configuration: contract.configuration(), session: session)
  }
  var routing: TileflowRouting {
    TileflowRouting(configuration: contract.configuration(), session: session)
  }
  var elevation: TileflowElevation {
    TileflowElevation(configuration: contract.configuration(), session: session)
  }
  var geoIP: TileflowGeoIP {
    TileflowGeoIP(configuration: contract.configuration(), session: session)
  }

  func testSearchOperations() async throws {
    contract.serve("search.geocode")
    let forward = try await search.geocode(
      TileflowGeocodeRequest(
        query: "  Puerta del Sol ", language: "es", limit: 3, proximity: madrid))
    XCTAssertEqual(forward.results.map(\.kind), [.place, .street])
    XCTAssertEqual(forward.results[0].name, "Puerta del Sol")
    XCTAssertEqual(forward.results[0].address.countryCode, "ES")
    XCTAssertEqual(forward.results[0].categories.first?.primary, true)
    XCTAssertEqual(forward.attribution.first?.url?.host, "www.openstreetmap.org")
    XCTAssertEqual(forward.units, 10)

    contract.serve("search.reverse")
    let reverse = try await search.reverseGeocode(
      TileflowReverseGeocodeRequest(position: madrid, kinds: [.address]))
    XCTAssertEqual(reverse.results.first?.address.houseNumber, "7")
    XCTAssertEqual(reverse.results.first?.distanceMeters, 12.4)

    contract.serve("search.autocomplete")
    let suggestions = try await search.autocomplete(
      TileflowAutocompleteRequest(query: "Puerta", proximity: madrid))
    XCTAssertEqual(suggestions.suggestions.count, 2)
    XCTAssertNil(suggestions.suggestions[0].place)
    XCTAssertEqual(suggestions.units, 4)

    contract.serve("search.autocompletePlaces")
    let places = try await search.autocomplete(
      TileflowAutocompleteRequest(query: "Puerta", limit: 2, includesPlaces: true))
    XCTAssertEqual(places.suggestions.first?.place?.label, "Puerta del Sol, Madrid, Spain")

    contract.serve("search.resolve")
    let resolved = try await search.resolveSuggestion(
      TileflowResolveSuggestionRequest(
        token: suggestions.suggestions[0].token, include: [.timeZone]))
    XCTAssertEqual(
      resolved.result.timeZone, TileflowTimeZone(name: "Europe/Madrid", utcOffsetSeconds: 3600))

    contract.serve("search.nearby")
    let nearby = try await search.searchNearby(
      TileflowNearbyRequest(
        position: madrid, radiusMeters: 500, includeCategories: ["restaurant"],
        include: [.openingHours], limit: 2))
    XCTAssertEqual(nearby.results.first?.token, "np_0f6c2a9d1b7e4c3a")
    XCTAssertEqual(nearby.results.first?.openingHours.first?.openNow, true)
    XCTAssertEqual(nearby.nextCursor, "nc_2a7f")

    contract.serve("search.categories")
    let categories = try await search.listCategories()
    XCTAssertEqual(categories.categories.map(\.id), ["restaurant", "cafe", "pharmacy"])
  }

  func testRoutingOperations() async throws {
    let littleHavana = TileflowPosition(longitude: -80.2195, latitude: 25.7655)
    let southBeach = TileflowPosition(longitude: -80.1312, latitude: 25.7795)

    contract.serve("routing.route")
    let route = try await routing.route(
      TileflowRouteRequest(locations: [littleHavana, southBeach], mode: .driving, alternatives: 1))
    XCTAssertEqual(route.routes.count, 2)
    XCTAssertEqual(route.routes[0].distance, 13023)
    XCTAssertEqual(route.routes[0].geometry.count, 531)
    XCTAssertEqual(route.routes[0].legs[0].steps[1].maneuver, .rampRight)
    XCTAssertEqual(route.routes[0].legs[0].steps[1].names, ["I 95 North"])
    XCTAssertEqual(route.network.releaseID, "routing-v1-local-florida-260801-v391")
    XCTAssertEqual(route.traffic, .none)
    XCTAssertEqual(route.units, 5)
    XCTAssertTrue(route.routes[0].hasTolls)
    let bounds = route.routes[0].bounds
    XCTAssertLessThan(bounds.west, bounds.east)

    contract.serve("routing.isochrone")
    let isochrone = try await routing.isochrone(
      TileflowIsochroneRequest(location: southBeach, mode: .walking, minutes: [5, 10]))
    XCTAssertEqual(isochrone.isochrones.map(\.minutes), [5, 10])
    XCTAssertEqual(isochrone.isochrones[0].polygons[0][0].count, 14)

    contract.serve("routing.matrix")
    let matrix = try await routing.matrix(
      TileflowMatrixRequest(
        sources: [littleHavana, TileflowPosition(longitude: -80.1918, latitude: 25.7743)],
        targets: [
          southBeach, TileflowPosition(longitude: -79.0, latitude: 25.0),
          TileflowPosition(longitude: -80.3553, latitude: 25.8195),
        ], mode: .driving))
    XCTAssertEqual(matrix.durations[0], [744, nil, 1338])
    XCTAssertEqual(matrix.distances[1][2], 23489)
    XCTAssertEqual(matrix.units, 6)

    contract.serve("routing.match")
    let match = try await routing.match(
      TileflowMatchRequest(
        trace: [
          TileflowPosition(longitude: -80.1327, latitude: 25.7808),
          TileflowPosition(longitude: -80.1324, latitude: 25.784),
          TileflowPosition(longitude: -80.1321, latitude: 25.787),
          TileflowPosition(longitude: -80.1318, latitude: 25.7922),
        ], mode: .driving))
    XCTAssertEqual(match.points.count, 4)
    XCTAssertEqual(match.points[0]?.distance, 4.7)
    XCTAssertEqual(match.roads.count, 9)

    contract.serve("routing.nearest")
    let nearest = try await routing.nearest(
      TileflowNearestRequest(
        location: TileflowPosition(longitude: -80.1322, latitude: 25.784), mode: .driving))
    XCTAssertEqual(nearest.road.names, ["Washington Avenue"])
    XCTAssertEqual(nearest.road.wayID, 828_443_513)
    XCTAssertEqual(nearest.road.roadClass, .secondary)
    XCTAssertEqual(nearest.road.surface, .pavedSmooth)
    XCTAssertEqual(nearest.road.speedLimit, TileflowSpeedLimit(kmh: 56, source: "tagged"))
    XCTAssertEqual(nearest.units, 1)
  }

  func testElevationOperations() async throws {
    contract.serve("elevation.points")
    let points = try await elevation.points([
      madrid, TileflowPosition(longitude: -16.6423, latitude: 28.2724),
      TileflowPosition(longitude: -30, latitude: 40),
    ])
    XCTAssertEqual(points.positions.map(\.elevation), [657.3, 3715.2, nil])
    XCTAssertEqual(
      points.dataset, TileflowElevationDataset(releaseID: "terrain-v1-2026-09", zoom: 12))

    contract.serve("elevation.profile")
    let profile = try await elevation.profile(
      TileflowElevationProfileRequest(
        line: .multiLineString([
          [madrid, TileflowPosition(longitude: -3.7008, latitude: 40.4168)],
          [
            TileflowPosition(longitude: -3.7, latitude: 40.42),
            TileflowPosition(longitude: -3.7, latitude: 40.4209),
          ],
        ]), maxSamples: 6))
    XCTAssertEqual(profile.lines, [0...2, 3...5])
    XCTAssertEqual(profile.summary.ascent, 20)
    XCTAssertNil(profile.summary.minGrade)
    XCTAssertEqual(profile.samples[3].elevation, nil)
  }

  func testGeoIPOperations() async throws {
    contract.serve("geoip.locate")
    let located = try await geoIP.locate()
    XCTAssertEqual(located.location?.countryCode, "ES")
    XCTAssertEqual(located.location?.isEUCountry, true)
    XCTAssertEqual(
      located.location?.position, TileflowPosition(longitude: -3.7026, latitude: 40.4165))
    XCTAssertEqual(located.units, 0)

    contract.serve("geoip.unavailable")
    let unavailable = try await geoIP.locate()
    XCTAssertNil(unavailable.location)
  }

  func testServiceRequestsCarryTheCredentialAndTheAppIdentity() async throws {
    contract.serve("routing.nearest")
    _ = try await routing.nearest(
      TileflowNearestRequest(
        location: TileflowPosition(longitude: -80.1322, latitude: 25.784), mode: .driving))
    let request = try XCTUnwrap(ServiceStub.requests.last?.request)
    XCTAssertEqual(
      request.value(forHTTPHeaderField: "Authorization"), "Bearer \(contract.credential)")
    XCTAssertEqual(request.value(forHTTPHeaderField: "X-Tileflow-App"), contract.appID)
    XCTAssertNil(request.value(forHTTPHeaderField: "X-Tileflow-App-Certificate"))
    XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "application/json")
    XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
  }

  func testAnAndroidStyleIdentitySendsItsCertificate() async throws {
    let android = try contract.json.required("apps").required("android")
    var configuration = contract.configuration()
    configuration.app = try TileflowAppIdentity(
      id: try android.required("id").string(),
      certificateSHA256: try android.required("certificateSha256").string().uppercased())
    ServiceStub.serve(json: contract.response("routing.nearest"))
    _ = try await TileflowRouting(configuration: configuration, session: session).nearest(
      TileflowNearestRequest(location: madrid, mode: .driving))
    let request = try XCTUnwrap(ServiceStub.requests.last?.request)
    XCTAssertEqual(
      request.value(forHTTPHeaderField: "X-Tileflow-App-Certificate"),
      try android.required("certificateSha256").string())
  }

  func testGeoIPIsAnonymous() async throws {
    contract.serve("geoip.locate")
    _ = try await geoIP.locate()
    let request = try XCTUnwrap(ServiceStub.requests.last?.request)
    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    XCTAssertNil(request.value(forHTTPHeaderField: "X-Tileflow-App"))
  }

  func testAServiceCredentialOverridesTheSharedOne() async throws {
    ServiceStub.serve(json: contract.response("search.geocode"))
    _ = try await TileflowSearch(
      configuration: contract.configuration(search: true), session: session
    ).geocode(TileflowGeocodeRequest(query: "Sol"))
    XCTAssertEqual(
      ServiceStub.requests.last?.request.value(forHTTPHeaderField: "Authorization"),
      "Bearer tf_public_ffffffffffffffffffffffffffffffffffffffffffffffff")
  }

  func testTheMapCredentialNeverAuthorizesAService() async throws {
    ServiceStub.serve(json: contract.response("routing.nearest"))
    let routing = TileflowRouting(
      configuration: contract.configuration(services: false, map: true), session: session)
    do {
      _ = try await routing.nearest(TileflowNearestRequest(location: madrid, mode: .driving))
      XCTFail("A map credential authorized Routing")
    } catch let error as TileflowRoutingError {
      XCTAssertEqual(error.kind, .configuration)
    }
    XCTAssertTrue(ServiceStub.requests.isEmpty)
  }

  func testErrorsFollowTheContract() async throws {
    for failure in contract.errors {
      let operation = try failure.required("operation").string()
      let expect = try failure.required("expect")
      var answer = ServiceStub.Answer(status: try failure.required("status").integer())
      if case .object(let headers) = failure["headers"] {
        for (name, value) in headers { answer.headers[name] = try value.string() }
      }
      answer.body =
        try failure.optional("rawBody").map { Data(try $0.string().utf8) }
        ?? failure.required("body").encoded()
      let served = answer
      ServiceStub.serve { _, _ in served }
      let caught = await capture(operation)
      let expected = (
        kind: try expect.required("kind").string(),
        code: try expect.optional("code")?.string(),
        status: try expect.required("status").integer(),
        requestID: try expect.optional("requestId")?.string(),
        retryAfter: try expect.optional("retryAfterSeconds")?.number(),
        message: try expect.optional("message")?.string()
      )
      let context = "\(operation) \(expected.status)"
      XCTAssertEqual(caught?.kind, .rejected, context)
      XCTAssertEqual(expected.kind, "rejected", context)
      XCTAssertEqual(caught?.code, expected.code, context)
      XCTAssertEqual(caught?.status, expected.status, context)
      XCTAssertEqual(caught?.requestID, expected.requestID, context)
      XCTAssertEqual(caught?.retryAfter, expected.retryAfter, context)
      if let message = expected.message { XCTAssertEqual(caught?.message, message, context) }
    }
  }

  func testAnswersOutsideTheContractAreRejected() async throws {
    let mutations: [(String, [String], ServiceJSON?)] = [
      ("search.geocode", ["usage", "units"], .number(30)),
      ("search.geocode", ["schemaVersion"], .number(2)),
      ("search.geocode", ["queryId"], .string("not-a-query")),
      ("search.autocomplete", ["usage", "units"], .number(10)),
      ("routing.route", ["schemaVersion"], .number(2)),
      ("routing.nearest", ["location"], .array([.number(200), .number(10)])),
      ("routing.nearest", ["road"], nil),
      ("routing.isochrone", ["usage"], nil),
      ("elevation.points", ["unit"], .string("feet")),
      ("elevation.profile", ["lines"], .array([.array([.number(0), .number(2)])])),
      ("geoip.locate", ["usage", "units"], .number(1)),
      ("geoip.locate", ["location", "countryCode"], .string("XX")),
    ]
    for (operation, path, value) in mutations {
      ServiceStub.serve(json: contract.response(operation).replacing(path, with: value))
      let caught = await capture(operation)
      XCTAssertEqual(caught?.kind, .invalidResponse, "\(operation) \(path)")
      XCTAssertEqual(caught?.status, 200, "\(operation) \(path)")
    }
  }

  func testAnswersThatBreakTheRequestsInvariantsAreRejected() async throws {
    let madrid = self.madrid
    // Two routes for a request without alternatives.
    ServiceStub.serve(json: contract.response("routing.route"))
    var caught = await capture { [routing] in
      _ = try await routing.route(
        TileflowRouteRequest(
          locations: [
            TileflowPosition(longitude: -80.2195, latitude: 25.7655),
            TileflowPosition(longitude: -80.1312, latitude: 25.7795),
          ], mode: .driving))
    }
    XCTAssertEqual(caught?.kind, .invalidResponse)

    // Isochrones for other times.
    ServiceStub.serve(json: contract.response("routing.isochrone"))
    caught = await capture { [routing] in
      _ = try await routing.isochrone(
        TileflowIsochroneRequest(location: madrid, mode: .walking, minutes: [5, 15]))
    }
    XCTAssertEqual(caught?.kind, .invalidResponse)

    // A matrix of another shape.
    ServiceStub.serve(json: contract.response("routing.matrix"))
    caught = await capture { [routing] in
      _ = try await routing.matrix(
        TileflowMatrixRequest(sources: [madrid], targets: [madrid], mode: .walking))
    }
    XCTAssertEqual(caught?.kind, .invalidResponse)

    // More results than the limit.
    ServiceStub.serve(json: contract.response("search.geocode"))
    caught = await capture { [search] in
      _ = try await search.geocode(TileflowGeocodeRequest(query: "Sol", limit: 1))
    }
    XCTAssertEqual(caught?.kind, .invalidResponse)
  }

  func testOversizeAnswersAreRejectedWhileReading() async throws {
    var oversize = ServiceStub.Answer()
    oversize.body = Data(repeating: 0x20, count: 9 * 1024)
    oversize.body.append(contract.response("geoip.locate").encoded())
    let served = oversize
    ServiceStub.serve { _, _ in served }
    let caught = await capture("geoip.locate")
    XCTAssertEqual(caught?.kind, .invalidResponse)
  }

  func testRedirectsAreNeverFollowed() async throws {
    ServiceStub.serve { request, _ in
      request.url?.host == "elsewhere.example.test"
        ? ServiceStub.Answer(body: ServiceContract.shared.response("routing.nearest").encoded())
        : ServiceStub.Answer(
          redirect: URL(string: "https://elsewhere.example.test/v1/routing/nearest")!)
    }
    let caught = await capture("routing.nearest")
    XCTAssertEqual(caught?.kind, .network)
    XCTAssertFalse(
      ServiceStub.requests.contains { $0.request.url?.host == "elsewhere.example.test" })
  }

  func testUnreachableServicesAreNetworkFailures() async throws {
    ServiceStub.serve { _, _ in ServiceStub.Answer(unreachable: true) }
    let caught = await capture("search.geocode")
    XCTAssertEqual(caught?.kind, .network)
    XCTAssertNil(caught?.status)
  }

  func testCancellationStopsTheRequest() async throws {
    ServiceStub.serve { _, _ in
      Thread.sleep(forTimeInterval: 2)
      return ServiceStub.Answer(body: ServiceContract.shared.response("routing.nearest").encoded())
    }
    let routing = self.routing
    let madrid = madrid
    let task = Task {
      try await routing.nearest(TileflowNearestRequest(location: madrid, mode: .driving))
    }
    try await Task.sleep(nanoseconds: 100_000_000)
    task.cancel()
    do {
      _ = try await task.value
      XCTFail("A cancelled request finished")
    } catch {
      XCTAssertTrue(error is CancellationError, "\(error)")
    }
  }

  // MARK: Helpers

  struct Caught {
    var kind: TileflowServiceErrorKind
    var code: String?
    var status: Int?
    var requestID: String?
    var retryAfter: TimeInterval?
    var message: String
  }

  /// Calls a fixture operation with its canonical request and returns its error.
  func capture(_ operation: String) async -> Caught? {
    let search = self.search
    let routing = self.routing
    let elevation = self.elevation
    let geoIP = self.geoIP
    let madrid = madrid
    return await capture {
      switch operation {
      case "search.geocode":
        _ = try await search.geocode(
          TileflowGeocodeRequest(
            query: "Puerta del Sol", language: "es", limit: 3, proximity: madrid))
      case "search.autocomplete":
        _ = try await search.autocomplete(
          TileflowAutocompleteRequest(query: "Puerta", proximity: madrid))
      case "search.resolve":
        _ = try await search.resolveSuggestion(
          TileflowResolveSuggestionRequest(
            token: "sg_7b1e4f2a9c0d3e5f6a7b8c9d0e1f2a3b", include: [.timeZone]))
      case "routing.route":
        _ = try await routing.route(
          TileflowRouteRequest(
            locations: [
              TileflowPosition(longitude: -80.2195, latitude: 25.7655),
              TileflowPosition(longitude: -80.1312, latitude: 25.7795),
            ], mode: .driving, alternatives: 1))
      case "routing.isochrone":
        _ = try await routing.isochrone(
          TileflowIsochroneRequest(
            location: TileflowPosition(longitude: -80.1312, latitude: 25.7795), mode: .walking,
            minutes: [5, 10]))
      case "routing.nearest":
        _ = try await routing.nearest(TileflowNearestRequest(location: madrid, mode: .driving))
      case "elevation.points":
        _ = try await elevation.points([
          madrid, TileflowPosition(longitude: -16.6423, latitude: 28.2724),
          TileflowPosition(longitude: -30, latitude: 40),
        ])
      case "elevation.profile":
        _ = try await elevation.profile(
          TileflowElevationProfileRequest(
            line: .multiLineString([
              [madrid, TileflowPosition(longitude: -3.7008, latitude: 40.4168)],
              [
                TileflowPosition(longitude: -3.7, latitude: 40.42),
                TileflowPosition(longitude: -3.7, latitude: 40.4209),
              ],
            ]), maxSamples: 6))
      case "geoip.locate":
        _ = try await geoIP.locate()
      default:
        XCTFail("No canonical call for \(operation)")
      }
    }
  }

  func capture(_ work: @Sendable () async throws -> Void) async -> Caught? {
    do {
      try await work()
      return nil
    } catch let error as TileflowSearchError {
      return Caught(
        kind: error.kind, code: error.code?.rawValue, status: error.status,
        requestID: error.requestID, retryAfter: error.retryAfter, message: error.message)
    } catch let error as TileflowRoutingError {
      return Caught(
        kind: error.kind, code: error.code?.rawValue, status: error.status,
        requestID: error.requestID, retryAfter: error.retryAfter, message: error.message)
    } catch let error as TileflowElevationError {
      return Caught(
        kind: error.kind, code: error.code?.rawValue, status: error.status,
        requestID: error.requestID, retryAfter: error.retryAfter, message: error.message)
    } catch let error as TileflowGeoIPError {
      return Caught(
        kind: error.kind, code: error.code?.rawValue, status: error.status,
        requestID: error.requestID, retryAfter: error.retryAfter, message: error.message)
    } catch {
      XCTFail("Unexpected error \(error)")
      return nil
    }
  }
}
