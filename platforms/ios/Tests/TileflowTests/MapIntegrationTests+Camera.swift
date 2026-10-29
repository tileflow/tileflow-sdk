import SwiftUI
import UIKit
import WebKit
import XCTest

@testable import Tileflow

/// Camera, insets, controls and gestures against the fixture map. They draw the map, so they
/// belong to `MapIntegrationTests`, which runs where WebKit can render.
extension MapIntegrationTests {
  private static let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)

  /// A loaded map in a 390 × 844 window, and the events it reported.
  @MainActor
  private final class Host {
    let view: TileflowMapView
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    var events: [TileflowMapEvent] = []
    var failures: [TileflowMapError] { events.compactMap { if case .failed(let e) = $0 { e } else { nil } } }

    init(options: TileflowMapOptions = .init()) {
      view = TileflowMapView(
        source: TileflowMapSource(
          map: "fixture", manifestURL: URL(string: "http://127.0.0.1:18645/manifest.json")!,
          allowsLoopbackHTTP: true),
        options: options)
      view.automaticallyAdjustsContentInsets = false
      let controller = UIViewController()
      window.rootViewController = controller
      view.frame = window.bounds
      controller.view.addSubview(view)
      view.onEvent = { [unowned self] in self.events.append($0) }
    }

    func close() {
      view.destroy()
      window.isHidden = true
    }
  }

  @MainActor
  private func loadedMap(options: TileflowMapOptions = .init()) async throws -> Host {
    do {
      _ = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18645/manifest.json")!)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    let host = Host(options: options)
    host.window.makeKeyAndVisible()
    try await waitUntil(seconds: 30) {
      host.events.contains { if case .contentReady = $0 { true } else { false } }
    }
    return host
  }

  /// Dispatches DOM input events at points of the map, as WebKit does for a person's input.
  @MainActor
  private func dispatch(_ script: String, on view: TileflowMapView) async throws {
    _ = try await renderer(view).callAsyncJavaScript(
      """
      const target = document.querySelector('.maplibregl-canvas-container');
      const at = (type, x, y, extra = {}) => target.dispatchEvent(
        new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1,
          isPrimary: true, pointerId: 1, ...extra}));
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      \(script)
      """, arguments: [:], in: nil, contentWorld: .page)
  }

  func testCameraMovementsAnswerWithHowTheyEnded() async throws {
    let host = try await loadedMap()
    defer { host.close() }
    let view = host.view
    let start = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 13)
    let result = try await view.jump(to: start)
    XCTAssertEqual(result, .finished)
    XCTAssertEqual(view.currentCamera?.zoom ?? 0, 13, accuracy: 0.001)
    // An eased movement settles at its target, and the synchronous camera follows it.
    let eased = try await view.ease(to: TileflowCameraUpdate(zoom: 14, bearing: 20), duration: 0.3)
    XCTAssertEqual(eased, .finished)
    XCTAssertEqual(view.currentCamera?.bearing ?? 0, 20, accuracy: 0.001)
    XCTAssertFalse(view.isMoving)

    // A later movement replaces a running one, which ends as cancelled.
    let replaced = Task { try await view.ease(to: TileflowCameraUpdate(zoom: 17), duration: 5) }
    try await waitUntil { view.isMoving }
    let flight = try await view.fly(to: start, options: .init(duration: 0.4))
    let replacedResult = try await replaced.value
    XCTAssertEqual(replacedResult, .cancelled)
    XCTAssertEqual(flight, .finished)

    // Stopping the camera cancels the application's movement.
    let stopped = Task { try await view.ease(to: TileflowCameraUpdate(zoom: 17), duration: 5) }
    try await waitUntil { view.isMoving }
    view.stopCamera()
    let stoppedResult = try await stopped.value
    XCTAssertEqual(stoppedResult, .cancelled)

    // Cancelling the calling task stops the movement in the renderer and throws.
    try await view.jump(to: start)
    let abandoned = Task { try await view.ease(to: TileflowCameraUpdate(zoom: 17), duration: 5) }
    try await waitUntil { view.isMoving }
    abandoned.cancel()
    do {
      _ = try await abandoned.value
      XCTFail("A cancelled movement returned.")
    } catch is CancellationError {}
    try await waitUntil { !view.isMoving }
    let afterCancel = try await view.camera()
    XCTAssertLessThan(afterCancel.zoom, 16.5)

    // A person dragging the map interrupts the movement.
    let dragged = Task { try await view.ease(to: TileflowCameraUpdate(zoom: 17), duration: 5) }
    try await waitUntil { view.isMoving }
    try await dispatch(
      """
      at('mousedown', 195, 420);
      for (let step = 1; step <= 6; step++) { at('mousemove', 195 + step * 10, 420 + step * 10); await pause(16); }
      at('mouseup', 255, 480, {buttons: 0});
      """, on: view)
    let draggedResult = try await dragged.value
    XCTAssertEqual(draggedResult, .interrupted)
    XCTAssertTrue(host.failures.isEmpty, "\(host.failures)")
  }

  func testInsetsLimitsAndSteepQueries() async throws {
    let host = try await loadedMap(
      options: .init(controls: .init(scaleBar: true, recenterButton: true)))
    defer { host.close() }
    let view = host.view
    // Content insets centre the camera on the uncovered view and keep the attribution in it.
    view.contentInsets = UIEdgeInsets(top: 0, left: 0, bottom: 300, right: 0)
    var centre = CGPoint.zero
    for _ in 0..<50 {
      try await view.jump(to: TileflowCameraUpdate(center: Self.center, zoom: 16))
      centre = try await view.project(Self.center)
      if abs(centre.y - 272) < 1 { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTAssertEqual(centre.y, (844 - 300) / 2, accuracy: 1)
    let attribution = try await renderer(view).evaluateJavaScript(
      "document.querySelector('.maplibregl-ctrl-bottom-right').style.bottom")
    XCTAssertEqual(attribution as? String, "300px")
    // Native controls stay above the inset.
    let controls = view.subviews.compactMap { $0 as? MapControlsView }.first
    let visible = controls?.subviews.filter { !$0.isHidden } ?? []
    XCTAssertEqual(visible.count, 2, "The scale bar and the recenter button.")
    XCTAssertTrue(visible.allSatisfy { $0.frame.maxY <= 844 - 300 }, "\(visible.map(\.frame))")

    // Feature queries keep working at steep pitches, where the horizon is in view.
    try await view.jump(to: TileflowCameraUpdate(center: Self.center, zoom: 16, pitch: 80))
    var steep: [TileflowRenderedFeature] = []
    for _ in 0..<50 where !steep.contains(where: { $0.layer == "poi" }) {
      steep = try await view.query(at: try await view.project(Self.center))
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTAssertTrue(steep.contains { $0.layer == "poi" }, "Features at pitch 80: \(steep)")
    let horizon = try await view.visibleBounds()
    XCTAssertLessThan(horizon.south, Self.center.latitude)

    // Limits clamp the camera; fitting frames bounds inside the insets.
    var options = view.options
    options.cameraLimits = .init(maxZoom: 15, maxPitch: 60)
    try await view.setOptions(options)
    try await waitUntil { (view.currentCamera?.pitch ?? 85) <= 60.001 }
    let fitted = try await view.fit(
      .init(west: -3.71, south: 40.41, east: -3.69, north: 40.43),
      padding: .init(top: 16, left: 16, bottom: 16, right: 16), animation: .ease(duration: 0.2))
    XCTAssertEqual(fitted, .finished)
    let framed = try await view.camera(
      fitting: [.init(longitude: -3.7005, latitude: 40.4195), .init(longitude: -3.6995, latitude: 40.4205)])
    XCTAssertEqual(framed?.zoom ?? 0, 15, accuracy: 0.001, "The limits cap the fitted zoom.")
    XCTAssertTrue(host.failures.isEmpty, "\(host.failures)")
  }

  func testControlsGesturesAndTouchesReachTheApplication() async throws {
    let host = try await loadedMap(
      options: .init(
        controls: .init(compass: .adaptive, scaleBar: true, recenterButton: true),
        events: .init(level: .camera)))
    defer { host.close() }
    let view = host.view
    let controls = try XCTUnwrap(view.subviews.compactMap { $0 as? MapControlsView }.first)
    XCTAssertTrue(controls.compass.isHidden, "The adaptive compass hides while north is up.")
    try await view.jump(to: TileflowCameraUpdate(bearing: 45))
    XCTAssertFalse(controls.compass.isHidden)
    XCTAssertEqual(controls.compass.accessibilityValue, "Heading 45 degrees")
    host.events.removeAll()
    controls.compass.sendActions(for: .primaryActionTriggered)
    try await waitUntil { abs(view.currentCamera?.bearing ?? 1) < 0.001 && !view.isMoving }
    let reasons = host.events.compactMap { if case .cameraChanged(let c) = $0 { c.reason } else { nil } }
    XCTAssertEqual(Set(reasons), [.gesture], "The compass moves the map for a person.")
    XCTAssertNotNil(controls.scaleBar.accessibilityValue)
    controls.recenter.sendActions(for: .primaryActionTriggered)
    XCTAssertTrue(host.events.contains { if case .recenterRequested = $0 { true } else { false } })

    // Taps carry their point; a press that holds still is a long press and not a tap.
    host.events.removeAll()
    try await dispatch("at('click', 120, 300);", on: view)
    try await waitUntil { host.events.contains { if case .tap = $0 { true } else { false } } }
    let tap = host.events.compactMap { if case .tap(let touch) = $0 { touch } else { nil } }.first
    XCTAssertEqual(tap?.point, CGPoint(x: 120, y: 300))
    host.events.removeAll()
    try await dispatch(
      "at('pointerdown', 200, 500); await pause(700); at('pointerup', 200, 500); at('click', 200, 500);",
      on: view)
    try await waitUntil { host.events.contains { if case .longPress = $0 { true } else { false } } }
    try await Task.sleep(for: .milliseconds(200))
    XCTAssertFalse(host.events.contains { if case .tap = $0 { true } else { false } })

    // Gestures report their start and end at the camera level.
    host.events.removeAll()
    try await dispatch(
      """
      at('mousedown', 195, 420);
      for (let step = 1; step <= 6; step++) { at('mousemove', 195 - step * 10, 420); await pause(16); }
      at('mouseup', 135, 420, {buttons: 0});
      """, on: view)
    try await waitUntil {
      host.events.contains { if case .gestureEnded(.pan) = $0 { true } else { false } }
    }
    XCTAssertTrue(host.events.contains { if case .gestureStarted(.pan) = $0 { true } else { false } })
    XCTAssertTrue(host.failures.isEmpty, "\(host.failures)")
  }

  func testABoundCameraFollowsTheMapAndMovesItWithoutEchoes() async throws {
    do {
      _ = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18645/manifest.json")!)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    final class Model: ObservableObject {
      @Published var camera = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 12)
      var writes: [TileflowCamera] = []
      var ready = false
    }
    let model = Model()
    let controller = TileflowMapController()
    struct Screen: View {
      @ObservedObject var model: Model
      let controller: TileflowMapController
      var body: some View {
        TileflowMap(
          source: TileflowMapSource(
            map: "fixture", manifestURL: URL(string: "http://127.0.0.1:18645/manifest.json")!,
            allowsLoopbackHTTP: true),
          camera: Binding(
            get: { model.camera },
            set: {
              model.writes.append($0)
              model.camera = $0
            }),
          controller: controller,
          onEvent: { event in if case .contentReady = event { model.ready = true } }
        )
      }
    }
    // SwiftUI lays out only windows that belong to a scene.
    let window =
      (UIApplication.shared.connectedScenes.first as? UIWindowScene).map {
        UIWindow(windowScene: $0)
      } ?? UIWindow()
    window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    window.rootViewController = UIHostingController(rootView: Screen(model: model, controller: controller))
    window.makeKeyAndVisible()
    window.layoutIfNeeded()
    defer { window.isHidden = true }
    try await waitUntil(seconds: 30) { model.ready }
    XCTAssertEqual(controller.currentCamera?.zoom ?? 0, 12, accuracy: 0.001)
    try await Task.sleep(for: .milliseconds(300))
    model.writes.removeAll()

    // The application writes the binding: the map moves there and reports it back once.
    model.camera = TileflowCamera(longitude: -3.69, latitude: 40.43, zoom: 14)
    try await waitUntil { abs((controller.currentCamera?.zoom ?? 0) - 14) < 0.001 && !controller.isMoving }
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertLessThanOrEqual(model.writes.count, 1, "\(model.writes)")
    // The map moves: the binding follows, and its own write does not move the map again.
    model.writes.removeAll()
    try await controller.ease(to: TileflowCameraUpdate(zoom: 15), duration: 0.3)
    try await waitUntil { abs(model.camera.zoom - 15) < 0.001 }
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertEqual(model.writes.count, 1, "\(model.writes)")
    XCTAssertFalse(controller.isMoving)
  }
}
