import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// Offline and cache checks that mount a live map in the test host.
@MainActor
extension XCTestCase {
  static var hostedFixtureMapID: String { "map_offlinefixture01" }

  /// Downloads a region of the fixture map, then shows the map with the network switched off: every
  /// resource comes from the downloaded region, as in airplane mode.
  func checkADownloadedRegionShowsTheMapWithoutTheNetwork() async throws {
    let manifest = URL(string: "\(FixtureServer.origin)/cached/manifest.json")!
    try await requireMapFixture(manifest)
    // Nothing from earlier mounts may answer: only the region does.
    await TileflowMapCache.clear()
    let store = offlineMapStore(client: { throw TileflowOfflineError(.invalidConfiguration) })
    try await downloadRegion(
      store, id: "fixture",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.75, south: 40.4, east: -3.65, north: 40.44)),
        content: .manifest(url: manifest, map: "fixture", sources: []), maxZoom: 14))

    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    let source = TileflowMapSource(map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true)
    let map = try await mountMap(source)
    defer { map.close() }
    let features = try await map.view.query(
      at: CGPoint(x: map.view.bounds.midX, y: map.view.bounds.midY))
    XCTAssertTrue(
      features.contains { $0.layer == "poi" }, "Downloaded data did not render: \(features)")
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")
  }

  /// Downloads a region of the fixture's Hosted map as packs. In airplane mode the map opens from
  /// the packs without a session and nothing reaches the network; online it starts its session and
  /// the packs' entries come back unchanged as 304.
  func checkAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline(
    profile: OfflinePackProfile
  ) async throws
  {
    let discovery = URL(
      string: "\(FixtureServer.origin)/maps/\(Self.hostedFixtureMapID)/mobile/manifest.json")!
    try await requireMapFixture(discovery)
    await TileflowMapCache.clear()
    let configuration = try fixtureConfiguration()
    let opensLegacy = profile == .webView
    let store = offlineMapStore(profile: profile, index: opensLegacy ? OfflineServingIndex() : .shared,
      client: { try OfflinePackClient(configuration: configuration) })
    _ = try await fixtureCounters(reset: true)
    try await downloadRegion(
      store, id: "hosted",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.705, south: 40.416, east: -3.695, north: 40.424)),
        content: .hosted(mapID: Self.hostedFixtureMapID, themes: profile == .native ? ["day", "night"] : ["day"]), minZoom: 13,
        maxZoom: 15))
    let downloaded = try await fixtureCounters()
    XCTAssertEqual(downloaded["packs"], 1, "One download created")
    // Only the reopened store publishes this old region to the map's serving index.
    let reader: TileflowOfflineStore
    if opensLegacy {
      var dependencies = await store.core.dependencies
      dependencies.profile = .native
      dependencies.index = .shared
      reader = TileflowOfflineStore(dependencies: dependencies)
    } else { reader = store }
    defer { if opensLegacy { OfflineServingIndex.shared.publish(.init(), from: reader.core) } }
    let stored = await reader.region(id: "hosted")
    let region = try XCTUnwrap(stored)
    XCTAssertEqual(downloaded["packResources"], region.requiredPackCount)
    XCTAssertEqual(downloaded["sessions"], 0)
    XCTAssertEqual(downloaded["downloads"], 2, "Discovery and profile")

    let source = TileflowMapSource.hosted(
      mapID: Self.hostedFixtureMapID, configuration: configuration)
    _ = try await fixtureCounters(reset: true)
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    do {
      defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
      let map = try await mountMap(source)
      defer { map.close() }
      if profile == .native {
        // Blending reads the family and both theme styles from the downloaded pack.
        try await map.view.setBlend(themes: ["day", "night"], position: 0.75)
      }
      let features = try await map.view.query(
        at: CGPoint(x: map.view.bounds.midX, y: map.view.bounds.midY))
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
    let map = try await mountMap(source)
    defer { map.close() }
    let online = try await fixtureCounters()
    XCTAssertEqual(online["sessions"], 1, "Online, the map starts its session")
    XCTAssertGreaterThan(
      online["notModified"] ?? 0, 0, "Stored resources revalidate unchanged: \(online)")
    XCTAssertGreaterThan(online["sessionResources"] ?? 0, 0)
  }

  /// Downloads the fixture's Terrain theme with Terrain to z12, then shows it at z14.5 with the
  /// network switched off. Elevation tiles above z12 answer as online (`404`), so the renderer
  /// overzooms the z12 tiles: nothing is missing and no warning is reported.
  func checkTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline(profile: OfflinePackProfile)
    async throws
  {
    let discovery = URL(
      string: "\(FixtureServer.origin)/maps/\(Self.hostedFixtureMapID)/mobile/manifest.json")!
    try await requireMapFixture(discovery)
    await TileflowMapCache.clear()
    let configuration = try fixtureConfiguration()
    let store = offlineMapStore(profile: profile, client: { try OfflinePackClient(configuration: configuration) })
    try await downloadRegion(
      store, id: "terrain",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.85, south: 40.27, east: -3.55, north: 40.57)),
        content: .hosted(mapID: Self.hostedFixtureMapID, themes: ["terrain"]), minZoom: 0,
        maxZoom: 15))

    _ = try await fixtureCounters(reset: true)
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    let map = try await mountMap(
      .hosted(mapID: Self.hostedFixtureMapID, configuration: configuration), theme: "terrain",
      camera: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 14.5, pitch: 45))
    defer { map.close() }
    let features = try await map.view.query(
      at: CGPoint(x: map.view.bounds.midX, y: map.view.bounds.midY))
    XCTAssertTrue(
      features.contains { $0.layer == "buildings" }, "The packs did not render: \(features)")
    // Elevation tiles keep arriving after the content is ready.
    try await Task.sleep(nanoseconds: 3_000_000_000)
    let warnings = map.warnings()
    if profile == .webView {
      XCTAssertTrue(warnings.isEmpty, "Every tile answered: \(warnings)")
    } else {
      XCTAssertEqual(warnings.map(\.error.context.feature), ["terrain3d"])
      XCTAssertEqual(warnings.map(\.error.context.reason), ["featureUnavailable"])
      XCTAssertEqual(warnings.map(\.occurrences), [1])
    }
    let offline = try await fixtureCounters()
    XCTAssertEqual(offline["sessions"], 0)
    XCTAssertEqual(offline["downloads"], 0)
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")
  }

  /// A second mount shows public resources the first stored, with the network switched off.
  func checkSecondMountShowsCachedPublicResourcesWithoutTheNetwork()
    async throws
  {
    let manifest = URL(string: "\(FixtureServer.origin)/cached/manifest.json")!
    try await requireMapFixture(manifest)
    await TileflowMapCache.clear()
    let source = TileflowMapSource(map: "fixture", manifestURL: manifest, allowsLoopbackHTTP: true)
    let online = try await mountMap(source)
    online.close()

    let usage = await TileflowMapCache.usage()
    XCTAssertGreaterThanOrEqual(
      usage.entries, 3, "Manifest, style and data")
    XCTAssertGreaterThan(usage.bytesByClass[.style] ?? 0, 0)
    // The fixture's other routes are no-store and never reach the disk.
    let uncached = ResourceCacheKey(
      url: URL(string: "\(FixtureServer.origin)/manifest.json")!, scope: .shared)
    XCTAssertFalse(
      FileManager.default.fileExists(
        atPath: ResourceCacheStore.shared.file(for: uncached, retention: .ambient).path))

    TileflowHTTPClient.shared.isNetworkEnabled = false
    defer { TileflowHTTPClient.shared.isNetworkEnabled = true }
    let offline = try await mountMap(source)
    defer { offline.close() }
    let features = try await offline.view.query(
      at: CGPoint(x: offline.view.bounds.midX, y: offline.view.bounds.midY))
    XCTAssertTrue(
      features.contains { $0.layer == "poi" }, "Cached data did not render: \(features)")
  }

  // MARK: Support

  func requireMapFixture(_ url: URL) async throws {
    do {
      let (_, response) = try await URLSession.shared.data(from: url)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
  }

  func fixtureConfiguration() throws -> TileflowConfiguration {
    try TileflowConfiguration(
      apiOrigin: URL(string: FixtureServer.origin)!,
      mapCredential: TileflowCredential("tf_public_" + String(repeating: "f", count: 48)))
  }

  /// A store of its own, downloading in the foreground, whose regions every map may use.
  func offlineMapStore(
    profile: OfflinePackProfile = .native, index: OfflineServingIndex = .shared,
    client: @escaping @Sendable () throws -> OfflinePackClient
  ) -> TileflowOfflineStore
  {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-map-\(UUID().uuidString)", isDirectory: true)
    let store = TileflowOfflineStore(
      dependencies: OfflineStoreCore.Dependencies(
        layout: OfflineLayout(root: root), cache: .shared,
        fetcher: OfflineURLSessionFetcher(
          configuration: .ephemeral, directory: root.appendingPathComponent("transfers")),
        client: client,
        availableBytes: { nil }, index: index, profile: profile))
    addTeardownBlock {
      for region in await store.allRegions() { try? await store.removeRegion(id: region.id) }
      try? FileManager.default.removeItem(at: root)
    }
    return store
  }

  func downloadRegion(
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

  func fixtureCounters(reset: Bool = false, fixture: String = "hosted") async throws -> [String: Int] {
    var request = URLRequest(url: URL(string: "\(FixtureServer.origin)/__fixture/\(fixture)")!)
    request.httpMethod = reset ? "POST" : "GET"
    let (data, _) = try await URLSession.shared.data(for: request)
    let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    return value.compactMapValues { $0 as? Int }
  }

  /// Mounts a map in a window of the host's scene and waits for its content. MapLibre draws only
  /// in a window on a screen.
  func mountMap(
    _ source: TileflowMapSource, theme: String? = nil, camera: TileflowCamera? = nil
  ) async throws -> MountedMap {
    let ready = expectation(description: "Map content loaded")
    ready.assertForOverFulfill = false
    let view = TileflowMapView(source: source, theme: theme, initialCamera: camera)
    // The checks query the middle of the view, where the camera's centre is drawn.
    view.automaticallyAdjustsContentInsets = false
    let mounted = MountedMap(view: view, window: MountedMap.sceneWindow())
    view.onEvent = { [weak mounted] event in
      switch event {
      case .contentReady: ready.fulfill()
      case .failed(let error): mounted?.failures.append(error)
      case .warning(let warning): mounted?.warningList.append(warning)
      default: break
      }
    }
    view.frame = mounted.window.bounds
    mounted.window.rootViewController?.view.addSubview(view)
    await fulfillment(of: [ready], timeout: 30)
    XCTAssertTrue(mounted.failures.isEmpty, "\(mounted.failures)")
    return mounted
  }
}

/// A map on screen and what it reported.
@MainActor
final class MountedMap {
  let view: TileflowMapView
  let window: UIWindow
  var failures: [TileflowMapError] = []
  fileprivate var warningList: [TileflowMapWarning] = []

  init(view: TileflowMapView, window: UIWindow) {
    self.view = view
    self.window = window
  }

  func warnings() -> [TileflowMapWarning] { warningList }

  func close() {
    view.destroy()
    window.isHidden = true
  }

  static func sceneWindow() -> UIWindow {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
    window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    window.rootViewController = UIViewController()
    window.makeKeyAndVisible()
    return window
  }
}
