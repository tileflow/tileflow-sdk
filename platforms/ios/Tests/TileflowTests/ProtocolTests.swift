import Foundation
import XCTest

@testable import Tileflow

@MainActor
final class ProtocolTests: XCTestCase {
  func testRendererErrorsCarryTheSharedTaxonomyAndContext() {
    let error = TileflowMapError(
      wire: .object([
        "code": .string("resourceFailed"), "message": .string("A map resource failed to load."),
        "context": .object([
          "resource": .string("tile"), "origin": .string("https://tiles.example.com"),
          "status": .number(503), "reason": .string("dataIntegrity"),
        ]),
      ]))
    XCTAssertEqual(error, .resourceFailed)
    XCTAssertTrue(error.isRecoverable)
    XCTAssertEqual(error.context.resource, .tile)
    XCTAssertEqual(error.context.origin, "https://tiles.example.com")
    XCTAssertEqual(error.context.status, 503)
    XCTAssertEqual(error.context.reason, "dataIntegrity")
    // Codes only the host may raise, or unknown codes, are renderer faults.
    for code in ["credentialRejected", "evaluate", ""] {
      XCTAssertEqual(TileflowMapError(wire: .object(["code": .string(code)])), .rendererFailed)
    }
    XCTAssertEqual(TileflowMapError(wire: nil), .rendererFailed)
    // Equality is by code, so existing matches keep working whatever the context.
    switch TileflowMapError(.disposed, context: .init(reason: "x")) {
    case .disposed: break
    default: XCTFail("A code did not match its static value.")
    }
    XCTAssertEqual(
      Set(TileflowMapError.Code.allCases.filter { !$0.isRecoverable }.map(\.rawValue)),
      [
        "invalidSource", "unsupportedDevice", "invalidRequest", "disposed", "credentialRejected",
        "accessDenied", "quotaExceeded", "sessionRejected", "missingCredential",
        "invalidConfiguration",
      ])
    for code in MapContract.rendererErrors {
      XCTAssertNotNil(TileflowMapError.Code(rawValue: code), code)
    }
  }

  func testEventLevelsAreCumulativeAndOnlyChosenEventsAreRequested() {
    func requested(_ options: TileflowEventOptions) -> [String: Int] {
      Dictionary(
        uniqueKeysWithValues: EventSubscriptions.demand(for: options).map {
          ($0.key.rawValue, $0.value)
        })
    }
    let essential = requested(.init())
    XCTAssertEqual(essential["cameraMoveEnded"], 0)
    XCTAssertNil(essential["cameraMoveStarted"])
    XCTAssertNil(essential["cameraMoved"])
    XCTAssertNil(essential["error"])
    let camera = requested(.init(level: .camera))
    XCTAssertEqual(camera["cameraMoveStarted"], 0)
    XCTAssertNil(camera["cameraMoved"])
    let continuous = requested(.init(level: .continuous, cameraUpdateInterval: 0.25))
    XCTAssertEqual(continuous["cameraMoved"], 250)
    XCTAssertTrue(Set(essential.keys).isSubset(of: Set(camera.keys)))
    XCTAssertTrue(Set(camera.keys).isSubset(of: Set(continuous.keys)))
    XCTAssertTrue(TileflowEventLevel.continuous.includes(.essential))
    XCTAssertFalse(TileflowEventLevel.essential.includes(.camera))
    // The SDK follows every movement for `isMoving`, and every frame for its compass and scale
    // bar; the renderer sends the union, at the shortest interval any owner asks for.
    let sdk = EventSubscriptions(application: .init())
    XCTAssertEqual(sdk.events[.cameraMoveStarted], 0)
    XCTAssertNil(sdk.events[.cameraMoved])
    var shared = EventSubscriptions(
      application: .init(level: .continuous, cameraUpdateInterval: 1), followCamera: true)
    XCTAssertEqual(shared.events[.cameraMoved], 0)
    shared.set(.controls, [:])
    XCTAssertEqual(shared.events[.cameraMoved], 1000)
    shared.set(.application, [.cameraMoved: 50, .error: 0])
    XCTAssertEqual(shared.events[.cameraMoved], 50)
    XCTAssertNil(shared.events[.error])
    XCTAssertThrowsError(try TileflowEventOptions(cameraUpdateInterval: -1).validate())
    XCTAssertThrowsError(try TileflowEventOptions(cameraUpdateInterval: 61).validate())
  }

  func testCameraEventsRetainBoundsFromTheirFrame() throws {
    let camera: JSONValue = .object([
      "longitude": .number(179), "latitude": .number(20), "zoom": .number(3),
      "bearing": .number(45), "pitch": .number(30),
    ])
    let frame: JSONValue = .object([
      "camera": camera, "reason": .string("gesture"),
      "bounds": .object([
        "west": .number(170), "south": .number(10), "east": .number(-170), "north": .number(30),
      ]),
    ])
    let change = try XCTUnwrap(TileflowMapView.cameraChange("cameraMoved", frame))
    XCTAssertEqual(change.bounds, TileflowBounds(west: 170, south: 10, east: -170, north: 30))
    let old = try XCTUnwrap(
      TileflowMapView.cameraChange(
        "cameraMoved", .object(["camera": camera, "reason": .string("api")])))
    XCTAssertNil(old.bounds)
  }

  func testCameraEventsCarryPhaseAndReason() {
    let camera: JSONValue = .object([
      "longitude": .number(-3.7), "latitude": .number(40.42), "zoom": .number(12),
      "bearing": .number(0), "pitch": .number(0),
    ])
    let change = TileflowMapView.cameraChange(
      "cameraMoveStarted", .object(["camera": camera, "reason": .string("gesture")]))
    XCTAssertEqual(change?.phase, .started)
    XCTAssertEqual(change?.reason, .gesture)
    XCTAssertEqual(change?.isFinal, false)
    XCTAssertEqual(
      TileflowMapView.cameraChange(
        "cameraMoveEnded", .object(["camera": camera, "reason": .string("api")]))?.isFinal, true)
    XCTAssertNil(
      TileflowMapView.cameraChange(
        "cameraMoved", .object(["camera": camera, "reason": .string("teleport")])))
    XCTAssertNil(
      TileflowMapView.cameraChange(
        "cameraMoved",
        .object([
          "camera": .object(["longitude": .number(181), "latitude": .number(0), "zoom": .number(1)]
          ),
          "reason": .string("api"),
        ])))
    for reason in TileflowCameraChangeReason.allCases {
      XCTAssertNotNil(
        TileflowMapView.cameraChange(
          "cameraMoved", .object(["camera": camera, "reason": .string(reason.rawValue)])))
    }
  }

  func testLayersCheckTheirParametersAndLeaveGeoJSONToTheRenderer() throws {
    let text = #"{"type":"FeatureCollection","features":[]}"#
    let layer = try TileflowGeoJSONLayer(id: "content", geoJSON: Data(text.utf8), kind: .fill)
    XCTAssertEqual(layer.digest, ResourceDigest.sha256(Data(text.utf8)))
    for invalid in [
      { try TileflowGeoJSONLayer(id: "../style", geoJSON: Data(text.utf8), kind: .fill) },
      { try TileflowGeoJSONLayer(id: "a", geoJSON: Data(text.utf8), kind: .fill, color: "red") },
      { try TileflowGeoJSONLayer(id: "a", geoJSON: Data(text.utf8), kind: .line, size: 65) },
      { try TileflowGeoJSONLayer(id: "a", geoJSON: Data(), kind: .fill) },
      {
        try TileflowGeoJSONLayer(
          id: "a", geoJSON: Data(count: MapContract.maximumDataBytes + 1), kind: .fill)
      },
    ] {
      XCTAssertThrowsError(try invalid()) {
        XCTAssertEqual($0 as? TileflowMapError, .invalidRequest)
      }
    }
    // Layers sharing data register it once.
    let channel = MapPayloadStore()
    let content = MapContent(
      overlays: [
        layer, try TileflowGeoJSONLayer(id: "outline", geoJSON: Data(text.utf8), kind: .line),
      ])
    let (payload, references) = try content.wireValue(data: channel)
    XCTAssertEqual(Set(references).count, 1)
    guard case .array(let overlays) = payload["overlays"] else { return XCTFail("No overlays.") }
    XCTAssertEqual(overlays[0]["data"]?["id"]?.string, references[0].id)
    XCTAssertEqual(overlays[1]["data"]?["sha256"]?.string, layer.digest)
    channel.release(references)
    XCTAssertTrue(channel.isEmpty)
    try TileflowMapView.validate(CGPoint(x: -120, y: 2400))
    for point in [CGPoint(x: CGFloat.nan, y: 0), CGPoint(x: 0, y: 40_000)] {
      XCTAssertThrowsError(try TileflowMapView.validate(point))
    }
  }
}
