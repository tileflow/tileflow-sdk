import Foundation
import MapLibre

/// Answers MapLibre Native's requests for ``MapResourceAddress`` addresses with the SDK's
/// transport: the loader of the map whose context the address names applies its resource policy,
/// credentials, Hosted session, cache, downloaded regions and the network switch.
final class MapLibreResourceProtocol: URLProtocol, @unchecked Sendable {
  /// Called with each request MapLibre's session makes that is not the SDK's. Tests use it to
  /// prove that a map reaches no network of its own.
  nonisolated(unsafe) static var foreignRequestObserver: (@Sendable (URL) -> Void)?
  /// Called with the remote address and status of each request the SDK answered, or a nil status
  /// when it failed. Tests use it to see what the engine asked for.
  nonisolated(unsafe) static var answerObserver: (@Sendable (URL, Int?) -> Void)?

  fileprivate static let startupProbeScheme = "tileflow-transport-check"
  fileprivate static let startupProbe = LockedValue<
    (
      url: URL, receipt: AsyncStream<Void>.Continuation
    )?
  >(nil)

  private let state = LockedValue<(stopped: Bool, task: Task<Void, Never>?)>((false, nil))

  override class func canInit(with request: URLRequest) -> Bool {
    guard let url = request.url else { return false }
    if url.host == MapResourceAddress.host, url.scheme == "https" { return true }
    if url.scheme == startupProbeScheme, startupProbe.withLock({ $0?.url == url }) { return true }
    foreignRequestObserver?(url)
    return false
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

  override func startLoading() {
    if request.url?.scheme == Self.startupProbeScheme,
      let probe = Self.startupProbe.withLock({ $0 }), request.url == probe.url
    {
      guard
        let response = HTTPURLResponse(
          url: probe.url, statusCode: 200, httpVersion: "HTTP/1.1",
          headerFields: ["Content-Type": "application/json", "Cache-Control": "no-store"])
      else {
        client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
        return
      }
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: Data(#"{"version":8,"sources":{},"layers":[]}"#.utf8))
      client?.urlProtocolDidFinishLoading(self)
      probe.receipt.yield(())
      return
    }
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
/// Configures the session before the first native map and verifies that MapLibre's file source
/// uses it. Disables the process-wide ambient cache so the SDK owns resource caching.
@MainActor
enum MapLibreNetwork {
  private static var installation: Task<Void, any Error>?

  /// Installs and verifies the transport once per process, then checks for configuration changes.
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
        do {
          try checkConfiguration()
        } catch {
          // No file source was started: a corrected host configuration may try again.
          self.installation = nil
          throw error
        }
        guard await verifyTransport() else {
          throw invalid(
            "MapLibre's active network session did not reach the Tileflow SDK. "
              + "Configure Tileflow before MapLibre initializes.")
        }

        do {
          try await withCheckedThrowingContinuation {
            (continuation: CheckedContinuation<Void, any Error>) in
            MLNOfflineStorage.shared.setMaximumAmbientCacheSize(0) { error in
              if let error { continuation.resume(throwing: error) } else { continuation.resume() }
            }
          }
        } catch {
          self.installation = nil
          throw invalid("MapLibre's ambient cache could not be turned off.")
        }
      }
    self.installation = installation
    try await installation.value
    try checkConfiguration()
  }

  private static func checkConfiguration() throws {
    let manager = MLNNetworkConfiguration.sharedManager
    let protocols = manager.sessionConfiguration.protocolClasses ?? []
    guard protocols.contains(where: { $0 == MapLibreResourceProtocol.self }),
      manager.sessionConfiguration.identifier == nil,
      manager.delegate?.responds(
        to: #selector(MLNNetworkConfigurationDelegate.session(for:))) != true
    else {
      throw invalid(
        "MapLibre's network session no longer sends requests through the Tileflow SDK.")
    }
  }

  private static func verifyTransport() async -> Bool {
    // In MapLibre 7, snapshots and views use the same resource options and file source.
    // The probe's scheme has no system handler, so a stale session cannot send it off device.
    let scheme = MapLibreResourceProtocol.startupProbeScheme
    let url = URL(string: "\(scheme)://\(MapResourceAddress.host)/\(UUID())")!
    let (receipts, receipt) = AsyncStream<Void>.makeStream(bufferingPolicy: .bufferingOldest(1))
    MapLibreResourceProtocol.startupProbe.withLock { $0 = (url, receipt) }

    let camera = MLNMapCamera(
      lookingAtCenter: .init(latitude: 0, longitude: 0), altitude: 0,
      pitch: 0, heading: 0)
    let options = MLNMapSnapshotOptions(
      styleURL: url, camera: camera, size: .init(width: 8, height: 8))
    options.scale = 1
    options.showsLogo = false
    options.showsAttribution = false
    let snapshotter = MLNMapSnapshotter(options: options)
    // Cancellation discards the callback, so use the completion API without awaiting it.
    let start = snapshotter.start(completionHandler:)
    start { snapshot, _ in
      if snapshot == nil { receipt.finish() }
    }
    let timeout = Task {
      try await Task.sleep(for: .seconds(5))
      receipt.finish()
    }
    defer {
      timeout.cancel()
      receipt.finish()
      MapLibreResourceProtocol.startupProbe.withLock { $0 = nil }
      snapshotter.cancel()
    }

    var observations = receipts.makeAsyncIterator()
    return await observations.next() != nil
  }

  private static func invalid(_ message: String) -> TileflowMapError {
    TileflowMapError(.invalidConfiguration, context: .init(message: message))
  }
}
