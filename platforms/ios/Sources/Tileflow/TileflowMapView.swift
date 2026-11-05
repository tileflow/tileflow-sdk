import Foundation
import UIKit

@MainActor
public final class TileflowMapView: UIView {
  weak var declarativeContent: MapContentCoordinator?
  private lazy var accessibilitySummary = MapAccessibilitySummary(map: self)

  public override var accessibilityElements: [Any]? {
    get { super.accessibilityElements ?? [accessibilitySummary] + subviews }
    set { super.accessibilityElements = newValue }
  }

  public var onEvent: ((TileflowMapEvent) -> Void)?

  func emit(_ event: TileflowMapEvent) {
    TileflowMapDiagnostics.report(event, to: options.diagnostics)
    onEvent?(event)
  }

  public private(set) var source: TileflowMapSource
  public private(set) var theme: String?
  public private(set) var options: TileflowMapOptions

  /// The current generation's engine, while one is loaded.
  private(set) var engine: (any MapEngine)?
  private var generation = 0
  private(set) var destroyed = false
  /// Whether the current renderer accepted `initialize`; commands before it are not sent.
  private(set) var initialized = false
  private var readyForEvents = false
  private var pendingReadyEvent = false
  /// Renderer replacements since content last loaded; a crash loop stops after one.
  private var recoveryCount = 0
  /// Whether this load may still reload itself once for a superseded Map deployment.
  private var automaticReloadAvailable = true
  private var generationReady = false
  private var inForeground = UIApplication.shared.applicationState != .background
  private var rendererVisible = false
  /// A renderer to replace once the view is visible again.
  private var pendingRemount = false
  /// The camera the renderer last reported, or the one to start the next renderer at.
  var initialCamera: TileflowCamera?
  private var initialCameraUpdate: TileflowCameraUpdate?
  private var initialCameraBounds: TileflowBounds?
  private var initialCameraPadding = UIEdgeInsets.zero
  /// A camera the application asked for while no renderer could move, and how many it asked for.
  var requestedCamera: (camera: TileflowCamera, count: Int)?
  /// The current source with its configuration read, kept with its Hosted session.
  private var loadable: LoadableMapSource?
  private var hostedSession: HostedSession?
  private var appearance: (method: MapContract.Method, payload: JSONValue)?
  var content = MapContent()
  private var contentRevision = 0
  private var subscriptions = EventSubscriptions()
  let cameraEvents = CameraEventGate()
  let controlsView = MapControlsView()
  /// The location provider, the latest position and the follow mode.
  let location = MapLocation()
  private let touchClaim = MapTouchClaim()
  /// Space covered by the application at each edge, in points.
  public var contentInsets: UIEdgeInsets = .zero {
    didSet { updateInsets() }
  }
  /// Whether the safe area (system bars, the home indicator, the notch) adds to ``contentInsets``.
  public var automaticallyAdjustsContentInsets = true {
    didSet { updateInsets() }
  }
  /// The insets the camera and controls use: ``contentInsets`` plus the safe area if adjusted.
  public private(set) var effectiveContentInsets: UIEdgeInsets = .zero
  /// The insets the current renderer has, or nil before it is initialized.
  private var rendererInsets: UIEdgeInsets?
  private var insetsUpdate: Task<Void, Never>?
  /// Return false to leave a touch that begins at this point, in this view's coordinates, to the
  /// views behind and around the map; for example over application UI drawn on the map. Native
  /// controls and the attribution receive their touches regardless.
  public var shouldReceiveTouch: ((CGPoint) -> Bool)?
  /// The scene beyond the theme the application asked for, given again to each new renderer.
  var scene = SceneState()
  /// The application's runtime style, given again to each new renderer.
  var runtimeStyle = RuntimeStyle()
  let styleEdits = StyleEditQueue()
  var styleRestored = false
  var styleEngine: (any MapEngine)? { styleRestored ? readyEngine : nil }
  /// The application images the scene holds.
  var images: [TileflowMapImage] = []
  /// Calls waiting for an animation of the current renderer to end.
  let animations = AnimationWaiters()
  /// Native view annotations and the accessibility elements of annotations, over the renderer.
  let annotationOverlay = AnnotationOverlay()
  /// The map's annotation managers. Each draws its annotations with a source and a layer of the
  /// application's runtime style.
  public internal(set) lazy var annotations = TileflowAnnotationOrchestrator(view: self)
  /// Native views that follow coordinates of the map, such as markers and callouts.
  public internal(set) lazy var viewAnnotations = TileflowViewAnnotationManager(view: self)
  /// Whether annotation layers exist, and whether the renderer tracks points for annotations.
  private var annotationInteraction = false

  public init(
    source: TileflowMapSource, theme: String? = nil, initialCamera: TileflowCamera? = nil,
    options: TileflowMapOptions = .init()
  ) {
    self.source = source
    self.theme = theme
    self.initialCamera = initialCamera
    self.options = options
    subscriptions = EventSubscriptions(
      application: options.events, followCamera: options.controls.followCamera)
    super.init(frame: .zero)
    annotationOverlay.map = self
    accessibilityCustomRotors = [makeAnnotationRotor()]
    location.view = self
    accessibilityLabel = "Interactive map"
    controlsView.controls = options.controls
    controlsView.locationShown = options.location.enabled
    controlsView.camera = initialCamera
    controlsView.isHidden = true
    controlsView.onCompass = { [weak self] in self?.compassTapped() }
    controlsView.onRecenter = { [weak self] in self?.recenterTapped() }
    addSubview(controlsView)
    insertSubview(annotationOverlay, belowSubview: controlsView)
    touchClaim.gestures = options.gestures
    addGestureRecognizer(touchClaim)
    NotificationCenter.default.addObserver(
      self, selector: #selector(background),
      name: UIApplication.didEnterBackgroundNotification, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(foreground),
      name: UIApplication.willEnterForegroundNotification, object: nil)
  }

  /// Shows a Hosted map. Its credential and API origin come from ``Tileflow/configuration()``;
  /// use ``TileflowMapSource/hosted(mapID:surfaceID:publicResourceOrigins:configuration:)`` to
  /// pass a configuration for this map only.
  public convenience init(
    mapID: String, theme: String? = nil, initialCamera: TileflowCamera? = nil,
    options: TileflowMapOptions = .init()
  ) {
    self.init(
      source: .hosted(mapID: mapID), theme: theme, initialCamera: initialCamera, options: options)
  }

  /// Applies a partial camera to the authored view before loading the style. Bounds use the
  /// measured viewport; zoom caps their fit. A restored camera takes precedence on reload.
  public convenience init(
    source: TileflowMapSource, theme: String? = nil,
    initialCameraUpdate: TileflowCameraUpdate, initialCameraBounds: TileflowBounds? = nil,
    initialCameraPadding: UIEdgeInsets = .zero, options: TileflowMapOptions = .init()
  ) {
    self.init(source: source, theme: theme, options: options)
    self.initialCameraUpdate = initialCameraUpdate
    self.initialCameraBounds = initialCameraBounds
    self.initialCameraPadding = initialCameraPadding
    if initialCameraBounds == nil { contentInsets = initialCameraPadding }
  }

  func startingCamera() throws -> [String: JSONValue] {
    if let initialCamera { return ["camera": try .encoded(initialCamera)] }
    guard let update = initialCameraUpdate else { return [:] }
    let edges = [initialCameraPadding.top, initialCameraPadding.left,
      initialCameraPadding.bottom, initialCameraPadding.right]
    guard edges.allSatisfy({ $0.isFinite && $0 >= 0 }) else {
      throw TileflowMapError.invalidRequest
    }
    var result = ["cameraUpdate": try update.wireValue()]
    if let bounds = initialCameraBounds {
      guard update.center == nil, (-180...180).contains(bounds.west),
        (-180...180).contains(bounds.east), (-90...90).contains(bounds.south),
        (-90...90).contains(bounds.north), bounds.south <= bounds.north
      else { throw TileflowMapError.invalidRequest }
      result["cameraBounds"] = try .encoded(bounds)
      result["cameraPadding"] = Self.wire(initialCameraPadding)
    }
    return result
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Use init(source:theme:initialCamera:).") }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, engine == nil, !destroyed, !pendingRemount {
      do { try mount() } catch { emit(.failed(error as? TileflowMapError ?? .invalidSource)) }
    }
    updateVisibility()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    engine?.view.frame = bounds
    annotationOverlay.frame = bounds
    controlsView.frame = bounds
    updateInsets()
  }

  public override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    updateInsets()
  }

  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let target = super.hitTest(point, with: event)
    guard let shouldReceiveTouch, target !== controlsView,
      target?.isDescendant(of: controlsView) != true
    else { return target }
    // The attribution always receives its touches, as the native controls do.
    var view = target
    while let current = view {
      if current is MapAttributionView { return target }
      view = current.superview
    }
    return shouldReceiveTouch(point) ? target : nil
  }

  /// Sends the insets to the renderer, one update at a time with the latest value.
  private func updateInsets() {
    let safe = automaticallyAdjustsContentInsets ? safeAreaInsets : .zero
    let insets = UIEdgeInsets(
      top: contentInsets.top + safe.top, left: contentInsets.left + safe.left,
      bottom: contentInsets.bottom + safe.bottom, right: contentInsets.right + safe.right)
    effectiveContentInsets = insets
    controlsView.insets = insets
    guard initialized, let engine, insetsUpdate == nil, rendererInsets != insets else { return }
    insetsUpdate = Task { [weak self] in
      let sent = try? await engine.call(.setInsets, payload: Self.wire(insets))
      guard let self else { return }
      self.insetsUpdate = nil
      if sent != nil, self.engine === engine { self.rendererInsets = insets }
      if self.engine === engine { self.updateInsets() }
    }
  }

  nonisolated static func wire(_ insets: UIEdgeInsets) -> JSONValue {
    let value = { (inset: CGFloat) in JSONValue.number(min(max(Double(inset), 0), 8192)) }
    return .object([
      "top": value(insets.top), "left": value(insets.left), "bottom": value(insets.bottom),
      "right": value(insets.right),
    ])
  }

  public func setSource(_ source: TileflowMapSource) throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard source != self.source else { return }
    try source.validate()
    hostedSession?.close()
    hostedSession = nil
    loadable = nil
    self.source = source
    resetRecovery()
    retireGeneration()
    if window != nil { try mount() }
  }

  /// Nil selects the map's authored default. "system" follows its declared system themes.
  public func setTheme(
    _ theme: String?, timeOfDay: TileflowTimeOfDay? = nil, duration: TimeInterval = 0
  ) async throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard theme == nil || (!theme!.isEmpty && theme!.utf8.count <= 128),
      (0...5).contains(duration)
    else { throw TileflowMapError.invalidRequest }
    self.theme = theme
    var payload: [String: JSONValue] = [
      "theme": theme.map(JSONValue.string) ?? .null,
      "colorScheme": .string(colorScheme), "duration": .number(duration * 1000),
    ]
    if let timeOfDay { payload["timeOfDay"] = .string(timeOfDay.rawValue) }
    appearance = (.setTheme, .object(payload))
    try await applyAppearance()
  }

  public func setBlend(
    themes: [String], position: Double, hold: Bool = false, duration: TimeInterval = 0
  ) async throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard (2...8).contains(themes.count), Set(themes).count == themes.count,
      themes.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 128 && $0 != "system" }),
      (0...Double(themes.count - 1)).contains(position), (0...5).contains(duration)
    else { throw TileflowMapError.invalidRequest }
    appearance = (
      .setBlend,
      .object([
        "themes": .array(themes.map(JSONValue.string)),
        "position": .number(position), "hold": .bool(hold), "duration": .number(duration * 1000),
      ])
    )
    try await applyAppearance()
  }

  public func setOptions(_ options: TileflowMapOptions) async throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    try options.validate()
    let previous = self.options
    if previous.diagnostics !== options.diagnostics {
      self.options.diagnostics = options.diagnostics
      if self.options == options { return }
    }
    let previousSubscriptions = subscriptions
    self.options = options
    subscriptions = EventSubscriptions(
      application: options.events, followCamera: options.controls.followCamera)
    subscriptions.set(.annotations, annotationDemand)
    touchClaim.gestures = options.gestures
    controlsView.controls = options.controls
    controlsView.locationShown = options.location.enabled
    locationOptionsChanged(from: previous.location)
    try await sendOptions(events: subscriptions != previousSubscriptions)
  }

  private var annotationDemand: [MapContract.Event: Int] {
    var demand: [MapContract.Event: Int] = [:]
    if annotationInteraction {
      demand[.tap] = 0
      demand[.longPress] = 0
      demand[.annotationDragged] = 0
    }
    return demand
  }

  /// Annotation layers need taps, long presses and drags whatever the application's level.
  func setAnnotationInteraction(_ needed: Bool) {
    guard needed != annotationInteraction else { return }
    annotationInteraction = needed
    updateAnnotationSubscriptions()
  }

  private func updateAnnotationSubscriptions() {
    let previous = subscriptions
    subscriptions.set(.annotations, annotationDemand)
    guard subscriptions != previous, initialized, let engine else { return }
    let events = subscriptions.wireValue
    Task { _ = try? await engine.call(.setEvents, payload: .object(["events": events])) }
  }

  private func sendOptions(events: Bool) async throws {
    guard initialized, let engine else { return }
    _ = try await engine.call(.setOptions, payload: try wireOptions)
    if events {
      _ = try await engine.call(.setEvents, payload: .object(["events": subscriptions.wireValue]))
    }
  }

  private var rightToLeft: Bool { effectiveUserInterfaceLayoutDirection == .rightToLeft }
  private var wireOptions: JSONValue {
    get throws { try options.wireValue(rightToLeft: rightToLeft) }
  }

  private func applyAppearance() async throws {
    guard initialized, let engine, let appearance else { return }
    _ = try await engine.call(appearance.method, payload: appearance.payload)
  }

  /// Replaces application content. Markers and layers survive theme and renderer replacement.
  public func setContent(
    annotations: [TileflowAnnotation] = [], layers: [TileflowGeoJSONLayer] = []
  ) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }
    try await replaceMapContent(.init(annotations: annotations, overlays: layers))
  }

  func replaceMapContent(_ next: MapContent) async throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    try next.validate()
    let previous = content
    contentRevision += 1
    let revision = contentRevision
    content = next
    do {
      if initialized, let engine { try await send(next, through: engine) }
    } catch {
      if revision == contentRevision { content = previous }
      throw error
    }
  }

  private func send(_ content: MapContent, through engine: any MapEngine) async throws {
    let (payload, references) = try content.wireValue(data: engine.data)
    _ = try await engine.call(.setContent, payload: payload, data: references)
  }

  /// Moves the camera, easing over `duration` seconds (at most 20), and waits until it settles.
  /// Before the map loads, the camera becomes the one it starts at.
  public func setCamera(_ camera: TileflowCamera, duration: TimeInterval = 0) async throws {
    try await move(to: camera, animation: duration > 0 ? .ease(duration: duration) : .none)
  }

  /// Reads the renderer's camera. ``currentCamera`` holds the last one it reported without a call.
  public func camera() async throws -> TileflowCamera {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let engine else { throw TileflowMapError.notReady }
    guard let camera = TileflowCamera(wire: try await engine.call(.getCamera)) else {
      throw TileflowMapError.rendererFailed
    }
    return camera
  }

  /// Returns rendered feature identities at a point in this view's coordinate system.
  public func query(at point: CGPoint) async throws -> [TileflowRenderedFeature] {
    guard !destroyed else { throw TileflowMapError.disposed }
    try Self.validate(point)
    guard initialized, let engine else { throw TileflowMapError.notReady }
    let result = try await engine.call(
      .queryAtPoint,
      payload: .object([
        "x": .number(point.x), "y": .number(point.y),
      ]))
    return try JSONDecoder().decode(
      [TileflowRenderedFeature].self, from: JSONEncoder().encode(result))
  }

  /// Frames `bounds` with `padding` points around them, inside the content insets, and waits
  /// until the camera settles. A `duration` above 0 eases there.
  public func fit(
    _ bounds: TileflowBounds, padding: Double = 24, maxZoom: Double = 20,
    duration: TimeInterval = 0
  ) async throws {
    guard (0...1000).contains(padding) else { throw TileflowMapError.invalidRequest }
    try await fit(
      bounds,
      padding: UIEdgeInsets(top: padding, left: padding, bottom: padding, right: padding),
      maxZoom: maxZoom, animation: duration > 0 ? .ease(duration: duration) : .none)
  }

  public func project(_ coordinate: TileflowCoordinate) async throws -> CGPoint {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let engine else { throw TileflowMapError.notReady }
    let value = try await engine.call(.project, payload: try .encoded(coordinate))
    guard let x = value["x"]?.number, let y = value["y"]?.number else {
      throw TileflowMapError.rendererFailed
    }
    return CGPoint(x: x, y: y)
  }

  public func unproject(_ point: CGPoint) async throws -> TileflowCoordinate {
    guard !destroyed else { throw TileflowMapError.disposed }
    try Self.validate(point)
    guard initialized, let engine else { throw TileflowMapError.notReady }
    let result = try await engine.call(
      .unproject, payload: .object(["x": .number(point.x), "y": .number(point.y)]))
    return try JSONDecoder().decode(TileflowCoordinate.self, from: JSONEncoder().encode(result))
  }

  /// Points may lie outside the view, within the renderer's coordinate range.
  nonisolated static func validate(_ point: CGPoint) throws {
    guard point.x.isFinite, point.y.isFinite, abs(point.x) <= 32_768, abs(point.y) <= 32_768
    else { throw TileflowMapError.invalidRequest }
  }

  public func destroy() {
    guard !destroyed else { return }
    destroyed = true
    hostedSession?.close()
    hostedSession = nil
    loadable = nil
    NotificationCenter.default.removeObserver(self)
    refreshLocation()
    annotationOverlay.stopRefreshes()
    retireGeneration(.disposed)
    onEvent = nil
  }

  /// Retry the current source after a load or renderer failure. A Hosted session stopped by
  /// `credentialRejected`, `accessDenied`, `quotaExceeded` or `sessionRejected` bootstraps again.
  /// Reloading also skips the delay that follows a temporary session failure (`rateLimited`,
  /// `sessionUnavailable` or `invalidSessionResponse`), so call it in response to a user action
  /// rather than from every failure event.
  public func reload() throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    hostedSession?.retry()
    resetRecovery()
    retireGeneration()
    if window != nil { try mount() }
  }

  private var isVisible: Bool { window != nil && inForeground }
  /// Whether the map is in a window while the application is in the foreground.
  var isShown: Bool { isVisible }

  private func resetRecovery() {
    recoveryCount = 0
    automaticReloadAvailable = true
    pendingRemount = false
  }

  /// Replace the renderer, keeping the Hosted session; a hidden view replaces it once visible.
  private func remount() {
    retireGeneration()
    guard isVisible else {
      pendingRemount = true
      return
    }
    do { try mount() } catch { emit(.failed(error as? TileflowMapError ?? .rendererFailed)) }
  }

  /// A load that fails while hidden, for example because the system suspended its networking,
  /// reloads once visible instead of reporting a failure nobody saw.
  private func report(_ error: TileflowMapError, generation expected: Int) {
    guard !destroyed, generation == expected else { return }
    guard generationReady || isVisible else {
      pendingRemount = true
      return
    }
    emit(.failed(error))
  }

  /// A protected style belongs to a superseded Map deployment: reload discovery once per load.
  private func deploymentSuperseded(generation expected: Int) -> Bool {
    guard !destroyed, generation == expected, automaticReloadAvailable else { return false }
    automaticReloadAvailable = false
    remount()
    return true
  }

  private func updateVisibility() {
    guard !destroyed else { return }
    refreshLocation()
    let visible = isVisible
    // While hidden, the session starts no bootstrap; requests that need one wait until visible.
    hostedSession?.setBackgrounded(!visible)
    guard visible != rendererVisible else { return }
    rendererVisible = visible
    if visible, pendingRemount {
      retireGeneration()
      do { try mount() } catch { emit(.failed(error as? TileflowMapError ?? .rendererFailed)) }
      return
    }
    guard initialized, let engine else { return }
    Task {
      _ = try? await engine.call(.setVisibility, payload: .object(["visible": .bool(visible)]))
    }
  }

  private var colorScheme: String { traitCollection.userInterfaceStyle == .dark ? "dark" : "light" }

  private func mount() throws {
    // A failed read is not kept, so `reload()` reads a corrected configuration.
    let loadable = try self.loadable ?? source.loadable()
    self.loadable = loadable
    TileflowDeviceProfile.prepare()
    generation += 1
    let current = generation
    pendingRemount = false
    // A new document starts shown; it is hidden after initialization if the view is not.
    rendererVisible = true
    if hostedSession == nil { hostedSession = loadable.makeSession() }
    hostedSession?.setBackgrounded(!isVisible)
    let loader = loadable.makeLoader(session: hostedSession) { [weak self] in
      await self?.deploymentSuperseded(generation: current) ?? false
    }
    let engine = NativeMapEngine(frame: bounds, loader: loader, grantScope: loadable.grantScope)
    engine.onFailure = { [weak self] error in
      self?.report(error, generation: current)
    }
    engine.onLoadFailure = { [weak self, weak engine] error in
      guard let self, let engine, !self.destroyed, self.generation == current,
        self.engine === engine
      else { return }
      self.retireGeneration()
      self.emit(.failed(error))
    }
    engine.onExternalLink = { [weak self] url in
      guard let self, !self.destroyed else { return }
      self.emit(.externalLinkRequested(url))
    }
    engine.onRendererTerminated = { [weak self, weak engine] reason in
      guard let self, let engine, self.engine === engine else { return }
      self.rendererTerminated(reason)
    }
    engine.onReady = { [weak self, weak engine] in
      guard let self, let engine, !self.destroyed, self.generation == current else { return }
      Task { [weak self] in
        guard let self else { return }
        await self.initialize(engine, loadable: loadable, generation: current)
      }
    }
    engine.onEvent = { [weak self] event, value in
      guard let self, !self.destroyed, self.generation == current else { return }
      self.receive(event, value, generation: current)
    }
    engine.onAnnotationFrame = { [weak self] revision, points in
      guard let self, !self.destroyed, self.generation == current else { return }
      self.annotationOverlay.receiveNativeFrame(revision: revision, points: points)
    }
    self.engine = engine
    annotationOverlay.frame = bounds
    insertSubview(engine.view, belowSubview: annotationOverlay)
    engine.start()
    updateVisibility()
  }

  /// Gives a ready engine the map, then everything the application asked for.
  private func initialize(
    _ engine: any MapEngine, loadable: LoadableMapSource, generation current: Int
  )
    async
  {
    do {
      let startingTheme = theme
      let startingRequest = requestedCamera?.count
      let startingOptions = options
      let startingSubscriptions = subscriptions
      var wireSource: [String: JSONValue] = [
        "map": .string(loadable.map),
        "manifestUrl": .string(loadable.manifestURL.absoluteString),
      ]
      if let mapID = loadable.mapID { wireSource["discoveryMapId"] = .string(mapID) }
      var configuration: [String: JSONValue] = [
        "source": .object(wireSource),
        "theme": theme.map(JSONValue.string) ?? .null,
        "colorScheme": .string(colorScheme), "interactive": .bool(true),
        "options": try wireOptions,
        "events": subscriptions.wireValue,
        "insets": Self.wire(effectiveContentInsets),
      ]
      let startingInsets = effectiveContentInsets
      configuration.merge(try startingCamera()) { $1 }
      // A Hosted map opened from downloaded regions shows their regional credits.
      if let scope = loadable.grantScope,
        OfflineServingRule.hostedUsesPacks(
          networkEnabled: TileflowHTTPClient.shared.isNetworkEnabled,
          reachable: OfflineReachability.shared.isReachable)
      {
        let credits = await OfflineServingIndex.shared.credits(for: scope)
        if !credits.isEmpty { configuration["credits"] = .array(credits.map(\.wireValue)) }
      }
      _ = try await engine.call(.initialize, payload: .object(configuration))
      guard !destroyed, generation == current else { return }
      initialized = true
      rendererInsets = startingInsets
      updateInsets()
      try await replay {
        try await self.styleEdits.acquire()
        defer { self.styleEdits.release() }
        try await self.send(self.content, through: engine)
      }
      if appearance != nil {
        try await replay { try await self.applyAppearance() }
      } else if theme != startingTheme {
        try await replay { try await self.setTheme(self.theme) }
      }
      if options != startingOptions {
        try await sendOptions(events: subscriptions != startingSubscriptions)
      }
      // Only a camera the application asked for during initialization moves the map again.
      if let request = requestedCamera, request.count != startingRequest {
        try await move(to: request.camera, animation: .none)
      }
      await annotations.prepareForReplay()
      guard !destroyed, generation == current else { return }
      try await replay { try await self.replayScene(through: engine) }
      try await replay { try await self.replayStyle(through: engine) }
      await declarativeContent?.rendererReady(on: self)
      guard !destroyed, generation == current else { return }
      try await replay { try await self.replayLocation(through: engine) }
      try await replay { try await self.replayAnnotations(through: engine) }
      if !rendererVisible {
        _ = try await engine.call(.setVisibility, payload: .object(["visible": .bool(false)]))
      }
      readyForEvents = true
      if pendingReadyEvent {
        pendingReadyEvent = false
        contentReady()
      }
    } catch {
      report(error as? TileflowMapError ?? .rendererFailed, generation: current)
    }
  }

  /// Gives a new engine part of what the application asked for. An engine that cannot draw it yet
  /// (`invalidRequest`) leaves the rest of the map loading, and the application gets a warning.
  private func replay(_ work: () async throws -> Void) async throws {
    do {
      try await work()
    } catch let error as TileflowMapError where error.code == .invalidRequest {
      guard !destroyed else { throw error }
      emit(.warning(TileflowMapWarning(error: error, occurrences: 1)))
    }
  }

  private func contentReady() {
    generationReady = true
    resetRecovery()
    controlsView.isHidden = false
    emit(.contentReady)
  }

  /// Keeps the synchronous camera and the controls current.
  func observe(_ camera: TileflowCamera) {
    initialCamera = camera
    controlsView.camera = camera
  }

  private static func poiSelection(_ value: JSONValue) -> TileflowPoiSelection? {
    guard let bytes = try? JSONEncoder().encode(value) else { return nil }
    return try? JSONDecoder().decode(TileflowPoiSelection.self, from: bytes)
  }

  private func receive(_ event: String, _ value: JSONValue, generation current: Int) {
    if event == "contentReady", !readyForEvents {
      pendingReadyEvent = true
      return
    }
    switch event {
    case "annotationActivated":
      if let id = value["id"]?.string, let raw = value["coordinate"],
        let bytes = try? JSONEncoder().encode(raw),
        let coordinate = try? JSONDecoder().decode(TileflowCoordinate.self, from: bytes)
      {
        emit(.annotationActivated(id: id, coordinate: coordinate))
      }
    case "poiActivated":
      if let selection = Self.poiSelection(value) { emit(.poiActivated(selection)) }
    case "loading": emit(.loading)
    case "contentReady":
      if let camera = TileflowCamera(wire: value["camera"]) { observe(camera) }
      contentReady()
    case "cameraMoveStarted", "cameraMoved", "cameraMoveEnded":
      if let change = Self.cameraChange(event, value) {
        observe(change.camera)
        cameraEvents.receive(change, options: options.events) { [weak self] change in
          guard let self, !self.destroyed, self.generation == current else { return }
          self.emit(.cameraChanged(change))
        }
      }
    case "tap":
      if let touch = TileflowMapTouch(wire: value),
        !annotationTouch(value, touch: touch, longPress: false)
      {
        if let selection = value["poi"].flatMap(Self.poiSelection) {
          emit(.poiActivated(selection))
        } else {
          emit(.tap(touch))
        }
      }
    case "longPress":
      if let touch = TileflowMapTouch(wire: value),
        !annotationTouch(value, touch: touch, longPress: true)
      {
        emit(.longPress(touch))
      }
    case "annotationDragged": receiveAnnotationDrag(value)
    case "gestureStarted", "gestureEnded":
      if options.events.level.includes(.camera),
        let gesture = value["gesture"]?.string.flatMap(TileflowGesture.init(rawValue:))
      {
        emit(event == "gestureStarted" ? .gestureStarted(gesture) : .gestureEnded(gesture))
      }
    case "themeChanged":
      if let name = value["theme"]?.string { emit(.themeChanged(name)) }
    case "themeTransition":
      if let transition = TileflowThemeTransition(wire: value) {
        emit(.themeTransition(transition))
      }
    case "animationEnded", "shotCue": animations.receive(event, value)
    case "followModeChanged": receiveFollowModeChanged(value)
    case "warning":
      if let count = value["count"]?.number.flatMap({ Int(exactly: $0) }), count > 0 {
        emit(
          .warning(TileflowMapWarning(error: TileflowMapError(wire: value), occurrences: count)))
      }
    case "error": report(TileflowMapError(wire: value), generation: current)
    default: break
    }
  }

  nonisolated static func cameraChange(_ event: String, _ value: JSONValue)
    -> TileflowCameraChange?
  {
    let phases: [String: TileflowCameraChangePhase] = [
      "cameraMoveStarted": .started, "cameraMoved": .moving, "cameraMoveEnded": .ended,
    ]
    guard let phase = phases[event], let raw = value["camera"],
      let reason = value["reason"]?.string.flatMap(TileflowCameraChangeReason.init(rawValue:)),
      let bytes = try? JSONEncoder().encode(raw),
      let camera = try? JSONDecoder().decode(TileflowCamera.self, from: bytes),
      (try? camera.validate()) != nil
    else { return nil }
    return TileflowCameraChange(
      camera: camera, reason: reason, phase: phase,
      bounds: value["bounds"].flatMap { TileflowBounds(wire: $0) })
  }

  /// Pending calls fail with `cancelled` when a renderer is replaced, `disposed` when destroyed.
  private func retireGeneration(_ error: TileflowMapError = .cancelled) {
    initialized = false
    styleRestored = false
    rendererInsets = nil
    insetsUpdate?.cancel()
    insetsUpdate = nil
    cameraEvents.rendererReplaced()
    annotationOverlay.rendererReplaced()
    readyForEvents = false
    pendingReadyEvent = false
    generationReady = false
    rendererVisible = false
    animations.retire(error)
    engine?.retire(error)
    engine = nil
    controlsView.isHidden = true
  }

  /// The current engine once it has initialized.
  var readyEngine: (any MapEngine)? { initialized ? engine : nil }
  var isDestroyed: Bool { destroyed }

  /// Records options a dedicated call already gave the renderer.
  func keepOptions(_ options: TileflowMapOptions) { self.options = options }

  /// Records where line progress animations lead, so a new renderer draws the lines there.
  func keepLineProgress(_ progress: TileflowLineProgress, for layers: Set<String>) {
    content.overlays = content.overlays.map { layer in
      guard layers.contains(layer.id), let current = layer.progress else { return layer }
      var next = layer
      next.progress = TileflowLineProgress(
        start: progress.start, end: progress.end, light: progress.light,
        opacity: progress.opacity, highlight: current.highlight)
      return next
    }
  }

  public override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    guard theme == "system", appearance?.method != .setBlend,
      previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle
    else { return }
    Task { [weak self] in
      guard let self else { return }
      do {
        if case .object(var payload) = self.appearance?.payload {
          payload["colorScheme"] = .string(self.colorScheme)
          self.appearance = (.setTheme, .object(payload))
          try await self.applyAppearance()
        } else {
          try await self.setTheme(self.theme)
        }
      } catch {
        if !self.destroyed { self.report(propertyError: error) }
      }
    }
  }

  /// The system may end a hidden renderer to reclaim memory, or a renderer may lose its graphics
  /// context. Replace it when the view is next visible; a renderer that ends again before its
  /// content loads is reported instead.
  private func rendererTerminated(_ reason: MapContract.ErrorReason) {
    guard !destroyed else { return }
    guard recoveryCount < 1 else {
      retireGeneration()
      emit(.failed(TileflowMapError(.rendererFailed, reason: reason)))
      return
    }
    recoveryCount += 1
    remount()
  }

  @objc private func background() {
    inForeground = false
    updateVisibility()
  }
  @objc private func foreground() {
    inForeground = true
    updateVisibility()
  }
}
