import UIKit
import WebKit
import XCTest

@testable import Tileflow

/// A simulated route through the real renderer: the puck, following, gestures and replay. It draws
/// the map, so it belongs to `MapIntegrationTests`, which runs where WebKit can render.
extension MapIntegrationTests {
  func testASimulatedRouteMovesThePuckAndTheCameraThatFollowsIt() async throws {
    do {
      _ = try await URLSession.shared.data(from: FixtureServer.manifest)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    // East along a street for about 170 m, then north for about 110 m.
    let provider = TileflowSimulatedLocationProvider(
      route: [
        .init(longitude: -3.7010, latitude: 40.4200), .init(longitude: -3.6990, latitude: 40.4200),
        .init(longitude: -3.6990, latitude: 40.4210),
      ], speed: 15, horizontalAccuracy: 20, playsAutomatically: false)
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest,
        allowsLoopbackHTTP: true),
      initialCamera: TileflowCamera(longitude: -3.705, latitude: 40.418, zoom: 13),
      options: .init(
        controls: .init(recenterButton: true), events: .init(level: .camera),
        location: .init(enabled: true, puckBearing: .course, followZoom: 16)))
    view.automaticallyAdjustsContentInsets = false
    view.locationProvider = provider
    var events: [TileflowMapEvent] = []
    var loads = 0
    view.onEvent = { event in
      events.append(event)
      if case .contentReady = event { loads += 1 }
    }
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let controller = UIViewController()
    window.rootViewController = controller
    view.frame = window.bounds
    controller.view.addSubview(view)
    window.makeKeyAndVisible()
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await waitFor(#line, seconds: 30) { loads == 1 }

    // The renderer draws the puck where the provider is.
    let start = try XCTUnwrap(view.latestLocation)
    try await assertPuck(on: view, at: start.coordinate)

    // Following zooms in to the location and keeps it at the centre as the route plays.
    view.followMode = .position
    try await waitFor(#line) {
      abs((view.currentCamera?.zoom ?? 0) - 16) < 0.01 && !view.isMoving
        && self.distance(view.currentCamera, start.coordinate) < 1
    }
    events.removeAll()
    for _ in 0..<4 {
      provider.advance(by: 1)
      try await Task.sleep(for: .milliseconds(400))
    }
    let latest = try XCTUnwrap(view.latestLocation)
    try await waitFor(#line) {
      !view.isMoving && self.distance(view.currentCamera, latest.coordinate) < 1
    }
    let reasons = events.compactMap { if case .cameraChanged(let c) = $0 { c.reason } else { nil } }
    XCTAssertEqual(Set(reasons), [.location], "Following moves the camera for the location.")
    XCTAssertEqual(view.currentCamera?.zoom ?? 0, 16, accuracy: 0.01, "Following keeps the zoom.")
    try await assertPuck(on: view, at: latest.coordinate)

    // The course mode turns the map with the travel: east is up on the first leg.
    view.followMode = .course
    try await waitFor(#line) {
      abs((view.currentCamera?.bearing ?? 0) - 90) < 0.5 && !view.isMoving
    }

    // A person dragging the map ends following and says so; the camera stays where they left it.
    events.removeAll()
    _ = try await renderer(view).callAsyncJavaScript(
      """
      const target = document.querySelector('.maplibregl-canvas-container');
      const at = (type, x, y, extra = {}) => target.dispatchEvent(
        new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1,
          isPrimary: true, pointerId: 1, ...extra}));
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      at('pointerdown', 195, 420);
      at('mousedown', 195, 420);
      for (let step = 1; step <= 8; step++) { at('mousemove', 195 + step * 12, 420); await pause(16); }
      at('mouseup', 291, 420, {buttons: 0});
      at('pointerup', 291, 420, {buttons: 0});
      """, arguments: [:], in: nil, contentWorld: .page)
    try await waitFor(#line) { view.followMode == .none }
    let ended = events.compactMap { if case .followModeChanged(let c) = $0 { c } else { nil } }
    XCTAssertEqual(ended, [.init(mode: .none, reason: .gesture)])
    try await waitFor(#line) { !view.isMoving }
    let left = try XCTUnwrap(view.currentCamera)
    provider.advance(by: 2)
    try await Task.sleep(for: .milliseconds(1200))
    XCTAssertEqual(view.currentCamera?.longitude ?? 0, left.longitude, accuracy: 1e-9)
    XCTAssertEqual(view.currentCamera?.latitude ?? 0, left.latitude, accuracy: 1e-9)

    // The recenter button follows again, with the mode followed last.
    view.controlsView.recenter.sendActions(for: .primaryActionTriggered)
    XCTAssertEqual(view.followMode, .course)
    let resumed = try XCTUnwrap(view.latestLocation)
    try await waitFor(#line) {
      !view.isMoving && self.distance(view.currentCamera, resumed.coordinate) < 1
    }

    // A new renderer receives the location and the follow mode again.
    try view.reload()
    try await waitFor(#line, seconds: 30) { loads == 2 }
    try await assertPuck(on: view, at: resumed.coordinate)
    provider.advance(by: 2)
    let moved = try XCTUnwrap(view.latestLocation)
    try await waitFor(#line) {
      !view.isMoving && self.distance(view.currentCamera, moved.coordinate) < 1
    }
    XCTAssertEqual(view.followMode, .course)
    let failures = events.compactMap { if case .failed(let e) = $0 { e } else { nil } }
    XCTAssertTrue(failures.isEmpty, "\(failures)")
  }

  /// Waits for a condition, failing at the line that waited.
  @MainActor
  private func waitFor(
    _ line: UInt, seconds: Int = 5, _ condition: @escaping () -> Bool
  ) async throws {
    for _ in 0..<(seconds * 20) {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("Timed out.", line: line)
  }

  /// The distance in metres between the camera's centre and a coordinate.
  @MainActor
  private func distance(_ camera: TileflowCamera?, _ coordinate: TileflowCoordinate) -> Double {
    guard let camera else { return .infinity }
    return TileflowSimulatedLocationProvider.meters(
      from: .init(longitude: camera.longitude, latitude: camera.latitude), to: coordinate)
  }

  /// The renderer's puck is under the coordinate.
  @MainActor
  private func assertPuck(on view: TileflowMapView, at coordinate: TileflowCoordinate) async throws
  {
    var observed: [TileflowRenderedFeature] = []
    for _ in 0..<50 {
      if let point = try? await view.project(coordinate),
        let features = try? await view.query(at: point)
      {
        observed = features
        if features.contains(where: { $0.layer == "__tileflow_location_dot" }) { return }
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTFail("The puck is not at \(coordinate): \(observed)")
  }
}
