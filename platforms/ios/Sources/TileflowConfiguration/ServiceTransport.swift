import Foundation

/// Why a Tileflow service call failed.
public enum TileflowServiceErrorKind: Sendable, Equatable {
  /// The configuration has no usable credential or app identity for the service, or is invalid.
  /// Nothing was sent.
  case configuration
  /// The request breaks the service's documented limits. Nothing was sent.
  case invalidRequest
  /// No HTTP answer arrived: connection, TLS, timeout or a redirect, which is never followed.
  case network
  /// The service answered with an HTTP error status.
  case rejected
  /// The service answered successfully, but outside its documented contract.
  case invalidResponse
}

/// A failed service call before it becomes the service's public error type.
package struct ServiceFailure: Error, Sendable {
  package var kind: TileflowServiceErrorKind
  package var code: String?
  package var status: Int?
  package var requestID: String?
  package var retryAfter: TimeInterval?
  package var message: String

  package init(
    _ kind: TileflowServiceErrorKind, code: String? = nil, status: Int? = nil,
    requestID: String? = nil, retryAfter: TimeInterval? = nil, message: String
  ) {
    self.kind = kind
    self.code = code
    self.status = status
    self.requestID = requestID
    self.retryAfter = retryAfter
    self.message = message
  }
}

/// How a service writes its error bodies.
package struct ServiceErrorPolicy: Sendable {
  /// The product name used in generic messages, such as "Search".
  package var name: String
  /// Each documented code with the only status it is trusted with.
  package var statuses: [String: Int]
  /// A code also trusted with 401, from the shared credential check.
  package var alsoUnauthorized: String?
  /// Statuses whose uncoded `{error}` bodies come from the shared credential or rate checks.
  package var uncodedStatuses: Set<Int>
  package var requestIDPattern = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"

  package init(
    name: String, statuses: [String: Int], alsoUnauthorized: String? = nil,
    uncodedStatuses: Set<Int> = [], requestIDPattern: String? = nil
  ) {
    self.name = name
    self.statuses = statuses
    self.alsoUnauthorized = alsoUnauthorized
    self.uncodedStatuses = uncodedStatuses
    if let requestIDPattern { self.requestIDPattern = requestIDPattern }
  }

  package var genericMessage: String { "Tileflow \(name) request failed" }
  package var invalidResponseMessage: String { "Tileflow \(name) returned an invalid response" }

  func failure(status: Int, body: Data?, retryAfter: TimeInterval?) -> ServiceFailure {
    var failure = ServiceFailure(
      .rejected, status: status, retryAfter: retryAfter, message: genericMessage)
    guard let body, let json = try? ServiceJSON.parse(body), (try? json.object()) != nil,
      let message = try? json.required("error").text(maximum: 512, trimmed: true)
    else { return failure }
    let requestID: String?
    switch json["requestId"] {
    case nil: requestID = nil
    case .string(let value) where value.matches(requestIDPattern): requestID = value
    default: return failure
    }
    if case .string(let code) = json["code"] {
      guard let expected = statuses[code],
        expected == status || (code == alsoUnauthorized && status == 401)
      else { return failure }
      failure.code = code
    } else if json["code"] == nil, uncodedStatuses.contains(status) {
      failure.code = nil
    } else {
      return failure
    }
    failure.message = message
    failure.requestID = requestID
    return failure
  }
}

/// One HTTP exchange with a Tileflow service.
package struct ServiceRequest: Sendable {
  package var service: TileflowService
  package var method: String
  package var path: String
  package var body: ServiceJSON?
  package var maximumRequestBytes: Int
  package var maximumResponseBytes: Int

  package init(
    service: TileflowService, method: String = "POST", path: String, body: ServiceJSON?,
    maximumRequestBytes: Int, maximumResponseBytes: Int
  ) {
    self.service = service
    self.method = method
    self.path = path
    self.body = body
    self.maximumRequestBytes = maximumRequestBytes
    self.maximumResponseBytes = maximumResponseBytes
  }
}

/// Sends service requests with the configured credential and app identity, without following
/// redirects or using caches, and reads bounded UTF-8 JSON answers.
package struct ServiceTransport: Sendable {
  package let configuration: TileflowConfiguration?
  package let session: URLSession
  package let policy: ServiceErrorPolicy
  static let errorBodyBytes = 8 * 1024
  static let timeout: TimeInterval = 30

  package init(
    configuration: TileflowConfiguration?, session: URLSession, policy: ServiceErrorPolicy
  ) {
    self.configuration = configuration
    self.session = session
    self.policy = policy
  }

  /// Sends the request and decodes its answer. A decoding error, including a failed invariant,
  /// makes the answer invalid. Failures are `ServiceFailure`; cancellation is `CancellationError`.
  package func call<Answer>(
    _ request: ServiceRequest, decode: (ServiceJSON) throws -> Answer
  ) async throws -> Answer {
    let (json, status) = try await send(request)
    do {
      return try decode(json)
    } catch {
      throw invalidResponse(status: status)
    }
  }

  private func send(_ request: ServiceRequest) async throws -> (ServiceJSON, Int) {
    let urlRequest = try prepare(request)
    try Task.checkCancellation()
    let outcome = try await BoundedLoad.run(
      urlRequest, session: session, successBytes: request.maximumResponseBytes,
      errorBytes: Self.errorBodyBytes)
    let response: HTTPURLResponse
    let data: Data?
    switch outcome {
    case .answer(let answer, let body):
      response = answer
      data = body
    case .tooLarge(let status): throw invalidResponse(status: status)
    case .unreachable: throw ServiceFailure(.network, message: policy.genericMessage)
    }
    let status = response.statusCode
    guard (200...299).contains(status) else {
      if (300...399).contains(status) {
        throw ServiceFailure(.network, status: status, message: policy.genericMessage)
      }
      throw policy.failure(
        status: status, body: data, retryAfter: Self.retryAfter(response))
    }
    guard let data, let json = try? ServiceJSON.parse(data) else {
      throw invalidResponse(status: status)
    }
    return (json, status)
  }

  package func invalidResponse(status: Int? = nil) -> ServiceFailure {
    ServiceFailure(.invalidResponse, status: status, message: policy.invalidResponseMessage)
  }

  package func invalidRequest(code: String? = nil, _ message: String) -> ServiceFailure {
    ServiceFailure(.invalidRequest, code: code, message: message)
  }

  private func prepare(_ request: ServiceRequest) throws -> URLRequest {
    let configuration: TileflowConfiguration
    do {
      configuration = try self.configuration ?? Tileflow.configuration()
    } catch {
      throw ServiceFailure(.configuration, message: "The Tileflow configuration is invalid")
    }
    var urlRequest = URLRequest(
      url: configuration.apiOrigin.appendingPathComponent(String(request.path.dropFirst())),
      cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: Self.timeout)
    urlRequest.httpMethod = request.method
    urlRequest.httpShouldHandleCookies = false
    urlRequest.setValue("application/json", forHTTPHeaderField: "Accept")
    if request.service != .geoIP {
      guard let credential = configuration.credential(for: request.service) else {
        throw ServiceFailure(
          .configuration,
          message: "No publishable credential is configured for Tileflow \(policy.name)")
      }
      guard let app = configuration.app ?? TileflowAppIdentity.current else {
        throw ServiceFailure(
          .configuration, message: "The application has no bundle identifier to identify it")
      }
      urlRequest.setValue("Bearer \(credential.value)", forHTTPHeaderField: "Authorization")
      urlRequest.setValue(app.id, forHTTPHeaderField: "X-Tileflow-App")
      if let certificate = app.certificateSHA256 {
        urlRequest.setValue(certificate, forHTTPHeaderField: "X-Tileflow-App-Certificate")
      }
    }
    if let body = request.body {
      let data = body.encoded()
      guard data.count <= request.maximumRequestBytes else {
        throw invalidRequest("The Tileflow \(policy.name) request is too large")
      }
      urlRequest.httpBody = data
      urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
    }
    return urlRequest
  }

  static func retryAfter(_ response: HTTPURLResponse) -> TimeInterval? {
    guard let value = response.value(forHTTPHeaderField: "Retry-After"),
      (1...8).contains(value.utf8.count), value.utf8.allSatisfy({ (48...57).contains($0) }),
      let seconds = Int(value), seconds <= 31_536_000
    else { return nil }
    return TimeInterval(seconds)
  }
}

enum LoadOutcome: Sendable {
  case answer(HTTPURLResponse, Data?)
  case tooLarge(status: Int)
  case unreachable
}

/// A data task with its own delegate: it refuses redirects, stops reading past a byte limit and
/// cancels with the calling task.
private final class BoundedLoad: NSObject, URLSessionDataDelegate, @unchecked Sendable {
  private let lock = NSLock()
  private let successBytes: Int
  private let errorBytes: Int
  private var continuation: CheckedContinuation<LoadOutcome, Error>?
  private var response: HTTPURLResponse?
  private var data = Data()
  private var limit = 0
  private var overflow = false
  private var refused = false
  private var task: URLSessionDataTask?

  private init(successBytes: Int, errorBytes: Int) {
    self.successBytes = successBytes
    self.errorBytes = errorBytes
  }

  /// The final response and its body. An error body over its limit is nil.
  static func run(
    _ request: URLRequest, session: URLSession, successBytes: Int, errorBytes: Int
  ) async throws -> LoadOutcome {
    let load = BoundedLoad(successBytes: successBytes, errorBytes: errorBytes)
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        load.start(request, session: session, continuation: continuation)
      }
    } onCancel: {
      load.cancel()
    }
  }

  private func start(
    _ request: URLRequest, session: URLSession,
    continuation: CheckedContinuation<LoadOutcome, Error>
  ) {
    let task = session.dataTask(with: request)
    task.delegate = self
    let cancelled = lock.withLock { () -> Bool in
      self.continuation = continuation
      self.task = task
      return Task.isCancelled
    }
    if cancelled {
      finish(.failure(CancellationError()))
      return
    }
    task.resume()
  }

  private func cancel() {
    let task = lock.withLock { self.task }
    task?.cancel()
    finish(.failure(CancellationError()))
  }

  private func finish(_ result: Result<LoadOutcome, Error>) {
    let continuation = lock.withLock { () -> CheckedContinuation<LoadOutcome, Error>? in
      defer { self.continuation = nil }
      return self.continuation
    }
    continuation?.resume(with: result)
  }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping @Sendable (URLRequest?) -> Void
  ) {
    // Credentials never travel to another location. The 3xx answer becomes the final one.
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
    completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
  ) {
    guard let http = response as? HTTPURLResponse else {
      lock.withLock { refused = true }
      completionHandler(.cancel)
      return
    }
    let limit = (200...299).contains(http.statusCode) ? successBytes : errorBytes
    let tooLarge = http.expectedContentLength > Int64(limit)
    lock.withLock {
      self.response = http
      self.limit = limit
      self.overflow = tooLarge
    }
    completionHandler(tooLarge ? .cancel : .allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    let exceeded = lock.withLock { () -> Bool in
      guard !overflow else { return false }
      if self.data.count + data.count > limit {
        overflow = true
        self.data = Data()
        return true
      }
      self.data.append(data)
      return false
    }
    if exceeded { dataTask.cancel() }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let (response, data, overflow, refused) = lock.withLock {
      (self.response, self.data, self.overflow, self.refused)
    }
    if let response, overflow {
      let success = (200...299).contains(response.statusCode)
      finish(.success(success ? .tooLarge(status: response.statusCode) : .answer(response, nil)))
    } else if let response, error == nil {
      finish(.success(.answer(response, data)))
    } else if !refused, (error as? URLError)?.code == .cancelled {
      finish(.failure(CancellationError()))
    } else {
      finish(.success(.unreachable))
    }
  }
}
