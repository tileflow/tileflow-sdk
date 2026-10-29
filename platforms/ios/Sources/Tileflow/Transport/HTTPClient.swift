import Foundation

/// A response whose body arrives as it downloads. Headers are the server's, filtered to those the
/// SDK reads; ``ResourceLoader`` decides what the renderer sees.
struct HTTPResponseStream: Sendable {
  let status: Int
  let headers: [String: String]
  let body: AsyncThrowingStream<Data, any Error>
  /// Stops the download. Safe to call at any time, also after it finished.
  let cancel: @Sendable () -> Void

  static func complete(_ payload: ResourcePayload) -> HTTPResponseStream {
    HTTPResponseStream(
      status: payload.status, headers: payload.headers,
      body: AsyncThrowingStream {
        $0.yield(payload.bytes)
        $0.finish()
      }, cancel: {})
  }

  /// The whole body. The transport already bounds its size.
  func collect() async throws -> Data {
    var data = Data()
    do {
      for try await chunk in body { data.append(chunk) }
    } catch {
      cancel()
      throw error
    }
    return data
  }
}

/// Internal HTTP owner. Only native code constructs these requests; the renderer cannot supply
/// arbitrary methods or headers.
protocol NativeHTTPTransporting: Sendable {
  func send(_ request: URLRequest) async throws -> ResourcePayload
  /// Returns once the response head arrives; the body follows as it downloads.
  func open(_ request: URLRequest) async throws -> HTTPResponseStream
  func close()
}

extension NativeHTTPTransporting {
  func open(_ request: URLRequest) async throws -> HTTPResponseStream {
    .complete(try await send(request))
  }
}

/// The process's HTTP client. One `URLSession` per lane is shared by every map: resource requests
/// share connections across mounts and maps, and session requests never wait behind resources.
/// Neither lane stores cookies, credentials or responses; the resource cache is the only cache.
final class TileflowHTTPClient: @unchecked Sendable {
  enum Lane: Sendable {
    /// Map resources: at most ``maximumConcurrentResources`` in flight in the process.
    case resources
    /// Session bootstraps and other small control requests.
    case sessions
  }

  static let shared = TileflowHTTPClient()
  static let maximumConcurrentResources = 16

  let resourceSlots = AsyncSemaphore(TileflowHTTPClient.maximumConcurrentResources)
  private let delegate = HTTPSessionDelegate()
  private let resourceSession: URLSession
  private let controlSession: URLSession
  private let network = LockedValue(true)

  /// `protocolClasses` replaces the system's URL loading, for tests.
  init(protocolClasses: [AnyClass]? = nil) {
    func configuration(connections: Int, total: TimeInterval) -> URLSessionConfiguration {
      let configuration = URLSessionConfiguration.ephemeral
      configuration.httpCookieStorage = nil
      configuration.urlCredentialStorage = nil
      configuration.httpShouldSetCookies = false
      configuration.urlCache = nil
      configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
      configuration.httpMaximumConnectionsPerHost = connections
      configuration.timeoutIntervalForRequest = 30
      configuration.timeoutIntervalForResource = total
      if let protocolClasses { configuration.protocolClasses = protocolClasses }
      return configuration
    }
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.name = "dev.tileflow.http"
    resourceSession = URLSession(
      configuration: configuration(connections: 6, total: 120), delegate: delegate,
      delegateQueue: queue)
    controlSession = URLSession(
      configuration: configuration(connections: 2, total: 30), delegate: delegate,
      delegateQueue: queue)
  }

  /// When false, every request fails as if the device were offline. Lets tests and a strict
  /// offline mode prove that only stored resources are used.
  var isNetworkEnabled: Bool {
    get { network.withLock { $0 } }
    set { network.withLock { $0 = newValue } }
  }

  fileprivate func start(
    _ request: URLRequest, lane: Lane, transfer: HTTPTransfer
  ) {
    let session = lane == .resources ? resourceSession : controlSession
    let task = session.dataTask(with: request)
    delegate.register(transfer, for: task)
    transfer.start(task)
  }
}

/// A handle on the shared client for one owner, such as a renderer generation or a Hosted
/// session. Closing it cancels only that owner's requests.
final class NativeHTTPTransport: NativeHTTPTransporting {
  private let maximumBytes: Int
  private let lane: TileflowHTTPClient.Lane
  private let client: TileflowHTTPClient
  private let active = LockedValue<(closed: Bool, transfers: [ObjectIdentifier: HTTPTransfer])>(
    (false, [:]))

  init(
    maximumBytes: Int, lane: TileflowHTTPClient.Lane = .sessions,
    client: TileflowHTTPClient = .shared
  ) {
    self.maximumBytes = maximumBytes
    self.lane = lane
    self.client = client
  }

  deinit { close() }

  func close() {
    let transfers = active.withLock { state in
      state.closed = true
      defer { state.transfers.removeAll() }
      return Array(state.transfers.values)
    }
    for transfer in transfers { transfer.cancel() }
  }

  func send(_ request: URLRequest) async throws -> ResourcePayload {
    let response = try await open(request)
    let bytes = try await response.collect()
    var headers = response.headers
    headers["Content-Length"] =
      request.httpMethod == "HEAD" ? response.headers["Content-Length"] ?? "0" : String(bytes.count)
    return ResourcePayload(bytes: bytes, status: response.status, headers: headers)
  }

  func open(_ request: URLRequest) async throws -> HTTPResponseStream {
    try Task.checkCancellation()
    guard !active.withLock({ $0.closed }) else { throw ResourceError.disposed }
    guard client.isNetworkEnabled else { throw URLError(.notConnectedToInternet) }
    let slots = lane == .resources ? client.resourceSlots : nil
    try await slots?.acquire()
    let transfer = HTTPTransfer(
      maximumBytes: maximumBytes, isHead: request.httpMethod == "HEAD")
    let identity = ObjectIdentifier(transfer)
    transfer.onFinish = { [weak self] in
      slots?.release()
      self?.active.withLock { _ = $0.transfers.removeValue(forKey: identity) }
    }
    let admitted = active.withLock { state in
      guard !state.closed else { return false }
      state.transfers[identity] = transfer
      return true
    }
    guard admitted else {
      slots?.release()
      throw ResourceError.disposed
    }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        transfer.awaitHead(continuation)
        client.start(request, lane: lane, transfer: transfer)
      }
    } onCancel: {
      transfer.cancel()
    }
  }
}

/// One request. URLSession callbacks, consumers and cancellation can race; every mutable field is
/// protected by the lock, and continuations and URLSession methods run after releasing it.
private final class HTTPTransfer: @unchecked Sendable {
  private enum State {
    case waiting(CheckedContinuation<HTTPResponseStream, any Error>?)
    case streaming(AsyncThrowingStream<Data, any Error>.Continuation)
    case finished
  }

  private static let forwardedHeaders = [
    "Content-Type", "Content-Range", "Accept-Ranges", "Content-Length", "Content-Encoding",
    "ETag", "Last-Modified", "Cache-Control", "Expires", "Date", "Age", "Vary", "Location",
    "Retry-After", "Tileflow-Fair-Use", "Tileflow-Fair-Use-Notice", "Tileflow-Protection",
  ]

  private let lock = NSLock()
  private let maximumBytes: Int
  private let isHead: Bool
  private var task: URLSessionDataTask?
  private var state: State = .waiting(nil)
  private var received = 0
  private var pendingError: (any Error)?
  var onFinish: (@Sendable () -> Void)?

  init(maximumBytes: Int, isHead: Bool) {
    self.maximumBytes = maximumBytes
    self.isHead = isHead
  }

  func awaitHead(_ continuation: CheckedContinuation<HTTPResponseStream, any Error>) {
    lock.lock()
    if let error = pendingError {
      state = .finished
      lock.unlock()
      continuation.resume(throwing: error)
      return
    }
    state = .waiting(continuation)
    lock.unlock()
  }

  func start(_ task: URLSessionDataTask) {
    lock.lock()
    self.task = task
    let finished = pendingError != nil
    lock.unlock()
    if finished {
      task.cancel()
      finishOnce()
    } else {
      task.resume()
    }
  }

  func receive(_ response: URLResponse) -> Bool {
    // Redirects are returned, never followed; the resource owner decides whether one is allowed.
    guard let response = response as? HTTPURLResponse,
      (200...599).contains(response.statusCode),
      isHead || response.expectedContentLength <= maximumBytes
    else {
      fail(ResourceError.invalidResponse)
      return false
    }
    var headers: [String: String] = [:]
    for name in Self.forwardedHeaders {
      if let value = response.value(forHTTPHeaderField: name) { headers[name] = value }
    }
    var streamContinuation: AsyncThrowingStream<Data, any Error>.Continuation!
    let body = AsyncThrowingStream<Data, any Error>(bufferingPolicy: .unbounded) {
      streamContinuation = $0
    }
    streamContinuation.onTermination = { [weak self] termination in
      if case .cancelled = termination { self?.cancel() }
    }
    lock.lock()
    guard case .waiting(let head) = state, let head else {
      lock.unlock()
      return false
    }
    state = .streaming(streamContinuation)
    lock.unlock()
    head.resume(
      returning: HTTPResponseStream(
        status: response.statusCode, headers: headers, body: body,
        cancel: { [weak self] in self?.cancel() }))
    return true
  }

  func append(_ chunk: Data) {
    lock.lock()
    guard case .streaming(let continuation) = state else {
      lock.unlock()
      return
    }
    received += chunk.count
    let oversized = received > maximumBytes
    lock.unlock()
    if oversized {
      fail(ResourceError.responseTooLarge)
    } else {
      continuation.yield(chunk)
    }
  }

  func complete(_ error: (any Error)?) {
    if let error {
      fail(error)
      return
    }
    lock.lock()
    let current = state
    state = .finished
    lock.unlock()
    switch current {
    case .streaming(let continuation):
      continuation.finish()
    case .waiting(let head):
      head?.resume(throwing: ResourceError.invalidResponse)
    case .finished:
      return
    }
    finishOnce()
  }

  func cancel() { fail(CancellationError()) }

  private func fail(_ error: any Error) {
    lock.lock()
    let current = state
    let task = self.task
    if case .waiting(nil) = current, pendingError == nil { pendingError = error }
    if case .finished = current {
      lock.unlock()
      return
    }
    state = .finished
    lock.unlock()
    task?.cancel()
    switch current {
    case .waiting(let head):
      head?.resume(throwing: error)
    case .streaming(let continuation):
      continuation.finish(throwing: error)
    case .finished:
      break
    }
    finishOnce()
  }

  private var reportedFinish = false
  private func finishOnce() {
    lock.lock()
    let first = !reportedFinish
    reportedFinish = true
    let callback = onFinish
    lock.unlock()
    if first { callback?() }
  }
}

/// The dictionary is accessed by both callers and URLSession's serial delegate queue.
private final class HTTPSessionDelegate: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private var transfers: [ObjectIdentifier: HTTPTransfer] = [:]

  func register(_ transfer: HTTPTransfer, for task: URLSessionDataTask) {
    lock.withLock { transfers[ObjectIdentifier(task)] = transfer }
  }

  private func transfer(for task: URLSessionTask, removing: Bool = false) -> HTTPTransfer? {
    lock.withLock {
      removing
        ? transfers.removeValue(forKey: ObjectIdentifier(task)) : transfers[ObjectIdentifier(task)]
    }
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

/// A FIFO counting semaphore for async callers. A cancelled waiter leaves the queue.
final class AsyncSemaphore: @unchecked Sendable {
  private let lock = NSLock()
  private var available: Int
  private var waiters: [(id: UUID, continuation: CheckedContinuation<Void, any Error>)] = []

  init(_ count: Int) { available = count }

  func acquire() async throws {
    let id = UUID()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, any Error>) in
        lock.lock()
        if Task.isCancelled {
          lock.unlock()
          continuation.resume(throwing: CancellationError())
        } else if available > 0 {
          available -= 1
          lock.unlock()
          continuation.resume()
        } else {
          waiters.append((id, continuation))
          lock.unlock()
        }
      }
    } onCancel: {
      lock.lock()
      let index = waiters.firstIndex { $0.id == id }
      let waiter = index.map { waiters.remove(at: $0) }
      lock.unlock()
      waiter?.continuation.resume(throwing: CancellationError())
    }
  }

  func release() {
    lock.lock()
    if waiters.isEmpty {
      available += 1
      lock.unlock()
    } else {
      let waiter = waiters.removeFirst()
      lock.unlock()
      waiter.continuation.resume()
    }
  }

  /// Slots not held by any caller.
  var availableCount: Int { lock.withLock { available } }
}
