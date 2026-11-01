import Foundation
import Network
import UIKit

#if canImport(BackgroundTasks)
  import BackgroundTasks
#endif

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
/// themselves, and stored Hosted regions are revalidated, for free, at most once per the
/// service's interval while the app runs with a network: at launch, when the network returns,
/// when the app returns to the foreground and while it stays in use. Loading a region again
/// downloads only what changed, and ``setAutomaticUpdates(_:)`` lets the store do so by itself on
/// unmetered networks. A Hosted region expires 30 days after the service last confirmed access
/// and maps stop using it after 7 more days of grace, so a region whose access ended lapses then;
/// its files stay until it is removed, and a successful revalidation restores it.
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
      index: .shared, scheduler: OfflineBackgroundTaskScheduler(),
      conditions: { .current() }),
    monitorsNetwork: true)

  let core: OfflineStoreCore
  private let subscribers: OfflineSubscribers
  private let monitor: NWPathMonitor?
  /// Looks again whenever a region is due for revalidation, expires or ends its grace period.
  private let wakes: Task<Void, Never>?

  init(dependencies: OfflineStoreCore.Dependencies, monitorsNetwork: Bool = false) {
    let subscribers = OfflineSubscribers()
    self.subscribers = subscribers
    core = OfflineStoreCore(dependencies, subscribers: subscribers)
    guard monitorsNetwork else {
      monitor = nil
      wakes = nil
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
    wakes = Task { [core] in
      while !Task.isCancelled {
        let delay = await core.nextWake()
        try? await Task.sleep(nanoseconds: UInt64(max(1, delay) * 1_000_000_000))
        guard !Task.isCancelled else { return }
        await core.checkForUpdates()
      }
    }
    // The process's store lives as long as the app: the observer is never removed.
    _ = NotificationCenter.default.addObserver(
      forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil
    ) { _ in Task { await core.checkForUpdates() } }
  }

  deinit {
    monitor?.cancel()
    wakes?.cancel()
  }

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
  /// when `options` are unchanged apart from their metadata, which changes in place. Otherwise a
  /// new version downloads, sending each stored
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

  /// Replaces the region's metadata in place. Nothing downloads, and a download in progress
  /// continues; loading the region with options that differ only in metadata does the same.
  public func updateRegionMetadata(id: String, metadata: [String: String]) async throws {
    try await core.updateMetadata(id, metadata)
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

  /// Whether stored Hosted regions update by themselves. Off unless turned on with
  /// ``setAutomaticUpdates(_:)``; the choice is kept across launches.
  public var automaticUpdatesEnabled: Bool {
    get async { await core.automaticUpdatesEnabled() }
  }

  /// Turns automatic updates on or off for every stored Hosted region.
  ///
  /// Updates are manual by default, as with Mapbox: loading a region again downloads what changed.
  /// Turned on, the store revalidates stored regions about once a day and downloads each update
  /// the service reports, as loading the region again would, but only on Wi-Fi or another network
  /// that is neither expensive nor in Low Data Mode, and not in Low Power Mode. Only changed packs
  /// download, the stored version keeps serving until the update is complete, and region events
  /// and progress report the update as for a manual one. Each automatic update is billed like a
  /// manual one: map views for the billable resources of the changed packs.
  ///
  /// Updates run as a background app refresh task. List ``backgroundUpdateTaskIdentifier`` under
  /// `BGTaskSchedulerPermittedIdentifiers` in the app's Info.plist and call
  /// ``registerBackgroundTasks()`` before the app finishes launching; they also run when the
  /// network returns while the app is in use.
  ///
  /// - Throws: ``TileflowOfflineError`` with `invalidConfiguration` (reason
  ///   `backgroundTaskNotPermitted`) when the app does not list the task identifier; nothing changes.
  public func setAutomaticUpdates(_ enabled: Bool) async throws {
    try await core.setAutomaticUpdates(enabled)
  }

  /// The background task identifier automatic updates run under, which the app lists under
  /// `BGTaskSchedulerPermittedIdentifiers` in its Info.plist.
  public static let backgroundUpdateTaskIdentifier = OfflineBackgroundTaskScheduler.identifier

  /// Registers the background task that runs automatic updates. Call it once, before the app
  /// finishes launching, as `BGTaskScheduler` requires, with ``backgroundUpdateTaskIdentifier``
  /// listed in the app's Info.plist. A store whose automatic updates are on asks for its next run.
  public static func registerBackgroundTasks() {
    #if canImport(BackgroundTasks)
      BGTaskScheduler.shared.register(
        forTaskWithIdentifier: backgroundUpdateTaskIdentifier, using: nil
      ) { task in
        let run = Task { await shared.core.runScheduledUpdates() }
        task.expirationHandler = { run.cancel() }
        let completion = OfflineTaskCompletion(task: task)
        Task {
          await run.value
          completion.complete()
        }
      }
      Task {
        let core = shared.core
        if await core.automaticUpdatesEnabled() { try? await core.setAutomaticUpdates(true) }
      }
    #endif
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

#if canImport(BackgroundTasks)
  /// The system's task, completed once its run ends.
  private struct OfflineTaskCompletion: @unchecked Sendable {
    let task: BGTask
    func complete() { task.setTaskCompleted(success: true) }
  }
#endif

enum OfflineStorage {
  /// Whether `bytes` fit. The system's figure already counts space it can free; when it falls
  /// short, the map cache, which maps rebuild as they need, is cleared to make room before a
  /// download stops for lack of space.
  static func hasRoom(
    _ bytes: Int64, available: () -> Int64?, cache: ResourceCacheStore
  ) -> Bool {
    guard let free = available() else { return true }
    if free >= bytes { return true }
    guard cache.usage().bytes > 0 else { return false }
    cache.clear()
    cache.settle()
    return (available() ?? .max) >= bytes
  }

  /// Space available for data the app needs, as the system reports it for important usage, which
  /// includes purgeable space such as caches.
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
