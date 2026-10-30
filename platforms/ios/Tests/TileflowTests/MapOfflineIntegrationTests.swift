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

  /// Downloads a region of the fixture's Hosted map as packs. In airplane mode the map opens from
  /// the packs without a session and nothing reaches the network; online it starts its session and
  /// the packs' entries come back unchanged as 304.
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
    XCTAssertEqual(downloaded["packs"], 1, "One download created")
    let region = try await XCTUnwrapAsync(await store.region(id: "hosted"))
    XCTAssertEqual(downloaded["packResources"], region.requiredPackCount)
    XCTAssertEqual(downloaded["sessions"], 0)
    XCTAssertEqual(downloaded["downloads"], 2, "Discovery and profile")

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

  /// Downloads the fixture's Terrain theme with Terrain to z12, then shows it at z14.5 with the
  /// network switched off. Elevation tiles above z12 answer as online (`404`), so the renderer
  /// overzooms the z12 tiles: nothing is missing and no warning is reported.
  func testTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline() async throws {
    let discovery = URL(string: "\(fixtureOrigin)/maps/\(hostedMapID)/mobile/manifest.json")!
    try await requireFixture(discovery)
    await TileflowMapCache.clear()
    let configuration = try TileflowConfiguration(
      apiOrigin: URL(string: fixtureOrigin)!,
      mapCredential: TileflowCredential("tf_public_" + String(repeating: "f", count: 48)))
    let store = offlineStore(client: { try OfflinePackClient(configuration: configuration) })
    try await download(
      store, id: "terrain",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.85, south: 40.27, east: -3.55, north: 40.57)),
        content: .hosted(mapID: hostedMapID, themes: ["terrain"]), minZoom: 0, maxZoom: 15))

    _ = try await fixtureCounters(reset: true)
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    let (view, window, warnings) = try await mountOfflineMap(
      .hosted(mapID: hostedMapID, configuration: configuration), theme: "terrain",
      camera: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 14.5, pitch: 45))
    defer {
      view.destroy()
      window.isHidden = true
    }
    let features = try await view.query(at: CGPoint(x: view.bounds.midX, y: view.bounds.midY))
    XCTAssertTrue(
      features.contains { $0.layer == "buildings" }, "The packs did not render: \(features)")
    // Elevation tiles keep arriving after the content is ready.
    try await Task.sleep(nanoseconds: 3_000_000_000)
    XCTAssertTrue(warnings().isEmpty, "Every tile answered: \(warnings())")
    let offline = try await fixtureCounters()
    XCTAssertEqual(offline["sessions"], 0)
    XCTAssertEqual(offline["downloads"], 0)
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")
  }

  /// A transfer stopped part-way, as when the system ends the app or the network drops, resumes
  /// from the system's resume data with `Range` and `If-Range` instead of starting again.
  func testAnInterruptedTransferResumesFromWhereItStopped() async throws {
    let url = URL(string: "\(fixtureOrigin)/__fixture/resumable")!
    try await requireFixture(URL(string: "\(fixtureOrigin)/maps/\(hostedMapID)/mobile/manifest.json")!)
    _ = try await fixtureCounters(reset: true)
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-resume-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let fetcher = OfflineURLSessionFetcher(
      configuration: .ephemeral, directory: root.appendingPathComponent("transfers"))
    let request = OfflineFetchRequest(
      id: "resume/1/pack", url: url, headers: [:], allowsExpensiveNetworkAccess: true,
      destination: root.appendingPathComponent("pack"))
    do {
      _ = try await fetcher.fetch(request)
      XCTFail("The first transfer stops part-way")
    } catch {}
    let response = try await fetcher.fetch(request)
    XCTAssertEqual(response.status, 200)
    let body = try Data(contentsOf: root.appendingPathComponent("pack"))
    XCTAssertEqual(body.count, 2 * 1024 * 1024)
    XCTAssertTrue(body.enumerated().allSatisfy { $0.element == UInt8(($0.offset * 31) % 251) })
    let counters = try await fixtureCounters()
    XCTAssertEqual(counters["ranges"], 1, "The second transfer asked for the rest only")
  }

  // MARK: Helpers

  private func XCTUnwrapAsync<T>(_ value: T?) throws -> T { try XCTUnwrap(value) }

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
        fetcher: OfflineURLSessionFetcher(
          configuration: .ephemeral, directory: root.appendingPathComponent("transfers")),
        client: client,
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
    let (view, window, _) = try await mountOfflineMap(source, theme: nil, camera: nil)
    return (view, window)
  }

  /// Mounts a map and reports the warnings it shows while it lives.
  private func mountOfflineMap(
    _ source: TileflowMapSource, theme: String?, camera: TileflowCamera?
  ) async throws -> (TileflowMapView, UIWindow, () -> [TileflowMapWarning]) {
    let ready = expectation(description: "Map content loaded")
    ready.assertForOverFulfill = false
    let view = TileflowMapView(source: source, theme: theme, initialCamera: camera)
    var failures: [TileflowMapError] = []
    var warnings: [TileflowMapWarning] = []
    view.onEvent = { event in
      switch event {
      case .contentReady: ready.fulfill()
      case .failed(let error): failures.append(error)
      case .warning(let warning): warnings.append(warning)
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
    return (view, window, { warnings })
  }
}
