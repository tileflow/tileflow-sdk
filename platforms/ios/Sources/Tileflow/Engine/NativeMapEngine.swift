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
/// Themes, blends and emphasis come from the map's family document and the native evaluators
/// (``NativeEvaluators``). The engine answers the commands it implements and rejects the others
/// with `invalidRequest`, so a view never believes a request took effect.
@MainActor
final class NativeMapEngine: NSObject, MapEngine, MLNMapViewDelegate {
  /// A style with nothing to draw, which needs no resource.
  static let emptyStyle = #"{"version":8,"sources":{},"layers":[]}"#

  var onAnnotationFrame: ((Int, [CGPoint?]) -> Void)?
  var onReady: (() -> Void)?
  var onEvent: ((String, JSONValue) -> Void)?
  var onFailure: ((TileflowMapError) -> Void)?
  var onLoadFailure: ((TileflowMapError) -> Void)?
  var onExternalLink: ((URL) -> Void)?
  var onRendererTerminated: ((ProtocolContract.ErrorReason) -> Void)?

  let data = DataChannel()
  let runtimeStyle = NativeRuntimeStyle()
  lazy var mapLocation = NativeMapLocation(self)
  lazy var scene = NativeMapScene(self)
  lazy var mapAnnotations = NativeMapAnnotations(self)
  lazy var sceneContent = NativeSceneContent(self)
  lazy var sceneAnimations = NativeSceneAnimations(self)
  private let resourceKinds = LockedValue<[(prefix: String, kind: TileflowResourceKind)]>([])
  private var baseResourceKinds: [(prefix: String, kind: TileflowResourceKind)] = []
  private var styleWork: Task<Void, Never>?
  private var baseAttributions: [String] = []
  private var attributionStyle: [String: Any] = [:]
  let container = UIView()
  private(set) var mapView: MLNMapView?
  let loader: any ResourceLoading
  private let grantScope: ResourceCacheScope?
  private let offline: OfflineServingIndex
  /// The map's context in MapLibre's requests, while it is registered.
  private(set) var context: String?
  lazy var warnings = MapWarningAggregator { [weak self] warning in
    self?.onEvent?("warning", warning)
  }
  private(set) var retired = false
  private var retirementError: TileflowMapError?
  private var initialized = false
  /// Whether the map's own style finished loading; the initial empty style does not count.
  var styleLoaded = false
  private var loadedStyle: MLNStyle? { styleLoaded ? mapView?.style : nil }
  private var styleRequested = false
  /// Whether `contentReady` waits for the map's style to finish drawing.
  private var contentPending = false
  /// The attribution the map shows, in the SDK's own control.
  let attribution = MapAttributionControl()

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
      self.attribution.view.frame = self.container.bounds
      self.attribution.onLink = { [weak self] url in self?.onExternalLink?(url) }
      self.container.addSubview(self.attribution.view)
      self.mapView = mapView
      self.prepareCamera(mapView)
      self.mapLocation.install(on: mapView)
      self.onReady?()
    }
  }

  func setAnnotations(_ annotations: [TileflowAnnotation], overlays: [TileflowGeoJSONLayer]) async throws {
    guard !retired else { throw retirementError ?? TileflowMapError.disposed }
    guard mapView != nil else { throw TileflowMapError.notReady }
    let values = try annotations.map { try $0.wireValue() }
    mapAnnotations.setPins(try NativeMapAnnotations.pins(in: .object(["annotations": .array(values)])))
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
    case .addSource, .addLayer, .moveLayer, .updateLayer, .removeSource, .removeLayer,
      .setGeoJSONSourceData, .updateGeoJSONSource, .setFeatureState, .removeFeatureState,
      .queryRenderedFeatures, .querySourceFeatures, .queryCluster, .setImages:
      // A TileJSON request may suspend. Apply later layer and source commands in submission order.
      let prior = styleWork
      let work = Task { @MainActor [weak self] in
        await prior?.value
        try Task.checkCancellation()
        guard let self else { throw TileflowMapError.disposed }
        if let error = self.retirementError { throw error }
        do {
          return try await self.styleCommand(command, request: payload)
        } catch {
          try Task.checkCancellation()
          if let lifecycleError = self.retirementError { throw lifecycleError }
          throw error
        }
      }
      styleWork = Task { _ = await work.result }
      return try await withTaskCancellationHandler {
        try await work.value
      } onCancel: {
        work.cancel()
      }
    case .setSun: return try await scene.setSun(payload)
    case .setStyleState: return try await scene.setStyleState(payload)
    case .setBoundaryValues:
      try scene.setBoundaries(payload, data: self.data)
      return .null
    case .queryAtPoint:
      return .array(features(at: try Self.point(payload)))
    case .setVisibility:
      mapLocation.setVisible(payload["visible"]?.bool ?? true)
      return .null
    case .updateLocation:
      try mapLocation.update(payload)
      return .null
    case .setFollowMode:
      try mapLocation.setFollow(payload)
      return .null
    case .setOptions:
      if let mode = payload["viewMode"]?.string { setViewMode(mode, duration: 0) }
      applyCameraOptions(payload)
      attribution.place(corner: payload["attribution"]?.string, insets: nil)
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
      let pins = try NativeMapAnnotations.pins(in: payload)
      if try sceneContent.setContent(payload, data: self.data) { sceneAnimations.stopLines() }
      mapAnnotations.setPins(pins)
      return .null
    case .setDepthMarkers:
      guard let markers = payload["markers"]?.array else { throw TileflowMapError.invalidRequest }
      try sceneContent.setMarkers(markers)
      return .null
    case .animateLineProgress: return try sceneAnimations.progress(payload, content: sceneContent)
    case .playShot:
      mapLocation.interrupt(.api)
      return try await sceneAnimations.play(payload)
    case .stopAnimation:
      sceneAnimations.stop(payload)
      return .null
    case .setAnnotationLayers:
      try mapAnnotations.setLayers(payload)
      return .null
    case .setTrackedPoints:
      try mapAnnotations.setTracking(payload)
      return .null
    default:
      throw Self.unsupported(command)
    }
  }

  private func styleCommand(_ command: MapEngineCommand, request: JSONValue) async throws
    -> JSONValue
  {
    switch command {
    case .addSource, .setGeoJSONSourceData:
      guard let theme = shown?.theme, let url = manifest?.styles[theme], let context else {
        throw TileflowMapError.notReady
      }
      if command == .addSource {
        let source = try await NativeRuntimeStyle.prepareSource(
          request, channel: data, styleURL: url, load: loadApplicationData,
          project: { [self] in try await project($0, styleURL: $1, context: context) })
        try Task.checkCancellation()
        if let error = retirementError { throw error }
        try runtimeStyle.addSource(source, in: loadedStyle)
        updateApplicationResources()
      } else {
        guard let value = request["data"], let id = request["id"]?.string else {
          throw TileflowMapError.invalidRequest
        }
        let bytes = try await NativeRuntimeStyle.geoJSONBytes(
          value, channel: data, styleURL: url, load: loadApplicationData)
        try Task.checkCancellation()
        if let error = retirementError { throw error }
        try runtimeStyle.replaceData(bytes, source: id, in: loadedStyle)
      }
    case .removeSource:
      try runtimeStyle.removeSource(request, style: loadedStyle)
      updateApplicationResources()
    case .addLayer, .updateLayer, .moveLayer, .removeLayer:
      try runtimeStyle.modifyLayer(command, request: request, style: loadedStyle)
    case .updateGeoJSONSource:
      try runtimeStyle.updateFeatures(request, channel: data, in: loadedStyle)
    case .setFeatureState, .removeFeatureState:
      try runtimeStyle.changeState(command, request: request, style: loadedStyle)
    case .queryRenderedFeatures:
      guard let mapView, let loadedStyle else { throw TileflowMapError.notReady }
      return try runtimeStyle.queryRendered(request, map: mapView, style: loadedStyle)
    case .querySourceFeatures:
      guard let loadedStyle else { throw TileflowMapError.notReady }
      return try runtimeStyle.querySource(request, style: loadedStyle)
    case .queryCluster:
      guard let loadedStyle else { throw TileflowMapError.notReady }
      return try runtimeStyle.queryCluster(request, style: loadedStyle)
    case .setImages:
      try runtimeStyle.setImages(request, channel: data, style: loadedStyle)
      try sceneContent.imagesChanged()
    default: throw Self.unsupported(command)
    }
    return .null
  }

  private func loadApplicationData(_ url: URL) async throws -> Data {
    let response = try await loader.load(URLRequest(url: url))
    guard response.status == 200 else {
      throw TileflowMapError(
        .resourceFailed,
        context: .init(resource: .data, origin: ResourcePolicy.origin(url), status: response.status)
      )
    }
    return response.bytes
  }

  private func updateApplicationResources() {
    let sources = runtimeStyle.sources.values.sorted { $0.id < $1.id }
    let kinds = (baseResourceKinds + sources.flatMap(\.resourceKinds)).sorted {
      $0.prefix.count > $1.prefix.count
    }
    resourceKinds.withLock { $0 = kinds }
    var credits = baseAttributions
    for source in sources {
      if let text = source.spec["attribution"]?.string, !text.isEmpty, !credits.contains(text) {
        credits.append(text)
      }
    }
    attribution.setStyle(attributionStyle, attributions: credits)
  }

  static func unsupported(_ command: MapEngineCommand) -> TileflowMapError {
    TileflowMapError(
      .invalidRequest,
      context: .init(message: "The native map engine does not support \(command.rawValue) yet."))
  }

  func retire(_ error: TileflowMapError) {
    guard !retired else { return }
    mapLocation.retire()
    onAnnotationFrame = nil
    mapAnnotations.retire()
    sceneAnimations.retire()
    scene.retire()
    retirementError = error
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
    let resourceKinds = self.resourceKinds
    let context = MapResourceContexts.shared.register(
      MapResourceRoute(
        loader: loader,
        classify: { remote in
          resourceKinds.withLock { $0.first { remote.absoluteString.hasPrefix($0.prefix) }?.kind }
            ?? .tile
        },
        report: { [weak self] outcome in
          Task { @MainActor in self?.received(outcome) }
        }))
    self.context = context
    attribution.place(corner: payload["options"]?["attribution"]?.string, insets: payload["insets"])
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
    let preparation = NativeMapPreparation(loader: loader, context: context, storedZooms: storedZooms)
    let prepared = try await preparation.map(
      map, manifestURL: manifestURL, discoveryMapID: payload["source"]?["discoveryMapId"]?.string,
      theme: payload["theme"]?.string, colorScheme: colorScheme, fromPacks: fromPacks)
    let manifest = prepared.manifest
    let theme = prepared.theme
    self.manifest = manifest
    family = await loadFamily(styleURL: theme.styleURL)
    await readDownloadedCredits()
    guard !retired, mapView != nil else { throw TileflowMapError.cancelled }
    shown = .theme(theme.name)
    configureCamera(payload)
    camera?.jump(to: TileflowCamera(wire: payload["camera"]) ?? manifest.view)
    styleRequested = true
    contentPending = true
    show(prepared.document.value, projected: prepared.projected)
  }

  /// Reads a theme's style through the map's transport and projects it for this map.
  func loadStyle(_ url: URL) async throws -> ([String: Any], ProjectedStyle) {
    guard let context else { throw TileflowMapError.notReady }
    let preparation = NativeMapPreparation(loader: loader, context: context, storedZooms: storedZooms)
    let (document, projected) = try await preparation.style(url)
    return (document.value, projected)
  }

  func project(_ style: [String: Any], styleURL: URL, context: String) async throws -> ProjectedStyle {
    try await NativeMapPreparation(loader: loader, context: context, storedZooms: storedZooms)
      .project(.init(value: style), styleURL: styleURL)
  }

  /// Reads the map's family document, if it has one, and checks a Hosted document against the
  /// revision discovery gave. A map without it draws its themes but cannot blend them or apply an
  /// emphasis.
  private func loadFamily(styleURL: URL) async -> NativeFamily? {
    guard let manifest else { return nil }
    return await NativeFamily.load(manifest, styleURL: styleURL, loader: loader) { url in
      warnings.warn(
        .object([
          "code": .string("resourceFailed"),
          "message": .string("The map's family document does not match its revision."),
          "context": .object([
            "resource": .string("style"), "origin": .string(ResourcePolicy.origin(url)),
          ]),
        ]))
    }
  }

  /// Gives MapLibre a projected style. What the engine reads from it applies once it loads.
  func show(_ style: [String: Any], projected: ProjectedStyle) {
    guard let mapView else { return }
    baseResourceKinds = projected.kinds
    baseAttributions = projected.attributions
    attributionStyle = ["metadata": style["metadata"] ?? [:]]
    updateApplicationResources()
    runtimeStyle.configure(theme: shown?.theme, metadata: style["metadata"] as? [String: Any])
    document = NativeStyleDocument.Shown(style, omitted: projected.omitted)
    styleLoaded = false
    mapView.styleJSON = projected.json
  }

  /// Reads a JSON document of the map through its transport.
  /// A request of the map ended: failures become aggregated warnings, as the web runtime reports
  /// them. A tile the source does not have (`404`) is not a failure; an absent tile answers `204`.
  /// A failure that ends the map, such as an exhausted quota, is reported as the map's own.
  private func received(_ outcome: MapResourceOutcome) {
    guard !retired else { return }
    attribution.received(outcome.fairUse)
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

  /// Checks the regional credits against the view, at the end of each camera movement and when
  /// the content loads, and reads the downloaded credits again, which a region downloaded or
  /// removed meanwhile changes.
  func updateAttribution() {
    attribution.update(in: visibleBounds)
    Task { [weak self] in await self?.readDownloadedCredits() }
  }

  /// The credits of the sources a Hosted map's downloaded regions hold. The map shows them online
  /// as well as offline: online its tiles may come from those regions too.
  private func readDownloadedCredits() async {
    guard let grantScope else { return }
    let obligations = await offline.obligations(for: grantScope)
    let credits = await offline.credits(for: grantScope)
    guard !retired else { return }
    attribution.setDownloaded(obligations: obligations, credits: credits)
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
      guard styleRequested, !retired, let loadedStyle = self.mapView?.style else { return }
      do {
        try runtimeStyle.restore(in: loadedStyle)
        try sceneContent.restore(in: loadedStyle)
      } catch {
        for waiter in styleWaiters { waiter.resume(throwing: error) }
        styleWaiters.removeAll()
        onFailure?(.invalidRequest)
        return
      }
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

  nonisolated func mapView(_ mapView: MLNMapView, viewFor annotation: any MLNAnnotation) -> MLNAnnotationView? {
    guard annotation is MLNUserLocation else { return nil }
    return MainActor.assumeIsolated { mapLocation.makePuck() }
  }

  nonisolated func mapViewDidFinishRenderingFrame(_ mapView: MLNMapView, fullyRendered: Bool) {
    MainActor.assumeIsolated {
      mapAnnotations.frame()
      scene.confirmBoundaries()
      if !runtimeStyle.pendingState.isEmpty, let style = loadedStyle { runtimeStyle.confirmState(in: style) }
      if fullyRendered {
        contentLoaded()
        rendered()
      }
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
    MainActor.assumeIsolated {
      if !reason.isDisjoint(with: NativeCamera.anyGesture) {
        mapLocation.interrupt(.gesture)
        sceneAnimations.stopShot()
      }
      camera?.willChange(reason)
    }
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
