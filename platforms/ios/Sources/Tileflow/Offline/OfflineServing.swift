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

  /// Whether a region whose access ended (`not_updatable`) is still served. On: the device keeps
  /// using what it downloaded until the region expires, and the region only stops updating. Off:
  /// its files stay on the device, untouched, and maps stop using them at once.
  static let servesRegionsAfterAccessEnds = true

  /// How long a Hosted region serves after the service last confirmed access to it, after Mapbox
  /// and MapTiler: it expires 30 days later and maps keep using it for 7 more days of grace. Only a
  /// successful revalidation or a new download confirms access, so a region whose access ended
  /// lapses this long after its last success. Self-hosted regions never expire.
  static let expiry = OfflineExpiryWindow(validity: 30 * 86_400, grace: 7 * 86_400)
}

/// A Hosted region's validity window, counted from the last time the service confirmed access.
struct OfflineExpiryWindow: Sendable, Hashable {
  var validity: TimeInterval
  var grace: TimeInterval

  func expiresAt(_ validatedAt: Date) -> Date { validatedAt.addingTimeInterval(validity) }

  func gracePeriodEndsAt(_ validatedAt: Date) -> Date {
    validatedAt.addingTimeInterval(validity + grace)
  }

  func phase(_ validatedAt: Date, at now: Date) -> OfflineExpiryPhase {
    if now < expiresAt(validatedAt) { return .valid }
    return now < gracePeriodEndsAt(validatedAt) ? .gracePeriod : .expired
  }
}

enum OfflineExpiryPhase: Sendable, Hashable {
  case valid
  case gracePeriod
  case expired
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
    self.init(id: id, text: text, href: href, regions: regions)
  }

  private init(id: String, text: String, href: String, regions: [[Double]]) {
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

  /// The regional credits of a download's attribution, one per credit: the same credit of two
  /// sources or two downloads keeps every box either names.
  static func credits(_ attribution: [JSONValue]) -> [OfflineCredit] {
    var credits: [OfflineCredit] = []
    for source in attribution {
      guard case .array(let items) = source["regionalObligations"] else { continue }
      merge(items.compactMap(OfflineCredit.init), into: &credits)
    }
    return credits
  }

  /// Adds credits to a list. A credit is its identifier and its exact text: Nautical's and
  /// Bathymetry's NOAA credits share an identifier and differ in text, and both show.
  static func merge(_ credits: [OfflineCredit], into list: inout [OfflineCredit]) {
    for credit in credits {
      guard let index = list.firstIndex(where: { $0.id == credit.id && $0.text == credit.text })
      else {
        list.append(credit)
        continue
      }
      let current = list[index]
      list[index] = OfflineCredit(
        id: current.id, text: current.text, href: current.href,
        regions: current.regions + credit.regions.filter { !current.regions.contains($0) })
    }
  }
}

/// A notice of a stored release that maps show wherever its data is: one of a source's
/// `obligations`, or the source's `page`, which holds its full notices online.
struct OfflineObligation: Sendable, Hashable {
  let id: String
  let text: String
  /// The page's address, for a source's page; nil for an obligation.
  let href: String?

  /// The obligations and then the page of each source of a download's attribution, each text
  /// once.
  static func obligations(_ attribution: [JSONValue]) -> [OfflineObligation] {
    var result: [OfflineObligation] = []
    for source in attribution {
      var items: [OfflineObligation] = []
      if case .array(let obligations) = source["obligations"] {
        for value in obligations {
          guard let id = value["id"]?.string, !id.isEmpty, id.count <= 192,
            let text = value["exact"]?.string, !text.isEmpty, text.utf16.count <= 65_536
          else { continue }
          items.append(OfflineObligation(id: id, text: text, href: nil))
        }
      }
      if let page = source["page"], let text = page["exact"]?.string, !text.isEmpty,
        text.utf16.count <= 65_536, let href = page["href"]?.string, href.hasPrefix("https://"),
        href.count <= 2048
      {
        items.append(OfflineObligation(id: "page", text: text, href: href))
      }
      merge(items, into: &result)
    }
    return result
  }

  static func merge(_ obligations: [OfflineObligation], into list: inout [OfflineObligation]) {
    for obligation in obligations where !list.contains(where: { $0.text == obligation.text }) {
      list.append(obligation)
    }
  }
}

/// The credits a Map's stored releases ask its maps to show: obligations and pages always,
/// regional credits while one of their boxes is in view.
struct OfflineSourceCredits: Sendable, Hashable {
  var regional: [OfflineCredit] = []
  var obligations: [OfflineObligation] = []
}

/// A source's stored tiles: the packs under each anchor, and the covers whose tiles a pack would
/// hold if the archive stored them.
struct OfflineServedTiles: Sendable {
  let template: OfflineTileTemplate
  var zooms: ClosedRange<Int>
  let absentStatus: Int
  var covers: [OfflineCover] = []
  var anchors: [OfflineTileID: [URL]] = [:]

  mutating func merge(_ other: OfflineServedTiles) {
    zooms = min(zooms.lowerBound, other.zooms.lowerBound)...max(
      zooms.upperBound, other.zooms.upperBound)
    for cover in other.covers where !covers.contains(cover) { covers.append(cover) }
    for (anchor, files) in other.anchors {
      anchors[anchor, default: []] += files.filter { !(anchors[anchor] ?? []).contains($0) }
    }
  }

  /// Whether the region downloaded `tile`, stored or not, or a tile above the downloaded zooms
  /// whose ancestor at the deepest one it downloaded.
  func covers(_ tile: OfflineTileID) -> Bool {
    let tile = tile.z > zooms.upperBound ? tile.ancestor(at: zooms.upperBound) : tile
    return zooms.contains(tile.z) && covers.contains { $0.contains(tile) }
  }
}

/// Document pack entries by address. Addresses compare with their percent-escapes in upper case:
/// MapLibre Native escapes a font stack's comma as `%2c`, while the platform names glyph entries
/// with `%2C`. Nothing else about an address is normalised.
struct OfflineServedDocuments: Sendable {
  private var entries: [String: (file: URL, entry: OfflinePackEntry)] = [:]

  subscript(url: String) -> (file: URL, entry: OfflinePackEntry)? {
    get { entries[Self.key(url)] }
    set { entries[Self.key(url)] = newValue }
  }

  var isEmpty: Bool { entries.isEmpty }

  mutating func merge(_ other: OfflineServedDocuments) {
    entries.merge(other.entries) { current, _ in current }
  }

  /// `url` with the hexadecimal digits of every percent-escape in upper case.
  static func key(_ url: String) -> String {
    guard url.contains("%") else { return url }
    var result = ""
    result.reserveCapacity(url.utf8.count)
    var characters = url[...]
    while let first = characters.first {
      characters = characters.dropFirst()
      result.append(first)
      guard first == "%", characters.count >= 2 else { continue }
      let digits = characters.prefix(2)
      guard digits.allSatisfy(\.isHexDigit) else { continue }
      result += digits.uppercased()
      characters = characters.dropFirst(2)
    }
    return result
  }
}

/// A Map's stored packs: its documents by address and its sources' tiles by template.
struct OfflineServedPacks: Sendable {
  var documents = OfflineServedDocuments()
  var tiles: [String: OfflineServedTiles] = [:]

  mutating func merge(_ other: OfflineServedPacks) {
    documents.merge(other.documents)
    for (template, served) in other.tiles {
      if tiles[template] == nil { tiles[template] = served } else { tiles[template]!.merge(served) }
    }
  }
}

/// What stored regions a map may use without a network: the cache paths of every available
/// region's resources, the packs of each Hosted Map and the credits of its releases.
struct OfflineServingSnapshot: Sendable {
  var paths: Set<String> = []
  /// Packs by the cache scope of the Map they belong to.
  var packs: [String: OfflineServedPacks] = [:]
  /// Regional credits by the cache scope of the Map they belong to.
  var credits: [String: [OfflineCredit]] = [:]
  /// Obligations and pages by the cache scope of the Map they belong to.
  var obligations: [String: [OfflineObligation]] = [:]
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
          OfflineCredit.merge(credits, into: &merged.credits[scope, default: []])
        }
        for (scope, obligations) in snapshot.obligations {
          OfflineObligation.merge(obligations, into: &merged.obligations[scope, default: []])
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
            protected: true, body: (0, ResourceDigest.sha256(Data()))), body: Data())
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
          "Content-Type": entry.contentType, "ETag": "\"\(ResourceDigest.sha256(raw))\"",
          "Cache-Control": "private, no-cache",
        ], responseTime: Date(), protected: true, body: (body.count, ResourceDigest.sha256(body))),
      body: body)
  }

  func credits(for scope: ResourceCacheScope) async -> [OfflineCredit] {
    await snapshot().credits[scope.directory] ?? []
  }

  /// The obligations and pages of the sources a Map's stored regions hold, which its maps show
  /// whatever they look at.
  func obligations(for scope: ResourceCacheScope) async -> [OfflineObligation] {
    await snapshot().obligations[scope.directory] ?? []
  }

  /// The zooms the regions a map may use store for the tile source with `template`, or nil when
  /// they store none. A map that opens from its packs starts a raster-dem source at the lowest of
  /// them, so the renderer asks for no ancestor tile the regions cannot hold.
  func storedZooms(template: String, scope: ResourceCacheScope) async -> ClosedRange<Int>? {
    await snapshot().packs[scope.directory]?.tiles[template]?.zooms
  }
}

/// Whether the device has a usable network path, as the system reports it. Until the first
/// report arrives, the network is assumed reachable, so a map starts its session as usual, and
/// metered, so nothing updates by itself.
final class OfflineReachability: Sendable {
  static let shared = OfflineReachability()

  private let state = LockedValue((satisfied: true, unmetered: false))
  private let monitor = NWPathMonitor()

  private init() {
    let state = state
    monitor.pathUpdateHandler = { path in
      let satisfied = path.status == .satisfied
      state.withLock { $0 = (satisfied, satisfied && !path.isExpensive && !path.isConstrained) }
    }
    monitor.start(queue: DispatchQueue(label: "dev.tileflow.reachability", qos: .utility))
  }

  var isReachable: Bool { state.withLock { $0.satisfied } }
  /// A path that is neither expensive, such as cellular, nor constrained by Low Data Mode.
  var isUnmetered: Bool { state.withLock { $0.unmetered } }
}
