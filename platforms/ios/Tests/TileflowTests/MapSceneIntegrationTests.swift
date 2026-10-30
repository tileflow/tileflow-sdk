import Foundation
import UIKit
import WebKit
import XCTest

@testable import Tileflow

/// The parts of a Tileflow map beyond its theme, rendered by the embedded renderer: notices, the
/// declared 3D scene, the sun, emphasis, style states, Boundaries values, images, depth markers,
/// route inks, line progress and camera shots. They draw the map, so they run wherever the map
/// integration tests do.
extension MapIntegrationTests {
  fileprivate func requireFixture() async throws {
    do {
      _ = try await URLSession.shared.data(from: FixtureServer.manifest)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run map scene integration.")
    }
  }

  /// A view of a fixture map in a window, with its events. Keep the window while testing.
  fileprivate func show(
    _ map: String, options: TileflowMapOptions = .init(), theme: String? = nil
  ) -> (TileflowMapView, SceneEvents, UIWindow) {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: map, manifestURL: FixtureServer.manifest, allowsLoopbackHTTP: true),
      theme: theme, options: options)
    let events = SceneEvents()
    view.onEvent = { events.received.append($0) }
    // A window of the host's scene is on screen, so a device screenshot shows the map.
    let window =
      (UIApplication.shared.connectedScenes.first as? UIWindowScene).map {
        UIWindow(windowScene: $0)
      } ?? UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let controller = UIViewController()
    window.rootViewController = controller
    view.frame = controller.view.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.view.addSubview(view)
    window.makeKeyAndVisible()
    return (view, events, window)
  }
}

@MainActor
final class SceneEvents {
    var received: [TileflowMapEvent] = []
    var loads: Int {
      received.filter { if case .contentReady = $0 { true } else { false } }.count
    }
    var failures: [TileflowMapError] {
      received.compactMap { if case .failed(let error) = $0 { error } else { nil } }
    }
    var transitions: [TileflowThemeTransition] {
      received.compactMap { if case .themeTransition(let value) = $0 { value } else { nil } }
    }
}

extension MapIntegrationTests {
  fileprivate func waitUntil(
    _ label: String, timeout: TimeInterval = 30, _ condition: () -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("Timed out waiting for \(label).")
  }

  fileprivate func webView(of view: TileflowMapView) throws -> WKWebView {
    try XCTUnwrap(view.subviews.compactMap { $0 as? WKWebView }.first)
  }

  /// A picture of the renderer, kept with the results and written where
  /// `TILEFLOW_CAPTURE_DIRECTORY` points, or to the temporary directory.
  @discardableResult
  fileprivate func capture(_ view: TileflowMapView, named name: String) async throws -> UIImage {
    let webView = try webView(of: view)
    let image: UIImage = try await withCheckedThrowingContinuation { continuation in
      webView.takeSnapshot(with: nil) { image, error in
        if let image {
          continuation.resume(returning: image)
        } else {
          continuation.resume(throwing: error ?? TileflowMapError.rendererFailed)
        }
      }
    }
    let attachment = XCTAttachment(image: image)
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
    let directory =
      ProcessInfo.processInfo.environment["TILEFLOW_CAPTURE_DIRECTORY"].map {
        URL(fileURLWithPath: $0)
      } ?? FileManager.default.temporaryDirectory
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = directory.appendingPathComponent("\(name).png")
    try image.pngData()?.write(to: file)
    print("Tileflow capture: \(file.path)")
    // A simulator's WebKit snapshot leaves out what the GPU draws. With
    // `TILEFLOW_CAPTURE_PAUSE`, the test marks the moment and holds the map on screen that many
    // seconds, so a screenshot of the device (`simctl io screenshot`) can record it.
    if let pause = ProcessInfo.processInfo.environment["TILEFLOW_CAPTURE_PAUSE"].flatMap(Double.init)
    {
      try Data().write(to: directory.appendingPathComponent("\(name).ready"))
      try await Task.sleep(for: .seconds(pause))
    }
    return image
  }

  /// Whether a snapshot holds a picture at all; a simulator's is one flat colour.
  fileprivate func isFlat(_ bytes: [UInt8]) -> Bool {
    stride(from: 0, to: bytes.count, by: 4).allSatisfy { index in
      (0..<3).allSatisfy { abs(Int(bytes[index + $0]) - Int(bytes[$0])) < 4 }
    }
  }

  fileprivate func pixels(_ image: UIImage) -> [UInt8] {
    guard let cgImage = image.cgImage else { return [] }
    let width = 48
    let height = 96
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    bytes.withUnsafeMutableBytes { buffer in
      let context = CGContext(
        data: buffer.baseAddress, width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
      context?.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
    return bytes
  }

  func testANauticalMapShowsItsNoticeOnTheMap() async throws {
    try await requireFixture()
    let (view, events, window) = show("nautical")
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await waitUntil("the Nautical map") { events.loads >= 1 }
    let webView = try webView(of: view)
    var notice: String?
    try await waitUntil("the notice") {
      webView.evaluateJavaScript("document.querySelector('.tileflow-notice')?.textContent") {
        value, _ in notice = value as? String
      }
      return notice == "Not for navigation"
    }
    XCTAssertEqual(notice, "Not for navigation")
    // The notice stays through a theme change.
    try await view.setTheme("night")
    try await Task.sleep(for: .milliseconds(500))
    try await capture(view, named: "tileflow-nautical-notice")
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  func testADeclaredSceneRisesInThreeDimensionsAndLiesFlatIn2D() async throws {
    try await requireFixture()
    let (view, events, window) = show("scene", options: .init(viewMode: .threeDimensional))
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await waitUntil("the 3D scene map") { events.loads >= 1 }
    // The buildings arrive as tiles the 3D renderer reads after the map loads.
    try await Task.sleep(for: .seconds(4))
    let raised = try await capture(view, named: "tileflow-declared-3d-scene")
    try await view.setViewMode(.flat, duration: 0)
    try await Task.sleep(for: .seconds(1))
    let flat = try await capture(view, named: "tileflow-declared-3d-scene-flat")
    let (a, b) = (pixels(raised), pixels(flat))
    if !isFlat(a) {
      let changed = zip(a, b).filter { abs(Int($0) - Int($1)) > 24 }.count
      XCTAssertGreaterThan(changed, a.count / 50, "The 3D buildings did not change the picture.")
    }
    // The buildings rise again over a transition.
    try await view.setViewMode(.threeDimensional, duration: 1)
    XCTAssertEqual(view.options.viewMode, .threeDimensional)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    let warnings = events.received.compactMap {
      if case .warning(let warning) = $0 { warning } else { nil }
    }
    XCTAssertFalse(
      warnings.contains { $0.error.context.reason == "scene" }, "The 3D scene failed: \(warnings)")
  }

  func testTheSceneReachesTheRendererAndANewRendererReceivesItAgain() async throws {
    try await requireFixture()
    let (view, events, window) = show("fixture")
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await waitUntil("the map") { events.loads >= 1 }

    let lightInks = try await view.routeInks()
    XCTAssertEqual(lightInks, .light)
    try await view.setTheme("dark")
    try await waitUntil("a settled theme transition") {
      events.transitions.contains { $0.phase == .ready && $0.currentTheme == "dark" }
    }
    XCTAssertTrue(events.transitions.contains { $0.phase == .applying })
    XCTAssertEqual(events.transitions.last?.routeInks, .dark)
    let darkInks = try await view.routeInks()
    XCTAssertEqual(darkInks, .dark)

    let pin = UIGraphicsImageRenderer(size: CGSize(width: 12, height: 16)).image { context in
      UIColor.systemOrange.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 12, height: 16))
    }
    try await view.setImages([try TileflowMapImage(name: "pin", image: pin)])
    try await view.setDepthMarkers([
      TileflowDepthMarker(
        id: "cafe", coordinate: .init(longitude: -3.7, latitude: 40.42), image: "pin",
        size: CGSize(width: 12, height: 16), anchor: .bottom)
    ])
    try await view.setSun(.date(Date(timeIntervalSince1970: 1_782_064_800)), duration: 0.3)
    try await view.setSun(.direction(azimuth: 200, altitude: 20))
    let keep = Data(
      #"{"type":"Polygon","coordinates":[[[-3.71,40.41],[-3.69,40.41],[-3.69,40.43],[-3.71,40.41]]]}"#
        .utf8)
    try await view.setEmphasis(.init(recede: [.roads: 0.5], labels: 0.4, keepArea: keep))
    try await view.setStyleState("traffic", to: 0.5)
    try await view.setBoundaryValues(.init(ids: [1: 4.5, 2: "high"]))
    do {
      try await view.setDepthMarkers([
        TileflowDepthMarker(
          id: "x", coordinate: .init(longitude: 0, latitude: 0), image: "missing", size: .zero)
      ])
      XCTFail("A marker without an image was accepted.")
    } catch {
      XCTAssertEqual(error as? TileflowMapError, .invalidRequest)
    }

    let route = Data(
      #"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-3.715,40.415],[-3.7,40.42],[-3.685,40.425]]}}]}"#
        .utf8)
    try await view.setContent(layers: [
      try .init(
        id: "route-casing", geoJSON: route, kind: .line, size: 9, ink: .casing, placement: .ground),
      try .init(
        id: "route-line", geoJSON: route, kind: .line, ink: .line, placement: .ground,
        occludedOpacity: 0.35, progress: .init(end: 0)),
    ])
    let drawn = try await view.animateLineProgress(
      layers: ["route-line"], to: .init(end: 1, light: 0.5), duration: 0.4)
    XCTAssertTrue(drawn)
    do {
      try await view.animateLineProgress(layers: ["route-casing"], to: .init(), duration: 0)
      XCTFail("A layer without progress was animated.")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.context.reason, "unknownLayer")
    }

    var cues: [String] = []
    let start = TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 13)
    let end = TileflowCamera(longitude: -3.69, latitude: 40.425, zoom: 14, bearing: 30, pitch: 60)
    let finished = try await view.play(
      TileflowShot(
        keyframes: [.init(time: 0, camera: start), .init(time: 0.6, camera: end)],
        cues: [.init(time: 0.3, id: "midway")]),
      onCue: { cues.append($0) })
    XCTAssertTrue(finished)
    XCTAssertEqual(cues, ["midway"])
    let camera = try await view.camera()
    XCTAssertEqual(camera.pitch, 60, accuracy: 0.01)
    // Cancelling the caller stops the shot where it is.
    let long = Task {
      try await view.play(
        TileflowShot(keyframes: [.init(time: 0, camera: end), .init(time: 60, camera: start)]))
    }
    try await Task.sleep(for: .milliseconds(300))
    long.cancel()
    do {
      _ = try await long.value
      XCTFail("A cancelled shot kept playing.")
    } catch {
      XCTAssertTrue(error is CancellationError, "\(error)")
    }

    // A new renderer receives the content and the scene again, without failures.
    try view.reload()
    try await waitUntil("the reloaded map") { events.loads >= 2 }
    let redrawn = try await view.animateLineProgress(
      layers: ["route-line"], to: .init(end: 0.5), duration: 0.2)
    XCTAssertTrue(redrawn)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    try await capture(view, named: "tileflow-scene-features")
  }
}
