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

  /// The regional credits of a pack's World attribution.
  static func credits(_ attribution: [JSONValue]) -> [OfflineCredit] {
    var credits: [OfflineCredit] = []
    for source in attribution {
      guard case .array(let items) = source["regionalObligations"] else { continue }
      credits += items.compactMap(OfflineCredit.init)
    }
    return credits
  }
}

/// What stored regions a map may use without a network: the cache paths of every available
/// region's resources, and the regional credits of each Hosted Map's releases.
struct OfflineServingSnapshot: Sendable {
  var paths: Set<String> = []
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
