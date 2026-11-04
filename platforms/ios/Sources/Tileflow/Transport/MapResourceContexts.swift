import Foundation

/// How one request of a native map ended, as the map's warnings and diagnostics see it. It never
/// holds a path, a query or a credential.
struct MapResourceOutcome: Sendable {
  let kind: TileflowResourceKind
  /// The scheme, host and port of the remote resource.
  let origin: String
  /// The status the transport answered, or nil when it failed without one.
  let status: Int?
  /// A failure the map reports as its own, such as an exhausted quota.
  let failure: TileflowMapError?
  /// What a World tile's response says about fair use.
  var fairUse: MapFairUseSignal? = nil
}

/// What a mounted native map answers its engine's requests with.
struct MapResourceRoute: Sendable {
  let loader: any ResourceLoading
  /// The kind of a remote resource, from the style document the map projected.
  let classify: @Sendable (URL) -> TileflowResourceKind
  let report: @Sendable (MapResourceOutcome) -> Void
}

/// The process's mounted native maps by context. MapLibre's network configuration is global to the
/// process, so each request finds its map through the context in its address
/// (``MapResourceAddress``); a retired context answers nothing.
final class MapResourceContexts: Sendable {
  static let shared = MapResourceContexts()

  private let routes = LockedValue<[String: MapResourceRoute]>([:])

  var activeCount: Int { routes.withLock { $0.count } }

  /// Registers a map's route under a new context.
  func register(_ route: MapResourceRoute) -> String {
    let context = MapResourceAddress.newContext()
    routes.withLock { $0[context] = route }
    return context
  }

  func retire(_ context: String) {
    routes.withLock { _ = $0.removeValue(forKey: context) }
  }

  func route(_ context: String) -> MapResourceRoute? {
    routes.withLock { $0[context] }
  }
}
