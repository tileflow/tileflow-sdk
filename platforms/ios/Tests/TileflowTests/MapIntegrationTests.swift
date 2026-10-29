import Foundation
import UIKit
import WebKit
import XCTest

@testable import Tileflow

@MainActor
final class MapIntegrationTests: XCTestCase {
  func testOnlineMapLoadsChangesThemeAndRetires() async throws {
    let manifest = FixtureServer.manifest
    do {
      let (_, response) = try await URLSession.shared.data(from: manifest)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    let loaded = expectation(description: "Map content loaded")
    let reloaded = expectation(description: "Map content reloaded")
    var loads = 0
    loaded.assertForOverFulfill = true
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true
      ))
    var failures: [TileflowMapError] = []
    view.onEvent = { event in
      switch event {
      case .contentReady:
        loads += 1
        if loads == 1 { loaded.fulfill() } else if loads == 2 { reloaded.fulfill() }
      case .failed(let error): failures.append(error)
      default: break
      }
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
    await fulfillment(of: [loaded], timeout: 30)
    XCTAssertTrue(failures.isEmpty, "\(failures)")
    let initial = try await view.camera()
    XCTAssertEqual(initial.longitude, -3.70, accuracy: 0.01)
    // Automatic insets centre the camera inside the safe area, so query where the POI is drawn.
    let point = try await view.project(TileflowCoordinate(longitude: -3.70, latitude: 40.42))
    let features = try await view.query(at: point)
    XCTAssertTrue(features.contains { $0.layer == "poi" }, "The POI did not render: \(features)")
    let coordinate = try await view.unproject(point)
    XCTAssertEqual(coordinate.longitude, -3.70, accuracy: 0.0001)
    XCTAssertEqual(coordinate.latitude, 40.42, accuracy: 0.0001)
    let data = Data(
      #"{"type":"FeatureCollection","features":[{"type":"Feature","id":"selected","geometry":{"type":"Point","coordinates":[-3.70,40.42]},"properties":{}}]}"#
        .utf8)
    try await view.setContent(
      annotations: [
        .init(
          id: "accessible-place", coordinate: .init(longitude: -3.71, latitude: 40.43),
          title: "Saved place")
      ],
      layers: [try .init(id: "selection", geoJSON: data, kind: .circle, color: "#2166ce", size: 14)]
    )
    try await assertApplicationLayer(view)
    if let webView = view.subviews.first(where: { $0 is WKWebView }) as? WKWebView {
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
      attachment.name = "Tileflow online fixture"
      attachment.lifetime = .keepAlways
      add(attachment)
      let capture = FileManager.default.temporaryDirectory.appendingPathComponent(
        "tileflow-online-fixture.png")
      try image.pngData()?.write(to: capture)
      print("Tileflow fixture capture: \(capture.path)")
    }
    try await view.setTheme("dark")
    try await assertApplicationLayer(view)
    try await view.setBlend(themes: ["light", "dark"], position: 0.5)
    try await view.setOptions(.init(viewMode: .threeDimensional, quality: .low))
    try await view.fit(.init(west: -3.71, south: 40.41, east: -3.69, north: 40.43))
    try await view.setCamera(TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 14))
    let camera = try await view.camera()
    XCTAssertEqual(camera.zoom, 14, accuracy: 0.01)
    try view.reload()
    await fulfillment(of: [reloaded], timeout: 30)
    try await assertApplicationLayer(view)
    XCTAssertTrue(failures.isEmpty, "Late map errors: \(failures)")
    view.destroy()
    do {
      try await view.setTheme("light")
      XCTFail("A destroyed map accepted an update.")
    } catch {
      XCTAssertEqual(error as? TileflowMapError, .disposed)
    }
  }

  func testRendererLossWhileHiddenWaitsForVisibilityAndInvalidRequestsAnswerAtOnce() async throws {
    let manifest = FixtureServer.manifest
    do {
      _ = try await URLSession.shared.data(from: manifest)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    let loads = [
      expectation(description: "Loaded"), expectation(description: "Replaced once visible"),
      expectation(description: "Replaced again after loading"),
    ]
    var loaded = 0
    var failures: [TileflowMapError] = []
    let view = TileflowMapView(
      source: TileflowMapSource(map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true))
    view.onEvent = { event in
      switch event {
      case .contentReady:
        if loaded < loads.count { loads[loaded].fulfill() }
        loaded += 1
      case .failed(let error): failures.append(error)
      default: break
      }
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
    await fulfillment(of: [loads[0]], timeout: 30)

    // The style's notices are always visible on the map, as on the web.
    let notice = try await renderer(view).evaluateJavaScript(
      "document.querySelector('.tileflow-notice')?.textContent ?? ''")
    XCTAssertEqual(notice as? String, "Not for navigation")
    // Off-screen points are valid; an invalid request fails at once rather than at its timeout.
    let started = ContinuousClock.now
    _ = try await view.unproject(CGPoint(x: -40, y: -40))
    _ = try await view.query(at: CGPoint(x: -40, y: 5_000))
    let bbox = Data(
      #"{"type":"FeatureCollection","bbox":[-3.71,40.41,-3.69,40.43],"features":[{"type":"Feature","bbox":[-3.7,40.42,-3.7,40.42],"geometry":{"type":"Point","coordinates":[-3.7,40.42]},"properties":{}}]}"#
        .utf8)
    try await view.setContent(layers: [try .init(id: "bounded", geoJSON: bbox, kind: .circle)])
    XCTAssertLessThan(started.duration(to: .now), .seconds(5))
    // The renderer accepts the steep pitch the camera API allows.
    try await view.setCamera(TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16, pitch: 80))
    let steep = try await view.camera()
    XCTAssertEqual(steep.pitch, 80, accuracy: 0.5)
    try await view.setCamera(TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16))

    // A renderer the system ends while the app is hidden is replaced only once it is visible.
    NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
    view.webViewWebContentProcessDidTerminate(try renderer(view))
    XCTAssertFalse(view.subviews.contains { $0 is WKWebView })
    NotificationCenter.default.post(
      name: UIApplication.willEnterForegroundNotification, object: nil)
    await fulfillment(of: [loads[1]], timeout: 30)
    // Loading resets the recovery budget, so a later loss is recovered too.
    view.webViewWebContentProcessDidTerminate(try renderer(view))
    await fulfillment(of: [loads[2]], timeout: 30)
    try await assertApplicationLayer(view, layer: "__tileflow_app_bounded")
    XCTAssertTrue(failures.isEmpty, "\(failures)")
  }

  func testEventLevelsCameraReasonsAndLargeContentOverTheDataChannel() async throws {
    let manifest = FixtureServer.manifest
    do {
      _ = try await URLSession.shared.data(from: manifest)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    let loaded = expectation(description: "Loaded")
    var changes: [TileflowCameraChange] = []
    var failures: [TileflowMapError] = []
    let view = TileflowMapView(
      source: TileflowMapSource(map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true))
    view.onEvent = { event in
      switch event {
      case .contentReady: loaded.fulfill()
      case .cameraChanged(let change): changes.append(change)
      case .failed(let error): failures.append(error)
      default: break
      }
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
    await fulfillment(of: [loaded], timeout: 30)

    // At the default level only the settled camera arrives, tagged with who moved it.
    changes.removeAll()
    try await view.setCamera(.init(longitude: -3.69, latitude: 40.42, zoom: 13), duration: 0.6)
    try await waitUntil { changes.contains(where: \.isFinal) }
    XCTAssertEqual(changes.map(\.phase), [.ended])
    XCTAssertEqual(changes.last?.reason, .api)
    // The continuous level adds the start and throttled updates.
    try await view.setOptions(.init(events: .init(level: .continuous, cameraUpdateInterval: 0.1)))
    changes.removeAll()
    try await view.setCamera(.init(longitude: -3.70, latitude: 40.42, zoom: 14), duration: 0.8)
    try await waitUntil { changes.contains(where: \.isFinal) }
    XCTAssertEqual(changes.first?.phase, .started)
    XCTAssertTrue(changes.allSatisfy { $0.reason == .api }, "\(changes.map(\.reason))")
    let moving = changes.filter { $0.phase == .moving }.count
    XCTAssertTrue((1...11).contains(moving), "\(moving) throttled updates in 0.8 s")
    XCTAssertEqual(changes.last?.camera.zoom ?? 0, 14, accuracy: 0.01)

    // A 5 MiB layer travels over the data channel and renders.
    let geoJSON = BridgeWebKitTests.geoJSON(bytes: 5 * 1024 * 1024)
    let started = ContinuousClock.now
    try await view.setContent(
      layers: [try .init(id: "selection", geoJSON: geoJSON.data, kind: .circle, size: 3)])
    let elapsed = started.duration(to: .now)
    print(
      "Tileflow setContent with \(geoJSON.data.count) bytes of GeoJSON (\(geoJSON.features) points): \(elapsed)"
    )
    try await view.setCamera(.init(longitude: -3.70, latitude: 40.42, zoom: 14))
    try await assertApplicationLayer(view)
    // Invalid GeoJSON is a typed rejection that leaves the content as it was.
    do {
      try await view.setContent(
        layers: [try .init(id: "broken", geoJSON: Data(#"{"type":"Feature"}"#.utf8), kind: .fill)])
      XCTFail("The renderer accepted invalid GeoJSON.")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error, .invalidRequest)
      XCTAssertEqual(error.context.reason, "invalidGeoJSON")
      XCTAssertEqual(error.context.resource, .data)
    }
    try await assertApplicationLayer(view)
    XCTAssertTrue(failures.isEmpty, "\(failures)")
  }

  func waitUntil(seconds: Int = 5, _ condition: @escaping () -> Bool) async throws {
    for _ in 0..<(seconds * 20) {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("Timed out.")
  }

  func renderer(_ view: TileflowMapView) throws -> WKWebView {
    try XCTUnwrap(view.subviews.compactMap { $0 as? WKWebView }.first)
  }

  func assertApplicationLayer(
    _ view: TileflowMapView, layer: String = "__tileflow_app_selection"
  ) async throws {
    var observed: [TileflowRenderedFeature] = []
    for _ in 0..<50 {
      if let point = try? await view.project(.init(longitude: -3.70, latitude: 40.42)),
        let features = try? await view.query(at: point)
      {
        observed = features
        if features.contains(where: { $0.layer == layer }) { return }
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTFail("Application content was not restored: \(observed)")
  }
}
