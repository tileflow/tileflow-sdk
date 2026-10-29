import Foundation

/// Where the offline store keeps its records, beside the resource cache's durable root:
///
///     regions/<sha256(id)>/region.json        the region record, replaced atomically
///     regions/<sha256(id)>/v<n>/request-<i>.json, pack-<i>.json
///                                             a Hosted version's requests and created packs
///     regions/<sha256(id)>/v<n>/plan.json     a self-hosted version's resolved plan
///     regions/<sha256(id)>/v<n>/progress      `<digest> <bytes>` of each stored resource, appended
///     regions/<sha256(id)>/v<n>/staging/<digest>
///                                             changed bodies of resources the stored version uses,
///                                             committed when the update completes
///     downloads/                              finished background transfers awaiting verification
///
/// Resource bodies live in the resource cache's pinned partition under the transport's own keys.
/// A record lists its versions; every other file belongs to one of them, so a record that is
/// replaced atomically never refers to a half-written version.
struct OfflineLayout: Sendable {
  let root: URL

  static let shared: OfflineLayout = {
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[
      0]
    return OfflineLayout(
      root: support.appendingPathComponent("dev.tileflow/offline-v1", isDirectory: true))
  }()

  var regions: URL { root.appendingPathComponent("regions", isDirectory: true) }
  var downloads: URL { root.appendingPathComponent("downloads", isDirectory: true) }

  func region(_ id: String) -> URL {
    regions.appendingPathComponent(DataChannel.digest(Data(id.utf8)), isDirectory: true)
  }
  func record(_ id: String) -> URL { region(id).appendingPathComponent("region.json") }
  func version(_ id: String, _ number: Int) -> URL {
    region(id).appendingPathComponent("v\(number)", isDirectory: true)
  }
  func request(_ id: String, _ number: Int, pack: Int) -> URL {
    version(id, number).appendingPathComponent("request-\(pack).json")
  }
  func pack(_ id: String, _ number: Int, pack: Int) -> URL {
    version(id, number).appendingPathComponent("pack-\(pack).json")
  }
  func plan(_ id: String, _ number: Int) -> URL {
    version(id, number).appendingPathComponent("plan.json")
  }
  func progress(_ id: String, _ number: Int) -> URL {
    version(id, number).appendingPathComponent("progress")
  }
  func staging(_ id: String, _ number: Int) -> URL {
    version(id, number).appendingPathComponent("staging", isDirectory: true)
  }

  /// Writes a whole file through a temporary file and a rename, so readers see the old file or
  /// the new one. Files stay readable while the device is locked after its first unlock, which
  /// background downloads need, and are excluded from backups.
  static func write(_ data: Data, to url: URL) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    #if os(iOS)
      try data.write(
        to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    #else
      try data.write(to: url, options: .atomic)
    #endif
  }

  func excludeFromBackup() {
    var url = root
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    try? url.setResourceValues(values)
  }
}

/// A version's stored resources, one `<digest> <bytes>` line each, appended as resources complete.
/// A line cut short by a crash is ignored; its resource is requested again with `If-None-Match`.
final class OfflineProgressLog: @unchecked Sendable {
  private let url: URL
  private let lock = NSLock()
  private var handle: FileHandle?

  init(_ url: URL) { self.url = url }
  deinit { try? handle?.close() }

  /// Stored bytes by digest.
  static func read(_ url: URL) -> [String: Int64] {
    guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8)
    else { return [:] }
    var stored: [String: Int64] = [:]
    for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
      let parts = line.split(separator: " ")
      guard parts.count == 2, parts[0].count == 64, let bytes = Int64(parts[1]), bytes >= 0
      else { continue }
      stored[String(parts[0])] = bytes
    }
    return stored
  }

  static func write(_ stored: [String: Int64], to url: URL) throws {
    try OfflineLayout.write(Data(stored.map { "\($0.key) \($0.value)\n" }.joined().utf8), to: url)
  }

  func append(_ entries: [(digest: String, bytes: Int64)]) throws {
    guard !entries.isEmpty else { return }
    try lock.withLock {
      if handle == nil {
        if !FileManager.default.fileExists(atPath: url.path) {
          try OfflineLayout.write(Data(), to: url)
        }
        let opened = try FileHandle(forWritingTo: url)
        try opened.seekToEnd()
        handle = opened
      }
      // A line cut short by a crash is completed by the newline that starts the next batch.
      try handle?.write(
        contentsOf: Data(
          ("\n" + entries.map { "\($0.digest) \($0.bytes)" }.joined(separator: "\n") + "\n").utf8))
      try handle?.synchronize()
    }
  }

  func close() {
    lock.withLock {
      try? handle?.close()
      handle = nil
    }
  }
}

/// A stored error, with what the public error carries.
struct OfflineStoredError: Codable, Hashable, Sendable {
  var code: String
  var reason: String?
  var status: Int?
  var limit: Int?
  var retryAfter: Double?

  init(_ error: TileflowOfflineError) {
    code = error.code.rawValue
    reason = error.context.reason
    status = error.context.status
    limit = error.context.limit
    retryAfter = error.retryAfter
  }

  var error: TileflowOfflineError {
    TileflowOfflineError(
      TileflowOfflineError.Code(rawValue: code) ?? .invalidResponse,
      context: .init(reason: reason, status: status, limit: limit), retryAfter: retryAfter)
  }
}

/// One downloaded or downloading version of a region.
struct OfflineVersionRecord: Codable, Sendable {
  enum State: String, Codable, Sendable {
    case downloading, waiting, paused, failed, complete
  }

  var number: Int
  var options: JSONValue
  /// The API origin whose grant scope holds the version's protected resources.
  var apiOrigin: String?
  /// Hosted packs, as `request-<i>.json` and `pack-<i>.json`; zero for self-hosted content.
  var packs: Int
  var resources: Int
  var billable: Int
  var bytes: Int64?
  var state: State
  var error: OfflineStoredError?
  /// Milliseconds since 1970.
  var retryAt: Int64?
  var createdAt: Int64
  var completedAt: Int64?
}

/// What the last revalidation of a region found.
struct OfflineCheckRecord: Codable, Hashable, Sendable {
  /// `current`, `update_available` or `not_updatable`.
  var state: String
  var reason: String?
  var checkedAt: Int64
  var interval: Double
}

/// A region's record. `active` is the version the region serves, `pending` the one downloading and
/// `retired` a replaced version whose resources are still being released. `removing` marks a
/// removal in progress, which opening the store finishes.
struct OfflineRegionRecord: Codable, Sendable {
  var format = 1
  var id: String
  var createdAt: Int64
  var active: OfflineVersionRecord?
  var pending: OfflineVersionRecord?
  var retired: OfflineVersionRecord?
  var removing = false
  var check: OfflineCheckRecord?

  var versions: [OfflineVersionRecord] { [active, pending, retired].compactMap { $0 } }
  var nextVersion: Int { (versions.map(\.number).max() ?? 0) + 1 }

  static func read(_ url: URL) -> OfflineRegionRecord? {
    guard let data = try? Data(contentsOf: url),
      let record = try? JSONDecoder().decode(OfflineRegionRecord.self, from: data),
      record.format == 1
    else { return nil }
    return record
  }

  func write(_ url: URL) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    try OfflineLayout.write(encoder.encode(self), to: url)
  }
}

extension JSONValue {
  /// The value's canonical bytes, for comparing stored options.
  var canonical: Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return (try? encoder.encode(self)) ?? Data()
  }
}

extension Date {
  var offlineMilliseconds: Int64 { ResourceCacheMetadata.milliseconds(self) }
  init(offlineMilliseconds value: Int64) {
    self.init(timeIntervalSince1970: TimeInterval(value) / 1000)
  }
}

// MARK: - Options coding

extension TileflowOfflineRegionLoadOptions {
  var json: JSONValue {
    func positions(_ list: [TileflowPosition]) -> JSONValue {
      .array(list.map { .array([.number($0.longitude), .number($0.latitude)]) })
    }
    let geometry: JSONValue
    switch self.geometry {
    case .boundingBox(let box):
      geometry = .object([
        "type": .string("bbox"),
        "bbox": .array([box.west, box.south, box.east, box.north].map(JSONValue.number)),
      ])
    case .polygon(let ring):
      geometry = .object(["type": .string("polygon"), "coordinates": positions(ring)])
    case .corridor(let line, let width):
      geometry = .object([
        "type": .string("corridor"), "line": positions(line), "width": .number(width),
      ])
    }
    let content: JSONValue
    switch self.content {
    case .hosted(let mapID, let themes):
      content = .object([
        "type": .string("hosted"), "mapId": .string(mapID),
        "themes": .array(themes.map(JSONValue.string)),
      ])
    case .style(let url, let sources):
      content = .object([
        "type": .string("style"), "url": .string(url.absoluteString),
        "sources": .array(
          sources.map {
            .object([
              "id": .string($0.id), "template": .string($0.template),
              "minZoom": .number(Double($0.minZoom)), "maxZoom": .number(Double($0.maxZoom)),
            ])
          }),
      ])
    }
    return .object([
      "geometry": geometry, "content": content, "minZoom": .number(Double(minZoom)),
      "maxZoom": .number(Double(maxZoom)), "terrainMaxZoom": .number(Double(terrainMaxZoom)),
      "networkRestriction": .string(networkRestriction.rawValue),
      "metadata": .object(metadata.mapValues(JSONValue.string)),
    ])
  }

  init?(json value: JSONValue) {
    func positions(_ value: JSONValue?) -> [TileflowPosition]? {
      guard case .array(let items) = value else { return nil }
      let list = items.compactMap { item -> TileflowPosition? in
        guard case .array(let pair) = item, pair.count == 2, let x = pair[0].number,
          let y = pair[1].number
        else { return nil }
        return TileflowPosition(longitude: x, latitude: y)
      }
      return list.count == items.count ? list : nil
    }
    func int(_ key: String, in value: JSONValue?) -> Int? {
      value?[key]?.number.flatMap { Int(exactly: $0) }
    }
    let geometry: TileflowOfflineGeometry
    switch value["geometry"]?["type"]?.string {
    case "bbox":
      guard case .array(let box) = value["geometry"]?["bbox"], box.count == 4,
        let w = box[0].number, let s = box[1].number, let e = box[2].number, let n = box[3].number
      else { return nil }
      geometry = .boundingBox(TileflowBoundingBox(west: w, south: s, east: e, north: n))
    case "polygon":
      guard let ring = positions(value["geometry"]?["coordinates"]) else { return nil }
      geometry = .polygon(ring)
    case "corridor":
      guard let line = positions(value["geometry"]?["line"]),
        let width = value["geometry"]?["width"]?.number
      else { return nil }
      geometry = .corridor(line: line, width: width)
    default:
      return nil
    }
    let content: TileflowOfflineContent
    let item = value["content"]
    switch item?["type"]?.string {
    case "hosted":
      guard let mapID = item?["mapId"]?.string, case .array(let themes) = item?["themes"] else {
        return nil
      }
      content = .hosted(mapID: mapID, themes: themes.compactMap(\.string))
    case "style":
      guard let url = item?["url"]?.string.flatMap(URL.init(string:)),
        case .array(let sources) = item?["sources"]
      else { return nil }
      content = .style(
        url: url,
        sources: sources.compactMap { source in
          guard let id = source["id"]?.string, let template = source["template"]?.string,
            let low = int("minZoom", in: source), let high = int("maxZoom", in: source)
          else { return nil }
          return TileflowOfflineTileSource(id: id, template: template, minZoom: low, maxZoom: high)
        })
    default:
      return nil
    }
    guard let minZoom = int("minZoom", in: value), let maxZoom = int("maxZoom", in: value),
      let terrain = int("terrainMaxZoom", in: value),
      let restriction = value["networkRestriction"]?.string.flatMap(
        TileflowOfflineNetworkRestriction.init(rawValue:))
    else { return nil }
    var metadata: [String: String] = [:]
    if case .object(let entries) = value["metadata"] {
      for (key, entry) in entries { metadata[key] = entry.string }
    }
    self.init(
      geometry: geometry, content: content, minZoom: minZoom, maxZoom: maxZoom,
      terrainMaxZoom: terrain, networkRestriction: restriction, metadata: metadata)
  }
}

extension OfflinePackRequest {
  /// Reads a body this SDK wrote with ``body``.
  init?(json data: Data) {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      let mapID = value["mapId"]?.string, let profile = value["profile"]?.string,
      case .array(let themes) = value["themes"],
      let region = OfflinePackRegion(json: value["region"]),
      let minZoom = OfflinePackContract.integer(value["minZoom"], 0...OfflineZooms.maximum),
      let maxZoom = OfflinePackContract.integer(value["maxZoom"], 0...OfflineZooms.maximum),
      let terrain = OfflinePackContract.integer(
        value["terrainMaxZoom"], 0...OfflineZooms.maximum)
    else { return nil }
    self.init(
      mapID: mapID, profile: profile, themes: themes.compactMap(\.string), region: region,
      minZoom: minZoom, maxZoom: maxZoom, terrainMaxZoom: terrain)
  }
}
