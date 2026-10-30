import Compression
import CryptoKit
import XCTest

@testable import Tileflow
@testable import TileflowConfiguration

/// The pack format: what a verified pack must be, how its entries are read, and how tile
/// addresses map to packs and back.
final class OfflinePackTests: XCTestCase {
  private var directory: URL!

  override func setUpWithError() throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-pack-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  override func tearDownWithError() throws {
    try? FileManager.default.removeItem(at: directory)
  }

  func testAVerifiedPackIsReadInPlace() throws {
    let tile = OfflinePackBuilder.gzip(Data("tile 12/2005/1544".utf8))
    let pack = OfflinePackBuilder.build(
      .tiles,
      [
        .init(name: "11/1002/772", contentType: "application/x-protobuf", encoding: "gzip", body: tile),
        .init(name: "12/2005/1544", contentType: "application/x-protobuf", encoding: "gzip", body: tile),
      ])
    let file = write(pack)
    let (digest, index) = try OfflinePackFormat.verify(file, bytes: pack.count, kind: .tiles)
    XCTAssertEqual(digest, DataChannel.digest(pack.prefix(pack.count - 32)))
    XCTAssertEqual(Data(hex: digest), pack.suffix(32))
    XCTAssertEqual(index.entries.count, 2)
    let entry = try XCTUnwrap(index.entries["12/2005/1544"])
    XCTAssertEqual(entry.contentEncoding, "gzip")
    XCTAssertEqual(try OfflinePackFormat.body(entry, in: file), tile)
    XCTAssertEqual(try OfflinePackFormat.gunzip(tile), Data("tile 12/2005/1544".utf8))
    XCTAssertEqual(try OfflinePackFormat.index(file).entries, index.entries)
  }

  func testDamagedPacksAreRefused() throws {
    let pack = OfflinePackBuilder.build(
      .documents,
      [
        .init(
          name: "https://api.tileflow.test/style.json", contentType: "application/json",
          encoding: nil, body: Data("{}".utf8))
      ])
    func refused(_ data: Data, bytes: Int? = nil, kind: OfflinePackKind = .documents) -> Bool {
      (try? OfflinePackFormat.verify(write(data), bytes: bytes ?? data.count, kind: kind)) == nil
    }
    XCTAssertFalse(refused(pack))
    XCTAssertTrue(refused(pack, kind: .tiles), "Another kind")
    XCTAssertTrue(refused(pack, bytes: pack.count + 1), "Not the manifest's size")
    XCTAssertTrue(refused(pack.prefix(pack.count - 1)), "Cut short")
    var flipped = pack
    flipped[flipped.count - 40] ^= 1
    XCTAssertTrue(refused(flipped), "A changed body")
    // Well signed but malformed: each is re-signed after the change.
    func resigned(_ change: (inout Data) -> Void) -> Data {
      var data = pack.prefix(pack.count - 32)
      change(&data)
      return data + Data(SHA256.hash(data: data))
    }
    XCTAssertFalse(refused(resigned { _ in }))
    XCTAssertTrue(refused(resigned { $0[4] = 2 }), "Unknown version")
    XCTAssertTrue(refused(resigned { $0[6] = 3 }), "Unknown kind")
    XCTAssertTrue(refused(resigned { $0[7] = 1 }), "Reserved byte")
    XCTAssertTrue(refused(resigned { $0[24] = 1 }), "Reserved field")
    XCTAssertTrue(refused(resigned { $0[8] = 2 }), "Entry count")
  }

  func testEntriesFillTheDataSectionInOrder() throws {
    let entries: [OfflinePackBuilder.Entry] = [
      .init(name: "1/0/0", contentType: "application/x-protobuf", encoding: nil, body: Data("a".utf8)),
      .init(name: "1/1/0", contentType: "application/x-protobuf", encoding: nil, body: Data("b".utf8)),
    ]
    XCTAssertNoThrow(
      try OfflinePackFormat.verify(
        write(OfflinePackBuilder.build(.tiles, entries)),
        bytes: OfflinePackBuilder.build(.tiles, entries).count, kind: .tiles))
    let overlapping = OfflinePackBuilder.build(.tiles, entries, offsets: [0, 0])
    XCTAssertThrowsError(
      try OfflinePackFormat.verify(write(overlapping), bytes: overlapping.count, kind: .tiles))
    let duplicate = OfflinePackBuilder.build(.tiles, [entries[0], entries[0]])
    XCTAssertThrowsError(
      try OfflinePackFormat.verify(write(duplicate), bytes: duplicate.count, kind: .tiles))
  }

  func testTileAddressesAndBands() throws {
    XCTAssertEqual(OfflineTileID(name: "12/2005/1544"), OfflineTileID(z: 12, x: 2005, y: 1544))
    for name in ["12/02005/1544", "1/2/0", "12/2005", "a/b/c", "23/0/0", "12/2005/1544/"] {
      XCTAssertNil(OfflineTileID(name: name), name)
    }
    XCTAssertEqual(
      OfflineTileID(z: 17, x: 64_178, y: 49_413).ancestor(at: 16),
      OfflineTileID(z: 16, x: 32_089, y: 24_706))
    XCTAssertEqual((0...22).map(OfflinePackBand.anchor(of:)), [
      0, 0, 0, 0, 0, 0, 0, 7, 7, 7, 7, 11, 11, 11, 11, 11, 16, 16, 16, 16, 16, 21, 21,
    ])
    XCTAssertEqual(OfflinePackBand.zooms(anchor: 11), 11...15)
    XCTAssertEqual(OfflinePackBand.zooms(anchor: 21), 21...22)
    XCTAssertNil(OfflinePackBand.zooms(anchor: 12))

    let template = try XCTUnwrap(
      OfflineTileTemplate("https://api.tileflow.test/tiles/world/2026-10/{z}/{x}/{y}.pbf?map=m"))
    let url = "https://api.tileflow.test/tiles/world/2026-10/12/2005/1544.pbf?map=m"
    XCTAssertEqual(template.url(OfflineTileID(z: 12, x: 2005, y: 1544))?.absoluteString, url)
    XCTAssertEqual(template.tile(url), OfflineTileID(z: 12, x: 2005, y: 1544))
    XCTAssertNil(template.tile(url + "&x=1"))
    XCTAssertNil(template.tile("https://api.tileflow.test/tiles/world/2026-10/12/5000/1544.pbf?map=m"))
    XCTAssertNil(OfflineTileTemplate("https://a.test/{z}{x}/{y}"), "Adjacent placeholders")
    XCTAssertNil(OfflineTileTemplate("https://a.test/{z}/{x}"), "No {y}")
    XCTAssertEqual(
      OfflineTileTemplate("https://a.test/t?y={y}&x={x}&z={z}")?.tile("https://a.test/t?y=3&x=2&z=4"),
      OfflineTileID(z: 4, x: 2, y: 3))
  }

  /// The service's own packs, generated by its code for two releases: downloaded, verified, served
  /// in place, and updated with only the changed packs transferred.
  func testThePlatformsPacksDownloadServeAndUpdate() async throws {
    let service = OfflinePlatformFixture()
    let index = OfflineServingIndex()
    let store = TileflowOfflineStore(
      dependencies: OfflineStoreCore.Dependencies(
        layout: OfflineLayout(root: directory.appendingPathComponent("store", isDirectory: true)),
        cache: ResourceCacheStore(
          ambientRoot: directory.appendingPathComponent("ambient", isDirectory: true),
          durableRoot: directory.appendingPathComponent("durable", isDirectory: true),
          maximumBytes: 1 << 24),
        fetcher: service,
        client: {
          try OfflinePackClient(
            configuration: TileflowConfiguration(
              apiOrigin: URL(string: "https://api.tileflow.test")!,
              mapCredential: TileflowCredential("tf_public_" + String(repeating: "c", count: 48))),
            transport: service, now: { OfflinePlatformFixture.now })
        }, availableBytes: { nil }, index: index, reserveBytes: 4096,
        now: { OfflinePlatformFixture.now }))
    let options = TileflowOfflineRegionLoadOptions(
      geometry: .boundingBox(
        TileflowBoundingBox(west: -3.71, south: 40.41, east: -3.69, north: 40.425)),
      content: .hosted(mapID: OfflinePlatformFixture.mapID, themes: ["default"]), minZoom: 10,
      maxZoom: 14)
    try await store.loadRegion(id: "fixture", options: options)
    let done = try await waitFor(store, "fixture") { $0.state == .complete }
    XCTAssertEqual(done.requiredPackCount, 9)
    XCTAssertEqual(done.completedPackCount, 9)
    XCTAssertEqual(done.requiredResourceCount, 25)
    XCTAssertEqual(done.billableResourceCount, 23)
    XCTAssertEqual(service.downloads.filter { $0.status == 200 }.count, 10, "Nine packs, discovery")

    // Every entry of every pack answers as the route serves it, decoded.
    let scope = ResourceCacheScope.grant(
      apiOrigin: URL(string: "https://api.tileflow.test")!, mapID: OfflinePlatformFixture.mapID)
    let cache = ResourceCacheStore(
      ambientRoot: directory.appendingPathComponent("ambient", isDirectory: true),
      durableRoot: directory.appendingPathComponent("durable", isDirectory: true),
      maximumBytes: 1 << 24)
    let manifest = try service.manifest(release: 1)
    var held = Set<String>()
    for pack in try service.packs(release: 1) {
      let file = packFixture(pack.file)
      let entries = try OfflinePackFormat.index(file)
      for entry in entries.entries.values {
        let raw = try OfflinePackFormat.body(entry, in: file)
        var address = entry.name
        if entries.kind == .tiles, let tile = OfflineTileID(name: entry.name),
          let source = manifest.sources.first(where: { pack.id.hasPrefix("tiles/\($0.source)/") })
        {
          address = source.template.url(tile)!.absoluteString
          held.insert("\(source.source)/\(tile.name)")
        }
        let served = await index.resource(
          ResourceCacheKey(url: URL(string: address)!, scope: scope), cache: cache)
        XCTAssertEqual(served?.metadata.status, 200, address)
        XCTAssertEqual(
          served?.body, entry.contentEncoding == "gzip" ? try OfflinePackFormat.gunzip(raw) : raw,
          address)
      }
    }
    // The World tile the archive does not store, and Terrain inside the region above the zoom the
    // download stops at, answer as online; outside the region nothing is known.
    let world = try XCTUnwrap(manifest.source("world"))
    let terrain = try XCTUnwrap(manifest.source("terrain"))
    let cover = OfflineTileCover(manifest.region, zoom: 13)
    var unstored: [OfflineTileID] = []
    for y in cover.rows! {
      for xs in cover.row(y) {
        for x in xs where !held.contains("world/13/\(x)/\(y)") {
          unstored.append(OfflineTileID(z: 13, x: x, y: y))
        }
      }
    }
    XCTAssertFalse(unstored.isEmpty, "The archive does not store every covered tile")
    let deep = OfflineTileCover(manifest.region, zoom: 14)
    let inside = OfflineTileID(z: 14, x: deep.row(deep.rows!.lowerBound)[0].lowerBound, y: deep.rows!.lowerBound)
    for url in [world.template.url(unstored[0])!, terrain.template.url(inside)!] {
      let answer = await index.resource(ResourceCacheKey(url: url, scope: scope), cache: cache)
      XCTAssertEqual(answer?.metadata.status, 404, url.absoluteString)
      XCTAssertEqual(answer?.body, Data())
    }
    let outside = await index.resource(
      ResourceCacheKey(url: terrain.template.url(.init(z: 14, x: 0, y: 0))!, scope: scope),
      cache: cache)
    XCTAssertNil(outside)

    // A new World release: Terrain's packs are kept without asking, every other pack is asked for
    // with its digest, and only the changed ones transfer.
    let before = service.downloads.count
    service.release = 2
    try await store.loadRegion(id: "fixture", options: options)
    let updated = try await waitFor(store, "fixture") {
      $0.state == .complete && $0.loadedResourceCount < $0.requiredResourceCount
    }
    XCTAssertEqual(updated.completedPackCount, 9)
    let asked = service.downloads.dropFirst(before).filter { $0.url.hasSuffix(".tfpack") }
    XCTAssertFalse(asked.contains { $0.url.contains("/tiles/terrain/") }, "Terrain did not change")
    let first = Dictionary(try service.packs(release: 1).map { ($0.id, $0.etag) }) { a, _ in a }
    var changed = Set<String>()
    for pack in try service.packs(release: 2) where first[pack.id] != pack.etag {
      changed.insert(pack.url)
    }
    XCTAssertFalse(changed.isEmpty)
    XCTAssertEqual(Set(asked.filter { $0.status == 200 }.map(\.url)), changed)
    XCTAssertTrue(asked.filter { $0.status == 304 }.allSatisfy { $0.headers["If-None-Match"] != nil })
  }

  private func waitFor(
    _ store: TileflowOfflineStore, _ id: String,
    _ predicate: (TileflowOfflineRegion) -> Bool
  ) async throws -> TileflowOfflineRegion {
    let deadline = Date().addingTimeInterval(30)
    while Date() < deadline {
      if let region = await store.region(id: id), predicate(region) { return region }
      try await Task.sleep(nanoseconds: 5_000_000)
    }
    let region = await store.region(id: id)
    XCTFail("Timed out: \(String(describing: region))")
    throw CancellationError()
  }

  private func write(_ data: Data) -> URL {
    let file = directory.appendingPathComponent(UUID().uuidString)
    try! data.write(to: file)
    return file
  }
}

/// Builds packs in the service's format.
enum OfflinePackBuilder {
  struct Entry {
    let name: String
    let contentType: String
    let encoding: String?
    let body: Data
  }

  /// A pack of `entries`; `offsets` replaces the data offsets the index records.
  static func build(_ kind: OfflinePackKind, _ entries: [Entry], offsets: [UInt64]? = nil) -> Data
  {
    var index = Data()
    var data = Data()
    for (position, entry) in entries.enumerated() {
      let name = Data(entry.name.utf8)
      let type = Data(entry.contentType.utf8)
      let encoding = Data((entry.encoding ?? "").utf8)
      index += little(UInt64(name.count), 2) + name
      index += [UInt8(type.count)] + type
      index += [UInt8(encoding.count)] + encoding
      index += little(offsets?[position] ?? UInt64(data.count), 8)
      index += little(UInt64(entry.body.count), 4)
      data += entry.body
    }
    var pack = Data("TFPK".utf8) + little(1, 2) + [kind.rawValue, 0]
    pack += little(UInt64(entries.count), 4) + little(UInt64(index.count), 4)
    pack += little(UInt64(data.count), 8) + little(0, 8)
    pack += index + data
    return pack + Data(SHA256.hash(data: pack))
  }

  /// A gzip member holding `data`.
  static func gzip(_ data: Data) -> Data {
    var deflated = Data(count: data.count + 64)
    let size = deflated.withUnsafeMutableBytes { target in
      data.withUnsafeBytes { source in
        compression_encode_buffer(
          target.bindMemory(to: UInt8.self).baseAddress!, data.count + 64,
          source.bindMemory(to: UInt8.self).baseAddress!, data.count, nil, COMPRESSION_ZLIB)
      }
    }
    var member = Data([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3])
    member += deflated.prefix(size)
    member += little(UInt64(crc32(data)), 4) + little(UInt64(data.count), 4)
    return member
  }

  private static func little(_ value: UInt64, _ width: Int) -> Data {
    Data((0..<width).map { UInt8(truncatingIfNeeded: value >> (8 * $0)) })
  }

  private static func crc32(_ data: Data) -> UInt32 {
    var crc: UInt32 = 0xffff_ffff
    for byte in data {
      crc ^= UInt32(byte)
      for _ in 0..<8 { crc = crc & 1 == 1 ? (crc >> 1) ^ 0xedb8_8320 : crc >> 1 }
    }
    return ~crc
  }
}

extension Data {
  init?(hex: String) {
    var bytes: [UInt8] = []
    var index = hex.startIndex
    while index < hex.endIndex {
      let next = hex.index(index, offsetBy: 2)
      guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
      bytes.append(byte)
      index = next
    }
    self.init(bytes)
  }
}

/// The service's pack fixture as a service: its creation answer and packs for the current release,
/// with each pack's digest as `ETag` and `If-None-Match` answered with 304.
final class OfflinePlatformFixture: NativeHTTPTransporting, OfflineResourceFetching,
  @unchecked Sendable
{
  static let mapID = "map_offlinefixture00"
  /// The fixture's creation time.
  static let now = Date(timeIntervalSince1970: 1_793_361_600)

  struct Pack: Decodable {
    let id: String
    let url: String
    let file: String
    let bytes: Int
    let etag: String
  }

  struct Download {
    let url: String
    let headers: [String: String]
    let status: Int
  }

  private let state = LockedValue((release: 1, downloads: [Download]()))

  var release: Int {
    get { state.withLock { $0.release } }
    set { state.withLock { $0.release = newValue } }
  }
  var downloads: [Download] { state.withLock { $0.downloads } }

  func packs(release: Int) throws -> [Pack] {
    struct List: Decodable { let packs: [Pack] }
    return try JSONDecoder().decode(
      List.self, from: Data(contentsOf: packFixture("release-\(release)/packs.json"))
    ).packs
  }

  func manifest(release: Int) throws -> OfflineDownloadManifest {
    let request = try OfflinePackRequest.requests(
      mapID: Self.mapID, themes: ["default"],
      geometry: .boundingBox(
        TileflowBoundingBox(west: -3.71, south: 40.41, east: -3.69, north: 40.425)),
      zooms: OfflineZooms(range: 10...14))[0]
    return try OfflinePackContract.download(
      Data(contentsOf: packFixture("release-\(release)/create-response.json")), request: request,
      allowsLoopbackHTTP: false
    ).manifest
  }

  func send(_ request: URLRequest) async throws -> ResourcePayload {
    if request.url!.path.hasSuffix("/revalidate") {
      return ResourcePayload(
        bytes: Data(
          #"{"state":"current","checkedAt":"2026-10-30T12:00:00.000Z","intervalSeconds":86400}"#
            .utf8), status: 200, headers: [:])
    }
    return ResourcePayload(
      bytes: try Data(contentsOf: packFixture("release-\(release)/create-response.json")),
      status: 201, headers: [:])
  }

  func close() {}

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    let url = request.url.absoluteString
    var response: OfflineFetchResponse
    if let pack = try packs(release: release).first(where: { $0.url == url }) {
      let headers = ["ETag": pack.etag, "Content-Type": OfflinePackFormat.mediaType]
      if request.headers["If-None-Match"] == pack.etag {
        response = OfflineFetchResponse(
          status: 304, headers: headers, body: Data(), wireBytes: 0, wireSHA256: nil)
      } else {
        let destination = try XCTUnwrap(request.destination)
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.copyItem(at: packFixture(pack.file), to: destination)
        response = OfflineFetchResponse(
          status: 200, headers: headers, body: Data(), wireBytes: pack.bytes, wireSHA256: nil)
      }
    } else if url.hasSuffix("/mobile/manifest.json") {
      let body = Data("{}".utf8)
      response = OfflineFetchResponse(
        status: 200, headers: ["ETag": "\"\(DataChannel.digest(body))\""], body: body,
        wireBytes: body.count, wireSHA256: nil)
    } else {
      response = OfflineFetchResponse(
        status: 404, headers: [:], body: Data(), wireBytes: 0, wireSHA256: nil)
    }
    state.withLock {
      $0.downloads.append(Download(url: url, headers: request.headers, status: response.status))
    }
    return response
  }

  func cancel(prefix: String) {}
}
