import Foundation
import TileflowConfiguration
import XCTest

/// Serves canned answers to an ephemeral session, records every request and never touches the
/// network.
final class ServiceStub: URLProtocol, @unchecked Sendable {
  struct Answer: Sendable {
    var status = 200
    var headers: [String: String] = ["Content-Type": "application/json"]
    var body = Data()
    /// Redirects to this URL instead of answering.
    var redirect: URL?
    /// Fails the connection instead of answering.
    var unreachable = false
  }

  struct Recorded: Sendable {
    var request: URLRequest
    var body: Data?
  }

  private static let lock = NSLock()
  nonisolated(unsafe) private static var handler: (@Sendable (URLRequest, Data?) -> Answer)?
  nonisolated(unsafe) private static var recorded: [Recorded] = []

  static func session() -> URLSession {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [ServiceStub.self]
    return URLSession(configuration: configuration)
  }

  static func serve(_ handler: @escaping @Sendable (URLRequest, Data?) -> Answer) {
    lock.withLock {
      self.handler = handler
      recorded = []
    }
  }

  static func serve(json: ServiceJSON, status: Int = 200, headers: [String: String] = [:]) {
    var answer = Answer(status: status, body: json.encoded())
    answer.headers.merge(headers) { $1 }
    let served = answer
    serve { _, _ in served }
  }

  static var requests: [Recorded] { lock.withLock { recorded } }

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
    let handler = Self.lock.withLock { () -> (@Sendable (URLRequest, Data?) -> Answer)? in
      Self.recorded.append(Recorded(request: request, body: body))
      return Self.handler
    }
    guard let answer = handler?(request, body), !answer.unreachable else {
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
      return
    }
    if let redirect = answer.redirect {
      let response = HTTPURLResponse(
        url: request.url!, statusCode: 302, httpVersion: "HTTP/1.1",
        headerFields: ["Location": redirect.absoluteString])!
      client?.urlProtocol(
        self, wasRedirectedTo: URLRequest(url: redirect), redirectResponse: response)
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocolDidFinishLoading(self)
      return
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: answer.status, httpVersion: "HTTP/1.1",
      headerFields: answer.headers)!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: answer.body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}

  private static func read(_ stream: InputStream) -> Data {
    stream.open()
    defer { stream.close() }
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 16 * 1024)
    while stream.hasBytesAvailable {
      let count = stream.read(&buffer, maxLength: buffer.count)
      guard count > 0 else { break }
      data.append(buffer, count: count)
    }
    return data
  }
}

/// The shared wire contract of the Search, Routing, Elevation and GeoIP clients.
struct ServiceContract {
  let json: ServiceJSON

  static let shared: ServiceContract = {
    let url = Bundle.module.url(
      forResource: "service-contract", withExtension: "json", subdirectory: "Fixtures")!
    return ServiceContract(json: try! ServiceJSON.parse(Data(contentsOf: url)))
  }()

  var credential: String { try! json.required("credential").string() }
  var appID: String { try! json.required("apps").required("ios").required("id").string() }

  func operation(_ name: String) -> ServiceJSON {
    try! json.required("operations").required(name)
  }

  func request(_ name: String) -> ServiceJSON { try! operation(name).required("request") }
  func response(_ name: String) -> ServiceJSON { try! operation(name).required("response") }

  var errors: [ServiceJSON] { try! json.required("errors").array() }

  func configuration(
    services: Bool = true, search: Bool = false, map: Bool = false
  ) -> TileflowConfiguration {
    let credential = try! TileflowCredential(credential)
    return try! TileflowConfiguration(
      apiOrigin: URL(string: "https://api.example.test")!,
      servicesCredential: services ? credential : nil,
      searchCredential: search
        ? try! TileflowCredential("tf_public_ffffffffffffffffffffffffffffffffffffffffffffffff")
        : nil,
      mapCredential: map ? credential : nil,
      app: try! TileflowAppIdentity(id: appID))
  }

  /// Serves the operation's answer after checking the request against its documented method,
  /// path and body.
  func serve(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
    let operation = operation(name)
    let method = try! operation.required("method").string()
    let path = try! operation.required("path").string()
    let expected = operation.optional("request")
    let answer = response(name).encoded()
    ServiceStub.serve { request, body in
      guard request.httpMethod == method, request.url?.path == path,
        request.url?.host == "api.example.test",
        (body.flatMap { try? ServiceJSON.parse($0) }) == expected
      else {
        return ServiceStub.Answer(status: 599)
      }
      return ServiceStub.Answer(body: answer)
    }
  }
}

extension ServiceJSON {
  /// A copy with the member at `path` replaced, or removed when `value` is nil.
  func replacing(_ path: [String], with value: ServiceJSON?) -> ServiceJSON {
    guard let key = path.first, case .object(var members) = self else { return self }
    if path.count == 1 {
      members[key] = value
    } else if let child = members[key] {
      members[key] = child.replacing(Array(path.dropFirst()), with: value)
    }
    return .object(members)
  }
}
