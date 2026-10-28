import Foundation
import XCTest

@testable import Tileflow

@MainActor
final class ProtocolTests: XCTestCase {
  private func hello(version: Int, selected: Int?, hash: String = "runtime-hash") -> String {
    let protocolValue: JSONValue = .object([
      "minimum": .number(Double(version)), "maximum": .number(Double(version)),
      "selected": selected.map { .number(Double($0)) } ?? .null,
    ])
    let envelope = MapBridge.Envelope(
      protocolVersion: version, instanceId: "view", generation: 1, event: "hello",
      result: .object(["runtimeHash": .string(hash), "protocol": protocolValue]))
    return String(decoding: try! JSONEncoder().encode(envelope), as: UTF8.self)
  }

  private func handshake(_ message: String) -> (ready: Bool, failure: TileflowMapError?) {
    let bridge = MapBridge(instanceID: "view", generation: 1, runtimeHash: "runtime-hash")
    var ready = false
    var failure: TileflowMapError?
    bridge.onHello = { ready = true }
    bridge.onFailure = { failure = $0 }
    bridge.receive(message)
    return (ready, failure)
  }

  func testHandshakeAcceptsOnlyTheEmbeddedRendererAtASharedVersion() {
    let version = ProtocolContract.version
    XCTAssertTrue(handshake(hello(version: version, selected: version)).ready)
    // A renderer of another version is a typed incompatibility, never a silent timeout.
    for message in [
      hello(version: version + 1, selected: version + 1),
      hello(version: version, selected: nil),
      hello(version: version, selected: version + 1),
    ] {
      let result = handshake(message)
      XCTAssertFalse(result.ready)
      XCTAssertEqual(result.failure, .incompatibleRuntime)
      XCTAssertEqual(result.failure?.context.reason, "protocolVersion")
      XCTAssertFalse(result.failure?.isRecoverable ?? true)
    }
    let foreign = handshake(hello(version: version, selected: version, hash: "other"))
    XCTAssertEqual(foreign.failure?.context.reason, "runtimeHash")
    // Messages for another view or generation are not this bridge's handshake.
    let bridge = MapBridge(instanceID: "other", generation: 1, runtimeHash: "runtime-hash")
    var failed = false
    bridge.onFailure = { _ in failed = true }
    bridge.receive(hello(version: version + 1, selected: nil))
    XCTAssertFalse(failed)
  }

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
      Set(TileflowMapError.Code.allCases.filter { !$0.isRecoverable }),
      [
        .invalidSource, .missingRuntime, .incompatibleRuntime, .invalidRequest, .disposed,
        .credentialRejected, .accessDenied, .quotaExceeded, .missingCredential,
        .invalidConfiguration,
      ])
    for code in ProtocolContract.runtimeErrors {
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
    XCTAssertNil(essential["hello"])
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
    shared.set(.application, [.cameraMoved: 50, .hello: 0])
    XCTAssertEqual(shared.events[.cameraMoved], 50)
    XCTAssertNil(shared.events[.hello])
    XCTAssertThrowsError(try TileflowEventOptions(cameraUpdateInterval: -1).validate())
    XCTAssertThrowsError(try TileflowEventOptions(cameraUpdateInterval: 61).validate())
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

  func testDataChannelBoundsSharesAndReleasesPayloads() throws {
    let channel = DataChannel()
    let bytes = Data("{\"type\":\"FeatureCollection\",\"features\":[]}".utf8)
    let digest = DataChannel.digest(bytes)
    XCTAssertEqual(digest.count, 64)
    let first = try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    let second = try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    // Equal payloads in flight share one entry and stay until every request releases them.
    XCTAssertEqual(first, second)
    XCTAssertGreaterThanOrEqual(first.id.count, 22)
    XCTAssertEqual(channel.payload(first.id)?.bytes, bytes)
    channel.release([first])
    XCTAssertNotNil(channel.payload(first.id))
    channel.release([second])
    XCTAssertNil(channel.payload(first.id))
    XCTAssertTrue(channel.isEmpty)
    // Identifiers are not reused.
    let third = try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    XCTAssertNotEqual(third.id, first.id)
    channel.release([third, third])
    XCTAssertTrue(channel.isEmpty)

    let large = Data(count: ProtocolContract.maximumDataBytes)
    let held = try channel.register(large, digest: "a", contentType: "application/octet-stream")
    _ = try channel.register(large, digest: "b", contentType: "application/octet-stream")
    XCTAssertThrowsError(
      try channel.register(bytes, digest: digest, contentType: "application/geo+json")
    ) { error in
      XCTAssertEqual(error as? TileflowMapError, .invalidRequest)
      XCTAssertEqual((error as? TileflowMapError)?.context.reason, "dataTooLarge")
      XCTAssertEqual(
        (error as? TileflowMapError)?.context.limit, ProtocolContract.maximumDataTotalBytes)
    }
    channel.release([held])
    XCTAssertThrowsError(
      try channel.register(
        Data(count: ProtocolContract.maximumDataBytes + 1), digest: "c", contentType: "x"))
    channel.retire()
    XCTAssertTrue(channel.isEmpty)
    XCTAssertThrowsError(try channel.register(bytes, digest: digest, contentType: "x")) {
      XCTAssertEqual($0 as? TileflowMapError, .cancelled)
    }
  }

  func testLayersCheckTheirParametersAndLeaveGeoJSONToTheRenderer() throws {
    let text = #"{"type":"FeatureCollection","features":[]}"#
    let layer = try TileflowGeoJSONLayer(id: "content", geoJSON: Data(text.utf8), kind: .fill)
    XCTAssertEqual(layer.digest, DataChannel.digest(Data(text.utf8)))
    for invalid in [
      { try TileflowGeoJSONLayer(id: "../style", geoJSON: Data(text.utf8), kind: .fill) },
      { try TileflowGeoJSONLayer(id: "a", geoJSON: Data(text.utf8), kind: .fill, color: "red") },
      { try TileflowGeoJSONLayer(id: "a", geoJSON: Data(text.utf8), kind: .line, size: 65) },
      { try TileflowGeoJSONLayer(id: "a", geoJSON: Data(), kind: .fill) },
      {
        try TileflowGeoJSONLayer(
          id: "a", geoJSON: Data(count: ProtocolContract.maximumDataBytes + 1), kind: .fill)
      },
    ] {
      XCTAssertThrowsError(try invalid()) {
        XCTAssertEqual($0 as? TileflowMapError, .invalidRequest)
      }
    }
    // Layers sharing data register it once.
    let channel = DataChannel()
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
