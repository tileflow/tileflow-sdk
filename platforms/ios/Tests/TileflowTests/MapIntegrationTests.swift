import Foundation
import UIKit
import WebKit
import XCTest

@testable import Tileflow

@MainActor
final class MapIntegrationTests: XCTestCase {
  func testOnlineMapLoadsChangesThemeAndRetires() async throws {
    let manifest = URL(string: "http://127.0.0.1:18645/manifest.json")!
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
    let features = try await view.query(at: CGPoint(x: view.bounds.midX, y: view.bounds.midY))
    XCTAssertTrue(features.contains { $0.layer == "poi" }, "The POI did not render: \(features)")
    let point = try await view.project(TileflowCoordinate(longitude: -3.70, latitude: 40.42))
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
    let manifest = URL(string: "http://127.0.0.1:18645/manifest.json")!
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

  private func renderer(_ view: TileflowMapView) throws -> WKWebView {
    try XCTUnwrap(view.subviews.compactMap { $0 as? WKWebView }.first)
  }

  private func assertApplicationLayer(
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
