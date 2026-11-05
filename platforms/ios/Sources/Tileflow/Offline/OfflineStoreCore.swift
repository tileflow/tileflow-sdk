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
/// Records change only here. A version becomes the region's `active` version only when every pack
/// and resource is stored and verified, by one atomic record replacement. Packs are shared across
/// regions by digest and resources by cache key; either is released only when no region version
/// references it. Each multi-step change is recorded before it starts (`pending`, `retired`,
/// `removing`) and finished when the store opens again, so a crash never leaves an unreferenced or
/// missing pack or resource behind.
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
    var profile: OfflinePackProfile = .native
    var concurrency = 64
    /// Packs transferred at once.
    var packConcurrency = 4
    var now: @Sendable () -> Date = { Date() }
    var sleep: @Sendable (TimeInterval) async throws -> Void = {
      try await Task.sleep(nanoseconds: UInt64(max(0, $0) * 1_000_000_000))
    }
    /// Asks the system to run automatic updates in the background; nil for none.
    var scheduler: (any OfflineUpdateScheduling)? = nil
    /// Whether the device may update regions by itself now.
    var conditions: @Sendable () -> OfflineUpdateConditions = { .unavailable }
  }

  /// Automatic updates run about this often: the service's revalidation interval.
  static let automaticUpdateInterval: TimeInterval = 86_400
  /// A run the network or power held back is tried again after this long.
  static let automaticUpdateRetry: TimeInterval = 3_600
  /// While the app runs, the store looks again at least this often, so a timer the system held
  /// while the app was suspended never keeps an expired region in use for longer.
  static let wakeLimit: TimeInterval = 3_600

  /// A download an estimate created is reused by the next load while at least this much of its
  /// window remains.
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
  /// A reply belongs to the active version that requested it. Removing or replacing that
  /// version invalidates the token, even when a recreated region starts again at version one.
  private var revalidations: [String: UUID] = [:]
  /// Controls of one region run in order while a stopped transfer finishes.
  private var controls: [String: [CheckedContinuation<Void, Never>]] = [:]
  private var runs: [String: (token: UUID, task: Task<Void, Never>)] = [:]
  private var progress: [String: OfflineProgress] = [:]
  private var plans: [String: OfflineVersionPlan] = [:]
  private var keySets: [String: Set<String>] = [:]
  private var unitSets: [String: [String: Int]] = [:]
  private var digestSets: [String: Set<String>] = [:]
  private var servedSets: [String: [String: OfflineServedPacks]] = [:]
  private var creditSets: [String: [String: OfflineSourceCredits]] = [:]
  private var created: [OfflinePackRequest: OfflineDownload] = [:]
  private var settings = OfflineSettings()
  /// Each Hosted region's expiry phase as last reported, so a change is reported once.
  private var phases: [String: OfflineExpiryPhase] = [:]
  /// Packs an earlier pass of a pending version held before its download was created again.
  private var candidates: [String: [String: OfflinePreviousPack]] = [:]

  init(_ dependencies: Dependencies, subscribers: OfflineSubscribers) {
    self.dependencies = dependencies
    self.subscribers = subscribers
    dependencies.fetcher.onWarning { warning in subscribers.emit(.warning(warning)) }
  }

  // MARK: Opening

  /// Reads the records, finishes interrupted removals and replacements, and resumes downloads.
  func open() {
    guard !isOpen else { return }
    isOpen = true
    layout.excludeFromBackup()
    settings = OfflineSettings.read(layout.settings)
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
      if var current = records[id], let pending = current.pending, pending.automatic == true,
        current.check?.state == "not_updatable" {
        // Revocation was recorded before the interrupted process finished stopping its transfer.
        dependencies.fetcher.cancel(prefix: transferPrefix(id, pending.number))
        finishPendingDiscard(&current, pending)
        continue
      }
      if let pending = record.pending {
        progress[id] = storedProgress(id, pending)
        if [.downloading, .waiting].contains(pending.state) { startRun(id) }
      }
    }
    let now = dependencies.now()
    phases = records.compactMapValues { expiryPhase($0, at: now) }
    publishServing()
  }

  /// Whether maps may use the region's stored version.
  private func isServed(_ record: OfflineRegionRecord) -> Bool {
    record.active != nil && !record.removing
      && (record.check?.state != "not_updatable" || OfflineServingRule.servesRegionsAfterAccessEnds)
      && expiryPhase(record, at: dependencies.now()) != .expired
  }

  /// When the service last confirmed access to a Hosted region's stored version; nil for
  /// self-hosted content, which never expires.
  private func validatedAt(_ record: OfflineRegionRecord) -> Date? {
    guard let active = record.active, active.downloads > 0,
      let validated = record.check?.validatedAt ?? active.completedAt
    else { return nil }
    return Date(offlineMilliseconds: validated)
  }

  private func expiryPhase(_ record: OfflineRegionRecord, at now: Date) -> OfflineExpiryPhase? {
    validatedAt(record).map { OfflineServingRule.expiry.phase($0, at: now) }
  }

  /// Tells maps which stored packs, resources and regional credits they may use without a
  /// network.
  private func publishServing() {
    guard let index = dependencies.index else { return }
    var snapshot = OfflineServingSnapshot()
    for (id, record) in records where isServed(record) {
      guard let active = record.active else { continue }
      snapshot.paths.formUnion(keys(id, active))
      guard active.downloads > 0, let origin = active.apiOrigin.flatMap(URL.init(string:)) else {
        continue
      }
      for (scope, packs) in served(id, active, apiOrigin: origin) {
        snapshot.packs[scope, default: .init()].merge(packs)
      }
      for (scope, credits) in credits(id, active, apiOrigin: origin) {
        OfflineCredit.merge(credits.regional, into: &snapshot.credits[scope, default: []])
        OfflineObligation.merge(
          credits.obligations, into: &snapshot.obligations[scope, default: []])
      }
    }
    index.publish(snapshot, from: self)
  }

  /// The credits of a Hosted version's downloads, by the cache scope of their Map.
  private func credits(_ id: String, _ version: OfflineVersionRecord, apiOrigin: URL) -> [String:
    OfflineSourceCredits]
  {
    let key = planKey(id, version.number)
    if let cached = creditSets[key] { return cached }
    guard let plan = try? plan(id, version) else { return [:] }
    var result: [String: OfflineSourceCredits] = [:]
    for download in plan.downloads {
      let scope = ResourceCacheScope.grant(apiOrigin: apiOrigin, mapID: download.manifest.mapID)
      let attribution = download.manifest.attribution
      OfflineCredit.merge(
        OfflineCredit.credits(attribution),
        into: &result[scope.directory, default: .init()].regional)
      OfflineObligation.merge(
        OfflineObligation.obligations(attribution),
        into: &result[scope.directory, default: .init()].obligations)
    }
    creditSets[key] = result
    return result
  }

  /// The packs of a complete Hosted version as maps read them, by the cache scope of their Map:
  /// document packs' entries by address, tile packs by source template and anchor.
  private func served(_ id: String, _ version: OfflineVersionRecord, apiOrigin: URL) -> [String:
    OfflineServedPacks]
  {
    let key = planKey(id, version.number)
    if let cached = servedSets[key] { return cached }
    guard let plan = try? plan(id, version) else { return [:] }
    let stored = OfflineProgressLog.read(layout.progress(id, version.number))
    let packs = layout.packs
    var result: [String: OfflineServedPacks] = [:]
    for planned in plan.packs {
      guard let digest = stored[planned.key]?.pack else { continue }
      let manifest = plan.downloads[planned.download].manifest
      let scope = ResourceCacheScope.grant(apiOrigin: apiOrigin, mapID: manifest.mapID).directory
      let file = packs.file(digest)
      var served = result[scope] ?? OfflineServedPacks()
      switch planned.pack.kind {
      case .documents:
        guard let index = try? OfflinePackFormat.index(file) else { continue }
        for entry in index.entries.values where served.documents[entry.name] == nil {
          served.documents[entry.name] = (file, entry)
        }
      case .tiles:
        guard let name = planned.pack.source, let source = manifest.source(name),
          let zooms = source.zooms, let anchor = planned.pack.anchor
        else { continue }
        var tiles =
          served.tiles[source.template.text]
          ?? OfflineServedTiles(
            template: source.template, zooms: zooms, absentStatus: source.absentStatus)
        if !tiles.covers.contains(manifest.cover) { tiles.covers.append(manifest.cover) }
        tiles.anchors[anchor, default: []].append(file)
        served.tiles[source.template.text] = tiles
      }
      result[scope] = served
    }
    // Every source a download holds answers for its cover, even where no pack was stored.
    for download in plan.downloads {
      let scope = ResourceCacheScope.grant(apiOrigin: apiOrigin, mapID: download.manifest.mapID)
        .directory
      for source in download.manifest.sources {
        guard let zooms = source.zooms else { continue }
        var served = result[scope] ?? OfflineServedPacks()
        var tiles =
          served.tiles[source.template.text]
          ?? OfflineServedTiles(
            template: source.template, zooms: zooms, absentStatus: source.absentStatus)
        if !tiles.covers.contains(download.manifest.cover) {
          tiles.covers.append(download.manifest.cover)
        }
        served.tiles[source.template.text] = tiles
        result[scope] = served
      }
    }
    servedSets[key] = result
    return result
  }

  // MARK: Reading

  func regions() -> [TileflowOfflineRegion] {
    open()
    refreshExpiry()
    return records.values.filter { !$0.removing }
      .sorted { ($0.createdAt, $0.id) < ($1.createdAt, $1.id) }.compactMap(snapshot)
  }

  func region(_ id: String) -> TileflowOfflineRegion? {
    open()
    refreshExpiry()
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
      // Packs the device holds for the same request and release are kept without being billed.
      let held = heldUnits()
      var perDownload = Array(repeating: 0, count: plan.downloads.count)
      for planned in plan.packs where held[Self.unit(planned, plan)] == nil {
        perDownload[planned.download] += planned.pack.billableResources
      }
      let perView = OfflinePlanner.resourcesPerMapView
      return TileflowOfflineRegionEstimate(
        packCount: plan.packs.count, resourceCount: plan.resourceCount,
        billableResourceCount: plan.billable, publicResourceCount: plan.resources.count,
        bytes: plan.bytes.map { Int($0) }, tileCounts: plan.tileCounts,
        mapViews: perDownload.reduce(0) { $0 + ($1 + perView - 1) / perView })
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

  /// Creates the region, resumes its unfinished download, or downloads a new version of it. An
  /// `automatic` version is an update the store started by itself.
  func load(_ id: String, _ options: TileflowOfflineRegionLoadOptions, automatic: Bool = false)
    async throws -> TileflowOfflineRegion
  {
    await enterControl(id)
    defer { leaveControl(id) }
    open()
    guard !id.isEmpty, id.utf8.count <= 256 else {
      throw TileflowOfflineError.options("invalidRegionID")
    }
    try options.geometry.validate()
    _ = try options.zooms
    let json = options.json
    if automatic, !canStartAutomaticUpdate(id) { throw CancellationError() }
    let needsNewGrant = records[id].map { ($0.active?.downloads ?? 0) > 0 && !hasAutomaticAccess($0) } ?? false
    if var record = records[id], var pending = record.pending,
      !(pending.automatic == true && needsNewGrant),
      Self.withoutMetadata(pending.options) == Self.withoutMetadata(json)
    {
      // Metadata alone never restarts a download: it changes in place.
      if pending.options.canonical != json.canonical {
        record = Self.replacingMetadata(record, json["metadata"] ?? .object([:]))
        pending = record.pending!
        try save(record)
      }
      // Loading an automatic update makes it the application's: it may use any allowed network.
      let takenOver = !automatic && pending.automatic == true
      if pending.state != .downloading || takenOver {
        pending.state = .downloading
        pending.error = nil
        pending.retryAt = nil
        pending.automatic = automatic ? true : nil
        record.pending = pending
        try save(record)
      }
      if takenOver { await stopRun(id, pending, cancelTransfers: false) }
      startRun(id)
      return snapshot(record)!
    }

    // A new version: the plan first, so a refusal changes nothing.
    let number = records[id]?.nextVersion ?? 1
    var plan: OfflineVersionPlan
    var apiOrigin: URL?
    switch options.content {
    case .hosted:
      let hosted = try await hostedPlan(options, consuming: true, reuseEstimate: !needsNewGrant)
      if automatic, !canStartAutomaticUpdate(id) { throw CancellationError() }
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
    if records[id]?.pending != nil { await discardPending(id) }
    let now = dependencies.now()
    var record =
      records[id]
      ?? OfflineRegionRecord(id: id, createdAt: now.offlineMilliseconds)
    for (index, download) in plan.downloads.enumerated() {
      try OfflineLayout.write(
        plan.requests[index].body, to: layout.request(id, number, pack: index))
      try OfflineLayout.write(
        download.response, to: layout.download(id, number, download: index))
    }
    record.pending = OfflineVersionRecord(
      number: number, options: json, apiOrigin: apiOrigin?.absoluteString,
      downloads: plan.downloads.count, packs: plan.packs.count, resources: plan.resourceCount,
      billable: plan.billable, bytes: plan.bytes,
      state: .downloading, error: nil, retryAt: nil, createdAt: now.offlineMilliseconds,
      completedAt: nil, automatic: automatic ? true : nil)
    try save(record)
    plans[planKey(id, number)] = plan
    progress[id] = OfflineProgress()
    startRun(id)
    let region = snapshot(record)!
    subscribers.emit(.changed(region))
    return region
  }

  // MARK: Controlling

  func pause(_ id: String) async throws {
    await enterControl(id)
    defer { leaveControl(id) }
    open()
    guard var record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    guard var pending = record.pending, pending.state != .paused else { return }
    pending.state = .paused
    pending.retryAt = nil
    record.pending = pending
    try save(record)
    await stopRun(id, pending)
    emitChanged(id)
  }

  func resume(_ id: String) async throws {
    await enterControl(id)
    defer { leaveControl(id) }
    open()
    guard var record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    guard var pending = record.pending else { return }
    // A waiting download continues now instead of at its retry time.
    let wasWaiting = pending.state == .waiting
    if pending.state != .downloading {
      pending.state = .downloading
      pending.error = nil
      pending.retryAt = nil
      record.pending = pending
      try save(record)
    }
    if wasWaiting { await stopRun(id, pending, cancelTransfers: false) }
    startRun(id)
    emitChanged(id)
  }

  /// Replaces the region's metadata in place, without downloading anything.
  func updateMetadata(_ id: String, _ metadata: [String: String]) throws {
    open()
    guard let record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    try save(Self.replacingMetadata(record, .object(metadata.mapValues(JSONValue.string))))
    emitChanged(id)
  }

  /// Stops the download. A region never completed is removed; an update is abandoned and the
  /// stored version kept.
  func cancel(_ id: String) async throws {
    await enterControl(id)
    defer { leaveControl(id) }
    open()
    guard let record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    guard record.active != nil else { return try await remove(record) }
    guard record.pending != nil else { return }
    await discardPending(id)
    emitChanged(id)
  }

  func remove(_ id: String) async throws {
    await enterControl(id)
    defer { leaveControl(id) }
    open()
    guard let record = records[id], !record.removing else {
      throw TileflowOfflineError(.regionNotFound)
    }
    try await remove(record)
  }

  private func remove(_ existing: OfflineRegionRecord) async throws {
    var record = existing
    record.removing = true
    try save(record)
    if let pending = record.pending { await stopRun(record.id, pending) }
    record.versions.forEach { discardTransfers(record.id, $0) }
    finishRemoval(record.id)
  }

  // MARK: Updates

  /// Revalidates stored Hosted regions that are due: never checked, or checked longer ago than
  /// the service's interval. A revalidation is free and only checks; it downloads nothing, and one
  /// that finds access confirmed restarts the region's validity window, restoring an expired
  /// region. Access ending stops further checks; nothing is removed.
  func checkForUpdates() async {
    open()
    defer { refreshExpiry() }
    guard let client = try? dependencies.client() else { return }
    let now = dependencies.now()
    for id in records.keys.sorted() {
      guard revalidations[id] == nil, let record = records[id], !record.removing, let active = record.active,
        active.downloads > 0
      else { continue }
      if let check = record.check {
        guard check.state != "not_updatable",
          now.offlineMilliseconds >= check.checkedAt + Int64(check.interval * 1000)
        else { continue }
      }
      guard let plan = try? plan(id, active) else { continue }
      let token = UUID()
      revalidations[id] = token
      defer { if revalidations[id] == token { revalidations[id] = nil } }
      guard let states = await revalidate(plan.downloads, client: client, region: id, token: token),
        revalidations[id] == token, var current = records[id], !current.removing,
        current.active?.number == active.number else { continue }
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
      if check.state == "current", dependencies.profile == .native,
        plan.downloads.contains(where: { $0.manifest.profile == OfflinePackProfile.webView.rawValue }) {
        check.state = "update_available"
      }
      check.validatedAt =
        check.state == "not_updatable"
        ? current.check?.validatedAt ?? active.completedAt : check.checkedAt
      current.check = check
      let refused = check.state == "not_updatable" && current.pending?.automatic == true
        ? current.pending?.number : nil
      if refused != nil {
        current.pending?.state = .paused
        current.pending?.retryAt = nil
      }
      guard (try? save(current)) != nil else { continue }
      publishServing()
      emitChanged(id)
      if let refused {
        runs[id]?.task.cancel()
        await enterControl(id)
        defer { leaveControl(id) }
        await discardPending(id) { record, pending in
          self.revalidations[id] == token && pending.number == refused
            && pending.automatic == true && record.check?.state == "not_updatable"
        }
        emitChanged(id)
      }
    }
  }

  /// Every grant must confirm access. A single denial settles the region even if another
  /// partition is unreachable, in either request order.
  private func revalidate(_ downloads: [OfflineDownload], client: OfflinePackClient, region: String, token: UUID)
    async -> [OfflinePackRevalidation]? {
    var confirmations: [OfflinePackRevalidation] = []
    for download in downloads {
      guard revalidations[region] == token else { return nil }
      guard let state = try? await client.revalidate(download.grant) else { continue }
      if case .notUpdatable = state { return [state] }
      confirmations.append(state)
    }
    return confirmations.count == downloads.count ? confirmations : nil
  }

  /// The network returned: waiting downloads try again now and due regions are revalidated.
  func networkDidConnect() async {
    open()
    for id in Array(records.keys) {
      await enterControl(id)
      defer { leaveControl(id) }
      if let record = records[id], !record.removing, let pending = record.pending, pending.state == .waiting,
        pending.error?.code == TileflowOfflineError.Code.network.rawValue
      {
        await stopRun(id, pending, cancelTransfers: false)
        startRun(id)
      }
    }
    await checkForUpdates()
    if settings.automaticUpdates { await updateAutomatically(dependencies.conditions()) }
  }

  // MARK: Expiry

  /// Reports what time changed since the last look: maps stop using a region whose grace period
  /// ended, and each region that entered its grace period or expired is reported as changed.
  private func refreshExpiry() {
    let now = dependencies.now()
    let changed = records.keys.sorted().filter { id in
      guard let record = records[id], !record.removing else { return false }
      return expiryPhase(record, at: now) != phases[id]
    }
    guard !changed.isEmpty else { return }
    publishServing()
    for id in changed { emitChanged(id) }
  }

  /// How long until the store should look again: when a region is due for revalidation, expires
  /// or ends its grace period, and at most ``wakeLimit``. A region already due waits for the next
  /// look or for the network to return.
  func nextWake() -> TimeInterval {
    open()
    let now = dependencies.now()
    var next = now.addingTimeInterval(Self.wakeLimit)
    for record in records.values where !record.removing {
      guard let validated = validatedAt(record) else { continue }
      var times = [
        OfflineServingRule.expiry.expiresAt(validated),
        OfflineServingRule.expiry.gracePeriodEndsAt(validated),
      ]
      if let check = record.check, check.state != "not_updatable" {
        times.append(Date(offlineMilliseconds: check.checkedAt + Int64(check.interval * 1000)))
      }
      for time in times where time > now { next = min(next, time) }
    }
    return next.timeIntervalSince(now)
  }

  // MARK: Automatic updates

  func automaticUpdatesEnabled() -> Bool {
    open()
    return settings.automaticUpdates
  }

  /// Turns automatic updates on or off, and asks the system to run them, or stops asking. Nothing
  /// changes when the system refuses to schedule them.
  func setAutomaticUpdates(_ enabled: Bool) throws {
    open()
    if enabled {
      try dependencies.scheduler?.schedule(earliest: nextAutomaticUpdate())
    } else {
      dependencies.scheduler?.cancel()
    }
    var next = settings
    next.automaticUpdates = enabled
    try next.write(layout.settings)
    settings = next
  }

  /// When the system should next run automatic updates: a day after the last run, or now.
  private func nextAutomaticUpdate() -> Date {
    let now = dependencies.now()
    guard let last = settings.lastAutomaticUpdate else { return now }
    return max(
      now, Date(offlineMilliseconds: last).addingTimeInterval(Self.automaticUpdateInterval))
  }

  private func hasAutomaticAccess(_ record: OfflineRegionRecord) -> Bool {
    record.check?.state != "not_updatable" && expiryPhase(record, at: dependencies.now()) == .valid
  }

  private func canStartAutomaticUpdate(_ id: String) -> Bool {
    guard settings.automaticUpdates, let record = records[id], !record.removing, record.pending == nil,
      let active = record.active, active.downloads > 0, let check = record.check, check.state == "update_available",
      hasAutomaticAccess(record) else { return false }
    // If a due revalidation failed, its earlier offer cannot authorize a fresh download.
    return dependencies.now() < Date(offlineMilliseconds: check.checkedAt).addingTimeInterval(check.interval)
  }

  /// One automatic update pass: when automatic updates are on and `conditions` allow them, due
  /// regions are revalidated and each Hosted region with an update available downloads it, exactly
  /// as loading it again would, but only on unmetered networks. The stored version serves until
  /// the update completes. Returns the regions whose update started.
  @discardableResult
  func updateAutomatically(_ conditions: OfflineUpdateConditions) async -> [String] {
    open()
    guard settings.automaticUpdates, conditions.allowsUpdates else { return [] }
    var next = settings
    next.lastAutomaticUpdate = dependencies.now().offlineMilliseconds
    try? next.write(layout.settings)
    settings = next
    await checkForUpdates()
    var started: [String] = []
    for id in records.keys.sorted() {
      guard canStartAutomaticUpdate(id), let active = records[id]?.active,
        let options = TileflowOfflineRegionLoadOptions(json: active.options)
      else { continue }
      do {
        _ = try await load(id, options, automatic: true)
        started.append(id)
      } catch {
        // A refusal leaves the stored version as it is; the next pass tries again.
        continue
      }
    }
    return started
  }

  /// A scheduled run: one pass, then the next request, a day later, or an hour later when the
  /// network or power held the pass back.
  func runScheduledUpdates() async {
    let last = settings.lastAutomaticUpdate
    await updateAutomatically(dependencies.conditions())
    guard settings.automaticUpdates else { return }
    let earliest =
      settings.lastAutomaticUpdate == last
      ? dependencies.now().addingTimeInterval(Self.automaticUpdateRetry) : nextAutomaticUpdate()
    try? dependencies.scheduler?.schedule(earliest: earliest)
  }

  // MARK: Downloading

  private func enterControl(_ id: String) async {
    guard controls[id] != nil else {
      controls[id] = []
      return
    }
    await withCheckedContinuation { controls[id]!.append($0) }
  }

  private func leaveControl(_ id: String) {
    if controls[id]?.isEmpty == false {
      controls[id]!.removeFirst().resume()
    } else {
      controls[id] = nil
    }
  }

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
    async
  {
    let task = runs[id]?.task
    task?.cancel()
    if cancelTransfers { dependencies.fetcher.cancel(prefix: transferPrefix(id, version.number)) }
    await task?.value
  }

  /// Stops the version's transfers and forgets what they received.
  private func discardTransfers(_ id: String, _ version: OfflineVersionRecord) {
    let prefix = transferPrefix(id, version.number)
    dependencies.fetcher.discard(prefix: prefix)
    layout.packs.removeIncoming(prefix: prefix)
  }

  private func drive(_ id: String) async {
    var renewals = 0
    var attempt = 0
    var waited = false
    while !Task.isCancelled {
      guard let record = records[id], !record.removing, let pending = record.pending,
        [.downloading, .waiting].contains(pending.state)
      else { return }
      if pending.automatic == true, !hasAutomaticAccess(record) {
        return update(id) { $0.fail(.init(.accessDenied)) }
      }
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
      let packs = layout.packs
      let remaining = plan.resources.filter { stored[$0.key.digest] == nil }
      // A logged pack whose file is gone is downloaded again.
      let remainingPacks = plan.packs.filter { planned in
        guard let digest = stored[planned.key]?.pack else { return true }
        return packs.size(digest) == nil
      }
      progress[id] = OfflineProgress(stored.values)
      if remaining.isEmpty, remainingPacks.isEmpty {
        activate(id)
        return
      }
      let needed =
        remaining.reduce(Int64(0)) { $0 + Int64($1.bytes ?? 0) }
        + remainingPacks.reduce(Int64(0)) { $0 + Int64($1.pack.bytes) }
      if !OfflineStorage.hasRoom(
        needed + dependencies.reserveBytes, available: dependencies.availableBytes,
        cache: dependencies.cache)
      {
        return update(id) {
          $0.fail(.init(.insufficientStorage, context: .init(limit: Int(clamping: needed))))
        }
      }
      let now = dependencies.now()
      if let expiring = plan.downloads.indices.first(where: { index in
        plan.downloads[index].manifest.downloadExpiresAt.timeIntervalSince(now)
          < Self.renewalMargin && remainingPacks.contains(where: { $0.download == index })
      }) {
        renewals += 1
        guard await renew(id, pending, download: expiring, renewals: renewals) else { return }
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
        concurrency: dependencies.concurrency, packConcurrency: dependencies.packConcurrency,
        now: dependencies.now)
      let options = TileflowOfflineRegionLoadOptions(json: pending.options)
      let job = OfflineDownloadJob(
        prefix: transferPrefix(id, pending.number), plan: plan, pending: remaining,
        pendingPacks: remainingPacks, previous: previousPacks(id, plan),
        activePaths: activePaths(), staging: layout.staging(id, pending.number), packs: packs,
        restriction: options?.networkRestriction ?? .none, unmeteredOnly: pending.automatic == true)
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
      case .renew(let download, let error):
        renewals += 1
        guard renewals <= Self.maximumRenewals else { return update(id) { $0.fail(error) } }
        guard await renew(id, pending, download: download, renewals: renewals) else { return }
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

  private func didStore(_ id: String, _ entries: [(digest: String, entry: OfflineStoredEntry)]) {
    var current = progress[id] ?? OfflineProgress()
    for (_, entry) in entries { current.add(entry) }
    progress[id] = current
    emitChanged(id)
  }

  /// Creates a download of the pending version again. Stored resources and tile packs the new
  /// manifest lists unchanged are kept; other packs it held are offered with `If-None-Match`, so
  /// unchanged ones answer 304. Returns false when the download stopped.
  private func renew(
    _ id: String, _ pending: OfflineVersionRecord, download index: Int, renewals: Int
  ) async -> Bool {
    guard renewals <= Self.maximumRenewals else {
      update(id) { $0.fail(.init(.grantRejected)) }
      return false
    }
    do {
      let client = try dependencies.client()
      var plan = try self.plan(id, pending)
      let download = try await client.create(plan.requests[index])
      guard !Task.isCancelled, let current = records[id]?.pending, current.number == pending.number else {
        return false
      }
      let previousResources = Dictionary(
        plan.resources.map { ($0.key.digest, ($0.bytes, $0.sha256)) },
        uniquingKeysWith: { a, _ in a })
      let previousPacks = Dictionary(
        plan.packs.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
      var downloads = plan.downloads
      downloads[index] = download
      plan = .hosted(downloads: downloads, requests: plan.requests)
      try checkDeviceLimit(id, plan)
      let stored = OfflineProgressLog.read(layout.progress(id, pending.number))
      var kept: [String: OfflineStoredEntry] = [:]
      var offered = candidates[planKey(id, pending.number)] ?? [:]
      for resource in plan.resources {
        guard let entry = stored[resource.key.digest],
          let before = previousResources[resource.key.digest],
          before.0 == resource.bytes, before.1 == resource.sha256
        else { continue }
        kept[resource.key.digest] = entry
      }
      for planned in plan.packs {
        guard let entry = stored[planned.key], let digest = entry.pack else { continue }
        let before = previousPacks[planned.key]
        if planned.download != index
          || (planned.pack.kind == .tiles && before?.release == planned.release
            && before?.pack.url == planned.pack.url && before?.pack.bytes == planned.pack.bytes)
        {
          kept[planned.key] = entry
        } else {
          offered[planned.key] = OfflinePreviousPack(
            digest: digest, url: planned.pack.url, release: before?.release, sameRequest: false)
        }
      }
      try OfflineProgressLog.write(kept, to: layout.progress(id, pending.number))
      try OfflineLayout.write(
        download.response, to: layout.download(id, pending.number, download: index))
      candidates[planKey(id, pending.number)] = offered
      plans[planKey(id, pending.number)] = plan
      forget(id, pending.number)
      plans[planKey(id, pending.number)] = plan
      update(id) {
        $0.packs = plan.packs.count
        $0.resources = plan.resourceCount
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

  /// What the region's stored version, and earlier passes of this one, hold for each pack key.
  private func previousPacks(_ id: String, _ plan: OfflineVersionPlan) -> [String:
    OfflinePreviousPack]
  {
    var result: [String: OfflinePreviousPack] = [:]
    if let active = records[id]?.active, active.downloads > 0,
      let stored = try? self.plan(id, active)
    {
      let log = OfflineProgressLog.read(layout.progress(id, active.number))
      for planned in stored.packs {
        guard let digest = log[planned.key]?.pack else { continue }
        let sameRequest =
          planned.download < plan.requests.count
          && stored.requests[planned.download] == plan.requests[planned.download]
        result[planned.key] = OfflinePreviousPack(
          digest: digest, url: planned.pack.url, release: planned.release,
          sameRequest: sameRequest)
      }
    }
    if let pending = records[id]?.pending {
      result.merge(candidates[planKey(id, pending.number)] ?? [:]) { _, offered in offered }
    }
    return result
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
    let stored = OfflineProgressLog.read(layout.progress(id, pending.number))
    // Every pack the version lists is in the store: a version never activates with a pack gone.
    guard
      plan.packs.allSatisfy({ planned in
        stored[planned.key]?.pack.flatMap { layout.packs.size($0) } != nil
      })
    else { return }
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
    let done = progress[id] ?? storedProgress(id, pending)
    pending.bytes = pending.bytes ?? done.bytes
    pending.loaded = done.loaded
    pending.loadedBytes = done.loadedBytes
    record.retired = record.active
    record.active = pending
    record.pending = nil
    if plan.isHosted {
      let interval = plan.downloads.map(\.manifest.revalidationInterval).min() ?? 86_400
      record.check = OfflineCheckRecord(
        state: "current", reason: nil, checkedAt: now.offlineMilliseconds, interval: interval,
        validatedAt: now.offlineMilliseconds)
    }
    do { try save(record) } catch { return }
    try? FileManager.default.removeItem(at: staging)
    progress[id] = nil
    candidates.removeValue(forKey: planKey(id, pending.number))
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
  private func discardPending(
    _ id: String, when allowed: (OfflineRegionRecord, OfflineVersionRecord) -> Bool = { _, _ in true }
  ) async {
    guard let before = records[id], let pending = before.pending, allowed(before, pending) else { return }
    await stopRun(id, pending)
    guard var record = records[id], let current = record.pending, current.number == pending.number,
      allowed(record, current) else { return }
    finishPendingDiscard(&record, current)
  }

  private func finishPendingDiscard(_ record: inout OfflineRegionRecord, _ pending: OfflineVersionRecord) {
    discardTransfers(record.id, pending)
    release(record.id, [pending])
    record.pending = nil
    try? save(record)
    progress[record.id] = nil
  }

  /// Removes the packs and pinned entries of `versions` that no other version references, then
  /// the versions' files.
  private func release(_ id: String, _ versions: [OfflineVersionRecord]) {
    let numbers = Set(versions.map(\.number))
    var keep = Set<String>()
    var keepPacks = Set<String>()
    for (other, record) in records where !record.removing {
      for version in record.versions where other != id || !numbers.contains(version.number) {
        keep.formUnion(keys(other, version))
        keepPacks.formUnion(digests(other, version))
      }
    }
    for version in versions {
      if let plan = try? plan(id, version) {
        dependencies.cache.removePinned(
          plan.resources.lazy.map(\.key).filter { !keep.contains($0.relativePath) })
      }
      layout.packs.remove(digests(id, version).subtracting(keepPacks))
      layout.packs.removeIncoming(prefix: transferPrefix(id, version.number))
      try? FileManager.default.removeItem(at: layout.version(id, version.number))
      forget(id, version.number)
      candidates.removeValue(forKey: planKey(id, version.number))
    }
  }

  /// Drops what the store derived from a version's files.
  private func forget(_ id: String, _ number: Int) {
    let key = planKey(id, number)
    plans.removeValue(forKey: key)
    keySets.removeValue(forKey: key)
    unitSets.removeValue(forKey: key)
    digestSets.removeValue(forKey: key)
    servedSets.removeValue(forKey: key)
    creditSets.removeValue(forKey: key)
  }

  // MARK: Plans

  /// The downloads of `options`: those an estimate created, or new ones. A load consumes what
  /// an estimate created, so loading again later sees the Map as it is then.
  private func hostedPlan(_ options: TileflowOfflineRegionLoadOptions, consuming: Bool = false,
    reuseEstimate: Bool = true)
    async throws -> (plan: OfflineVersionPlan, apiOrigin: URL)
  {
    guard case .hosted(let mapID, let themes) = options.content else {
      throw TileflowOfflineError.options("invalidContent")
    }
    let client = try dependencies.client()
    let requests = try OfflinePackRequest.requests(
      mapID: mapID, themes: themes, geometry: options.geometry, zooms: options.zooms,
      profile: dependencies.profile)
    var downloads: [OfflineDownload] = []
    for request in requests {
      let now = dependencies.now()
      if reuseEstimate, let download = created[request],
        download.manifest.downloadExpiresAt.timeIntervalSince(now) > Self.reuseWindow
      {
        if consuming { created.removeValue(forKey: request) }
        downloads.append(download)
        continue
      }
      let download = try await client.create(request)
      if !consuming { created[request] = download }
      downloads.append(download)
    }
    return (.hosted(downloads: downloads, requests: requests), client.apiOrigin)
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
          id: "plan/" + ResourceDigest.sha256(Data(url.absoluteString.utf8)), url: url, headers: [:],
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
    if version.downloads > 0 {
      guard let origin = version.apiOrigin.flatMap(URL.init(string:)) else {
        throw TileflowOfflineError(.invalidResponse)
      }
      var requests: [OfflinePackRequest] = []
      var downloads: [OfflineDownload] = []
      for index in 0..<version.downloads {
        guard
          let request = OfflinePackRequest(
            json: try Data(contentsOf: layout.request(id, version.number, pack: index)))
        else { throw TileflowOfflineError(.invalidResponse) }
        requests.append(request)
        downloads.append(
          try OfflinePackContract.download(
            Data(contentsOf: layout.download(id, version.number, download: index)),
            request: request, allowsLoopbackHTTP: origin.scheme == "http"))
      }
      plan = .hosted(downloads: downloads, requests: requests)
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

  /// The cache paths of a version's resources.
  private func keys(_ id: String, _ version: OfflineVersionRecord) -> Set<String> {
    let key = planKey(id, version.number)
    if let cached = keySets[key] { return cached }
    guard let plan = try? plan(id, version) else { return [] }
    let paths = Set(plan.resources.map(\.key.relativePath))
    keySets[key] = paths
    return paths
  }

  /// The digests of the packs a version stored.
  private func digests(_ id: String, _ version: OfflineVersionRecord) -> Set<String> {
    let key = planKey(id, version.number)
    if version.state == .complete, let cached = digestSets[key] { return cached }
    let digests = Set(
      OfflineProgressLog.read(layout.progress(id, version.number)).values.compactMap(\.pack))
    if version.state == .complete { digestSets[key] = digests }
    return digests
  }

  /// A version's billable units: each pack's billable resources, under a name equal for the same
  /// pack of the same request and release, which holds the same bytes in any region.
  private func units(_ id: String, _ version: OfflineVersionRecord) -> [String: Int] {
    let key = planKey(id, version.number)
    if let cached = unitSets[key] { return cached }
    guard let plan = try? plan(id, version) else { return [:] }
    let units = Self.units(plan)
    unitSets[key] = units
    return units
  }

  private static func units(_ plan: OfflineVersionPlan) -> [String: Int] {
    var units: [String: Int] = [:]
    for planned in plan.packs { units[unit(planned, plan)] = planned.pack.billableResources }
    return units
  }

  private static func unit(_ planned: OfflinePlannedPack, _ plan: OfflineVersionPlan) -> String {
    let manifest = plan.downloads[planned.download].manifest
    let request = ResourceDigest.sha256(plan.requests[planned.download].body)
    return
      "\(request)\n\(planned.pack.url.absoluteString)\n\(planned.release ?? "d\(manifest.deploymentVersion)")"
  }

  /// The billable units every stored or downloading version holds.
  private func heldUnits(except excluded: String? = nil) -> [String: Int] {
    var held: [String: Int] = [:]
    for (other, record) in records where other != excluded && !record.removing {
      for version in [record.active, record.pending].compactMap({ $0 }) {
        held.merge(units(other, version)) { a, _ in a }
      }
    }
    return held
  }

  /// Cache paths of every stored (active) version.
  private func activePaths() -> Set<String> {
    var paths = Set<String>()
    for (id, record) in records where !record.removing {
      if let active = record.active { paths.formUnion(keys(id, active)) }
    }
    return paths
  }

  /// The device holds at most the plan's limit of billable resources; a version that does not
  /// grow the device's total is always accepted.
  private func checkDeviceLimit(_ id: String, _ plan: OfflineVersionPlan) throws {
    guard let limit = plan.downloads.map(\.manifest.maximumPackResources).min() else { return }
    let others = heldUnits(except: id)
    let mine = records[id]?.active.map { units(id, $0) } ?? [:]
    let next = Self.units(plan)
    let held = others.merging(mine) { a, _ in a }
    func total(_ units: [String: Int]) -> Int { units.values.reduce(0, +) }
    try OfflineDeviceLimit.check(
      deviceTotal: total(held), adding: total(next.filter { held[$0.key] == nil }),
      releasing: total(mine.filter { others[$0.key] == nil && next[$0.key] == nil }),
      limit: limit)
  }

  // MARK: Records

  private func save(_ record: OfflineRegionRecord) throws {
    try record.write(layout.record(record.id))
    if record.removing || records[record.id]?.active?.number != record.active?.number {
      revalidations[record.id] = nil
    }
    records[record.id] = record
  }

  private func update(_ id: String, _ change: (inout OfflineVersionRecord) -> Void) {
    guard !Task.isCancelled, var record = records[id], !record.removing, var pending = record.pending else { return }
    change(&pending)
    record.pending = pending
    try? save(record)
    emitChanged(id)
  }

  private func emitChanged(_ id: String) {
    guard let record = records[id], let region = snapshot(record) else { return }
    phases[id] = expiryPhase(record, at: dependencies.now())
    subscribers.emit(.changed(region))
  }

  private func storedProgress(_ id: String, _ version: OfflineVersionRecord) -> OfflineProgress {
    OfflineProgress(OfflineProgressLog.read(layout.progress(id, version.number)).values)
  }

  /// Options compared as a download sees them: metadata never changes what downloads.
  private static func withoutMetadata(_ options: JSONValue) -> Data {
    guard case .object(var members) = options else { return options.canonical }
    members.removeValue(forKey: "metadata")
    return JSONValue.object(members).canonical
  }

  /// The record with `metadata` in the options of every version it keeps.
  private static func replacingMetadata(_ record: OfflineRegionRecord, _ metadata: JSONValue)
    -> OfflineRegionRecord
  {
    func replaced(_ version: OfflineVersionRecord?) -> OfflineVersionRecord? {
      guard var version, case .object(var members) = version.options else { return version }
      members["metadata"] = metadata
      version.options = .object(members)
      return version
    }
    var record = record
    record.active = replaced(record.active)
    record.pending = replaced(record.pending)
    return record
  }

  private func planKey(_ id: String, _ number: Int) -> String { "\(id)\n\(number)" }

  private func transferPrefix(_ id: String, _ number: Int) -> String {
    "\(ResourceDigest.sha256(Data(id.utf8)).prefix(16))/\(number)/"
  }

  private func snapshot(_ record: OfflineRegionRecord) -> TileflowOfflineRegion? {
    guard !record.removing, let version = record.pending ?? record.active,
      let options = TileflowOfflineRegionLoadOptions(json: version.options)
    else { return nil }
    let downloading = record.pending != nil
    var done = progress[record.id] ?? OfflineProgress()
    if !downloading {
      done = OfflineProgress()
      done.packs = version.packs
      done.count = version.resources
      done.bytes = version.bytes ?? 0
      done.loaded = version.loaded ?? 0
      done.loadedBytes = version.loadedBytes ?? 0
    }
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
    let window = OfflineServingRule.expiry
    let validated = validatedAt(record)
    let expiry: TileflowOfflineRegion.ExpiryState? = validated.map { validated in
      switch window.phase(validated, at: dependencies.now()) {
      case .valid: .valid
      case .gracePeriod: .gracePeriod(endsAt: window.gracePeriodEndsAt(validated))
      case .expired: .expired
      }
    }
    return TileflowOfflineRegion(
      id: record.id, options: options, state: state, isAvailable: isServed(record),
      requiredPackCount: version.packs, completedPackCount: min(done.packs, version.packs),
      requiredResourceCount: version.resources,
      completedResourceCount: min(done.count, version.resources),
      requiredResourceBytes: version.bytes, completedResourceBytes: done.bytes,
      loadedResourceCount: done.loaded, loadedResourceBytes: done.loadedBytes,
      billableResourceCount: version.billable, error: version.error?.error,
      retryDate: version.retryAt.map { Date(offlineMilliseconds: $0) },
      completedAt: record.active?.completedAt.map { Date(offlineMilliseconds: $0) },
      updateState: update, checkedAt: record.check.map { Date(offlineMilliseconds: $0.checkedAt) },
      expiresAt: validated.map(window.expiresAt), expiryState: expiry)
  }
}

extension OfflineVersionRecord {
  fileprivate mutating func fail(_ error: TileflowOfflineError) {
    state = .failed
    self.error = OfflineStoredError(error)
    retryAt = nil
  }
}
