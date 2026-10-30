import Foundation

/// Delivers region events in order on one queue.
final class OfflineSubscribers: Sendable {
  private let handlers = LockedValue<[UUID: @Sendable (TileflowOfflineRegionEvent) -> Void]>([:])
  private let queue = DispatchQueue(label: "dev.tileflow.offline.events")

  func add(_ handler: @escaping @Sendable (TileflowOfflineRegionEvent) -> Void)
    -> TileflowOfflineSubscription
  {
    let id = UUID()
    handlers.withLock { $0[id] = handler }
    return TileflowOfflineSubscription { [weak self] in
      _ = self?.handlers.withLock { $0.removeValue(forKey: id) }
    }
  }

  func emit(_ event: TileflowOfflineRegionEvent) {
    let current = Array(handlers.withLock { $0.values })
    guard !current.isEmpty else { return }
    queue.async { for handler in current { handler(event) } }
  }
}

/// The store's state and its one writer.
///
/// Records change only here. A version becomes the region's `active` version only when every
/// resource is stored and verified, by one atomic record replacement; resources are shared across
/// regions by cache key, and a key is released only when no region version references it. Each
/// multi-step change is recorded before it starts (`pending`, `retired`, `removing`) and finished
/// when the store opens again, so a crash never leaves an unreferenced or missing resource behind.
actor OfflineStoreCore {
  struct Dependencies: Sendable {
    var layout: OfflineLayout
    var cache: ResourceCacheStore
    var fetcher: any OfflineResourceFetching
    var client: @Sendable () throws -> OfflinePackClient
    var availableBytes: @Sendable () -> Int64?
    /// Where maps learn which stored regions they may use.
    var index: OfflineServingIndex? = nil
    /// Space a download leaves free on the device.
    var reserveBytes: Int64 = 64 * 1024 * 1024
    var concurrency = 64
    var now: @Sendable () -> Date = { Date() }
    var sleep: @Sendable (TimeInterval) async throws -> Void = {
      try await Task.sleep(nanoseconds: UInt64(max(0, $0) * 1_000_000_000))
    }
  }

  /// A created pack is reused while at least this much of its download window remains.
  static let reuseWindow: TimeInterval = 600
  /// Grants are renewed before their window ends.
  static let renewalMargin: TimeInterval = 300
  static let maximumBackoff: TimeInterval = 300
  static let maximumRenewals = 3

  let dependencies: Dependencies
  let subscribers: OfflineSubscribers
  private var layout: OfflineLayout { dependencies.layout }
  private var records: [String: OfflineRegionRecord] = [:]
  private var isOpen = false
  private var runs: [String: (token: UUID, task: Task<Void, Never>)] = [:]
  private var progress: [String: (count: Int, bytes: Int64)] = [:]
  private var plans: [String: OfflineVersionPlan] = [:]
  private var keySets: [String: (all: Set<String>, billable: Set<String>)] = [:]
  private var creditSets: [String: [String: [OfflineCredit]]] = [:]
  private var created: [OfflinePackRequest: OfflinePack] = [:]

  init(_ dependencies: Dependencies, subscribers: OfflineSubscribers) {
    self.dependencies = dependencies
    self.subscribers = subscribers
  }

  // MARK: Opening

  /// Reads the records, finishes interrupted removals and replacements, and resumes downloads.
  func open() {
    guard !isOpen else { return }
    isOpen = true
    layout.excludeFromBackup()
    let files = FileManager.default
    for name in (try? files.contentsOfDirectory(atPath: layout.regions.path)) ?? [] {
      let directory = layout.regions.appendingPathComponent(name, isDirectory: true)
      guard let record = OfflineRegionRecord.read(directory.appendingPathComponent("region.json"))
      else {
        // A region whose record was never written stored nothing.
        try? files.removeItem(at: directory)
        continue
      }
      records[record.id] = record
    }
    for id in records.keys.sorted() {
      guard let record = records[id] else { continue }
      if record.removing {
        finishRemoval(id)
        continue
      }
      if record.retired != nil { finishRetirement(id) }
      if let pending = record.pending {
        progress[id] = storedProgress(id, pending)
        if [.downloading, .waiting].contains(pending.state) { startRun(id) }
      }
    }
    publishServing()
  }

  /// Whether maps may use the region's stored version.
  private func isServed(_ record: OfflineRegionRecord) -> Bool {
    record.active != nil && !record.removing
      && (record.check?.state != "not_updatable" || OfflineServingRule.servesRegionsAfterAccessEnds)
  }

  /// Tells maps which stored resources and regional credits they may use without a network.
  private func publishServing() {
    guard let index = dependencies.index else { return }
    var snapshot = OfflineServingSnapshot()
    for (id, record) in records where isServed(record) {
      guard let active = record.active else { continue }
      snapshot.paths.formUnion(keys(id, active).all)
      guard active.packs > 0, let origin = active.apiOrigin.flatMap(URL.init(string:)) else {
        continue
      }
      for (scope, credits) in credits(id, active, apiOrigin: origin) {
        var merged = snapshot.credits[scope] ?? []
        for credit in credits where !merged.contains(where: { $0.id == credit.id }) {
          merged.append(credit)
        }
        snapshot.credits[scope] = merged
      }
    }
    index.publish(snapshot, from: self)
  }

  /// The regional credits of a Hosted version's packs, by the cache scope of their Map.
  private func credits(_ id: String, _ version: OfflineVersionRecord, apiOrigin: URL) -> [String:
    [OfflineCredit]]
  {
    let key = planKey(id, version.number)
    if let cached = creditSets[key] { return cached }
    guard let plan = try? plan(id, version) else { return [:] }
    var result: [String: [OfflineCredit]] = [:]
    for pack in plan.packs {
      let scope = ResourceCacheScope.grant(apiOrigin: apiOrigin, mapID: pack.manifest.mapID)
      result[scope.directory, default: []] += OfflineCredit.credits(pack.manifest.attribution)
    }
    creditSets[key] = result
    return result
  }

  // MARK: Reading

  func regions() -> [TileflowOfflineRegion] {
    open()
    return records.values.filter { !$0.removing }
      .sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }.compactMap(snapshot)
  }

  func region(_ id: String) -> TileflowOfflineRegion? {
    open()
    return records[id].flatMap(snapshot)
  }

  // MARK: Estimating

  func estimate(_ options: TileflowOfflineRegionLoadOptions) async throws
    -> TileflowOfflineRegionEstimate
  {
    open()
    switch options.content {
    case .hosted:
      let plan = try await hostedPlan(options).plan
      var perPack = Array(repeating: 0, count: plan.packs.count)
      for resource in plan.resources where resource.billable && !isStored(resource.key) {
        perPack[resource.pack ?? 0] += 1
      }
      let perView = OfflinePlanner.resourcesPerMapView
      return TileflowOfflineRegionEstimate(
        resourceCount: plan.resources.count, billableResourceCount: plan.billable,
        publicResourceCount: plan.resources.filter(\.isPublic).count,
        bytes: plan.bytes.map { Int($0) }, tileCounts: plan.tileCounts,
        mapViews: perPack.reduce(0) { $0 + ($1 + perView - 1) / perView })
    case .manifest(let url, let map, let sources):
      try OfflineSelfHosted.validate(manifest: url, map: map)
      try OfflineSelfHosted.validate(sources)
      return try OfflinePlanner.estimate(
        geometry: options.geometry, zooms: options.zooms,
        sources: sources.map {
          OfflinePlanner.SelfHostedSource(id: $0.id, minZoom: $0.minZoom, maxZoom: $0.maxZoom)
        })
    }
  }

  // MARK: Loading

  /// Creates the region, resumes its unfinished download, or downloads a new version of it.
  func load(_ id: String, _ options: TileflowOfflineRegionLoadOptions) async throws
    -> TileflowOfflineRegion
  {
    open()
    guard !id.isEmpty, id.utf8.count <= 256 else {
      throw TileflowOfflineError.options("invalidRegionID")
    }
    try options.geometry.validate()
    _ = try options.zooms
    let json = options.json
    if var record = records[id], var pending = record.pending,
      pending.options.canonical == json.canonical
    {
      if pending.state != .downloading {
        pending.state = .downloading
        pending.error = nil
        pending.retryAt = nil
        record.pending = pending
        try save(record)
      }
      startRun(id)
      return snapshot(record)!
    }

    // A new version: the plan first, so a refusal changes nothing.
    let number = records[id]?.nextVersion ?? 1
    var plan: OfflineVersionPlan
    var apiOrigin: URL?
    switch options.content {
    case .hosted:
      let hosted = try await hostedPlan(options)
      plan = hosted.plan
      apiOrigin = hosted.apiOrigin
      try checkDeviceLimit(id, plan)
    case .manifest(let url, let map, let sources):
      try OfflineSelfHosted.validate(manifest: url, map: map)
      try OfflineSelfHosted.validate(sources)
      let documents = try await selfHostedDocuments(url, map: map)
      plan = OfflineVersionPlan.selfHosted(
        documents: documents, sources: sources, regions: try options.geometry.packRegions(),
        zooms: try options.zooms)
      let value: JSONValue = .object([
        "documents": .array(documents.map { .string($0.absoluteString) })
      ])
      try OfflineLayout.write(JSONEncoder().encode(value), to: layout.plan(id, number))
    }
    if records[id]?.pending != nil { discardPending(id) }
    let now = dependencies.now()
    var record =
      records[id]
      ?? OfflineRegionRecord(id: id, createdAt: now.offlineMilliseconds)
    for (index, pack) in plan.packs.enumerated() {
      try OfflineLayout.write(
        plan.requests[index].body, to: layout.request(id, number, pack: index))
      try OfflineLayout.write(pack.response, to: layout.pack(id, number, pack: index))
    }
    record.pending = OfflineVersionRecord(
      number: number, options: json, apiOrigin: apiOrigin?.absoluteString, packs: plan.packs.count,
      resources: plan.resources.count, billable: plan.billable, bytes: plan.bytes,
      state: .downloading, error: nil, retryAt: nil, createdAt: now.offlineMilliseconds,
      completedAt: nil)
    try save(record)
    plans[planKey(id, number)] = plan
    progress[id] = (0, 0)
    startRun(id)
    let region = snapshot(record)!
    subscribers.emit(.changed(region))
    return region
  }

  // MARK: Controlling

  func pause(_ id: String) throws {
    open()
    guard var record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    guard var pending = record.pending, pending.state != .paused else { return }
    stopRun(id, pending)
    pending.state = .paused
    pending.retryAt = nil
    record.pending = pending
    try save(record)
    emitChanged(id)
  }

  func resume(_ id: String) throws {
    open()
    guard var record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    guard var pending = record.pending else { return }
    // A waiting download continues now instead of at its retry time.
    if pending.state == .waiting { stopRun(id, pending, cancelTransfers: false) }
    if pending.state != .downloading {
      pending.state = .downloading
      pending.error = nil
      pending.retryAt = nil
      record.pending = pending
      try save(record)
    }
    startRun(id)
    emitChanged(id)
  }

  /// Stops the download. A region never completed is removed; an update is abandoned and the
  /// stored version kept.
  func cancel(_ id: String) throws {
    open()
    guard let record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    guard record.active != nil else { return try remove(id) }
    guard record.pending != nil else { return }
    discardPending(id)
    emitChanged(id)
  }

  func remove(_ id: String) throws {
    open()
    guard var record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    record.versions.forEach { stopRun(id, $0) }
    record.removing = true
    try save(record)
    finishRemoval(id)
  }

  // MARK: Updates

  /// Revalidates stored Hosted regions that are due: never checked, or checked longer ago than
  /// the service's interval. Access ending stops further checks; nothing is removed.
  func checkForUpdates() async {
    open()
    guard let client = try? dependencies.client() else { return }
    let now = dependencies.now()
    for id in records.keys.sorted() {
      guard let record = records[id], !record.removing, let active = record.active,
        active.packs > 0
      else { continue }
      if let check = record.check {
        guard check.state != "not_updatable",
          now.offlineMilliseconds >= check.checkedAt + Int64(check.interval * 1000)
        else { continue }
      }
      guard let plan = try? plan(id, active) else { continue }
      var states: [OfflinePackRevalidation] = []
      for pack in plan.packs {
        guard let state = try? await client.revalidate(pack.grant) else { break }
        states.append(state)
      }
      guard states.count == plan.packs.count, var current = records[id], !current.removing else {
        continue
      }
      var check = OfflineCheckRecord(
        state: "current", reason: nil, checkedAt: now.offlineMilliseconds, interval: 86_400)
      for state in states {
        switch state {
        case .current(let checkedAt, let interval):
          check.checkedAt = checkedAt.offlineMilliseconds
          check.interval = min(check.interval, interval)
        case .updateAvailable(let checkedAt, let interval):
          if check.state == "current" { check.state = "update_available" }
          check.checkedAt = checkedAt.offlineMilliseconds
          check.interval = min(check.interval, interval)
        case .notUpdatable(let reason, let checkedAt):
          check.state = "not_updatable"
          check.reason = check.reason ?? reason.rawValue
          check.checkedAt = checkedAt.offlineMilliseconds
        }
      }
      current.check = check
      try? save(current)
      publishServing()
      emitChanged(id)
    }
  }

  /// The network returned: waiting downloads try again now and due regions are revalidated.
  func networkDidConnect() async {
    open()
    for (id, record) in records where !record.removing {
      if let pending = record.pending, pending.state == .waiting,
        pending.error?.code == TileflowOfflineError.Code.network.rawValue
      {
        stopRun(id, pending, cancelTransfers: false)
        startRun(id)
      }
    }
    await checkForUpdates()
  }

  // MARK: Downloading

  private func startRun(_ id: String) {
    guard runs[id] == nil else { return }
    let token = UUID()
    let task = Task { [weak self] in
      await self?.drive(id)
      await self?.finishRun(id, token)
    }
    runs[id] = (token, task)
  }

  private func finishRun(_ id: String, _ token: UUID) {
    if runs[id]?.token == token { runs[id] = nil }
  }

  private func stopRun(_ id: String, _ version: OfflineVersionRecord, cancelTransfers: Bool = true)
  {
    runs.removeValue(forKey: id)?.task.cancel()
    if cancelTransfers { dependencies.fetcher.cancel(prefix: transferPrefix(id, version.number)) }
  }

  private func drive(_ id: String) async {
    var renewals = 0
    var attempt = 0
    var waited = false
    while !Task.isCancelled {
      guard let record = records[id], !record.removing, let pending = record.pending,
        [.downloading, .waiting].contains(pending.state)
      else { return }
      if let retryAt = pending.retryAt, !waited {
        let delay = Date(offlineMilliseconds: retryAt).timeIntervalSince(dependencies.now())
        if delay > 0 {
          do { try await dependencies.sleep(delay) } catch { return }
          waited = true
          continue
        }
      }
      waited = false
      let plan: OfflineVersionPlan
      do {
        plan = try self.plan(id, pending)
      } catch {
        return update(id) { $0.fail(.init(.invalidResponse, context: .init(reason: "storedPack"))) }
      }
      let stored = OfflineProgressLog.read(layout.progress(id, pending.number))
      let remaining = plan.resources.filter { stored[$0.key.digest] == nil }
      progress[id] = (
        plan.resources.count - remaining.count, stored.values.reduce(0, +)
      )
      if remaining.isEmpty {
        activate(id)
        return
      }
      let needed = remaining.reduce(Int64(0)) { $0 + Int64($1.bytes ?? 0) }
      if !OfflineStorage.hasRoom(
        needed + dependencies.reserveBytes, available: dependencies.availableBytes,
        cache: dependencies.cache)
      {
        return update(id) {
          $0.fail(.init(.insufficientStorage, context: .init(limit: Int(clamping: needed))))
        }
      }
      let now = dependencies.now()
      if let expiring = plan.packs.indices.first(where: { index in
        plan.packs[index].manifest.downloadExpiresAt.timeIntervalSince(now) < Self.renewalMargin
          && remaining.contains(where: { $0.pack == index })
      }) {
        renewals += 1
        guard await renew(id, pending, pack: expiring, renewals: renewals) else { return }
        continue
      }
      if pending.state != .downloading || pending.error != nil {
        update(id) {
          $0.state = .downloading
          $0.error = nil
          $0.retryAt = nil
        }
      }
      let downloader = OfflineDownloader(
        cache: dependencies.cache, fetcher: dependencies.fetcher,
        availableBytes: dependencies.availableBytes, reserveBytes: dependencies.reserveBytes,
        concurrency: dependencies.concurrency, now: dependencies.now)
      let options = TileflowOfflineRegionLoadOptions(json: pending.options)
      let job = OfflineDownloadJob(
        prefix: transferPrefix(id, pending.number), plan: plan, pending: remaining,
        activePaths: activePaths(), staging: layout.staging(id, pending.number),
        restriction: options?.networkRestriction ?? .none)
      let log = OfflineProgressLog(layout.progress(id, pending.number))
      let outcome = await downloader.run(job, log: log) { [weak self] entries in
        await self?.didStore(id, entries)
      }
      log.close()
      switch outcome {
      case .complete:
        attempt = 0
      case .cancelled:
        return
      case .renew(let pack, let error):
        renewals += 1
        guard renewals <= Self.maximumRenewals else { return update(id) { $0.fail(error) } }
        guard await renew(id, pending, pack: pack, renewals: renewals) else { return }
      case .wait(let error, let delay):
        attempt += 1
        let wait = delay ?? min(Self.maximumBackoff, pow(2, Double(min(attempt, 9))))
        update(id) {
          $0.state = .waiting
          $0.error = OfflineStoredError(error)
          $0.retryAt = dependencies.now().addingTimeInterval(wait).offlineMilliseconds
        }
      case .fail(let error):
        return update(id) { $0.fail(error) }
      }
    }
  }

  private func didStore(_ id: String, _ entries: [(digest: String, bytes: Int64)]) {
    var current = progress[id] ?? (0, 0)
    current.count += entries.count
    current.bytes += entries.reduce(0) { $0 + $1.bytes }
    progress[id] = current
    emitChanged(id)
  }

  /// Creates a pack of the pending version again, keeping every stored resource the new
  /// manifest lists unchanged. Returns false when the download stopped.
  private func renew(
    _ id: String, _ pending: OfflineVersionRecord, pack index: Int, renewals: Int
  ) async -> Bool {
    guard renewals <= Self.maximumRenewals else {
      update(id) { $0.fail(.init(.grantRejected)) }
      return false
    }
    do {
      let client = try dependencies.client()
      var plan = try self.plan(id, pending)
      let pack = try await client.create(plan.requests[index])
      guard let current = records[id]?.pending, current.number == pending.number else {
        return false
      }
      let previous = Dictionary(
        plan.resources.map { ($0.key.digest, ($0.bytes, $0.sha256)) },
        uniquingKeysWith: { a, _ in a })
      var packs = plan.packs
      packs[index] = pack
      plan = .hosted(packs: packs, requests: plan.requests, apiOrigin: client.apiOrigin)
      try checkDeviceLimit(id, plan)
      let stored = OfflineProgressLog.read(layout.progress(id, pending.number))
      var kept: [String: Int64] = [:]
      for resource in plan.resources {
        guard let bytes = stored[resource.key.digest],
          let before = previous[resource.key.digest],
          before.0 == resource.bytes, before.1 == resource.sha256
        else { continue }
        kept[resource.key.digest] = bytes
      }
      try OfflineProgressLog.write(kept, to: layout.progress(id, pending.number))
      try OfflineLayout.write(pack.response, to: layout.pack(id, pending.number, pack: index))
      plans[planKey(id, pending.number)] = plan
      keySets.removeValue(forKey: planKey(id, pending.number))
      update(id) {
        $0.resources = plan.resources.count
        $0.billable = plan.billable
        $0.bytes = plan.bytes
      }
      return true
    } catch is CancellationError {
      return false
    } catch let error as TileflowOfflineError {
      if error.isRecoverable {
        update(id) {
          $0.state = .waiting
          $0.error = OfflineStoredError(error)
          $0.retryAt =
            dependencies.now().addingTimeInterval(
              error.retryAfter ?? Self.maximumBackoff
            ).offlineMilliseconds
        }
        return true
      }
      update(id) { $0.fail(error) }
      return false
    } catch {
      update(id) { $0.fail(.init(.invalidResponse)) }
      return false
    }
  }

  /// Makes a complete pending version the region's version: staged bodies enter the pinned
  /// partition, one record replacement switches versions, then the replaced version's resources
  /// no other version uses are released.
  private func activate(_ id: String) {
    guard var record = records[id], var pending = record.pending,
      let plan = try? plan(id, pending)
    else { return }
    let staging = layout.staging(id, pending.number)
    let byDigest = Dictionary(
      plan.resources.map { ($0.key.digest, $0) }, uniquingKeysWith: { a, _ in a })
    for name in (try? FileManager.default.contentsOfDirectory(atPath: staging.path)) ?? [] {
      guard let resource = byDigest[name],
        let data = try? Data(contentsOf: staging.appendingPathComponent(name)),
        let entry = try? ResourceCacheEntryFormat.decode(data, expecting: resource.url)
      else { continue }
      guard
        dependencies.cache.write(
          resource.key, retention: .pinned, metadata: entry.metadata, body: entry.body)
      else {
        return update(id) {
          $0.fail(.init(.insufficientStorage, context: .init(reason: "writeFailed")))
        }
      }
    }
    let now = dependencies.now()
    pending.state = .complete
    pending.error = nil
    pending.retryAt = nil
    pending.completedAt = now.offlineMilliseconds
    pending.bytes = pending.bytes ?? progress[id]?.bytes
    record.retired = record.active
    record.active = pending
    record.pending = nil
    if plan.isHosted {
      let interval = plan.packs.map(\.manifest.revalidationInterval).min() ?? 86_400
      record.check = OfflineCheckRecord(
        state: "current", reason: nil, checkedAt: now.offlineMilliseconds, interval: interval)
    }
    do { try save(record) } catch { return }
    try? FileManager.default.removeItem(at: staging)
    progress[id] = nil
    finishRetirement(id)
    publishServing()
    emitChanged(id)
  }

  private func finishRetirement(_ id: String) {
    guard var record = records[id], let retired = record.retired else { return }
    release(id, [retired])
    record.retired = nil
    try? save(record)
  }

  private func finishRemoval(_ id: String) {
    guard let record = records[id] else { return }
    records[id] = nil
    release(id, record.versions)
    try? FileManager.default.removeItem(at: layout.region(id))
    progress[id] = nil
    if isOpen { publishServing() }
    subscribers.emit(.removed(id: id))
  }

  /// Abandons the pending version and releases what only it used.
  private func discardPending(_ id: String) {
    guard var record = records[id], let pending = record.pending else { return }
    stopRun(id, pending)
    release(id, [pending])
    record.pending = nil
    try? save(record)
    progress[id] = nil
  }

  /// Removes pinned entries of `versions` that no other version references, then the versions'
  /// files.
  private func release(_ id: String, _ versions: [OfflineVersionRecord]) {
    let numbers = Set(versions.map(\.number))
    var keep = Set<String>()
    for (other, record) in records where !record.removing {
      for version in record.versions where other != id || !numbers.contains(version.number) {
        keep.formUnion(keys(other, version).all)
      }
    }
    for version in versions {
      if let plan = try? plan(id, version) {
        dependencies.cache.removePinned(
          plan.resources.lazy.map(\.key).filter { !keep.contains($0.relativePath) })
      }
      try? FileManager.default.removeItem(at: layout.version(id, version.number))
      plans.removeValue(forKey: planKey(id, version.number))
      keySets.removeValue(forKey: planKey(id, version.number))
      creditSets.removeValue(forKey: planKey(id, version.number))
    }
  }

  // MARK: Plans

  private func hostedPlan(_ options: TileflowOfflineRegionLoadOptions) async throws -> (
    plan: OfflineVersionPlan, apiOrigin: URL
  ) {
    guard case .hosted(let mapID, let themes) = options.content else {
      throw TileflowOfflineError.options("invalidContent")
    }
    let client = try dependencies.client()
    let requests = try OfflinePackRequest.requests(
      mapID: mapID, themes: themes, geometry: options.geometry, zooms: options.zooms)
    var packs: [OfflinePack] = []
    for request in requests {
      let now = dependencies.now()
      if let pack = created[request],
        pack.manifest.downloadExpiresAt.timeIntervalSince(now) > Self.reuseWindow
      {
        packs.append(pack)
        continue
      }
      let pack = try await client.create(request)
      created[request] = pack
      packs.append(pack)
    }
    return (
      .hosted(packs: packs, requests: requests, apiOrigin: client.apiOrigin), client.apiOrigin
    )
  }

  /// The manifest, then each theme's style and what it references, without duplicates.
  private func selfHostedDocuments(_ url: URL, map: String) async throws -> [URL] {
    let manifest = try OfflineSelfHosted.manifest(url, data: try await document(url), map: map)
    var documents = manifest.documents
    for style in manifest.styles {
      documents += try OfflineSelfHosted.documents(style: style, data: try await document(style))
    }
    var seen = Set<String>()
    return documents.filter { seen.insert($0.absoluteString).inserted }
  }

  private func document(_ url: URL) async throws -> Data {
    let response: OfflineFetchResponse
    do {
      response = try await dependencies.fetcher.fetch(
        OfflineFetchRequest(
          id: "plan/" + DataChannel.digest(Data(url.absoluteString.utf8)), url: url, headers: [:],
          allowsExpensiveNetworkAccess: true))
    } catch is CancellationError {
      throw CancellationError()
    } catch {
      throw TileflowOfflineError(.network)
    }
    guard response.status == 200 else {
      throw TileflowOfflineError(.notFound, context: .init(status: response.status))
    }
    return response.body
  }

  /// The plan of a stored version, read from its files once.
  private func plan(_ id: String, _ version: OfflineVersionRecord) throws -> OfflineVersionPlan {
    let key = planKey(id, version.number)
    if let plan = plans[key] { return plan }
    guard let options = TileflowOfflineRegionLoadOptions(json: version.options) else {
      throw TileflowOfflineError(.invalidResponse)
    }
    let plan: OfflineVersionPlan
    if version.packs > 0 {
      guard let origin = version.apiOrigin.flatMap(URL.init(string:)) else {
        throw TileflowOfflineError(.invalidResponse)
      }
      var requests: [OfflinePackRequest] = []
      var packs: [OfflinePack] = []
      for index in 0..<version.packs {
        guard
          let request = OfflinePackRequest(
            json: try Data(contentsOf: layout.request(id, version.number, pack: index)))
        else { throw TileflowOfflineError(.invalidResponse) }
        requests.append(request)
        packs.append(
          try OfflinePackContract.pack(
            Data(contentsOf: layout.pack(id, version.number, pack: index)), request: request,
            allowsLoopbackHTTP: origin.scheme == "http"))
      }
      plan = .hosted(packs: packs, requests: requests, apiOrigin: origin)
    } else {
      guard case .manifest(_, _, let sources) = options.content,
        let value = try? JSONDecoder().decode(
          JSONValue.self, from: Data(contentsOf: layout.plan(id, version.number))),
        case .array(let items) = value["documents"]
      else { throw TileflowOfflineError(.invalidResponse) }
      plan = .selfHosted(
        documents: items.compactMap { $0.string.flatMap(URL.init(string:)) }, sources: sources,
        regions: try options.geometry.packRegions(), zooms: try options.zooms)
    }
    // Plans of versions downloading stay in memory; others are read again when needed.
    if records[id]?.pending?.number == version.number { plans[key] = plan }
    return plan
  }

  private func keys(_ id: String, _ version: OfflineVersionRecord) -> (
    all: Set<String>, billable: Set<String>
  ) {
    let key = planKey(id, version.number)
    if let cached = keySets[key] { return cached }
    guard let plan = try? plan(id, version) else { return ([], []) }
    var all = Set<String>()
    var billable = Set<String>()
    for resource in plan.resources {
      all.insert(resource.key.relativePath)
      if resource.billable { billable.insert(resource.key.relativePath) }
    }
    keySets[key] = (all, billable)
    return (all, billable)
  }

  /// Cache paths of every stored (active) version.
  private func activePaths() -> Set<String> {
    var paths = Set<String>()
    for (id, record) in records where !record.removing {
      if let active = record.active { paths.formUnion(keys(id, active).all) }
    }
    return paths
  }

  /// The device holds at most the plan's limit of billable resources; a version that does not
  /// grow the device's total is always accepted.
  private func checkDeviceLimit(_ id: String, _ plan: OfflineVersionPlan) throws {
    guard let limit = plan.packs.map(\.manifest.maximumPackResources).min() else { return }
    var others = Set<String>()
    for (other, record) in records where other != id && !record.removing {
      for version in [record.active, record.pending].compactMap({ $0 }) {
        others.formUnion(keys(other, version).billable)
      }
    }
    let mine = records[id]?.active.map { keys(id, $0).billable } ?? []
    var next = Set<String>()
    for resource in plan.resources where resource.billable {
      next.insert(resource.key.relativePath)
    }
    let held = others.union(mine)
    try OfflineDeviceLimit.check(
      deviceTotal: held.count, adding: next.subtracting(held).count,
      releasing: mine.subtracting(others.union(next)).count, limit: limit)
  }

  private func isStored(_ key: ResourceCacheKey) -> Bool {
    FileManager.default.fileExists(
      atPath: dependencies.cache.file(for: key, retention: .pinned).path)
  }

  // MARK: Records

  private func save(_ record: OfflineRegionRecord) throws {
    try record.write(layout.record(record.id))
    records[record.id] = record
  }

  private func update(_ id: String, _ change: (inout OfflineVersionRecord) -> Void) {
    guard var record = records[id], var pending = record.pending else { return }
    change(&pending)
    record.pending = pending
    try? save(record)
    emitChanged(id)
  }

  private func emitChanged(_ id: String) {
    if let region = records[id].flatMap(snapshot) { subscribers.emit(.changed(region)) }
  }

  private func storedProgress(_ id: String, _ version: OfflineVersionRecord) -> (Int, Int64) {
    let stored = OfflineProgressLog.read(layout.progress(id, version.number))
    return (stored.count, stored.values.reduce(0, +))
  }

  private func planKey(_ id: String, _ number: Int) -> String { "\(id)\n\(number)" }

  private func transferPrefix(_ id: String, _ number: Int) -> String {
    "\(DataChannel.digest(Data(id.utf8)).prefix(16))/\(number)/"
  }

  private func snapshot(_ record: OfflineRegionRecord) -> TileflowOfflineRegion? {
    guard !record.removing, let version = record.pending ?? record.active,
      let options = TileflowOfflineRegionLoadOptions(json: version.options)
    else { return nil }
    let downloading = record.pending != nil
    let done = downloading ? progress[record.id] ?? (0, 0) : (version.resources, version.bytes ?? 0)
    let state: TileflowOfflineRegion.DownloadState =
      switch version.state {
      case .downloading: .downloading
      case .waiting: .waiting
      case .paused: .paused
      case .failed: .failed
      case .complete: .complete
      }
    var update: TileflowOfflineRegion.UpdateState?
    switch record.check?.state {
    case "current": update = .current
    case "update_available": update = .updateAvailable
    case "not_updatable": update = .notUpdatable(reason: record.check?.reason ?? "")
    default: update = nil
    }
    return TileflowOfflineRegion(
      id: record.id, options: options, state: state, isAvailable: isServed(record),
      requiredResourceCount: version.resources,
      completedResourceCount: min(done.0, version.resources),
      requiredResourceBytes: version.bytes, completedResourceBytes: done.1,
      billableResourceCount: version.billable, error: version.error?.error,
      retryDate: version.retryAt.map { Date(offlineMilliseconds: $0) },
      completedAt: record.active?.completedAt.map { Date(offlineMilliseconds: $0) },
      updateState: update, checkedAt: record.check.map { Date(offlineMilliseconds: $0.checkedAt) })
  }
}

extension OfflineVersionRecord {
  fileprivate mutating func fail(_ error: TileflowOfflineError) {
    state = .failed
    self.error = OfflineStoredError(error)
    retryAt = nil
  }
}
