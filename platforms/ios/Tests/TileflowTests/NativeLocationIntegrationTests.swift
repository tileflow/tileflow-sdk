import MapLibre
import UIKit
import XCTest

@testable import Tileflow

@MainActor
final class NativeLocationIntegrationTests: XCTestCase {
  let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)

  private func mount(
    _ provider: any TileflowLocationProvider, zoom: Double = 14,
    location: TileflowLocationOptions = .init(enabled: true)
  ) async throws -> (TileflowMapView, UIWindow, NativeMapEvents) {
    let events = NativeMapEvents()
    let view = TileflowMapView(
      source: .init(
        map: "city", manifestURL: NativeMapViewIntegrationTests.nativeManifest,
        allowsLoopbackHTTP: true),
      initialCamera: .init(
        longitude: center.longitude - 0.005, latitude: center.latitude, zoom: zoom),
      options: .init(
        controls: .init(recenterButton: true), events: .init(level: .camera), location: location))
    view.automaticallyAdjustsContentInsets = false
    view.locationProvider = provider
    let window = MountedMap.sceneWindow()
    view.onEvent = events.receive
    view.frame = window.bounds
    window.rootViewController?.view.addSubview(view)
    try await events.waitForLoads(1)
    return (view, window, events)
  }

  private func until(_ detail: String, line: UInt = #line, _ check: () -> Bool) async throws {
    for _ in 0..<160 {
      if check() { return }
      try await Task.sleep(for: .milliseconds(40))
    }
    XCTFail(detail, line: line)
    throw Timeout.waiting
  }
  private enum Timeout: Error { case waiting }

  private func distance(_ camera: TileflowCamera?, _ coordinate: TileflowCoordinate) -> Double {
    guard let camera else { return .infinity }
    return TileflowSimulatedLocationProvider.meters(
      from: .init(longitude: camera.longitude, latitude: camera.latitude), to: coordinate)
  }

  func testASimulatedProviderMovesThePuckAndNativeTrackingAcrossRendererReplacement() async throws {
    let route = TileflowSimulatedLocationProvider(
      route: [
        center, .init(longitude: -3.695, latitude: 40.42),
        .init(longitude: -3.695, latitude: 40.424),
      ], speed: 15, horizontalAccuracy: 20, playsAutomatically: false)
    let (view, window, events) = try await mount(
      route, location: .init(enabled: true, puckBearing: .course, followZoom: 16))
    defer {
      view.destroy()
      window.isHidden = true
    }
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let map = try XCTUnwrap(engine.mapView)
    XCTAssertTrue(map.locationManager === engine.mapLocation.manager)
    XCTAssertFalse(map.shouldRequestAuthorizationToUseLocationServices)
    try await until("MapLibre did not receive the route") {
      map.userLocation?.location?.coordinate.longitude == self.center.longitude
    }
    XCTAssertEqual(map.userLocation?.location?.horizontalAccuracy, 20)
    XCTAssertTrue(map.showsUserLocation)
    var changes: [TileflowFollowModeChange] = []
    view.onEvent = { event in
      events.receive(event)
      if case .followModeChanged(let change) = event { changes.append(change) }
    }
    let insets = UIEdgeInsets(top: 38, left: 14, bottom: 150, right: 54)
    view.contentInsets = insets
    try await until("The map did not apply its content insets") { map.contentInset == insets }
    events.changes.removeAll()
    view.followMode = .position
    try await until("Native position following did not reach its entry zoom") {
      map.userTrackingMode == .follow && !view.isMoving && abs(map.zoomLevel - 16) < 0.01
        && self.distance(view.currentCamera, self.center) < 1
    }
    let moved = route.advance(by: 4)
    try await until("The native tracker did not follow the new fix") {
      !view.isMoving && self.distance(view.currentCamera, moved.coordinate) < 1
    }
    let projected = try await view.project(moved.coordinate)
    XCTAssertEqual(projected.x, map.bounds.inset(by: insets).midX, accuracy: 1)
    XCTAssertEqual(projected.y, map.bounds.inset(by: insets).midY, accuracy: 1)
    view.followMode = .course
    try await until("The camera did not turn with the route") {
      map.userTrackingMode == .followWithCourse && abs(map.direction - 90) < 0.5
    }
    XCTAssertFalse(events.changes.isEmpty)
    XCTAssertEqual(Set(events.changes.map(\.reason)), [.location])

    let followTouches = try XCTUnwrap(
      map.gestureRecognizers?.compactMap { $0 as? LocationTouches }.first)
    let finger = UITouch()
    let event = UIEvent()
    followTouches.touchesBegan([finger], with: event)
    let left = try await view.camera()
    let held = route.advance(by: 5)
    try await Task.sleep(for: .milliseconds(330))
    XCTAssertEqual(view.followMode, .course)
    XCTAssertLessThan(
      distance(view.currentCamera, .init(longitude: left.longitude, latitude: left.latitude)), 1)
    followTouches.touchesEnded([finger], with: event)
    try await until("A stationary touch failed to resume following") {
      !view.isMoving && self.distance(view.currentCamera, held.coordinate) < 1
        && map.userTrackingMode == .followWithCourse
    }

    let gestures = try XCTUnwrap(engine.gestures)
    gestures.doubleTapped(FakeTap(point: .init(x: map.bounds.midX, y: map.bounds.midY)))
    try await until("A gesture failed to break native following") {
      view.followMode == .none && map.userTrackingMode == .none
    }
    XCTAssertEqual(changes, [.init(mode: .none, reason: .gesture)])
    view.controlsView.recenter.sendActions(for: .primaryActionTriggered)
    try await until("Recenter failed to restore the last mode") {
      map.userTrackingMode == .followWithCourse
    }
    try await view.setTheme("dark")
    XCTAssertTrue(map.showsUserLocation)
    try view.reload()
    try await events.waitForLoads(2)
    let replacement = try XCTUnwrap((view.engine as? NativeMapEngine)?.mapView)
    let last = route.advance(by: 2)
    try await until("A replacement renderer lost course or the provider") {
      replacement.userTrackingMode == .followWithCourse && !view.isMoving
        && self.distance(view.currentCamera, last.coordinate) < 1
    }
    _ = try await view.ease(to: .init(center: center), duration: 0)
    XCTAssertEqual(view.followMode, .none)
    XCTAssertEqual(changes.last, .init(mode: .none, reason: .api))
  }

  func testStoppingFollowDuringEntryLeavesTheCameraWhereItStopped() async throws {
    let provider = LocationInput(at: center, age: 0, course: 1, heading: 24)
    let (view, window, _) = try await mount(provider, zoom: 12)
    defer {
      view.destroy()
      window.isHidden = true
    }
    view.followMode = .position
    try await until("The location camera did not begin its entry") { view.isMoving }
    view.followMode = .none
    try await Task.sleep(for: .milliseconds(80))
    let left = try await view.camera()
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertLessThan(
      distance(view.currentCamera, .init(longitude: left.longitude, latitude: left.latitude)), 1)
    XCTAssertEqual(view.currentCamera?.zoom ?? 0, left.zoom, accuracy: 0.001)
    XCTAssertFalse(view.isMoving)
  }

  func testStaleFixAccuracyAndIndependentHeadingReachTheRenderedPuck() async throws {
    let provider = LocationInput(at: center, age: 24, course: 100, heading: 23)
    let (view, window, events) = try await mount(
      provider, location: .init(enabled: true, puckBearing: .heading))
    defer {
      view.destroy()
      window.isHidden = true
    }
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let map = try XCTUnwrap(engine.mapView)
    func nativePuck() -> NativeLocationPuck? {
      map.userLocation.flatMap { map.view(for: $0) as? NativeLocationPuck }
    }
    try await until("The puck never appeared") { nativePuck()?.superview != nil }
    func pixel() -> PixelReader { PixelReader(NativeOfflineElevationTests.snapshot(window)) }
    func at() -> CGPoint {
      let c = provider.fix.coordinate
      return map.convert(.init(latitude: c.latitude, longitude: c.longitude), toPointTo: window)
    }
    XCTAssertTrue(pixel().matches(at(), 0x1a73e8), "A fix younger than 30 seconds must be blue")
    provider.emit(age: 31, accuracy: 40)
    try await until("A 31-second fix was not grey") { pixel().matches(at(), 0x8e8e93) }
    provider.emit(age: 0, accuracy: 80)
    try await until("A fresh fix failed to restore the puck") { pixel().matches(at(), 0x1a73e8) }
    let puck = try XCTUnwrap(nativePuck())
    let ground = try XCTUnwrap(puck.layer.sublayers?.first)
    let ring = try XCTUnwrap(ground.sublayers?.first as? CAShapeLayer)
    XCTAssertEqual(
      try XCTUnwrap(ring.path).boundingBoxOfPath.width,
      2 * 80 / map.metersPerPoint(atLatitude: center.latitude), accuracy: 0.2)
    var options = view.options
    options.location.showsAccuracy = false
    options.location.staleAfter = 1
    try await view.setOptions(options)
    XCTAssertTrue(ring.isHidden)
    // The timer must repaint an idle map without a fresh fix.
    try await until("The age deadline did not grey the puck") { pixel().matches(at(), 0x8e8e93) }
    provider.emit(age: 0, accuracy: 5)
    view.followMode = .heading
    try await until("The camera followed the course instead of the supplied heading") {
      map.userTrackingMode == .followWithHeading && abs(map.direction - 23) < 0.5
    }
    provider.emit(heading: 76)
    try await until("MapLibre ignored an independent heading update") {
      abs(map.direction - 76) < 0.5
    }
    XCTAssertEqual(map.userLocation?.heading?.trueHeading, 76)
    view.controlsView.compass.sendActions(for: .primaryActionTriggered)
    try await until("The compass did not keep tracking the position facing north") {
      view.followMode == .position && map.userTrackingMode == .follow && abs(map.direction) < 0.5
    }
    options.location.enabled = false
    try await view.setOptions(options)
    XCTAssertFalse(map.showsUserLocation)
    XCTAssertEqual(view.followMode, .none)
    XCTAssertTrue(events.failures.isEmpty)
  }

  func testFollowingHonorsTheRequestedZoomOnBothSidesOfTheNativeThreshold() async throws {
    for (minimum, desired, nativeMode) in [
      (nil as Double?, 4.0, MLNUserTrackingMode.none), (8.0, 8.0, .none), (10.5, 10.5, .follow),
    ] {
      let provider = LocationInput(at: center, age: 0, course: 1, heading: 80)
      let (view, window, events) = try await mount(
        provider, zoom: 4, location: .init(enabled: true, followZoom: minimum))
      defer {
        view.destroy()
        window.isHidden = true
      }
      let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
      let map = try XCTUnwrap(engine.mapView)
      events.changes.removeAll()
      view.followMode = .position
      try await until("The initial zoom changed: \(map.zoomLevel), expected \(desired)") {
        !view.isMoving && abs(map.zoomLevel - desired) < 0.005
          && self.distance(view.currentCamera, self.center) < 5
          && map.userTrackingMode == nativeMode
      }
      let moved = TileflowCoordinate(
        longitude: center.longitude + 0.04, latitude: center.latitude + 0.01)
      provider.emit(at: moved, age: 0, accuracy: 20)
      try await until("The next fix forced MapLibre's default zoom") {
        !view.isMoving && abs(map.zoomLevel - desired) < 0.005
          && self.distance(view.currentCamera, moved) < 5
      }
      XCTAssertFalse(events.changes.isEmpty)
      XCTAssertEqual(Set(events.changes.map(\.reason)), [.location])
      engine.mapView(map, regionWillChangeWith: .gesturePan, animated: false)
      engine.mapView(map, regionDidChangeWith: .gesturePan, animated: false)
      XCTAssertEqual(view.followMode, .none)
    }
  }
}

@MainActor
private final class LocationInput: TileflowLocationProvider {
  var consumers = LocationConsumers()
  var fix: TileflowLocation
  var heading: Double
  init(at coordinate: TileflowCoordinate, age: TimeInterval, course: Double, heading: Double) {
    self.heading = heading
    fix = .init(
      coordinate: coordinate, timestamp: Date().addingTimeInterval(-age), horizontalAccuracy: 20,
      course: course)
  }
  func addConsumer(_ consumer: any TileflowLocationConsumer) {
    _ = consumers.add(consumer)
    consumer.locationUpdated(fix)
    consumer.headingUpdated(.init(direction: heading))
  }
  func removeConsumer(_ consumer: any TileflowLocationConsumer) { consumers.remove(consumer) }
  func emit(at coordinate: TileflowCoordinate? = nil, age: TimeInterval, accuracy: Double) {
    if let coordinate { fix.coordinate = coordinate }
    fix.timestamp = Date().addingTimeInterval(-age)
    fix.horizontalAccuracy = accuracy
    for consumer in consumers.all { consumer.locationUpdated(fix) }
  }
  func emit(heading: Double) {
    self.heading = heading
    for consumer in consumers.all { consumer.headingUpdated(.init(direction: heading)) }
  }
}
