import Foundation
import UIKit
import WebKit

@MainActor
public final class TileflowMapView: UIView, WKNavigationDelegate, WKUIDelegate {
  public var onEvent: ((TileflowMapEvent) -> Void)?
  public private(set) var source: TileflowMapSource
  public private(set) var theme: String?
  public private(set) var options: TileflowMapOptions

  private var webView: WKWebView?
  /// The current generation's bridge, while one is loaded.
  private(set) var bridge: MapBridge?
  private var resources: ResourceSchemeHandler?
  private let instanceID = UUID().uuidString
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
  /// A camera the application asked for while no renderer could move, and how many it asked for.
  var requestedCamera: (camera: TileflowCamera, count: Int)?
  /// The current source with its configuration read, kept with its Hosted session.
  private var loadable: LoadableMapSource?
  private var hostedSession: HostedSession?
  private var appearance: (method: ProtocolContract.Method, payload: JSONValue)?
  private var content = MapContent()
  private var contentRevision = 0
  private var subscriptions = EventSubscriptions()
  let cameraEvents = CameraEventGate()
  private let controlsView = MapControlsView()
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
  /// controls receive their touches regardless.
  public var shouldReceiveTouch: ((CGPoint) -> Bool)?

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
    accessibilityLabel = "Interactive map"
    controlsView.controls = options.controls
    controlsView.camera = initialCamera
    controlsView.isHidden = true
    controlsView.onCompass = { [weak self] in
      Task { [weak self] in
        _ = try? await self?.move(to: .init(bearing: 0), animation: .ease(duration: 0.3), reason: "gesture")
      }
    }
    controlsView.onRecenter = { [weak self] in self?.onEvent?(.recenterRequested) }
    addSubview(controlsView)
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

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Use init(source:theme:initialCamera:).") }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, webView == nil, !destroyed, !pendingRemount {
      do { try mount() } catch { onEvent?(.failed(error as? TileflowMapError ?? .invalidSource)) }
    }
    updateVisibility()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    webView?.frame = bounds
    controlsView.frame = bounds
    updateInsets()
  }

  public override func safeAreaInsetsDidChange() {
    super.safeAreaInsetsDidChange()
    updateInsets()
  }

  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let target = super.hitTest(point, with: event)
    guard let shouldReceiveTouch, target !== controlsView, target?.isDescendant(of: controlsView) != true
    else { return target }
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
    guard initialized, let bridge, insetsUpdate == nil, rendererInsets != insets else { return }
    insetsUpdate = Task { [weak self] in
      let sent = try? await bridge.call(.setInsets, payload: Self.wire(insets))
      guard let self else { return }
      self.insetsUpdate = nil
      if sent != nil, self.bridge === bridge { self.rendererInsets = insets }
      if self.bridge === bridge { self.updateInsets() }
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
    let previousSubscriptions = subscriptions
    self.options = options
    subscriptions = EventSubscriptions(
      application: options.events, followCamera: options.controls.followCamera)
    touchClaim.gestures = options.gestures
    controlsView.controls = options.controls
    try await sendOptions(events: subscriptions != previousSubscriptions)
  }

  private func sendOptions(events: Bool) async throws {
    guard initialized, let bridge else { return }
    _ = try await bridge.call(.setOptions, payload: try wireOptions)
    if events {
      _ = try await bridge.call(.setEvents, payload: .object(["events": subscriptions.wireValue]))
    }
  }

  private var rightToLeft: Bool { effectiveUserInterfaceLayoutDirection == .rightToLeft }
  private var wireOptions: JSONValue { get throws { try options.wireValue(rightToLeft: rightToLeft) } }

  private func applyAppearance() async throws {
    guard initialized, let bridge, let appearance else { return }
    _ = try await bridge.call(appearance.method, payload: appearance.payload)
  }

  /// Replaces application content. Markers and layers survive theme and renderer replacement.
  public func setContent(
    annotations: [TileflowAnnotation] = [], layers: [TileflowGeoJSONLayer] = []
  ) async throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    let next = MapContent(annotations: annotations, overlays: layers)
    try next.validate()
    let previous = content
    contentRevision += 1
    let revision = contentRevision
    content = next
    do {
      if initialized, let bridge { try await send(next, through: bridge) }
    } catch {
      if revision == contentRevision { content = previous }
      throw error
    }
  }

  private func send(_ content: MapContent, through bridge: MapBridge) async throws {
    let (payload, references) = try content.wireValue(data: bridge.data)
    _ = try await bridge.call(.setContent, payload: payload, data: references)
  }

  /// Moves the camera, easing over `duration` seconds (at most 20), and waits until it settles.
  /// Before the map loads, the camera becomes the one it starts at.
  public func setCamera(_ camera: TileflowCamera, duration: TimeInterval = 0) async throws {
    try await move(to: camera, animation: duration > 0 ? .ease(duration: duration) : .none)
  }

  /// Reads the renderer's camera. ``currentCamera`` holds the last one it reported without a call.
  public func camera() async throws -> TileflowCamera {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    guard let camera = TileflowCamera(wire: try await bridge.call(.getCamera)) else {
      throw TileflowMapError.rendererFailed
    }
    return camera
  }

  /// Returns rendered feature identities at a point in this view's coordinate system.
  public func query(at point: CGPoint) async throws -> [TileflowRenderedFeature] {
    guard !destroyed else { throw TileflowMapError.disposed }
    try Self.validate(point)
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    let result = try await bridge.call(
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
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    let value = try await bridge.call(.project, payload: try .encoded(coordinate))
    guard let x = value["x"]?.number, let y = value["y"]?.number else {
      throw TileflowMapError.rendererFailed
    }
    return CGPoint(x: x, y: y)
  }

  public func unproject(_ point: CGPoint) async throws -> TileflowCoordinate {
    guard !destroyed else { throw TileflowMapError.disposed }
    try Self.validate(point)
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    let result = try await bridge.call(
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
    do { try mount() } catch { onEvent?(.failed(error as? TileflowMapError ?? .rendererFailed)) }
  }

  /// A load that fails while hidden, for example because the system suspended its networking,
  /// reloads once visible instead of reporting a failure nobody saw.
  private func report(_ error: TileflowMapError, generation expected: Int) {
    guard !destroyed, generation == expected else { return }
    guard generationReady || isVisible else {
      pendingRemount = true
      return
    }
    onEvent?(.failed(error))
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
    let visible = isVisible
    // While hidden, the session starts no bootstrap; requests that need one wait until visible.
    hostedSession?.setBackgrounded(!visible)
    guard visible != rendererVisible else { return }
    rendererVisible = visible
    if visible, pendingRemount {
      retireGeneration()
      do { try mount() } catch { onEvent?(.failed(error as? TileflowMapError ?? .rendererFailed)) }
      return
    }
    guard initialized, let bridge else { return }
    Task {
      _ = try? await bridge.call(.setVisibility, payload: .object(["visible": .bool(visible)]))
    }
  }

  private var colorScheme: String { traitCollection.userInterfaceStyle == .dark ? "dark" : "light" }

  private func mount() throws {
    // A failed read is not kept, so `reload()` reads a corrected configuration.
    let loadable = try self.loadable ?? source.loadable()
    self.loadable = loadable
    // The receipt is read once per process; the files are verified once, off the main thread.
    let (root, receipt) = try EmbeddedRuntime.receipt()
    if case .failure(let error) = EmbeddedRuntime.verified { throw error }
    _ = EmbeddedRuntime.verification
    TileflowDeviceProfile.prepare()
    generation += 1
    let current = generation
    pendingRemount = false
    // A new document starts shown; it is hidden after initialization if the view is not.
    rendererVisible = true
    if hostedSession == nil, let endpoint = loadable.hosted, let mapID = loadable.mapID,
      let surfaceID = loadable.surfaceID
    {
      hostedSession = HostedSession(endpoint: endpoint, mapID: mapID, surfaceID: surfaceID)
    }
    hostedSession?.setBackgrounded(!isVisible)
    let loader = ResourceLoader(
      policy: loadable.policy, hosted: hostedSession, apiOrigin: loadable.hosted?.apiOrigin,
      publicMetadataURLs: loadable.publicMetadataURLs,
      cache: .shared, grantScope: loadable.grantScope,
      onDeploymentSuperseded: { [weak self] in
        await self?.deploymentSuperseded(generation: current) ?? false
      })
    let data = DataChannel()
    let handler = ResourceSchemeHandler(loader: loader, runtimeRoot: root, data: data)
    handler.onFailure = { [weak self] error in
      self?.report(error, generation: current)
    }
    let bridge = MapBridge(
      instanceID: instanceID, generation: current, runtimeHash: receipt.runtimeHash, data: data)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(handler, forURLScheme: ResourceURL.scheme)
    configuration.userContentController.add(bridge, name: "tileflow")
    let bootstrap: JSONValue = .object([
      "instanceId": .string(instanceID), "generation": .number(Double(current)),
      "platform": .string("ios"), "protocol": MapBridge.supportedVersions,
    ])
    let json = String(decoding: try JSONEncoder().encode(bootstrap), as: UTF8.self)
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: "Object.defineProperty(window,'tileflowHost',{value:\(json)});",
        injectionTime: .atDocumentStart, forMainFrameOnly: true
      ))
    let view = WKWebView(frame: bounds, configuration: configuration)
    view.navigationDelegate = self
    view.uiDelegate = self
    view.scrollView.isScrollEnabled = false
    view.scrollView.contentInsetAdjustmentBehavior = .never
    view.scrollView.bounces = false
    view.isOpaque = false
    bridge.webView = view
    bridge.onHello = { [weak self, weak bridge] in
      guard let self, let bridge, !self.destroyed, self.generation == current else { return }
      Task { [weak self] in
        guard let self else { return }
        do {
          let startingTheme = self.theme
          let startingRequest = self.requestedCamera?.count
          let startingOptions = self.options
          let startingSubscriptions = self.subscriptions
          var wireSource: [String: JSONValue] = [
            "map": .string(loadable.map),
            "manifestUrl": .string(loadable.manifestURL.absoluteString),
          ]
          if let mapID = loadable.mapID { wireSource["discoveryMapId"] = .string(mapID) }
          var options: [String: JSONValue] = [
            "source": .object(wireSource),
            "theme": self.theme.map(JSONValue.string) ?? .null,
            "colorScheme": .string(self.colorScheme), "interactive": .bool(true),
            "options": try self.wireOptions,
            "events": self.subscriptions.wireValue,
            "insets": Self.wire(self.effectiveContentInsets),
          ]
          let startingInsets = self.effectiveContentInsets
          if let camera = self.initialCamera { options["camera"] = try .encoded(camera) }
          _ = try await bridge.call(.initialize, payload: .object(options))
          guard !self.destroyed, self.generation == current else { return }
          self.initialized = true
          self.rendererInsets = startingInsets
          self.updateInsets()
          try await self.send(self.content, through: bridge)
          if self.appearance != nil {
            try await self.applyAppearance()
          } else if self.theme != startingTheme {
            try await self.setTheme(self.theme)
          }
          if self.options != startingOptions {
            try await self.sendOptions(events: self.subscriptions != startingSubscriptions)
          }
          // Only a camera the application asked for during initialization moves the map again.
          if let request = self.requestedCamera, request.count != startingRequest {
            try await self.move(to: request.camera, animation: .none)
          }
          if !self.rendererVisible {
            _ = try await bridge.call(.setVisibility, payload: .object(["visible": .bool(false)]))
          }
          self.readyForEvents = true
          if self.pendingReadyEvent {
            self.pendingReadyEvent = false
            self.contentReady()
          }
        } catch {
          self.report(error as? TileflowMapError ?? .rendererFailed, generation: current)
        }
      }
    }
    bridge.onEvent = { [weak self] event, value in
      guard let self, !self.destroyed, self.generation == current else { return }
      self.receive(event, value, generation: current)
    }
    bridge.onFailure = { [weak self] error in
      self?.report(error, generation: current)
    }
    self.bridge = bridge
    bridge.start()
    resources = handler
    webView = view
    insertSubview(view, belowSubview: controlsView)
    loadRuntime(in: view, generation: current)
    updateVisibility()
  }

  /// Loads the renderer once the embedded runtime is verified. The WebView's processes start
  /// meanwhile, so verification overlaps their launch.
  private func loadRuntime(in view: WKWebView, generation current: Int) {
    if case .success = EmbeddedRuntime.verified {
      view.load(URLRequest(url: ResourceURL.runtimeURL))
      return
    }
    Task { [weak self, weak view] in
      let failure: TileflowMapError?
      do {
        try await EmbeddedRuntime.verification.value
        failure = nil
      } catch {
        failure = error as? TileflowMapError ?? .incompatibleRuntime
      }
      guard let self, let view, !self.destroyed, self.generation == current, self.webView === view
      else { return }
      if let failure {
        self.retireGeneration()
        self.onEvent?(.failed(failure))
      } else {
        view.load(URLRequest(url: ResourceURL.runtimeURL))
      }
    }
  }

  private func contentReady() {
    generationReady = true
    resetRecovery()
    controlsView.isHidden = false
    onEvent?(.contentReady)
  }

  /// Keeps the synchronous camera and the controls current.
  func observe(_ camera: TileflowCamera) {
    initialCamera = camera
    controlsView.camera = camera
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
        onEvent?(.annotationActivated(id: id, coordinate: coordinate))
      }
    case "poiActivated":
      if let bytes = try? JSONEncoder().encode(value),
        let selection = try? JSONDecoder().decode(TileflowPoiSelection.self, from: bytes)
      {
        onEvent?(.poiActivated(selection))
      }
    case "loading": onEvent?(.loading)
    case "contentReady":
      if let camera = TileflowCamera(wire: value["camera"]) { observe(camera) }
      contentReady()
    case "cameraMoveStarted", "cameraMoved", "cameraMoveEnded":
      if let change = Self.cameraChange(event, value) {
        observe(change.camera)
        cameraEvents.receive(change, options: options.events) { [weak self] change in
          guard let self, !self.destroyed, self.generation == current else { return }
          self.onEvent?(.cameraChanged(change))
        }
      }
    case "tap":
      if let touch = TileflowMapTouch(wire: value) { onEvent?(.tap(touch)) }
    case "longPress":
      if let touch = TileflowMapTouch(wire: value) { onEvent?(.longPress(touch)) }
    case "gestureStarted", "gestureEnded":
      if options.events.level.includes(.camera),
        let gesture = value["gesture"]?.string.flatMap(TileflowGesture.init(rawValue:))
      {
        onEvent?(event == "gestureStarted" ? .gestureStarted(gesture) : .gestureEnded(gesture))
      }
    case "themeChanged":
      if let name = value["theme"]?.string { onEvent?(.themeChanged(name)) }
    case "warning":
      if let count = value["count"]?.number.flatMap({ Int(exactly: $0) }), count > 0 {
        onEvent?(
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
    return TileflowCameraChange(camera: camera, reason: reason, phase: phase)
  }

  /// Pending calls fail with `cancelled` when a renderer is replaced, `disposed` when destroyed.
  private func retireGeneration(_ error: TileflowMapError = .cancelled) {
    initialized = false
    rendererInsets = nil
    insetsUpdate?.cancel()
    insetsUpdate = nil
    cameraEvents.rendererReplaced()
    readyForEvents = false
    pendingReadyEvent = false
    generationReady = false
    rendererVisible = false
    bridge?.retire(error)
    resources?.retire()
    webView?.stopLoading()
    webView?.configuration.userContentController.removeAllScriptMessageHandlers()
    webView?.configuration.userContentController.removeAllUserScripts()
    webView?.navigationDelegate = nil
    webView?.uiDelegate = nil
    webView?.removeFromSuperview()
    bridge = nil
    resources = nil
    webView = nil
    controlsView.isHidden = true
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

  public func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction)
    async -> WKNavigationActionPolicy
  {
    if navigationAction.request.url == ResourceURL.runtimeURL { return .allow }
    requestExternalLink(navigationAction)
    return .cancel
  }

  public func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    requestExternalLink(navigationAction)
    return nil
  }

  private func requestExternalLink(_ action: WKNavigationAction) {
    guard !destroyed, action.navigationType == .linkActivated,
      let url = action.request.url, ["https", "http"].contains(url.scheme),
      url.user == nil, url.password == nil
    else { return }
    onEvent?(.externalLinkRequested(url))
  }

  /// The system may end a hidden renderer to reclaim memory. Replace it when the view is next
  /// visible; a renderer that ends again before its content loads is reported instead.
  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView === self.webView, !destroyed else { return }
    guard recoveryCount < 1 else {
      retireGeneration()
      onEvent?(.failed(TileflowMapError(.rendererFailed, reason: .processTerminated)))
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
