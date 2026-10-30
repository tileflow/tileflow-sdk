import Foundation
import Network

/// When maps use downloaded regions. Every decision about serving offline content is made here, so
/// a change of policy changes one place.
enum OfflineServingRule {
  /// Whether a Hosted map serves its protected resources from its stored packs instead of its
  /// session. With a network, the map starts its normal session, billed as any other, and the
  /// packs only save downloads; without one, or with the network switched off, it opens from the
  /// packs without a session, and nothing is billed.
  static func hostedUsesPacks(networkEnabled: Bool, reachable: Bool) -> Bool {
    !networkEnabled || !reachable
  }

  /// Whether a region whose access ended (`not_updatable`) is still served. Off: its files stay on
  /// the device, untouched, and maps stop using them.
  static let servesRegionsAfterAccessEnds = false
}

/// A regional credit of a stored release: shown while one of its boxes is in view.
struct OfflineCredit: Sendable, Hashable {
  let id: String
  let text: String
  let href: String
  /// `[west, south, east, north]` boxes that touch the pack's region.
  let regions: [[Double]]

  init?(_ value: JSONValue) {
    guard let id = value["id"]?.string, !id.isEmpty, id.count <= 192,
      let text = value["exact"]?.string, !text.isEmpty, text.count <= 1024,
      let href = value["href"]?.string, href.hasPrefix("https://"), href.count <= 2048,
      case .array(let boxes) = value["regions"]
    else { return nil }
    var regions: [[Double]] = []
    for box in boxes.prefix(256) {
      guard case .array(let items) = box, items.count == 4 else { return nil }
      let numbers = items.compactMap(\.number)
      guard numbers.count == 4, numbers.allSatisfy(\.isFinite), numbers[0] < numbers[2],
        numbers[1] < numbers[3]
      else { return nil }
      regions.append(numbers)
    }
    guard !regions.isEmpty else { return nil }
    self.id = id
    self.text = text
    self.href = href
    self.regions = regions
  }

  /// The renderer's form: `{id, text, href, regions}`.
  var wireValue: JSONValue {
    .object([
      "id": .string(id), "text": .string(text), "href": .string(href),
      "regions": .array(regions.map { .array($0.map(JSONValue.number)) }),
    ])
  }

  /// The regional credits of a download's World attribution.
  static func credits(_ attribution: [JSONValue]) -> [OfflineCredit] {
    var credits: [OfflineCredit] = []
    for source in attribution {
      guard case .array(let items) = source["regionalObligations"] else { continue }
      credits += items.compactMap(OfflineCredit.init)
    }
    return credits
  }
}

/// A source's stored tiles: the packs under each anchor, and the covers whose tiles a pack would
/// hold if the archive stored them.
struct OfflineServedTiles: Sendable {
  let template: OfflineTileTemplate
  var zooms: ClosedRange<Int>
  let absentStatus: Int
  var regions: [OfflinePackRegion] = []
  var anchors: [OfflineTileID: [URL]] = [:]

  mutating func merge(_ other: OfflineServedTiles) {
    zooms = min(zooms.lowerBound, other.zooms.lowerBound)...max(
      zooms.upperBound, other.zooms.upperBound)
    for region in other.regions where !regions.contains(region) { regions.append(region) }
    for (anchor, files) in other.anchors {
      anchors[anchor, default: []] += files.filter { !(anchors[anchor] ?? []).contains($0) }
    }
  }

  /// Whether the region downloaded `tile`, stored or not, or a tile above the downloaded zooms
  /// whose ancestor at the deepest one it downloaded.
  func covers(_ tile: OfflineTileID) -> Bool {
    let tile = tile.z > zooms.upperBound ? tile.ancestor(at: zooms.upperBound) : tile
    return zooms.contains(tile.z)
      && regions.contains { OfflineTileCover($0, zoom: tile.z).contains(x: tile.x, y: tile.y) }
  }
}

/// A Map's stored packs: its documents by address and its sources' tiles by template.
struct OfflineServedPacks: Sendable {
  var documents: [String: (file: URL, entry: OfflinePackEntry)] = [:]
  var tiles: [String: OfflineServedTiles] = [:]

  mutating func merge(_ other: OfflineServedPacks) {
    documents.merge(other.documents) { current, _ in current }
    for (template, served) in other.tiles {
      if tiles[template] == nil { tiles[template] = served } else { tiles[template]!.merge(served) }
    }
  }
}

/// What stored regions a map may use without a network: the cache paths of every available
/// region's resources, the packs of each Hosted Map and the regional credits of its releases.
struct OfflineServingSnapshot: Sendable {
  var paths: Set<String> = []
  /// Packs by the cache scope of the Map they belong to.
  var packs: [String: OfflineServedPacks] = [:]
  /// Credits by the cache scope of the Map they belong to.
  var credits: [String: [OfflineCredit]] = [:]
}

/// The process's view of stored regions for the transport. Each store publishes what it holds
/// whenever a region becomes available, changes or goes, and maps see every store's regions; a
/// map reads it without waiting for the network.
final class OfflineServingIndex: Sendable {
  static let shared: OfflineServingIndex = OfflineServingIndex {
    await TileflowOfflineStore.shared.core.open()
  }

  private struct State {
    var stores: [ObjectIdentifier: OfflineServingSnapshot] = [:]
    var merged = OfflineServingSnapshot()
  }

  private let state = LockedValue<State?>(nil)
  /// Indexes of packs read recently: reading one is a few file reads.
  private let indexes = LockedValue<[URL: OfflinePackIndex]>([:])
  private let open: @Sendable () async -> Void

  init(open: @escaping @Sendable () async -> Void = {}) {
    self.open = open
  }

  /// Replaces what `store` publishes.
  func publish(_ snapshot: OfflineServingSnapshot, from store: AnyObject) {
    state.withLock { value in
      var current = value ?? State()
      current.stores[ObjectIdentifier(store)] = snapshot
      var merged = OfflineServingSnapshot()
      for snapshot in current.stores.values {
        merged.paths.formUnion(snapshot.paths)
        for (scope, packs) in snapshot.packs { merged.packs[scope, default: .init()].merge(packs) }
        for (scope, credits) in snapshot.credits {
          var list = merged.credits[scope] ?? []
          for credit in credits where !list.contains(where: { $0.id == credit.id }) {
            list.append(credit)
          }
          merged.credits[scope] = list
        }
      }
      current.merged = merged
      value = current
    }
  }

  /// The current snapshot, once a store has read its records.
  func snapshot() async -> OfflineServingSnapshot {
    if let snapshot = state.withLock({ $0?.merged }) { return snapshot }
    await open()
    return state.withLock { $0?.merged } ?? OfflineServingSnapshot()
  }

  func serves(_ key: ResourceCacheKey) async -> Bool {
    await snapshot().paths.contains(key.relativePath)
  }

  /// A stored region's answer for `key`: its pinned entry, a pack entry, or the status the source
  /// answers online for a tile it does not store. That status answers a tile the region covers
  /// that no stored pack holds, and a tile inside the region above the zooms it downloaded, so the
  /// renderer overzooms the deepest downloaded tile, as it does online where a tile does not
  /// exist. Only a resource the region should hold and does not is a miss.
  func resource(_ key: ResourceCacheKey, cache: ResourceCacheStore) async -> StoredResource? {
    let snapshot = await snapshot()
    if snapshot.paths.contains(key.relativePath) { return cache.read(key, retention: .pinned) }
    guard let packs = snapshot.packs[key.scope.directory] else { return nil }
    let url = key.url.absoluteString
    if let served = packs.documents[url] {
      return stored(served.entry, in: served.file, url: key.url)
    }
    for tiles in packs.tiles.values {
      guard let tile = tiles.template.tile(url), tile.z >= tiles.zooms.lowerBound else { continue }
      let anchor = tile.ancestor(at: OfflinePackBand.anchor(of: tile.z))
      for file in tiles.zooms.contains(tile.z) ? tiles.anchors[anchor] ?? [] : [] {
        if let entry = index(file)?.entries[tile.name] {
          return stored(entry, in: file, url: key.url)
        }
      }
      if tiles.covers(tile) {
        return StoredResource(
          metadata: ResourceCacheMetadata(
            url: key.url, status: tiles.absentStatus, headers: [:], responseTime: Date(),
            protected: true, body: (0, DataChannel.digest(Data()))), body: Data())
      }
    }
    return nil
  }

  private func index(_ file: URL) -> OfflinePackIndex? {
    if let index = indexes.withLock({ $0[file] }) { return index }
    guard let index = try? OfflinePackFormat.index(file) else { return nil }
    indexes.withLock { cached in
      if cached.count >= 256 { cached.removeAll() }
      cached[file] = index
    }
    return index
  }

  /// A pack entry as the renderer receives it: decoded, with its route's `ETag`, which names the
  /// body as stored, so a map online can revalidate it instead of downloading it again.
  private func stored(_ entry: OfflinePackEntry, in file: URL, url: URL) -> StoredResource? {
    guard let raw = try? OfflinePackFormat.body(entry, in: file) else { return nil }
    let body: Data
    switch entry.contentEncoding {
    case nil: body = raw
    case "gzip":
      guard let decoded = try? OfflinePackFormat.gunzip(raw) else { return nil }
      body = decoded
    default: return nil
    }
    return StoredResource(
      metadata: ResourceCacheMetadata(
        url: url, status: 200,
        headers: [
          "Content-Type": entry.contentType, "ETag": "\"\(DataChannel.digest(raw))\"",
          "Cache-Control": "private, no-cache",
        ], responseTime: Date(), protected: true, body: (body.count, DataChannel.digest(body))),
      body: body)
  }

  func credits(for scope: ResourceCacheScope) async -> [OfflineCredit] {
    await snapshot().credits[scope.directory] ?? []
  }
}

/// Whether the device has a usable network path, as the system reports it. Until the first
/// report arrives, the network is assumed reachable, so a map starts its session as usual.
final class OfflineReachability: Sendable {
  static let shared = OfflineReachability()

  private let satisfied = LockedValue(true)
  private let monitor = NWPathMonitor()

  private init() {
    let satisfied = satisfied
    monitor.pathUpdateHandler = { path in satisfied.withLock { $0 = path.status == .satisfied } }
    monitor.start(queue: DispatchQueue(label: "dev.tileflow.reachability", qos: .utility))
  }

  var isReachable: Bool { satisfied.withLock { $0 } }
}
