import Foundation

/// One resource request of a download. `id` names the transfer across launches, so a transfer the
/// system finished while the app was not running is matched to the resource that asked for it.
struct OfflineFetchRequest: Sendable {
  let id: String
  let url: URL
  let headers: [String: String]
  let allowsExpensiveNetworkAccess: Bool
  /// When set, a successful body is written to this file instead of returned, and a transfer of
  /// the same identifier that ended part-way resumes where it stopped. The response then answers
  /// 200 for the whole body.
  var destination: URL? = nil
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
  /// A finished body still waiting in the fetcher's directory, before delivery.
  var file: URL? = nil
}

/// Moves resource bodies for the downloader. Implementations never follow redirects, store
/// cookies or credentials, or cache responses.
protocol OfflineResourceFetching: Sendable {
  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse
  /// Stops transfers whose identifiers start with `prefix`, keeping what is needed to resume them.
  func cancel(prefix: String)
  /// Stops transfers whose identifiers start with `prefix` and forgets them.
  func discard(prefix: String)
}

extension OfflineResourceFetching {
  func discard(prefix: String) { cancel(prefix: prefix) }
}

/// Downloads through a background `URLSession`, which keeps transferring while the app is
/// suspended or after the system terminated it, and relaunches the app to deliver the results.
///
/// Each resource is one download task described by its request identifier. A task that finishes
/// without a waiting caller, because the process ended after creating it, is kept until the
/// downloader asks for the same identifier again, and a task still running is joined instead of
/// started twice. A file transfer that stops part-way keeps the system's resume data, so asking
/// for the same identifier again continues it with `Range` and `If-Range`; finished bodies and
/// resume data wait in `directory`.
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
    }(), directory: OfflineLayout.shared.downloads)

  private struct State {
    var waiting: [String: (OfflineFetchRequest, CheckedContinuation<OfflineFetchResponse, any Error>)] =
      [:]
    var running: [String: URLSessionDownloadTask] = [:]
    var finished: [String: Result<OfflineFetchResponse, any Error>] = [:]
    var bodies: [Int: Result<URL, any Error>] = [:]
    var listed = false
    var listeners: [CheckedContinuation<Void, Never>] = []
    var eventsCompletion: (@Sendable () -> Void)?
  }

  private let state = LockedValue(State())
  private var session: URLSession!
  private let directory: URL

  /// `configuration` is a background configuration in production; tests pass an ephemeral one
  /// with stub protocol classes, which background sessions do not support.
  init(configuration: URLSessionConfiguration, directory: URL) {
    self.directory = directory
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
    // Resume data is used once; a transfer that stops again leaves new resume data.
    let resumeData =
      request.destination == nil ? nil : try? Data(contentsOf: resumeFile(request.id))
    if resumeData != nil { try? FileManager.default.removeItem(at: resumeFile(request.id)) }
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let action: (() -> Void)? = state.withLock { state in
          if let result = state.finished.removeValue(forKey: request.id) {
            return { continuation.resume(with: result.flatMap { self.deliver($0, to: request) }) }
          }
          state.waiting[request.id] = (request, continuation)
          if state.running[request.id] != nil { return nil }
          let task: URLSessionDownloadTask
          if let resumeData {
            task = session.downloadTask(withResumeData: resumeData)
          } else {
            var urlRequest = URLRequest(url: request.url)
            urlRequest.httpShouldHandleCookies = false
            urlRequest.allowsExpensiveNetworkAccess = request.allowsExpensiveNetworkAccess
            for (name, value) in request.headers {
              urlRequest.setValue(value, forHTTPHeaderField: name)
            }
            task = session.downloadTask(with: urlRequest)
          }
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
    for task in tasks { cancelKeepingResumeData(task) }
  }

  func discard(prefix: String) {
    let tasks = state.withLock { state in
      state.finished = state.finished.filter { !$0.key.hasPrefix(prefix) }
      return state.running.filter { $0.key.hasPrefix(prefix) }.map(\.value)
    }
    for task in tasks { task.cancel() }
    let name = Self.fileName(prefix)
    let files = FileManager.default
    for file in (try? files.contentsOfDirectory(atPath: directory.path)) ?? []
    where file.hasPrefix(name) {
      try? files.removeItem(at: directory.appendingPathComponent(file))
    }
  }

  private func cancel(id: String) {
    if let task = state.withLock({ $0.running[id] }) { cancelKeepingResumeData(task) }
  }

  private func cancelKeepingResumeData(_ task: URLSessionDownloadTask) {
    guard let id = task.taskDescription else { return task.cancel() }
    let file = resumeFile(id)
    task.cancel { data in
      guard let data else { return }
      try? OfflineLayout.write(data, to: file)
    }
  }

  private static func fileName(_ id: String) -> String {
    id.replacingOccurrences(of: "/", with: "-")
  }

  private func resumeFile(_ id: String) -> URL {
    directory.appendingPathComponent(Self.fileName(id) + ".resume")
  }

  private func bodyFile(_ id: String) -> URL {
    directory.appendingPathComponent(Self.fileName(id) + ".body")
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
    // The file is removed when this method returns; keep it now.
    let body: Result<URL, any Error>
    let size =
      (try? FileManager.default.attributesOfItem(atPath: location.path)[.size] as? Int) ?? 0
    if size > max(Self.maximumBodyBytes, OfflinePackFormat.maximumBytes) {
      body = .failure(
        TileflowOfflineError(.invalidResponse, context: .init(reason: "resourceTooLarge")))
    } else {
      let file = bodyFile(downloadTask.taskDescription ?? UUID().uuidString)
      body = Result {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: location, to: file)
        return file
      }
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
    let id = task.taskDescription
    var result: Result<OfflineFetchResponse, any Error>
    if let error {
      // A transfer that stopped part-way can resume from the system's resume data.
      if let id, let data = (error as NSError).userInfo[NSURLSessionDownloadTaskResumeData] as? Data
      {
        try? OfflineLayout.write(data, to: resumeFile(id))
      }
      result = .failure(error)
    } else if let response = task.response as? HTTPURLResponse {
      var headers: [String: String] = [:]
      for name in Self.canonicalHeaders {
        if let value = response.value(forHTTPHeaderField: name) { headers[name] = value }
      }
      // A resumed transfer delivers the whole file under the partial response's status.
      let status = response.statusCode == 206 ? 200 : response.statusCode
      switch body ?? .failure(URLError(.zeroByteResource)) {
      case .success(let file):
        result = .success(
          OfflineFetchResponse(
            status: status, headers: headers, body: Data(), wireBytes: nil, wireSHA256: nil,
            file: file))
      case .failure(let error) where body != nil:
        result = .failure(error)
      case .failure:
        result = .success(
          OfflineFetchResponse(
            status: status, headers: headers, body: Data(), wireBytes: 0, wireSHA256: nil))
      }
    } else {
      result = .failure(URLError(.badServerResponse))
    }
    guard let id else { return }
    let waiting = state.withLock { state in
      if state.running[id] === task { state.running.removeValue(forKey: id) }
      let waiting = state.waiting.removeValue(forKey: id)
      if waiting == nil, !isCancellation(result) { state.finished[id] = result }
      return waiting
    }
    guard let (request, continuation) = waiting else { return }
    continuation.resume(with: result.flatMap { deliver($0, to: request) })
  }

  /// Hands a finished body over: moved to the request's destination, or read for the caller.
  private func deliver(_ response: OfflineFetchResponse, to request: OfflineFetchRequest) -> Result<
    OfflineFetchResponse, any Error
  > {
    guard let file = response.file else { return .success(response) }
    defer { try? FileManager.default.removeItem(at: file) }
    if let destination = request.destination, response.status == 200 {
      return Result {
        try FileManager.default.createDirectory(
          at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: file, to: destination)
        return OfflineFetchResponse(
          status: 200, headers: response.headers, body: Data(), wireBytes: nil, wireSHA256: nil)
      }
    }
    let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
    guard size <= Self.maximumBodyBytes else {
      return .failure(
        TileflowOfflineError(.invalidResponse, context: .init(reason: "resourceTooLarge")))
    }
    return Result {
      let data = try Data(contentsOf: file)
      // A completed transfer received exactly its `Content-Length`, which counts encoded bytes.
      let received = response.headers["Content-Length"].flatMap(Int.init)
      return OfflineFetchResponse(
        status: response.status, headers: response.headers, body: data,
        wireBytes: response.headers["Content-Encoding"] == nil ? data.count : received,
        wireSHA256: nil)
    }
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
