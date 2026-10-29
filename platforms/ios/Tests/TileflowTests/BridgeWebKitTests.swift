import Foundation
import UIKit
import WebKit
import XCTest

@testable import Tileflow

/// The bridge and data channel against a stub renderer in WebKit, through the real `tileflow:`
/// transport. The stub answers like the embedded runtime but draws nothing, so these tests need
/// neither the fixture server nor a GPU.
@MainActor
final class BridgeWebKitTests: XCTestCase {
  private struct Stub {
    let bridge: MapBridge
    let webView: WKWebView
    let window: UIWindow
    let handler: ResourceSchemeHandler
    let root: URL

    @MainActor
    func close() {
      bridge.retire()
      handler.retire()
      webView.stopLoading()
      webView.configuration.userContentController.removeAllScriptMessageHandlers()
      window.isHidden = true
      try? FileManager.default.removeItem(at: root)
    }
  }

  /// Loads a renderer that offers `selected` as its protocol version.
  private func stub(selected: Int = ProtocolContract.version) async throws -> (
    Stub, TileflowMapError?
  ) {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let script = """
      <!doctype html><meta charset="utf-8"><script>
      const host = window.tileflowHost;
      const envelope = {protocolVersion: \(selected), instanceId: host.instanceId,
        generation: host.generation};
      const post = (value) => webkit.messageHandlers.tileflow.postMessage(JSON.stringify(value));
      const answer = (requestId, result) => post({...envelope, requestId, result});
      const hex = (buffer) => Array.from(new Uint8Array(buffer),
        (byte) => byte.toString(16).padStart(2, '0')).join('');
      const waiting = new Map();
      const cancelled = [];
      const parts = new Map();
      window.tileflow = {receive: async (text) => {
        const {requestId, command} = JSON.parse(text);
        const method = command.method;
        let payload = command.payload;
        if (command.payloadData) {
          // A payload past a control message is read from the data channel, as the runtime does.
          const response = await fetch(`tileflow://data/${command.payloadData.id}`);
          payload = JSON.parse(await response.text());
        }
        if (method === 'addLayer') return answer(requestId, {
          deferred: Boolean(command.payloadData), size: JSON.stringify(payload).length});
        if (method === 'querySourceFeatures') {
          // A result past a control message is read in parts.
          const body = JSON.stringify(Array.from({length: payload.limit},
            (_, id) => ({id, properties: {name: `feature ${id} é`}})));
          const chunks = [];
          for (let start = 0; start < body.length; start += 16384)
            chunks.push(body.slice(start, start + 16384));
          parts.set(requestId, chunks);
          return post({...envelope, requestId, chunks: chunks.length});
        }
        if (method === 'readResult')
          return answer(requestId, parts.get(payload.requestId)[payload.index]);
        if (method === 'cancel') {
          cancelled.push(payload.requestId);
          waiting.get(payload.requestId)?.();
          return answer(requestId, null);
        }
        if (method === 'getCamera') {
          // Never answers by itself: only cancellation ends it.
          return waiting.set(requestId, () => post({...envelope, requestId,
            error: {code: 'cancelled', message: 'The request was cancelled.'}}));
        }
        if (method === 'queryAtPoint') return answer(requestId, cancelled);
        if (method === 'project') {
          const response = await fetch(`tileflow://data/${payload.id}`);
          return answer(requestId, {status: response.status});
        }
        if (method === 'setContent') {
          const started = performance.now();
          const results = [];
          // Like the runtime, each distinct payload is read once.
          const references = new Map(payload.overlays.map((overlay) => [overlay.data.id, overlay.data]));
          for (const reference of references.values()) {
            const response = await fetch(`tileflow://data/${reference.id}`);
            const bytes = await response.arrayBuffer();
            const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
            const value = JSON.parse(new TextDecoder().decode(bytes));
            results.push({id: reference.id, bytes: bytes.byteLength,
              verified: digest === reference.sha256, features: value.features.length});
          }
          return answer(requestId, {results, milliseconds: performance.now() - started});
        }
        post({...envelope, requestId, error: {code: 'invalidRequest', message: method}});
      }};
      post({...envelope, event: 'hello', result: {runtimeHash: 'stub', protocol: {
        minimum: \(selected), maximum: \(selected), selected: \(selected)}}});
      </script>
      """
    try Data(script.utf8).write(to: root.appendingPathComponent("index.html"))
    let data = DataChannel()
    let handler = ResourceSchemeHandler(loader: NoLoader(), runtimeRoot: root, data: data)
    let bridge = MapBridge(instanceID: "stub", generation: 1, runtimeHash: "stub", data: data)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(handler, forURLScheme: ResourceURL.scheme)
    configuration.userContentController.add(bridge, name: "tileflow")
    configuration.userContentController.addUserScript(
      WKUserScript(
        source:
          "Object.defineProperty(window,'tileflowHost',{value:{instanceId:'stub',generation:1}});",
        injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let webView = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 320, height: 480), configuration: configuration)
    let window = UIWindow(frame: webView.frame)
    let controller = UIViewController()
    window.rootViewController = controller
    controller.view.addSubview(webView)
    window.makeKeyAndVisible()
    bridge.webView = webView
    let settled = expectation(description: "Handshake settled")
    var failure: TileflowMapError?
    bridge.onHello = { settled.fulfill() }
    bridge.onFailure = {
      failure = $0
      settled.fulfill()
    }
    bridge.start()
    webView.load(URLRequest(url: ResourceURL.runtimeURL))
    await fulfillment(of: [settled], timeout: 30)
    return (
      Stub(bridge: bridge, webView: webView, window: window, handler: handler, root: root), failure
    )
  }

  func testAMismatchedRendererFailsTheHandshakeWithATypedError() async throws {
    let (stub, failure) = try await stub(selected: ProtocolContract.version + 1)
    defer { stub.close() }
    // A handshake that ran out of time would fail with `timeout` and the reason `handshake`.
    XCTAssertEqual(failure, .incompatibleRuntime)
    XCTAssertEqual(failure?.context.reason, "protocolVersion")
    do {
      _ = try await stub.bridge.call(.getCamera)
      XCTFail("A failed handshake accepted a command.")
    } catch {
      XCTAssertEqual(error as? TileflowMapError, .disposed)
    }
  }

  func testCancellingACallStopsItInTheRenderer() async throws {
    let (stub, failure) = try await stub()
    defer { stub.close() }
    XCTAssertNil(failure)
    let bridge = stub.bridge
    let call = Task { try await bridge.call(.getCamera) }
    try await Task.sleep(for: .milliseconds(200))
    call.cancel()
    do {
      _ = try await call.value
      XCTFail("A cancelled call completed.")
    } catch {
      XCTAssertTrue(error is CancellationError, "\(error)")
    }
    var cancelled: JSONValue = .null
    for _ in 0..<20 {
      cancelled = try await bridge.call(.queryAtPoint)
      if case .array(let values) = cancelled, !values.isEmpty { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    guard case .array(let values) = cancelled else { return XCTFail("\(cancelled)") }
    XCTAssertEqual(values.compactMap(\.string), ["1"])
  }

  /// Records how a 5 MiB GeoJSON reaches the renderer over the data channel, verified by SHA-256,
  /// against the message path protocol 1 used for content: a JSON value decoded and re-encoded by
  /// the host, then passed as a script argument. Protocol 1 capped that path at 64 KiB.
  func testDataChannelCarriesLargeGeoJSONVerifiedAndReleasesIt() async throws {
    let (stub, failure) = try await stub()
    defer { stub.close() }
    XCTAssertNil(failure)
    let geoJSON = Self.geoJSON(bytes: 5 * 1024 * 1024)
    var timings: [String: [Duration]] = [:]
    func measure(_ label: String, _ work: () async throws -> Void) async rethrows {
      let started = ContinuousClock.now
      try await work()
      timings[label, default: []].append(started.duration(to: .now))
    }
    for iteration in 0..<3 {
      // Protocol 1's host-side JSON coding is slow enough that one sample suffices.
      if iteration == 0 {
        try await measure("message") {
          let value = try JSONDecoder().decode(JSONValue.self, from: geoJSON.data)
          let text = String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
          let parsed = try await stub.webView.callAsyncJavaScript(
            "return JSON.parse(message).features.length;", arguments: ["message": text],
            contentWorld: .page)
          XCTAssertEqual((parsed as? NSNumber)?.intValue, geoJSON.features)
        }
      }
      try await measure("script argument") {
        let parsed = try await stub.webView.callAsyncJavaScript(
          "return JSON.parse(message).features.length;",
          arguments: ["message": String(decoding: geoJSON.data, as: UTF8.self)],
          contentWorld: .page)
        XCTAssertEqual((parsed as? NSNumber)?.intValue, geoJSON.features)
      }
      try await measure("data channel") {
        // Both layers share the payload; it is registered and read once.
        let layer = try TileflowGeoJSONLayer(id: "points", geoJSON: geoJSON.data, kind: .circle)
        let outline = try TileflowGeoJSONLayer(id: "outline", geoJSON: geoJSON.data, kind: .circle)
        let (payload, references) = try MapContent(overlays: [layer, outline]).wireValue(
          data: stub.bridge.data)
        let result = try await stub.bridge.call(.setContent, payload: payload, data: references)
        guard case .array(let results) = result["results"] else { return XCTFail("\(result)") }
        XCTAssertEqual(results.count, 1)
        XCTAssertEqual(results.first?["bytes"]?.number, Double(geoJSON.data.count))
        XCTAssertEqual(results.first?["verified"]?.bool, true)
        XCTAssertEqual(results.first?["features"]?.number, Double(geoJSON.features))
        // Nothing remains once the request settles.
        XCTAssertTrue(stub.bridge.data.isEmpty)
        let released = try await stub.bridge.call(
          .project, payload: .object(["id": .string(references[0].id)]))
        XCTAssertEqual(released["status"]?.number, 404)
      }
    }
    let summary = timings.keys.sorted().map { label in
      let values = timings[label]!.map(Self.milliseconds).sorted()
      return String(format: "%@ %.0f ms", label, values[values.count / 2])
    }
    print(
      String(
        format: "Tileflow data channel, %.1f MiB GeoJSON, median of 3: %@.",
        Double(geoJSON.data.count) / 1_048_576, summary.joined(separator: ", ")))
  }

  func testLargePayloadsAndResultsTravelInParts() async throws {
    let (stub, failure) = try await stub()
    defer { stub.close() }
    XCTAssertNil(failure)
    // A filter of 20,000 identifiers is far past a control message.
    var layer = TileflowCircleLayer(id: "chosen", source: "points")
    layer.filter = .inExpression(.id(), .literal((0..<20_000).map(Double.init)))
    let payload = JSONValue.object(["layer": try JSONValue.encoded(layer)])
    let small = try await stub.bridge.call(
      .addLayer, payload: .object(["layer": try JSONValue.encoded(TileflowCircleLayer(id: "a", source: "b"))]))
    XCTAssertEqual(small["deferred"]?.bool, false)
    let large = try await stub.bridge.call(.addLayer, payload: payload)
    XCTAssertEqual(large["deferred"]?.bool, true)
    XCTAssertGreaterThan(large["size"]?.number ?? 0, Double(ProtocolContract.maximumMessageBytes))
    XCTAssertTrue(stub.bridge.data.isEmpty)
    let result = try await stub.bridge.call(.querySourceFeatures, payload: .object(["limit": .number(5000)]))
    guard case .array(let features) = result else { return XCTFail("\(result)") }
    XCTAssertEqual(features.count, 5000)
    XCTAssertEqual(features.last?["properties"]?["name"]?.string, "feature 4999 é")
  }

  private static func milliseconds(_ duration: Duration) -> Double {
    Double(duration.components.seconds) * 1000 + Double(duration.components.attoseconds) / 1e15
  }

  /// A FeatureCollection of points of at least `bytes`.
  static func geoJSON(bytes: Int) -> (data: Data, features: Int) {
    var text = #"{"type":"FeatureCollection","features":["#
    var count = 0
    while text.utf8.count < bytes {
      if count > 0 { text += "," }
      let longitude = -3.75 + Double(count % 1000) / 10_000
      let latitude = 40.40 + Double(count / 1000) / 1000
      text +=
        #"{"type":"Feature","id":\#(count),"properties":{"name":"Point \#(count)","rank":\#(count % 7)},"geometry":{"type":"Point","coordinates":[\#(longitude),\#(latitude)]}}"#
      count += 1
    }
    text += "]}"
    return (Data(text.utf8), count)
  }
}

private struct NoLoader: ResourceLoading {
  func load(_ request: URLRequest) async throws -> ResourcePayload {
    throw ResourceError.invalidAddress
  }
}
