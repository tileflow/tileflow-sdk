import Foundation
import UIKit
import XCTest

@testable import Tileflow

private let fixtureOrigin = "http://127.0.0.1:18645"
private let hostedMapID = "map_offlinefixture01"

/// Draws the map, so it belongs to `MapIntegrationTests` and runs where that suite runs.
extension MapIntegrationTests {
  /// Downloads a region of the fixture map, then shows the map with the network switched off: every
  /// resource comes from the downloaded region, as in airplane mode.
  func testADownloadedRegionShowsTheMapWithoutTheNetwork() async throws {
    let manifest = URL(string: "\(fixtureOrigin)/cached/manifest.json")!
    try await requireFixture(manifest)
    // Nothing from earlier mounts may answer: only the region does.
    await TileflowMapCache.clear()
    let store = offlineStore(client: { throw TileflowOfflineError(.invalidConfiguration) })
    try await download(
      store, id: "fixture",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.75, south: 40.4, east: -3.65, north: 40.44)),
        content: .manifest(url: manifest, map: "fixture", sources: []), maxZoom: 14))

    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    let source = TileflowMapSource(map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true)
    let (view, window) = try await mountOfflineMap(source)
    defer {
      view.destroy()
      window.isHidden = true
    }
    let features = try await view.query(at: CGPoint(x: view.bounds.midX, y: view.bounds.midY))
    XCTAssertTrue(
      features.contains { $0.layer == "poi" }, "Downloaded data did not render: \(features)")
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")
  }

  /// Downloads a Hosted pack of the fixture's Hosted map. In airplane mode the map opens from the
  /// pack without a session and nothing reaches the network; online it starts its session and the
  /// stored resources come back unchanged as 304.
  func testAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline() async throws {
    let discovery = URL(string: "\(fixtureOrigin)/maps/\(hostedMapID)/mobile/manifest.json")!
    try await requireFixture(discovery)
    await TileflowMapCache.clear()
    let configuration = try TileflowConfiguration(
      apiOrigin: URL(string: fixtureOrigin)!,
      mapCredential: TileflowCredential("tf_public_" + String(repeating: "f", count: 48)))
    let store = offlineStore(client: { try OfflinePackClient(configuration: configuration) })
    _ = try await fixtureCounters(reset: true)
    try await download(
      store, id: "hosted",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.705, south: 40.416, east: -3.695, north: 40.424)),
        content: .hosted(mapID: hostedMapID, themes: ["day"]), minZoom: 13, maxZoom: 15))
    let downloaded = try await fixtureCounters()
    XCTAssertEqual(downloaded["packs"], 1)
    XCTAssertGreaterThan(downloaded["packResources"] ?? 0, 0)
    XCTAssertEqual(downloaded["sessions"], 0)

    let source = TileflowMapSource.hosted(mapID: hostedMapID, configuration: configuration)
    _ = try await fixtureCounters(reset: true)
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    do {
      defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
      let (view, window) = try await mountOfflineMap(source)
      defer {
        view.destroy()
        window.isHidden = true
      }
      let features = try await view.query(at: CGPoint(x: view.bounds.midX, y: view.bounds.midY))
      XCTAssertTrue(
        features.contains { $0.layer == "buildings" }, "The pack did not render: \(features)")
    }
    let offline = try await fixtureCounters()
    XCTAssertEqual(offline["sessions"], 0, "No session starts without a network")
    XCTAssertEqual(offline["downloads"], 0)
    XCTAssertEqual(offline["notModified"], 0)
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")

    _ = try await fixtureCounters(reset: true)
    let (view, window) = try await mountOfflineMap(source)
    defer {
      view.destroy()
      window.isHidden = true
    }
    let online = try await fixtureCounters()
    XCTAssertEqual(online["sessions"], 1, "Online, the map starts its session")
    XCTAssertGreaterThan(
      online["notModified"] ?? 0, 0, "Stored resources revalidate unchanged: \(online)")
    XCTAssertGreaterThan(online["sessionResources"] ?? 0, 0)
  }

  // MARK: Helpers

  private func requireFixture(_ url: URL) async throws {
    do {
      let (_, response) = try await URLSession.shared.data(from: url)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
  }

  /// A store of its own, downloading in the foreground, whose regions every map may use.
  private func offlineStore(client: @escaping @Sendable () throws -> OfflinePackClient)
    -> TileflowOfflineStore
  {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-map-\(UUID().uuidString)", isDirectory: true)
    let store = TileflowOfflineStore(
      dependencies: OfflineStoreCore.Dependencies(
        layout: OfflineLayout(root: root), cache: .shared,
        fetcher: OfflineURLSessionFetcher(configuration: .ephemeral), client: client,
        availableBytes: { nil }, index: .shared))
    addTeardownBlock {
      for region in await store.allRegions() { try? await store.removeRegion(id: region.id) }
      try? FileManager.default.removeItem(at: root)
    }
    return store
  }

  private func download(
    _ store: TileflowOfflineStore, id: String, options: TileflowOfflineRegionLoadOptions
  ) async throws {
    try await store.loadRegion(id: id, options: options)
    let deadline = Date().addingTimeInterval(30)
    var region = await store.region(id: id)
    while region?.state != .complete, Date() < deadline {
      try await Task.sleep(nanoseconds: 20_000_000)
      region = await store.region(id: id)
    }
    XCTAssertEqual(region?.state, .complete, "\(String(describing: region))")
  }

  private func fixtureCounters(reset: Bool = false) async throws -> [String: Int] {
    var request = URLRequest(url: URL(string: "\(fixtureOrigin)/__fixture/hosted")!)
    request.httpMethod = reset ? "POST" : "GET"
    let (data, _) = try await URLSession.shared.data(for: request)
    let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    return value.compactMapValues { $0 as? Int }
  }

  private func mountOfflineMap(_ source: TileflowMapSource) async throws -> (
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
