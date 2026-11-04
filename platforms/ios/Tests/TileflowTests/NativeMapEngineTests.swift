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
      camera: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 12, bearing: 30),
      engine: .native)
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
    // What the native engine does not draw yet is refused, not silently dropped.
    do {
      try await view.setContent(
        annotations: [
          .init(id: "place", coordinate: .init(longitude: -3.7, latitude: 40.42), title: "Place")
        ])
      XCTFail("The native engine accepted content it does not draw")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .invalidRequest)
    }
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
      theme: "labels", engine: .native)
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
      .hosted(mapID: Self.hostedFixtureMapID, configuration: configuration), theme: "labels",
      engine: .native)
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
    try await checkADownloadedRegionShowsTheMapWithoutTheNetwork(engine: .native)
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline() async throws {
    try await checkAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline(engine: .native)
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testDownloadedNativeThemesBlendWithoutANetwork() async throws {
    try await checkAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline(engine: .native, profile: .native)
    XCTAssertEqual(foreign.withLock { $0 }, [])
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
    let map = try await mountMap(source, engine: .native)
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
    try await checkTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline(engine: .native)
    XCTAssertEqual(foreign.withLock { $0 }, [])
  }

  func testSecondMountShowsCachedPublicResourcesWithoutTheNetwork() async throws {
    try await checkSecondMountShowsCachedPublicResourcesWithoutTheNetwork(engine: .native)
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
