import Foundation
import UIKit

/// One resource request of a download. `id` names the transfer across launches, so a transfer the
/// system finished while the app was not running is matched to the resource that asked for it.
struct OfflineFetchRequest: Sendable {
  let id: String
  let url: URL
  let headers: [String: String]
  let allowsExpensiveNetworkAccess: Bool
  /// False keeps the transfer off networks in Low Data Mode.
  var allowsConstrainedNetworkAccess = true
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
  /// The URL reported by the transfer service, retained until the authorized request consumes it.
  var finalURL: URL? = nil
}

/// Moves resource bodies for the downloader without cookies, credential storage or HTTP cache.
/// iOS background sessions follow redirects; responses from another origin are discarded.
protocol OfflineResourceFetching: Sendable {
  func fetch(_ request: OfflineFetchRequest) async throws -> OfflineFetchResponse
  /// Whether the system already finished this exact transfer; never starts a request.
  func hasCompleted(id: String) async -> Bool
  /// Stops transfers whose identifiers start with `prefix`, keeping what is needed to resume them.
  func cancel(prefix: String)
  /// Stops transfers whose identifiers start with `prefix` and forgets them.
  func discard(prefix: String)
  /// Calls `handler` with each warning about how transfers run, such as background transfers
  /// being unavailable in this build.
  func onWarning(_ handler: @escaping @Sendable (TileflowOfflineWarning) -> Void)
}

extension OfflineResourceFetching {
  func hasCompleted(id: String) async -> Bool { false }
  func discard(prefix: String) { cancel(prefix: prefix) }
  func onWarning(_ handler: @escaping @Sendable (TileflowOfflineWarning) -> Void) {}
}

/// Whether the app is in the foreground, and how often it went to the background.
protocol OfflineAppActivity: Sendable {
  var isForeground: Bool { get }
  /// Grows each time the app enters the background.
  var backgroundEntries: Int { get }
}

/// The app's activity as UIKit reports it.
final class OfflineUIKitActivity: OfflineAppActivity, Sendable {
  static let shared = OfflineUIKitActivity()

  private let state = LockedValue((foreground: true, entries: 0))

  private init() {
    let state = state
    let center = NotificationCenter.default
    // The process's activity lives as long as the app: the observers are never removed.
    _ = center.addObserver(
      forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: nil
    ) { _ in
      state.withLock {
        $0.foreground = false
        $0.entries += 1
      }
    }
    _ = center.addObserver(
      forName: UIApplication.willEnterForegroundNotification, object: nil, queue: nil
    ) { _ in state.withLock { $0.foreground = true } }
    Task { @MainActor in
      guard UIApplication.shared.applicationState == .background else { return }
      state.withLock {
        $0.foreground = false
        $0.entries += 1
      }
    }
  }

  var isForeground: Bool { state.withLock { $0.foreground } }
  var backgroundEntries: Int { state.withLock { $0.entries } }
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
///
/// A build the system's background transfer service does not accept, such as an unsigned one,
/// never starts a background task: transfers would wait for ever without an error. When transfers
/// that could run on the current network have waited ``startTimeout`` with the app in the
/// foreground the whole time and no background task of the process ever started, the fetcher
/// moves them, and every later one, to a foreground session and warns once
/// (``TileflowOfflineWarning/Code/backgroundTransferUnavailable``). It never decides so while the
/// app is in the background, where the system may defer background transfers.
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

  /// How long transfers that could run wait in the foreground for a background task to start.
  static let startTimeout: TimeInterval = 30

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
    var bodies: [ObjectIdentifier: Result<URL, any Error>] = [:]
    var listed = false
    var listeners: [CheckedContinuation<Void, Never>] = []
    var eventsCompletion: (@Sendable () -> Void)?
    /// A background task of this process received a response or bytes: background transfers work.
    var backgroundStarted = false
    /// Background transfers never started: every transfer runs in the foreground session.
    var fallback = false
    var watching = false
    /// A background transfer that could run was asked for since the watch last looked.
    var attempted = false
    /// Background tasks a foreground one replaced: their completion is ignored.
    var superseded: Set<ObjectIdentifier> = []
    var warning: (@Sendable (TileflowOfflineWarning) -> Void)?
    var warned = false
  }

  private let state = LockedValue(State())
  private var session: URLSession!
  private var foreground: URLSession!
  private let directory: URL
  private let activity: any OfflineAppActivity
  /// Whether the device has a network now, and whether it is neither expensive nor constrained.
  private let network: @Sendable () -> (reachable: Bool, unmetered: Bool)
  private let startTimeout: TimeInterval
  private let wait: @Sendable (TimeInterval) async -> Void

  /// `configuration` is a background configuration in production; tests pass an ephemeral one
  /// with stub protocol classes, which background sessions do not support. Transfers move to a
  /// session of `fallbackConfiguration` when background tasks never start.
  init(
    configuration: URLSessionConfiguration, directory: URL,
    fallbackConfiguration: URLSessionConfiguration = .default,
    activity: any OfflineAppActivity = OfflineUIKitActivity.shared,
    network: @escaping @Sendable () -> (reachable: Bool, unmetered: Bool) = {
      (OfflineReachability.shared.isReachable, OfflineReachability.shared.isUnmetered)
    },
    startTimeout: TimeInterval = OfflineURLSessionFetcher.startTimeout,
    wait: @escaping @Sendable (TimeInterval) async -> Void = {
      try? await Task.sleep(nanoseconds: UInt64($0 * 1_000_000_000))
    }
  ) {
    self.directory = directory
    self.activity = activity
    self.network = network
    self.startTimeout = startTimeout
    self.wait = wait
    super.init()
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    queue.name = "dev.tileflow.offline"
    for configuration in [configuration, fallbackConfiguration] {
      configuration.httpCookieStorage = nil
      configuration.urlCredentialStorage = nil
      configuration.httpShouldSetCookies = false
      configuration.urlCache = nil
      configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
      configuration.httpMaximumConnectionsPerHost = 6
    }
    foreground = URLSession(
      configuration: fallbackConfiguration, delegate: self, delegateQueue: queue)
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

  func onWarning(_ handler: @escaping @Sendable (TileflowOfflineWarning) -> Void) {
    state.withLock { $0.warning = handler }
  }

  func hasCompleted(id: String) async -> Bool {
    await listed()
    return state.withLock { state in
      guard case .success(let response) = state.finished[id] else { return false }
      return response.status == 200 || response.status == 304
    }
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
    let couldRun = couldRun(request)
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        let action: (() -> Void)? = state.withLock { state in
          if let result = state.finished.removeValue(forKey: request.id) {
            return { continuation.resume(with: result.flatMap { self.deliver($0, to: request) }) }
          }
          state.waiting[request.id] = (request, continuation)
          if state.running[request.id] != nil { return nil }
          let task = makeTask(
            request, resumeData: resumeData, in: state.fallback ? foreground : session)
          state.running[request.id] = task
          var watch = false
          if !state.fallback, !state.backgroundStarted {
            if couldRun { state.attempted = true }
            watch = !state.watching
            state.watching = true
          }
          return { [self] in
            task.resume()
            if watch { Task { await self.watch() } }
          }
        }
        action?()
      }
    } onCancel: {
      cancel(id: request.id)
    }
  }

  private func makeTask(
    _ request: OfflineFetchRequest, resumeData: Data?, in session: URLSession
  ) -> URLSessionDownloadTask {
    let task: URLSessionDownloadTask
    if let resumeData {
      task = session.downloadTask(withResumeData: resumeData)
    } else {
      var urlRequest = URLRequest(url: request.url)
      urlRequest.httpShouldHandleCookies = false
      urlRequest.allowsExpensiveNetworkAccess = request.allowsExpensiveNetworkAccess
      urlRequest.allowsConstrainedNetworkAccess = request.allowsConstrainedNetworkAccess
      for (name, value) in request.headers {
        urlRequest.setValue(value, forHTTPHeaderField: name)
      }
      task = session.downloadTask(with: urlRequest)
    }
    task.taskDescription = request.id
    return task
  }

  // MARK: Background transfers that never start

  /// Whether the transfer could run on the network the device has now: one restricted to
  /// unmetered networks waits on a metered one in any build.
  private func couldRun(_ request: OfflineFetchRequest) -> Bool {
    let network = network()
    let unmeteredOnly =
      !request.allowsExpensiveNetworkAccess || !request.allowsConstrainedNetworkAccess
    return network.reachable && (!unmeteredOnly || network.unmetered)
  }

  /// Looks every ``startTimeout`` until a background task starts. A period decides only when the
  /// app was in the foreground for all of it and the device had a network at both ends; then a
  /// background transfer that could run, asked for before the period began or waiting through
  /// it, has had the whole period to start, and the transfers move to the foreground session.
  /// The watch ends after a period with nothing asked for or waiting.
  private func watch() async {
    var period = periodStart()
    while true {
      await wait(startTimeout)
      let end = periodStart()
      let decision: Bool? = state.withLock { state in
        if state.backgroundStarted || state.fallback {
          state.watching = false
          return nil
        }
        let waited = !period.runnable.isDisjoint(with: end.runnable)
        if !period.attempted && !waited && state.running.isEmpty {
          state.watching = false
          return nil
        }
        return period.foreground && end.foreground && period.entries == end.entries
          && period.reachable && end.reachable && (period.attempted || waited)
      }
      guard let decision else { return }
      if decision { return fallBack() }
      period = end
    }
  }

  /// What the watch compares across a period. Taking it consumes the transfers asked for since.
  private func periodStart() -> (
    foreground: Bool, entries: Int, reachable: Bool, attempted: Bool, runnable: Set<String>
  ) {
    let (attempted, waiting) = state.withLock { state in
      defer { state.attempted = false }
      let waiting = state.waiting.filter { id, _ in
        state.running[id].map { $0.taskDescription == id && !state.fallback } ?? false
      }
      return (state.attempted, waiting.map(\.value.0))
    }
    return (
      activity.isForeground, activity.backgroundEntries, network().reachable, attempted,
      Set(waiting.filter(couldRun).map(\.id))
    )
  }

  /// Moves every waiting transfer to the foreground session and warns once.
  private func fallBack() {
    let (moves, warning) = state.withLock { state in
      state.fallback = true
      state.watching = false
      var moves: [(old: URLSessionDownloadTask?, new: URLSessionDownloadTask)] = []
      for (id, (request, _)) in state.waiting {
        let old = state.running[id]
        if let old { state.superseded.insert(ObjectIdentifier(old)) }
        let task = makeTask(request, resumeData: nil, in: foreground)
        state.running[id] = task
        moves.append((old, task))
      }
      let warning = state.warned ? nil : state.warning
      state.warned = true
      return (moves, warning)
    }
    for move in moves {
      move.old?.cancel()
      move.new.resume()
    }
    warning?(
      TileflowOfflineWarning(
        .backgroundTransferUnavailable,
        message:
          "Background downloads never started in this build, as happens when the app is not "
          + "signed, so downloads now run in the foreground and stop while the app is suspended. "
          + "Signed builds download in the background."))
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
    if !Self.sameOrigin(downloadTask.originalRequest?.url, downloadTask.response?.url) {
      try? FileManager.default.removeItem(at: location)
      body = .failure(Self.originFailure)
    } else if size > max(Self.maximumBodyBytes, OfflinePackFormat.maximumBytes) {
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
    state.withLock { state in
      state.bodies[ObjectIdentifier(downloadTask)] = body
      if session === self.session { state.backgroundStarted = true }
    }
  }

  func urlSession(
    _ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64
  ) {
    guard session === self.session else { return }
    state.withLock { $0.backgroundStarted = true }
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
    let (body, superseded) = state.withLock { state in
      if session === self.session, task.response != nil { state.backgroundStarted = true }
      return (
        state.bodies.removeValue(forKey: ObjectIdentifier(task)),
        state.superseded.remove(ObjectIdentifier(task)) != nil
      )
    }
    // A background task the foreground session took over: its request waits for the new task.
    if superseded { return }
    let id = task.taskDescription
    var result: Result<OfflineFetchResponse, any Error>
    if task.response != nil && !Self.sameOrigin(task.originalRequest?.url, task.response?.url) {
      if case .success(let file) = body { try? FileManager.default.removeItem(at: file) }
      if let id {
        try? FileManager.default.removeItem(at: resumeFile(id))
        try? FileManager.default.removeItem(at: bodyFile(id))
      }
      result = .failure(Self.originFailure)
    } else if let error {
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
            file: file, finalURL: response.url))
      case .failure(let error) where body != nil:
        result = .failure(error)
      case .failure:
        result = .success(
          OfflineFetchResponse(
            status: status, headers: headers, body: Data(), wireBytes: 0, wireSHA256: nil,
            finalURL: response.url))
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
    guard Self.sameOrigin(request.url, response.finalURL) else {
      if let file = response.file { try? FileManager.default.removeItem(at: file) }
      try? FileManager.default.removeItem(at: resumeFile(request.id))
      return .failure(Self.originFailure)
    }
    guard let file = response.file else { return .success(response) }
    defer { try? FileManager.default.removeItem(at: file) }
    if let destination = request.destination, response.status == 200 {
      return Result {
        try FileManager.default.createDirectory(
          at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.moveItem(at: file, to: destination)
        return OfflineFetchResponse(
          status: 200, headers: response.headers, body: Data(), wireBytes: nil, wireSHA256: nil,
          finalURL: response.finalURL)
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
        wireSHA256: nil, finalURL: response.finalURL)
    }
  }

  private static var originFailure: TileflowOfflineError {
    TileflowOfflineError(.invalidResponse, context: .init(reason: "responseOriginChanged"))
  }

  private static func sameOrigin(_ expected: URL?, _ actual: URL?) -> Bool {
    guard let expected, let actual, actual.user == nil, actual.password == nil,
      let scheme = actual.scheme?.lowercased(), ["https", "http"].contains(scheme),
      actual.host?.isEmpty == false else { return false }
    return ResourcePolicy.origin(expected) == ResourcePolicy.origin(actual)
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
