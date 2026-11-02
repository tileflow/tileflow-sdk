import Foundation
import MapLibre

@testable import Tileflow

/// One request the engine made, as the interception saw it.
struct EngineRequest: CustomStringConvertible {
  let transport: String
  let remote: String?
  var status: Int?
  var bytes = 0
  var contentType: String?
  var error: String?
  var headersSent: [String: String] = [:]

  var description: String {
    "\(status.map(String.init) ?? "-") \(bytes)B \(remote ?? transport)\(error.map { " error=\($0)" } ?? "")"
  }
}

/// Answers every request of MapLibre's network session. Only transport addresses are served, by
/// the resource loader registered for their context; anything else is recorded as escaped and
/// failed without touching the network.
final class EngineURLProtocol: URLProtocol {
  private struct State {
    var loaders: [String: any ResourceLoading] = [:]
    var requests: [EngineRequest] = []
    var escaped: [String] = []
    var active = 0
    var maximumActive = 0
  }

  private static let lock = NSLock()
  private static var state = State()

  static func register(_ loader: any ResourceLoading, context: String) {
    lock.withLock { state.loaders[context] = loader }
  }

  static func unregister(context: String) {
    lock.withLock { _ = state.loaders.removeValue(forKey: context) }
  }

  static func reset() {
    lock.withLock {
      state.requests = []
      state.escaped = []
      state.maximumActive = state.active
    }
  }

  static var requests: [EngineRequest] { lock.withLock { state.requests } }
  static var escaped: [String] { lock.withLock { state.escaped } }
  static var maximumActive: Int { lock.withLock { state.maximumActive } }

  private let stopped = NSLock()
  private var isStopped = false
  private var loading: Task<Void, Never>?

  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canInit(with task: URLSessionTask) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let url = request.url else {
      client?.urlProtocol(self, didFailWithError: URLError(.badURL))
      return
    }
    guard url.host == TransportAddress.host, let (context, remote) = TransportAddress.decode(url)
    else {
      Self.lock.withLock { Self.state.escaped.append(url.absoluteString) }
      client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
      return
    }
    let loader = Self.lock.withLock { Self.state.loaders[context] }
    var forwarded = URLRequest(url: remote)
    forwarded.httpMethod = request.httpMethod ?? "GET"
    var sent: [String: String] = [:]
    for name in ["Range", "If-None-Match", "If-Modified-Since"] {
      if let value = request.value(forHTTPHeaderField: name) {
        forwarded.setValue(value, forHTTPHeaderField: name)
        sent[name] = value
      }
    }
    let index: Int = Self.lock.withLock {
      Self.state.requests.append(
        EngineRequest(
          transport: url.absoluteString, remote: remote.absoluteString, headersSent: sent))
      Self.state.active += 1
      Self.state.maximumActive = max(Self.state.maximumActive, Self.state.active)
      return Self.state.requests.count - 1
    }
    guard let loader else {
      finish(index) { $0.error = "unknown context" }
      client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
      return
    }
    loading = Task { [weak self] in
      do {
        let response = try await loader.open(forwarded)
        guard let self, !self.stoppedNow else { return }
        guard
          let http = HTTPURLResponse(
            url: url, statusCode: response.status, httpVersion: "HTTP/1.1",
            headerFields: response.headers)
        else { throw URLError(.badServerResponse) }
        self.client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        var bytes = 0
        switch response.body {
        case .data(let data):
          bytes = data.count
          if !data.isEmpty { self.client?.urlProtocol(self, didLoad: data) }
        case .stream(let chunks):
          for try await chunk in chunks {
            guard !self.stoppedNow else { return }
            bytes += chunk.count
            self.client?.urlProtocol(self, didLoad: chunk)
          }
        }
        guard !self.stoppedNow else { return }
        self.finish(index) {
          $0.status = response.status
          $0.bytes = bytes
          $0.contentType = response.headers["Content-Type"]
        }
        self.client?.urlProtocolDidFinishLoading(self)
      } catch {
        guard let self else { return }
        self.finish(index) { $0.error = "\(error)" }
        if !self.stoppedNow { self.client?.urlProtocol(self, didFailWithError: error) }
      }
    }
  }

  override func stopLoading() {
    stopped.withLock { isStopped = true }
    loading?.cancel()
  }

  private var stoppedNow: Bool { stopped.withLock { isStopped } }

  private func finish(_ index: Int, _ update: (inout EngineRequest) -> Void) {
    Self.lock.withLock {
      update(&Self.state.requests[index])
      Self.state.active -= 1
    }
  }
}

/// Installs the interception in MapLibre's network configuration once per process, before the
/// first map, and turns MapLibre's ambient cache off.
enum EngineNetwork {
  private static var installed = false

  @MainActor
  static func install() async throws {
    guard !installed else { return }
    installed = true
    EngineLog.install()
    let manager = MLNNetworkConfiguration.sharedManager
    let configuration = manager.sessionConfiguration.copy() as! URLSessionConfiguration
    configuration.protocolClasses = [EngineURLProtocol.self] + (configuration.protocolClasses ?? [])
    manager.sessionConfiguration = configuration
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      MLNOfflineStorage.shared.setMaximumAmbientCacheSize(0) { error in
        if let error { continuation.resume(throwing: error) } else { continuation.resume() }
      }
    }
  }

  /// Rows in MapLibre's database: what its ambient cache or its own offline packs hold.
  static func databaseRows() -> [String: Int] {
    let path = MLNOfflineStorage.shared.databasePath
    var counts: [String: Int] = ["exists": FileManager.default.fileExists(atPath: path) ? 1 : 0]
    for table in ["resources", "tiles", "regions"] {
      counts[table] = SQLiteCount.rows(path: path, table: table)
    }
    return counts
  }
}
