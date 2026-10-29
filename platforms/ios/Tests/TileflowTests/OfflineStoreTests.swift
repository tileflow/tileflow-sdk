import CryptoKit
import XCTest

@testable import Tileflow
@testable import TileflowConfiguration

/// End-to-end store tests against an in-process Hosted service: packs are created, downloaded,
/// verified, stored in a real pinned partition, updated and removed.
final class OfflineStoreTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-store-\(UUID().uuidString)", isDirectory: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  func testHostedRegionDownloadsVerifiedResourcesAndWorksOffline() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    let region = try await store.loadRegion(id: "madrid", options: madrid())
    XCTAssertFalse(region.isAvailable)
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertTrue(done.isAvailable)
    XCTAssertEqual(done.completedResourceCount, done.requiredResourceCount)
    XCTAssertEqual(done.completedResourceBytes, done.requiredResourceBytes)
    XCTAssertEqual(done.billableResourceCount, service.billableCount)
    XCTAssertEqual(done.updateState, .current)

    // Each resource was downloaded once, with the grant only where the manifest asks for it.
    XCTAssertEqual(service.creations, 1)
    for entry in service.downloads {
      let isPublic = service.isPublic(entry.url)
      XCTAssertEqual(entry.headers["X-Tileflow-Offline-Grant"] == nil, isPublic, entry.url)
      XCTAssertEqual(Set(entry.headers.keys).subtracting(["X-Tileflow-Offline-Grant"]), [])
    }
    XCTAssertEqual(service.downloads.count, done.requiredResourceCount)

    // Without a network, a new store over the same files has the region and every body.
    service.isOnline = false
    let offline = makeStore(service)
    let reopened = try await XCTUnwrapAsync(await offline.region(id: "madrid"))
    XCTAssertTrue(reopened.isAvailable)
    XCTAssertEqual(reopened.state, .complete)
    await offline.core.networkDidConnect()
    XCTAssertEqual(service.downloads.count, done.requiredResourceCount)
    for (url, body) in service.served {
      let key = ResourceCacheKey(url: URL(string: url)!, scope: service.scope(url))
      XCTAssertEqual(cache.read(key, retention: .pinned)?.body, body, url)
    }
  }

  func testKilledDownloadResumesWithoutDownloadingAgain() async throws {
    let service = OfflineServiceStub()
    let first = makeStore(service, fetcher: OfflineFreezingFetcher(service, after: 20))
    try await first.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= 20 }
    // The process ends: nothing more is written, a line of the progress log is cut short and a
    // partial staging file is left behind.
    let version = try XCTUnwrap(
      FileManager.default.enumerator(atPath: layout.regions.path)?.compactMap { $0 as? String }
        .first { $0.hasSuffix("/v1") })
    let log = layout.regions.appendingPathComponent(version).appendingPathComponent("progress")
    if !FileManager.default.fileExists(atPath: log.path) {
      FileManager.default.createFile(atPath: log.path, contents: nil)
    }
    let handle = try FileHandle(forWritingTo: log)
    try handle.seekToEnd()
    try handle.write(contentsOf: Data("0123abc".utf8))
    try handle.close()
    try Data("partial".utf8).write(
      to: layout.regions.appendingPathComponent(version).appendingPathComponent("staging-partial"))

    let second = makeStore(service)
    let done = try await waitFor(second, "madrid") { $0.state == .complete }
    XCTAssertEqual(done.completedResourceCount, done.requiredResourceCount)
    var bodies: [String: Int] = [:]
    for entry in service.downloads where entry.status == 200 { bodies[entry.url, default: 0] += 1 }
    XCTAssertEqual(bodies.count, done.requiredResourceCount)
    XCTAssertEqual(bodies.values.max(), 1, "No resource is downloaded twice")
    XCTAssertEqual(service.creations, 1)
  }

  func testFullDiskStopsTheDownloadUntilResumed() async throws {
    let service = OfflineServiceStub()
    let space = LockedValue<Int64?>(1024)
    let store = makeStore(service, space: space)
    try await store.loadRegion(id: "madrid", options: madrid())
    let full = try await waitFor(store, "madrid") { $0.state == .failed }
    XCTAssertEqual(full.error?.code, .insufficientStorage)
    XCTAssertTrue(service.downloads.isEmpty)

    // The disk fills during the download.
    space.withLock { $0 = nil }
    service.onDownload = { count in if count == 70 { space.withLock { $0 = 512 } } }
    try await store.resumeRegion(id: "madrid")
    let again = try await waitFor(store, "madrid") { $0.state == .failed }
    XCTAssertEqual(again.error?.code, .insufficientStorage)
    XCTAssertFalse(again.isAvailable)
    XCTAssertGreaterThanOrEqual(again.completedResourceCount, 64)

    space.withLock { $0 = nil }
    service.onDownload = nil
    try await store.resumeRegion(id: "madrid")
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertEqual(done.completedResourceCount, done.requiredResourceCount)
    XCTAssertEqual(Set(service.downloads.map(\.url)).count, service.downloads.count)
  }

  func testFiftyThousandResourcePack() async throws {
    let service = OfflineServiceStub()
    service.tileLimit = 49_998
    service.documentsPublicOnly = true
    service.maximumPackResources = 50_000
    let store = makeStore(service, concurrency: 64)
    let options = TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(TileflowBoundingBox(west: 10, south: 10, east: 11.5, north: 11.5)),
      content: .hosted(mapID: OfflineServiceStub.mapID, themes: ["default"]), minZoom: 16,
      maxZoom: 16)
    let estimate = try await store.estimateRegion(options)
    XCTAssertEqual(estimate.resourceCount, 50_000)
    XCTAssertEqual(estimate.billableResourceCount, 49_998)
    XCTAssertEqual(estimate.mapViews, 50)
    let started = Date()
    try await store.loadRegion(id: "large", options: options)
    let done = try await waitFor(store, "large", timeout: 600) { $0.state == .complete }
    XCTAssertEqual(done.completedResourceCount, 50_000)
    XCTAssertEqual(service.creations, 1, "The estimate's pack is reused")
    print("50,000 resources stored in \(Int(Date().timeIntervalSince(started))) s")

    // The device holds 49,998 billable resources of 50,000: a further region does not fit.
    do {
      try await store.loadRegion(id: "madrid", options: madrid())
      XCTFail("The device limit is enforced")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .deviceLimitExceeded)
      XCTAssertEqual(error.context.limit, 50_000)
    }
  }

  func testUpdatesDownloadOnlyChangesAndKeepTheStoredVersionUntilComplete() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let first = service.downloads.count

    // Due only after the service's interval.
    await store.core.checkForUpdates()
    XCTAssertEqual(service.revalidations, 0)
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "update_available"
    await store.core.networkDidConnect()
    let notified = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(notified.updateState, .updateAvailable)

    // The deployment changes the style and one tile; the rest answers 304.
    let oldStyle = service.styleURL
    service.publish()
    service.freezeAfter = first + 5
    try await store.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= first + 5 }
    let updating = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertTrue(updating.isAvailable, "The stored version stays while the update downloads")
    XCTAssertNotNil(cache.read(service.key(oldStyle), retention: .pinned))

    service.freezeAfter = nil
    try await store.pauseRegion(id: "madrid")
    try await store.resumeRegion(id: "madrid")
    let done = try await waitFor(store, "madrid") { $0.state == .complete && $0.completedAt != nil }
    let update = service.downloads.dropFirst(first)
    let changed = Set(update.filter { $0.status == 200 }.map(\.url))
    XCTAssertEqual(changed, Set(service.changedURLs))
    XCTAssertTrue(
      update.filter { $0.status == 304 }.allSatisfy { $0.headers["If-None-Match"] != nil })
    XCTAssertEqual(done.updateState, .current)
    // The previous deployment's style is released; the changed tile holds its new body.
    XCTAssertNil(cache.read(service.key(oldStyle), retention: .pinned))
    for url in service.changedURLs {
      XCTAssertEqual(cache.read(service.key(url), retention: .pinned)?.body, service.served[url])
    }
  }

  func testAccessEndingStopsUpdatesWithoutRemovingTheRegion() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    service.clock.withLock { $0 += 86_401 }
    service.revalidationState = "not_updatable"
    await store.core.checkForUpdates()
    let region = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(region.updateState, .notUpdatable(reason: "credential_revoked"))
    XCTAssertTrue(region.isAvailable)
    service.clock.withLock { $0 += 10 * 86_400 }
    await store.core.checkForUpdates()
    XCTAssertEqual(service.revalidations, 1)
    for (url, body) in service.served {
      XCTAssertEqual(cache.read(service.key(url), retention: .pinned)?.body, body)
    }
  }

  func testExpiredGrantCreatesThePackAgain() async throws {
    let service = OfflineServiceStub()
    service.expireGrantAfter = 30
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    let done = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertEqual(service.creations, 2)
    XCTAssertEqual(done.completedResourceCount, done.requiredResourceCount)
    let bodies = service.downloads.filter { $0.status == 200 }.map(\.url)
    XCTAssertEqual(Set(bodies).count, bodies.count, "Stored resources are kept")

    // A window that ends before the download continues is renewed before downloading.
    let other = OfflineServiceStub()
    let first = makeStore(other, root: "second", fetcher: OfflineFreezingFetcher(other, after: 5))
    try await first.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { other.downloads.count >= 5 }
    other.clock.withLock { $0 += 86_400 }
    let second = makeStore(other, root: "second")
    _ = try await waitFor(second, "madrid") { $0.state == .complete }
    XCTAssertEqual(other.creations, 2)
  }

  func testRecoverableRefusalsWaitAsAsked() async throws {
    let service = OfflineServiceStub()
    service.refuseOnce = (10, 429, "RATE_LIMITED", "7")
    let sleeps = LockedValue<[TimeInterval]>([])
    let store = makeStore(service, sleeps: sleeps)
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    XCTAssertTrue(sleeps.withLock { $0 }.contains(7))

    // A refusal that waiting cannot repair stops the download.
    let refused = OfflineServiceStub()
    refused.refuseOnce = (3, 429, "COMMERCIAL_MAP_LIMIT_REACHED", nil)
    let other = makeStore(refused, root: "refused")
    try await other.loadRegion(id: "madrid", options: madrid())
    let failed = try await waitFor(other, "madrid") { $0.state == .failed }
    XCTAssertEqual(failed.error?.code, .quotaExceeded)
  }

  func testOfflineDownloadWaitsForTheNetwork() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= 1 }
    service.isOnline = false
    let waiting = try await waitFor(store, "madrid") { $0.state == .waiting }
    XCTAssertEqual(waiting.error?.code, .network)
    service.isOnline = true
    await store.core.networkDidConnect()
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
  }

  func testRemovingReleasesOnlyResourcesNoOtherRegionUses() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    let subscriptionEvents = LockedValue<[TileflowOfflineRegionEvent]>([])
    let subscription = store.subscribe { event in subscriptionEvents.withLock { $0.append(event) } }
    try await store.loadRegion(id: "madrid", options: madrid())
    _ = try await waitFor(store, "madrid") { $0.state == .complete }
    let first = Set(service.served.keys)
    try await store.loadRegion(id: "nearby", options: madrid(east: -3.67))
    _ = try await waitFor(store, "nearby") { $0.state == .complete }
    let all = Set(service.served.keys)
    XCTAssertGreaterThan(all.count, first.count)
    let ids = await store.allRegions().map(\.id)
    XCTAssertEqual(ids, ["madrid", "nearby"])

    try await store.removeRegion(id: "nearby")
    for url in all {
      XCTAssertEqual(
        cache.read(service.key(url), retention: .pinned) != nil, first.contains(url), url)
    }
    try await store.removeRegion(id: "madrid")
    for url in all { XCTAssertNil(cache.read(service.key(url), retention: .pinned), url) }
    let regions = await store.allRegions()
    XCTAssertTrue(regions.isEmpty)
    try await waitUntil {
      subscriptionEvents.withLock { $0.contains(.removed(id: "madrid")) }
    }
    subscription.cancel()
  }

  func testPauseAndCancel() async throws {
    let service = OfflineServiceStub()
    service.freezeAfter = 10
    let store = makeStore(service)
    try await store.loadRegion(id: "madrid", options: madrid())
    try await waitUntil { service.downloads.count >= 10 }
    try await store.pauseRegion(id: "madrid")
    let paused = try await XCTUnwrapAsync(await store.region(id: "madrid"))
    XCTAssertEqual(paused.state, .paused)
    service.freezeAfter = nil
    try await Task.sleep(nanoseconds: 50_000_000)
    XCTAssertEqual(service.downloads.count, 10)

    // Cancelling a region that never completed removes it and what it stored.
    try await store.cancelRegion(id: "madrid")
    let regions = await store.allRegions()
    XCTAssertTrue(regions.isEmpty)
    for url in service.served.keys {
      XCTAssertNil(cache.read(service.key(url), retention: .pinned))
    }
    do {
      try await store.resumeRegion(id: "madrid")
      XCTFail("The region is gone")
    } catch let error as TileflowOfflineError {
      XCTAssertEqual(error.code, .regionNotFound)
    }
  }

  func testSelfHostedRegionDownloadsTheStyleItsSpritesGlyphsAndTiles() async throws {
    let service = OfflineServiceStub()
    let store = makeStore(service)
    let source = TileflowOfflineTileSource(
      id: "streets", template: "https://tiles.example.com/streets/{z}/{x}/{y}.pbf", maxZoom: 14)
    let options = TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(
        TileflowBoundingBox(west: -3.71, south: 40.41, east: -3.69, north: 40.425)),
      content: .style(url: URL(string: "https://tiles.example.com/style.json")!, sources: [source]),
      minZoom: 12, maxZoom: 15)
    let estimate = try await store.estimateRegion(options)
    XCTAssertNil(estimate.bytes)
    XCTAssertEqual(estimate.billableResourceCount, 0)
    try await store.loadRegion(id: "streets", options: options)
    let done = try await waitFor(store, "streets") { $0.state == .complete }
    // Sizes are known once downloaded.
    XCTAssertEqual(done.requiredResourceBytes, done.completedResourceBytes)
    XCTAssertEqual(done.billableResourceCount, 0)
    // Style, four sprite files, 256 glyph ranges of one stack and the tiles to zoom 14.
    XCTAssertEqual(done.requiredResourceCount, 1 + 4 + 256 + estimate.resourceCount)
    let urls = Set(service.downloads.map(\.url))
    XCTAssertTrue(urls.contains("https://tiles.example.com/sprites/base@2x.png"))
    XCTAssertTrue(
      urls.contains("https://tiles.example.com/fonts/Noto%20Sans%20Regular/0-255.pbf"))
    XCTAssertTrue(service.downloads.allSatisfy { $0.headers.isEmpty })
    XCTAssertTrue(done.completedResourceBytes > 0)
  }

  func testBackgroundFetcherSendsOnlyTheRequestHeadersAndRefusesRedirects() async throws {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [OfflineURLProtocolStub.self]
    let fetcher = OfflineURLSessionFetcher(configuration: configuration)
    let response = try await fetcher.fetch(
      OfflineFetchRequest(
        id: "a/1/x", url: URL(string: "https://api.tileflow.test/style.json")!,
        headers: ["X-Tileflow-Offline-Grant": "tf_offline_v1.a.b", "If-None-Match": "\"x\""],
        allowsExpensiveNetworkAccess: false))
    XCTAssertEqual(response.status, 200)
    XCTAssertEqual(response.body, Data("style".utf8))
    XCTAssertEqual(response.wireBytes, 5)
    XCTAssertEqual(response.headers["ETag"], "\"etag\"")
    let sent = try XCTUnwrap(OfflineURLProtocolStub.requests.withLock { $0.last })
    XCTAssertEqual(sent.value(forHTTPHeaderField: "X-Tileflow-Offline-Grant"), "tf_offline_v1.a.b")
    XCTAssertFalse(sent.allowsExpensiveNetworkAccess)

    let redirected = try await fetcher.fetch(
      OfflineFetchRequest(
        id: "a/1/y", url: URL(string: "https://api.tileflow.test/moved")!, headers: [:],
        allowsExpensiveNetworkAccess: true))
    XCTAssertEqual(redirected.status, 302)
    XCTAssertEqual(OfflineURLProtocolStub.requests.withLock { $0.count }, 2)
  }

  func testVerificationAcceptsTheWireOrTheDecodedBody() {
    let body = Data("tile".utf8)
    let digest = DataChannel.digest(body)
    let resource = OfflinePlannedResource(
      key: ResourceCacheKey(url: URL(string: "https://a.test/t/1/2/3.pbf")!, scope: .shared),
      bytes: 4, sha256: nil, billable: true, isPublic: false, pack: 0)
    func response(_ body: Data, etag: String?, encoding: String? = nil, wire: Int?)
      -> OfflineFetchResponse
    {
      var headers: [String: String] = [:]
      headers["ETag"] = etag
      headers["Content-Encoding"] = encoding
      return OfflineFetchResponse(
        status: 200, headers: headers, body: body, wireBytes: wire, wireSHA256: nil)
    }
    XCTAssertTrue(
      OfflineDownloader.verify(response(body, etag: "\"\(digest)\"", wire: 4), resource))
    XCTAssertFalse(
      OfflineDownloader.verify(
        response(body, etag: "\"\(String(repeating: "0", count: 64))\"", wire: 4), resource))
    XCTAssertFalse(
      OfflineDownloader.verify(response(Data("til".utf8), etag: nil, wire: 3), resource))
    // Decoded by the platform: the wire size must match.
    XCTAssertTrue(
      OfflineDownloader.verify(
        response(Data("decoded tile".utf8), etag: "\"\(digest)\"", encoding: "gzip", wire: 4),
        resource))
    XCTAssertFalse(
      OfflineDownloader.verify(
        response(Data("decoded tile".utf8), etag: "\"\(digest)\"", encoding: "gzip", wire: 5),
        resource))
    XCTAssertEqual(OfflineDownloader.etag("W/\"\(digest.uppercased())\""), digest)
    XCTAssertNil(OfflineDownloader.etag("\"short\""))
  }

  // MARK: Helpers

  private var layout: OfflineLayout {
    OfflineLayout(root: directory.appendingPathComponent("offline", isDirectory: true))
  }

  private lazy var cache = ResourceCacheStore(
    ambientRoot: directory.appendingPathComponent("ambient", isDirectory: true),
    durableRoot: directory.appendingPathComponent("durable", isDirectory: true),
    maximumBytes: 64 * 1024 * 1024)

  private func makeStore(
    _ service: OfflineServiceStub, root: String = "offline", space: LockedValue<Int64?>? = nil,
    sleeps: LockedValue<[TimeInterval]>? = nil, concurrency: Int = 8,
    fetcher: (any OfflineResourceFetching)? = nil
  ) -> TileflowOfflineStore {
    let cache =
      root == "offline"
      ? self.cache
      : ResourceCacheStore(
        ambientRoot: directory.appendingPathComponent("\(root)-ambient", isDirectory: true),
        durableRoot: directory.appendingPathComponent("\(root)-durable", isDirectory: true),
        maximumBytes: 64 * 1024 * 1024)
    let configuration = try! TileflowConfiguration(
      apiOrigin: URL(string: "https://api.tileflow.test")!,
      mapCredential: TileflowCredential("tf_public_" + String(repeating: "a", count: 48)))
    let clock = service.clock
    return TileflowOfflineStore(
      dependencies: OfflineStoreCore.Dependencies(
        layout: OfflineLayout(root: directory.appendingPathComponent(root, isDirectory: true)),
        cache: cache, fetcher: fetcher ?? service,
        client: {
          try OfflinePackClient(
            configuration: configuration, transport: service,
            now: { Date(timeIntervalSince1970: clock.withLock { $0 }) })
        },
        availableBytes: { space?.withLock { $0 } ?? nil }, reserveBytes: 4096,
        concurrency: concurrency, now: { Date(timeIntervalSince1970: clock.withLock { $0 }) },
        sleep: { delay in
          sleeps?.withLock { $0.append(delay) }
          try await Task.sleep(nanoseconds: 2_000_000)
        }))
  }

  private func madrid(east: Double = -3.69) -> TileflowOfflineRegionLoadOptions {
    TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(
        TileflowBoundingBox(west: -3.71, south: 40.41, east: east, north: 40.425)),
      content: .hosted(mapID: OfflineServiceStub.mapID, themes: ["light", "dark"]), minZoom: 12,
      maxZoom: 17)
  }

  private func waitFor(
    _ store: TileflowOfflineStore, _ id: String, timeout: TimeInterval = 30,
    _ predicate: (TileflowOfflineRegion) -> Bool
  ) async throws -> TileflowOfflineRegion {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if let region = await store.region(id: id), predicate(region) { return region }
      try await Task.sleep(nanoseconds: 5_000_000)
    }
    let region = await store.region(id: id)
    XCTFail("Timed out: \(String(describing: region))")
    throw CancellationError()
  }

  private func waitUntil(timeout: TimeInterval = 30, _ condition: () -> Bool) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while !condition() {
      guard Date() < deadline else { throw CancellationError() }
      try await Task.sleep(nanoseconds: 2_000_000)
    }
  }
}

private func XCTUnwrapAsync<T>(_ value: T?, file: StaticString = #filePath, line: UInt = #line)
  async throws -> T
{
  try XCTUnwrap(value, file: file, line: line)
}

/// A Hosted service in process: it creates packs from the region's cover, serves their resources
/// with the contract's headers and statuses, and records every download.
final class OfflineServiceStub: NativeHTTPTransporting, OfflineResourceFetching, @unchecked Sendable
{
  static let mapID = "map_offlineofflineof"
  static let origin = "https://api.tileflow.test"

  struct Download {
    let url: String
    let headers: [String: String]
    let status: Int
  }

  let clock = LockedValue<TimeInterval>(1_793_188_800)  // 2026-10-28T12:00:00Z
  private let lock = NSLock()
  private var state = State()
  /// The z17 tile a new deployment changes.
  private let changedTile: (x: Int, y: Int) = {
    let cover = OfflineTileCover(
      OfflinePackRegion.canonical(-3.71, 40.41, -3.69, 40.425)!, zoom: 17)
    let y = cover.rows!.lowerBound
    return (cover.row(y)[0].lowerBound, y)
  }()

  private struct State {
    var deployment = 1
    var changes: [String: Int] = [:]
    var grants: [String: (expires: TimeInterval, uses: Int)] = [:]
    var creations = 0
    var revalidations = 0
    var revalidationState = "current"
    var downloads: [Download] = []
    var served: [String: Data] = [:]
    var publicURLs = Set<String>()
    var billable = 0
    var isOnline = true
    var freezeAfter: Int?
    var expireGrantAfter: Int?
    var refuseOnce: (at: Int, status: Int, code: String, retryAfter: String?)?
    var tileLimit: Int?
    var documentsPublicOnly = false
    var maximumPackResources = 10_000
    var onDownload: (@Sendable (Int) -> Void)?
    var changedURLs: [String] = []
  }

  private func locked<T>(_ body: (inout State) -> T) -> T { lock.withLock { body(&state) } }

  var creations: Int { locked { $0.creations } }
  var revalidations: Int { locked { $0.revalidations } }
  var downloads: [Download] { locked { $0.downloads } }
  var served: [String: Data] { locked { $0.served } }
  var billableCount: Int { locked { $0.billable } }
  var changedURLs: [String] { locked { $0.changedURLs } }
  var isOnline: Bool {
    get { locked { $0.isOnline } }
    set { locked { $0.isOnline = newValue } }
  }
  var freezeAfter: Int? {
    get { locked { $0.freezeAfter } }
    set { locked { $0.freezeAfter = newValue } }
  }
  var expireGrantAfter: Int? {
    get { locked { $0.expireGrantAfter } }
    set { locked { $0.expireGrantAfter = newValue } }
  }
  var refuseOnce: (Int, Int, String, String?)? {
    get { locked { $0.refuseOnce.map { ($0.at, $0.status, $0.code, $0.retryAfter) } } }
    set { locked { $0.refuseOnce = newValue.map { ($0.0, $0.1, $0.2, $0.3) } } }
  }
  var revalidationState: String {
    get { locked { $0.revalidationState } }
    set { locked { $0.revalidationState = newValue } }
  }
  var tileLimit: Int? {
    get { locked { $0.tileLimit } }
    set { locked { $0.tileLimit = newValue } }
  }
  var documentsPublicOnly: Bool {
    get { locked { $0.documentsPublicOnly } }
    set { locked { $0.documentsPublicOnly = newValue } }
  }
  var maximumPackResources: Int {
    get { locked { $0.maximumPackResources } }
    set { locked { $0.maximumPackResources = newValue } }
  }
  var onDownload: (@Sendable (Int) -> Void)? {
    get { locked { $0.onDownload } }
    set { locked { $0.onDownload = newValue } }
  }

  var styleURL: String {
    "\(Self.origin)/maps/\(Self.mapID)/mobile/webview-v1/v\(locked { $0.deployment })/light.json"
  }

  func isPublic(_ url: String) -> Bool { locked { $0.publicURLs.contains(url) } }

  func scope(_ url: String) -> ResourceCacheScope {
    isPublic(url) || !url.hasPrefix(Self.origin)
      ? .shared : .grant(apiOrigin: URL(string: Self.origin)!, mapID: Self.mapID)
  }

  func key(_ url: String) -> ResourceCacheKey {
    ResourceCacheKey(url: URL(string: url)!, scope: scope(url))
  }

  /// A new deployment: a new versioned style URL and new bodies for one tile and the profile.
  func publish() {
    locked { state in
      state.deployment += 1
      state.changes["tile"] = state.deployment
      state.changes["profile"] = state.deployment
    }
    let tile = "\(Self.origin)/tiles/world/{z}/{x}/{y}.pbf?map=\(Self.mapID)"
      .replacingOccurrences(of: "{z}", with: "17").replacingOccurrences(
        of: "{x}", with: "\(changedTile.x)"
      ).replacingOccurrences(of: "{y}", with: "\(changedTile.y)")
    locked {
      $0.changedURLs = [
        tile, "\(Self.origin)/maps/\(Self.mapID)/mobile/webview-v1/v\($0.deployment)/light.json",
        "\(Self.origin)/maps/\(Self.mapID)/mobile/webview-v1/v\($0.deployment)/dark.json",
        "\(Self.origin)/maps/\(Self.mapID)/mobile/webview-v1/manifest.json",
      ]
    }
  }

  // MARK: Bodies

  private func body(_ url: String, state: State) -> Data {
    var version = 1
    if url.contains("/tiles/"), url.contains("/\(17)/\(changedTile.x)/\(changedTile.y).") {
      version = state.changes["tile"] ?? 1
    }
    if url.hasSuffix("/webview-v1/manifest.json") { version = state.changes["profile"] ?? 1 }
    if url.hasPrefix("https://tiles.example.com/"), url.hasSuffix("/style.json") {
      return Data(
        #"{"version":8,"sprite":"https://tiles.example.com/sprites/base","glyphs":"https://tiles.example.com/fonts/{fontstack}/{range}.pbf","sources":{},"layers":[{"id":"l","type":"symbol","layout":{"text-font":["Noto Sans Regular"],"text-field":"x"}}]}"#
          .utf8)
    }
    return Data("\(url)#\(version)".utf8)
  }

  // MARK: NativeHTTPTransporting

  func send(_ request: URLRequest) async throws -> ResourcePayload {
    guard isOnline else { throw URLError(.notConnectedToInternet) }
    let path = request.url!.path
    if path.hasSuffix("/revalidate") {
      return locked { state in
        state.revalidations += 1
        let checked = Self.date(clock.withLock { $0 })
        let body =
          state.revalidationState == "not_updatable"
          ? #"{"state":"not_updatable","reason":"credential_revoked","checkedAt":"\#(checked)"}"#
          : #"{"state":"\#(state.revalidationState)","checkedAt":"\#(checked)","intervalSeconds":86400}"#
        return ResourcePayload(bytes: Data(body.utf8), status: 200, headers: [:])
      }
    }
    let packRequest = OfflinePackRequest(json: request.httpBody!)!
    let now = clock.withLock { $0 }
    return locked { state in
      state.creations += 1
      state.revalidationState = "current"
      return ResourcePayload(
        bytes: created(packRequest, now: now, state: &state), status: 201, headers: [:])
    }
  }

  func close() {}

  private func created(_ request: OfflinePackRequest, now: TimeInterval, state: inout State) -> Data
  {
    let mapPath = "\(Self.origin)/maps/\(Self.mapID)/mobile"
    var documents: [[String: Any]] = []
    func document(_ kind: String, _ url: String, billable: Bool, public isPublic: Bool) {
      let body = self.body(url, state: state)
      if isPublic { state.publicURLs.insert(url) }
      documents.append([
        "kind": kind, "url": url, "bytes": body.count,
        "sha256": DataChannel.digest(body), "billable": billable,
        "access": isPublic ? "public" : "grant",
      ])
    }
    document("discovery", "\(mapPath)/manifest.json", billable: false, public: true)
    document("profile", "\(mapPath)/webview-v1/manifest.json", billable: false, public: true)
    if !state.documentsPublicOnly {
      for theme in request.themes {
        document(
          "style", "\(mapPath)/webview-v1/v\(state.deployment)/\(theme).json", billable: true,
          public: false)
      }
      document(
        "glyph", "\(Self.origin)/fonts/Noto%20Sans%20Regular/0-255.pbf", billable: true,
        public: false)
      document(
        "landmark", "\(Self.origin)/landmarks/2026-10/notice.txt", billable: false, public: true)
    }
    let template = "\(Self.origin)/tiles/world/{z}/{x}/{y}.pbf?map=\(Self.mapID)"
    var entries: [[Int]] = []
    zooms: for zoom in request.minZoom...request.maxZoom {
      let cover = OfflineTileCover(request.region, zoom: zoom)
      guard let rows = cover.rows else { continue }
      for y in rows {
        for xs in cover.row(y) {
          for x in xs {
            if let limit = state.tileLimit, entries.count >= limit { break zooms }
            let url = template.replacingOccurrences(of: "{z}", with: "\(zoom)")
              .replacingOccurrences(of: "{x}", with: "\(x)").replacingOccurrences(
                of: "{y}", with: "\(y)")
            entries.append([zoom, x, y, body(url, state: state).count])
          }
        }
      }
    }
    let billable = documents.filter { $0["billable"] as! Bool }.count + entries.count
    state.billable = billable
    let bytes =
      documents.reduce(0) { $0 + ($1["bytes"] as! Int) } + entries.reduce(0) { $0 + $1[3] }
    state.grants.removeAll()
    let grant = "tf_offline_v1.g\(state.creations).sig"
    state.grants[grant] = (now + 86_400, 0)
    let manifest: [String: Any] = [
      "version": 1, "packId": "opk_" + String(format: "%022d", state.creations),
      "mapId": request.mapID, "profile": request.profile, "deploymentVersion": state.deployment,
      "themes": request.themes,
      "region": try! JSONSerialization.jsonObject(
        with: JSONEncoder().encode(request.region.json)),
      "minZoom": request.minZoom, "maxZoom": request.maxZoom,
      "terrainMaxZoom": request.terrainMaxZoom, "createdAt": Self.date(now),
      "documents": documents,
      "tiles": [
        [
          "source": "world", "template": template, "zooms": [request.minZoom, request.maxZoom],
          "entries": entries,
        ]
      ],
      "excluded": [],
      "totals": [
        "resources": documents.count + entries.count,
        "billableResources": billable, "bytes": bytes,
      ],
      "attribution": ["sources": [["source": "world", "text": "© OpenStreetMap contributors"]]],
      "limits": ["maxPackResources": state.maximumPackResources, "dailyDownloads": 200_000],
      "revalidation": [
        "url": "\(Self.origin)/v1/offline/packs/revalidate", "intervalSeconds": 86_400,
      ],
      "download": ["expiresAt": Self.date(now + 86_400)],
    ]
    return try! JSONSerialization.data(withJSONObject: [
      "version": 1, "kind": "offline_pack", "grant": grant, "manifest": manifest,
    ])
  }

  // MARK: OfflineResourceFetching

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    try Task.checkCancellation()
    let url = request.url.absoluteString
    enum Action {
      case respond(OfflineFetchResponse)
      case freeze
      case offline
      case cancelled
    }
    let now = clock.withLock { $0 }
    let action: Action = locked { state in
      // Checked under the lock, so a request cancelled before a test changes the stub never
      // reaches it.
      if Task.isCancelled { return .cancelled }
      guard state.isOnline else { return .offline }
      if let freeze = state.freezeAfter, state.downloads.count >= freeze { return .freeze }
      let count = state.downloads.count + 1
      func record(_ response: OfflineFetchResponse) -> Action {
        state.downloads.append(
          Download(url: url, headers: request.headers, status: response.status))
        if response.status == 200 { state.served[url] = response.body }
        state.onDownload?(count)
        return .respond(response)
      }
      if let refuse = state.refuseOnce, refuse.at == count {
        state.refuseOnce = nil
        var headers = ["Cache-Control": "no-store"]
        headers["Retry-After"] = refuse.retryAfter
        return record(
          OfflineFetchResponse(
            status: refuse.status, headers: headers,
            body: Data(#"{"code":"\#(refuse.code)","error":"refused"}"#.utf8), wireBytes: nil,
            wireSHA256: nil))
      }
      if url.hasPrefix(Self.origin), !state.publicURLs.contains(url) {
        let grant = request.headers["X-Tileflow-Offline-Grant"] ?? ""
        var expired = true
        if let entry = state.grants[grant] {
          expired = now >= entry.expires
          if let limit = state.expireGrantAfter, entry.uses >= limit {
            state.expireGrantAfter = nil
            state.grants.removeValue(forKey: grant)
            expired = true
          }
        }
        if expired {
          return record(
            OfflineFetchResponse(
              status: 401, headers: ["Cache-Control": "no-store"],
              body: Data(#"{"code":"OFFLINE_PACK_GRANT_EXPIRED","error":"expired"}"#.utf8),
              wireBytes: nil, wireSHA256: nil))
        }
        state.grants[grant]?.uses += 1
      }
      let body = self.body(url, state: state)
      let etag = "\"\(DataChannel.digest(body))\""
      if request.headers["If-None-Match"] == etag {
        return record(
          OfflineFetchResponse(
            status: 304, headers: ["ETag": etag], body: Data(), wireBytes: 0, wireSHA256: nil))
      }
      if url.hasPrefix("https://tiles.example.com/streets/"), url.contains("/14/") {
        return record(
          OfflineFetchResponse(
            status: 404, headers: [:], body: Data(), wireBytes: 0, wireSHA256: nil))
      }
      return record(
        OfflineFetchResponse(
          status: 200,
          headers: [
            "ETag": etag, "Cache-Control": "private, no-cache",
            "Content-Type": "application/octet-stream",
          ], body: body, wireBytes: body.count, wireSHA256: nil))
    }
    switch action {
    case .respond(let response): return response
    case .offline: throw URLError(.notConnectedToInternet)
    case .cancelled: throw CancellationError()
    case .freeze:
      try await Task.sleep(nanoseconds: 3_600_000_000_000)
      throw CancellationError()
    }
  }

  func cancel(prefix: String) {}

  static func date(_ seconds: TimeInterval) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: Date(timeIntervalSince1970: seconds))
  }
}

/// A process that ends after `after` requests: later requests never return.
final class OfflineFreezingFetcher: OfflineResourceFetching, @unchecked Sendable {
  private let base: any OfflineResourceFetching
  private let remaining: LockedValue<Int>

  init(_ base: any OfflineResourceFetching, after: Int) {
    self.base = base
    remaining = LockedValue(after)
  }

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    let allowed = remaining.withLock { value in
      defer { value -= 1 }
      return value > 0
    }
    guard allowed else {
      try await Task.sleep(nanoseconds: 3_600_000_000_000)
      throw CancellationError()
    }
    return try await base.fetch(request)
  }

  func cancel(prefix: String) {}
}

final class OfflineURLProtocolStub: URLProtocol {
  static let requests = LockedValue<[URLRequest]>([])

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    Self.requests.withLock { $0.append(request) }
    let url = request.url!
    if url.path == "/moved" {
      let response = HTTPURLResponse(
        url: url, statusCode: 302, httpVersion: "HTTP/1.1",
        headerFields: ["Location": "https://elsewhere.test/"])!
      client?.urlProtocol(
        self, wasRedirectedTo: URLRequest(url: URL(string: "https://elsewhere.test/")!),
        redirectResponse: response)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocolDidFinishLoading(self)
      return
    }
    let response = HTTPURLResponse(
      url: url, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: ["ETag": "\"etag\"", "Content-Length": "5", "Set-Cookie": "a=b"])!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: Data("style".utf8))
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}
