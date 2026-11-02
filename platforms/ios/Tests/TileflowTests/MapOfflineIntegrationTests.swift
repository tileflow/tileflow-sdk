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

  /// A transfer stopped part-way, as when the system ends the app or the network drops, resumes
  /// from the system's resume data with `Range` and `If-Range` instead of starting again.
  func testAnInterruptedTransferResumesFromWhereItStopped() async throws {
    let url = URL(string: "\(FixtureServer.origin)/__fixture/resumable")!
    try await requireMapFixture(
      URL(string: "\(FixtureServer.origin)/maps/\(Self.hostedFixtureMapID)/mobile/manifest.json")!)
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
}
