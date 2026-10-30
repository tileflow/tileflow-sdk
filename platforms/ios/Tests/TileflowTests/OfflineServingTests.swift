import Foundation
import XCTest

@testable import Tileflow

/// How maps use downloaded regions: a Hosted map without a network opens from its packs without a
/// session, with a network it starts its session and revalidates pack entries instead of
/// downloading them, and with the network switched off every request is answered from stored
/// entries alone.
final class OfflineServingTests: XCTestCase {
  private let mapID = "map_0123456789abcdef"
  private let api = URL(string: "https://api.tileflow.test")!
  private let style = URL(
    string: "https://api.tileflow.test/maps/map_0123456789abcdef/mobile/webview-v1/v1/day.json")!
  private let template = OfflineTileTemplate(
    "https://tiles.tileflow.test/tiles/world/release-1/{z}/{x}/{y}.pbf")!
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
    let packs = try storedPacks()
    let (loader, sessions, resources) = try makeLoader(packs: packs, reachable: false)
    let response = try await loader.load(URLRequest(url: style))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(response.bytes, styleBody)
    XCTAssertEqual(response.headers["Content-Type"], "application/json")
    XCTAssertEqual(response.headers["Cache-Control"], "no-store")
    XCTAssertTrue(sessions.requests.isEmpty, "No session starts")
    XCTAssertTrue(resources.requests.isEmpty)
  }

  func testWithANetworkAHostedMapStartsItsSessionAndRevalidatesItsPack() async throws {
    let packs = try storedPacks()
    let (loader, sessions, resources) = try makeLoader(packs: packs, reachable: true)
    let response = try await loader.load(URLRequest(url: tile))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(response.bytes, tileBody, "The unchanged stored copy answers, decoded")
    XCTAssertEqual(sessions.requests.map(\.url?.path), ["/v1/sessions/start"])
    let request = try XCTUnwrap(resources.requests.first)
    XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Tileflow-Native-Grant"))
    // The tag names the body as the route serves it, compressed.
    XCTAssertEqual(
      request.value(forHTTPHeaderField: "If-None-Match"),
      "\"\(DataChannel.digest(OfflinePackBuilder.gzip(tileBody)))\"")
  }

  func testAnUnreachableServiceFallsBackToThePack() async throws {
    let packs = try storedPacks()
    let (loader, sessions, _) = try makeLoader(
      packs: packs, reachable: true, sessionFailure: URLError(.notConnectedToInternet))
    let response = try await loader.load(URLRequest(url: style))
    XCTAssertEqual(response.bytes, styleBody)
    XCTAssertFalse(sessions.requests.isEmpty)
  }

  func testWithTheNetworkOffOnlyStoredEntriesAnswerAndMissesAnswerAtOnce() async throws {
    var packs = try storedPacks()
    let landmarkBody = pin(landmarks, scope: .shared)
    // Stored, but no available region holds it, as after access to its region ended.
    let hiddenTiles = packs.tiles.removeValue(forKey: template.text)
    let (loader, sessions, resources) = try makeLoader(
      packs: packs, reachable: true, networkEnabled: false)
    let started = ContinuousClock.now
    let styleResponse = try await loader.load(URLRequest(url: style))
    XCTAssertEqual(styleResponse.bytes, styleBody)
    let landmarkResponse = try await loader.load(URLRequest(url: landmarks))
    XCTAssertEqual(landmarkResponse.bytes, landmarkBody)
    let hidden = try await loader.load(URLRequest(url: tile)).status
    XCTAssertEqual(hidden, 504)
    var range = URLRequest(url: landmarks)
    range.setValue("bytes=0-10", forHTTPHeaderField: "Range")
    let ranged = try await loader.load(range).status
    XCTAssertEqual(ranged, 504)
    XCTAssertLessThan(started.duration(to: .now), .seconds(2), "Nothing waits for the network")
    XCTAssertTrue(sessions.requests.isEmpty)
    XCTAssertTrue(resources.requests.isEmpty)

    // With the region's tiles: a stored tile answers decoded, a covered tile the archive does not
    // store answers as the source does online, and a tile outside the cover is a miss.
    packs.tiles[template.text] = hiddenTiles
    let (tiles, _, _) = try makeLoader(packs: packs, reachable: true, networkEnabled: false)
    let stored = try await tiles.load(URLRequest(url: tile))
    XCTAssertEqual(stored.status, 200)
    XCTAssertEqual(stored.bytes, tileBody)
    let absent = try await tiles.load(URLRequest(url: template.url(.init(z: 2, x: 1, y: 1))!))
    XCTAssertEqual(absent.status, 404)
    XCTAssertEqual(absent.bytes, Data())
    let outside = try await tiles.load(URLRequest(url: template.url(.init(z: 2, x: 3, y: 3))!))
    XCTAssertEqual(outside.status, 504)
    // Above the downloaded zooms inside the region, the renderer overzooms the deepest tile.
    let deeper = try await tiles.load(URLRequest(url: template.url(.init(z: 4, x: 4, y: 4))!))
    XCTAssertEqual(deeper.status, 404)
    let deeperOutside = try await tiles.load(
      URLRequest(url: template.url(.init(z: 4, x: 15, y: 15))!))
    XCTAssertEqual(deeperOutside.status, 504)
  }

  // MARK: Helpers

  private var styleBody: Data { Data(#"{"version":8}"#.utf8) }
  private var tileBody: Data { Data("tile 1/0/0".utf8) }

  /// A style in a document pack and tile 1/0/0 in a tile pack of a region over the
  /// north-western quarter.
  private func storedPacks() throws -> OfflineServedPacks {
    func write(_ kind: OfflinePackKind, _ entries: [OfflinePackBuilder.Entry]) throws -> (
      URL, OfflinePackIndex
    ) {
      let data = OfflinePackBuilder.build(kind, entries)
      let file = directory.appendingPathComponent("\(UUID().uuidString).tfpack")
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try data.write(to: file)
      return (file, try OfflinePackFormat.verify(file, bytes: data.count, kind: kind).index)
    }
    let (documents, documentIndex) = try write(
      .documents,
      [
        .init(
          name: style.absoluteString, contentType: "application/json", encoding: nil,
          body: styleBody)
      ])
    let (tiles, _) = try write(
      .tiles,
      [
        .init(
          name: "1/0/0", contentType: "application/x-protobuf", encoding: "gzip",
          body: OfflinePackBuilder.gzip(tileBody))
      ])
    var packs = OfflineServedPacks()
    packs.documents[style.absoluteString] = (documents, documentIndex.entries[style.absoluteString]!)
    var served = OfflineServedTiles(template: template, zooms: 0...2, absentStatus: 404)
    served.regions = [OfflinePackRegion.canonical(-170, 1, -10, 80)!]
    served.anchors[OfflineTileID(z: 0, x: 0, y: 0)] = [tiles]
    packs.tiles[template.text] = served
    return packs
  }

  @discardableResult
  private func pin(_ url: URL, scope: ResourceCacheScope) -> Data {
    let body = Data("\(url.absoluteString) body".utf8)
    let metadata = ResourceCacheMetadata(
      url: url, status: 200,
      headers: [
        "ETag": "\"\(DataChannel.digest(body))\"", "Cache-Control": "private, no-cache",
        "Content-Type": "application/octet-stream",
      ], responseTime: Date(), protected: scope != .shared,
      body: (body.count, DataChannel.digest(body)))
    XCTAssertTrue(
      cache.write(
        ResourceCacheKey(url: url, scope: scope), retention: .pinned, metadata: metadata, body: body
      ))
    return body
  }

  private func makeLoader(
    packs: OfflineServedPacks, reachable: Bool, networkEnabled: Bool = true,
    sessionFailure: (any Error)? = nil
  ) throws -> (ResourceLoader, ServingTestTransport, ServingTestTransport) {
    let index = OfflineServingIndex()
    index.publish(OfflineServingSnapshot(packs: [scope.directory: packs]), from: self)
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
