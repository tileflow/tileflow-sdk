import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// Draws the map, so it belongs to `MapIntegrationTests` and runs where that suite runs.
extension MapIntegrationTests {
  /// Downloads a region of the fixture map, then shows the map with the network switched off: every
  /// resource comes from the downloaded region, as in airplane mode.
  func testADownloadedRegionShowsTheMapWithoutTheNetwork() async throws {
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
    // Nothing from earlier mounts may answer: only the region does.
    await TileflowMapCache.clear()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-map-\(UUID().uuidString)", isDirectory: true)
    let store = TileflowOfflineStore(
      dependencies: OfflineStoreCore.Dependencies(
        layout: OfflineLayout(root: root), cache: .shared,
        fetcher: OfflineURLSessionFetcher(configuration: .ephemeral),
        client: { throw TileflowOfflineError(.invalidConfiguration) },
        availableBytes: { nil }))
    let options = TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(
        TileflowBoundingBox(west: -3.75, south: 40.4, east: -3.65, north: 40.44)),
      content: .manifest(url: manifest, map: "fixture", sources: []), maxZoom: 14)
    try await store.loadRegion(id: "fixture", options: options)
    let deadline = Date().addingTimeInterval(30)
    var region = await store.region(id: "fixture")
    while region?.state != .complete, Date() < deadline {
      try await Task.sleep(nanoseconds: 20_000_000)
      region = await store.region(id: "fixture")
    }
    XCTAssertEqual(region?.state, .complete, "\(String(describing: region))")
    addTeardownBlock {
      try? await store.removeRegion(id: "fixture")
      try? FileManager.default.removeItem(at: root)
    }

    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    let source = TileflowMapSource(map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true)
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
    defer {
      view.destroy()
      window.isHidden = true
    }
    await fulfillment(of: [ready], timeout: 30)
    XCTAssertTrue(failures.isEmpty, "\(failures)")
    let features = try await view.query(at: CGPoint(x: view.bounds.midX, y: view.bounds.midY))
    XCTAssertTrue(
      features.contains { $0.layer == "poi" }, "Downloaded data did not render: \(features)")
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")
  }
}
