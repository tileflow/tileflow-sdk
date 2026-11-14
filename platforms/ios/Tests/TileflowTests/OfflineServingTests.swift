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

  func testPublicTreeModelsReadTheMapsPackWithoutNetworkOrSharedCache() async throws {
    let url = URL(string: "https://api.tileflow.test/base/\(String(repeating: "a", count: 64))/models/streets-tree-round-near")!
    let body = Data("TFTM fixture".utf8)
    let data = OfflinePackBuilder.build(.documents, [
      .init(name: url.absoluteString, contentType: "application/vnd.tileflow.tree-model", encoding: nil, body: body),
    ])
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let file = directory.appendingPathComponent("trees.tfpack")
    try data.write(to: file)
    let index = try OfflinePackFormat.verify(file, bytes: data.count, kind: .documents).index
    var packs = OfflineServedPacks()
    packs.documents[url.absoluteString] = (file, index.entries[url.absoluteString]!)
    for networkEnabled in [false, true] {
      let (loader, sessions, resources) = try makeLoader(packs: packs, reachable: false, networkEnabled: networkEnabled)
      let response = try await loader.load(URLRequest(url: url))
      XCTAssertEqual(response.status, 200)
      XCTAssertEqual(response.bytes, body)
      XCTAssertTrue(sessions.requests.isEmpty)
      XCTAssertTrue(resources.requests.isEmpty)
    }
    let (missing, _, _) = try makeLoader(packs: .init(), reachable: false, networkEnabled: false)
    let response = try await missing.load(URLRequest(url: url))
    XCTAssertEqual(response.status, 504, "No other map or shared cache supplies the model")
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
      "\"\(ResourceDigest.sha256(OfflinePackBuilder.gzip(tileBody)))\"")
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
    // Stored, but no available region holds it, as while its region still downloads.
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

  /// MapLibre Native escapes the comma of a font stack as `%2c`; the platform names the glyph
  /// entry with `%2C`. Either finds the entry, while anything else about the address must match.
  func testDocumentAddressesMatchWhateverTheCaseOfTheirPercentEscapes() async throws {
    let glyphs = "https://api.tileflow.test/fonts/Fixture%20Sans%2C%20Bold/0-255.pbf"
    let body = Data("glyphs".utf8)
    let data = OfflinePackBuilder.build(
      .documents,
      [.init(name: glyphs, contentType: "application/x-protobuf", encoding: nil, body: body)])
    let file = directory.appendingPathComponent("glyphs.tfpack")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try data.write(to: file)
    let index = try OfflinePackFormat.verify(file, bytes: data.count, kind: .documents).index
    var packs = OfflineServedPacks()
    packs.documents[glyphs] = (file, index.entries[glyphs]!)
    let (loader, _, _) = try makeLoader(packs: packs, reachable: true, networkEnabled: false)
    for address in [
      glyphs, "https://api.tileflow.test/fonts/Fixture%20Sans%2c%20Bold/0-255.pbf",
      "https://api.tileflow.test/fonts/Fixture%20sans%2c%20Bold/0-255.pbf",
    ] {
      let response = try await loader.load(URLRequest(url: URL(string: address)!))
      let expected = address.contains("Fixture%20Sans") ? 200 : 504
      XCTAssertEqual(response.status, expected, address)
    }
    XCTAssertEqual(
      OfflineServedDocuments.key("https://a.test/x%2c%2C%e2%82%ac%zz%2"),
      "https://a.test/x%2C%2C%E2%82%AC%zz%2")
  }

  func testTheStoredZoomsOfATileSourceAreTheRegionsDownloadedZooms() async throws {
    let index = OfflineServingIndex()
    index.publish(OfflineServingSnapshot(packs: [scope.directory: try storedPacks()]), from: self)
    let zooms = await index.storedZooms(template: template.text, scope: scope)
    XCTAssertEqual(zooms, 0...2)
    let other = await index.storedZooms(
      template: "https://tiles.tileflow.test/tiles/other/{z}/{x}/{y}.pbf", scope: scope)
    XCTAssertNil(other)
    let shared = await index.storedZooms(template: template.text, scope: .shared)
    XCTAssertNil(shared)
  }

  func testBrandingRequiresEveryInstalledPackReceiptAndCombinesFreeRegions() async {
    let index = OfflineServingIndex()
    let store = NSObject()
    for (receipts, expected): ([Bool?], Bool?) in [
      ([false], false), ([false, true], true), ([false, nil], nil),
    ] {
      var snapshot = OfflineServingSnapshot()
      snapshot.branding[scope.directory] = receipts
      index.publish(snapshot, from: store)
      let actual = await index.catalogLogoRequired(for: scope)
      XCTAssertEqual(actual, expected)
    }
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
    served.covers = [try OfflineCover.of([OfflinePackRegion.canonical(-170, 1, -10, 80)!], minZoom: 0, maxZoom: 2)]
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
        "ETag": "\"\(ResourceDigest.sha256(body))\"", "Cache-Control": "private, no-cache",
        "Content-Type": "application/octet-stream",
      ], responseTime: Date(), protected: scope != .shared,
      body: (body.count, ResourceDigest.sha256(body)))
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
