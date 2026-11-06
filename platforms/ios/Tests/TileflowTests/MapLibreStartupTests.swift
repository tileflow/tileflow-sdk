import MapLibre
import XCTest

@testable import Tileflow

@MainActor
final class MapLibreStartupTests: XCTestCase {
  func testTileflowCanPrewarmWithNetworkDisabled() async throws {
    let manager = MLNNetworkConfiguration.sharedManager
    let original = manager.sessionConfiguration
    manager.sessionConfiguration = .background(withIdentifier: "dev.tileflow.tests.invalid-startup")
    do {
      try await MapLibreRuntime.prepare()
      XCTFail("A background renderer session was accepted")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .invalidConfiguration)
    }
    manager.sessionConfiguration = original
    let offlineSwitch = TileflowOfflineSwitch.shared
    let wasNetworkEnabled = offlineSwitch.isNetworkEnabled
    let foreignRequests = LockedValue<[URL]>([])
    offlineSwitch.isNetworkEnabled = false
    MapLibreResourceProtocol.foreignRequestObserver = { url in
      foreignRequests.withLock { $0.append(url) }
    }
    defer {
      offlineSwitch.isNetworkEnabled = wasNetworkEnabled
      MapLibreResourceProtocol.foreignRequestObserver = nil
    }

    let activeMaps = MapResourceContexts.shared.activeCount
    TileflowMapView.prewarm()
    try await MapLibreRuntime.prepare()
    XCTAssertEqual(MapResourceContexts.shared.activeCount, activeMaps)
    XCTAssertTrue(foreignRequests.withLock { $0.isEmpty })
  }

  // Run this test alone in a fresh host with TEST_RUNNER_TILEFLOW_TEST_STALE_MAPLIBRE=1.
  func testTileflowFailsWhenMapLibreAlreadyOwnsTheTransport() async throws {
    try XCTSkipUnless(
      ProcessInfo.processInfo.environment["TILEFLOW_TEST_STALE_MAPLIBRE"] == "1",
      "Requires a fresh test host")
    _ = MLNOfflineStorage.shared

    do {
      try await MapLibreRuntime.prepare()
      XCTFail("Tileflow started after MapLibre initialized its session")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .invalidConfiguration)
      XCTAssertTrue(error.context.message?.contains("Configure Tileflow before MapLibre") == true)
    }
  }
}
