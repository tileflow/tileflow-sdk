import Foundation
import TileflowConfiguration
import XCTest

@testable import Tileflow
@testable import TileflowElevation
@testable import TileflowRouting
@testable import TileflowSearch
@testable import TileflowServiceContent

/// Configuration, request validation and work done on the device without a service.
final class LocalTests: XCTestCase {
  let contract = ServiceContract.shared
  let session = ServiceStub.session()
  let madrid = TileflowPosition(longitude: -3.7038, latitude: 40.4168)

  override func tearDown() {
    Tileflow.resetConfiguration()
    super.tearDown()
  }

  // MARK: Configuration

  func testCredentialsArePublishableAndNeverDescribed() throws {
    let value = contract.credential
    let credential = try TileflowCredential(value)
    for text in ["\(credential)", String(reflecting: credential), dumped(credential)] {
      XCTAssertFalse(text.contains(value.dropFirst(10)), text)
    }
    for invalid in [
      "tf_live_0123456789abcdef0123456789abcdef0123456789abcdef",
      "tf_public_0123456789ABCDEF0123456789abcdef0123456789abcdef",
      "tf_public_0123", " \(value)",
    ] {
      XCTAssertThrowsError(try TileflowCredential(invalid))
    }
    let configuration = contract.configuration()
    XCTAssertFalse(dumped(configuration).contains(value.dropFirst(10)))
  }

  func testAPIOriginsAreHTTPSOrigins() throws {
    let normalized = try TileflowConfiguration(
      apiOrigin: URL(string: "HTTPS://API.Example.test:443/")!)
    XCTAssertEqual(normalized.apiOrigin.absoluteString, "https://api.example.test")
    XCTAssertEqual(
      try TileflowConfiguration(apiOrigin: URL(string: "http://127.0.0.1:8787")!).apiOrigin
        .absoluteString, "http://127.0.0.1:8787")
    for invalid in [
      "http://api.example.test", "https://api.example.test/v1", "https://user@api.example.test",
      "https://api.example.test/?a=1", "ftp://api.example.test",
    ] {
      XCTAssertThrowsError(try TileflowConfiguration(apiOrigin: URL(string: invalid)!), invalid)
    }
  }

  func testInfoPlistConfiguration() throws {
    let bundle = try temporaryBundle([
      "TileflowAPIOrigin": "https://api.example.test/",
      "TileflowServicesCredential": contract.credential,
      "TileflowRoutingCredential": "tf_public_ffffffffffffffffffffffffffffffffffffffffffffffff",
      "TileflowMapCredential": "tf_public_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    ])
    let configuration = try TileflowConfiguration.infoPlist(bundle)
    XCTAssertEqual(configuration.apiOrigin.absoluteString, "https://api.example.test")
    XCTAssertEqual(configuration.credential(for: .search)?.value, contract.credential)
    XCTAssertEqual(
      configuration.credential(for: .routing)?.value,
      "tf_public_ffffffffffffffffffffffffffffffffffffffffffffffff")
    XCTAssertNil(configuration.credential(for: .geoIP))
    XCTAssertEqual(
      configuration.mapCredential?.value,
      "tf_public_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

    let blank = try TileflowConfiguration.infoPlist(
      try temporaryBundle(["TileflowSearchCredential": " ", "TileflowServicesCredential": ""]))
    XCTAssertNil(blank.credential(for: .search))

    let empty = try TileflowConfiguration.infoPlist(try temporaryBundle([:]))
    XCTAssertEqual(empty.apiOrigin, TileflowConfiguration.defaultAPIOrigin)
    XCTAssertNil(empty.servicesCredential)

    XCTAssertThrowsError(
      try TileflowConfiguration.infoPlist(
        try temporaryBundle(["TileflowServicesCredential": "tf_live_secret"]))
    ) {
      XCTAssertEqual(
        $0 as? TileflowConfigurationError, .invalidValue(key: "TileflowServicesCredential"))
    }
    XCTAssertThrowsError(
      try TileflowConfiguration.infoPlist(try temporaryBundle(["TileflowAPIOrigin": 42]))
    ) { XCTAssertEqual($0 as? TileflowConfigurationError, .invalidValue(key: "TileflowAPIOrigin")) }
  }

  func testTheExplicitConfigurationReplacesTheNativeOne() async throws {
    Tileflow.configure(contract.configuration())
    XCTAssertEqual(try Tileflow.configuration(), contract.configuration())
    ServiceStub.serve(json: contract.response("routing.nearest"))
    _ = try await TileflowRouting(session: session).nearest(
      TileflowNearestRequest(location: madrid, mode: .driving))
    XCTAssertEqual(ServiceStub.requests.last?.request.url?.host, "api.example.test")
  }

  func testAppIdentities() throws {
    XCTAssertEqual(
      try TileflowAppIdentity(
        id: "dev.tileflow.example", certificateSHA256: String(repeating: "AB:", count: 31) + "AB"
      )
      .certificateSHA256, String(repeating: "ab", count: 32))
    for invalid in ["tileflow", "1dev.tileflow", "dev..tileflow", "dev.tile flow"] {
      XCTAssertThrowsError(try TileflowAppIdentity(id: invalid), invalid)
    }
    XCTAssertThrowsError(
      try TileflowAppIdentity(id: "dev.tileflow.example", certificateSHA256: "abc"))
  }

  // MARK: Requests

  func testRequestsOutsideTheLimitsAreNeverSent() async throws {
    let madrid = self.madrid
    ServiceStub.serve(json: contract.response("search.geocode"))
    let search = TileflowSearch(configuration: contract.configuration(), session: session)
    let routing = TileflowRouting(configuration: contract.configuration(), session: session)
    let elevation = TileflowElevation(configuration: contract.configuration(), session: session)
    let box = TileflowBoundingBox(west: -4, south: 40, east: -3, north: 41)
    let far = TileflowPosition(longitude: 2.1734, latitude: 41.3851)
    let invalid: [(String, @Sendable () async throws -> Void)] = [
      ("blank query", { _ = try await search.geocode(TileflowGeocodeRequest(query: "  ")) }),
      (
        "long query",
        {
          _ = try await search.geocode(
            TileflowGeocodeRequest(query: String(repeating: "a", count: 201)))
        }
      ),
      (
        "control character",
        { _ = try await search.geocode(TileflowGeocodeRequest(query: "Sol\u{7}")) }
      ),
      ("limit", { _ = try await search.geocode(TileflowGeocodeRequest(query: "Sol", limit: 11)) }),
      (
        "language",
        { _ = try await search.geocode(TileflowGeocodeRequest(query: "Sol", language: "Spanish")) }
      ),
      (
        "bounds and proximity",
        {
          _ = try await search.geocode(
            TileflowGeocodeRequest(query: "Sol", bounds: box, proximity: madrid))
        }
      ),
      (
        "repeated detail",
        {
          _ = try await search.geocode(
            TileflowGeocodeRequest(query: "Sol", include: [.timeZone, .timeZone]))
        }
      ),
      (
        "token",
        { _ = try await search.resolveSuggestion(TileflowResolveSuggestionRequest(token: "a b")) }
      ),
      (
        "country",
        {
          _ = try await search.searchNearby(
            TileflowNearbyRequest(position: madrid, countries: ["es"]))
        }
      ),
      (
        "one location",
        { _ = try await routing.route(TileflowRouteRequest(locations: [madrid], mode: .driving)) }
      ),
      (
        "too far to walk",
        {
          _ = try await routing.route(
            TileflowRouteRequest(locations: [madrid, far], mode: .walking))
        }
      ),
      (
        "alternatives with stops",
        {
          _ = try await routing.route(
            TileflowRouteRequest(
              locations: [madrid, madrid, madrid], mode: .driving, alternatives: 1))
        }
      ),
      (
        "vehicle without truck",
        {
          _ = try await routing.route(
            TileflowRouteRequest(
              locations: [madrid, madrid], mode: .driving, vehicle: TileflowVehicle(heightMeters: 4)
            ))
        }
      ),
      (
        "vehicle limits",
        {
          _ = try await routing.route(
            TileflowRouteRequest(
              locations: [madrid, madrid], mode: .truck, vehicle: TileflowVehicle(heightMeters: 11))
          )
        }
      ),
      (
        "repeated avoidance",
        {
          _ = try await routing.route(
            TileflowRouteRequest(
              locations: [madrid, madrid], mode: .driving, avoid: [.tolls, .tolls]))
        }
      ),
      (
        "falling minutes",
        {
          _ = try await routing.isochrone(
            TileflowIsochroneRequest(location: madrid, mode: .walking, minutes: [10, 5]))
        }
      ),
      (
        "matrix distance",
        {
          _ = try await routing.matrix(
            TileflowMatrixRequest(sources: [madrid], targets: [far], mode: .cycling))
        }
      ),
      (
        "trace gap",
        { _ = try await routing.match(TileflowMatchRequest(trace: [madrid, far], mode: .driving)) }
      ),
      (
        "timestamps",
        {
          _ = try await routing.match(
            TileflowMatchRequest(trace: [madrid, madrid], mode: .driving, timestamps: [10, 5]))
        }
      ),
      (
        "invalid position",
        {
          _ = try await routing.nearest(
            TileflowNearestRequest(
              location: TileflowPosition(longitude: 181, latitude: 0), mode: .driving))
        }
      ),
      ("no positions", { _ = try await elevation.points([]) }),
      (
        "too many positions",
        { _ = try await elevation.points(Array(repeating: madrid, count: 101)) }
      ),
      (
        "one-position line",
        {
          _ = try await elevation.profile(
            TileflowElevationProfileRequest(line: .lineString([madrid])))
        }
      ),
      (
        "polyline precision",
        {
          _ = try await elevation.profile(
            TileflowElevationProfileRequest(line: .polyline(encoded: "_p~iF~ps|U", precision: 7)))
        }
      ),
      (
        "samples",
        {
          _ = try await elevation.profile(
            TileflowElevationProfileRequest(line: .lineString([madrid, far]), maxSamples: 1))
        }
      ),
    ]
    for (name, call) in invalid {
      let kind = await errorKind(call)
      XCTAssertEqual(kind, .invalidRequest, name)
    }
    XCTAssertTrue(ServiceStub.requests.isEmpty)
  }

  func testUnsupportedSearchFiltersAreRefusedLikeTheService() async throws {
    let madrid = self.madrid
    let search = TileflowSearch(configuration: contract.configuration(), session: session)
    let box = TileflowBoundingBox(west: -4, south: 40, east: -3, north: 41)
    let calls: [@Sendable () async throws -> Void] = [
      { _ = try await search.geocode(TileflowGeocodeRequest(query: "Sol", include: [.contacts])) },
      {
        _ = try await search.reverseGeocode(
          TileflowReverseGeocodeRequest(position: madrid, include: [.openingHours]))
      },
      {
        _ = try await search.searchNearby(
          TileflowNearbyRequest(position: madrid, radiusMeters: 10, bounds: box))
      },
      {
        _ = try await search.searchNearby(
          TileflowNearbyRequest(
            position: madrid, includeCategories: ["cafe"], excludeCategories: ["cafe"]))
      },
    ]
    for call in calls {
      do {
        try await call()
        XCTFail("An unsupported filter was sent")
      } catch let error as TileflowSearchError {
        XCTAssertEqual(error.kind, .invalidRequest)
        XCTAssertEqual(error.code, .filterUnsupported)
        XCTAssertNil(error.status)
      }
    }
    // Contacts are available inside bounds.
    ServiceStub.serve(
      json: contract.response("search.geocode").replacing(["usage", "units"], with: .number(30)))
    _ = try await search.geocode(
      TileflowGeocodeRequest(query: "Sol", bounds: box, include: [.contacts]))
  }

  // MARK: Elevation on the device

  func testElevationBatchesKeepOrderAndRunFourAtATime() async throws {
    let positions = (0..<250).map { TileflowPosition(longitude: Double($0) / 10, latitude: 40) }
    let active = Counter()
    ServiceStub.serve { _, body in
      let peak = active.enter()
      defer { active.leave() }
      _ = peak
      Thread.sleep(forTimeInterval: 0.05)
      let request = try! ServiceJSON.parse(body!)
      let answered = try! request.required("positions").array().map { position -> ServiceJSON in
        let values = try! position.array()
        return .array([values[0], values[1], values[0]])
      }
      return ServiceStub.Answer(
        body: ServiceJSON.object([
          "schemaVersion": .number(1), "unit": .string("meters"),
          "dataset": .object(["releaseId": .string("terrain"), "zoom": .number(12)]),
          "attribution": .string("© Mapterhorn contributors"),
          "positions": .array(answered), "usage": .object(["units": .number(1)]),
        ]).encoded())
    }
    let batch = try await TileflowElevation(
      configuration: contract.configuration(), session: session
    )
    .batch(positions)
    XCTAssertEqual(batch.positions.map(\.position), positions)
    XCTAssertEqual(batch.positions.map(\.elevation), positions.map(\.longitude))
    XCTAssertEqual(batch.units, 3)
    XCTAssertEqual(batch.attribution, "© Mapterhorn contributors")
    XCTAssertEqual(ServiceStub.requests.count, 3)
    XCTAssertLessThanOrEqual(active.peak, 4)
  }

  func testProfilePointsInterpolateWithinTheirLine() async throws {
    ServiceStub.serve(json: contract.response("elevation.profile"))
    let profile = try await TileflowElevation(
      configuration: contract.configuration(), session: session
    )
    .profile(
      TileflowElevationProfileRequest(
        line: .multiLineString([
          [madrid, TileflowPosition(longitude: -3.7008, latitude: 40.4168)],
          [
            TileflowPosition(longitude: -3.7, latitude: 40.42),
            TileflowPosition(longitude: -3.7, latitude: 40.4209),
          ],
        ]), maxSamples: 6))
    let middle = try XCTUnwrap(profile.point(atDistance: 50.7))
    XCTAssertEqual(middle.line, 0)
    XCTAssertEqual(middle.index, 0)
    XCTAssertEqual(try XCTUnwrap(middle.elevation), 652, accuracy: 1e-9)
    XCTAssertEqual(middle.position.longitude, -3.7032, accuracy: 1e-9)
    // Two lines meet at 253.5 m: the point belongs to the later one, as in the JS profile.
    XCTAssertEqual(profile.point(atDistance: 253.5)?.line, 1)
    XCTAssertEqual(profile.point(atDistance: 253.4)?.line, 0)
    XCTAssertEqual(profile.point(atDistance: 278.5)?.elevation, 662)
    XCTAssertEqual(profile.point(atDistance: 10_000)?.distance, 353.6)
    XCTAssertEqual(profile.point(atDistance: -5)?.distance, 0)
    XCTAssertNil(profile.point(atDistance: .nan))
    XCTAssertEqual(
      profile.nearestSampleIndex(to: TileflowPosition(longitude: -3.7, latitude: 40.4208)), 5)
  }

  func testGPXTracksAndRoutes() throws {
    let gpx = """
      <?xml version="1.0" encoding="UTF-8"?>
      <!-- exported -->
      <gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
        <wpt lat="40" lon="-3"><name>Ignored waypoint</name></wpt>
        <trk>
          <name> Morning &amp; ride </name>
          <trkseg>
            <trkpt lat="40.4168" lon="-3.7038"><ele>650.5</ele></trkpt>
            <trkpt lat="40.4170" lon="-3.7030"/>
          </trkseg>
          <trkseg><trkpt lat="40.5" lon="-3.6"/></trkseg>
        </trk>
        <rte><name>Back</name>
          <rtept lat="40.4170" lon="-3.7030"><ele><![CDATA[651]]></ele></rtept>
          <rtept lat="40.4168" lon="-3.7038"><ele>652</ele></rtept>
        </rte>
      </gpx>
      """
    let track = try TileflowGPX.read(Data(gpx.utf8))
    XCTAssertEqual(track.name, "Morning & ride")
    XCTAssertEqual(track.lines.count, 2)
    XCTAssertEqual(track.lines[0].map(\.elevation), [650.5, nil])
    XCTAssertEqual(track.lines[1].map(\.elevation), [651, 652])
    XCTAssertEqual(
      track.lines[1][0].position, TileflowPosition(longitude: -3.703, latitude: 40.417))

    let request = TileflowElevationProfileRequest(gpx: track)
    guard case .multiLineString(let lines) = request.line else { return XCTFail("Not lines") }
    XCTAssertEqual(lines.map(\.count), [2, 2])

    XCTAssertThrowsError(try TileflowGPX.read(Data("<kml/>".utf8))) {
      XCTAssertEqual($0 as? TileflowGPXError, .notGPX)
    }
    XCTAssertThrowsError(
      try TileflowGPX.read(
        Data(#"<gpx><trk><trkseg><trkpt lat="91" lon="0"/></trkseg></trk></gpx>"#.utf8))
    ) {
      XCTAssertEqual($0 as? TileflowGPXError, .invalidPoint)
    }
    XCTAssertThrowsError(try TileflowGPX.read(Data(#"<gpx><wpt lat="1" lon="1"/></gpx>"#.utf8))) {
      XCTAssertEqual($0 as? TileflowGPXError, .noTrack)
    }
  }

  // MARK: Map content

  func testRouteLayersKeepTheFullGeometryAndShareTheirData() async throws {
    ServiceStub.serve(json: contract.response("routing.route"))
    let answer = try await TileflowRouting(
      configuration: contract.configuration(), session: session
    )
    .route(
      TileflowRouteRequest(
        locations: [
          TileflowPosition(longitude: -80.2195, latitude: 25.7655),
          TileflowPosition(longitude: -80.1312, latitude: 25.7795),
        ], mode: .driving, alternatives: 1))
    // By default the map draws the layers in the route inks of the theme on screen.
    let light = try TileflowGeoJSONLayer.route(answer)
    XCTAssertEqual(
      light.map(\.id),
      ["route-alternatives", "route-glow", "route-casing", "route-line", "route-core"])
    XCTAssertEqual(light.map(\.ink), [.alternative, .glow, .casing, .line, .core])
    XCTAssertTrue(light.allSatisfy { $0.placement == .ground && $0.progress == nil })
    XCTAssertEqual(light.map(\.occludedOpacity), [0, 0, 0, 0.35, 0])
    // Every position reaches the map; the route's layers share one payload.
    func positions(_ layer: TileflowGeoJSONLayer) throws -> [Int] {
      let value = try JSONSerialization.jsonObject(with: layer.geoJSON) as? [String: Any]
      let features = value?["features"] as? [[String: Any]] ?? []
      return features.map {
        (($0["geometry"] as? [String: Any])?["coordinates"] as? [Any])?.count ?? 0
      }
    }
    XCTAssertEqual(try positions(light[3]), [answer.routes[0].geometry.count])
    XCTAssertEqual(try positions(light[0]), [answer.routes[1].geometry.count])
    XCTAssertEqual(Set(light.dropFirst().map(\.digest)).count, 1)
    // Fixed inks draw fixed colours; a theme's zero opacity keeps the layer, invisible.
    let fixed = try TileflowGeoJSONLayer.route(
      answer, selected: 1, inks: .light, progress: TileflowLineProgress(end: 0), idPrefix: "trip")
    XCTAssertEqual(
      fixed.map(\.id),
      ["trip-alternatives", "trip-glow", "trip-casing", "trip-line", "trip-core"])
    XCTAssertEqual(fixed.map(\.color), ["#94a3b8", "#2563eb", "#1e3a8a", "#2563eb", "#dbeafe"])
    XCTAssertEqual(fixed.map(\.opacity), [1, 0.16, 1, 1, 0])
    XCTAssertTrue(fixed.allSatisfy { $0.ink == nil })
    XCTAssertEqual(
      fixed.compactMap(\.progress?.highlight), Array(repeating: "#ffffff", count: 4),
      "every layer but the alternatives draws progress")
    XCTAssertEqual(
      TileflowGeoJSONLayer.routeProgressLayers(idPrefix: "trip"),
      Array(fixed.map(\.id).dropFirst()))
    XCTAssertThrowsError(try TileflowGeoJSONLayer.route(answer, selected: 2))
    XCTAssertTrue(
      GeoJSONText.lines([(2, answer.routes[0].geometry)]).hasPrefix(
        #"{"type":"FeatureCollection","features":[{"type":"Feature","id":2,"#))
    XCTAssertEqual(GeoJSONText.number(-80.2195004), "-80.2195")
    XCTAssertEqual(GeoJSONText.number(25), "25")
    XCTAssertEqual(GeoJSONText.number(-0.0000004), "0")
    XCTAssertEqual(GeoJSONText.number(0.000001), "0.000001")
  }

  func testIsochroneLayersDrawTheLongestTimeFirst() async throws {
    ServiceStub.serve(json: contract.response("routing.isochrone"))
    let answer = try await TileflowRouting(
      configuration: contract.configuration(), session: session
    )
    .isochrone(
      TileflowIsochroneRequest(
        location: TileflowPosition(longitude: -80.1312, latitude: 25.7795), mode: .walking,
        minutes: [5, 10]))
    let layers = try TileflowGeoJSONLayer.isochrones(answer)
    XCTAssertEqual(layers.map(\.id), ["isochrone-10", "isochrone-5"])
    XCTAssertTrue(layers.allSatisfy { $0.kind == .fill && $0.ink == .line })
    let fixed = try TileflowGeoJSONLayer.isochrones(answer, inks: .dark)
    XCTAssertTrue(fixed.allSatisfy { $0.color == "#60a5fa" && $0.ink == nil })
  }

  func testMapHelpers() throws {
    let camera = TileflowCamera(longitude: -3.7, latitude: 40.4, zoom: 12)
    XCTAssertEqual(camera.searchProximity, TileflowPosition(longitude: -3.7, latitude: 40.4))
    XCTAssertNil(TileflowCamera(longitude: -3.7, latitude: 40.4, zoom: 5).searchProximity)
    XCTAssertEqual(
      TileflowCamera(longitude: 190, latitude: 40.4, zoom: 12).searchProximity?.longitude ?? 0,
      -170, accuracy: 1e-9)

    let city = TileflowGeoIPLocation(city: "Madrid", position: madrid)
    XCTAssertEqual(TileflowCamera(approximateLocation: city)?.zoom, 10)
    XCTAssertEqual(
      TileflowCamera(
        approximateLocation: TileflowGeoIPLocation(countryCode: "ES", position: madrid))?.zoom, 4)
    XCTAssertNil(TileflowCamera(approximateLocation: TileflowGeoIPLocation(countryCode: "ES")))

    XCTAssertEqual(
      TileflowCoordinate(madrid), TileflowCoordinate(longitude: -3.7038, latitude: 40.4168))
    XCTAssertEqual(
      TileflowBounds(TileflowBoundingBox(west: 1, south: 2, east: 3, north: 4)),
      TileflowBounds(west: 1, south: 2, east: 3, north: 4))
  }

  // MARK: Helpers

  private func errorKind(_ work: @Sendable () async throws -> Void) async
    -> TileflowServiceErrorKind?
  {
    do {
      try await work()
      return nil
    } catch let error as TileflowSearchError {
      return error.kind
    } catch let error as TileflowRoutingError {
      return error.kind
    } catch let error as TileflowElevationError {
      return error.kind
    } catch {
      return nil
    }
  }

  private func dumped(_ value: Any) -> String {
    var text = ""
    dump(value, to: &text)
    return text
  }

  private func temporaryBundle(_ info: [String: Any]) throws -> Bundle {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
      .appendingPathComponent("Configuration.bundle", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var plist = info
    plist["CFBundleIdentifier"] = "dev.tileflow.tests.configuration"
    let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
    try data.write(to: directory.appendingPathComponent("Info.plist"))
    return try XCTUnwrap(Bundle(url: directory))
  }
}

final class Counter: @unchecked Sendable {
  private let lock = NSLock()
  private var active = 0
  private(set) var peak = 0

  func enter() -> Int {
    lock.withLock {
      active += 1
      peak = max(peak, active)
      return peak
    }
  }

  func leave() { lock.withLock { active -= 1 } }
}
