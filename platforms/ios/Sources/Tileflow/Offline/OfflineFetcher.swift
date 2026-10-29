import Foundation

/// One resource request of a download. `id` names the transfer across launches, so a transfer the
/// system finished while the app was not running is matched to the resource that asked for it.
struct OfflineFetchRequest: Sendable {
  let id: String
  let url: URL
  let headers: [String: String]
  let allowsExpensiveNetworkAccess: Bool
}

/// A finished transfer. Header names are canonical (`ETag`, `Content-Encoding`, …).
struct OfflineFetchResponse: Sendable {
  let status: Int
  let headers: [String: String]
  /// The body as the platform delivers it, after any content decoding.
  let body: Data
  /// Body bytes as received on the wire, before decoding, when known.
  let wireBytes: Int?
  /// SHA-256 of the body as received, before decoding, when known.
  let wireSHA256: String?
}

/// Moves resource bodies for the downloader. Implementations never follow redirects, store
/// cookies or credentials, or cache responses.
protocol OfflineResourceFetching: Sendable {
  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse
  /// Stops transfers whose identifiers start with `prefix`.
  func cancel(prefix: String)
}

/// Downloads through a background `URLSession`, which keeps transferring while the app is
/// suspended or after the system terminated it, and relaunches the app to deliver the results.
///
/// Each resource is one download task described by its request identifier. A task that finishes
/// without a waiting caller, because the process ended after creating it, is kept until the
/// downloader asks for the same identifier again, and a task still running is joined instead of
/// started twice.
final class OfflineURLSessionFetcher: NSObject, OfflineResourceFetching, URLSessionDownloadDelegate,
  @unchecked Sendable
{
  static let backgroundIdentifier = "dev.tileflow.offline"
  static let maximumBodyBytes = ResourceCacheStore.maximumPinnedEntryBytes
  static let canonicalHeaders = [
    "Cache-Control", "Content-Encoding", "Content-Length", "Content-Type", "Date", "ETag",
    "Expires", "Last-Modified", "Age", "Retry-After", "Tileflow-Fair-Use",
    "Tileflow-Fair-Use-Notice", "Tileflow-Protection",
  ]

  static let shared = OfflineURLSessionFetcher(
    configuration: {
      let configuration = URLSessionConfiguration.background(withIdentifier: backgroundIdentifier)
      configuration.isDiscretionary = false
      configuration.sessionSendsLaunchEvents = true
      return configuration
    }())

  private struct State {
    var waiting: [String: CheckedContinuation<OfflineFetchResponse, any Error>] = [:]
    var running: [String: URLSessionDownloadTask] = [:]
    var finished: [String: Result<OfflineFetchResponse, any Error>] = [:]
    var bodies: [Int: Result<Data, any Error>] = [:]
    var listed = false
    var listeners: [CheckedContinuation<Void, Never>] = []
    var eventsCompletion: (@Sendable () -> Void)?
  }

  private let state = LockedValue(State())
  private var session: URLSession!

  /// `configuration` is a background configuration in production; tests pass an ephemeral one
  /// with stub protocol classes, which background sessions do not support.
  init(configuration: URLSessionConfiguration) {
    super.init()
    configuration.httpCookieStorage = nil
    configuration.urlCredentialStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
    configuration.httpMaximumConnectionsPerHost = 6
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.name = "dev.tileflow.offline"
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    session.getAllTasks { [self] tasks in
      let listeners = state.withLock { state in
        for case let task as URLSessionDownloadTask in tasks {
          guard let id = task.taskDescription, state.running[id] == nil else { continue }
          state.running[id] = task
        }
        state.listed = true
        defer { state.listeners.removeAll() }
        return state.listeners
      }
      for listener in listeners { listener.resume() }
    }
  }

  /// Keeps the system's completion handler until the session has delivered every event.
  func handleEvents(_ completion: @escaping @Sendable () -> Void) {
    state.withLock { $0.eventsCompletion = completion }
  }

  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse {
    try Task.checkCancellation()
    guard TileflowHTTPClient.shared.isNetworkEnabled else {
      throw URLError(.notConnectedToInternet)
    }
    await listed()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let action: (() -> Void)? = state.withLock { state in
          if let result = state.finished.removeValue(forKey: request.id) {
            return { continuation.resume(with: result) }
          }
          state.waiting[request.id] = continuation
          if state.running[request.id] != nil { return nil }
          var urlRequest = URLRequest(url: request.url)
          urlRequest.httpShouldHandleCookies = false
          urlRequest.allowsExpensiveNetworkAccess = request.allowsExpensiveNetworkAccess
          for (name, value) in request.headers {
            urlRequest.setValue(value, forHTTPHeaderField: name)
          }
          let task = session.downloadTask(with: urlRequest)
          task.taskDescription = request.id
          state.running[request.id] = task
          return { task.resume() }
        }
        action?()
      }
    } onCancel: {
      cancel(id: request.id)
    }
  }

  func cancel(prefix: String) {
    let tasks = state.withLock { state in
      state.finished = state.finished.filter { !$0.key.hasPrefix(prefix) }
      return state.running.filter { $0.key.hasPrefix(prefix) }.map(\.value)
    }
    for task in tasks { task.cancel() }
  }

  private func cancel(id: String) {
    let task = state.withLock { $0.running[id] }
    task?.cancel()
  }

  private func listed() async {
    await withCheckedContinuation { continuation in
      let ready = state.withLock { state in
        if !state.listed { state.listeners.append(continuation) }
        return state.listed
      }
      if ready { continuation.resume() }
    }
  }

  // MARK: URLSessionDownloadDelegate

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    // The file is removed when this method returns; read it now.
    let body: Result<Data, any Error>
    let size =
      (try? FileManager.default.attributesOfItem(atPath: location.path)[.size] as? Int) ?? 0
    if size > Self.maximumBodyBytes {
      body = .failure(
        TileflowOfflineError(.invalidResponse, context: .init(reason: "resourceTooLarge")))
    } else {
      body = Result { try Data(contentsOf: location) }
    }
    state.withLock { $0.bodies[downloadTask.taskIdentifier] = body }
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) {
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask, didCompleteWithError error: (any Error)?
  ) {
    let body = state.withLock { $0.bodies.removeValue(forKey: task.taskIdentifier) }
    let result: Result<OfflineFetchResponse, any Error>
    if let error {
      result = .failure(error)
    } else if let response = task.response as? HTTPURLResponse {
      var headers: [String: String] = [:]
      for name in Self.canonicalHeaders {
        if let value = response.value(forHTTPHeaderField: name) { headers[name] = value }
      }
      switch body ?? .success(Data()) {
      case .success(let data):
        // A completed transfer received exactly its `Content-Length`, which counts encoded bytes.
        let received = headers["Content-Length"].flatMap(Int.init) ?? Int(task.countOfBytesReceived)
        result = .success(
          OfflineFetchResponse(
            status: response.statusCode, headers: headers, body: data,
            wireBytes: headers["Content-Encoding"] == nil
              ? data.count : (received > 0 ? received : nil),
            wireSHA256: nil))
      case .failure(let error):
        result = .failure(error)
      }
    } else {
      result = .failure(URLError(.badServerResponse))
    }
    guard let id = task.taskDescription else { return }
    let continuation = state.withLock { state in
      if state.running[id] === task { state.running.removeValue(forKey: id) }
      let continuation = state.waiting.removeValue(forKey: id)
      if continuation == nil, !isCancellation(result) { state.finished[id] = result }
      return continuation
    }
    continuation?.resume(with: result)
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    let completion = state.withLock { state in
      defer { state.eventsCompletion = nil }
      return state.eventsCompletion
    }
    if let completion { DispatchQueue.main.async { completion() } }
  }

  private func isCancellation(_ result: Result<OfflineFetchResponse, any Error>) -> Bool {
    if case .failure(let error as URLError) = result { return error.code == .cancelled }
    return false
  }
}
