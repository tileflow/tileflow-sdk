import Foundation

struct ResourcePayload: Sendable {
  let bytes: Data
  let status: Int
  let headers: [String: String]
}

protocol ResourceLoading: Sendable {
  func load(_ request: URLRequest) async throws -> ResourcePayload
  func close()
}

extension ResourceLoading {
  func close() {}
}

/// A generation owns one ephemeral connection pool. Browser cookies and headers never enter it.
/// Only a session bootstrap ends a Hosted map: protected resources the service refuses renew the
/// grant, reload a superseded deployment or wait for a rate limit, as `HostedContract.reaction`
/// describes.
final class ResourceLoader: ResourceLoading, Sendable {
  private let policy: ResourcePolicy
  private let hosted: HostedSession?
  private let apiOrigin: URL?
  private let publicMetadataURLs: Set<URL>
  private let transport: any NativeHTTPTransporting
  private let onDeploymentSuperseded: (@Sendable () async -> Bool)?
  private let now: @Sendable () -> ContinuousClock.Instant
  private let pause: @Sendable (Duration) async throws -> Void
  private let rateLimit = RateLimitGate()

  init(
    policy: ResourcePolicy, maximumBytes: Int = 16 * 1024 * 1024,
    hosted: HostedSession? = nil, apiOrigin: URL? = nil, publicMetadataURLs: Set<URL> = [],
    transport: (any NativeHTTPTransporting)? = nil,
    onDeploymentSuperseded: (@Sendable () async -> Bool)? = nil,
    now: @escaping @Sendable () -> ContinuousClock.Instant = { ContinuousClock.now },
    pause: @escaping @Sendable (Duration) async throws -> Void = { try await Task.sleep(for: $0) }
  ) {
    self.policy = policy
    self.hosted = hosted
    self.apiOrigin = apiOrigin
    self.publicMetadataURLs = publicMetadataURLs
    self.transport = transport ?? NativeHTTPTransport(maximumBytes: maximumBytes)
    self.onDeploymentSuperseded = onDeploymentSuperseded
    self.now = now
    self.pause = pause
  }

  func close() { transport.close() }

  func load(_ request: URLRequest) async throws -> ResourcePayload {
    guard var url = request.url else { throw ResourceError.invalidAddress }
    guard request.httpMethod == nil || request.httpMethod == "GET" || request.httpMethod == "HEAD"
    else { throw ResourceError.unsupportedRequest }
    let range = request.value(forHTTPHeaderField: "Range")
    if let range {
      guard range.range(of: #"^bytes=[0-9]+-[0-9]*$"#, options: .regularExpression) != nil
      else { throw ResourceError.unsupportedRequest }
    }
    let deadline = now().advanced(by: .seconds(30))
    var redirected = false
    var retried = false
    while true {
      var native = URLRequest(
        url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
      native.httpMethod = request.httpMethod ?? "GET"
      if let range { native.setValue(range, forHTTPHeaderField: "Range") }
      var grant: String?
      if let hosted, !publicMetadataURLs.contains(url), !isPublicAPIResource(url) {
        if let gate = rateLimit.until, gate > now(), gate < deadline {
          try await pause(now().duration(to: gate))
        }
        let admission = try await hosted.authorize(url, publicPolicy: policy)
        grant = admission.grant
        if let grant {
          native.setValue(grant, forHTTPHeaderField: "X-Tileflow-Native-Grant")
          native.timeoutInterval = admission.timeout
        }
      } else {
        try policy.validate(url)
      }
      let payload = try await transport.send(native)
      if (300...399).contains(payload.status) {
        // Only a Team model's stable address may redirect, once, to its current version.
        guard !redirected, grant == nil, let apiOrigin,
          let target = HostedContract.redirect(
            from: url, location: payload.headers["Location"], apiOrigin: apiOrigin)
        else { throw ResourceError.invalidResponse }
        redirected = true
        url = target
        continue
      }
      guard let grant, let hosted else { return payload }
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
        return payload
      case .superseded:
        if let onDeploymentSuperseded, await onDeploymentSuperseded() {
          // The reload retires this generation; its renderer never sees the stale failure.
          try await Task.sleep(for: .seconds(10))
          throw ResourceError.disposed
        }
        return payload
      case .rateLimited:
        let delay = HostedContract.retryAfter(payload.headers["Retry-After"], now: Date()) ?? 1
        let until = rateLimit.extend(to: now().advanced(by: .seconds(min(delay, 60))))
        guard !retried, until < deadline else { return payload }
        retried = true
      case .quota:
        await hosted.reject(.quotaExceeded)
        throw TileflowMapError.quotaExceeded
      }
    }
  }

  /// Landmarks and Team models are public on the API origin and never carry a grant.
  private func isPublicAPIResource(_ url: URL) -> Bool {
    guard let apiOrigin else { return false }
    return ResourcePolicy.origin(url) == ResourcePolicy.origin(apiOrigin)
      && HostedContract.isPublicAPIResource(url)
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

/// Internal HTTP owner. Only native code constructs these requests; the renderer cannot supply
/// arbitrary methods or headers. Session POSTs and resource GETs use separate connection pools.
protocol NativeHTTPTransporting: Sendable {
  func send(_ request: URLRequest) async throws -> ResourcePayload
  func close()
}

final class NativeHTTPTransport: NativeHTTPTransporting {
  private let maximumBytes: Int
  private let delegate: ResourceSessionDelegate
  private let session: URLSession

  init(maximumBytes: Int) {
    self.maximumBytes = maximumBytes
    let delegate = ResourceSessionDelegate()
    self.delegate = delegate
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.urlCredentialStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.httpMaximumConnectionsPerHost = 8
    self.session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
  }

  deinit { session.invalidateAndCancel() }
  func close() { session.invalidateAndCancel() }

  func send(_ request: URLRequest) async throws -> ResourcePayload {
    let transfer = ResourceTransfer(maximumBytes: maximumBytes)
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        let task = session.dataTask(with: request)
        delegate.register(transfer, for: task)
        transfer.start(task, continuation: continuation)
      }
    } onCancel: {
      transfer.cancel()
    }
  }
}

/// URLSession callbacks and Swift cancellation can race. Every mutable field is protected by lock;
/// continuations and URLSession methods are always invoked after releasing it.
private final class ResourceTransfer: @unchecked Sendable {
  private let lock = NSLock()
  private let maximumBytes: Int
  private var task: URLSessionDataTask?
  private var continuation: CheckedContinuation<ResourcePayload, any Error>?
  private var result: Result<ResourcePayload, any Error>?
  private var response: HTTPURLResponse?
  private var data = Data()

  init(maximumBytes: Int) { self.maximumBytes = maximumBytes }

  func start(
    _ task: URLSessionDataTask, continuation: CheckedContinuation<ResourcePayload, any Error>
  ) {
    lock.lock()
    self.task = task
    let result = self.result
    if result == nil { self.continuation = continuation }
    lock.unlock()
    if let result {
      task.cancel()
      continuation.resume(with: result)
    } else {
      task.resume()
    }
  }

  func receive(_ response: URLResponse) -> Bool {
    lock.lock()
    let isHead = task?.originalRequest?.httpMethod == "HEAD"
    lock.unlock()
    // Redirects are returned, never followed; the resource owner decides whether one is allowed.
    guard let response = response as? HTTPURLResponse,
      (200...599).contains(response.statusCode),
      isHead || response.expectedContentLength <= maximumBytes
    else {
      finish(.failure(ResourceError.invalidResponse))
      return false
    }
    lock.lock()
    let active = result == nil
    if active { self.response = response }
    lock.unlock()
    return active
  }

  func append(_ chunk: Data) {
    lock.lock()
    let oversized = result == nil && chunk.count > maximumBytes - data.count
    if result == nil && !oversized { data.append(chunk) }
    lock.unlock()
    if oversized { finish(.failure(ResourceError.responseTooLarge)) }
  }

  func complete(_ error: (any Error)?) {
    if let error {
      finish(.failure(error))
      return
    }
    lock.lock()
    let response = self.response
    let bytes = data
    let isHead = task?.originalRequest?.httpMethod == "HEAD"
    lock.unlock()
    guard let response else {
      finish(.failure(ResourceError.invalidResponse))
      return
    }
    var headers: [String: String] = [:]
    for key in [
      "Content-Type", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Location",
      "Retry-After", "Tileflow-Fair-Use", "Tileflow-Fair-Use-Notice", "Tileflow-Protection",
    ] {
      if let value = response.value(forHTTPHeaderField: key) { headers[key] = value }
    }
    headers["Cache-Control"] = "no-store"
    headers["Content-Length"] =
      isHead
      ? response.value(forHTTPHeaderField: "Content-Length") ?? "0" : String(bytes.count)
    finish(.success(ResourcePayload(bytes: bytes, status: response.statusCode, headers: headers)))
  }

  func cancel() { finish(.failure(CancellationError())) }

  private func finish(_ result: Result<ResourcePayload, any Error>) {
    lock.lock()
    guard self.result == nil else {
      lock.unlock()
      return
    }
    self.result = result
    let continuation = self.continuation
    let task = self.task
    self.continuation = nil
    data = Data()
    lock.unlock()
    if case .failure = result { task?.cancel() }
    continuation?.resume(with: result)
  }
}

/// The dictionary is accessed by both the caller and URLSession's serial delegate queue.
private final class ResourceSessionDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var transfers: [Int: ResourceTransfer] = [:]

  func register(_ transfer: ResourceTransfer, for task: URLSessionDataTask) {
    lock.lock()
    transfers[task.taskIdentifier] = transfer
    lock.unlock()
  }

  private func transfer(for task: URLSessionTask, removing: Bool = false) -> ResourceTransfer? {
    lock.lock()
    defer { lock.unlock() }
    return removing
      ? transfers.removeValue(forKey: task.taskIdentifier) : transfers[task.taskIdentifier]
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
  ) {
    completionHandler(transfer(for: dataTask)?.receive(response) == true ? .allow : .cancel)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    transfer(for: dataTask)?.append(data)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
  ) {
    transfer(for: task, removing: true)?.complete(error)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }
}
