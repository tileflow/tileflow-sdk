import CryptoKit
import Foundation
import MapLibre
import OSLog
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
/// Themes, blends and emphasis come from the map's family document and the native evaluators
/// (``NativeEvaluators``). The engine answers the commands it implements and rejects the others
/// with `invalidRequest`, so a view never believes a request took effect.
@MainActor
final class NativeMapEngine: NSObject, MapEngine, MLNMapViewDelegate {
  /// A style with nothing to draw, which needs no resource.
  static let emptyStyle = #"{"version":8,"sources":{},"layers":[]}"#
  static let log = Logger(subsystem: "dev.tileflow", category: "map")

  var onReady: (() -> Void)?
  var onEvent: ((String, JSONValue) -> Void)?
  var onFailure: ((TileflowMapError) -> Void)?
  var onLoadFailure: ((TileflowMapError) -> Void)?
  var onExternalLink: ((URL) -> Void)?
  var onRendererTerminated: ((ProtocolContract.ErrorReason) -> Void)?

  let data = DataChannel()
  let container = UIView()
  private(set) var mapView: MLNMapView?
  let loader: any ResourceLoading
  private let grantScope: ResourceCacheScope?
  private let offline: OfflineServingIndex
  /// The map's context in MapLibre's requests, while it is registered.
  private(set) var context: String?
  private let projection = LockedValue<ProjectedStyle?>(nil)
  lazy var warnings = MapWarningAggregator { [weak self] warning in
    self?.onEvent?("warning", warning)
  }
  private(set) var retired = false
  private var initialized = false
  /// Whether the map's own style finished loading; the initial empty style does not count.
  var styleLoaded = false
  private var styleRequested = false
  /// Whether `contentReady` waits for the map's style to finish drawing.
  private var contentPending = false
  /// The attribution model, and the entries it gives for the current view.
  private(set) var attribution = MapAttribution()
  private(set) var attributionEntries: [MapAttributionEntry] = []

  // MARK: Appearance state, kept in NativeMapEngine+Appearance.swift

  /// The map's manifest, family document and the colour scheme the view reported.
  var manifest: NativeManifest?
  var family: NativeFamily?
  var colorScheme = "light"
  var storedZooms: NativeStyleDocument.StoredZooms?
  /// What the map shows: one theme, or a blend.
  var shown: NativeAppearance?
  /// The style document MapLibre loads or shows, with what the engine reads from it.
  var document: NativeStyleDocument.Shown?
  var appearanceRevision = 0
  var viewMode = "2d"
  var viewModeMotion: Task<Void, Never>?
  var emphasis = NativeEmphasis()
  /// Degradations already reported for this map, by record ID.
  var reportedFeatures: Set<String> = []
  /// Calls waiting for a style to load and draw.
  var styleWaiters: [CheckedContinuation<Void, any Error>] = []
  var renderWaiters: [CheckedContinuation<Void, Never>] = []

  // MARK: Camera state, kept in NativeMapEngine+Camera.swift

  /// The camera and the gestures, once MapLibre's view exists.
  var camera: NativeCamera?
  var gestures: NativeGestures?

  /// How many times the view sent each command, for diagnostics.
  private(set) var received: [MapEngineCommand: Int] = [:]

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
      // MapLibre iOS draws steep cameras up to the pitch the SDK's camera API allows.
      mapView.maximumPitch = TileflowCameraLimits.maximumPitch
      self.container.addSubview(mapView)
      self.mapView = mapView
      self.prepareCamera(mapView)
      self.onReady?()
    }
  }

  func call(_ command: MapEngineCommand, payload: JSONValue, data: [DataChannel.Reference])
    async throws -> JSONValue
  {
    defer { self.data.release(data) }
    guard !retired else { throw TileflowMapError.disposed }
    guard mapView != nil else { throw TileflowMapError.notReady }
    received[command, default: 0] += 1
    if let result = try await cameraCommand(command, payload: payload) { return result }
    switch command {
    case .initialize:
      try await initialize(payload)
      return .null
    case .queryAtPoint:
      return .array(features(at: try Self.point(payload)))
    case .setVisibility:
      return .null
    case .setOptions:
      if let mode = payload["viewMode"]?.string { setViewMode(mode, duration: 0) }
      applyCameraOptions(payload)
      return .null
    case .setTheme:
      return try await setTheme(payload)
    case .setBlend:
      return try await setBlend(payload)
    case .getRouteInks:
      return routeInks
    case .setEmphasis:
      return try await setEmphasis(payload)
    case .setViewMode:
      guard let mode = payload["viewMode"]?.string, ["2d", "3d"].contains(mode) else {
        throw TileflowMapError.invalidRequest
      }
      setViewMode(mode, duration: (payload["duration"]?.number ?? 0) / 1000)
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
    emphasis.motion?.cancel()
    viewModeMotion?.cancel()
    camera?.retire(error)
    gestures?.retire()
    for waiter in styleWaiters { waiter.resume(throwing: error) }
    styleWaiters.removeAll()
    for waiter in renderWaiters { waiter.resume() }
    renderWaiters.removeAll()
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

  /// MapLibre lost the graphics resources it draws with. The view replaces the engine: at once
  /// while it is visible, otherwise when it is next shown.
  func graphicsContextLost() {
    guard !retired else { return }
    onRendererTerminated?(.graphicsContextLost)
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
    colorScheme = payload["colorScheme"]?.string ?? "light"
    viewMode = payload["options"]?["viewMode"]?.string ?? "2d"

    let fromPacks =
      grantScope != nil
      && OfflineServingRule.hostedUsesPacks(
        networkEnabled: TileflowHTTPClient.shared.isNetworkEnabled,
        reachable: OfflineReachability.shared.isReachable)
    if let grantScope, fromPacks {
      let offline = self.offline
      storedZooms = { template in await offline.storedZooms(template: template, scope: grantScope) }
    }
    let manifest = try await Self.manifest(
      map: map, manifestURL: manifestURL,
      discoveryMapID: payload["source"]?["discoveryMapId"]?.string, fromPacks: fromPacks,
      loader: loader)
    self.manifest = manifest
    let theme = try manifest.resolve(payload["theme"]?.string, colorScheme: colorScheme)
    let (document, projected) = try await loadStyle(theme.styleURL)
    family = await loadFamily(styleURL: theme.styleURL)
    guard !retired, mapView != nil else { throw TileflowMapError.cancelled }
    shown = .theme(theme.name)
    configureCamera(payload)
    camera?.jump(to: TileflowCamera(wire: payload["camera"]) ?? manifest.view)
    styleRequested = true
    contentPending = true
    show(document, projected: projected)
  }

  /// Reads a theme's style through the map's transport and projects it for this map.
  func loadStyle(_ url: URL) async throws -> ([String: Any], ProjectedStyle) {
    guard let context else { throw TileflowMapError.notReady }
    let style = try await Self.read(url, kind: .style, loader: loader)
    let projected = try await Self.project(
      style, styleURL: url, context: context, loader: loader, storedZooms: storedZooms)
    return (style.value, projected)
  }

  func project(_ style: [String: Any], styleURL: URL, context: String) async throws -> ProjectedStyle
  {
    try await Self.project(
      StyleJSON(value: style), styleURL: styleURL, context: context, loader: loader,
      storedZooms: storedZooms)
  }

  /// A JSON document read off the main actor. Foundation's JSON values are not `Sendable`; each
  /// document has one owner at a time.
  struct StyleJSON: @unchecked Sendable {
    let value: [String: Any]
  }

  private nonisolated static func manifest(
    map: String, manifestURL: URL, discoveryMapID: String?, fromPacks: Bool,
    loader: any ResourceLoading
  ) async throws -> NativeManifest {
    try await NativeManifest.load(
      map: map, manifestURL: manifestURL, discoveryMapID: discoveryMapID, fromPacks: fromPacks,
      read: { url, kind in try await document(url, kind: kind, loader: loader) })
  }

  nonisolated static func read(_ url: URL, kind: TileflowResourceKind, loader: any ResourceLoading)
    async throws -> StyleJSON
  {
    StyleJSON(value: try await document(url, kind: kind, loader: loader))
  }

  private nonisolated static func project(
    _ style: StyleJSON, styleURL: URL, context: String, loader: any ResourceLoading,
    storedZooms: NativeStyleDocument.StoredZooms?
  ) async throws -> ProjectedStyle {
    try await NativeStyleDocument.project(
      style.value, styleURL: styleURL, context: context,
      load: { url, kind in try await document(url, kind: kind, loader: loader) },
      storedZooms: storedZooms)
  }

  /// Reads the map's family document, if it has one, and checks a Hosted document against the
  /// revision discovery gave. A map without it draws its themes but cannot blend them or apply an
  /// emphasis.
  private func loadFamily(styleURL: URL) async -> NativeFamily? {
    guard let url = manifest?.familyURL(styleURL: styleURL),
      let payload = try? await loader.load(URLRequest(url: url)), payload.status == 200
    else { return nil }
    if let revision = manifest?.family?.revision,
      SHA256.hash(data: payload.bytes).map({ String(format: "%02x", $0) }).joined() != revision
    {
      warnings.warn(
        .object([
          "code": .string("resourceFailed"),
          "message": .string("The map's family document does not match its revision."),
          "context": .object([
            "resource": .string("style"), "origin": .string(ResourcePolicy.origin(url)),
          ]),
        ]))
      return nil
    }
    guard let document = try? JSONDecoder().decode(JSONValue.self, from: payload.bytes) else {
      return nil
    }
    return NativeFamily(document)
  }

  /// Gives MapLibre a projected style. What the engine reads from it applies once it loads.
  func show(_ style: [String: Any], projected: ProjectedStyle) {
    guard let mapView else { return }
    projection.withLock { $0 = projected }
    attribution.sources = projected.attributions
    document = NativeStyleDocument.Shown(style, omitted: projected.omitted)
    styleLoaded = false
    mapView.styleJSON = projected.json
  }

  /// Reads a JSON document of the map through its transport.
  nonisolated static func document(
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

  func updateAttribution() {
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
      guard let vector = layer as? MLNVectorStyleLayer, layer.isVisible else { continue }
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

  static func point(_ payload: JSONValue) throws -> CGPoint {
    guard let x = payload["x"]?.number, let y = payload["y"]?.number else {
      throw TileflowMapError.invalidRequest
    }
    return CGPoint(x: x, y: y)
  }

  static func wrap(_ longitude: Double) -> Double {
    guard longitude < -180 || longitude > 180 else { return longitude }
    let wrapped = (longitude + 180).truncatingRemainder(dividingBy: 360)
    return (wrapped < 0 ? wrapped + 360 : wrapped) - 180
  }

  // MARK: MLNMapViewDelegate

  nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
    MainActor.assumeIsolated {
      guard styleRequested, !retired else { return }
      styleLoaded = true
      styleDidLoad()
      for waiter in styleWaiters { waiter.resume() }
      styleWaiters.removeAll()
    }
  }

  nonisolated func mapViewDidFinishLoadingMap(_ mapView: MLNMapView) {
    MainActor.assumeIsolated {
      contentLoaded()
      rendered()
    }
  }

  nonisolated func mapViewDidFinishRenderingMap(_ mapView: MLNMapView, fullyRendered: Bool) {
    guard fullyRendered else { return }
    MainActor.assumeIsolated {
      contentLoaded()
      rendered()
    }
  }

  nonisolated func mapViewDidFinishRenderingFrame(_ mapView: MLNMapView, fullyRendered: Bool) {
    guard fullyRendered else { return }
    MainActor.assumeIsolated {
      contentLoaded()
      rendered()
    }
  }

  nonisolated func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: any Error) {
    MainActor.assumeIsolated {
      guard styleRequested, !styleLoaded, !retired else { return }
      let failure = TileflowMapError(
        .resourceFailed,
        context: .init(resource: .style, message: "MapLibre could not load the map's style."))
      // A theme change waits for its style and reports the failure itself.
      guard styleWaiters.isEmpty else {
        for waiter in styleWaiters { waiter.resume(throwing: failure) }
        styleWaiters.removeAll()
        return
      }
      onFailure?(failure)
    }
  }

  nonisolated func mapView(
    _ mapView: MLNMapView, regionWillChangeWith reason: MLNCameraChangeReason, animated: Bool
  ) {
    MainActor.assumeIsolated { camera?.willChange(reason) }
  }

  nonisolated func mapView(_ mapView: MLNMapView, regionIsChangingWith reason: MLNCameraChangeReason)
  {
    MainActor.assumeIsolated { camera?.isChanging(reason) }
  }

  nonisolated func mapView(
    _ mapView: MLNMapView, regionDidChangeWith reason: MLNCameraChangeReason, animated: Bool
  ) {
    MainActor.assumeIsolated {
      camera?.didChange(reason)
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
      warning["code"]?.string, context?["reason"]?.string, context?["feature"]?.string,
      context?["resource"]?.string, context?["origin"]?.string,
      context?["status"]?.number.map { String($0) },
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
