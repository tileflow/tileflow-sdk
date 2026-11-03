import Foundation
import MapLibre

/// Answers MapLibre Native's requests for ``MapResourceAddress`` addresses with the SDK's
/// transport: the loader of the map whose context the address names applies its resource policy,
/// credentials, Hosted session, cache, downloaded regions and the network switch. Every other
/// request is left to MapLibre's own session, so other MapLibre maps in the application keep
/// working.
final class MapLibreResourceProtocol: URLProtocol, @unchecked Sendable {
  /// Called with each request MapLibre's session makes that is not the SDK's. Tests use it to
  /// prove that a map reaches no network of its own.
  nonisolated(unsafe) static var foreignRequestObserver: (@Sendable (URL) -> Void)?
  /// Called with the remote address and status of each request the SDK answered, or a nil status
  /// when it failed. Tests use it to see what the engine asked for.
  nonisolated(unsafe) static var answerObserver: (@Sendable (URL, Int?) -> Void)?

  private let state = LockedValue<(stopped: Bool, task: Task<Void, Never>?)>((false, nil))

  override class func canInit(with request: URLRequest) -> Bool {
    guard let url = request.url else { return false }
    if url.host == MapResourceAddress.host, url.scheme == "https" { return true }
    foreignRequestObserver?(url)
    return false
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    guard let url = request.url, let decoded = MapResourceAddress.decode(url) else {
      client?.urlProtocol(self, didFailWithError: URLError(.badURL))
      return
    }
    let remote: URL = decoded.remote
    guard let route = MapResourceContexts.shared.route(decoded.context) else {
      // The map that owned this address is gone.
      client?.urlProtocol(self, didFailWithError: URLError(.cancelled))
      return
    }
    var forwarded = URLRequest(url: remote)
    forwarded.httpMethod = request.httpMethod == "HEAD" ? "HEAD" : "GET"
    if let range = request.value(forHTTPHeaderField: "Range") {
      forwarded.setValue(range, forHTTPHeaderField: "Range")
    }
    let kind = route.classify(remote)
    let origin = ResourcePolicy.origin(remote)
    let outgoing = forwarded
    let owner = Owner(self)
    let address: URL = url
    let task = Task.detached {
      await MapLibreResourceProtocol.answer(
        outgoing, address: address, remote: remote, route: route, kind: kind, origin: origin,
        owner: owner)
    }
    state.withLock { $0.task = task }
  }

  /// Opens the remote resource through the map's transport and hands MapLibre its answer.
  private static func answer(
    _ request: URLRequest, address: URL, remote: URL, route: MapResourceRoute,
    kind: TileflowResourceKind, origin: String, owner: Owner
  ) async {
    do {
      let response = try await route.loader.open(request)
      guard let loading = owner.value, !loading.isStopped else { return }
      guard
        let head = HTTPURLResponse(
          url: address, statusCode: response.status, httpVersion: "HTTP/1.1",
          headerFields: response.headers)
      else { throw URLError(.badServerResponse) }
      loading.client?.urlProtocol(loading, didReceive: head, cacheStoragePolicy: .notAllowed)
      switch response.body {
      case .data(let bytes):
        if !bytes.isEmpty { loading.client?.urlProtocol(loading, didLoad: bytes) }
      case .stream(let chunks):
        for try await chunk in chunks {
          guard !loading.isStopped else { return }
          loading.client?.urlProtocol(loading, didLoad: chunk)
        }
      }
      guard !loading.isStopped else { return }
      answerObserver?(remote, response.status)
      route.report(
        MapResourceOutcome(
          kind: kind, origin: origin, status: response.status, failure: nil,
          fairUse: MapFairUseSignal(remote, status: response.status, headers: response.headers)))
      loading.client?.urlProtocolDidFinishLoading(loading)
    } catch {
      guard let loading = owner.value, !loading.isStopped, !Task.isCancelled else { return }
      answerObserver?(remote, nil)
      route.report(
        MapResourceOutcome(
          kind: kind, origin: origin, status: nil, failure: error as? TileflowMapError))
      loading.client?.urlProtocol(loading, didFailWithError: error)
    }
  }

  override func stopLoading() {
    let task = state.withLock { value -> Task<Void, Never>? in
      value.stopped = true
      return value.task
    }
    task?.cancel()
  }

  private var isStopped: Bool { state.withLock { $0.stopped } }

  /// The loading request, held weakly by its work: URL loading owns the protocol object.
  private final class Owner: @unchecked Sendable {
    weak var value: MapLibreResourceProtocol?
    init(_ value: MapLibreResourceProtocol) { self.value = value }
  }
}

/// MapLibre Native's process-wide network setup for Tileflow maps.
///
/// Before the first native map, ``MapLibreResourceProtocol`` joins the protocols of
/// `MLNNetworkConfiguration`'s session configuration, keeping the application's own, and
/// MapLibre's ambient cache is turned off: MapLibre stores responses whatever their
/// `Cache-Control`, and the SDK's cache (``TileflowMapCache``) is the only one. Both settings are
/// global to the process. An application that replaces MapLibre's session afterwards, or supplies
/// its own with `sessionForNetworkConfiguration:`, takes the requests away from the SDK; maps then
/// fail with `invalidConfiguration` rather than load without their credentials.
@MainActor
enum MapLibreNetwork {
  private static var installation: Task<Void, any Error>?

  /// Installs the SDK's protocol and turns the ambient cache off, once per process, then checks
  /// that MapLibre still sends its requests through them.
  static func prepare() async throws {
    let installation =
      self.installation
      ?? Task { @MainActor in
        let manager = MLNNetworkConfiguration.sharedManager
        guard
          let configuration = manager.sessionConfiguration.copy() as? URLSessionConfiguration
        else { throw invalid("MapLibre's session configuration cannot be read.") }
        let protocols = configuration.protocolClasses ?? []
        if !protocols.contains(where: { $0 == MapLibreResourceProtocol.self }) {
          configuration.protocolClasses = [MapLibreResourceProtocol.self] + protocols
          manager.sessionConfiguration = configuration
        }
        try await withCheckedThrowingContinuation {
          (continuation: CheckedContinuation<Void, any Error>) in
          MLNOfflineStorage.shared.setMaximumAmbientCacheSize(0) { error in
            if let error { continuation.resume(throwing: error) } else { continuation.resume() }
          }
        }
      }
    self.installation = installation
    do {
      try await installation.value
    } catch let error as TileflowMapError {
      throw error
    } catch {
      self.installation = nil
      throw invalid("MapLibre's ambient cache could not be turned off.")
    }
    let manager = MLNNetworkConfiguration.sharedManager
    let protocols = manager.sessionConfiguration.protocolClasses ?? []
    guard protocols.contains(where: { $0 == MapLibreResourceProtocol.self }),
      manager.sessionConfiguration.identifier == nil,
      manager.delegate?.responds(
        to: Selector(("sessionForNetworkConfiguration:"))) != true
    else {
      throw invalid(
        "MapLibre's network session no longer sends requests through the Tileflow SDK.")
    }
  }

  private static func invalid(_ message: String) -> TileflowMapError {
    TileflowMapError(.invalidConfiguration, context: .init(message: message))
  }
}
