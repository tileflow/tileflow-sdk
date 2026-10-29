import Foundation
import Network

/// Downloads regions for use without a network and keeps them on the device, after Mapbox's tile
/// store: estimate, load, list, observe, pause, resume, cancel and remove regions by identifier.
///
/// Hosted content downloads as Hosted offline packs with the configured map credential: the
/// service signs each pack's manifest, bills one map view per started 1,000 billable resources,
/// and limits each pack and each device to the plan's resources. Self-hosted content downloads a
/// style and its tiles as the style requests them, unbilled.
///
/// Resources are stored once per URL and shared by every region that lists them, in a partition
/// the system does not reclaim and ``TileflowMapCache/clear()`` does not touch; removing a region
/// releases only what no other region uses. Every body is checked against the pack's manifest
/// before it is stored, and a region is available only when all of it is stored. Updates keep
/// the stored version until the new one is complete.
///
/// Downloads continue in the background through a background `URLSession`. Forward the
/// application delegate's background events with
/// ``handleEventsForBackgroundURLSession(identifier:completionHandler:)``. Unfinished downloads
/// resume when the store is first used after launch, recoverable failures wait and continue by
/// themselves, and stored Hosted regions are checked for updates when the network returns and
/// at most once per the service's interval. Loading a region again downloads only what changed.
/// Access ending stops updates; it never deletes or locks what the device holds.
public final class TileflowOfflineStore: Sendable {
  /// The process's store, using ``Tileflow/configuration()`` for Hosted content.
  public static let shared: TileflowOfflineStore = TileflowOfflineStore(
    dependencies: OfflineStoreCore.Dependencies(
      layout: .shared, cache: .shared, fetcher: OfflineURLSessionFetcher.shared,
      client: {
        guard let configuration = try? Tileflow.configuration() else {
          throw TileflowOfflineError(.invalidConfiguration)
        }
        return try OfflinePackClient(configuration: configuration)
      },
      availableBytes: { OfflineStorage.availableBytes(at: OfflineLayout.shared.root) },
      index: .shared),
    monitorsNetwork: true)

  let core: OfflineStoreCore
  private let subscribers: OfflineSubscribers
  private let monitor: NWPathMonitor?

  init(dependencies: OfflineStoreCore.Dependencies, monitorsNetwork: Bool = false) {
    let subscribers = OfflineSubscribers()
    self.subscribers = subscribers
    core = OfflineStoreCore(dependencies, subscribers: subscribers)
    guard monitorsNetwork else {
      monitor = nil
      return
    }
    let monitor = NWPathMonitor()
    let core = core
    let connected = LockedValue(false)
    monitor.pathUpdateHandler = { path in
      let satisfied = path.status == .satisfied
      let reconnected = connected.withLock { value in
        defer { value = satisfied }
        return satisfied && !value
      }
      if reconnected { Task { await core.networkDidConnect() } }
    }
    monitor.start(queue: DispatchQueue(label: "dev.tileflow.offline.network", qos: .utility))
    self.monitor = monitor
  }

  deinit { monitor?.cancel() }

  /// What downloading the region would hold and cost. Hosted content creates its packs, which is
  /// free, and loading the same region soon after reuses them.
  public func estimateRegion(_ options: TileflowOfflineRegionLoadOptions) async throws
    -> TileflowOfflineRegionEstimate
  {
    try await core.estimate(options)
  }

  /// Starts downloading a region and returns as soon as it is recorded.
  ///
  /// A new identifier creates the region. An identifier whose download is unfinished resumes it
  /// when `options` are unchanged. Otherwise a new version downloads, sending each stored
  /// resource's `ETag` so unchanged resources are neither downloaded nor billed again, and
  /// replaces the stored version when complete.
  ///
  /// - Throws: ``TileflowOfflineError`` before anything downloads: invalid options, the
  ///   service's refusal to create a pack, or `deviceLimitExceeded` when the device would hold
  ///   more billable resources than the plan allows.
  @discardableResult
  public func loadRegion(id: String, options: TileflowOfflineRegionLoadOptions) async throws
    -> TileflowOfflineRegion
  {
    try await core.load(id, options)
  }

  /// Every region, oldest first.
  public func allRegions() async -> [TileflowOfflineRegion] {
    await core.regions()
  }

  public func region(id: String) async -> TileflowOfflineRegion? {
    await core.region(id)
  }

  /// Pauses the region's download until ``resumeRegion(id:)``. A stored version stays available.
  public func pauseRegion(id: String) async throws {
    try await core.pause(id)
  }

  /// Continues a paused, waiting or failed download.
  public func resumeRegion(id: String) async throws {
    try await core.resume(id)
  }

  /// Stops the region's download and discards what it downloaded. A region that never completed
  /// is removed; a region with a stored version keeps it.
  public func cancelRegion(id: String) async throws {
    try await core.cancel(id)
  }

  /// Removes the region and every stored resource no other region uses.
  public func removeRegion(id: String) async throws {
    try await core.remove(id)
  }

  /// Calls `handler` on a background queue, in order, for every region change until the
  /// subscription is cancelled or released.
  public func subscribe(_ handler: @escaping @Sendable (TileflowOfflineRegionEvent) -> Void)
    -> TileflowOfflineSubscription
  {
    subscribers.add(handler)
  }

  /// The background `URLSession` identifier the store downloads with.
  public static let backgroundSessionIdentifier = OfflineURLSessionFetcher.backgroundIdentifier

  /// Forwards `application(_:handleEventsForBackgroundURLSession:completionHandler:)`. Returns
  /// false, without calling `completionHandler`, for another session's identifier.
  @discardableResult
  public static func handleEventsForBackgroundURLSession(
    identifier: String, completionHandler: @escaping () -> Void
  ) -> Bool {
    guard identifier == backgroundSessionIdentifier else { return false }
    let completion = OfflineCompletion(call: completionHandler)
    OfflineURLSessionFetcher.shared.handleEvents { completion.call() }
    Task { await shared.core.open() }
    return true
  }
}

private struct OfflineCompletion: @unchecked Sendable {
  let call: () -> Void
}

enum OfflineStorage {
  /// Space available for data the app needs, as the system reports it for important usage.
  static func availableBytes(at url: URL) -> Int64? {
    var directory = url
    while !FileManager.default.fileExists(atPath: directory.path),
      directory.pathComponents.count > 1
    {
      directory.deleteLastPathComponent()
    }
    let values = try? directory.resourceValues(forKeys: [
      .volumeAvailableCapacityForImportantUsageKey
    ])
    return values?.volumeAvailableCapacityForImportantUsage
  }
}
