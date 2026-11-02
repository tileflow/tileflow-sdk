import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// Draws the map, so it belongs to `MapIntegrationTests` and runs where that suite runs.
extension MapIntegrationTests {
  func testSecondMountShowsCachedPublicResourcesWithoutTheNetwork() async throws {
    try await checkSecondMountShowsCachedPublicResourcesWithoutTheNetwork(engine: .webView)
  }
}
