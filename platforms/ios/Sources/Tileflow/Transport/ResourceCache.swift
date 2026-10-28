import CryptoKit
import Foundation

/// What a cached resource is. Each class is its own partition on disk and in usage reports.
public enum TileflowResourceClass: String, CaseIterable, Codable, Sendable {
  /// Style documents and map metadata: manifests, style JSON and TileJSON.
  case style
  /// Vector, raster and elevation tiles.
  case tiles
  /// Glyph ranges and font files.
  case glyphs
  /// Sprite sheets and their indexes.
  case sprites
  /// 3D assets: glTF and GLB models and their textures.
  case models
  case other

  /// Classifies a resource by its URL alone, so a lookup always finds what a store placed.
  static func classify(_ url: URL) -> TileflowResourceClass {
    let path = url.path.lowercased()
    let name = url.lastPathComponent.lowercased()
    let ext = url.pathExtension.lowercased()
    if ["glb", "gltf", "ktx2", "basis", "b3dm"].contains(ext) || path.contains("/models/")
      || path.contains("/team-models/")
    {
      return .models
    }
    if ["woff2", "woff", "ttf", "otf"].contains(ext)
      || (ext == "pbf" && (path.contains("/fonts/") || path.contains("/glyphs/")))
    {
      return .glyphs
    }
    if name.hasPrefix("sprite"), ["json", "png"].contains(ext) { return .sprites }
    let parts = url.pathComponents.suffix(3)
    if parts.count == 3,
      zip(parts, [false, false, true]).allSatisfy({ part, last in
        let value = last ? (part as NSString).deletingPathExtension : part
        return !value.isEmpty && value.allSatisfy(\.isASCII) && value.allSatisfy(\.isNumber)
      })
    {
      return .tiles
    }
    return ext == "json" ? .style : .other
  }
}

/// Who may reuse a stored response.
enum ResourceCacheScope: Hashable, Sendable {
  /// Public resources: reusable by every map and every mount in the process.
  case shared
  /// Resources admitted with a Hosted grant: reusable only by maps of the same API origin and Map
  /// ID, and only after that map's session admits the request again. The identifier is a digest;
  /// grants and credentials never appear on disk.
  case grant(String)

  static func grant(apiOrigin: URL, mapID: String) -> ResourceCacheScope {
    let digest = DataChannel.digest(Data("\(ResourcePolicy.origin(apiOrigin))\n\(mapID)".utf8))
    return .grant(String(digest.prefix(32)))
  }

  var directory: String {
    switch self {
    case .shared: "shared"
    case .grant(let id): "grant-\(id)"
    }
  }
}

/// Which budget an entry belongs to.
enum ResourceCacheRetention: Sendable {
  /// The ambient cache: one size budget, least-recently-used eviction, cleared by
  /// ``TileflowMapCache/clear()``, and stored where the system may reclaim it.
  case ambient
  /// Kept until its owner removes it, such as the resources of an offline region. Eviction and
  /// ambient clearing never touch it, and it is stored where the system does not reclaim it.
  case pinned
}

/// The address of one stored response. Ambient and pinned stores use the same keys, so a pinned
/// entry answers exactly the requests an ambient one would.
struct ResourceCacheKey: Hashable, Sendable {
  let url: URL
  let scope: ResourceCacheScope
  let resourceClass: TileflowResourceClass
  /// SHA-256 of the absolute URL, in lowercase hexadecimal.
  let digest: String

  init(url: URL, scope: ResourceCacheScope) {
    self.url = url
    self.scope = scope
    resourceClass = .classify(url)
    digest = DataChannel.digest(Data(url.absoluteString.utf8))
  }

  /// `<scope>/<class>/<first two digest characters>/<digest>`.
  var relativePath: String {
    "\(scope.directory)/\(resourceClass.rawValue)/\(digest.prefix(2))/\(digest)"
  }
}

/// What is kept with a stored body. Times are milliseconds since 1970.
struct ResourceCacheMetadata: Codable, Equatable, Sendable {
  var url: String
  var status: Int
  var headers: [String: String]
  var responseTime: Int64
  var expires: Int64
  var staleLimit: Int64
  var bodyLength: Int
  var bodySHA256: String

  init(
    url: URL, status: Int, headers: [String: String], responseTime: Date, protected: Bool,
    body: (length: Int, sha256: String)
  ) {
    self.url = url.absoluteString
    self.status = status
    self.headers = ResourceCachePolicy.storable(headers)
    self.responseTime = Self.milliseconds(responseTime)
    let expiry = ResourceCachePolicy.expiry(
      headers: self.headers, responseTime: responseTime, protected: protected)
    expires = Self.milliseconds(expiry)
    staleLimit = Self.milliseconds(
      ResourceCachePolicy.staleLimit(headers: self.headers, expiry: expiry, protected: protected))
    bodyLength = body.length
    bodySHA256 = body.sha256
  }

  func isFresh(at date: Date) -> Bool { Self.milliseconds(date) < expires }
  func isUsableAfterNetworkFailure(at date: Date) -> Bool {
    Self.milliseconds(date) < staleLimit
  }

  static func milliseconds(_ date: Date) -> Int64 {
    Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
  }
}

/// A stored response, verified against its digest.
struct StoredResource: Sendable {
  let metadata: ResourceCacheMetadata
  let body: Data
}

/// The entry file format, shared by ambient and pinned stores:
///
///     body ‖ metadata JSON ‖ metadata length (UInt32, big-endian) ‖ format (UInt32, big-endian) ‖ "TFC1"
///
/// The trailer lets a streamed body be written once, front to back. Reading checks the magic,
/// format, lengths, URL and the body's SHA-256; any mismatch drops the entry.
enum ResourceCacheEntryFormat {
  static let magic = Data("TFC1".utf8)
  static let version: UInt32 = 1
  static let trailerLength = 12

  static func trailer(_ metadata: ResourceCacheMetadata) throws -> Data {
    let json = try JSONEncoder().encode(metadata)
    var trailer = json
    trailer.append(contentsOf: bigEndian(UInt32(json.count)))
    trailer.append(contentsOf: bigEndian(version))
    trailer.append(magic)
    return trailer
  }

  static func encode(_ metadata: ResourceCacheMetadata, body: Data) throws -> Data {
    var data = body
    data.append(try trailer(metadata))
    return data
  }

  static func decode(_ data: Data, expecting url: URL) throws -> StoredResource {
    let count = data.count
    guard count >= trailerLength,
      data.subdata(in: (count - 4)..<count) == magic,
      integer(data, at: count - 8) == version
    else { throw ResourceCacheError.corrupted }
    let metadataLength = Int(integer(data, at: count - 12))
    guard metadataLength > 0, metadataLength <= count - trailerLength else {
      throw ResourceCacheError.corrupted
    }
    let bodyLength = count - trailerLength - metadataLength
    guard
      let metadata = try? JSONDecoder().decode(
        ResourceCacheMetadata.self,
        from: data.subdata(in: bodyLength..<(bodyLength + metadataLength))),
      metadata.url == url.absoluteString, metadata.bodyLength == bodyLength
    else { throw ResourceCacheError.corrupted }
    let body = data.subdata(in: 0..<bodyLength)
    guard DataChannel.digest(body) == metadata.bodySHA256 else {
      throw ResourceCacheError.corrupted
    }
    return StoredResource(metadata: metadata, body: body)
  }

  private static func bigEndian(_ value: UInt32) -> [UInt8] {
    [
      UInt8(value >> 24 & 0xff), UInt8(value >> 16 & 0xff), UInt8(value >> 8 & 0xff),
      UInt8(value & 0xff),
    ]
  }

  private static func integer(_ data: Data, at offset: Int) -> UInt32 {
    let bytes = data.subdata(in: offset..<(offset + 4))
    return bytes.reduce(UInt32(0)) { $0 << 8 | UInt32($1) }
  }
}

enum ResourceCacheError: Error, Equatable {
  case corrupted
}

/// The process's resource cache on disk.
///
/// Layout. Ambient entries live under `<Caches>/dev.tileflow/resources-v1/`, which the system may
/// reclaim; pinned entries live under `<Application Support>/dev.tileflow/resources-v1/pinned/`,
/// excluded from backups. Both use `ResourceCacheKey.relativePath`:
///
///     shared/<class>/<aa>/<sha256(url)>         public resources
///     grant-<scope>/<class>/<aa>/<sha256(url)>  protected resources of one grant scope
///     staging/<store>/<uuid>                    partial writes; others' are removed on open
///
/// Entries are written to `staging/` and renamed into place, so a reader sees a whole entry or
/// none. Each file is self-describing (``ResourceCacheEntryFormat``); there is no separate journal
/// to fall out of step. A corrupted or mismatched entry is deleted when read.
///
/// Eviction. Ambient entries share one byte budget across every class and scope. When a write
/// takes the total above the budget, the least recently used entries are removed until the total
/// is at most 90% of it. An entry's last use is its file modification time, refreshed on every
/// read. Pinned entries are never evicted, never counted against the budget and never removed by
/// ambient clearing; their owner removes them with `removePinned(_:)`.
///
/// `no-store`. The transport never offers this store a response whose `Cache-Control` says
/// `no-store`, such as protected Hosted responses served with `private, no-store`.
final class ResourceCacheStore: @unchecked Sendable {
  struct Usage: Equatable, Sendable {
    var bytes: Int64 = 0
    var entries = 0
    var bytesByClass: [TileflowResourceClass: Int64] = [:]
  }

  private struct IndexEntry {
    var bytes: Int64
    var lastUse: Date
    let resourceClass: TileflowResourceClass
  }

  let ambientRoot: URL
  let durableRoot: URL
  private let lock = NSLock()
  private let maintenance = DispatchQueue(label: "dev.tileflow.resource-cache", qos: .utility)
  private let indexed = DispatchGroup()
  private let now: @Sendable () -> Date
  private var index: [String: IndexEntry] = [:]
  private var total: Int64 = 0
  private var budget: Int64
  private var generation = 0
  private var evictionScheduled = false
  private var dropped = 0
  private var directories: Set<String> = []
  private let stagingName = UUID().uuidString

  init(
    ambientRoot: URL, durableRoot: URL, maximumBytes: Int64,
    now: @escaping @Sendable () -> Date = { Date() }
  ) {
    self.ambientRoot = ambientRoot
    self.durableRoot = durableRoot
    budget = max(0, maximumBytes)
    self.now = now
    indexed.enter()
    maintenance.async { [self] in
      // Earlier processes' partial writes; this store's own staging directory stays.
      for root in [ambientRoot, durableRoot.appendingPathComponent("pinned")] {
        let staging = root.appendingPathComponent("staging")
        for name in (try? FileManager.default.contentsOfDirectory(atPath: staging.path)) ?? []
        where name != stagingName {
          try? FileManager.default.removeItem(at: staging.appendingPathComponent(name))
        }
      }
      try? FileManager.default.removeItem(at: ambientRoot.appendingPathComponent("trash"))
      let scanned = scan()
      lock.withLock {
        // Entries written during the scan are already indexed under the same paths.
        for (path, entry) in scanned where index[path] == nil {
          index[path] = entry
          total += entry.bytes
        }
      }
      indexed.leave()
      evictIfNeeded()
    }
  }

  /// The process-wide store used by every map.
  static let shared: ResourceCacheStore = {
    let files = FileManager.default
    let caches = files.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let support = files.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return ResourceCacheStore(
      ambientRoot: caches.appendingPathComponent("dev.tileflow/resources-v1", isDirectory: true),
      durableRoot: support.appendingPathComponent("dev.tileflow/resources-v1", isDirectory: true),
      maximumBytes: TileflowDeviceProfile.current.cacheBytes)
  }()

  var maximumBytes: Int64 {
    get { lock.withLock { budget } }
    set {
      lock.withLock { budget = max(0, newValue) }
      evictIfNeeded()
    }
  }

  /// Entries dropped because they failed verification since the store opened.
  var droppedEntries: Int { lock.withLock { dropped } }

  /// The largest body stored: one eighth of the budget, at most 16 MiB.
  var maximumEntryBytes: Int64 { lock.withLock { min(budget / 8, 16 * 1024 * 1024) } }

  func file(for key: ResourceCacheKey, retention: ResourceCacheRetention) -> URL {
    root(retention).appendingPathComponent(key.relativePath)
  }

  /// A verified stored response, or nil. Reading refreshes the entry's last use.
  func read(_ key: ResourceCacheKey, retention: ResourceCacheRetention) -> StoredResource? {
    let file = file(for: key, retention: retention)
    guard let data = try? Data(contentsOf: file, options: .mappedIfSafe) else { return nil }
    do {
      let stored = try ResourceCacheEntryFormat.decode(data, expecting: key.url)
      let date = now()
      if retention == .ambient {
        lock.withLock { index[key.relativePath]?.lastUse = date }
      }
      _ = try? FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: file.path)
      return stored
    } catch {
      remove(key, retention: retention)
      lock.withLock { dropped += 1 }
      return nil
    }
  }

  /// Starts writing an entry. The returned writer stores nothing until it commits.
  func writer(for key: ResourceCacheKey, retention: ResourceCacheRetention) -> ResourceCacheWriter?
  {
    let limit = retention == .pinned ? 16 * 1024 * 1024 : maximumEntryBytes
    guard limit > 0 else { return nil }
    let staging = root(retention).appendingPathComponent("staging/\(stagingName)", isDirectory: true)
    let file = staging.appendingPathComponent(UUID().uuidString)
    do {
      try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
      guard FileManager.default.createFile(atPath: file.path, contents: nil) else { return nil }
      let handle = try FileHandle(forWritingTo: file)
      return ResourceCacheWriter(
        store: self, key: key, retention: retention, staging: file, handle: handle,
        limit: Int(limit), generation: lock.withLock { generation })
    } catch {
      try? FileManager.default.removeItem(at: file)
      return nil
    }
  }

  /// Stores a whole response at once.
  @discardableResult
  func write(
    _ key: ResourceCacheKey, retention: ResourceCacheRetention, metadata: ResourceCacheMetadata,
    body: Data
  ) -> Bool {
    guard let writer = writer(for: key, retention: retention) else { return false }
    guard writer.append(body) else { return false }
    return writer.commit(metadata)
  }

  func remove(_ key: ResourceCacheKey, retention: ResourceCacheRetention) {
    try? FileManager.default.removeItem(at: file(for: key, retention: retention))
    guard retention == .ambient else { return }
    lock.withLock {
      if let entry = index.removeValue(forKey: key.relativePath) { total -= entry.bytes }
    }
  }

  /// Removes pinned entries. Their owner tracks which keys it holds.
  func removePinned(_ keys: some Sequence<ResourceCacheKey>) {
    for key in keys { remove(key, retention: .pinned) }
  }

  /// Removes ambient entries of one scope, or of every scope. Writes in flight are discarded.
  func clear(_ scope: ResourceCacheScope? = nil) {
    indexed.wait()
    let moved: [URL] = lock.withLock {
      generation += 1
      let prefix = scope.map { "\($0.directory)/" }
      for (path, entry) in index where prefix.map(path.hasPrefix) ?? true {
        index.removeValue(forKey: path)
        total -= entry.bytes
      }
      directories.removeAll()
      let names =
        scope.map { [$0.directory] }
        ?? ((try? FileManager.default.contentsOfDirectory(atPath: ambientRoot.path)) ?? [])
        .filter { $0 != "staging" && $0 != "trash" }
      let trash = ambientRoot.appendingPathComponent("trash", isDirectory: true)
      try? FileManager.default.createDirectory(at: trash, withIntermediateDirectories: true)
      return names.compactMap { name in
        let target = trash.appendingPathComponent(UUID().uuidString)
        do {
          try FileManager.default.moveItem(
            at: ambientRoot.appendingPathComponent(name), to: target)
          return target
        } catch { return nil }
      }
    }
    maintenance.async {
      for directory in moved { try? FileManager.default.removeItem(at: directory) }
    }
  }

  /// Ambient usage, once the store has indexed what earlier processes left on disk.
  func usage() -> Usage {
    indexed.wait()
    return lock.withLock {
      var usage = Usage(bytes: total, entries: index.count)
      for entry in index.values {
        usage.bytesByClass[entry.resourceClass, default: 0] += entry.bytes
      }
      return usage
    }
  }

  /// Waits until pending maintenance, such as indexing and eviction, has finished.
  func settle() {
    indexed.wait()
    maintenance.sync {}
  }

  fileprivate func commit(
    staging: URL, key: ResourceCacheKey, retention: ResourceCacheRetention, bytes: Int64,
    generation started: Int
  ) -> Bool {
    let target = file(for: key, retention: retention)
    let directory = target.deletingLastPathComponent()
    return lock.withLock {
      guard started == generation else { return false }
      do {
        if !directories.contains(directory.path) {
          try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
          if retention == .pinned { excludeFromBackup(durableRoot) }
          directories.insert(directory.path)
        }
        guard rename(staging.path, target.path) == 0 else { return false }
      } catch { return false }
      guard retention == .ambient else { return true }
      let previous = index.updateValue(
        IndexEntry(bytes: bytes, lastUse: now(), resourceClass: key.resourceClass),
        forKey: key.relativePath)
      total += bytes - (previous?.bytes ?? 0)
      return true
    }
  }

  private func root(_ retention: ResourceCacheRetention) -> URL {
    retention == .ambient ? ambientRoot : durableRoot.appendingPathComponent("pinned")
  }

  private func excludeFromBackup(_ url: URL) {
    var url = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }

  private func scan() -> [String: IndexEntry] {
    var result: [String: IndexEntry] = [:]
    let keys: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
    guard
      let enumerator = FileManager.default.enumerator(
        at: ambientRoot, includingPropertiesForKeys: keys)
    else { return result }
    let base = ambientRoot.standardizedFileURL.path + "/"
    for case let file as URL in enumerator {
      guard let values = try? file.resourceValues(forKeys: Set(keys)),
        values.isRegularFile == true
      else { continue }
      let path = String(file.standardizedFileURL.path.dropFirst(base.count))
      let parts = path.split(separator: "/")
      guard parts.count == 4, parts[0] != "staging", parts[0] != "trash",
        let resourceClass = TileflowResourceClass(rawValue: String(parts[1]))
      else { continue }
      result[path] = IndexEntry(
        bytes: Int64(values.fileSize ?? 0), lastUse: values.contentModificationDate ?? .distantPast,
        resourceClass: resourceClass)
    }
    return result
  }

  private func evictIfNeeded() {
    let schedule = lock.withLock {
      guard total > budget, !evictionScheduled else { return false }
      evictionScheduled = true
      return true
    }
    guard schedule else { return }
    maintenance.async { [self] in
      indexed.wait()
      let victims: [String] = lock.withLock {
        evictionScheduled = false
        guard total > budget else { return [] }
        let target = budget / 10 * 9
        var removed: [String] = []
        for (path, entry) in index.sorted(by: { $0.value.lastUse < $1.value.lastUse }) {
          guard total > target else { break }
          index.removeValue(forKey: path)
          total -= entry.bytes
          removed.append(path)
        }
        return removed
      }
      for path in victims {
        try? FileManager.default.removeItem(at: ambientRoot.appendingPathComponent(path))
      }
    }
  }

  fileprivate func scheduleEviction() { evictIfNeeded() }
}

/// Streams one entry into staging. Commit verifies nothing was lost and renames it into place;
/// any failure, oversize body or concurrent clear discards it.
final class ResourceCacheWriter: @unchecked Sendable {
  private let store: ResourceCacheStore
  private let key: ResourceCacheKey
  private let retention: ResourceCacheRetention
  private let staging: URL
  private let handle: FileHandle
  private let limit: Int
  private let generation: Int
  private let lock = NSLock()
  private var hasher = SHA256()
  private var length = 0
  private var finished = false

  fileprivate init(
    store: ResourceCacheStore, key: ResourceCacheKey, retention: ResourceCacheRetention,
    staging: URL, handle: FileHandle, limit: Int, generation: Int
  ) {
    self.store = store
    self.key = key
    self.retention = retention
    self.staging = staging
    self.handle = handle
    self.limit = limit
    self.generation = generation
  }

  deinit { abort() }

  /// Appends body bytes. Returns false once the entry has been abandoned.
  @discardableResult
  func append(_ chunk: Data) -> Bool {
    lock.withLock {
      guard !finished else { return false }
      guard length + chunk.count <= limit else {
        discard()
        return false
      }
      do {
        try handle.write(contentsOf: chunk)
        hasher.update(data: chunk)
        length += chunk.count
        return true
      } catch {
        discard()
        return false
      }
    }
  }

  /// The body's length and SHA-256 so far.
  var body: (length: Int, sha256: String) {
    lock.withLock {
      (length, hasher.finalize().map { String(format: "%02x", $0) }.joined())
    }
  }

  /// Writes the trailer and publishes the entry. `metadata` must describe the appended body.
  @discardableResult
  func commit(_ metadata: ResourceCacheMetadata) -> Bool {
    let ready: Bool = lock.withLock {
      guard !finished else { return false }
      finished = true
      let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
      guard metadata.bodyLength == length, metadata.bodySHA256 == digest,
        (try? handle.write(contentsOf: ResourceCacheEntryFormat.trailer(metadata))) != nil,
        (try? handle.close()) != nil
      else {
        try? handle.close()
        try? FileManager.default.removeItem(at: staging)
        return false
      }
      return true
    }
    guard ready else { return false }
    let bytes = Int64(
      (try? FileManager.default.attributesOfItem(atPath: staging.path)[.size] as? Int) ?? 0)
    guard
      store.commit(
        staging: staging, key: key, retention: retention, bytes: bytes, generation: generation)
    else {
      try? FileManager.default.removeItem(at: staging)
      return false
    }
    store.scheduleEviction()
    return true
  }

  func abort() { lock.withLock { discard() } }

  private func discard() {
    guard !finished else { return }
    finished = true
    try? handle.close()
    try? FileManager.default.removeItem(at: staging)
  }
}
