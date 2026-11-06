import Foundation
import XCTest

@testable import Tileflow

final class BoundaryLookupStoreTests: XCTestCase {
  private var root: URL!
  private let origin = URL(string: "https://lookup.test")!
  private let firstBody = Data("id,class,iso_3166_2\n100,region,ES-MD\n101,region,ES-CT\n".utf8)

  override func setUp() {
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }

  override func tearDown() { try? FileManager.default.removeItem(at: root) }

  private var identity: BoundaryLookupIdentity { .hosted(apiOrigin: origin, mapID: "map_first") }
  private var store: BoundaryLookupStore { .init(root: root) }

  private func descriptor(release: String = "one", query: String = "", hash: String? = nil)
    throws -> BoundaryLookupDescriptor
  {
    var boundaries: [String: Any] = [
      "releaseId": release,
      "lookup": [
        "classes": [
          "region": "https://lookup.test/\(release)/region.csv.gz\(query)",
          "country": "https://lookup.test/\(release)/country.csv.gz\(query)",
        ]
      ],
    ]
    if let hash { boundaries["manifestSha256"] = hash }
    return try XCTUnwrap(
      BoundaryLookupDescriptor(
        tileJSON: ["tileflow": ["boundaries": boundaries]],
        sourceURL: URL(string: "https://lookup.test/current/tiles.json\(query)")!))
  }

  private func loader(_ transport: RecordingTransport) -> ResourceLoader {
    ResourceLoader(
      policy: .init(origins: [origin.absoluteString]), transport: transport,
      networkEnabled: { true }, reachable: { true })
  }

  private func assertOffline(
    _ action: () async throws -> TileflowBoundaryLookup,
    file: StaticString = #filePath, line: UInt = #line
  ) async {
    do {
      _ = try await action()
      XCTFail("An unavailable class was served", file: file, line: line)
    } catch let error as TileflowBoundaryJoinError {
      XCTAssertEqual(error, .offline, file: file, line: line)
    } catch { XCTFail("Unexpected error: \(error)", file: file, line: line) }
  }

  func testNewReleaseAndPublicationIdentityNeverReadPreviousRelease() async throws {
    let transport = RecordingTransport { [firstBody] request in
      let body =
        request.url!.path.contains("/two/")
        ? Data("id,class,iso_3166_2\n200,region,ES-MD\n".utf8) : firstBody
      return ResourcePayload(bytes: body, status: 200, headers: ["Cache-Control": "no-store"])
    }
    let resource = loader(transport)
    let online = BoundaryLookupService(
      loader: resource, store: store, identity: identity, online: { true })
    let offline = BoundaryLookupService(
      loader: resource, store: store, identity: identity, online: { false })
    let first = try descriptor()
    let second = try descriptor(release: "two")
    _ = try await online.lookup(first, classes: [.region])
    await assertOffline { try await offline.lookup(second, classes: [.region]) }
    await assertOffline {
      try await offline.lookup(
        self.descriptor(hash: String(repeating: "a", count: 64)), classes: [.region])
    }
    await assertOffline { try await offline.lookup(first, classes: [.country]) }
    let renewed = try await online.lookup(second, classes: [.region])
    XCTAssertEqual(renewed.rows.map(\.id), [200])
    let previous = try await offline.lookup(first, classes: [.region])
    XCTAssertEqual(previous.rows.map(\.id), [100, 101])
    let current = try await offline.lookup(second, classes: [.region])
    XCTAssertEqual(current.rows.map(\.id), [200])
    XCTAssertEqual(transport.requests.count, 2)
  }

  func testMapAPIAndSelfHostedIdentitiesRemainIsolated() async throws {
    let transport = RecordingTransport { [firstBody] _ in
      ResourcePayload(bytes: firstBody, status: 200, headers: [:])
    }
    let resource = loader(transport)
    let descriptor = try descriptor()
    _ = try await BoundaryLookupService(
      loader: resource, store: store, identity: identity,
      online: { true }
    ).lookup(descriptor, classes: [.region])
    let identities: [BoundaryLookupIdentity] = [
      .hosted(apiOrigin: origin, mapID: "map_second"),
      .hosted(apiOrigin: URL(string: "https://other.test")!, mapID: "map_first"),
      .selfHosted(manifestURL: URL(string: "https://lookup.test/manifest.json")!, map: "main"),
      .selfHosted(manifestURL: URL(string: "https://lookup.test/manifest.json")!, map: "other"),
    ]
    for identity in identities {
      await assertOffline {
        try await BoundaryLookupService(
          loader: resource, store: self.store, identity: identity,
          online: { false }
        ).lookup(descriptor, classes: [.region])
      }
    }
    XCTAssertEqual(transport.requests.count, 1)
  }

  func testOnlyHostedSessionSelectorsAreIgnoredAndSecretsNeverReachStoredMetadata() throws {
    let first = try descriptor(
      query: "?session=secret-one&surface=first&map=map_first&edition=2026")
    let second = try descriptor(
      query: "?sessionId=secret-two&surfaceId=second&mapId=map_first&edition=2026")
    func key(_ descriptor: BoundaryLookupDescriptor, _ identity: BoundaryLookupIdentity)
      -> BoundaryLookupStore.Key
    {
      .init(identity: identity, descriptor: descriptor, boundaryClass: .region)
    }
    XCTAssertEqual(key(first, identity).digest, key(second, identity).digest)
    let differentEdition = try descriptor(query: "?edition=2027")
    XCTAssertNotEqual(key(first, identity).digest, key(differentEdition, identity).digest)
    let selfHosted = BoundaryLookupIdentity.selfHosted(manifestURL: origin, map: "main")
    XCTAssertNotEqual(key(first, selfHosted).digest, key(second, selfHosted).digest)
    XCTAssertNotEqual(
      BoundaryLookupIdentity.selfHosted(
        manifestURL: URL(string: "https://lookup.test/manifest.json?session=one")!, map: "main"),
      BoundaryLookupIdentity.selfHosted(
        manifestURL: URL(string: "https://lookup.test/manifest.json?session=two")!, map: "main"))
    try store.write(.init(body: firstBody, rows: 2), key: key(first, identity))
    let bytes = try Data(contentsOf: store.file(key(first, identity)))
    for secret in ["secret-one", "lookup.test", "session", "edition", "map_first"] {
      XCTAssertNil(bytes.range(of: Data(secret.utf8)))
    }
  }

  func testCorruptedOrSemanticallyInvalidArchivesFailOfflineAndRecoverOnline() async throws {
    let transport = RecordingTransport { [firstBody] _ in
      ResourcePayload(bytes: firstBody, status: 200, headers: ["Cache-Control": "no-store"])
    }
    let resource = loader(transport)
    let descriptor = try descriptor()
    let online = BoundaryLookupService(
      loader: resource, store: store, identity: identity, online: { true })
    let offline = BoundaryLookupService(
      loader: resource, store: store, identity: identity, online: { false })
    let key = BoundaryLookupStore.Key(
      identity: identity, descriptor: descriptor, boundaryClass: .region)
    _ = try await online.lookup(descriptor, classes: [.region])
    var bytes = try Data(contentsOf: store.file(key))
    bytes[0] ^= 1
    try bytes.write(to: store.file(key), options: .atomic)
    await assertOffline { try await offline.lookup(descriptor, classes: [.region]) }
    let repaired = try await online.lookup(descriptor, classes: [.region])
    XCTAssertEqual(repaired.rows.map(\.id), [100, 101])
    XCTAssertEqual(transport.requests.count, 2)

    for archive in [
      BoundaryLookupStore.Archive(body: firstBody, rows: 99),
      .init(body: Data("id,class,iso_3166_2\n100,country,ES-MD\n".utf8), rows: 1),
    ] {
      try store.write(archive, key: key)
      await assertOffline { try await offline.lookup(descriptor, classes: [.region]) }
      _ = try await online.lookup(descriptor, classes: [.region])
    }
    let fresh = try await offline.lookup(
      descriptor, classes: [.region], matching: .iso31662, keys: ["ES-CT"])
    XCTAssertEqual(fresh.rows.map(\.id), [101])
    XCTAssertEqual(transport.requests.count, 4)
  }

  @MainActor
  func testPersistenceFailureRejectsTheMapJoin() async throws {
    try Data("occupied".utf8).write(to: root)
    let transport = RecordingTransport { [firstBody] _ in
      ResourcePayload(bytes: firstBody, status: 200, headers: [:])
    }
    let engine = NativeMapEngine(
      frame: .zero, loader: loader(transport), grantScope: nil,
      boundaryLookupIdentity: identity, boundaryLookupStore: store)
    engine.boundaryLookup = try descriptor()
    let payload = try JSONValue.encoded(
      BoundaryJoinRequest(
        rows: [.init(key: "ES-MD", value: 1)],
        options: .init(joinBy: .iso31662, classes: [.region])))
    do {
      _ = try await engine.joinBoundaries(payload)
      XCTFail("A successful join did not persist its lookup")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .resourceFailed)
      XCTAssertEqual(error.context.reason, "boundaryLookupUnavailable")
      XCTAssertNotNil(error.context.message)
    }
  }
}
