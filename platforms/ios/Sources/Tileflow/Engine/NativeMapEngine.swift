import Foundation
import MapLibre
import UIKit

/// The map drawn by MapLibre Native in an `MLNMapView`.
///
/// The engine reads the map's manifest and theme style through the map's transport, projects the
/// style for its context (``NativeStyleDocument``) and gives MapLibre the document, never a URL.
/// MapLibre then requests every resource from ``MapLibreResourceProtocol``, which answers from the
/// same transport: policy, credentials, Hosted session, cache, downloaded regions and the network
/// switch apply as they do for the WebView engine.
///
/// The map view is created only after MapLibre's network setup (``MapLibreNetwork``), and always
/// with an inline style: created without one, MapLibre requests its demo style from the network.
/// The engine answers the commands it implements and rejects the others with `invalidRequest`, so a
/// view never believes a request took effect.
@MainActor
final class NativeMapEngine: NSObject, MapEngine, MLNMapViewDelegate {
  /// A style with nothing to draw, which needs no resource.
  static let emptyStyle = #"{"version":8,"sources":{},"layers":[]}"#

  var onReady: (() -> Void)?
  var onEvent: ((String, JSONValue) -> Void)?
  var onFailure: ((TileflowMapError) -> Void)?
  var onLoadFailure: ((TileflowMapError) -> Void)?
  var onExternalLink: ((URL) -> Void)?
  var onRendererTerminated: (() -> Void)?

  let data = DataChannel()
  private let container = UIView()
  private(set) var mapView: MLNMapView?
  private let loader: any ResourceLoading
  private let grantScope: ResourceCacheScope?
  private let offline: OfflineServingIndex
  /// The map's context in MapLibre's requests, while it is registered.
  private var context: String?
  private let projection = LockedValue<ProjectedStyle?>(nil)
  private lazy var warnings = MapWarningAggregator { [weak self] warning in
    self?.onEvent?("warning", warning)
  }
  private var retired = false
  private var initialized = false
  /// Whether the map's own style finished loading; the initial empty style does not count.
  private var styleLoaded = false
  private var styleRequested = false
  /// Whether `contentReady` waits for the map's style to finish drawing.
  private var contentPending = false
  /// The attribution model, and the entries it gives for the current view.
  private(set) var attribution = MapAttribution()
  private(set) var attributionEntries: [MapAttributionEntry] = []

  var view: UIView { container }

  init(
    frame: CGRect, loader: any ResourceLoading, grantScope: ResourceCacheScope?,
    offline: OfflineServingIndex = .shared
  ) {
    self.loader = loader
    self.grantScope = grantScope
    self.offline = offline
    super.init()
    container.frame = frame
    container.clipsToBounds = true
  }

  func start() {
    Task { @MainActor [weak self] in
      do {
        try await MapLibreNetwork.prepare()
      } catch {
        guard let self, !self.retired else { return }
        self.onLoadFailure?(error as? TileflowMapError ?? .invalidConfiguration)
        return
      }
      guard let self, !self.retired else { return }
      let mapView = MLNMapView(frame: self.container.bounds, styleJSON: Self.emptyStyle)
      mapView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      mapView.delegate = self
      // The SDK shows its own attribution; MapLibre's logo and button stay hidden.
      mapView.logoView.isHidden = true
      mapView.attributionButton.isHidden = true
      mapView.automaticallyAdjustsContentInset = false
      mapView.contentInset = .zero
      self.container.addSubview(mapView)
      self.mapView = mapView
      self.onReady?()
    }
  }

  func call(_ command: MapEngineCommand, payload: JSONValue, data: [DataChannel.Reference])
    async throws -> JSONValue
  {
    defer { self.data.release(data) }
    guard !retired else { throw TileflowMapError.disposed }
    guard let mapView else { throw TileflowMapError.notReady }
    switch command {
    case .initialize:
      try await initialize(payload)
      return .null
    case .getCamera:
      return cameraWire
    case .project:
      guard let longitude = payload["longitude"]?.number, let latitude = payload["latitude"]?.number
      else { throw TileflowMapError.invalidRequest }
      let point = mapView.convert(
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude), toPointTo: mapView)
      return .object(["x": .number(point.x), "y": .number(point.y)])
    case .unproject:
      let point = try Self.point(payload)
      let coordinate = mapView.convert(point, toCoordinateFrom: mapView)
      return .object([
        "longitude": .number(Self.wrap(coordinate.longitude)),
        "latitude": .number(coordinate.latitude),
      ])
    case .queryAtPoint:
      return .array(features(at: try Self.point(payload)))
    case .setInsets:
      let value = { (key: String) in CGFloat(payload[key]?.number ?? 0) }
      mapView.contentInset = UIEdgeInsets(
        top: value("top"), left: value("left"), bottom: value("bottom"), right: value("right"))
      return .null
    case .setVisibility, .setEvents, .setOptions:
      return .null
    case .setContent:
      guard payload["annotations"]?.array?.isEmpty != false,
        payload["overlays"]?.array?.isEmpty != false
      else { throw Self.unsupported(command) }
      return .null
    case .setAnnotationLayers:
      // The view sends the layers whenever an engine becomes ready.
      guard payload["layers"]?.array?.isEmpty != false else { throw Self.unsupported(command) }
      return .null
    case .setTrackedPoints:
      guard payload["points"]?.array?.isEmpty != false else { throw Self.unsupported(command) }
      return .null
    default:
      throw Self.unsupported(command)
    }
  }

  static func unsupported(_ command: MapEngineCommand) -> TileflowMapError {
    TileflowMapError(
      .invalidRequest,
      context: .init(message: "The native map engine does not support \(command.rawValue) yet."))
  }

  func retire(_ error: TileflowMapError) {
    guard !retired else { return }
    retired = true
    if let context { MapResourceContexts.shared.retire(context) }
    context = nil
    warnings.retire()
    data.retire()
    loader.close()
    mapView?.delegate = nil
    container.removeFromSuperview()
    onReady = nil
    onEvent = nil
    onFailure = nil
    onLoadFailure = nil
    onExternalLink = nil
    onRendererTerminated = nil
  }

  // MARK: Loading

  private func initialize(_ payload: JSONValue) async throws {
    guard !initialized else { throw TileflowMapError.invalidRequest }
    initialized = true
    guard let map = payload["source"]?["map"]?.string,
      let manifestURL = payload["source"]?["manifestUrl"]?.string.flatMap(URL.init(string:))
    else { throw TileflowMapError.invalidRequest }
    let projection = self.projection
    let context = MapResourceContexts.shared.register(
      MapResourceRoute(
        loader: loader,
        classify: { remote in projection.withLock { $0?.kind(of: remote) } ?? .tile },
        report: { [weak self] outcome in
          Task { @MainActor in self?.received(outcome) }
        }))
    self.context = context
    attribution.credits = payload["credits"]?.array?.compactMap(MapAttributionCredit.init) ?? []

    var storedZooms: NativeStyleDocument.StoredZooms?
    if let grantScope,
      OfflineServingRule.hostedUsesPacks(
        networkEnabled: TileflowHTTPClient.shared.isNetworkEnabled,
        reachable: OfflineReachability.shared.isReachable)
    {
      let offline = self.offline
      storedZooms = { template in await offline.storedZooms(template: template, scope: grantScope) }
    }
    let (manifest, projected) = try await Self.load(
      map: map, manifestURL: manifestURL,
      discoveryMapID: payload["source"]?["discoveryMapId"]?.string,
      theme: payload["theme"]?.string, colorScheme: payload["colorScheme"]?.string ?? "light",
      context: context, loader: loader, storedZooms: storedZooms)
    guard !retired, let mapView else { throw TileflowMapError.cancelled }
    projection.withLock { $0 = projected }
    attribution.sources = projected.attributions
    apply(TileflowCamera(wire: payload["camera"]) ?? manifest.view)
    styleRequested = true
    contentPending = true
    mapView.styleJSON = projected.json
  }

  /// Reads the map's manifest and theme style through its transport and projects the style.
  private nonisolated static func load(
    map: String, manifestURL: URL, discoveryMapID: String?, theme: String?, colorScheme: String,
    context: String, loader: any ResourceLoading, storedZooms: NativeStyleDocument.StoredZooms?
  ) async throws -> (NativeManifest, ProjectedStyle) {
    let read = { (url: URL, kind: TileflowResourceKind) in
      try await document(url, kind: kind, loader: loader)
    }
    let manifest = try await NativeManifest.load(
      map: map, manifestURL: manifestURL, discoveryMapID: discoveryMapID, theme: theme,
      colorScheme: colorScheme, read: read)
    let style = try await read(manifest.theme.styleURL, .style)
    let projected = try await NativeStyleDocument.project(
      style, styleURL: manifest.theme.styleURL, context: context, load: read,
      storedZooms: storedZooms)
    return (manifest, projected)
  }

  /// Reads a JSON document of the map through its transport.
  private nonisolated static func document(
    _ url: URL, kind: TileflowResourceKind, loader: any ResourceLoading
  ) async throws -> [String: Any] {
    let payload = try await loader.load(URLRequest(url: url))
    guard payload.status == 200,
      let value = try? JSONSerialization.jsonObject(with: payload.bytes) as? [String: Any]
    else {
      throw TileflowMapError(
        .resourceFailed,
        context: .init(
          resource: kind, origin: ResourcePolicy.origin(url), status: payload.status))
    }
    return value
  }

  /// A request of the map ended: failures become aggregated warnings, as the web runtime reports
  /// them. A tile the source does not have (`404`) is not a failure; an absent tile answers `204`.
  /// A failure that ends the map, such as an exhausted quota, is reported as the map's own.
  private func received(_ outcome: MapResourceOutcome) {
    guard !retired else { return }
    if let failure = outcome.failure, failure.code != .cancelled, failure.code != .disposed,
      failure.code != .resourceFailed, failure.code != .timeout
    {
      onFailure?(failure)
      return
    }
    let failed =
      outcome.status.map { $0 >= 400 && !($0 == 404 && outcome.kind == .tile) } ?? true
    guard failed else { return }
    var context: [String: JSONValue] = [
      "resource": .string(outcome.kind.rawValue), "origin": .string(outcome.origin),
    ]
    if let status = outcome.status { context["status"] = .number(Double(status)) }
    warnings.warn(
      .object([
        "code": .string("resourceFailed"), "message": .string("A map resource failed to load."),
        "context": .object(context),
      ]))
  }

  private func contentLoaded() {
    guard contentPending, styleLoaded, !retired else { return }
    contentPending = false
    updateAttribution()
    onEvent?("contentReady", .object(["camera": cameraWire]))
  }

  // MARK: Camera

  /// The camera in the SDK's form. MapLibre's direction runs from 0 to 360; the SDK's bearing
  /// runs from -180 to 180, as on the web.
  var cameraWire: JSONValue {
    guard let mapView else { return .null }
    let center = mapView.centerCoordinate
    var bearing = mapView.direction.truncatingRemainder(dividingBy: 360)
    if bearing > 180 { bearing -= 360 }
    if bearing <= -180 { bearing += 360 }
    return .object([
      "longitude": .number(Self.wrap(center.longitude)), "latitude": .number(center.latitude),
      "zoom": .number(mapView.zoomLevel), "bearing": .number(bearing),
      "pitch": .number(Double(mapView.camera.pitch)),
    ])
  }

  func apply(_ camera: TileflowCamera) {
    guard let mapView else { return }
    let center = CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude)
    let size = mapView.bounds.size
    guard size.width > 0, size.height > 0 else {
      mapView.setCenter(center, zoomLevel: camera.zoom, direction: camera.bearing, animated: false)
      return
    }
    let altitude = MLNAltitudeForZoomLevel(camera.zoom, camera.pitch, camera.latitude, size)
    mapView.setCamera(
      MLNMapCamera(
        lookingAtCenter: center, altitude: altitude, pitch: camera.pitch, heading: camera.bearing),
      animated: false)
  }

  /// The view's bounds as longitudes and latitudes. A view across the antimeridian has an east
  /// edge past 180°, as the credits' boxes expect.
  var visibleBounds: TileflowBounds? {
    guard let mapView else { return nil }
    let bounds = mapView.visibleCoordinateBounds
    var east = bounds.ne.longitude
    if east < bounds.sw.longitude { east += 360 }
    return TileflowBounds(
      west: bounds.sw.longitude, south: bounds.sw.latitude, east: east, north: bounds.ne.latitude)
  }

  private func updateAttribution() {
    guard let view = visibleBounds else { return }
    attributionEntries = attribution.entries(in: view)
  }

  // MARK: Queries

  /// Rendered features at a point, topmost first. MapLibre's features carry no layer, so the
  /// engine asks layer by layer.
  private func features(at point: CGPoint) -> [JSONValue] {
    guard let mapView, let layers = mapView.style?.layers else { return [] }
    var result: [JSONValue] = []
    for layer in layers.reversed() {
      guard let vector = layer as? MLNVectorStyleLayer else { continue }
      let features = mapView.visibleFeatures(
        at: point, styleLayerIdentifiers: [layer.identifier])
      for feature in features {
        let id: JSONValue
        switch feature.identifier {
        case let text as String: id = .string(text)
        case let number as NSNumber: id = .string(number.stringValue)
        default: id = .null
        }
        result.append(
          .object([
            "id": id, "source": .string(vector.sourceIdentifier ?? ""),
            "layer": .string(layer.identifier),
          ]))
      }
    }
    return result
  }

  private static func point(_ payload: JSONValue) throws -> CGPoint {
    guard let x = payload["x"]?.number, let y = payload["y"]?.number else {
      throw TileflowMapError.invalidRequest
    }
    return CGPoint(x: x, y: y)
  }

  private static func wrap(_ longitude: Double) -> Double {
    guard longitude < -180 || longitude > 180 else { return longitude }
    let wrapped = (longitude + 180).truncatingRemainder(dividingBy: 360)
    return (wrapped < 0 ? wrapped + 360 : wrapped) - 180
  }

  // MARK: MLNMapViewDelegate

  nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
    MainActor.assumeIsolated {
      guard styleRequested else { return }
      styleLoaded = true
    }
  }

  nonisolated func mapViewDidFinishLoadingMap(_ mapView: MLNMapView) {
    MainActor.assumeIsolated { contentLoaded() }
  }

  nonisolated func mapViewDidFinishRenderingMap(_ mapView: MLNMapView, fullyRendered: Bool) {
    guard fullyRendered else { return }
    MainActor.assumeIsolated { contentLoaded() }
  }

  nonisolated func mapViewDidFinishRenderingFrame(_ mapView: MLNMapView, fullyRendered: Bool) {
    guard fullyRendered else { return }
    MainActor.assumeIsolated { contentLoaded() }
  }

  nonisolated func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: any Error) {
    MainActor.assumeIsolated {
      guard styleRequested, !styleLoaded, !retired else { return }
      onFailure?(
        TileflowMapError(
          .resourceFailed,
          context: .init(resource: .style, message: "MapLibre could not load the map's style.")))
    }
  }

  nonisolated func mapView(_ mapView: MLNMapView, regionDidChangeAnimated animated: Bool) {
    MainActor.assumeIsolated {
      guard !contentPending, styleLoaded else { return }
      updateAttribution()
    }
  }
}

/// Repeated warnings of one kind arrive as one event per second: the first at once, the rest with
/// their count when the second ends, as the web runtime aggregates them.
@MainActor
final class MapWarningAggregator {
  private let report: (JSONValue) -> Void
  private var windows: [String: (warning: JSONValue, repeats: Int, timer: Task<Void, Never>)] = [:]

  init(report: @escaping (JSONValue) -> Void) {
    self.report = report
  }

  func warn(_ warning: JSONValue) {
    let context = warning["context"]
    let key = [
      warning["code"]?.string, context?["reason"]?.string, context?["resource"]?.string,
      context?["origin"]?.string, context?["status"]?.number.map { String($0) },
    ].map { $0 ?? "" }.joined(separator: "\n")
    if var window = windows[key] {
      window.warning = warning
      window.repeats += 1
      windows[key] = window
      return
    }
    report(Self.counted(warning, 1))
    let timer = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(ProtocolContract.warningWindowMilliseconds))
      guard !Task.isCancelled else { return }
      self?.close(key)
    }
    windows[key] = (warning, 0, timer)
  }

  func retire() {
    for window in windows.values { window.timer.cancel() }
    windows.removeAll()
  }

  private func close(_ key: String) {
    guard let window = windows.removeValue(forKey: key) else { return }
    if window.repeats > 0 { report(Self.counted(window.warning, window.repeats)) }
  }

  private static func counted(_ warning: JSONValue, _ count: Int) -> JSONValue {
    guard case .object(var value) = warning else { return warning }
    value["count"] = .number(Double(count))
    return .object(value)
  }
}
