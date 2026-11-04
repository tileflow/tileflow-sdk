import MapLibre
import SwiftUI
import UIKit
import UIKit.UIGestureRecognizerSubclass
import XCTest

@testable import Tileflow

/// `MapIntegrationTests+Camera` on MapLibre Native: movements and how they end, insets, limits,
/// controls, gestures, touches and a bound SwiftUI camera, against the fixture's city map built for
/// the native renderer. There are no DOM events to dispatch: a person's input reaches MapLibre's
/// own gesture handlers and the SDK's recognizers through recognizers whose state and location the
/// test sets.
@MainActor
final class NativeMapCameraIntegrationTests: XCTestCase {
  private static let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)

  /// A loaded native map in a 390 × 844 window, and the events it reported.
  @MainActor
  private final class Host {
    let view: TileflowMapView
    let window = MountedMap.sceneWindow()
    var events: [TileflowMapEvent] = []
    var failures: [TileflowMapError] {
      events.compactMap { if case .failed(let error) = $0 { error } else { nil } }
    }
    var features: [String] {
      events.compactMap {
        guard case .warning(let warning) = $0, warning.error.context.reason == "featureUnavailable"
        else { return nil }
        return warning.error.context.feature
      }
    }
    var reasons: [TileflowCameraChangeReason] {
      events.compactMap { if case .cameraChanged(let change) = $0 { change.reason } else { nil } }
    }

    /// The content insets MapLibre had when the map reported its content.
    var insetsAtLoad: UIEdgeInsets?

    init(options: TileflowMapOptions, insets: UIEdgeInsets = .zero) {
      view = TileflowMapView(
        source: TileflowMapSource(
          map: "city", manifestURL: NativeMapViewIntegrationTests.nativeManifest,
          allowsLoopbackHTTP: true),
        options: options)
      view.engineKind = .native
      view.automaticallyAdjustsContentInsets = false
      view.contentInsets = insets
      view.frame = window.bounds
      view.onEvent = { [unowned self] event in
        if case .contentReady = event, self.insetsAtLoad == nil {
          self.insetsAtLoad = (self.view.engine as? NativeMapEngine)?.mapView?.contentInset
        }
        self.events.append(event)
      }
      window.rootViewController?.view.addSubview(view)
    }

    var engine: NativeMapEngine { view.engine as! NativeMapEngine }
    var mapView: MLNMapView { engine.mapView! }
    var gestures: NativeGestures { engine.gestures! }

    func close() {
      view.destroy()
      window.isHidden = true
    }
  }

  /// The native map is built when the fixture server starts; the first request waits for it.
  private func requireNativeFixture() async throws {
    var request = URLRequest(url: NativeMapViewIntegrationTests.nativeManifest)
    request.timeoutInterval = 180
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run native map integration.")
    }
  }

  private func loadedMap(options: TileflowMapOptions = .init(), insets: UIEdgeInsets = .zero)
    async throws -> Host
  {
    try await requireNativeFixture()
    let host = Host(options: options, insets: insets)
    try await waitUntil(seconds: 60) {
      host.events.contains { if case .contentReady = $0 { true } else { false } }
    }
    return host
  }

  /// A person drags one finger across the map, through MapLibre's own pan handler.
  private func drag(_ host: Host, by offset: CGPoint, steps: Int = 6) {
    let pan = FakePan(view: host.mapView)
    let handle = { (state: UIGestureRecognizer.State) in
      pan.fakeState = state
      host.mapView.perform(NSSelectorFromString("handlePanGesture:"), with: pan)
    }
    handle(.began)
    for _ in 0..<steps {
      pan.translation = CGPoint(x: offset.x / CGFloat(steps), y: offset.y / CGFloat(steps))
      handle(.changed)
    }
    handle(.ended)
  }

  func testAPanInterruptsABlendedCameraShot() async throws {
    let host = try await loadedMap()
    defer { host.close() }
    let start = TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 15)
    let end = TileflowCamera(longitude: -3.65, latitude: 40.44, zoom: 16, bearing: 45, pitch: 30)
    var cues: [String] = []
    let shot = TileflowShot(
      keyframes: [
        .init(time: 0, camera: start, blendPosition: 0),
        .init(time: 0.12, camera: end, blendPosition: 1),
        .init(time: 10, camera: start, blendPosition: 0),
      ],
      themes: ["light", "dark"],
      cues: [.init(time: 0.12, id: "night"), .init(time: 10, id: "late")])
    let playing = Task { try await host.view.play(shot, onCue: { cues.append($0) }) }
    try await waitUntil { cues.contains("night") }
    XCTAssertEqual(host.engine.shown?.theme, "dark")
    drag(host, by: CGPoint(x: 40, y: 15))
    let completed = try await playing.value
    XCTAssertFalse(completed)
    XCTAssertEqual(cues, ["night"])
    XCTAssertTrue(host.reasons.contains(.gesture))
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
    XCTAssertEqual(view.currentCamera?.zoom ?? 0, 14, accuracy: 0.001)
    XCTAssertFalse(view.isMoving)

    // A later movement replaces a running one, which ends as cancelled.
    let replaced = Task { try await view.ease(to: TileflowCameraUpdate(zoom: 17), duration: 5) }
    try await waitUntil { view.isMoving }
    let flight = try await view.fly(to: start, options: .init(duration: 0.4))
    let replacedResult = try await replaced.value
    XCTAssertEqual(replacedResult, .cancelled)
    XCTAssertEqual(flight, .finished)
    XCTAssertEqual(view.currentCamera?.zoom ?? 0, 13, accuracy: 0.001)

    // Stopping the camera cancels the application's movement, and the camera stays there.
    let stopped = Task { try await view.ease(to: TileflowCameraUpdate(zoom: 17), duration: 5) }
    try await waitUntil { view.isMoving }
    view.stopCamera()
    let stoppedResult = try await stopped.value
    XCTAssertEqual(stoppedResult, .cancelled)
    try await waitUntil { !view.isMoving }
    let halted = try await view.camera().zoom
    XCTAssertLessThan(halted, 16.5)
    try await Task.sleep(for: .milliseconds(500))
    let still = try await view.camera().zoom
    XCTAssertEqual(still, halted, accuracy: 0.001)

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
    drag(host, by: CGPoint(x: 60, y: 60))
    let draggedResult = try await dragged.value
    XCTAssertEqual(draggedResult, .interrupted)

    // A flight longer than the limit jumps, and still finishes at its target.
    let far = try await view.fly(
      to: TileflowCamera(longitude: 139.7, latitude: 35.7, zoom: 16), options: .init(speed: 0.01))
    XCTAssertEqual(far, .finished)
    XCTAssertEqual(view.currentCamera?.longitude ?? 0, 139.7, accuracy: 0.001)
    XCTAssertTrue(host.failures.isEmpty, "\(host.failures)")
  }

  func testAMapCreatedWithInsetsHasThemFromItsFirstFrame() async throws {
    let insets = UIEdgeInsets(top: 0, left: 0, bottom: 300, right: 0)
    let host = try await loadedMap(insets: insets)
    defer { host.close() }
    let view = host.view
    // MapLibre had the insets when the content loaded, and the view never needed to send them.
    XCTAssertEqual(host.insetsAtLoad, insets)
    XCTAssertNil(host.engine.received[.setInsets])
    XCTAssertEqual(view.effectiveContentInsets, insets)
    // The map's starting camera centres on the uncovered view without moving.
    let centre = try await view.project(Self.center)
    XCTAssertEqual(centre.y, (844 - 300) / 2, accuracy: 1)
    XCTAssertEqual(centre.x, 390 / 2, accuracy: 1)
    XCTAssertTrue(host.failures.isEmpty, "\(host.failures)")
  }

  func testInsetsLimitsAndSteepQueries() async throws {
    let host = try await loadedMap(
      options: .init(controls: .init(scaleBar: true, recenterButton: true)))
    defer { host.close() }
    let view = host.view
    // Content insets centre the camera on the uncovered view.
    view.contentInsets = UIEdgeInsets(top: 0, left: 0, bottom: 300, right: 0)
    var centre = CGPoint.zero
    for _ in 0..<50 {
      try await view.jump(to: TileflowCameraUpdate(center: Self.center, zoom: 16))
      centre = try await view.project(Self.center)
      if abs(centre.y - 272) < 1 { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTAssertEqual(centre.y, (844 - 300) / 2, accuracy: 1)
    XCTAssertEqual(host.mapView.contentInset.bottom, 300)
    // Native controls stay above the inset.
    let controls = view.subviews.compactMap { $0 as? MapControlsView }.first
    let visible = controls?.subviews.filter { !$0.isHidden } ?? []
    XCTAssertEqual(visible.count, 2, "The scale bar and the recenter button.")
    XCTAssertTrue(visible.allSatisfy { $0.frame.maxY <= 844 - 300 }, "\(visible.map(\.frame))")

    // Feature queries keep working at steep pitches, where the horizon is in view.
    try await view.jump(to: TileflowCameraUpdate(center: Self.center, zoom: 16, pitch: 80))
    var steep: [TileflowRenderedFeature] = []
    for _ in 0..<100 where !steep.contains(where: { $0.layer.hasPrefix("tileflow-buildings") }) {
      steep = try await view.query(at: try await view.project(Self.center))
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTAssertTrue(
      steep.contains { $0.layer.hasPrefix("tileflow-buildings") }, "Features at pitch 80: \(steep)")
    let horizon = try await view.visibleBounds()
    XCTAssertLessThan(horizon.south, Self.center.latitude)

    // Limits clamp the camera; fitting frames bounds inside the insets.
    var options = view.options
    options.cameraLimits = .init(maxZoom: 15, maxPitch: 60)
    try await view.setOptions(options)
    try await waitUntil { (view.currentCamera?.pitch ?? 85) <= 60.001 }
    XCTAssertLessThanOrEqual(view.currentCamera?.zoom ?? 24, 15.001)
    let fitted = try await view.fit(
      .init(west: -3.71, south: 40.41, east: -3.69, north: 40.43),
      padding: .init(top: 16, left: 16, bottom: 16, right: 16), animation: .ease(duration: 0.2))
    XCTAssertEqual(fitted, .finished)
    let north = try await view.project(.init(longitude: -3.70, latitude: 40.43))
    let south = try await view.project(.init(longitude: -3.70, latitude: 40.41))
    XCTAssertGreaterThanOrEqual(north.y, -1)
    XCTAssertLessThanOrEqual(south.y, 844 - 300 + 1)
    let framed = try await view.camera(
      fitting: [
        .init(longitude: -3.7005, latitude: 40.4195), .init(longitude: -3.6995, latitude: 40.4205),
      ])
    XCTAssertEqual(framed?.zoom ?? 0, 15, accuracy: 0.001, "The limits cap the fitted zoom.")

    // Bounds keep the whole view inside them; without bounds the camera moves freely again.
    view.contentInsets = .zero
    options.cameraLimits = .init(
      bounds: .init(west: -3.72, south: 40.40, east: -3.68, north: 40.44))
    try await view.setOptions(options)
    try await view.jump(to: TileflowCamera(longitude: -3.60, latitude: 40.42, zoom: 15))
    let bounded = try await view.visibleBounds()
    XCTAssertLessThanOrEqual(bounded.east, -3.68 + 1e-4, "\(bounded)")
    XCTAssertGreaterThanOrEqual(bounded.west, -3.72 - 1e-4, "\(bounded)")
    options.cameraLimits = .init()
    try await view.setOptions(options)
    try await view.jump(to: TileflowCamera(longitude: -3.60, latitude: 40.42, zoom: 15))
    XCTAssertEqual(view.currentCamera?.longitude ?? 0, -3.60, accuracy: 0.0001)
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
    XCTAssertFalse(host.mapView.showsCompassView, "MapLibre's compass stays hidden.")
    try await view.jump(to: TileflowCameraUpdate(bearing: 45))
    XCTAssertFalse(controls.compass.isHidden)
    XCTAssertEqual(controls.compass.accessibilityValue, "Heading 45 degrees")
    // A touch on a control reaches the control, never the map.
    let onCompass = controls.convert(controls.compass.center, to: view)
    XCTAssertTrue(view.hitTest(onCompass, with: nil)?.isDescendant(of: controls) == true)
    XCTAssertTrue(
      view.hitTest(CGPoint(x: 195, y: 422), with: nil)?.isDescendant(of: host.mapView) == true)
    host.events.removeAll()
    controls.compass.sendActions(for: .primaryActionTriggered)
    try await waitUntil { abs(view.currentCamera?.bearing ?? 1) < 0.001 && !view.isMoving }
    XCTAssertEqual(Set(host.reasons), [.gesture], "The compass moves the map for a person.")
    XCTAssertNotNil(controls.scaleBar.accessibilityValue)
    controls.recenter.sendActions(for: .primaryActionTriggered)
    XCTAssertTrue(host.events.contains { if case .recenterRequested = $0 { true } else { false } })

    // Taps carry their point and coordinate; a long press is reported on its own.
    host.events.removeAll()
    host.gestures.tapped(FakeTap(point: CGPoint(x: 120, y: 300)))
    let tap = host.events.compactMap { if case .tap(let touch) = $0 { touch } else { nil } }.first
    XCTAssertEqual(tap?.point, CGPoint(x: 120, y: 300))
    let tapped = try await view.unproject(CGPoint(x: 120, y: 300))
    XCTAssertEqual(tap?.coordinate.longitude ?? 0, tapped.longitude, accuracy: 1e-9)
    XCTAssertEqual(tap?.coordinate.latitude ?? 0, tapped.latitude, accuracy: 1e-9)
    host.events.removeAll()
    host.gestures.pressed(FakeLongPress(point: CGPoint(x: 200, y: 500)))
    XCTAssertTrue(host.events.contains { if case .longPress = $0 { true } else { false } })
    XCTAssertFalse(host.events.contains { if case .tap = $0 { true } else { false } })

    // Gestures report their start and end at the camera level, and move the map for a person.
    host.events.removeAll()
    drag(host, by: CGPoint(x: -60, y: 0))
    try await waitUntil {
      host.events.contains { if case .gestureEnded(.pan) = $0 { true } else { false } }
    }
    XCTAssertTrue(host.events.contains { if case .gestureStarted(.pan) = $0 { true } else { false } })
    XCTAssertEqual(Set(host.reasons), [.gesture])

    // A double tap zooms by the chosen amount around the point tapped.
    var options = view.options
    options.gestures = TileflowGestures(doubleTapZoomDelta: 2)
    try await view.setOptions(options)
    XCTAssertTrue(host.gestures.doubleTap.isEnabled)
    let zoomTaps = (host.mapView.gestureRecognizers ?? []).compactMap { $0 as? UITapGestureRecognizer }
      .filter { $0.numberOfTapsRequired == 2 && $0 !== host.gestures.doubleTap }
    XCTAssertFalse(zoomTaps.isEmpty)
    XCTAssertTrue(zoomTaps.allSatisfy { !$0.isEnabled }, "MapLibre zooms one level per double tap.")
    let before = try await view.camera()
    let anchor = try await view.unproject(CGPoint(x: 120, y: 300))
    host.events.removeAll()
    host.gestures.doubleTapped(FakeTap(point: CGPoint(x: 120, y: 300)))
    try await waitUntil { !view.isMoving && abs((view.currentCamera?.zoom ?? 0) - before.zoom - 2) < 0.001 }
    let kept = try await view.project(anchor)
    XCTAssertEqual(kept.x, 120, accuracy: 1)
    XCTAssertEqual(kept.y, 300, accuracy: 1)
    XCTAssertEqual(Set(host.reasons), [.gesture])
    XCTAssertTrue(host.events.contains { if case .gestureStarted(.zoom) = $0 { true } else { false } })
    XCTAssertTrue(host.events.contains { if case .gestureEnded(.zoom) = $0 { true } else { false } })

    // Gestures turn off one by one; a static map still reports taps.
    options.gestures = .none
    try await view.setOptions(options)
    let map = host.mapView
    XCTAssertFalse(map.isScrollEnabled || map.isZoomEnabled || map.isRotateEnabled || map.isPitchEnabled)
    XCTAssertFalse(host.gestures.doubleTap.isEnabled)
    XCTAssertTrue(host.gestures.tap.isEnabled)
    // With cooperative gestures one finger leaves the map, and two fingers move it.
    options.gestures = TileflowGestures(cooperative: true)
    try await view.setOptions(options)
    XCTAssertFalse(map.isScrollEnabled)
    XCTAssertTrue(map.isZoomEnabled && map.isRotateEnabled && map.isPitchEnabled)
    XCTAssertTrue(host.gestures.hintPan.isEnabled)
    XCTAssertTrue(host.failures.isEmpty, "\(host.failures)")
  }

  func testThePitchReaches85WithoutAWarning() async throws {
    let host = try await loadedMap()
    defer { host.close() }
    let view = host.view
    let result = try await view.ease(
      to: TileflowCameraUpdate(center: Self.center, zoom: 16, pitch: 85), duration: 0.3)
    XCTAssertEqual(result, .finished)
    let camera = try await view.camera()
    XCTAssertEqual(camera.pitch, 85, accuracy: 0.01)
    XCTAssertEqual(view.currentCamera?.pitch ?? 0, 85, accuracy: 0.01)
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertFalse(host.features.contains("pitchAbove60"), "\(host.features)")
    XCTAssertTrue(host.failures.isEmpty, "\(host.failures)")
  }

  func testABoundCameraFollowsTheMapAndMovesItWithoutEchoes() async throws {
    try await requireNativeFixture()
    final class Model: ObservableObject {
      @Published var camera = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 15)
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
            map: "city", manifestURL: NativeMapViewIntegrationTests.nativeManifest,
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
    // SwiftUI creates the map view; new views use the native engine meanwhile.
    TileflowMapView.defaultEngineKind = .native
    defer { TileflowMapView.defaultEngineKind = .webView }
    let window = MountedMap.sceneWindow()
    window.rootViewController = UIHostingController(rootView: Screen(model: model, controller: controller))
    window.layoutIfNeeded()
    defer { window.isHidden = true }
    try await waitUntil(seconds: 60) { model.ready }
    XCTAssertEqual(controller.currentCamera?.zoom ?? 0, 15, accuracy: 0.001)
    try await Task.sleep(for: .milliseconds(300))
    model.writes.removeAll()

    // The application writes the binding: the map moves there and reports it back once.
    model.camera = TileflowCamera(longitude: -3.69, latitude: 40.43, zoom: 16)
    try await waitUntil { abs((controller.currentCamera?.zoom ?? 0) - 16) < 0.001 && !controller.isMoving }
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertLessThanOrEqual(model.writes.count, 1, "\(model.writes)")
    // The map moves: the binding follows, and its own write does not move the map again.
    model.writes.removeAll()
    try await controller.ease(to: TileflowCameraUpdate(zoom: 17), duration: 0.3)
    try await waitUntil { abs(model.camera.zoom - 17) < 0.001 }
    try await Task.sleep(for: .milliseconds(300))
    XCTAssertEqual(model.writes.count, 1, "\(model.writes)")
    XCTAssertFalse(controller.isMoving)
  }

  private func waitUntil(seconds: Int = 10, _ condition: () -> Bool) async throws {
    for _ in 0..<(seconds * 20) {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("Timed out.")
  }
}

/// A one-finger pan whose state and translation the test sets, for MapLibre's own pan handler.
private final class FakePan: UIPanGestureRecognizer {
  private weak var target: UIView?
  var fakeState: UIGestureRecognizer.State = .possible
  var translation = CGPoint.zero

  init(view: UIView) {
    target = view
    super.init(target: nil, action: nil)
  }

  override var state: UIGestureRecognizer.State {
    get { fakeState }
    set { fakeState = newValue }
  }
  override var view: UIView? { target }
  override var numberOfTouches: Int { 1 }
  override func translation(in view: UIView?) -> CGPoint { translation }
  override func setTranslation(_ translation: CGPoint, in view: UIView?) {
    self.translation = translation
  }
  override func velocity(in view: UIView?) -> CGPoint { .zero }
  override func location(in view: UIView?) -> CGPoint {
    CGPoint(x: (target?.bounds.midX ?? 0), y: (target?.bounds.midY ?? 0))
  }
}

/// A recognized tap at a point, for the SDK's tap and double-tap handlers.
private final class FakeTap: UITapGestureRecognizer {
  private let point: CGPoint

  init(point: CGPoint) {
    self.point = point
    super.init(target: nil, action: nil)
  }

  override var state: UIGestureRecognizer.State {
    get { .ended }
    set {}
  }
  override func location(in view: UIView?) -> CGPoint { point }
}

/// A long press that has just begun at a point, for the SDK's long-press handler.
private final class FakeLongPress: UILongPressGestureRecognizer {
  private let point: CGPoint

  init(point: CGPoint) {
    self.point = point
    super.init(target: nil, action: nil)
  }

  override var state: UIGestureRecognizer.State {
    get { .began }
    set {}
  }
  override func location(in view: UIView?) -> CGPoint { point }
}
