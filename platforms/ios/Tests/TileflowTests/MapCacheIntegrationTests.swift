import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// Draws the map, so it belongs to `MapIntegrationTests` and runs where that suite runs.
extension MapIntegrationTests {
  func testSecondMountShowsCachedPublicResourcesWithoutTheNetwork() async throws {
    let origin = "http://127.0.0.1:18645"
    let manifest = URL(string: "\(origin)/cached/manifest.json")!
    do {
      let (_, response) = try await URLSession.shared.data(from: manifest)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    await TileflowMapCache.clear()
    let source = TileflowMapSource(map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true)
    let (online, onlineWindow) = try await mountUntilReady(source)
    online.destroy()
    onlineWindow.isHidden = true

    let usage = await TileflowMapCache.usage()
    XCTAssertGreaterThanOrEqual(usage.entries, 4, "Manifest, style, data and font")
    XCTAssertGreaterThan(usage.bytesByClass[.style] ?? 0, 0)
    XCTAssertGreaterThan(usage.bytesByClass[.glyphs] ?? 0, 0)
    // The fixture's other routes are no-store and never reach the disk.
    let uncached = ResourceCacheKey(url: URL(string: "\(origin)/manifest.json")!, scope: .shared)
    XCTAssertFalse(
      FileManager.default.fileExists(
        atPath: ResourceCacheStore.shared.file(for: uncached, retention: .ambient).path))

    TileflowHTTPClient.shared.isNetworkEnabled = false
    defer { TileflowHTTPClient.shared.isNetworkEnabled = true }
    let (offline, window) = try await mountUntilReady(source)
    defer {
      offline.destroy()
      window.isHidden = true
    }
    let features = try await offline.query(
      at: CGPoint(x: offline.bounds.midX, y: offline.bounds.midY))
    XCTAssertTrue(
      features.contains { $0.layer == "poi" }, "Cached data did not render: \(features)")
  }

  private func mountUntilReady(_ source: TileflowMapSource) async throws -> (
    TileflowMapView, UIWindow
  ) {
    let ready = expectation(description: "Map content loaded")
    ready.assertForOverFulfill = false
    let view = TileflowMapView(source: source)
    var failures: [TileflowMapError] = []
    view.onEvent = { event in
      switch event {
      case .contentReady: ready.fulfill()
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
    await fulfillment(of: [ready], timeout: 30)
    XCTAssertTrue(failures.isEmpty, "\(failures)")
    return (view, window)
  }
}
