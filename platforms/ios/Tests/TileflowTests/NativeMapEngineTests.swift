import Foundation
import MapLibre
import SQLite3
import UIKit
import XCTest

@testable import Tileflow

/// The map view drawn by MapLibre Native, selected with the internal engine option. Every request
/// MapLibre makes is answered by the SDK's transport through `MapLibreResourceProtocol`; nothing
/// reaches the network on its own.
@MainActor
final class NativeMapEngineTests: XCTestCase {
  private var foreign: LockedValue<[String]>!
  private var answers: LockedValue<[(remote: String, status: Int?)]>!

  override func setUp() async throws {
    let foreign = LockedValue<[String]>([])
    let answers = LockedValue<[(remote: String, status: Int?)]>([])
    self.foreign = foreign
    self.answers = answers
    MapLibreResourceProtocol.foreignRequestObserver = { url in
      foreign.withLock { $0.append(url.absoluteString) }
    }
    MapLibreResourceProtocol.answerObserver = { url, status in
      answers.withLock { $0.append((url.absoluteString, status)) }
    }
  }

  override func tearDown() async throws {
    MapLibreResourceProtocol.foreignRequestObserver = nil
    MapLibreResourceProtocol.answerObserver = nil
    TileflowOfflineSwitch.shared.isNetworkEnabled = true
  }

  func testTheNativeEngineMountsAndRetires() async throws {
    try await requireMapFixture(FixtureServer.manifest)
    let map = try await mountMap(
      TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest, allowsLoopbackHTTP: true),
      camera: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 12, bearing: 30))
    let view = map.view
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertTrue(engine.view.isDescendant(of: view))
    let camera = try await view.camera()
    XCTAssertEqual(camera.longitude, -3.7, accuracy: 0.0001)
    XCTAssertEqual(camera.latitude, 40.42, accuracy: 0.0001)
    XCTAssertEqual(camera.zoom, 12, accuracy: 0.01)
    XCTAssertEqual(camera.bearing, 30, accuracy: 0.01)
    let point = try await view.project(TileflowCoordinate(longitude: -3.7, latitude: 40.42))
    let coordinate = try await view.unproject(point)
    XCTAssertEqual(coordinate.longitude, -3.7, accuracy: 0.0001)
    XCTAssertEqual(coordinate.latitude, 40.42, accuracy: 0.0001)
    let features = try await view.query(at: point)
    XCTAssertTrue(features.contains { $0.layer == "poi" }, "The POI did not render: \(features)")
    XCTAssertEqual(foreign.withLock { $0 }, [], "MapLibre reached the network on its own")

    map.close()
    XCTAssertNil(view.engine)
    XCTAssertFalse(engine.view.isDescendant(of: view))
  }

  /// A Hosted map with a sprite and glyphs: every request, including the sprite and glyph
  /// variants MapLibre adds, goes through the map's session, and MapLibre stores nothing.
  func testAHostedMapLoadsOnlineThroughTheTransport() async throws {
    try await requireHostedFixture()
    await TileflowMapCache.clear()
    _ = try await fixtureCounters(reset: true)
    let map = try await mountMap(
      .hosted(mapID: Self.hostedFixtureMapID, configuration: try fixtureConfiguration()),
      theme: "labels")
    defer { map.close() }
    let features = try await map.view.query(
      at: CGPoint(x: map.view.bounds.midX, y: map.view.bounds.midY))
    XCTAssertTrue(features.contains { $0.layer == "buildings" }, "\(features)")
    try await Task.sleep(nanoseconds: 500_000_000)

    let answers = self.answers.withLock { $0 }
    let sprite = answers.filter { $0.remote.contains("/sprites/fixture/sprite@2x.") }
    XCTAssertEqual(Set(sprite.map(\.remote)).count, 2, "\(answers)")
    XCTAssertTrue(sprite.allSatisfy { $0.status == 200 }, "\(sprite)")
    let glyphs = answers.filter { $0.remote.contains("/fonts/Noto%20Sans%20Regular/") }
    XCTAssertFalse(glyphs.isEmpty, "\(answers)")
    XCTAssertTrue(glyphs.allSatisfy { $0.status == 200 }, "\(glyphs)")
    XCTAssertTrue(answers.allSatisfy { $0.remote.hasPrefix(FixtureServer.origin) }, "\(answers)")
    XCTAssertEqual(foreign.withLock { $0 }, [], "MapLibre reached the network on its own")
    let counters = try await fixtureCounters()
    XCTAssertEqual(counters["sessions"], 1)
    XCTAssertGreaterThan(counters["sessionResources"] ?? 0, 0)
    XCTAssertEqual(Self.mapLibreRows(), 0, "MapLibre stored a response")
    XCTAssertTrue(map.warnings().isEmpty, "\(map.warnings())")
  }

  /// The same map from its downloaded region with the network switched off: every request is
  /// answered from the region's packs, no session starts and nothing reaches the network.
  func testAHostedMapOpensFromItsPackWithTheNetworkOff() async throws {
    try await requireHostedFixture()
    await TileflowMapCache.clear()
    let configuration = try fixtureConfiguration()
    let store = offlineMapStore(client: { try OfflinePackClient(configuration: configuration) })
    try await downloadRegion(
      store, id: "labels",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.73, south: 40.39, east: -3.67, north: 40.45)),
        content: .hosted(mapID: Self.hostedFixtureMapID, themes: ["labels"]), minZoom: 13,
        maxZoom: 15))
    _ = try await fixtureCounters(reset: true)
    answers.withLock { $0 = [] }
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    let map = try await mountMap(
      .hosted(mapID: Self.hostedFixtureMapID, configuration: configuration), theme: "labels")
    defer { map.close() }
    let features = try await map.view.query(
      at: CGPoint(x: map.view.bounds.midX, y: map.view.bounds.midY))
    XCTAssertTrue(features.contains { $0.layer == "buildings" }, "\(features)")
    try await Task.sleep(nanoseconds: 500_000_000)

    let answers = self.answers.withLock { $0 }
    XCTAssertFalse(answers.isEmpty)
    XCTAssertTrue(answers.allSatisfy { $0.status == 200 }, "\(answers)")
    XCTAssertTrue(answers.contains { $0.remote.contains("/sprites/fixture/sprite@2x.png") })
    XCTAssertTrue(answers.contains { $0.remote.contains("/fonts/Noto%20Sans%20Regular/0-255") })
    XCTAssertEqual(foreign.withLock { $0 }, [], "MapLibre reached the network on its own")
    let counters = try await fixtureCounters()
    XCTAssertEqual(counters["sessions"], 0, "No session starts without a network")
    XCTAssertEqual(counters["downloads"], 0)
    XCTAssertEqual(counters["sessionResources"], 0)
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")
    XCTAssertEqual(Self.mapLibreRows(), 0, "MapLibre stored a response")
    XCTAssertTrue(map.warnings().isEmpty, "\(map.warnings())")
  }

  func testHostedFontFilesRenderFromPacksWithAnEmptyCache() async throws {
    try await requireHostedFixture()
    await TileflowMapCache.clear()
    let configuration = try fixtureConfiguration()
    let store = offlineMapStore(
      profile: .native, client: { try OfflinePackClient(configuration: configuration) })
    try await downloadRegion(
      store, id: "fonts",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.705, south: 40.416, east: -3.695, north: 40.424)),
        content: .hosted(mapID: Self.hostedFixtureMapID, themes: ["fonts"]), minZoom: 13,
        maxZoom: 15))
    await TileflowMapCache.clear()
    _ = try await fixtureCounters(reset: true)
    answers.withLock { $0 = [] }
    TileflowOfflineSwitch.shared.isNetworkEnabled = false

    let map = try await mountMap(
      .hosted(mapID: Self.hostedFixtureMapID, configuration: configuration), theme: "fonts")
    defer { map.close() }
    try await Task.sleep(nanoseconds: 500_000_000)
    let features = try await map.view.query(
      at: CGPoint(x: map.view.bounds.midX, y: map.view.bounds.midY))
    XCTAssertTrue(features.contains { $0.layer == "brand-label" }, "\(features)")
    let fonts = answers.withLock { $0.filter { $0.remote.contains("/font-bundles/") } }
    XCTAssertEqual(Set(fonts.map(\.remote)).count, 2, "Latin and Greek files: \(fonts)")
    XCTAssertTrue(fonts.allSatisfy { $0.status == 200 }, "\(fonts)")
    XCTAssertEqual(foreign.withLock { $0 }, [])
    let counters = try await fixtureCounters()
    XCTAssertEqual(counters["sessions"], 0)
    XCTAssertEqual(counters["downloads"], 0)
    XCTAssertEqual(counters["sessionResources"], 0)
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0)
    XCTAssertEqual(Self.mapLibreRows(), 0)
    XCTAssertTrue(map.warnings().isEmpty, "\(map.warnings())")
  }

  func testMixedFontFallbackRendersOnline() async throws {
    try await checkMixedFontFallback(offline: false)
  }

  func testMixedFontFallbackRendersOffline() async throws {
    try await checkMixedFontFallback(offline: true)
  }

  func testSharedFontStorageAcrossTwoRegions() async throws {
    try await requireHostedFixture()
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("font-measurement-\(UUID().uuidString)")
    let configuration = try fixtureConfiguration()
    let store = offlineMapStore(root: root, client: { try OfflinePackClient(configuration: configuration) })
    func snapshot() throws -> [String: Any] {
      let files = try FileManager.default.contentsOfDirectory(at: root.appendingPathComponent("packs"), includingPropertiesForKeys: [.fileSizeKey]).filter { $0.pathExtension == "tfpack" }
      var fontCount = 0, fontBytes = 0, officialBytes = 0, licenseBytes = 0, fontPackBytes = 0, allPackBytes = 0
      var digests: [String] = []
      for file in files {
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        allPackBytes += size
        let entries = try OfflinePackFormat.index(file).entries.values
        let fonts = entries.filter { $0.contentType.hasPrefix("font/") }
        if fonts.isEmpty { continue }
        digests.append(file.lastPathComponent)
        fontCount += fonts.count
        fontBytes += fonts.reduce(0) { $0 + $1.length }
        officialBytes += fonts.filter { $0.name.contains("/base/") }.reduce(0) { $0 + $1.length }
        licenseBytes += entries.filter { $0.name.hasSuffix(".txt") }.reduce(0) { $0 + $1.length }
        fontPackBytes += size
      }
      return ["fontFiles": fontCount, "fontBytes": fontBytes, "officialFontBytes": officialBytes,
        "licenseBytes": licenseBytes, "fontPackBytes": fontPackBytes, "allPackBytes": allPackBytes, "fontPackDigests": digests.sorted()]
    }
    var snapshots: [[String: Any]] = []
    for (index, west) in [-3.705, -3.695].enumerated() {
      try await downloadRegion(store, id: "madrid-\(index)", options: .init(
        geometry: .boundingBox(.init(west: west, south: 40.416, east: west + 0.01, north: 40.424)),
        content: .hosted(mapID: Self.hostedFixtureMapID, themes: ["fallback"]), minZoom: 13, maxZoom: 15))
      snapshots.append(try snapshot())
    }
    let data = try JSONSerialization.data(withJSONObject: ["platform": "ios", "regions": snapshots], options: [.sortedKeys])
    print("OFFLINE_FONT_MEASUREMENT \(String(decoding: data, as: UTF8.self))")
    XCTAssertEqual(snapshots[0]["fontFiles"] as? Int, 148)
    XCTAssertGreaterThan(snapshots[0]["fontBytes"] as? Int ?? 0, 32 * 1024 * 1024)
    XCTAssertEqual(snapshots[0]["fontPackBytes"] as? Int, snapshots[1]["fontPackBytes"] as? Int)
    XCTAssertEqual(snapshots[0]["fontPackDigests"] as? [String], snapshots[1]["fontPackDigests"] as? [String])
    try await store.removeRegion(id: "madrid-0")
    XCTAssertEqual(try snapshot()["fontPackBytes"] as? Int, snapshots[1]["fontPackBytes"] as? Int)
  }

  private func checkMixedFontFallback(offline: Bool) async throws {
    try await requireHostedFixture()
    await TileflowMapCache.clear()
    let configuration = try fixtureConfiguration()
    if offline {
      let store = offlineMapStore(profile: .native, client: { try OfflinePackClient(configuration: configuration) })
      try await downloadRegion(store, id: "fallback", options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(TileflowBoundingBox(west: -3.705, south: 40.416, east: -3.695, north: 40.424)),
        content: .hosted(mapID: Self.hostedFixtureMapID, themes: ["fallback"]), minZoom: 13, maxZoom: 15))
    }
    await TileflowMapCache.clear()
    _ = try await fixtureCounters(reset: true)
    answers.withLock { $0 = [] }
    TileflowOfflineSwitch.shared.isNetworkEnabled = !offline

    let map = try await mountMap(.hosted(mapID: Self.hostedFixtureMapID, configuration: configuration), theme: "fallback")
    defer { map.close() }
    try await Task.sleep(nanoseconds: 500_000_000)
    for latitude in [40.4205, 40.4195, 40.42] {
      let point = try await map.view.project(TileflowCoordinate(longitude: -3.7, latitude: latitude))
      let features = try await map.view.query(at: point)
      XCTAssertTrue(features.contains { $0.layer == "fallback-label" }, "\(features)")
    }
    let responses = answers.withLock { $0 }
    XCTAssertTrue(responses.contains { $0.remote.contains("/font-bundles/") && $0.status == 200 })
    for file in ["NotoSans-Regular.ttf", "NotoSansCJKjp-Regular.otf", "NotoSansArabic-Regular.ttf"] {
      XCTAssertTrue(responses.contains { $0.remote.contains("/base/") && $0.remote.contains("/\(file)") && $0.status == 200 }, "\(responses)")
    }
    XCTAssertEqual(foreign.withLock { $0 }, [])
    let counters = try await fixtureCounters()
    XCTAssertEqual(counters["sessions"], offline ? 0 : 1)
    if offline {
      XCTAssertEqual(counters["downloads"], 0)
      XCTAssertEqual(counters["sessionResources"], 0)
      let usage = await TileflowMapCache.usage()
      XCTAssertEqual(usage.entries, 0)
    }
    XCTAssertEqual(Self.mapLibreRows(), 0)
    XCTAssertTrue(map.warnings().isEmpty, "\(map.warnings())")
  }

  /// MapLibre's network session is global to the process. When something else replaces it, so
  /// that the SDK no longer answers its requests, a native map fails rather than load without its
  /// credentials.
  func testMapsFailWhenMapLibresSessionNoLongerReachesTheSDK() async throws {
    try await MapLibreNetwork.prepare()
    let manager = MLNNetworkConfiguration.sharedManager
    let original: URLSessionConfiguration = manager.sessionConfiguration
    let replaced = try XCTUnwrap(original.copy() as? URLSessionConfiguration)
    replaced.protocolClasses = replaced.protocolClasses?.filter {
      $0 != MapLibreResourceProtocol.self
    }
    manager.sessionConfiguration = replaced
    defer { manager.sessionConfiguration = original }
    do {
      try await MapLibreNetwork.prepare()
      XCTFail("A map started without the SDK's transport")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .invalidConfiguration)
    }
  }

  // MARK: The offline and cache checks the WebView engine passes

  func testADownloadedRegionShowsTheMapWithoutTheNetwork() async throws {
    try await checkADownloadedRegionShowsTheMapWithoutTheNetwork()
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline() async throws {
    try await checkAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline(profile: .webView)
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testDownloadedNativeThemesBlendWithoutANetwork() async throws {
    try await checkAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline(profile: .native)
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testInconsistentFamilyOpensAndSwitchesThemesDirectly() async throws {
    let url = URL(string: "\(FixtureServer.origin)/native-inconsistent/manifest.json")!
    try await requireMapFixture(url)
    let map = try await mountMap(.init(map: "city", manifestURL: url, allowsLoopbackHTTP: true))
    defer { map.close() }

    XCTAssertTrue(map.warnings().contains { $0.error.context.reason == "nativeFamilyInconsistent" })
    let dark = expectation(description: "Blend selected dark directly")
    let light = expectation(description: "Direct switch selected light")
    map.view.onEvent = { event in
      if case .themeChanged("dark") = event { dark.fulfill() }
      if case .themeChanged("light") = event { light.fulfill() }
      if case .failed(let error) = event { XCTFail(String(describing: error)) }
    }
    try await map.view.setBlend(themes: ["light", "dark"], position: 0.75)
    await fulfillment(of: [dark], timeout: 10)
    try await map.view.setTheme("light")
    await fulfillment(of: [light], timeout: 10)
  }

  func testDownloadedSelfHostedThemesBlendWithoutANetwork() async throws {
    let origin = FixtureServer.origin
    let manifest = URL(string: "\(origin)/native/manifest.json")!
    try await requireMapFixture(manifest)
    await TileflowMapCache.clear()
    let store = offlineMapStore(client: { throw TileflowOfflineError(.invalidConfiguration) })
    try await downloadRegion(
      store, id: "city",
      options: .init(
        geometry: .boundingBox(.init(west: -3.73, south: 40.39, east: -3.67, north: 40.45)),
        content: .manifest(url: manifest, map: "city", sources: [
          .init(id: "tileflow", template: "\(origin)/city/{z}/{x}/{y}.mvt", maxZoom: 16),
          .init(id: "tileflow-terrain", template: "\(origin)/terrain/{z}/{x}/{y}.png", maxZoom: 14),
        ]), maxZoom: 16))

    let before = try await fixtureCounters(fixture: "native-requests")
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    let source = TileflowMapSource(map: "city", manifestURL: manifest, allowsLoopbackHTTP: true)
    let map = try await mountMap(source)
    defer { map.close() }
    let light = try await map.view.routeInks()
    try await map.view.setBlend(themes: ["light", "dark"], position: 0.75)
    let blended = try await map.view.routeInks()
    XCTAssertNotEqual(blended.line, light.line)
    let center = try await map.view.project(.init(longitude: -3.7, latitude: 40.42))
    let features = try await map.view.query(at: center)
    XCTAssertTrue(features.contains { $0.layer.hasPrefix("tileflow-buildings") })
    let after = try await fixtureCounters(fixture: "native-requests")
    XCTAssertEqual(before, after)
    XCTAssertEqual(foreign.withLock { $0 }, [])
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0)
  }

  func testTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline() async throws {
    try await checkTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline(profile: .native)
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testTerrainFromAStoredWebRegionStillOverzoomsOffline() async throws {
    try await checkTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline(profile: .webView)
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testSecondMountShowsCachedPublicResourcesWithoutTheNetwork() async throws {
    try await checkSecondMountShowsCachedPublicResourcesWithoutTheNetwork()
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  // MARK: Support

  private func requireHostedFixture() async throws {
    try await requireMapFixture(
      URL(string: "\(FixtureServer.origin)/maps/\(Self.hostedFixtureMapID)/mobile/manifest.json")!)
  }

  /// Rows MapLibre keeps in its own database: its ambient cache and its offline packs.
  static func mapLibreRows() -> Int {
    let path = MLNOfflineStorage.shared.databasePath
    var total = 0
    for table in ["resources", "tiles"] {
      var database: OpaquePointer?
      guard sqlite3_open_v2(path, &database, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else {
        sqlite3_close(database)
        continue
      }
      defer { sqlite3_close(database) }
      var statement: OpaquePointer?
      guard
        sqlite3_prepare_v2(database, "SELECT COUNT(*) FROM \(table)", -1, &statement, nil)
          == SQLITE_OK
      else { continue }
      defer { sqlite3_finalize(statement) }
      if sqlite3_step(statement) == SQLITE_ROW { total += Int(sqlite3_column_int64(statement, 0)) }
    }
    return total
  }
}

extension NativeMapEngineTests {
  func testSnapshotsDrawHostedDataAppImagesAndCreditsOnlineAndFromPacks() async throws {
    let mapID = Self.hostedFixtureMapID
    try await requireMapFixture(URL(string: "\(FixtureServer.origin)/maps/\(mapID)/mobile/manifest.json")!)
    let configuration = try fixtureConfiguration()
    let source = TileflowMapSource.hosted(mapID: mapID, configuration: configuration)
    let renderer = TileflowMapSnapshotter()
    let center = TileflowCoordinate(longitude: -3.7, latitude: 40.42)
    let options = TileflowMapSnapshotOptions(size: CGSize(width: 240, height: 160), camera: .init(
      longitude: center.longitude, latitude: center.latitude, zoom: 15), theme: "day")
    let flat = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8)).image { context in
      context.cgContext.setFillColor(UIColor.magenta.cgColor)
      context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
    }
    var circle = TileflowCircleAnnotation(id: "center", centerCoordinate: center)
    circle.circleRadius = 14
    circle.circleColor = "#00ff00"
    var annotated = options
    annotated.content.circles = [circle]
    let features = Data(#"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[-3.7,40.42]}}]}"#.utf8)
    annotated.content.overlays = [try TileflowGeoJSONLayer(id: "route-ink", geoJSON: features, kind: .circle,
      color: "#ff0000", size: 27, ink: .line)]
    annotated.content.images = [.init(image: flat, coordinate: center, anchor: .topLeft,
      size: CGSize(width: 16, height: 120))]

    func check() async throws {
      let plain = try await renderer.snapshot(source, options: options)
      let image = try await renderer.snapshot(source, options: annotated)
      XCTAssertEqual(image.cgImage?.width, 240)
      XCTAssertEqual(image.cgImage?.height, 160)
      let marker = try snapshotPixel(image, x: 124, y: 90)
      XCTAssertTrue(marker.magenta, "App marker missing: \(marker)")
      XCTAssertTrue(try snapshotPixel(image, x: 112, y: 80).green, "Circle missing")
      let ink = try snapshotPixel(image, x: 98, y: 80)
      XCTAssertTrue(ink.blue > 200 && ink.red < 70 && ink.greenValue < 140, "Theme ink missing: \(ink)")
      XCTAssertFalse(try snapshotPixel(plain, x: 124, y: 90).magenta, "Unexpected app marker")
      XCTAssertFalse(try snapshotPixel(plain, x: 112, y: 80).green, "Unexpected circle")
      XCTAssertFalse(try snapshotPixel(image, x: 124, y: 159).magenta, "Marker covered attribution")
    }
    await TileflowMapCache.clear()
    _ = try await fixtureCounters(reset: true)
    try await check()
    var doubleScale = annotated
    doubleScale.size = .init(width: 120, height: 80)
    doubleScale.scale = 2
    let scaled = try await renderer.snapshot(source, options: doubleScale)
    XCTAssertEqual(scaled.cgImage?.width, 240)
    XCTAssertEqual(scaled.cgImage?.height, 160)
    XCTAssertTrue(try snapshotPixel(scaled, x: 124, y: 90).magenta, "Scaled image missing")
    XCTAssertFalse(try snapshotPixel(scaled, x: 124, y: 159).magenta, "Scaled image covered attribution")
    let online = try await fixtureCounters()
    XCTAssertGreaterThan(online["sessions"] ?? 0, 0)

    let store = offlineMapStore(profile: .native, client: { try OfflinePackClient(configuration: configuration) })
    try await downloadRegion(store, id: "snap", options: .init(geometry: .boundingBox(.init(
      west: -3.73, south: 40.39, east: -3.67, north: 40.45)), content: .hosted(mapID: mapID, themes: ["day"]),
      minZoom: 13, maxZoom: 15))
    await TileflowMapCache.clear()
    _ = try await fixtureCounters(reset: true)
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    try await check()
    let offline = try await fixtureCounters()
    for key in ["sessions", "downloads", "notModified", "sessionResources"] {
      XCTAssertEqual(offline[key], 0, "Offline request for \(key)")
    }
  }

  func testSnapshotCreditsFollowTheViewportAcrossTheAntimeridianAndRepeatedWorlds() {
    func longitude(_ value: Double) -> Double { (value + 540).truncatingRemainder(dividingBy: 360) - 180 }
    let crossing = SnapshotBounds.measure(width: 128, height: 64) { x, y in
      .init(longitude: longitude(170 + 20 * x / 128), latitude: 20 - 10 * y / 64)
    }
    XCTAssertEqual(crossing, TileflowBounds(west: 170, south: 10, east: 190, north: 20))
    let copies = SnapshotBounds.measure(width: 1024, height: 64) { x, y in
      .init(longitude: longitude(-170 + 720 * x / 1024), latitude: 20 - 10 * y / 64)
    }
    XCTAssertEqual(copies.east - copies.west, 720, accuracy: 1e-8)
    let horizon = SnapshotBounds.measure(width: 128, height: 64) { _, _ in
      .init(longitude: .nan, latitude: .nan)
    }
    XCTAssertEqual(horizon, TileflowBounds(west: -180, south: -90, east: 180, north: 90))
  }

  func testSnapshotPhysicalSizeBoundsAndCancellation() async throws {
    try TileflowMapSnapshotOptions(size: .init(width: 2048, height: 2048), scale: 2).validate()
    for width in [0.0, 4096.1, .infinity, .nan, Double.greatestFiniteMagnitude] {
      XCTAssertThrowsError(try TileflowMapSnapshotOptions(size: .init(width: width, height: 8)).validate()) { error in
        XCTAssertEqual((error as? TileflowMapError)?.code, .invalidRequest)
      }
    }
    let source = TileflowMapSource(map: "fixture", manifestURL: FixtureServer.manifest)
    let task = Task {
      try await TileflowMapSnapshotter().snapshot(source, options: .init(size: .init(width: 200, height: 100)))
    }
    task.cancel()
    do { _ = try await task.value; XCTFail("The cancelled render returned an image") }
    catch is CancellationError {}
  }

  func testCancellingTheSnapshotClosesItsPendingManifestRequest() async throws {
    try await requireMapFixture(FixtureServer.manifest)
    let base = "\(FixtureServer.origin)/__fixture/snapshot-delay/\(UUID().uuidString)"
    let source = TileflowMapSource(map: "fixture", manifestURL: URL(string: base + "/manifest.json")!, allowsLoopbackHTTP: true)
    let before = MapResourceContexts.shared.activeCount
    let task = Task { try await TileflowMapSnapshotter().snapshot(source, options: .init(size: .init(width: 120, height: 80))) }
    defer { task.cancel() }
    func wait(for expected: String) async throws {
      for _ in 0..<150 {
        let (data, _) = try await URLSession.shared.data(from: URL(string: base + "/state")!)
        let state = try JSONSerialization.jsonObject(with: data) as? [String: String]
        if state?["state"] == expected { return }
        try await Task.sleep(for: .milliseconds(30))
      }
      XCTFail("The manifest request did not reach its expected state: \(expected)")
    }
    try await wait(for: "loading")
    XCTAssertEqual(MapResourceContexts.shared.activeCount, before + 1)
    task.cancel()
    do { _ = try await task.value; XCTFail("The cancelled render returned an image") }
    catch is CancellationError {}
    try await wait(for: "cancelled")
    XCTAssertEqual(MapResourceContexts.shared.activeCount, before)
  }

  private struct SnapshotPixel {
    let red: UInt8
    let greenValue: UInt8
    let blue: UInt8
    var magenta: Bool { red > 210 && greenValue < 45 && blue > 210 }
    var green: Bool { red < 45 && greenValue > 210 && blue < 45 }
  }

  private func snapshotPixel(_ image: UIImage, x: Int, y: Int) throws -> SnapshotPixel {
    let source = try XCTUnwrap(image.cgImage?.cropping(to: CGRect(x: x, y: y, width: 1, height: 1)))
    var bytes = [UInt8](repeating: 0, count: 4)
    try bytes.withUnsafeMutableBytes { buffer in
      let context = try XCTUnwrap(CGContext(data: buffer.baseAddress, width: 1, height: 1, bitsPerComponent: 8,
        bytesPerRow: 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
      context.draw(source, in: CGRect(x: 0, y: 0, width: 1, height: 1))
    }
    return SnapshotPixel(red: bytes[0], greenValue: bytes[1], blue: bytes[2])
  }
}
