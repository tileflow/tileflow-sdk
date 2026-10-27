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

  private func assertApplicationLayer(_ view: TileflowMapView) async throws {
    for _ in 0..<50 {
      if let point = try? await view.project(.init(longitude: -3.70, latitude: 40.42)),
        let features = try? await view.query(at: point),
        features.contains(where: { $0.layer == "__tileflow_app_selection" })
      {
        return
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTFail("Application content was not restored.")
  }
}
