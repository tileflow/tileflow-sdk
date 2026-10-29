import CoreLocation
import XCTest

@testable import Tileflow

/// Location providers, the follow mode and what the map sends the renderer, without rendering.
@MainActor
final class LocationTests: XCTestCase {
  private final class Recorder: TileflowLocationConsumer {
    var locations: [TileflowLocation] = []
    var headings: [TileflowHeading] = []
    func locationUpdated(_ location: TileflowLocation) { locations.append(location) }
    func headingUpdated(_ heading: TileflowHeading) { headings.append(heading) }
  }

  /// About 111 m east, then 111 m north, near the equator.
  private let route = [
    TileflowCoordinate(longitude: 0, latitude: 0),
    TileflowCoordinate(longitude: 0.001, latitude: 0),
    TileflowCoordinate(longitude: 0.001, latitude: 0.001),
  ]

  func testTheSimulatedProviderReplaysARouteAtItsSpeed() {
    let provider = TileflowSimulatedLocationProvider(
      route: route, speed: 10, horizontalAccuracy: 8, playsAutomatically: false)
    XCTAssertEqual(provider.length, 222.4, accuracy: 0.5)
    // A new consumer receives the start of the route at once, travelling east.
    let first = Recorder()
    provider.addConsumer(first)
    XCTAssertEqual(first.locations.count, 1)
    XCTAssertEqual(first.locations[0].coordinate.longitude, 0)
    XCTAssertEqual(first.locations[0].course ?? -1, 90, accuracy: 0.01)
    XCTAssertEqual(first.locations[0].horizontalAccuracy, 8)
    XCTAssertEqual(first.headings.last?.direction ?? -1, 90, accuracy: 0.01)

    // Each step moves by the distance the speed covers; positions between vertices interpolate.
    let halfway = provider.advance(by: 5.56)
    XCTAssertEqual(halfway.coordinate.longitude, 0.0005, accuracy: 0.00001)
    XCTAssertEqual(halfway.coordinate.latitude, 0, accuracy: 1e-9)
    // The second leg goes north.
    let turned = provider.advance(by: 6)
    XCTAssertEqual(turned.coordinate.longitude, 0.001, accuracy: 1e-9)
    XCTAssertGreaterThan(turned.coordinate.latitude, 0)
    XCTAssertEqual(turned.course ?? -1, 0, accuracy: 0.01)
    XCTAssertEqual(first.locations.count, 3)

    // A later consumer starts at the current position; a removed one hears nothing more.
    let second = Recorder()
    provider.addConsumer(second)
    XCTAssertEqual(second.locations, [turned])
    provider.removeConsumer(first)
    provider.advance(by: 100)
    XCTAssertEqual(first.locations.count, 3)
    XCTAssertEqual(second.locations.count, 2)
    // The route ends at its last point, standing still.
    XCTAssertTrue(provider.isFinished)
    XCTAssertEqual(second.locations.last?.coordinate, route.last)
    XCTAssertEqual(second.locations.last?.speed, 0)
  }

  func testALoopingRouteStartsAgainAndProvidersHoldConsumersWeakly() {
    let provider = TileflowSimulatedLocationProvider(
      route: route, speed: 100, loops: true, playsAutomatically: false)
    var consumer: Recorder? = Recorder()
    provider.addConsumer(consumer!)
    provider.addConsumer(consumer!)
    XCTAssertEqual(consumer?.locations.count, 1, "A consumer is added once.")
    let looped = provider.advance(by: 2.5)
    XCTAssertFalse(provider.isFinished)
    XCTAssertEqual(provider.distance, 250 - provider.length, accuracy: 0.001)
    XCTAssertEqual(looped.course ?? -1, 90, accuracy: 0.01)
    weak var released = consumer
    consumer = nil
    XCTAssertNil(released, "A provider never keeps a consumer alive.")
    provider.advance(by: 1)
  }

  func testCoreLocationFixesAndHeadingsConvertWithUnknownValuesLeftOut() {
    let fix = CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 40.42, longitude: -3.7), altitude: 650,
      horizontalAccuracy: 12, verticalAccuracy: -1, course: -1, speed: -1, timestamp: Date())
    let location = try? XCTUnwrap(TileflowLocation(fix))
    XCTAssertEqual(location?.coordinate, TileflowCoordinate(longitude: -3.7, latitude: 40.42))
    XCTAssertEqual(location?.horizontalAccuracy, 12)
    XCTAssertNil(location?.altitude)
    XCTAssertNil(location?.course)
    XCTAssertNil(location?.speed)
    let invalid = CLLocation(
      coordinate: CLLocationCoordinate2D(latitude: 40, longitude: -3), altitude: 0,
      horizontalAccuracy: -1, verticalAccuracy: -1, timestamp: Date())
    XCTAssertNil(TileflowLocation(invalid))

    // The renderer receives the fix with its age, and angles in [0, 360).
    let now = Date()
    var aged = TileflowLocation(
      coordinate: .init(longitude: 1, latitude: 2), timestamp: now.addingTimeInterval(-2.5),
      horizontalAccuracy: 5, course: -90)
    XCTAssertEqual(
      MapLocation.wire(aged, now: now),
      .object([
        "longitude": .number(1), "latitude": .number(2), "age": .number(2500),
        "accuracy": .number(5), "course": .number(270),
      ]))
    aged.timestamp = now.addingTimeInterval(5)
    XCTAssertEqual(MapLocation.wire(aged, now: now)["age"]?.number, 0, "A clock ahead never ages.")
    XCTAssertEqual(MapLocation.normalized(725), 5)
  }

  func testLocationOptionsReachTheRendererWithinTheirRanges() throws {
    XCTAssertEqual(
      try TileflowLocationOptions(enabled: true, puckBearing: .course, staleAfter: 10).wireValue(),
      .object([
        "enabled": .bool(true), "bearing": .string("course"), "accuracy": .bool(true),
        "staleAfterMs": .number(10_000),
      ]))
    XCTAssertThrowsError(try TileflowLocationOptions(staleAfter: 0.5).wireValue())
    XCTAssertThrowsError(try TileflowLocationOptions(followZoom: 30).wireValue())
    var options = TileflowMapOptions()
    options.location = .init(enabled: true)
    XCTAssertEqual(try options.wireValue(rightToLeft: false)["location"]?["enabled"], .bool(true))
  }

  func testTheFollowModeAnswersPeopleAndTheApplication() {
    var state = FollowModeState()
    XCTAssertNil(state.end(.gesture), "Nothing ends while nothing follows.")
    XCTAssertTrue(state.set(.course))
    XCTAssertFalse(state.set(.course))
    // The compass keeps following, north up.
    XCTAssertEqual(state.compass(), TileflowFollowModeChange(mode: .position, reason: .gesture))
    XCTAssertNil(state.compass(), "Following the position, the compass changes no mode.")
    // A gesture ends following; the recenter button returns to the mode followed last.
    XCTAssertEqual(state.end(.gesture), TileflowFollowModeChange(mode: .none, reason: .gesture))
    XCTAssertEqual(state.recenter(), TileflowFollowModeChange(mode: .position, reason: .gesture))
    // Tapping it again turns between following the position and the heading.
    XCTAssertEqual(state.recenter().mode, .heading)
    XCTAssertEqual(state.recenter().mode, .position)
    state.set(.heading)
    XCTAssertEqual(state.end(.api), TileflowFollowModeChange(mode: .none, reason: .api))
    XCTAssertEqual(state.recenter().mode, .heading)
  }

  /// The map's side, without a renderer: what ends following, what reports it and what the
  /// recenter button and compass do.
  func testAMapEndsFollowingForGesturesAndCameraMovesAndReportsIt() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest,
        allowsLoopbackHTTP: true),
      options: .init(controls: .init(recenterButton: true)))
    defer { view.destroy() }
    var events: [TileflowMapEvent] = []
    view.onEvent = { events.append($0) }
    let changes = {
      events.compactMap { if case .followModeChanged(let c) = $0 { c } else { nil } }
    }

    // Without the location shown, the recenter button asks the application.
    view.recenterTapped()
    XCTAssertTrue(events.contains { if case .recenterRequested = $0 { true } else { false } })
    var options = view.options
    options.location = .init(enabled: true)
    try await view.setOptions(options)

    // The application's own changes are not reported back.
    view.followMode = .heading
    XCTAssertEqual(view.followMode, .heading)
    XCTAssertEqual(changes(), [])
    // A gesture the renderer reports for an older request is ignored; the current one ends it.
    let revision = view.location.revision
    view.receiveFollowModeChanged(
      .object(["reason": .string("gesture"), "revision": .number(Double(revision - 1))]))
    XCTAssertEqual(view.followMode, .heading)
    view.receiveFollowModeChanged(
      .object(["reason": .string("gesture"), "revision": .number(Double(revision))]))
    XCTAssertEqual(view.followMode, .none)
    XCTAssertEqual(changes(), [.init(mode: .none, reason: .gesture)])

    // The recenter button follows again; the compass keeps following, north up.
    view.recenterTapped()
    XCTAssertEqual(view.followMode, .heading)
    view.compassTapped()
    XCTAssertEqual(view.followMode, .position)
    XCTAssertEqual(
      Array(changes().suffix(2)),
      [.init(mode: .heading, reason: .gesture), .init(mode: .position, reason: .gesture)])
    XCTAssertEqual(view.controlsView.followMode, .position)

    // A camera movement the application asks for ends following.
    try await view.jump(to: TileflowCamera(longitude: 1, latitude: 1, zoom: 3))
    XCTAssertEqual(view.followMode, .none)
    XCTAssertEqual(changes().last, .init(mode: .none, reason: .api))
    // So does turning the location off.
    view.followMode = .course
    options.location.enabled = false
    try await view.setOptions(options)
    XCTAssertEqual(view.followMode, .none)
    XCTAssertEqual(changes().last, .init(mode: .none, reason: .api))
  }

  func testAMapTakesPositionsOnlyWhileItShowsTheLocationAndIsVisible() async throws {
    let provider = TileflowSimulatedLocationProvider(route: route, playsAutomatically: false)
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest,
        allowsLoopbackHTTP: true))
    defer { view.destroy() }
    view.locationProvider = provider
    view.refreshLocation()
    provider.advance(by: 1)
    XCTAssertNil(view.latestLocation, "The location is off by default.")
    var options = view.options
    options.location.enabled = true
    try await view.setOptions(options)
    provider.advance(by: 1)
    XCTAssertNil(view.latestLocation, "A map outside a window takes no positions.")
    // In a window, the map takes the provider's position at once and each one after it.
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 200, height: 200))
    window.addSubview(view)
    XCTAssertEqual(view.latestLocation, provider.latestLocation)
    let next = provider.advance(by: 1)
    XCTAssertEqual(view.latestLocation, next)
    view.removeFromSuperview()
    provider.advance(by: 1)
    XCTAssertEqual(view.latestLocation, next)
  }
}
