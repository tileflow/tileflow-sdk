import Foundation
import MapLibre
import UIKit
import XCTest

@testable import Tileflow

/// The map view's integration checks on MapLibre Native: loading, theme changes, blends, emphasis,
/// the view mode, degradation warnings, renderer recovery and camera events. They use the fixture's
/// self-hosted map built for the native renderer (`/native/manifest.json`) and its Hosted map's
/// `native-v1` representation. There is no data channel to a web process: what the WebView suite
/// reads with JavaScript, these checks read from the view and its engine.
@MainActor
final class NativeMapViewIntegrationTests: XCTestCase {
  static let nativeManifest = URL(string: "\(FixtureServer.origin)/native/manifest.json")!
  static let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)

  /// The native map is built when the fixture server starts; the first request waits for it.
  private func requireNativeFixture() async throws {
    var request = URLRequest(url: Self.nativeManifest)
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

  private var citySource: TileflowMapSource {
    TileflowMapSource(map: "city", manifestURL: Self.nativeManifest, allowsLoopbackHTTP: true)
  }

  func testOnlineMapLoadsChangesThemeAndRetires() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    let initial = try await view.camera()
    XCTAssertEqual(initial.longitude, -3.70, accuracy: 0.01)
    XCTAssertEqual(initial.zoom, 16, accuracy: 0.01)
    try await assertBuildings(view)
    let point = try await view.project(Self.center)
    let coordinate = try await view.unproject(point)
    XCTAssertEqual(coordinate.longitude, -3.70, accuracy: 0.0001)
    XCTAssertEqual(coordinate.latitude, 40.42, accuracy: 0.0001)

    // Each degradation the style records arrives once, as a warning and in the console.
    try await waitUntil { Set(events.features) == ["scene3d", "sky", "trees3d"] }
    XCTAssertEqual(events.features.sorted(), ["scene3d", "sky", "trees3d"])
    let degradation = try XCTUnwrap(events.warnings.first { $0.error.context.feature == "scene3d" })
    XCTAssertEqual(degradation.error.code, .rendererFailed)
    XCTAssertEqual(degradation.error.context.reason, "featureUnavailable")

    // A theme change reports its phases and the route inks of the theme on screen.
    try await view.setTheme("dark", duration: 0.3)
    XCTAssertEqual(events.transitions.map(\.phase), [.preloading, .applying, .ready])
    XCTAssertEqual(events.transitions.last?.currentTheme, "dark")
    XCTAssertNotNil(events.transitions.last?.routeInks)
    XCTAssertEqual(events.themes, ["dark"])
    try await assertBuildings(view)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let darkInks = try await view.routeInks()

    // A blend loads one style, and moving it changes the live style without loading again.
    try await view.setBlend(themes: ["light", "dark"], position: 0.5)
    XCTAssertEqual(engine.shown?.theme, "dark")
    let loads = engine.received[.setBlend] ?? 0
    try await view.setBlend(themes: ["light", "dark"], position: 0.2)
    XCTAssertEqual(engine.received[.setBlend], loads + 1)
    XCTAssertEqual(engine.shown?.theme, "light")
    let blended = try await view.routeInks()
    XCTAssertNotEqual(blended.line, darkInks.line)
    try await assertBuildings(view)

    // Emphasis recedes a module and returns it to its design.
    try await view.setTheme("light")
    try await view.setEmphasis(.init(recede: [.buildings: 1], labels: 0.5), duration: 0.3)
    let fill = try XCTUnwrap(
      engine.mapView?.style?.layer(withIdentifier: "tileflow-buildings-fill") as? MLNFillStyleLayer)
    let receded = fill.fillColor
    try await view.setEmphasis(nil, duration: 0.2)
    XCTAssertNotEqual(fill.fillColor, receded)

    // The 3D view shows the extrusions that stand in for the scene; the flat view hides them.
    let extrusion = { engine.mapView?.style?.layer(withIdentifier: "tileflow-buildings-native-extrusion") }
    XCTAssertEqual(extrusion()?.isVisible, false)
    try await view.setViewMode(.threeDimensional, duration: 0.3)
    try await waitUntil { extrusion()?.isVisible == true && engine.viewModeMotion == nil }
    try await view.setOptions(.init(viewMode: .flat, quality: .low))
    XCTAssertEqual(extrusion()?.isVisible, false)

    try await view.setCamera(TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 14))
    let camera = try await view.camera()
    XCTAssertEqual(camera.zoom, 14, accuracy: 0.01)
    // The city's buildings draw from z15.
    try await view.setCamera(TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 16))
    try view.reload()
    try await events.waitForLoads(2)
    try await assertBuildings(view)
    XCTAssertTrue(events.failures.isEmpty, "Late map errors: \(events.failures)")
    view.destroy()
    do {
      try await view.setTheme("light")
      XCTFail("A destroyed map accepted an update.")
    } catch {
      XCTAssertEqual(error as? TileflowMapError, .disposed)
    }
  }

  /// The city map holds a world image drawn only below zoom 11, as Streets' climate underlay is. At
  /// zoom 16 no layer draws it, which MapLibre Native takes for an image source still loading: the
  /// map must load all the same, and draw the image once the camera zooms out to it.
  func testAWorldImageOutsideItsZoomsLetsTheMapLoadAndDrawsWhenInRange() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let style = try XCTUnwrap(engine.mapView?.style)
    let underlay = try XCTUnwrap(
      style.layer(withIdentifier: "tileflow-global-landcover-underlay") as? MLNRasterStyleLayer)
    XCTAssertEqual(underlay.maximumZoomLevel, 11)
    XCTAssertTrue(style.source(withIdentifier: "tileflow-landcover-underlay") is MLNRasterTileSource)
    XCTAssertLessThan(Self.underlayShare(window), 0.01, "At zoom 16 no layer draws the image")

    try await view.setCamera(TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 5))
    try await waitUntil { Self.underlayShare(window) > 0.5 }
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  /// The share of the window in the fixture underlay's green, `#01a004`.
  private static func underlayShare(_ window: UIWindow) -> Double {
    let pixels = PixelReader(NativeOfflineElevationTests.snapshot(window))
    var green = 0
    var total = 0
    for y in stride(from: 0, to: pixels.height, by: 8) {
      for x in stride(from: 0, to: pixels.width, by: 8) {
        let pixel = pixels.rgb(CGPoint(x: x, y: y))
        total += 1
        if pixel.r < 60, pixel.g > 120, pixel.b < 60 { green += 1 }
      }
    }
    return Double(green) / Double(max(total, 1))
  }

  func testRendererLossWhileHiddenWaitsForVisibilityAndInvalidRequestsAnswerAtOnce() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    // Off-screen points are valid; an invalid request fails at once rather than at its timeout.
    let started = ContinuousClock.now
    _ = try await view.unproject(CGPoint(x: -40, y: -40))
    _ = try await view.query(at: CGPoint(x: -40, y: 5_000))
    XCTAssertLessThan(started.duration(to: .now), .seconds(5))
    // iOS draws the steepest pitch the camera API allows. MapLibre lowers it while the top inset
    // exceeds the bottom one, as the safe area does, so the camera's centre stays in view.
    view.automaticallyAdjustsContentInsets = false
    try await waitUntil { (view.engine as? NativeMapEngine)?.mapView?.contentInset == .zero }
    try await view.setCamera(TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16, pitch: 85))
    let steep = try await view.camera()
    XCTAssertEqual(steep.pitch, 85, accuracy: 0.5)
    XCTAssertFalse(events.features.contains("pitchAbove60"))
    try await view.setCamera(TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16))

    // A renderer that loses its graphics context while the app is hidden is replaced only once it
    // is visible.
    NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    XCTAssertNil(view.engine)
    NotificationCenter.default.post(
      name: UIApplication.willEnterForegroundNotification, object: nil)
    try await events.waitForLoads(2)
    // Loading resets the recovery budget, so a later loss is recovered too.
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    try await events.waitForLoads(3)
    try await assertBuildings(view)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    // A loss before the replacement loads is reported, as a recoverable failure.
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    try await waitUntil { !events.failures.isEmpty }
    XCTAssertEqual(events.failures.first?.code, .rendererFailed)
    XCTAssertEqual(events.failures.first?.context.reason, "graphicsContextLost")
    XCTAssertEqual(events.failures.first?.isRecoverable, true)
  }

  func testEventLevelsAndCameraReasons() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)

    // At the default level only the settled camera arrives, tagged with who moved it.
    events.changes.removeAll()
    try await view.setCamera(.init(longitude: -3.69, latitude: 40.42, zoom: 13), duration: 0.6)
    try await waitUntil { events.changes.contains(where: \.isFinal) }
    XCTAssertEqual(events.changes.map(\.phase), [.ended])
    XCTAssertEqual(events.changes.last?.reason, .api)
    // The continuous level adds the start and throttled updates.
    try await view.setOptions(.init(events: .init(level: .continuous, cameraUpdateInterval: 0.1)))
    events.changes.removeAll()
    try await view.setCamera(.init(longitude: -3.70, latitude: 40.42, zoom: 14), duration: 0.8)
    try await waitUntil { events.changes.contains(where: \.isFinal) }
    XCTAssertEqual(events.changes.first?.phase, .started)
    XCTAssertTrue(events.changes.allSatisfy { $0.reason == .api }, "\(events.changes.map(\.reason))")
    let moving = events.changes.filter { $0.phase == .moving }.count
    XCTAssertTrue((1...11).contains(moving), "\(moving) throttled updates in 0.8 s")
    XCTAssertEqual(events.changes.last?.camera.zoom ?? 0, 14, accuracy: 0.01)
    // A movement another one replaces ends as cancelled.
    let first = Task {
      try await view.ease(
        to: TileflowCamera(longitude: -3.71, latitude: 40.42, zoom: 15), duration: 2)
    }
    try await Task.sleep(for: .milliseconds(200))
    let second = try await view.jump(to: TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 15))
    let replaced = try await first.value
    XCTAssertEqual(replaced, .cancelled)
    XCTAssertEqual(second, .finished)
    // Framing bounds settles on a camera that holds them.
    try await view.fit(.init(west: -3.71, south: 40.41, east: -3.69, north: 40.43))
    let bounds = try await view.visibleBounds()
    XCTAssertLessThanOrEqual(bounds.west, -3.71)
    XCTAssertGreaterThanOrEqual(bounds.north, 40.43)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  /// The Hosted map's native representation: themes and blends from its family document, its
  /// degradations, and one reload when a later deployment supersedes the styles it reads.
  func testAHostedMapReadsItsNativeRepresentationAndReloadsOnceWhenSuperseded() async throws {
    try await requireNativeFixture()
    _ = try await fixtureCounters(reset: true)
    defer { Task { _ = try? await fixtureCounters(reset: true) } }
    let events = NativeMapEvents()
    let view = TileflowMapView(
      source: .hosted(mapID: Self.hostedFixtureMapID, configuration: try fixtureConfiguration()))
    view.engineKind = .native
    view.automaticallyAdjustsContentInsets = false
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertEqual(engine.manifest?.representation, .native)
    XCTAssertNotNil(engine.family)
    try await waitUntil { events.features == ["scene3d"] }
    try await view.setTheme("system")
    try await view.setBlend(themes: ["day", "night"], position: 0.5)
    try await view.setBlend(themes: ["day", "night"], position: 0.75)
    XCTAssertEqual(engine.shown?.theme, "night")
    do {
      try await view.setBlend(themes: ["day", "labels"], position: 0.5)
      XCTFail("Themes of different structure blended.")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .invalidRequest)
    }

    // A later deployment supersedes version 1: its next style answers 409 and the map reloads
    // once, from the new deployment, in the theme the application asked for.
    var activate = URLRequest(url: URL(string: "\(FixtureServer.origin)/__fixture/hosted?deployment=2")!)
    activate.httpMethod = "POST"
    _ = try await URLSession.shared.data(for: activate)
    _ = try? await view.setTheme("terrain")
    try await events.waitForLoads(2)
    let reloaded = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertEqual(reloaded.shown?.theme, "terrain")
    try await waitUntil { events.features.contains("terrain3d") }
    XCTAssertEqual(events.loads, 2)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  func testTwoMapsAtOnceAndRotation() async throws {
    try await requireNativeFixture()
    let window = MountedMap.sceneWindow()
    defer { window.isHidden = true }
    let root = try XCTUnwrap(window.rootViewController?.view)
    var maps: [(TileflowMapView, NativeMapEvents)] = []
    for (index, theme) in ["light", "dark"].enumerated() {
      let events = NativeMapEvents()
      let view = TileflowMapView(source: citySource, theme: theme)
      view.engineKind = .native
      view.automaticallyAdjustsContentInsets = false
      view.onEvent = events.receive
      view.frame = CGRect(x: 0, y: CGFloat(index) * 422, width: 390, height: 422)
      root.addSubview(view)
      maps.append((view, events))
    }
    defer { for (view, _) in maps { view.destroy() } }
    for (view, events) in maps {
      try await events.waitForLoads(1)
      try await assertBuildings(view)
    }
    XCTAssertEqual((maps[1].0.engine as? NativeMapEngine)?.shown?.theme, "dark")
    // Turning the device lays the views out again; the camera keeps its centre.
    window.frame = CGRect(x: 0, y: 0, width: 844, height: 390)
    for (index, (view, _)) in maps.enumerated() {
      view.frame = CGRect(x: CGFloat(index) * 422, y: 0, width: 422, height: 390)
    }
    window.layoutIfNeeded()
    for (view, events) in maps {
      try await waitUntil { (view.engine as? NativeMapEngine)?.mapView?.bounds.width == 422 }
      let camera = try await view.camera()
      XCTAssertEqual(camera.longitude, -3.70, accuracy: 0.001)
      XCTAssertEqual(camera.latitude, 40.42, accuracy: 0.001)
      try await assertBuildings(view)
      XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    }
  }

  /// View annotations the native engine cannot track yet are sent once, not again and again.
  func testRejectedTrackedPointsAreNotSentAgain() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    view.viewAnnotations.add(
      TileflowViewAnnotation(coordinate: Self.center, view: UIView(frame: CGRect(x: 0, y: 0, width: 20, height: 20))))
    try await Task.sleep(for: .seconds(1))
    XCTAssertLessThanOrEqual(engine.received[.setTrackedPoints] ?? 0, 2)
    try await Task.sleep(for: .seconds(1))
    XCTAssertLessThanOrEqual(engine.received[.setTrackedPoints] ?? 0, 2)
  }

  // MARK: Support

  private func mount(_ view: TileflowMapView, events: NativeMapEvents) -> UIWindow {
    let window = MountedMap.sceneWindow()
    view.onEvent = events.receive
    view.frame = window.bounds
    window.rootViewController?.view.addSubview(view)
    return window
  }

  private func assertBuildings(_ view: TileflowMapView) async throws {
    var observed: [TileflowRenderedFeature] = []
    for _ in 0..<100 {
      if let point = try? await view.project(Self.center),
        let features = try? await view.query(at: point)
      {
        observed = features
        if features.contains(where: { $0.layer.hasPrefix("tileflow-buildings") }) { return }
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTFail("The buildings did not render: \(observed)")
  }

  private func waitUntil(seconds: Int = 10, _ condition: () -> Bool) async throws {
    for _ in 0..<(seconds * 20) {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("Timed out.")
  }
}

/// What a map view reported during a check.
@MainActor
final class NativeMapEvents {
  var loads = 0
  var failures: [TileflowMapError] = []
  var warnings: [TileflowMapWarning] = []
  var transitions: [TileflowThemeTransition] = []
  var themes: [String] = []
  var changes: [TileflowCameraChange] = []

  /// The capabilities reported as unavailable, in order.
  var features: [String] {
    warnings.compactMap { $0.error.context.reason == "featureUnavailable" ? $0.error.context.feature : nil }
  }

  func receive(_ event: TileflowMapEvent) {
    switch event {
    case .contentReady: loads += 1
    case .failed(let error): failures.append(error)
    case .warning(let warning): warnings.append(warning)
    case .themeTransition(let transition): transitions.append(transition)
    case .themeChanged(let theme): themes.append(theme)
    case .cameraChanged(let change): changes.append(change)
    default: break
    }
  }

  func waitForLoads(_ count: Int, seconds: Int = 60) async throws {
    for _ in 0..<(seconds * 20) {
      if loads >= count { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("The map loaded \(loads) times, expected \(count): \(failures)")
  }
}
