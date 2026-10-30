import Foundation

/// One public or self-hosted resource of a region version, under the transport's own cache key.
struct OfflinePlannedResource: Sendable {
  let key: ResourceCacheKey
  /// Exact bytes on the wire, when known before download.
  let bytes: Int?
  /// SHA-256 of those bytes, when known before download.
  let sha256: String?

  var url: URL { key.url }
}

/// One pack of a Hosted region version.
struct OfflinePlannedPack: Sendable {
  /// The download whose grant admits the pack.
  let download: Int
  let pack: OfflineDownloadPack
  /// A tile pack's source release. The same pack of the same request and release holds the same
  /// bytes, so an update keeps it without asking.
  let release: String?
  /// Names the pack in the version's progress log: a corridor's downloads may list one pack id
  /// with different covers.
  let key: String

  init(download: Int, pack: OfflineDownloadPack, release: String?) {
    self.download = download
    self.pack = pack
    self.release = release
    key = DataChannel.digest(Data("\(download)\n\(pack.id)".utf8))
  }
}

/// A version's packs, resources and the authority to download them.
struct OfflineVersionPlan: Sendable {
  var downloads: [OfflineDownload] = []
  var requests: [OfflinePackRequest] = []
  var packs: [OfflinePlannedPack] = []
  var resources: [OfflinePlannedResource] = []
  var tileCounts: [String: Int] = [:]
  var isHosted: Bool { !downloads.isEmpty }

  /// Every pack of every download, and the public files they need once each.
  static func hosted(downloads: [OfflineDownload], requests: [OfflinePackRequest])
    -> OfflineVersionPlan
  {
    var plan = OfflineVersionPlan(downloads: downloads, requests: requests)
    var seen = Set<String>()
    for (index, download) in downloads.enumerated() {
      for source in download.manifest.sources where plan.tileCounts[source.source] == nil {
        plan.tileCounts[source.source] = 0
      }
      for pack in download.manifest.packs {
        let release = pack.source.flatMap { download.manifest.source($0)?.version }
        plan.packs.append(OfflinePlannedPack(download: index, pack: pack, release: release))
        if let source = pack.source { plan.tileCounts[source, default: 0] += pack.resources }
      }
      for resource in download.manifest.publicResources
      where seen.insert(resource.url.absoluteString).inserted {
        plan.resources.append(
          OfflinePlannedResource(
            key: ResourceCacheKey(url: resource.url, scope: .shared), bytes: resource.bytes,
            sha256: resource.sha256))
      }
    }
    return plan
  }

  /// A self-hosted version: the style's documents, then every tile of the cover at each source's
  /// zooms. Sizes are unknown.
  static func selfHosted(
    documents: [URL], sources: [TileflowOfflineTileSource], regions: [OfflinePackRegion],
    zooms: OfflineZooms
  ) -> OfflineVersionPlan {
    var plan = OfflineVersionPlan()
    var seen = Set<String>()
    func add(_ url: URL) -> Bool {
      guard seen.insert(url.absoluteString).inserted else { return false }
      plan.resources.append(
        OfflinePlannedResource(key: ResourceCacheKey(url: url, scope: .shared), bytes: nil, sha256: nil))
      return true
    }
    for url in documents { _ = add(url) }
    for source in sources {
      plan.tileCounts[source.id] = plan.tileCounts[source.id] ?? 0
      guard
        let range = zooms.zooms(
          sourceMinimum: source.minZoom, sourceMaximum: min(source.maxZoom, OfflineZooms.maximum))
      else { continue }
      for zoom in range {
        for region in regions {
          let cover = OfflineTileCover(region, zoom: zoom)
          guard let rows = cover.rows else { continue }
          for y in rows {
            for xs in cover.row(y) {
              for x in xs {
                guard let url = OfflineSelfHosted.tileURL(source.template, z: zoom, x: x, y: y)
                else { continue }
                if add(url) { plan.tileCounts[source.id, default: 0] += 1 }
              }
            }
          }
        }
      }
    }
    return plan
  }

  /// Every resource: each pack's entries and each file.
  var resourceCount: Int { packs.reduce(0) { $0 + $1.pack.resources } + resources.count }
  var billable: Int { packs.reduce(0) { $0 + $1.pack.billableResources } }
  /// Nil when any size is unknown.
  var bytes: Int64? {
    var total = packs.reduce(Int64(0)) { $0 + Int64($1.pack.bytes) }
    for resource in resources {
      guard let bytes = resource.bytes else { return nil }
      total += Int64(bytes)
    }
    return total
  }
}

/// What ended a download pass.
enum OfflineDownloadOutcome: Sendable {
  /// Every pack and resource of the pass is stored.
  case complete
  /// A download's grant expired, its packs are out of date or were asked for too often: create
  /// the download again.
  case renew(download: Int, error: TileflowOfflineError)
  /// A recoverable failure; continue after `delay`, or after a backoff when nil.
  case wait(TileflowOfflineError, delay: TimeInterval?)
  case fail(TileflowOfflineError)
  case cancelled

  fileprivate var severity: Int {
    switch self {
    case .complete: 0
    case .wait: 1
    case .renew: 2
    case .fail: 3
    case .cancelled: 4
    }
  }
}

/// A pack the version a download replaces holds under the same key.
struct OfflinePreviousPack: Sendable {
  let digest: String
  let url: URL
  let release: String?
  /// Whether the replaced version created the pack's download from the same request, so the same
  /// pack of the same release holds the same tiles.
  let sameRequest: Bool
}

/// One pass over a version's missing packs and resources.
struct OfflineDownloadJob: Sendable {
  /// Prefix of every transfer identifier, unique to the region version.
  let prefix: String
  let plan: OfflineVersionPlan
  let pending: [OfflinePlannedResource]
  let pendingPacks: [OfflinePlannedPack]
  /// What a replaced version or an earlier pass holds for each pack key: offered with
  /// `If-None-Match`, or kept without asking when its source's release did not change.
  let previous: [String: OfflinePreviousPack]
  /// Cache paths the stored versions use: changed bodies wait in `staging` until the version
  /// completes, so a stored version never mixes in an unfinished update.
  let activePaths: Set<String>
  let staging: URL
  let packs: OfflinePackStore
  let restriction: TileflowOfflineNetworkRestriction
}

/// Downloads and verifies a version's packs into the pack store and its resources into the
/// pinned partition.
///
/// A pack is kept only when it is exactly the manifest's size, its trailer is the SHA-256 of what
/// precedes it, its `ETag` names that digest and every entry belongs to it: a tile pack's tiles lie
/// in its anchor, zooms and the download's cover, a document pack's names on the download's
/// origins. A stored pack is offered with `If-None-Match`; a `304` keeps it and is not billed. A
/// resource is stored only when its size and SHA-256 match the manifest. Recoverable refusals end
/// the pass with the wait the service asked for; a mismatch is retried twice before the download
/// fails.
struct OfflineDownloader: Sendable {
  static let grantHeader = "X-Tileflow-Offline-Grant"
  /// Stored resources are logged and reported in batches.
  static let batch = 64
  /// Free space is checked again after this many stored resources.
  static let spaceCheck = 16

  let cache: ResourceCacheStore
  let fetcher: any OfflineResourceFetching
  let availableBytes: @Sendable () -> Int64?
  let reserveBytes: Int64
  let concurrency: Int
  /// Packs transferred at once.
  var packConcurrency = 4
  let now: @Sendable () -> Date

  private enum Work: Sendable {
    case resource(OfflinePlannedResource)
    case pack(OfflinePlannedPack)

    var key: String {
      switch self {
      case .resource(let resource): resource.key.digest
      case .pack(let pack): pack.key
      }
    }
  }

  private enum Result: Sendable {
    case stored(OfflineStoredEntry)
    case mismatch
    case outcome(OfflineDownloadOutcome)
  }

  /// Downloads the job's resources, then its packs.
  func run(
    _ job: OfflineDownloadJob, log: OfflineProgressLog,
    progress: @escaping @Sendable ([(digest: String, entry: OfflineStoredEntry)]) async -> Void
  ) async -> OfflineDownloadOutcome {
    let files = await pass(
      job.pending.map(Work.resource), job, concurrency: concurrency, log: log, progress: progress)
    guard case .complete = files else { return files }
    return await pass(
      job.pendingPacks.map(Work.pack), job, concurrency: packConcurrency, log: log,
      progress: progress)
  }

  private func pass(
    _ work: [Work], _ job: OfflineDownloadJob, concurrency: Int, log: OfflineProgressLog,
    progress: @escaping @Sendable ([(digest: String, entry: OfflineStoredEntry)]) async -> Void
  ) async -> OfflineDownloadOutcome {
    var outcome = OfflineDownloadOutcome.complete
    var next = 0
    var retries: [Work] = []
    var mismatches: [String: Int] = [:]
    var stored: [(digest: String, entry: OfflineStoredEntry)] = []
    var sinceCheck = 0

    func record(_ worse: OfflineDownloadOutcome) {
      if worse.severity > outcome.severity { outcome = worse }
    }

    func flush() async {
      guard !stored.isEmpty else { return }
      let entries = stored
      stored.removeAll()
      do {
        try log.append(entries)
      } catch {
        record(.fail(storageError()))
      }
      await progress(entries)
    }

    await withTaskGroup(of: (Work, Result).self) { group in
      var running = 0
      func fill() {
        while running < concurrency, outcome.severity == 0, !Task.isCancelled {
          let item: Work
          if !retries.isEmpty {
            item = retries.removeFirst()
          } else if next < work.count {
            item = work[next]
            next += 1
          } else {
            return
          }
          running += 1
          group.addTask {
            switch item {
            case .resource(let resource): (item, await download(resource, job))
            case .pack(let pack): (item, await download(pack, job))
            }
          }
        }
      }
      fill()
      while let (item, result) = await group.next() {
        running -= 1
        switch result {
        case .stored(let entry):
          stored.append((item.key, entry))
          sinceCheck += entry.resources
          // A pack is a unit of progress worth reporting at once.
          if entry.pack != nil { await flush() }
        case .mismatch:
          mismatches[item.key, default: 0] += 1
          if mismatches[item.key]! >= 3 {
            record(.fail(OfflinePackFormat.invalid))
          } else {
            retries.append(item)
          }
        case .outcome(let failure):
          record(failure)
        }
        if stored.count >= Self.batch { await flush() }
        if sinceCheck >= Self.spaceCheck {
          sinceCheck = 0
          if !OfflineStorage.hasRoom(reserveBytes, available: availableBytes, cache: cache) {
            record(.fail(TileflowOfflineError(.insufficientStorage)))
          }
        }
        if Task.isCancelled { record(.cancelled) }
        fill()
      }
    }
    await flush()
    if Task.isCancelled { return .cancelled }
    if case .complete = outcome, next < work.count || !retries.isEmpty {
      return .cancelled
    }
    return outcome
  }

  // MARK: Packs

  private func download(_ planned: OfflinePlannedPack, _ job: OfflineDownloadJob) async -> Result {
    let pack = planned.pack
    let previous = job.previous[planned.key].flatMap {
      job.packs.size($0.digest) != nil ? $0 : nil
    }
    // The same tiles of the same release under the same request: nothing to ask.
    if let previous, previous.sameRequest, pack.kind == .tiles, previous.release != nil,
      previous.release == planned.release, previous.url == pack.url,
      job.packs.size(previous.digest) == pack.bytes
    {
      return .stored(entry(pack, transferred: false, digest: previous.digest))
    }
    guard
      OfflineStorage.hasRoom(
        Int64(pack.bytes) + reserveBytes, available: availableBytes, cache: cache)
    else { return .outcome(.fail(storageError())) }
    let download = job.plan.downloads[planned.download]
    var headers = [Self.grantHeader: download.grant.value]
    if let previous { headers["If-None-Match"] = "\"\(previous.digest)\"" }
    // A new grant starts a new transfer: a resumed one would present the old grant again.
    let id = job.prefix + planned.key + "." + download.grant.tag
    let destination = job.packs.incoming(id)
    try? FileManager.default.createDirectory(
      at: job.packs.incoming, withIntermediateDirectories: true)
    let response: OfflineFetchResponse
    do {
      response = try await fetcher.fetch(
        OfflineFetchRequest(
          id: id, url: pack.url, headers: headers,
          allowsExpensiveNetworkAccess: job.restriction == .none, destination: destination))
    } catch {
      return .outcome(transferFailure(error))
    }
    switch response.status {
    case 200:
      do {
        let (digest, index) = try OfflinePackFormat.verify(
          destination, bytes: pack.bytes, kind: pack.kind)
        if let tag = response.headers["ETag"], tag != "\"\(digest)\"" {
          throw OfflinePackFormat.invalid
        }
        try Self.check(index, planned, download.manifest)
        try job.packs.adopt(destination, digest: digest)
        return .stored(entry(pack, transferred: true, digest: digest))
      } catch {
        try? FileManager.default.removeItem(at: destination)
        return .mismatch
      }
    case 304 where previous != nil:
      return .stored(entry(pack, transferred: false, digest: previous!.digest))
    case 416:
      // The partial pack no longer matches: start it again.
      try? FileManager.default.removeItem(at: destination)
      return .mismatch
    default:
      return .outcome(failure(response, download: planned.download, job))
    }
  }

  private func entry(_ pack: OfflineDownloadPack, transferred: Bool, digest: String)
    -> OfflineStoredEntry
  {
    OfflineStoredEntry(
      bytes: Int64(pack.bytes), transferred: transferred, resources: pack.resources, pack: digest)
  }

  /// Whether a verified pack holds exactly what its manifest entry promises.
  static func check(
    _ index: OfflinePackIndex, _ planned: OfflinePlannedPack, _ manifest: OfflineDownloadManifest
  ) throws {
    let pack = planned.pack
    guard index.kind == pack.kind, index.entries.count == pack.resources else {
      throw OfflinePackFormat.invalid
    }
    switch pack.kind {
    case .tiles:
      guard let anchor = pack.anchor, let zooms = pack.zooms else {
        throw OfflinePackFormat.invalid
      }
      var covers: [Int: OfflineTileCover] = [:]
      var rows: [Int: [Int: [ClosedRange<Int>]]] = [:]
      for name in index.entries.keys {
        guard let tile = OfflineTileID(name: name), zooms.contains(tile.z),
          tile.ancestor(at: anchor.z) == anchor
        else { throw OfflinePackFormat.invalid }
        let cover = covers[tile.z] ?? OfflineTileCover(manifest.region, zoom: tile.z)
        covers[tile.z] = cover
        let row = rows[tile.z]?[tile.y] ?? cover.row(tile.y)
        rows[tile.z, default: [:]][tile.y] = row
        guard row.contains(where: { $0.contains(tile.x) }) else { throw OfflinePackFormat.invalid }
      }
    case .documents:
      for name in index.entries.keys {
        guard let url = URL(string: name), url.host != nil,
          manifest.origins.contains(ResourcePolicy.origin(url))
        else { throw OfflinePackFormat.invalid }
      }
    }
  }

  // MARK: Resources

  private func download(_ resource: OfflinePlannedResource, _ job: OfflineDownloadJob) async
    -> Result
  {
    let stored = cache.read(resource.key, retention: .pinned)
    if let stored, let sha256 = resource.sha256, stored.metadata.bodySHA256 == sha256 {
      return .stored(.init(bytes: Int64(resource.bytes ?? stored.body.count), transferred: false))
    }
    var headers: [String: String] = [:]
    if let etag = stored?.metadata.headers["ETag"] { headers["If-None-Match"] = etag }
    let response: OfflineFetchResponse
    do {
      response = try await fetcher.fetch(
        OfflineFetchRequest(
          id: job.prefix + resource.key.digest, url: resource.url, headers: headers,
          allowsExpensiveNetworkAccess: job.restriction == .none))
    } catch {
      return .outcome(transferFailure(error))
    }

    switch response.status {
    case 200:
      guard Self.verify(response, resource) else { return .mismatch }
      guard response.body.count <= OfflineURLSessionFetcher.maximumBodyBytes else {
        return .outcome(
          .fail(TileflowOfflineError(.invalidResponse, context: .init(reason: "resourceTooLarge"))))
      }
      let digest = DataChannel.digest(response.body)
      let bytes = Int64(resource.bytes ?? response.body.count)
      let received = OfflineStoredEntry(bytes: bytes, transferred: true)
      if stored?.metadata.bodySHA256 == digest { return .stored(received) }
      let metadata = ResourceCacheMetadata(
        url: resource.url, status: 200, headers: response.headers, responseTime: now(),
        protected: false, body: (response.body.count, digest))
      let written: Bool
      if job.activePaths.contains(resource.key.relativePath) {
        written =
          (try? OfflineLayout.write(
            ResourceCacheEntryFormat.encode(metadata, body: response.body),
            to: job.staging.appendingPathComponent(resource.key.digest))) != nil
      } else {
        written = cache.write(
          resource.key, retention: .pinned, metadata: metadata, body: response.body)
      }
      return written ? .stored(received) : .outcome(.fail(storageError()))
    case 304 where stored != nil:
      return .stored(
        .init(bytes: Int64(resource.bytes ?? stored!.body.count), transferred: false))
    case 204 where !job.plan.isHosted, 404 where !job.plan.isHosted:
      // An absent self-hosted tile or glyph range stays absent offline, as online.
      return .stored(.init(bytes: 0, transferred: false))
    default:
      return .outcome(failure(response, download: nil, job))
    }
  }

  // MARK: Failures

  private func transferFailure(_ error: any Error) -> OfflineDownloadOutcome {
    if let error = error as? TileflowOfflineError { return .fail(error) }
    if Task.isCancelled || error is CancellationError { return .cancelled }
    if let error = error as? URLError, error.code == .cancelled { return .cancelled }
    return .wait(TileflowOfflineError(.network), delay: nil)
  }

  private func failure(
    _ response: OfflineFetchResponse, download: Int?, _ job: OfflineDownloadJob
  ) -> OfflineDownloadOutcome {
    let retryAfter = OfflinePackContract.retryAfter(response.headers["Retry-After"], now: now())
    guard let download else {
      switch response.status {
      case 408, 429, 500...599:
        return .wait(
          TileflowOfflineError(.unavailable, context: .init(status: response.status)),
          delay: retryAfter)
      case 401, 403:
        return .fail(TileflowOfflineError(.accessDenied, context: .init(status: response.status)))
      default:
        return .fail(TileflowOfflineError(.rejected, context: .init(status: response.status)))
      }
    }
    let error = OfflinePackContract.failure(
      status: response.status, body: response.body.prefix(8192),
      retryAfter: response.headers["Retry-After"], operation: .download, now: now())
    switch error.code {
    case .grantRejected, .superseded, .notFound:
      return .renew(download: download, error: error)
    case .accessDenied where error.context.reason == "OFFLINE_PACK_RESOURCE_DENIED":
      return .renew(download: download, error: error)
    case .rateLimited where error.context.reason == "OFFLINE_PACK_REPEAT_LIMIT_REACHED":
      return .renew(download: download, error: error)
    case .rateLimited, .unavailable, .dailyLimitReached:
      return .wait(error, delay: error.retryAfter)
    default:
      return .fail(error)
    }
  }

  private func storageError() -> TileflowOfflineError {
    if let available = availableBytes(), available < reserveBytes {
      return TileflowOfflineError(.insufficientStorage)
    }
    return TileflowOfflineError(.insufficientStorage, context: .init(reason: "writeFailed"))
  }

  /// Whether a body is the manifest's resource, as received or as the platform decoded it.
  static func verify(_ response: OfflineFetchResponse, _ resource: OfflinePlannedResource) -> Bool {
    let tag = etag(response.headers["ETag"])
    // Self-hosted sizes and hashes are unknown before download.
    guard let bytes = resource.bytes else { return true }
    let expected = resource.sha256 ?? tag
    if response.body.count == bytes,
      expected.map({ $0 == DataChannel.digest(response.body) }) ?? true
    {
      return true
    }
    let encoding = response.headers["Content-Encoding"]?.lowercased()
    guard encoding != nil, encoding != "identity", let wire = response.wireBytes, wire == bytes
    else { return false }
    if let received = response.wireSHA256 { return expected.map { $0 == received } ?? true }
    // The platform decoded the body; the service's tag must still name the manifest's hash.
    return resource.sha256.map { $0 == tag } ?? true
  }

  /// The SHA-256 a strong or weak `ETag` names, when it is one.
  static func etag(_ value: String?) -> String? {
    guard var text = value?.trimmingCharacters(in: .whitespaces) else { return nil }
    if text.hasPrefix("W/") { text.removeFirst(2) }
    guard text.count == 66, text.first == "\"", text.last == "\"" else { return nil }
    let digest = text.dropFirst().dropLast().lowercased()
    return digest.allSatisfy({ $0.isHexDigit }) ? digest : nil
  }
}
