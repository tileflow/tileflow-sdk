import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// The map view drawn by MapLibre Native, selected with the internal engine option.
@MainActor
final class NativeMapEngineTests: XCTestCase {
  func testTheNativeEngineMountsAndRetires() async throws {
    let ready = expectation(description: "Map content loaded")
    ready.assertForOverFulfill = false
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest, allowsLoopbackHTTP: true),
      initialCamera: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 12, bearing: 30))
    view.engineKind = .native
    var failures: [TileflowMapError] = []
    view.onEvent = { event in
      switch event {
      case .contentReady: ready.fulfill()
      case .failed(let error): failures.append(error)
      default: break
      }
    }
    let window = Self.window()
    view.frame = window.bounds
    window.rootViewController?.view.addSubview(view)
    defer { window.isHidden = true }
    await fulfillment(of: [ready], timeout: 30)
    XCTAssertTrue(failures.isEmpty, "\(failures)")

    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertTrue(engine.view.isDescendant(of: view))
    let camera = try await view.camera()
    XCTAssertEqual(camera.longitude, -3.7, accuracy: 0.0001)
    XCTAssertEqual(camera.latitude, 40.42, accuracy: 0.0001)
    XCTAssertEqual(camera.zoom, 12, accuracy: 0.01)
    XCTAssertEqual(camera.bearing, 30, accuracy: 0.01)

    view.destroy()
    XCTAssertNil(view.engine)
    XCTAssertFalse(engine.view.isDescendant(of: view))
  }

  /// A window in the host application's scene. MapLibre draws only in a window on a screen; a
  /// window without a scene is never shown.
  static func window() -> UIWindow {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
    window.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    window.rootViewController = UIViewController()
    window.makeKeyAndVisible()
    return window
  }
}
