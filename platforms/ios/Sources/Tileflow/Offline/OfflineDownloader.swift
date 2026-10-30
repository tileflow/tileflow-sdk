import Foundation

/// One resource of a region version, under the transport's own cache key.
struct OfflinePlannedResource: Sendable {
  let key: ResourceCacheKey
  /// Exact bytes on the wire, when known before download.
  let bytes: Int?
  /// SHA-256 of those bytes, when known before download.
  let sha256: String?
  let billable: Bool
  let isPublic: Bool
  /// The Hosted pack whose grant admits it; nil for public and self-hosted resources.
  let pack: Int?

  var url: URL { key.url }
}

/// A version's resources and the authority to download them. Hosted resources a corridor's
/// overlapping packs share are downloaded once, under the first pack that lists them.
struct OfflineVersionPlan: Sendable {
  var packs: [OfflinePack] = []
  var requests: [OfflinePackRequest] = []
  var resources: [OfflinePlannedResource] = []
  var tileCounts: [String: Int] = [:]
  var isHosted: Bool { !packs.isEmpty }

  static func hosted(
    packs: [OfflinePack], requests: [OfflinePackRequest], apiOrigin: URL
  ) -> OfflineVersionPlan {
    var plan = OfflineVersionPlan(packs: packs, requests: requests)
    var seen = Set<String>()
    for (index, pack) in packs.enumerated() {
      let scope = ResourceCacheScope.grant(apiOrigin: apiOrigin, mapID: pack.manifest.mapID)
      for resource in OfflinePlanner.resources(pack.manifest)
      where seen.insert(resource.url.absoluteString).inserted {
        plan.resources.append(
          OfflinePlannedResource(
            key: ResourceCacheKey(url: resource.url, scope: resource.isPublic ? .shared : scope),
            bytes: resource.bytes, sha256: resource.sha256, billable: resource.billable,
            isPublic: resource.isPublic, pack: resource.isPublic ? nil : index))
      }
    }
    // Tiles per source, counted once across packs.
    var counted = Set<String>()
    for pack in packs {
      for set in pack.manifest.tiles {
        for tile in set.entries {
          guard let url = set.url(tile), counted.insert(url.absoluteString).inserted else {
            continue
          }
          plan.tileCounts[set.source, default: 0] += 1
        }
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
        OfflinePlannedResource(
          key: ResourceCacheKey(url: url, scope: .shared), bytes: nil, sha256: nil,
          billable: false, isPublic: true, pack: nil))
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

  var billable: Int { resources.reduce(0) { $0 + ($1.billable ? 1 : 0) } }
  /// Nil when any size is unknown.
  var bytes: Int64? {
    var total: Int64 = 0
    for resource in resources {
      guard let bytes = resource.bytes else { return nil }
      total += Int64(bytes)
    }
    return total
  }
}

/// What ended a download pass.
enum OfflineDownloadOutcome: Sendable {
  /// Every resource of the pass is stored.
  case complete
  /// A pack's grant expired or its manifest is out of date: create the pack again.
  case renew(pack: Int, error: TileflowOfflineError)
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

/// One pass over a version's missing resources.
struct OfflineDownloadJob: Sendable {
  /// Prefix of every transfer identifier, unique to the region version.
  let prefix: String
  let plan: OfflineVersionPlan
  let pending: [OfflinePlannedResource]
  /// Cache paths the stored versions use: changed bodies wait in `staging` until the version
  /// completes, so a stored version never mixes in an unfinished update.
  let activePaths: Set<String>
  let staging: URL
  let restriction: TileflowOfflineNetworkRestriction
}

/// Downloads, verifies and stores resources into the pinned partition.
///
/// A body is stored only when it matches the manifest: as received, or as the platform decoded
/// it, its size and SHA-256 (the manifest's, else the `ETag`'s) agree. A stored copy is offered
/// with `If-None-Match`; a `304` keeps it and is not billed. Recoverable refusals end the pass
/// with the wait the service asked for; a mismatch is retried twice before the download fails.
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
  let now: @Sendable () -> Date

  private enum Result: Sendable {
    case stored(Int64)
    case mismatch
    case outcome(OfflineDownloadOutcome)
  }

  func run(
    _ job: OfflineDownloadJob, log: OfflineProgressLog,
    progress: @escaping @Sendable ([(digest: String, bytes: Int64)]) async -> Void
  ) async -> OfflineDownloadOutcome {
    var outcome = OfflineDownloadOutcome.complete
    var next = 0
    var retries: [OfflinePlannedResource] = []
    var mismatches: [String: Int] = [:]
    var stored: [(digest: String, bytes: Int64)] = []
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

    await withTaskGroup(of: (OfflinePlannedResource, Result).self) { group in
      var running = 0
      func fill() {
        while running < concurrency, outcome.severity == 0, !Task.isCancelled {
          let resource: OfflinePlannedResource
          if !retries.isEmpty {
            resource = retries.removeFirst()
          } else if next < job.pending.count {
            resource = job.pending[next]
            next += 1
          } else {
            return
          }
          running += 1
          group.addTask { (resource, await download(resource, job)) }
        }
      }
      fill()
      while let (resource, result) = await group.next() {
        running -= 1
        switch result {
        case .stored(let bytes):
          stored.append((resource.key.digest, bytes))
          sinceCheck += 1
        case .mismatch:
          mismatches[resource.key.digest, default: 0] += 1
          if mismatches[resource.key.digest]! >= 3 {
            record(
              .fail(
                TileflowOfflineError(.invalidResponse, context: .init(reason: "verificationFailed"))
              ))
          } else {
            retries.append(resource)
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
    if case .complete = outcome, next < job.pending.count || !retries.isEmpty {
      return .cancelled
    }
    return outcome
  }

  private func download(_ resource: OfflinePlannedResource, _ job: OfflineDownloadJob) async
    -> Result
  {
    let stored = cache.read(resource.key, retention: .pinned)
    if let stored, let sha256 = resource.sha256, stored.metadata.bodySHA256 == sha256 {
      return .stored(Int64(resource.bytes ?? stored.body.count))
    }
    var headers: [String: String] = [:]
    if let pack = resource.pack { headers[Self.grantHeader] = job.plan.packs[pack].grant.value }
    if let etag = stored?.metadata.headers["ETag"] { headers["If-None-Match"] = etag }
    let response: OfflineFetchResponse
    do {
      response = try await fetcher.fetch(
        OfflineFetchRequest(
          id: job.prefix + resource.key.digest, url: resource.url, headers: headers,
          allowsExpensiveNetworkAccess: job.restriction == .none))
    } catch let error as TileflowOfflineError {
      return .outcome(.fail(error))
    } catch {
      if Task.isCancelled || error is CancellationError { return .outcome(.cancelled) }
      if let error = error as? URLError, error.code == .cancelled { return .outcome(.cancelled) }
      return .outcome(.wait(TileflowOfflineError(.network), delay: nil))
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
      if stored?.metadata.bodySHA256 == digest { return .stored(bytes) }
      let metadata = ResourceCacheMetadata(
        url: resource.url, status: 200, headers: response.headers, responseTime: now(),
        protected: job.plan.isHosted && !resource.isPublic, body: (response.body.count, digest))
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
      return written ? .stored(bytes) : .outcome(.fail(storageError()))
    case 304 where stored != nil:
      return .stored(Int64(resource.bytes ?? stored!.body.count))
    case 204 where !job.plan.isHosted, 404 where !job.plan.isHosted:
      // An absent self-hosted tile or glyph range stays absent offline, as online.
      return .stored(0)
    default:
      return .outcome(failure(response, resource, job))
    }
  }

  private func failure(
    _ response: OfflineFetchResponse, _ resource: OfflinePlannedResource, _ job: OfflineDownloadJob
  ) -> OfflineDownloadOutcome {
    let retryAfter = OfflinePackContract.retryAfter(response.headers["Retry-After"], now: now())
    guard job.plan.isHosted else {
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
      return .renew(pack: resource.pack ?? 0, error: error)
    case .accessDenied where error.context.reason == "OFFLINE_PACK_RESOURCE_DENIED":
      return .renew(pack: resource.pack ?? 0, error: error)
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
