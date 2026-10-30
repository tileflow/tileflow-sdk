import Foundation
import XCTest

@testable import Tileflow

/// How maps use downloaded regions: a Hosted map without a network opens from its packs without a
/// session, with a network it starts its session, and with the network switched off every request
/// is answered from stored entries alone.
final class OfflineServingTests: XCTestCase {
  private let mapID = "map_0123456789abcdef"
  private let api = URL(string: "https://api.tileflow.test")!
  private let style = URL(
    string: "https://api.tileflow.test/maps/map_0123456789abcdef/mobile/webview-v1/v1/day.json")!
  private let tile = URL(string: "https://tiles.tileflow.test/tiles/world/release-1/1/0/0.pbf")!
  private let landmarks = URL(string: "https://api.tileflow.test/landmarks/tiles.json")!
  private let policy = ResourcePolicy(origins: [
    "https://api.tileflow.test", "https://tiles.tileflow.test",
  ])
  private var directory: URL!
  private var cache: ResourceCacheStore!
  private var scope: ResourceCacheScope { .grant(apiOrigin: api, mapID: mapID) }

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-serving-\(UUID().uuidString)", isDirectory: true)
    cache = ResourceCacheStore(
      ambientRoot: directory.appendingPathComponent("ambient"),
      durableRoot: directory.appendingPathComponent("durable"), maximumBytes: 1 << 24)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  func testWithoutANetworkAHostedMapOpensFromItsPackWithoutASession() async throws {
    let body = pin(style, scope: scope)
    let (loader, sessions, resources) = try makeLoader(served: [style], reachable: false)
    let response = try await loader.load(URLRequest(url: style))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(response.bytes, body)
    XCTAssertEqual(response.headers["Cache-Control"], "no-store")
    XCTAssertTrue(sessions.requests.isEmpty, "No session starts")
    XCTAssertTrue(resources.requests.isEmpty)
  }

  func testWithANetworkAHostedMapStartsItsSessionAndRevalidatesItsPack() async throws {
    let body = pin(style, scope: scope)
    let (loader, sessions, resources) = try makeLoader(served: [style], reachable: true)
    let response = try await loader.load(URLRequest(url: style))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(response.bytes, body, "The unchanged stored copy answers")
    XCTAssertEqual(sessions.requests.map(\.url?.path), ["/v1/sessions/start"])
    let request = try XCTUnwrap(resources.requests.first)
    XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Tileflow-Native-Grant"))
    XCTAssertEqual(request.value(forHTTPHeaderField: "If-None-Match"), etag(body))
  }

  func testAnUnreachableServiceFallsBackToThePack() async throws {
    let body = pin(style, scope: scope)
    let (loader, sessions, _) = try makeLoader(
      served: [style], reachable: true, sessionFailure: URLError(.notConnectedToInternet))
    let response = try await loader.load(URLRequest(url: style))
    XCTAssertEqual(response.bytes, body)
    XCTAssertFalse(sessions.requests.isEmpty)
  }

  func testWithTheNetworkOffOnlyStoredEntriesAnswerAndMissesAnswerAtOnce() async throws {
    let styleBody = pin(style, scope: scope)
    // Stored, but no available region holds it, as after access to its region ended.
    pin(tile, scope: scope)
    let landmarkBody = pin(landmarks, scope: .shared)
    let (loader, sessions, resources) = try makeLoader(
      served: [style], reachable: true, networkEnabled: false)
    let started = ContinuousClock.now
    let styleResponse = try await loader.load(URLRequest(url: style))
    XCTAssertEqual(styleResponse.bytes, styleBody)
    let landmarkResponse = try await loader.load(URLRequest(url: landmarks))
    XCTAssertEqual(landmarkResponse.bytes, landmarkBody)
    let hidden = try await loader.load(URLRequest(url: tile)).status
    XCTAssertEqual(hidden, 504)
    let missing = try await loader.load(
      URLRequest(url: URL(string: "https://tiles.tileflow.test/tiles/world/release-1/2/1/1.pbf")!)
    ).status
    XCTAssertEqual(missing, 504)
    var range = URLRequest(url: landmarks)
    range.setValue("bytes=0-10", forHTTPHeaderField: "Range")
    let ranged = try await loader.load(range).status
    XCTAssertEqual(ranged, 504)
    XCTAssertLessThan(started.duration(to: .now), .seconds(2), "Nothing waits for the network")
    XCTAssertTrue(sessions.requests.isEmpty)
    XCTAssertTrue(resources.requests.isEmpty)
  }

  // MARK: Helpers

  @discardableResult
  private func pin(_ url: URL, scope: ResourceCacheScope) -> Data {
    let body = Data("\(url.absoluteString) body".utf8)
    let metadata = ResourceCacheMetadata(
      url: url, status: 200,
      headers: [
        "ETag": etag(body), "Cache-Control": "private, no-cache",
        "Content-Type": "application/octet-stream",
      ], responseTime: Date(), protected: scope != .shared,
      body: (body.count, DataChannel.digest(body)))
    XCTAssertTrue(
      cache.write(
        ResourceCacheKey(url: url, scope: scope), retention: .pinned, metadata: metadata, body: body
      ))
    return body
  }

  private func etag(_ body: Data) -> String { "\"\(DataChannel.digest(body))\"" }

  private func makeLoader(
    served: [URL], reachable: Bool, networkEnabled: Bool = true, sessionFailure: (any Error)? = nil
  ) throws -> (ResourceLoader, ServingTestTransport, ServingTestTransport) {
    let index = OfflineServingIndex()
    index.publish(
      OfflineServingSnapshot(
        paths: Set(served.map { ResourceCacheKey(url: $0, scope: scope).relativePath })),
      from: self)
    let fixture = try JSONDecoder().decode(
      JSONValue.self,
      from: Data(
        contentsOf: Bundle.module.url(
          forResource: "native-session", withExtension: "json", subdirectory: "Fixtures")!))
    let sessions = ServingTestTransport { request in
      if let sessionFailure { throw sessionFailure }
      guard case .object(var response) = fixture["response"] else {
        throw TileflowMapError.invalidSessionResponse
      }
      let body = try JSONDecoder().decode(JSONValue.self, from: request.httpBody!)
      response["sessionId"] = body["sessionId"]
      return ResourcePayload(
        bytes: try JSONEncoder().encode(JSONValue.object(response)), status: 201, headers: [:])
    }
    let resources = ServingTestTransport { request in
      guard let tag = request.value(forHTTPHeaderField: "If-None-Match") else {
        return ResourcePayload(bytes: Data("network".utf8), status: 200, headers: [:])
      }
      return ResourcePayload(bytes: Data(), status: 304, headers: ["ETag": tag])
    }
    let session = HostedSession(
      endpoint: try HostedEndpoint(
        TileflowConfiguration(
          apiOrigin: api,
          mapCredential: TileflowCredential("tf_public_" + String(repeating: "a", count: 48)))),
      mapID: mapID, surfaceID: "mobile-map", transport: sessions,
      waitBudget: .milliseconds(300))
    let loader = ResourceLoader(
      policy: policy, hosted: session, apiOrigin: api, transport: resources, cache: cache,
      grantScope: scope, offline: index, networkEnabled: { networkEnabled },
      reachable: { reachable })
    addTeardownBlock {
      loader.close()
      session.close()
    }
    return (loader, sessions, resources)
  }
}

private final class ServingTestTransport: NativeHTTPTransporting, @unchecked Sendable {
  private let lock = NSLock()
  private var captured: [URLRequest] = []
  private let response: @Sendable (URLRequest) async throws -> ResourcePayload

  init(_ response: @escaping @Sendable (URLRequest) async throws -> ResourcePayload) {
    self.response = response
  }

  var requests: [URLRequest] { lock.withLock { captured } }

  func send(_ request: URLRequest) async throws -> ResourcePayload {
    lock.withLock { captured.append(request) }
    return try await response(request)
  }

  func close() {}
}
