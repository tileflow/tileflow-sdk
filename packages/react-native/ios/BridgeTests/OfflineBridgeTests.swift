import Foundation
import Tileflow
import XCTest

@testable import TileflowReactNativeBridge

final class OfflineBridgeTests: XCTestCase {
  private func roundTrip(_ options: [String: Any]) throws -> [String: Any] {
    OfflineBridge.encode(try OfflineBridge.options(options))
  }

  func testOptionsKeepTheirShapeBothWays() throws {
    let hosted: [String: Any] = [
      "type": "hosted", "mapId": "map_0123456789abcdef", "themes": ["day", "night"],
    ]
    let geometries: [[String: Any]] = [
      ["type": "boundingBox", "west": -3.8, "south": 40.3, "east": -3.6, "north": 40.5],
      [
        "type": "Polygon",
        "coordinates": [[[-3.8, 40.3], [-3.6, 40.3], [-3.6, 40.5], [-3.8, 40.3]]],
      ],
      [
        "type": "GeometryCollection",
        "geometries": [
          ["type": "Point", "coordinates": [-3.7, 40.4]],
          ["type": "LineString", "coordinates": [[-3.7, 40.4], [-3.6, 40.45]]],
        ],
      ],
      ["type": "corridor", "line": [[-3.7, 40.4], [-3.6, 40.45]], "width": 500.0],
    ]
    for geometry in geometries {
      let options: [String: Any] = [
        "geometry": geometry, "content": hosted, "minZoom": 2, "maxZoom": 14,
        "terrainMaxZoom": 11, "networkRestriction": "disallowExpensive",
        "metadata": ["name": "Madrid"],
      ]
      XCTAssertEqual(Fixtures.canonical(try roundTrip(options)), Fixtures.canonical(options))
    }
  }

  func testOmittedOptionsTakeTheSDKDefaults() throws {
    let encoded = try roundTrip([
      "geometry": ["type": "Point", "coordinates": [-3.7, 40.4]],
      "content": [
        "type": "manifest", "url": "https://maps.example.test/manifest.json", "map": "stores",
        "sources": [["id": "streets", "template": "https://tiles.example.test/{z}/{x}/{y}.pbf", "maxZoom": 14]],
      ],
    ])
    XCTAssertEqual(encoded["minZoom"] as? Int, 0)
    XCTAssertEqual(encoded["maxZoom"] as? Int, 15)
    XCTAssertEqual(encoded["terrainMaxZoom"] as? Int, 12)
    XCTAssertEqual(encoded["networkRestriction"] as? String, "none")
    let content = encoded["content"] as! [String: Any]
    let source = (content["sources"] as! [[String: Any]])[0]
    XCTAssertEqual(source["minZoom"] as? Int, 0)
  }

  func testInvalidArgumentsBecomeOfflineErrors() {
    XCTAssertThrowsError(try OfflineBridge.options(["geometry": ["type": "boundingBox"]])) {
      let failure = OfflineBridge.failure($0)
      XCTAssertEqual(failure.code, "invalidOptions")
      XCTAssertEqual(failure.message, "options.geometry.west must be a number")
      XCTAssertEqual(failure.info["recoverable"] as? Bool, false)
    }
    XCTAssertThrowsError(
      try OfflineBridge.options([
        "geometry": ["type": "Circle", "coordinates": []],
        "content": ["type": "hosted", "mapId": "map_0123456789abcdef", "themes": []],
      ])
    ) {
      let failure = OfflineBridge.failure($0)
      XCTAssertEqual(failure.code, "invalidRegion")
      XCTAssertEqual(failure.info["reason"] as? String, "invalidGeoJSON")
    }
  }

  func testOfflineErrorsCarryTheirFields() {
    let error = TileflowOfflineError(
      .rateLimited, context: .init(reason: "tooManyRequests", status: 429), retryAfter: 1.5)
    let failure = OfflineBridge.failure(error)
    XCTAssertEqual(failure.code, "rateLimited")
    XCTAssertEqual(
      Fixtures.canonical(failure.info),
      Fixtures.canonical([
        "code": "rateLimited", "recoverable": true, "reason": "tooManyRequests", "status": 429,
        "retryAfter": 1500,
      ]))
  }

  func testRegionEventsHaveATypeTag() {
    XCTAssertEqual(
      Fixtures.canonical(OfflineBridge.encode(TileflowOfflineRegionEvent.removed(id: "madrid"))),
      Fixtures.canonical(["type": "removed", "id": "madrid"]))
  }
}
