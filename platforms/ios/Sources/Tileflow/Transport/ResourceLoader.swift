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
final class ResourceLoader: ResourceLoading, Sendable {
  private let policy: ResourcePolicy
  private let hosted: HostedSession?
  private let publicMetadataURLs: Set<URL>
  private let transport: any NativeHTTPTransporting

  init(
    policy: ResourcePolicy, maximumBytes: Int = 16 * 1024 * 1024,
    hosted: HostedSession? = nil, publicMetadataURLs: Set<URL> = [],
    transport: (any NativeHTTPTransporting)? = nil
  ) {
    self.policy = policy
    self.hosted = hosted
    self.publicMetadataURLs = publicMetadataURLs
    self.transport = transport ?? NativeHTTPTransport(maximumBytes: maximumBytes)
  }

  func close() { transport.close() }

  func load(_ request: URLRequest) async throws -> ResourcePayload {
    guard let url = request.url else { throw ResourceError.invalidAddress }
    guard request.httpMethod == nil || request.httpMethod == "GET" || request.httpMethod == "HEAD"
    else { throw ResourceError.unsupportedRequest }
    var native = URLRequest(
      url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    native.httpMethod = request.httpMethod ?? "GET"
    if let range = request.value(forHTTPHeaderField: "Range") {
      guard range.range(of: #"^bytes=[0-9]+-[0-9]*$"#, options: .regularExpression) != nil
      else { throw ResourceError.unsupportedRequest }
      native.setValue(range, forHTTPHeaderField: "Range")
    }
    if let hosted, !publicMetadataURLs.contains(url) {
      let admission = try await hosted.authorize(url, publicPolicy: policy)
      if let grant = admission.grant {
        native.setValue(grant, forHTTPHeaderField: "X-Tileflow-Native-Grant")
        native.timeoutInterval = admission.timeout
      }
    } else {
      try policy.validate(url)
    }
    let payload = try await transport.send(native)
    if native.value(forHTTPHeaderField: "X-Tileflow-Native-Grant") != nil,
      [401, 403, 429].contains(payload.status)
    {
      let error = HostedContract.failure(status: payload.status, body: payload.bytes)
      // A rate-limited resource fails alone; the session and its grant stay usable.
      if HostedContract.isTerminal(error) { await hosted?.reject(error) }
      throw error
    }
    return payload
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
    guard let response = response as? HTTPURLResponse,
      (200...599).contains(response.statusCode), !(300...399).contains(response.statusCode),
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
      "Content-Type", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified", "Retry-After",
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
