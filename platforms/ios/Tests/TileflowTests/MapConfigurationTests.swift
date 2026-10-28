import Foundation
import UIKit
import WebKit
import XCTest

@testable import Tileflow

/// How a Hosted map finds its credential and API origin: its own configuration, else the one set
/// with `Tileflow.configure`, else the Info.plist. Only the map credential authorizes a map.
@MainActor
final class MapConfigurationTests: XCTestCase {
  private let mapID = "map_0123456789abcdef"
  private let credential = "tf_public_" + String(repeating: "a", count: 48)
  private let otherCredential = "tf_public_" + String(repeating: "c", count: 48)
  private let servicesCredential = "tf_public_" + String(repeating: "b", count: 48)

  func testTheMapsOwnConfigurationComesFirst() throws {
    let source = TileflowMapSource.hosted(
      mapID: mapID, configuration: try configuration("https://own.example.test", credential))
    let loadable = try source.loadable { XCTFail("Read the process configuration"); throw Stop() }
    XCTAssertEqual(try endpoint(of: loadable), ["https://own.example.test", credential])
    XCTAssertEqual(
      loadable.manifestURL.absoluteString,
      "https://own.example.test/maps/\(mapID)/mobile/manifest.json")
    XCTAssertEqual(
      loadable.publicMetadataURLs,
      [
        loadable.manifestURL,
        URL(string: "https://own.example.test/maps/\(mapID)/mobile/webview-v1/manifest.json")!,
      ])

    let fromProcess = try TileflowMapSource.hosted(mapID: mapID).loadable {
      try self.configuration("https://process.example.test", self.otherCredential)
    }
    XCTAssertEqual(try endpoint(of: fromProcess), ["https://process.example.test", otherCredential])
  }

  func testTheConfiguredProcessConfigurationReplacesTheInfoPlist() throws {
    // This leaves the process configured; no other map test reads the process configuration.
    Tileflow.configure(try configuration("https://configured.example.test", credential))
    XCTAssertEqual(
      try endpoint(of: TileflowMapSource.hosted(mapID: mapID).loadable()),
      ["https://configured.example.test", credential])
    let own = TileflowMapSource.hosted(
      mapID: mapID, configuration: try configuration("https://own.example.test", otherCredential))
    XCTAssertEqual(try endpoint(of: own.loadable()), ["https://own.example.test", otherCredential])
  }

  func testTheInfoPlistConfiguresTheMap() throws {
    let bundle = try temporaryBundle([
      "TileflowAPIOrigin": "https://plist.example.test/",
      "TileflowMapCredential": credential,
      "TileflowServicesCredential": servicesCredential,
    ])
    let loadable = try TileflowMapSource.hosted(mapID: mapID).loadable {
      try TileflowConfiguration.infoPlist(bundle)
    }
    XCTAssertEqual(try endpoint(of: loadable), ["https://plist.example.test", credential])

    let servicesOnly = try temporaryBundle(["TileflowServicesCredential": servicesCredential])
    XCTAssertThrowsError(
      try TileflowMapSource.hosted(mapID: mapID).loadable {
        try TileflowConfiguration.infoPlist(servicesOnly)
      }
    ) { XCTAssertEqual($0 as? TileflowMapError, .missingCredential) }
  }

  func testMissingAndInvalidConfigurationsAreTypedErrors() throws {
    let source = TileflowMapSource.hosted(mapID: mapID)
    let cases: [(String, () throws -> TileflowConfiguration, TileflowMapError)] = [
      ("no credential", { try TileflowConfiguration() }, .missingCredential),
      (
        "services credential only",
        {
          try TileflowConfiguration(
            servicesCredential: TileflowCredential(self.servicesCredential),
            searchCredential: TileflowCredential(self.servicesCredential))
        }, .missingCredential
      ),
      (
        "unreadable Info.plist",
        { throw TileflowConfigurationError.invalidValue(key: "TileflowMapCredential") },
        .invalidConfiguration
      ),
      (
        "HTTP API origin",
        { try self.configuration("http://127.0.0.1:8787", self.credential) },
        .invalidConfiguration
      ),
    ]
    for (name, read, expected) in cases {
      XCTAssertThrowsError(try source.loadable(fallback: read), name) {
        XCTAssertEqual($0 as? TileflowMapError, expected, name)
      }
    }
    for invalid in [
      TileflowMapSource.hosted(mapID: "map_short"),
      TileflowMapSource.hosted(mapID: mapID, surfaceID: "Not valid"),
      TileflowMapSource.hosted(mapID: mapID, surfaceID: "tf_public_surface"),
      TileflowMapSource.hosted(
        mapID: mapID, publicResourceOrigins: [URL(string: "http://public.example")!]),
    ] {
      XCTAssertThrowsError(try invalid.validate()) {
        XCTAssertEqual($0 as? TileflowMapError, .invalidSource)
      }
    }
  }

  func testAViewWithoutAMapCredentialReportsItAndStartsNoRenderer() throws {
    let services = try TileflowConfiguration(
      apiOrigin: URL(string: "https://api.tileflow.test")!,
      servicesCredential: TileflowCredential(servicesCredential))
    let view = TileflowMapView(source: .hosted(mapID: mapID, configuration: services))
    var failures: [TileflowMapError] = []
    view.onEvent = { if case .failed(let error) = $0 { failures.append(error) } }
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let controller = UIViewController()
    window.rootViewController = controller
    controller.view.addSubview(view)
    window.makeKeyAndVisible()
    defer {
      view.destroy()
      window.isHidden = true
    }
    XCTAssertEqual(failures, [.missingCredential])
    XCTAssertFalse(view.subviews.contains { $0 is WKWebView })
    XCTAssertThrowsError(try view.reload()) {
      XCTAssertEqual($0 as? TileflowMapError, .missingCredential)
    }
  }

  // MARK: Helpers

  private struct Stop: Error {}

  private func configuration(_ origin: String, _ mapCredential: String) throws
    -> TileflowConfiguration
  {
    try TileflowConfiguration(
      apiOrigin: URL(string: origin)!,
      servicesCredential: TileflowCredential(servicesCredential),
      mapCredential: TileflowCredential(mapCredential))
  }

  /// The session-start origin and the credential it presents.
  private func endpoint(of source: LoadableMapSource) throws -> [String] {
    let endpoint = try XCTUnwrap(source.hosted)
    let request = try endpoint.sessionRequest(
      mapID: mapID, sessionID: "session", surfaceID: "mobile-map")
    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
    let value = try XCTUnwrap(request.value(forHTTPHeaderField: "X-Tileflow-Mobile-Client"))
    for text in [dumped(source), String(reflecting: endpoint), "\(endpoint)"] {
      XCTAssertFalse(text.contains(value.dropFirst(10)), text)
    }
    return [
      ResourcePolicy.origin(try XCTUnwrap(request.url)), value,
    ]
  }

  private func temporaryBundle(_ info: [String: Any]) throws -> Bundle {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
      .appendingPathComponent("Configuration.bundle", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var plist = info
    plist["CFBundleIdentifier"] = "dev.tileflow.tests.configuration"
    let data = try PropertyListSerialization.data(fromPropertyList: plist, format: .xml, options: 0)
    try data.write(to: directory.appendingPathComponent("Info.plist"))
    return try XCTUnwrap(Bundle(url: directory))
  }
}

func dumped(_ value: Any) -> String {
  var text = ""
  dump(value, to: &text)
  return text
}
