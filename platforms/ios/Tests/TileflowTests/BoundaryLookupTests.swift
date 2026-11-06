import Foundation
import XCTest

@testable import Tileflow

final class BoundaryLookupTests: XCTestCase {
  private let origin = "https://lookup.test"
  private var storageRoot: URL!

  override func setUp() {
    storageRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }

  override func tearDown() { try? FileManager.default.removeItem(at: storageRoot) }

  private func store() -> BoundaryLookupStore { BoundaryLookupStore(root: storageRoot) }
  private var identity: BoundaryLookupIdentity {
    .selfHosted(manifestURL: URL(string: origin + "/map.json")!, map: "fixture")
  }
  private let gzip = Data(
    base64Encoded:
      "H4sIAAAAAAAC/8tM0UnOSSwu1skszo83NjQzizfSKUpN4zI0MADS6Zn5eTquwbq+LhCSCwDb2jtMLwAAAA==")!

  private func descriptor() throws -> BoundaryLookupDescriptor {
    try XCTUnwrap(
      BoundaryLookupDescriptor(
        tileJSON: tileJSON(),
        sourceURL: URL(string: origin + "/current/tiles.json")!))
  }

  private func tileJSON() -> [String: Any] {
    [
      "tiles": [origin + "/release-one/{z}/{x}/{y}.pbf"],
      "tileflow": [
        "boundaries": [
          "releaseId": "release-one",
          "lookup": [
            "classes": [
              "region": origin + "/release-one/region.csv.gz",
              "country": origin + "/release-one/country.csv.gz",
            ]
          ],
        ]
      ],
    ]
  }

  func testDownloadedClassAnswersAnotherKeyAfterServiceRecreationOffline() async throws {
    let body = Data(
      "id,class,iso_3166_2,ref\n100,region,ES-MD,ES-MD\n101,region,ES-CT,ES-CT\n".utf8)
    let transport = RecordingTransport { _ in
      ResourcePayload(bytes: body, status: 200, headers: ["Cache-Control": "no-store"])
    }
    let loader = ResourceLoader(
      policy: .init(origins: [origin]), transport: transport,
      networkEnabled: { true }, reachable: { true })
    let first = try await BoundaryLookupService(
      loader: loader, store: store(), identity: identity, online: { true }
    ).lookup(
      descriptor(), classes: [.region], matching: .iso31662, keys: ["ES-MD"])
    XCTAssertEqual(first.rows.map(\.id), [100])

    let reopened = try await BoundaryLookupService(
      loader: loader, store: store(), identity: identity, online: { false }
    ).lookup(
      descriptor(), classes: [.region], matching: .iso31662, keys: ["ES-CT"])
    XCTAssertEqual(reopened.rows.map(\.id), [101])
    XCTAssertEqual(transport.requests.count, 1)
  }

  func testProjectionCapturesTheRenderedReleaseAndFetchesOnlyRequestedClasses() async throws {
    let projection = try await NativeStyleDocument.project(
      [
        "version": 8,
        "sources": [
          "tileflow-boundaries": [
            "type": "vector",
            "url": origin + "/current/tiles.json",
          ]
        ], "layers": [],
      ],
      styleURL: URL(string: origin + "/style.json")!, context: "boundary-test"
    ) { [self] _, _ in tileJSON() }
    let descriptor = try XCTUnwrap(projection.boundaryLookup)
    XCTAssertEqual(descriptor.releaseID, "release-one")
    let transport = RecordingTransport { [gzip] _ in
      ResourcePayload(bytes: gzip, status: 200, headers: [:])
    }
    let loader = ResourceLoader(
      policy: .init(origins: [origin]), transport: transport,
      networkEnabled: { true }, reachable: { true })
    let lookup = try await BoundaryLookupService(
      loader: loader, store: store(), identity: identity, online: { true }
    )
    .lookup(descriptor, classes: [.region, .region])
    XCTAssertEqual(transport.requests.map { $0.url!.path }, ["/release-one/region.csv.gz"])
    XCTAssertEqual(lookup.find(.iso31662, key: "es-md").map(\.id), [100])
  }

  func testDerivedStorageSurvivesReloadAndAmbientCacheClearing() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    func cache() -> ResourceCacheStore {
      ResourceCacheStore(
        ambientRoot: root.appendingPathComponent("ambient"),
        durableRoot: root.appendingPathComponent("durable"), maximumBytes: 1 << 20)
    }
    let transport = RecordingTransport { [gzip] _ in
      ResourcePayload(bytes: gzip, status: 200, headers: ["Cache-Control": "max-age=3600"])
    }
    let firstCache = cache()
    let first = ResourceLoader(
      policy: .init(origins: [origin]), transport: transport,
      cache: firstCache, networkEnabled: { true }, reachable: { true })
    _ = try await BoundaryLookupService(
      loader: first, store: store(), identity: identity, online: { true }
    )
    .lookup(descriptor(), classes: [.region])
    firstCache.settle()
    firstCache.clear()
    XCTAssertEqual(firstCache.usage().entries, 0)
    let secondCache = cache()
    let second = ResourceLoader(
      policy: .init(origins: [origin]), transport: transport,
      cache: secondCache, networkEnabled: { true }, reachable: { true })
    _ = try await BoundaryLookupService(
      loader: second, store: store(), identity: identity, online: { true }
    )
    .lookup(descriptor(), classes: [.region])
    XCTAssertEqual(transport.requests.count, 1)

    let stored = try await BoundaryLookupService(
      loader: second, store: store(), identity: identity,
      online: { false }
    ).lookup(descriptor(), classes: [.region])
    XCTAssertEqual(stored.rows.map(\.id), [100])
    let offline = ResourceLoader(
      policy: .init(origins: [origin]), transport: transport,
      cache: secondCache, networkEnabled: { false }, reachable: { true })
    do {
      _ = try await offline.loadOnline(URLRequest(url: descriptor().classes[.region]!))
      XCTFail("Online-only transport used cached bytes offline")
    } catch let error as URLError { XCTAssertEqual(error.code, .notConnectedToInternet) }
    XCTAssertEqual(transport.requests.count, 1)
  }

  func testLookupManifestChecksTheWholeFileBeforeRetainingOnlyMatchingRows() async throws {
    var value = tileJSON()
    var metadata = (value["tileflow"] as! [String: Any])["boundaries"] as! [String: Any]
    var lookup = metadata["lookup"] as! [String: Any]
    lookup["manifest"] = origin + "/release-one/boundaries-lookup.json"
    metadata["lookup"] = lookup
    value["tileflow"] = ["boundaries": metadata]
    let descriptor = try XCTUnwrap(
      BoundaryLookupDescriptor(
        tileJSON: value,
        sourceURL: URL(string: origin + "/current/tiles.json")!))

    for failure in ["none", "bytes", "sha256", "rows", "release"] {
      let entry: [String: Any] = [
        "file": "region.csv.gz",
        "bytes": gzip.count + (failure == "bytes" ? 1 : 0),
        "rows": failure == "rows" ? 2 : 1,
        "sha256": failure == "sha256"
          ? String(repeating: "0", count: 64) : ResourceDigest.sha256(gzip),
      ]
      let manifest = try JSONSerialization.data(withJSONObject: [
        "schemaVersion": 2, "family": "boundaries",
        "build": failure == "release" ? "different" : "release-one",
        "files": ["region": entry],
      ])
      let transport = RecordingTransport { [gzip] request in
        ResourcePayload(
          bytes: request.url!.pathExtension == "json" ? manifest : gzip,
          status: 200, headers: [:])
      }
      let loader = ResourceLoader(
        policy: .init(origins: [origin]), transport: transport,
        networkEnabled: { true }, reachable: { true })
      do {
        let result = try await BoundaryLookupService(
          loader: loader,
          store: .init(root: storageRoot.appendingPathComponent(failure)), identity: identity,
          online: { true }
        ).lookup(
          descriptor, classes: [.region], matching: .iso31662, keys: ["missing"])
        XCTAssertEqual(failure, "none")
        XCTAssertTrue(result.rows.isEmpty)
      } catch let error as TileflowBoundaryJoinError {
        XCTAssertNotEqual(failure, "none")
        XCTAssertEqual(error, .invalidCSV)
      }
    }
  }

  func testInlineTileOverridesCannotUseAnotherReleaseLookup() async throws {
    let projection = try await NativeStyleDocument.project(
      [
        "version": 8,
        "sources": [
          "tileflow-boundaries": [
            "type": "vector",
            "url": origin + "/current/tiles.json", "tiles": [origin + "/different/{z}/{x}/{y}.pbf"],
          ]
        ],
        "layers": [],
      ], styleURL: URL(string: origin + "/style.json")!, context: "boundary-test"
    ) { [self] _, _ in tileJSON() }
    XCTAssertNil(projection.boundaryLookup)
  }

  func testOnlineTransportNeverFallsBackToStaleOrPinnedResources() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let cache = ResourceCacheStore(
      ambientRoot: root.appendingPathComponent("ambient"),
      durableRoot: root.appendingPathComponent("durable"), maximumBytes: 1 << 20)
    let url = try descriptor().classes[.region]!
    let key = ResourceCacheKey(url: url, scope: .shared)
    let metadata = ResourceCacheMetadata(
      url: url, status: 200,
      headers: ["Cache-Control": "max-age=0, stale-if-error=3600"], responseTime: Date(),
      protected: false, body: (gzip.count, ResourceDigest.sha256(gzip)))
    for retention: ResourceCacheRetention in [.ambient, .pinned] {
      XCTAssertTrue(cache.write(key, retention: retention, metadata: metadata, body: gzip))
    }
    let transport = RecordingTransport { _ in throw URLError(.notConnectedToInternet) }
    let loader = ResourceLoader(
      policy: .init(origins: [origin]), transport: transport,
      cache: cache, networkEnabled: { true }, reachable: { true })
    do {
      _ = try await BoundaryLookupService(
        loader: loader, store: store(), identity: identity, online: { true }
      )
      .lookup(descriptor(), classes: [.region])
      XCTFail("Offline fallback answered an online-only lookup")
    } catch let error as TileflowBoundaryJoinError { XCTAssertEqual(error, .offline) }
  }

  func testMalformedDeniedMissingAndNoStoreResources() async throws {
    let descriptor = try descriptor()
    let transport = RecordingTransport { [gzip] _ in
      ResourcePayload(bytes: gzip, status: 200, headers: ["Cache-Control": "no-store"])
    }
    let loader = ResourceLoader(
      policy: .init(origins: [origin]), transport: transport,
      networkEnabled: { true }, reachable: { true })
    let service = BoundaryLookupService(
      loader: loader, store: store(), identity: identity, online: { true })
    for _ in 0..<2 { _ = try await service.lookup(descriptor, classes: [.region]) }
    XCTAssertEqual(transport.requests.count, 1)
    do {
      _ = try await service.lookup(descriptor, classes: [.municipality])
      XCTFail("Missing class accepted")
    } catch let error as TileflowBoundaryJoinError { XCTAssertEqual(error, .lookupUnavailable) }
    do {
      _ = try await service.lookup(descriptor, classes: [.country])
      XCTFail("Wrong class accepted")
    } catch let error as TileflowBoundaryJoinError { XCTAssertEqual(error, .invalidCSV) }
    let denied = ResourceLoader(
      policy: .init(origins: [origin]),
      transport: RecordingTransport { _ in ResourcePayload(bytes: Data(), status: 403, headers: [:])
      },
      networkEnabled: { true }, reachable: { true })
    do {
      _ = try await BoundaryLookupService(
        loader: denied, store: .init(root: storageRoot.appendingPathComponent("denied")),
        identity: identity, online: { true }
      )
      .lookup(descriptor, classes: [.region])
      XCTFail("Denied lookup accepted")
    } catch let error as TileflowBoundaryJoinError { XCTAssertEqual(error, .accessDenied) }
    XCTAssertThrowsError(try ResourceCompression.gunzip(gzip, maximumBytes: 2))
    XCTAssertThrowsError(try ResourceCompression.gunzip(gzip.dropLast(), maximumBytes: 1024))
  }

  func testGatewayTimeoutDoesNotPretendTheDeviceIsOffline() async throws {
    let loader = ResourceLoader(
      policy: .init(origins: [origin]),
      transport: RecordingTransport { _ in
        ResourcePayload(bytes: Data(), status: 504, headers: [:])
      }, networkEnabled: { true }, reachable: { true })
    do {
      _ = try await BoundaryLookupService(
        loader: loader, store: store(), identity: identity, online: { true }
      )
      .lookup(descriptor(), classes: [.region])
      XCTFail("Gateway timeout accepted")
    } catch let error as TileflowBoundaryJoinError {
      XCTAssertEqual(error, .requestFailed(status: 504))
    }
  }

  @MainActor
  func testMapCallAllowsOfflineDirectJoinsRejectsMissingLookupsAndDiscardedGenerations()
    async throws
  {
    let gate = BoundaryLookupGate()
    let engine = NativeMapEngine(
      frame: .zero, loader: gate, grantScope: nil,
      boundaryLookupIdentity: identity, boundaryLookupStore: store())
    engine.boundaryLookup = try descriptor()
    let direct = try JSONValue.encoded(
      BoundaryJoinRequest(
        rows: [.init(key: 100, value: 1)], options: .init(joinBy: .id)))
    TileflowHTTPClient.shared.isNetworkEnabled = false
    defer { TileflowHTTPClient.shared.isNetworkEnabled = true }
    let directResult = try await engine.joinBoundaries(direct)
    XCTAssertEqual(directResult["rows"]?.array?.first?["key"]?.number, 100)
    let payload = try JSONValue.encoded(
      BoundaryJoinRequest(
        rows: [.init(key: "ES-MD", value: 1)], options: .init(joinBy: .iso31662, classes: [.region])
      ))
    do {
      _ = try await engine.joinBoundaries(payload)
      XCTFail("The map read a missing lookup while offline")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.context.reason, "boundaryLookupOffline")
    }
    TileflowHTTPClient.shared.isNetworkEnabled = true

    let task = Task { try await engine.joinBoundaries(payload) }
    await gate.waitUntilStarted()
    engine.boundaryLookupRevision += 1
    await gate.release(gzip)
    do {
      _ = try await task.value
      XCTFail("A previous generation returned joined IDs")
    } catch let error as TileflowMapError { XCTAssertEqual(error, .cancelled) }
  }
}

private actor BoundaryLookupGate: ResourceLoading {
  var started = false
  var startWaiter: CheckedContinuation<Void, Never>?
  var bodyWaiter: CheckedContinuation<Data, Never>?

  func load(_ request: URLRequest) async throws -> ResourcePayload {
    started = true
    startWaiter?.resume()
    let bytes = await withCheckedContinuation { bodyWaiter = $0 }
    return ResourcePayload(bytes: bytes, status: 200, headers: [:])
  }

  func waitUntilStarted() async {
    if !started { await withCheckedContinuation { startWaiter = $0 } }
  }

  func release(_ bytes: Data) { bodyWaiter?.resume(returning: bytes) }
}
