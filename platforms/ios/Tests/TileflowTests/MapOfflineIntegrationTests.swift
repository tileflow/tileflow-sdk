import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// Draws the map, so it belongs to `MapIntegrationTests` and runs where that suite runs. The
/// checks themselves are in `MapOfflineChecks.swift`, shared with the native engine.
extension MapIntegrationTests {
  func testADownloadedRegionShowsTheMapWithoutTheNetwork() async throws {
    try await checkADownloadedRegionShowsTheMapWithoutTheNetwork(engine: .webView)
  }

  func testAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline() async throws {
    try await checkAHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline(engine: .webView)
  }

  func testTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline() async throws {
    try await checkTerrainZoomedPastItsDownloadedZoomsHasNoHolesOffline(engine: .webView)
  }
}
