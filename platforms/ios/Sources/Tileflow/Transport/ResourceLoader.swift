import Foundation

struct ResourcePayload: Sendable {
  let bytes: Data
  let status: Int
  let headers: [String: String]
}

/// What the renderer receives: a complete body, or one that is still downloading.
struct ResourceResponse: Sendable {
  enum Body: Sendable {
    case data(Data)
    case stream(AsyncThrowingStream<Data, any Error>)
  }

  let status: Int
  let headers: [String: String]
  let body: Body
}

protocol ResourceLoading: Sendable {
  func load(_ request: URLRequest) async throws -> ResourcePayload
  /// Returns once the response head is known; a successful body may still be downloading.
  func open(_ request: URLRequest) async throws -> ResourceResponse
  func close()
}

extension ResourceLoading {
  func open(_ request: URLRequest) async throws -> ResourceResponse {
    let payload = try await load(request)
    return ResourceResponse(
      status: payload.status, headers: payload.headers, body: .data(payload.bytes))
  }
  func close() {}
}

/// A generation's resource owner. Requests share the process's HTTP client; closing the loader
/// cancels only this generation's requests. Browser cookies and headers never enter it.
///
/// With a cache, a fresh stored response answers without the network, a stale one is revalidated
/// and a successful `GET` is streamed to the renderer while it is written to disk, as
/// `ResourceCacheStore` and `ResourceCachePolicy` describe.
///
/// Only a session bootstrap ends a Hosted map: protected resources the service refuses renew the
/// grant, reload a superseded deployment or wait for a rate limit, as `HostedContract.reaction`
/// describes.
///
/// Downloaded regions answer without a session where `OfflineServingRule` says so: a Hosted map
/// without a usable network serves its protected resources from the regions' packs, and with the
/// network switched off every request is answered from stored entries alone, a miss with 504.
final class ResourceLoader: ResourceLoading, Sendable {
  private let policy: ResourcePolicy
  private let hosted: HostedSession?
  private let apiOrigin: URL?
  private let publicMetadataURLs: Set<URL>
  private let transport: any NativeHTTPTransporting
  private let cache: ResourceCacheStore?
  private let grantScope: ResourceCacheScope?
  private let offline: OfflineServingIndex?
  private let networkEnabled: @Sendable () -> Bool
  private let reachable: @Sendable () -> Bool
  private let onDeploymentSuperseded: (@Sendable () async -> Bool)?
  private let now: @Sendable () -> ContinuousClock.Instant
  private let date: @Sendable () -> Date
  private let pause: @Sendable (Duration) async throws -> Void
  private let rateLimit = RateLimitGate()

  init(
    policy: ResourcePolicy, maximumBytes: Int = 16 * 1024 * 1024,
    hosted: HostedSession? = nil, apiOrigin: URL? = nil, publicMetadataURLs: Set<URL> = [],
    transport: (any NativeHTTPTransporting)? = nil,
    cache: ResourceCacheStore? = nil, grantScope: ResourceCacheScope? = nil,
    offline: OfflineServingIndex? = nil,
    networkEnabled: @escaping @Sendable () -> Bool = { TileflowHTTPClient.shared.isNetworkEnabled },
    reachable: @escaping @Sendable () -> Bool = { OfflineReachability.shared.isReachable },
    onDeploymentSuperseded: (@Sendable () async -> Bool)? = nil,
    now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
    date: @escaping @Sendable () -> Date = { Date() },
    pause: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  ) {
    self.policy = policy
    self.hosted = hosted
    self.apiOrigin = apiOrigin
    self.publicMetadataURLs = publicMetadataURLs
    self.transport =
      transport ?? NativeHTTPTransport(maximumBytes: maximumBytes, lane: .resources)
    self.cache = cache
    self.grantScope = grantScope
    self.offline = offline
    self.networkEnabled = networkEnabled
    self.reachable = reachable
    self.onDeploymentSuperseded = onDeploymentSuperseded
    self.now = now
    self.date = date
    self.pause = pause
  }

  func close() { transport.close() }

  func load(_ request: URLRequest) async throws -> ResourcePayload {
    let response = try await open(request)
    switch response.body {
    case .data(let bytes):
      return ResourcePayload(bytes: bytes, status: response.status, headers: response.headers)
    case .stream(let stream):
      var bytes = Data()
      for try await chunk in stream { bytes.append(chunk) }
      var headers = response.headers
      headers["Content-Length"] = String(bytes.count)
      return ResourcePayload(bytes: bytes, status: response.status, headers: headers)
    }
  }

  func open(_ request: URLRequest) async throws -> ResourceResponse {
    guard var url = request.url else { throw ResourceError.invalidAddress }
    guard request.httpMethod == nil || request.httpMethod == "GET" || request.httpMethod == "HEAD"
    else { throw ResourceError.unsupportedRequest }
    let method = request.httpMethod ?? "GET"
    let range = request.value(forHTTPHeaderField: "Range")
    if let range {
      guard range.range(of: #"^bytes=[0-9]+-[0-9]*$"#, options: .regularExpression) != nil
      else { throw ResourceError.unsupportedRequest }
    }
    let cacheable = cache != nil && method == "GET" && range == nil
    let protected = hosted != nil && !publicMetadataURLs.contains(url) && !isPublicAPIResource(url)
    guard networkEnabled() else {
      return try await storedOnly(url, protected: protected, cacheable: cacheable)
    }
    // A fresh public entry needs neither the network nor a Hosted session.
    if cacheable, let stored = freshPublicEntry(url) { return Self.response(stored) }
    if protected, cacheable,
      OfflineServingRule.hostedUsesPacks(networkEnabled: true, reachable: reachable()),
      let packed = await packEntry(url)
    {
      return Self.response(packed)
    }
    let deadline = now().advanced(by: .seconds(30))
    var redirected = false
    var retried = false
    while true {
      var native = URLRequest(
        url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
      native.httpMethod = method
      if let range { native.setValue(range, forHTTPHeaderField: "Range") }
      var grant: String?
      if let hosted, protected {
        if let gate = rateLimit.until, gate > now(), gate < deadline {
          try await pause(now().duration(to: gate))
        }
        let admission: HostedAdmission
        do {
          admission = try await hosted.authorize(url, publicPolicy: policy)
        } catch let error as TileflowMapError where error == .sessionUnavailable {
          // The service cannot be reached: a downloaded region answers instead.
          if cacheable, let packed = await packEntry(url) { return Self.response(packed) }
          throw error
        }
        grant = admission.grant
        if let grant {
          native.setValue(grant, forHTTPHeaderField: "X-Tileflow-Native-Grant")
          native.timeoutInterval = admission.timeout
        }
      } else {
        try policy.validate(url)
      }
      // Protected entries are read only after the session admitted this request again.
      let key: ResourceCacheKey? =
        !cacheable
        ? nil
        : grant == nil
          ? ResourceCacheKey(url: url, scope: .shared)
          : grantScope.map { ResourceCacheKey(url: url, scope: $0) }
      let stored = key.flatMap(storedEntries)
      if let fresh = stored?.fresh(at: date()) { return Self.response(fresh.resource) }
      if let candidate = stored?.candidate {
        for (name, value) in ResourceCachePolicy.validators(candidate.resource.metadata.headers) {
          native.setValue(value, forHTTPHeaderField: name)
        }
      }
      // A downloaded region's pack entry is revalidated instead of downloaded again.
      let packed = stored == nil && grant != nil && cacheable ? await packEntry(url) : nil
      if let etag = packed?.metadata.headers["ETag"] {
        native.setValue(etag, forHTTPHeaderField: "If-None-Match")
      }
      let response: HTTPResponseStream
      do {
        response = try await transport.open(native)
      } catch {
        if Self.isNetworkFailure(error),
          let fallback = stored?.afterFailure(at: date())?.resource ?? packed
        {
          return Self.response(fallback)
        }
        throw error
      }
      if response.status == 304, let key, let candidate = stored?.candidate {
        response.cancel()
        return Self.response(revalidated(candidate, key: key, headers: response.headers))
      }
      if response.status == 304, let packed {
        response.cancel()
        return Self.response(packed)
      }
      if (500...599).contains(response.status), let fallback = stored?.afterFailure(at: date()) {
        response.cancel()
        return Self.response(fallback.resource)
      }
      if response.status == 200, method == "GET", range == nil {
        // Success never needs a Hosted reaction; stream it while storing it.
        return stream(response, url: url, key: key, protected: grant != nil)
      }
      let payload = ResourcePayload(
        bytes: try await response.collect(), status: response.status,
        headers: Self.rendererHeaders(response.headers, method: method, length: nil))
      if (300...399).contains(payload.status) {
        // Only a Team model's stable address may redirect, once, to its current version.
        guard !redirected, grant == nil, let apiOrigin,
          let target = HostedContract.redirect(
            from: url, location: response.headers["Location"], apiOrigin: apiOrigin)
        else { throw ResourceError.invalidResponse }
        redirected = true
        url = target
        continue
      }
      let complete = ResourceResponse(
        status: payload.status,
        headers: Self.rendererHeaders(
          response.headers, method: method, length: payload.bytes.count),
        body: .data(payload.bytes))
      guard let grant, let hosted else { return complete }
      var reaction = HostedContract.reaction(
        status: payload.status, body: payload.bytes, url: url, refreshed: retried)
      if reaction == .refresh {
        if !retried, await hosted.invalidate(grant: grant) {
          retried = true
          continue
        }
        reaction = HostedContract.reaction(
          status: payload.status, body: payload.bytes, url: url, refreshed: true)
      }
      switch reaction {
      case .none, .refresh:
        return complete
      case .superseded:
        if let onDeploymentSuperseded, await onDeploymentSuperseded() {
          // The reload retires this generation; its renderer never sees the stale failure.
          try await Task.sleep(for: .seconds(10))
          throw ResourceError.disposed
        }
        return complete
      case .rateLimited:
        let delay = HostedContract.retryAfter(response.headers["Retry-After"], now: Date()) ?? 1
        let until = rateLimit.extend(to: now().advanced(by: .seconds(min(delay, 60))))
        guard !retried, until < deadline else { return complete }
        retried = true
      case .quota:
        await hosted.reject(.quotaExceeded)
        throw TileflowMapError.quotaExceeded
      }
    }
  }

  /// Answers from stored entries alone, never the network: a downloaded region's pack for a
  /// protected resource, else a pinned or ambient entry of the shared scope whatever its
  /// freshness. A miss answers 504, as an HTTP cache answers `only-if-cached`.
  private func storedOnly(_ url: URL, protected: Bool, cacheable: Bool) async throws
    -> ResourceResponse
  {
    if cacheable {
      if protected {
        if let packed = await packEntry(url) { return Self.response(packed) }
      } else {
        try policy.validate(url)
        let key = ResourceCacheKey(url: url, scope: .shared)
        if let stored = storedEntries(key), let entry = stored.pinned ?? stored.ambient {
          return Self.response(entry)
        }
      }
    }
    return ResourceResponse(
      status: 504, headers: ["Cache-Control": "no-store", "Content-Length": "0"],
      body: .data(Data()))
  }

  /// A downloaded region's answer for a protected resource, when a region the map may use holds
  /// it or covers it.
  private func packEntry(_ url: URL) async -> StoredResource? {
    guard let offline, let cache, let grantScope else { return nil }
    return await offline.resource(ResourceCacheKey(url: url, scope: grantScope), cache: cache)
  }

  /// Landmarks and Team models are public on the API origin and never carry a grant.
  private func isPublicAPIResource(_ url: URL) -> Bool {
    guard let apiOrigin else { return false }
    return ResourcePolicy.origin(url) == ResourcePolicy.origin(apiOrigin)
      && HostedContract.isPublicAPIResource(url)
  }

  /// A fresh entry in the shared scope for an origin this map may use without a grant.
  private func freshPublicEntry(_ url: URL) -> StoredResource? {
    guard (try? policy.validate(url)) != nil, !publicMetadataURLs.contains(url) else { return nil }
    if let apiOrigin, ResourcePolicy.origin(url) == ResourcePolicy.origin(apiOrigin),
      !HostedContract.isPublicAPIResource(url)
    {
      return nil
    }
    return storedEntries(ResourceCacheKey(url: url, scope: .shared))?.fresh(at: date())?.resource
  }

  private func storedEntries(_ key: ResourceCacheKey) -> StoredEntries? {
    guard let cache else { return nil }
    let pinned = cache.read(key, retention: .pinned)
    let ambient = cache.read(key, retention: .ambient)
    guard pinned != nil || ambient != nil else { return nil }
    return StoredEntries(pinned: pinned, ambient: ambient)
  }

  /// A `304` refreshed the stored headers; the stored body answers.
  private func revalidated(
    _ entry: StoredEntries.Entry, key: ResourceCacheKey, headers: [String: String]
  ) -> StoredResource {
    let old = entry.resource.metadata
    let merged = ResourceCachePolicy.merging(old.headers, notModified: headers)
    let protected = key.scope != .shared
    let metadata = ResourceCacheMetadata(
      url: key.url, status: old.status, headers: merged, responseTime: date(),
      protected: protected, body: (old.bodyLength, old.bodySHA256))
    if CacheDirectives(merged["Cache-Control"]).noStore {
      cache?.remove(key, retention: entry.retention)
    } else {
      cache?.write(key, retention: entry.retention, metadata: metadata, body: entry.resource.body)
    }
    return StoredResource(metadata: metadata, body: entry.resource.body)
  }

  private func stream(
    _ response: HTTPResponseStream, url: URL, key: ResourceCacheKey?, protected: Bool
  ) -> ResourceResponse {
    let headers = Self.rendererHeaders(response.headers, method: "GET", length: nil)
    guard let key, let cache,
      ResourceCachePolicy.isStorable(status: 200, headers: response.headers, protected: protected),
      let writer = cache.writer(for: key, retention: .ambient)
    else { return ResourceResponse(status: 200, headers: headers, body: .stream(response.body)) }
    let responseTime = date()
    let body = CachingBody(response: response, writer: writer) { body in
      ResourceCacheMetadata(
        url: url, status: 200, headers: response.headers, responseTime: responseTime,
        protected: protected, body: body)
    }
    return ResourceResponse(
      status: 200, headers: headers,
      body: .stream(AsyncThrowingStream(unfolding: { try await body.next() })))
  }

  static func response(_ stored: StoredResource) -> ResourceResponse {
    ResourceResponse(
      status: stored.metadata.status,
      headers: rendererHeaders(stored.metadata.headers, method: "GET", length: stored.body.count),
      body: .data(stored.body))
  }

  /// The headers the renderer sees. The WebView must never cache: the native cache is the only one.
  static func rendererHeaders(_ headers: [String: String], method: String, length: Int?)
    -> [String: String]
  {
    var result: [String: String] = [:]
    for name in [
      "Content-Type", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Location",
      "Retry-After", "Tileflow-Fair-Use", "Tileflow-Fair-Use-Notice", "Tileflow-Protection",
    ] {
      if let value = headers[name] { result[name] = value }
    }
    result["Cache-Control"] = "no-store"
    if method == "HEAD" {
      result["Content-Length"] = headers["Content-Length"] ?? "0"
    } else if let length {
      result["Content-Length"] = String(length)
    }
    return result
  }

  /// Failures that a stored response may answer: no connection, not a cancellation or an error
  /// response from the server.
  static func isNetworkFailure(_ error: any Error) -> Bool {
    guard let error = error as? URLError else { return false }
    return error.code != .cancelled
  }
}

/// The pinned and ambient entries for one key, read once per request.
private struct StoredEntries {
  struct Entry {
    let resource: StoredResource
    let retention: ResourceCacheRetention
  }

  let pinned: StoredResource?
  let ambient: StoredResource?

  func fresh(at date: Date) -> Entry? {
    if let pinned, pinned.metadata.isFresh(at: date) {
      return Entry(resource: pinned, retention: .pinned)
    }
    if let ambient, ambient.metadata.isFresh(at: date) {
      return Entry(resource: ambient, retention: .ambient)
    }
    return nil
  }

  /// The entry to revalidate: ambient is written only once a pinned entry went stale.
  var candidate: Entry? {
    if let ambient { return Entry(resource: ambient, retention: .ambient) }
    return pinned.map { Entry(resource: $0, retention: .pinned) }
  }

  /// A pinned entry always answers when the network fails; its owner retires expired content.
  func afterFailure(at date: Date) -> Entry? {
    if let ambient, ambient.metadata.isUsableAfterNetworkFailure(at: date) {
      return Entry(resource: ambient, retention: .ambient)
    }
    return pinned.map { Entry(resource: $0, retention: .pinned) }
  }
}

/// Passes a downloading body through while writing it to the cache. The entry is committed only
/// when the whole body arrived; cancellation, failures and an abandoned stream discard it.
private final class CachingBody: @unchecked Sendable {
  private var iterator: AsyncThrowingStream<Data, any Error>.AsyncIterator
  private let writer: ResourceCacheWriter
  private let cancel: @Sendable () -> Void
  private let metadata: ((length: Int, sha256: String)) -> ResourceCacheMetadata
  private var done = false

  init(
    response: HTTPResponseStream, writer: ResourceCacheWriter,
    metadata: @escaping ((length: Int, sha256: String)) -> ResourceCacheMetadata
  ) {
    iterator = response.body.makeAsyncIterator()
    self.writer = writer
    cancel = response.cancel
    self.metadata = metadata
  }

  deinit {
    if !done {
      writer.abort()
      cancel()
    }
  }

  func next() async throws -> Data? {
    do {
      guard let chunk = try await iterator.next() else {
        done = true
        writer.commit(metadata(writer.body))
        return nil
      }
      writer.append(chunk)
      return chunk
    } catch {
      done = true
      writer.abort()
      throw error
    }
  }
}

/// A delivery rate limit applies to every protected request of one renderer generation.
private final class RateLimitGate: @unchecked Sendable {
  private let lock = NSLock()
  private var value: ContinuousClock.Instant?
  var until: ContinuousClock.Instant? { lock.withLock { value } }
  func extend(to instant: ContinuousClock.Instant) -> ContinuousClock.Instant {
    lock.withLock {
      value = max(value ?? instant, instant)
      return instant
    }
  }
}

extension LoadableMapSource {
  /// The cache scope of resources this map receives with a grant.
  var grantScope: ResourceCacheScope? {
    guard let hosted, let mapID else { return nil }
    return .grant(apiOrigin: hosted.apiOrigin, mapID: mapID)
  }
}
