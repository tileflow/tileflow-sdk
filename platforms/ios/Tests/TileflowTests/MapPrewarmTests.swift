import MapLibre
import XCTest

@testable import Tileflow

@MainActor
final class MapPrewarmTests: XCTestCase {
  func testNativePrewarmInstallsTheMapTransportWithoutMountingAMap() async throws {
    let original = TileflowMapView.defaultEngineKind
    TileflowMapView.defaultEngineKind = .native
    defer { TileflowMapView.defaultEngineKind = original }
    let manager = MLNNetworkConfiguration.sharedManager
    let existing = manager.sessionConfiguration.protocolClasses ?? []
    let contexts = MapResourceContexts.shared.activeCount

    TileflowMapView.prewarm()
    TileflowMapView.prewarm()

    for _ in 0..<100 {
      if manager.sessionConfiguration.protocolClasses?.contains(where: {
        $0 == MapLibreResourceProtocol.self
      }) == true {
        break
      }
      try await Task.sleep(for: .milliseconds(50))
    }
    let installed = manager.sessionConfiguration.protocolClasses ?? []
    XCTAssertEqual(installed.filter { $0 == MapLibreResourceProtocol.self }.count, 1)
    XCTAssertTrue(
      Set(existing.map(ObjectIdentifier.init)).isSubset(
        of: Set(installed.map(ObjectIdentifier.init))))
    XCTAssertEqual(MapResourceContexts.shared.activeCount, contexts)
  }
}
