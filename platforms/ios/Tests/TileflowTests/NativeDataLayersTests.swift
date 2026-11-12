import Foundation
import XCTest

@testable import Tileflow

final class NativeDataLayersTests: XCTestCase {
  func testFillsCompiledDataAndPlacesOverlayWithoutChangingAuthoredSources() throws {
    let style: [String: Any] = [
      "version": 8,
      "sources": [
        "places": [
          "type": "geojson", "data": ["type": "FeatureCollection", "features": []], "cluster": true,
        ]
      ],
      "layers": [
        [
          "id": "labels", "type": "symbol", "source": "places",
          "layout": ["text-font": ["Noto Sans"]],
        ]
      ],
      "metadata": ["tileflow:overlay-placement-manifest": ["anchors": ["below-labels": "labels"]]],
    ]
    let input = JSONValue(foundation: [
      "dataSources": [
        "places": ["kind": "geojson", "data": "https://data.example/places.json", "cluster": false]
      ],
      "dataOverlays": [
        "dots": [
          "kind": "maplibre-overlay", "source": "places", "placement": "below-labels",
          "layers": [
            [
              "id": "counts", "type": "symbol", "metadata": ["tileflow:cluster": ["role": "count"]],
              "layout": [:],
            ]
          ],
        ]
      ],
    ])
    let result = JSONValue(foundation: try NativeDataLayers(input).applying(to: style))
    XCTAssertEqual(result["sources"]?["places"]?["cluster"], .bool(true))
    XCTAssertEqual(
      result["sources"]?["places"]?["data"]?.string, "https://data.example/places.json")
    XCTAssertEqual(result["layers"]?.array?.first?["id"]?.string, "counts")
    XCTAssertEqual(
      result["layers"]?.array?.first?["layout"]?["text-font"], .array([.string("Noto Sans")]))
    XCTAssertNotEqual(
      JSONValue(foundation: style)["sources"]?["places"]?["data"],
      result["sources"]?["places"]?["data"])
  }

  func testRuntimeSourceProjectionDoesNotReplayDeclarativeOverlays() async throws {
    struct NoResources: ResourceLoading {
      func load(_ request: URLRequest) async throws -> ResourcePayload {
        throw TileflowMapError.resourceFailed
      }
    }
    let input = JSONValue(foundation: [
      "dataOverlays": [
        "dots": [
          "kind": "maplibre-overlay", "source": "authored", "placement": "above-labels",
          "layers": [["id": "dots", "type": "circle"]],
        ]
      ]
    ])
    let preparation = NativeMapPreparation(
      loader: NoResources(), context: MapResourceAddress.newContext(), storedZooms: nil,
      dataLayers: try NativeDataLayers(input))
    let projected = try await preparation.projectSource(
      .init(value: [
        "sources": ["app": ["type": "vector", "tiles": ["https://tiles.example/{z}/{x}/{y}.pbf"]]]
      ]), styleURL: URL(string: "https://maps.example/style.json")!)
    let result = try JSONDecoder().decode(JSONValue.self, from: Data(projected.json.utf8))
    XCTAssertNotNil(result["sources"]?["app"])
    XCTAssertNil(result["sources"]?["authored"])
    XCTAssertTrue(result["layers"]?.array?.isEmpty ?? true)
  }

  func testCannotReplaceCompiledVectorSource() throws {
    let input = JSONValue(foundation: ["dataSources": ["world": ["kind": "geojson", "data": [:]]]])
    let layers = try NativeDataLayers(input)
    XCTAssertThrowsError(
      try layers.applying(to: ["sources": ["world": ["type": "vector"]], "layers": []]))
  }

  func testBrandingUsesVisibleCatalogSourcesAndTheirMapIdentity() {
    let map = "map_AbCdEfGhIjKlMnOp"
    let style: [String: Any] = [
      "sources": [
        "world": ["url": "https://api.tileflow.dev/tiles/world/tiles.json?map=\(map)"],
        "unused": ["url": "https://api.tileflow.dev/tiles/terrain/tiles.json"],
      ],
      "layers": [["id": "land", "source": "world"]],
    ]
    XCTAssertEqual(
      NativeBrandingSource.read(style, apiOrigin: "https://api.tileflow.dev"),
      [NativeBrandingSource(origin: "https://api.tileflow.dev", mapID: map)])
    XCTAssertTrue(NativeBrandingSource.read(style, apiOrigin: "https://other.example").isEmpty)
  }
  func testHostedCatalogBrandingUsesDiscoveryIdentityWithoutUrlSelectors() {
    let map = "map_AbCdEfGhIjKlMnOp"
    let style: [String: Any] = [
      "sources": ["world": ["url": "https://api.tileflow.dev/tiles/world/tiles.json"]],
      "layers": [["id": "land", "source": "world"]],
    ]
    XCTAssertEqual(
      NativeBrandingSource.read(style, apiOrigin: "https://api.tileflow.dev", hostedMapID: map),
      [NativeBrandingSource(origin: "https://api.tileflow.dev", mapID: map)])
  }

  @MainActor
  func testPaidBrandingRemainsPendingUntilItsPolicyArrives() async {
    let map = "map_AbCdEfGhIjKlMnOp"
    let answered = expectation(description: "Policy applied")
    var states: [NativeBranding.State] = []
    let branding = NativeBranding(
      load: { url in
        XCTAssertEqual(url.path, "/maps/\(map)/mobile/branding")
        return ["mapId": map, "catalogLogoRequired": false, "revision": "1", "validForMs": 60_000]
      },
      offline: { (false, nil) },
      present: { state in
        states.append(state)
        if state == .none { answered.fulfill() }
      })
    branding.update([NativeBrandingSource(origin: "https://api.tileflow.dev", mapID: map)])
    XCTAssertEqual(states.last, .pending)
    await fulfillment(of: [answered], timeout: 2)
    XCTAssertEqual(states.last, NativeBranding.State.none)
    XCTAssertFalse(states.contains(.required))
    branding.retire()
  }

  @MainActor
  func testBrandingExpiresWhileRenewalIsStillLoading() async {
    let map = "map_AbCdEfGhIjKlMnOp"
    let expired = expectation(description: "Expired policy hides the map")
    var loaded = false
    var exempt = false
    let branding = NativeBranding(
      load: { _ in
        if loaded { try await Task.sleep(for: .seconds(60)) }
        loaded = true
        return ["mapId": map, "catalogLogoRequired": false, "revision": "1", "validForMs": 5_200]
      },
      offline: { (false, nil) },
      present: { state in
        if state == .none { exempt = true }
        if exempt && state == .pending { expired.fulfill() }
      })
    branding.update([NativeBrandingSource(origin: "https://api.tileflow.dev", mapID: map)])
    await fulfillment(of: [expired], timeout: 7)
    branding.retire()
  }

  @MainActor
  func testInlineDataUsesRequestOwnedReferences() throws {
    let input = JSONValue(foundation: [
      "dataSources": [
        "places": [
          "kind": "geojson",
          "data": ["type": "FeatureCollection", "features": []],
        ]
      ], "dataOverlays": [:],
    ])
    let channel = MapPayloadStore()
    let (wire, references) = try NativeDataLayers.wire(input, channel: channel)
    XCTAssertNil(wire["dataSources"]?["places"]?["data"])
    XCTAssertEqual(
      try NativeDataLayers.decode(wire, channel: channel, references: references), input)
    XCTAssertThrowsError(try NativeDataLayers.decode(wire, channel: channel, references: []))
    channel.release(references)
    XCTAssertTrue(channel.isEmpty)
    XCTAssertThrowsError(
      try NativeDataLayers.decode(wire, channel: channel, references: references))
  }

  @MainActor
  func testFailedBatchReleasesItsDataReferences() {
    let sources = Dictionary(
      uniqueKeysWithValues: (0...MapContract.maximumDataReferences).map { i in
        (
          "s\(i)",
          JSONValue(foundation: [
            "kind": "geojson",
            "data": [
              "type": "FeatureCollection",
              "features": [
                [
                  "type": "Feature", "id": i, "properties": [:],
                  "geometry": ["type": "Point", "coordinates": [0, 0]],
                ]
              ],
            ],
          ])
        )
      })
    let channel = MapPayloadStore()
    XCTAssertThrowsError(
      try NativeDataLayers.wire(
        .object(["dataSources": .object(sources), "dataOverlays": .object([:])]), channel: channel))
    XCTAssertTrue(channel.isEmpty)
  }

}
