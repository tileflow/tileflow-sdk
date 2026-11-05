import MapLibre
import XCTest

@testable import Tileflow

@MainActor
final class MapPrewarmTests: XCTestCase {
  func testUnavailableMetalOrAnUnexpectedFrameworkFailsBeforeTheRendererStarts() async throws {
    let privateVersion = "unexpected-private-framework-path"
    let incompatible: [MapLibreRuntime.Capabilities] = [
      .init(metalAvailable: false, version: "7.0.0"),
      .init(metalAvailable: true, version: nil),
      .init(metalAvailable: true, version: privateVersion),
    ]
    let contexts = MapResourceContexts.shared.activeCount
    for capabilities in incompatible {
      do {
        try await MapLibreRuntime.prepare(capabilities)
        XCTFail("An unsupported renderer completed startup")
      } catch let error as TileflowMapError {
        XCTAssertEqual(error, .unsupportedDevice)
        XCTAssertFalse(error.isRecoverable)
        XCTAssertFalse(error.description.contains(privateVersion))
      }
    }
    XCTAssertEqual(MapResourceContexts.shared.activeCount, contexts)
    try await MapLibreRuntime.prepare()
  }

  func testNativePrewarmInstallsTheMapTransportWithoutMountingAMap() async throws {
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
