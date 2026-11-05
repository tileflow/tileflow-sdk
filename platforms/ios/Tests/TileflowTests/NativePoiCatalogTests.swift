import Foundation
import XCTest

@testable import Tileflow

final class NativePoiCatalogTests: XCTestCase {
  private func style(version: Int = 3, sourceLayer: String = "business", field: String = "kind")
    -> [String: Any]
  {
    let paints = [
      ["id": "names", "source": "world", "source-layer": "business"],
      ["id": "icons", "source": "world", "source-layer": "business"],
    ]
    let domain: [String: Any] = [
      "fields": [
        "category": field, "name": "title", "filterRank": "fr", "sizeRank": "sr", "icon": "glyph",
        "type": "kind2",
      ],
      "identity": "maplibre-feature-id-if-present",
      "hitTesting": ["frequency": "animation-frame", "order": "rendered-topmost"],
      "deduplication": [
        "identity": ["source", "source-layer", "feature-id"],
        "representationPriority": ["marker", "icon", "combined", "label"],
      ],
      "layers": [
        [
          "layerId": "names", "source": "world", "sourceLayer": "business",
          "anchor": "pointer-coordinate", "representation": "label", "priority": 14,
        ],
        [
          "layerId": "icons", "source": "world", "sourceLayer": sourceLayer,
          "anchor": "pointer-coordinate", "representation": "icon", "priority": 7,
        ],
      ],
    ]
    return [
      "metadata": [
        "tileflow:interaction-manifest": ["version": version, "domains": ["poi": domain]]
      ], "layers": paints,
    ]
  }

  func testTopmostIdentityUsesOnlyPublishedPropertiesAndPrefersItsIcon() throws {
    let catalog = try XCTUnwrap(NativePoiCatalog(style: style()))
    let label = try XCTUnwrap(catalog.layers["names"])
    let icon = try XCTUnwrap(catalog.layers["icons"])
    var hit: NativePoiCatalog.Match?
    catalog.consider(
      layer: label, id: 42, properties: ["category": "food-drink", "kind": "other"], winner: &hit)
    XCTAssertNil(hit)
    catalog.consider(
      layer: label, id: 42,
      properties: ["kind": "food-drink", "title": "Label", "name": "Private"], winner: &hit)
    catalog.consider(
      layer: icon, id: "42", properties: ["kind": "retail", "title": "Another ID"], winner: &hit)
    XCTAssertEqual(hit?.name, "Label")
    catalog.consider(
      layer: icon, id: 42, properties: ["kind": "food-drink", "title": "Tileflow", "extra": 9],
      winner: &hit)
    let coordinate: JSONValue = .object(["longitude": .number(-3.7), "latitude": .number(40.42)])
    XCTAssertEqual(
      hit?.payload(coordinate: coordinate),
      .object([
        "id": .string("42"), "category": .string("food-drink"), "name": .string("Tileflow"),
        "coordinate": coordinate,
      ]))
  }

  func testAnonymousHitsRemainAnonymousAndOverlongNamesAreOmitted() throws {
    let catalog = try XCTUnwrap(NativePoiCatalog(style: style()))
    let label = try XCTUnwrap(catalog.layers["names"])
    var hit: NativePoiCatalog.Match?
    catalog.consider(
      layer: label, id: 1.5,
      properties: ["kind": "medical", "title": String(repeating: "x", count: 4097)], winner: &hit)
    XCTAssertEqual(hit?.category, "medical")
    XCTAssertNil(hit?.id)
    XCTAssertNil(hit?.name)
    catalog.consider(
      layer: label, id: 9, properties: ["kind": "retail", "title": "Lower feature"], winner: &hit)
    XCTAssertEqual(hit?.category, "medical")
  }

  func testUnsupportedVersionUnsafeFieldOrStyleLayerMismatchDisablesTheCatalog() {
    XCTAssertNil(NativePoiCatalog(style: style(version: 2)))
    XCTAssertNil(NativePoiCatalog(style: style(sourceLayer: "different")))
    XCTAssertNil(NativePoiCatalog(style: style(field: "bad\u{0001}field")))
  }
}
