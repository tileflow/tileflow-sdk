import Foundation
import XCTest

@testable import Tileflow

final class ResourceCacheTests: XCTestCase {
  private var root: URL!
  private let clock = TestDate()
  private let origin = "https://maps.example.com"

  override func setUp() {
    root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  }

  override func tearDown() {
    try? FileManager.default.removeItem(at: root)
  }

  private func store(budget: Int64 = 1 << 20) -> ResourceCacheStore {
    ResourceCacheStore(
      ambientRoot: root.appendingPathComponent("ambient"),
      durableRoot: root.appendingPathComponent("durable"), maximumBytes: budget,
      now: { [clock] in clock.now })
  }

  private func loader(_ cache: ResourceCacheStore, _ transport: RecordingTransport)
    -> ResourceLoader
  {
    ResourceLoader(
      policy: ResourcePolicy(origins: [origin]), transport: transport, cache: cache,
      date: { [clock] in clock.now })
  }

  private func url(_ path: String) -> URL { URL(string: origin + path)! }

  func testNoStoreResponsesAreNeverWritten() async throws {
    let cache = store()
    for header in ["no-store", "private, no-store", "public, max-age=60, no-store"] {
      let transport = RecordingTransport { _ in
        ResourcePayload(bytes: Data("tile".utf8), status: 200, headers: ["Cache-Control": header])
      }
      let resources = loader(cache, transport)
      for _ in 0..<2 {
        let payload = try await resources.load(URLRequest(url: url("/tiles/1/0/0.pbf")))
        XCTAssertEqual(payload.bytes, Data("tile".utf8))
        XCTAssertEqual(payload.headers["Cache-Control"], "no-store")
      }
      XCTAssertEqual(transport.requests.count, 2, header)
    }
    cache.settle()
    XCTAssertEqual(cache.usage().entries, 0)
    XCTAssertFalse(
      FileManager.default.fileExists(atPath: root.appendingPathComponent("ambient/shared").path))
  }

  func testFreshResponsesAnswerLaterMountsWithoutTheNetwork() async throws {
    let cache = store()
    let transport = RecordingTransport { _ in
      ResourcePayload(
        bytes: Data("style".utf8), status: 200,
        headers: [
          "Cache-Control": "public, max-age=60", "ETag": "\"a\"",
          "Content-Type": "application/json",
        ])
    }
    let first = loader(cache, transport)
    _ = try await first.load(URLRequest(url: url("/style.json")))
    first.close()
    let second = loader(cache, RecordingTransport { _ in throw URLError(.notConnectedToInternet) })
    let payload = try await second.load(URLRequest(url: url("/style.json")))
    XCTAssertEqual(payload.bytes, Data("style".utf8))
    XCTAssertEqual(payload.headers["Content-Type"], "application/json")
    XCTAssertEqual(payload.headers["Cache-Control"], "no-store")
    XCTAssertEqual(payload.headers["Content-Length"], "5")
    XCTAssertEqual(transport.requests.count, 1)
    let usage = cache.usage()
    XCTAssertEqual(usage.entries, 1)
    XCTAssertGreaterThan(usage.bytesByClass[.style] ?? 0, 5)
  }

  func testStaleResponsesAreRevalidatedWithTheirValidators() async throws {
    let cache = store()
    let modified = "Wed, 21 Oct 2026 07:28:00 GMT"
    let transport = RecordingTransport { request in
      if request.value(forHTTPHeaderField: "If-None-Match") == "\"v1\"" {
        return ResourcePayload(
          bytes: Data(), status: 304, headers: ["Cache-Control": "max-age=100", "ETag": "\"v1\""])
      }
      return ResourcePayload(
        bytes: Data("v1".utf8), status: 200,
        headers: ["Cache-Control": "max-age=10", "ETag": "\"v1\"", "Last-Modified": modified])
    }
    let resources = loader(cache, transport)
    let address = url("/sprite.json")
    _ = try await resources.load(URLRequest(url: address))
    clock.advance(20)
    let revalidated = try await resources.load(URLRequest(url: address))
    XCTAssertEqual(revalidated.status, 200)
    XCTAssertEqual(revalidated.bytes, Data("v1".utf8))
    XCTAssertEqual(transport.requests.count, 2)
    XCTAssertEqual(transport.requests[1].value(forHTTPHeaderField: "If-Modified-Since"), modified)
    // The 304 refreshed the lifetime to 100 seconds.
    clock.advance(50)
    _ = try await resources.load(URLRequest(url: address))
    XCTAssertEqual(transport.requests.count, 2)
    clock.advance(60)
    _ = try await resources.load(URLRequest(url: address))
    XCTAssertEqual(transport.requests.count, 3)
  }

  func testChangedResponsesReplaceTheStoredOne() async throws {
    let cache = store()
    let version = LockedValue(1)
    let transport = RecordingTransport { _ in
      let current = version.withLock { $0 }
      return ResourcePayload(
        bytes: Data("v\(current)".utf8), status: 200,
        headers: ["Cache-Control": "max-age=10", "ETag": "\"v\(current)\""])
    }
    let resources = loader(cache, transport)
    let address = url("/tiles.json")
    _ = try await resources.load(URLRequest(url: address))
    version.withLock { $0 = 2 }
    clock.advance(20)
    let value0 = try await resources.load(URLRequest(url: address))
    XCTAssertEqual(value0.bytes, Data("v2".utf8))
    let offline = loader(cache, RecordingTransport { _ in throw URLError(.timedOut) })
    let value1 = try await offline.load(URLRequest(url: address))
    XCTAssertEqual(value1.bytes, Data("v2".utf8))
  }

  func testStoredPublicResponsesAnswerWhenTheNetworkFails() async throws {
    let cache = store()
    let headers: [String: [String: String]] = [
      "/tiles/2/1/1.pbf": ["Cache-Control": "max-age=0", "ETag": "\"t\""],
      "/plain.json": [:],
      "/strict.json": ["Cache-Control": "max-age=0, must-revalidate", "ETag": "\"s\""],
      "/validate.json": ["Cache-Control": "no-cache", "ETag": "\"n\""],
      "/short.json": ["Cache-Control": "max-age=0, stale-if-error=5", "ETag": "\"x\""],
    ]
    let online = loader(
      cache,
      RecordingTransport { request in
        ResourcePayload(
          bytes: Data(request.url!.path.utf8), status: 200, headers: headers[request.url!.path]!)
      })
    for path in headers.keys { _ = try await online.load(URLRequest(url: url(path))) }
    clock.advance(10)
    let failing = loader(cache, RecordingTransport { _ in throw URLError(.notConnectedToInternet) })
    let unavailable = loader(
      cache,
      RecordingTransport { _ in ResourcePayload(bytes: Data(), status: 503, headers: [:]) })
    for path in ["/tiles/2/1/1.pbf", "/plain.json"] {
      let value2 = try await failing.load(URLRequest(url: url(path)))
      XCTAssertEqual(value2.bytes, Data(path.utf8))
      let value3 = try await unavailable.load(URLRequest(url: url(path)))
      XCTAssertEqual(value3.bytes, Data(path.utf8))
    }
    for path in ["/strict.json", "/validate.json", "/short.json"] {
      do {
        _ = try await failing.load(URLRequest(url: url(path)))
        XCTFail("\(path) answered past its allowance")
      } catch { XCTAssertEqual((error as? URLError)?.code, .notConnectedToInternet) }
      let value4 = try await unavailable.load(URLRequest(url: url(path)))
      XCTAssertEqual(value4.status, 503)
    }
  }

  func testRangeHeadAndFailedRequestsBypassTheCache() async throws {
    let cache = store()
    let transport = RecordingTransport { request in
      let status =
        request.value(forHTTPHeaderField: "Range") != nil
        ? 206 : request.url!.path == "/missing.json" ? 404 : 200
      return ResourcePayload(
        bytes: Data("x".utf8), status: status, headers: ["Cache-Control": "max-age=60"])
    }
    let resources = loader(cache, transport)
    var range = URLRequest(url: url("/archive.pmtiles"))
    range.setValue("bytes=0-1", forHTTPHeaderField: "Range")
    var head = URLRequest(url: url("/archive.pmtiles"))
    head.httpMethod = "HEAD"
    for request in [range, head, URLRequest(url: url("/missing.json"))] {
      _ = try await resources.load(request)
      _ = try await resources.load(request)
    }
    XCTAssertEqual(transport.requests.count, 6)
    cache.settle()
    XCTAssertEqual(cache.usage().entries, 0)
  }

  func testLeastRecentlyUsedEntriesAreEvictedWithinTheBudget() throws {
    let cache = store()
    let keys = (0..<7).map { ResourceCacheKey(url: url("/tiles/3/\($0)/0.pbf"), scope: .shared) }
    clock.advance(1)
    XCTAssertTrue(write(cache, keys[0], bytes: 400))
    cache.settle()
    let size = cache.usage().bytes
    cache.maximumBytes = size * 6 + size / 2
    for key in keys[1..<6] {
      clock.advance(1)
      XCTAssertTrue(write(cache, key, bytes: 400))
    }
    clock.advance(1)
    XCTAssertNotNil(cache.read(keys[0], retention: .ambient), "Reading refreshes last use")
    clock.advance(1)
    XCTAssertTrue(write(cache, keys[6], bytes: 400))
    cache.settle()
    XCTAssertLessThanOrEqual(cache.usage().bytes, cache.maximumBytes / 10 * 9)
    XCTAssertNil(cache.read(keys[1], retention: .ambient), "The least recently used entry left")
    XCTAssertNil(cache.read(keys[2], retention: .ambient))
    for key in [keys[0], keys[3], keys[6]] { XCTAssertNotNil(cache.read(key, retention: .ambient)) }
    // One entry may use at most an eighth of the budget.
    XCTAssertFalse(write(cache, ResourceCacheKey(url: url("/big.glb"), scope: .shared), bytes: 600))
  }

  func testPinnedEntriesAreNeitherEvictedNorClearedAndAnswerOffline() async throws {
    let cache = store(budget: 2_000)
    let pinned = ResourceCacheKey(url: url("/tiles/4/0/0.pbf"), scope: .shared)
    XCTAssertTrue(
      write(cache, pinned, retention: .pinned, bytes: 5_000, headers: ["ETag": "\"p\""]))
    for index in 0..<10 {
      _ = write(
        cache, ResourceCacheKey(url: url("/tiles/5/\(index)/0.pbf"), scope: .shared), bytes: 200)
    }
    cache.clear()
    cache.settle()
    XCTAssertEqual(cache.usage().entries, 0)
    XCTAssertNotNil(cache.read(pinned, retention: .pinned))
    clock.advance(365 * 24 * 60 * 60)
    let offline = loader(cache, RecordingTransport { _ in throw URLError(.notConnectedToInternet) })
    let value5 = try await offline.load(URLRequest(url: pinned.url))
    XCTAssertEqual(value5.bytes.count, 5_000)
    // Online, a stale pinned entry is revalidated with its own validator and stays pinned.
    let online = RecordingTransport { _ in
      ResourcePayload(bytes: Data(), status: 304, headers: ["Cache-Control": "max-age=60"])
    }
    _ = try await loader(cache, online).load(URLRequest(url: pinned.url))
    XCTAssertEqual(online.requests.first?.value(forHTTPHeaderField: "If-None-Match"), "\"p\"")
    cache.removePinned([pinned])
    XCTAssertNil(cache.read(pinned, retention: .pinned))
  }

  func testCorruptedAndMisplacedEntriesAreDropped() throws {
    let cache = store()
    let keys = (0..<3).map { ResourceCacheKey(url: url("/glyphs/Noto/\($0).pbf"), scope: .shared) }
    for key in keys { XCTAssertTrue(write(cache, key, bytes: 64)) }
    let flipped = cache.file(for: keys[0], retention: .ambient)
    var bytes = try Data(contentsOf: flipped)
    bytes[3] ^= 0xff
    try bytes.write(to: flipped)
    let truncated = cache.file(for: keys[1], retention: .ambient)
    try Data(try Data(contentsOf: truncated).dropLast(5)).write(to: truncated)
    // A file under another key's address is rejected by its recorded URL.
    let misplaced = ResourceCacheKey(url: url("/glyphs/Noto/9.pbf"), scope: .shared)
    let target = cache.file(for: misplaced, retention: .ambient)
    try FileManager.default.createDirectory(
      at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
    try FileManager.default.copyItem(at: cache.file(for: keys[2], retention: .ambient), to: target)
    for key in [keys[0], keys[1], misplaced] {
      XCTAssertNil(cache.read(key, retention: .ambient))
      XCTAssertFalse(
        FileManager.default.fileExists(atPath: cache.file(for: key, retention: .ambient).path))
    }
    XCTAssertEqual(cache.droppedEntries, 3)
    XCTAssertNotNil(cache.read(keys[2], retention: .ambient))
  }

  func testPartitionsSeparateScopesAndResourceClasses() throws {
    let classes: [String: TileflowResourceClass] = [
      "/maps/m/native/v3/light.json": .style,
      "/tiles/world/tiles.json": .style,
      "/tiles/world/release/12/2048/1361.pbf": .tiles,
      "/terrain/9/1/2.webp": .tiles,
      "/fonts/Noto%20Sans/0-255.pbf": .glyphs,
      "/fonts/noto.woff2": .glyphs,
      "/sprites/streets/sprite@2x.png": .sprites,
      "/sprites/streets/sprite.json": .sprites,
      "/landmarks/tiles/abc.glb": .models,
      "/team-models/tmd_x/current.glb": .models,
      "/notice.txt": .other,
    ]
    for (path, expected) in classes {
      XCTAssertEqual(TileflowResourceClass.classify(url(path)), expected, path)
    }
    let scope = ResourceCacheScope.grant(
      apiOrigin: URL(string: "https://api.tileflow.dev")!, mapID: "map_0123456789abcdef")
    guard case .grant(let id) = scope else { return XCTFail("Not a grant scope") }
    XCTAssertEqual(id.count, 32)
    XCTAssertFalse(scope.directory.contains("map_"))
    let protected = ResourceCacheKey(url: url("/tiles/6/1/1.pbf"), scope: scope)
    XCTAssertTrue(protected.relativePath.hasPrefix("grant-\(id)/tiles/"))
    let cache = store()
    XCTAssertTrue(write(cache, protected, bytes: 10))
    XCTAssertNil(
      cache.read(ResourceCacheKey(url: protected.url, scope: .shared), retention: .ambient))
    cache.clear(scope)
    XCTAssertNil(cache.read(protected, retention: .ambient))
  }

  func testProtectedResponsesNeedExplicitFreshnessAndAreNeverServedStale() {
    XCTAssertFalse(ResourceCachePolicy.isStorable(status: 200, headers: [:], protected: true))
    XCTAssertTrue(ResourceCachePolicy.isStorable(status: 200, headers: [:], protected: false))
    XCTAssertTrue(
      ResourceCachePolicy.isStorable(
        status: 200, headers: ["Cache-Control": "private, max-age=60"], protected: true))
    XCTAssertFalse(
      ResourceCachePolicy.isStorable(
        status: 200, headers: ["Cache-Control": "private, no-store"], protected: true))
    XCTAssertFalse(
      ResourceCachePolicy.isStorable(status: 200, headers: ["Vary": "Origin, *"], protected: false))
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let modified = ["Last-Modified": HTTPDate.format(now.addingTimeInterval(-100_000))]
    XCTAssertEqual(
      ResourceCachePolicy.expiry(headers: modified, responseTime: now, protected: true), now)
    XCTAssertEqual(
      ResourceCachePolicy.expiry(headers: modified, responseTime: now, protected: false),
      now.addingTimeInterval(10_000))
    let expiry = now.addingTimeInterval(60)
    XCTAssertEqual(
      ResourceCachePolicy.staleLimit(headers: [:], expiry: expiry, protected: true), expiry)
    XCTAssertEqual(
      ResourceCachePolicy.staleLimit(headers: [:], expiry: expiry, protected: false),
      expiry.addingTimeInterval(30 * 24 * 60 * 60))
  }

  func testFreshnessFollowsCacheControlExpiresAndAge() {
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    func expiry(_ headers: [String: String]) -> TimeInterval {
      ResourceCachePolicy.expiry(headers: headers, responseTime: now, protected: false)
        .timeIntervalSince(now)
    }
    XCTAssertEqual(expiry(["Cache-Control": "public, max-age=300"]), 300)
    XCTAssertEqual(expiry(["Cache-Control": "max-age=300", "Age": "100"]), 200)
    XCTAssertEqual(expiry(["Cache-Control": "max-age=300, no-cache"]), 0)
    XCTAssertEqual(expiry(["Cache-Control": "max-age=abc"]), 0)
    XCTAssertEqual(
      expiry([
        "Date": HTTPDate.format(now), "Expires": HTTPDate.format(now.addingTimeInterval(90)),
      ]), 90)
    XCTAssertEqual(
      expiry(["Last-Modified": HTTPDate.format(now.addingTimeInterval(-10_000_000))]),
      ResourceCachePolicy.maximumHeuristicLifetime)
    XCTAssertEqual(
      ResourceCachePolicy.merging(
        ["Content-Type": "a", "ETag": "1"], notModified: ["Content-Type": "b", "ETag": "2"]),
      ["Content-Type": "a", "ETag": "2"])
  }

  func testClearRemovesEntriesAndDiscardsWritesInFlight() throws {
    let cache = store()
    let key = ResourceCacheKey(url: url("/models/a.glb"), scope: .shared)
    XCTAssertTrue(write(cache, key, bytes: 32))
    let pending = try XCTUnwrap(
      cache.writer(
        for: ResourceCacheKey(url: url("/models/b.glb"), scope: .shared), retention: .ambient))
    pending.append(Data(repeating: 1, count: 32))
    cache.clear()
    XCTAssertFalse(pending.commit(metadata(for: url("/models/b.glb"), body: pending.body)))
    cache.settle()
    XCTAssertEqual(cache.usage(), ResourceCacheStore.Usage())
    XCTAssertNil(cache.read(key, retention: .ambient))
    XCTAssertTrue(write(cache, key, bytes: 32), "The store accepts writes after clearing")
  }

  func testUsageIsRebuiltFromDiskAndStagingIsEmptied() throws {
    let first = store()
    for index in 0..<4 {
      XCTAssertTrue(
        write(
          first, ResourceCacheKey(url: url("/tiles/7/\(index)/1.pbf"), scope: .shared), bytes: 100))
    }
    let leftover = root.appendingPathComponent("ambient/staging/partial")
    try Data([1, 2, 3]).write(to: leftover)
    first.settle()
    let expected = first.usage()
    let second = store()
    second.settle()
    XCTAssertEqual(second.usage(), expected)
    XCTAssertEqual(second.usage().bytesByClass[.tiles], expected.bytes)
    XCTAssertFalse(FileManager.default.fileExists(atPath: leftover.path))
  }

  func testDeviceProfilesScaleQualityAndCache() {
    let gigabyte: UInt64 = 1 << 30
    let low = TileflowDeviceProfile.recommended(physicalMemory: 2 * gigabyte, gpuClass: .standard)
    XCTAssertTrue(low.isLowMemoryDevice)
    XCTAssertEqual(low.quality, .low)
    XCTAssertEqual(low.cacheBytes, 64 << 20)
    let older = TileflowDeviceProfile.recommended(physicalMemory: 4 * gigabyte, gpuClass: .low)
    XCTAssertEqual(older.quality, .low)
    XCTAssertEqual(older.cacheBytes, 256 << 20)
    let standard = TileflowDeviceProfile.recommended(physicalMemory: 6 * gigabyte, gpuClass: .high)
    XCTAssertEqual(standard.quality, .balanced)
    XCTAssertEqual(standard.cacheBytes, 512 << 20)
    let high = TileflowDeviceProfile.recommended(physicalMemory: 8 * gigabyte, gpuClass: .high)
    XCTAssertEqual(high.quality, .high)
    // An explicit quality wins over the profile; nil follows it.
    let previous = TileflowDeviceProfile.current
    defer { TileflowDeviceProfile.current = previous }
    TileflowDeviceProfile.current = low
    XCTAssertEqual(ResourceCacheStore.shared.maximumBytes, 64 << 20)
    XCTAssertEqual(try encodedQuality(TileflowMapOptions()), "low")
    XCTAssertEqual(try encodedQuality(TileflowMapOptions(quality: .high)), "high")
  }

  private func encodedQuality(_ options: TileflowMapOptions) throws -> String? {
    let value = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(options))
    return value["quality"]?.string
  }

  private func metadata(
    for url: URL, headers: [String: String] = ["Cache-Control": "max-age=60"],
    body: (length: Int, sha256: String)
  ) -> ResourceCacheMetadata {
    ResourceCacheMetadata(
      url: url, status: 200, headers: headers, responseTime: clock.now, protected: false,
      body: body)
  }

  @discardableResult
  private func write(
    _ cache: ResourceCacheStore, _ key: ResourceCacheKey,
    retention: ResourceCacheRetention = .ambient, bytes count: Int,
    headers: [String: String] = ["Cache-Control": "max-age=60"]
  ) -> Bool {
    let body = Data((0..<count).map { UInt8($0 % 251) })
    return cache.write(
      key, retention: retention,
      metadata: metadata(
        for: key.url, headers: headers, body: (body.count, DataChannel.digest(body))),
      body: body)
  }
}

final class TestDate: @unchecked Sendable {
  private let value = LockedValue(Date(timeIntervalSince1970: 1_800_000_000))
  var now: Date { value.withLock { $0 } }
  func advance(_ seconds: TimeInterval) { value.withLock { $0 = $0.addingTimeInterval(seconds) } }
}

final class RecordingTransport: NativeHTTPTransporting, @unchecked Sendable {
  private let captured = LockedValue<[URLRequest]>([])
  private let respond: @Sendable (URLRequest) async throws -> ResourcePayload

  init(_ respond: @escaping @Sendable (URLRequest) async throws -> ResourcePayload) {
    self.respond = respond
  }

  var requests: [URLRequest] { captured.withLock { $0 } }

  func send(_ request: URLRequest) async throws -> ResourcePayload {
    captured.withLock { $0.append(request) }
    return try await respond(request)
  }

  func close() {}
}
