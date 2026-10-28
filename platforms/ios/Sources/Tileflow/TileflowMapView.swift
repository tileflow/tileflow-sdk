import CryptoKit
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
  private var bridge: MapBridge?
  private var resources: ResourceSchemeHandler?
  private let instanceID = UUID().uuidString
  private var generation = 0
  private var destroyed = false
  private var initialized = false
  private var readyForEvents = false
  private var pendingReadyEvent = false
  private var recoveryCount = 0
  private var initialCamera: TileflowCamera?
  private var hostedSession: HostedSession?
  private var appearance: (method: ProtocolContract.Method, payload: JSONValue)?
  private var content = MapContent()
  private var contentRevision = 0

  public init(
    source: TileflowMapSource, theme: String? = nil, initialCamera: TileflowCamera? = nil,
    options: TileflowMapOptions = .init()
  ) {
    self.source = source
    self.theme = theme
    self.initialCamera = initialCamera
    self.options = options
    super.init(frame: .zero)
    accessibilityLabel = "Interactive map"
    NotificationCenter.default.addObserver(
      self, selector: #selector(background),
      name: UIApplication.didEnterBackgroundNotification, object: nil)
    NotificationCenter.default.addObserver(
      self, selector: #selector(foreground),
      name: UIApplication.willEnterForegroundNotification, object: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Use init(source:theme:initialCamera:).") }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, webView == nil, !destroyed {
      do { try mount() } catch { onEvent?(.failed(error as? TileflowMapError ?? .invalidSource)) }
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    webView?.frame = bounds
  }

  public func setSource(_ source: TileflowMapSource) throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard source != self.source else { return }
    _ = try source.policy()
    hostedSession?.close()
    hostedSession = nil
    self.source = source
    recoveryCount = 0
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
    self.options = options
    if initialized, let bridge {
      _ = try await bridge.call(.setOptions, payload: try .encoded(options))
    }
  }

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
    let payload = try next.wireValue()
    let previous = content
    contentRevision += 1
    let revision = contentRevision
    content = next
    do {
      if initialized, let bridge { _ = try await bridge.call(.setContent, payload: payload) }
    } catch {
      if revision == contentRevision { content = previous }
      throw error
    }
  }

  public func setCamera(_ camera: TileflowCamera, duration: TimeInterval = 0) async throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    try camera.validate()
    guard (0...60).contains(duration) else { throw TileflowMapError.invalidRequest }
    initialCamera = camera
    guard initialized, let bridge else { return }
    _ = try await bridge.call(
      .setCamera,
      payload: .object([
        "camera": try .encoded(camera), "duration": .number(duration * 1000),
      ]))
  }

  public func camera() async throws -> TileflowCamera {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    return try JSONDecoder().decode(
      TileflowCamera.self, from: JSONEncoder().encode(try await bridge.call(.getCamera)))
  }

  /// Returns rendered feature identities at a point in this view's coordinate system.
  public func query(at point: CGPoint) async throws -> [TileflowRenderedFeature] {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    let result = try await bridge.call(
      .queryAtPoint,
      payload: .object([
        "x": .number(point.x), "y": .number(point.y),
      ]))
    return try JSONDecoder().decode(
      [TileflowRenderedFeature].self, from: JSONEncoder().encode(result))
  }

  public func fit(
    _ bounds: TileflowBounds, padding: Double = 24, maxZoom: Double = 20,
    duration: TimeInterval = 0
  ) async throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    guard (-180...180).contains(bounds.west), (-180...180).contains(bounds.east),
      (-90...90).contains(bounds.south), (-90...90).contains(bounds.north),
      bounds.south <= bounds.north,
      (0...1000).contains(padding), (0...24).contains(maxZoom), (0...5).contains(duration)
    else { throw TileflowMapError.invalidRequest }
    _ = try await bridge.call(
      .fitBounds,
      payload: .object([
        "west": .number(bounds.west), "south": .number(bounds.south), "east": .number(bounds.east),
        "north": .number(bounds.north), "padding": .number(padding), "maxZoom": .number(maxZoom),
        "duration": .number(duration * 1000),
      ]))
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
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    let result = try await bridge.call(
      .unproject, payload: .object(["x": .number(point.x), "y": .number(point.y)]))
    return try JSONDecoder().decode(TileflowCoordinate.self, from: JSONEncoder().encode(result))
  }

  public func destroy() {
    guard !destroyed else { return }
    destroyed = true
    hostedSession?.close()
    hostedSession = nil
    NotificationCenter.default.removeObserver(self)
    retireGeneration()
    onEvent = nil
  }

  /// Retry the current source after a load or renderer failure. A Hosted session stopped by
  /// `credentialRejected`, `accessDenied` or `quotaExceeded` bootstraps again. Reloading also
  /// skips the delay that follows a temporary session failure (`rateLimited`,
  /// `sessionUnavailable` or `invalidSessionResponse`), so call it in response to a user action
  /// rather than from every failure event.
  public func reload() throws {
    guard !destroyed else { throw TileflowMapError.disposed }
    hostedSession?.retry()
    retireGeneration()
    recoveryCount = 0
    if window != nil { try mount() }
  }

  private var colorScheme: String { traitCollection.userInterfaceStyle == .dark ? "dark" : "light" }

  private func mount() throws {
    let policy = try source.policy()
    guard let root = Bundle.module.resourceURL?.appendingPathComponent("EmbeddedRuntime") else {
      throw TileflowMapError.missingRuntime
    }
    struct Receipt: Decodable {
      let runtimeHash: String
      let protocolVersion: Int
      let files: [String: String]
    }
    guard let bytes = try? Data(contentsOf: root.appendingPathComponent("receipt.json")),
      let receipt = try? JSONDecoder().decode(Receipt.self, from: bytes),
      receipt.protocolVersion == ProtocolContract.version,
      Set(receipt.files.keys) == [
        "index.html", "runtime.js", "maplibre.css", "notices.txt", "dependencies.json",
      ]
    else { throw TileflowMapError.missingRuntime }
    for (name, expected) in receipt.files {
      let data = try Data(contentsOf: root.appendingPathComponent(name))
      let actual = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
      guard actual == expected else { throw TileflowMapError.incompatibleRuntime }
    }
    generation += 1
    let current = generation
    if hostedSession == nil, let client = source.client, let mapID = source.mapID,
      let surfaceID = source.surfaceID
    {
      hostedSession = HostedSession(client: client, mapID: mapID, surfaceID: surfaceID)
    }
    let loader = ResourceLoader(
      policy: policy, hosted: hostedSession, publicMetadataURLs: source.publicMetadataURLs)
    let handler = ResourceSchemeHandler(loader: loader, runtimeRoot: root)
    handler.onFailure = { [weak self] error in
      guard let self, !self.destroyed, self.generation == current else { return }
      self.onEvent?(.failed(error))
    }
    let bridge = MapBridge(
      instanceID: instanceID, generation: current, runtimeHash: receipt.runtimeHash)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(handler, forURLScheme: ResourceURL.scheme)
    configuration.userContentController.add(bridge, name: "tileflow")
    let bootstrap: JSONValue = .object([
      "instanceId": .string(instanceID), "generation": .number(Double(current)),
      "platform": .string("ios"),
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
          let startingCamera = self.initialCamera
          let startingOptions = self.options
          var wireSource: [String: JSONValue] = [
            "map": .string(self.source.map),
            "manifestUrl": .string(self.source.manifestURL.absoluteString),
          ]
          if let mapID = self.source.mapID { wireSource["discoveryMapId"] = .string(mapID) }
          var options: [String: JSONValue] = [
            "source": .object(wireSource),
            "theme": self.theme.map(JSONValue.string) ?? .null,
            "colorScheme": .string(self.colorScheme), "interactive": .bool(true),
            "options": try .encoded(self.options),
          ]
          if let camera = self.initialCamera { options["camera"] = try .encoded(camera) }
          _ = try await bridge.call(.initialize, payload: .object(options))
          guard !self.destroyed, self.generation == current else { return }
          self.initialized = true
          _ = try await bridge.call(.setContent, payload: self.content.wireValue())
          if self.appearance != nil {
            try await self.applyAppearance()
          } else if self.theme != startingTheme {
            try await self.setTheme(self.theme)
          }
          if self.options != startingOptions { try await self.setOptions(self.options) }
          if self.initialCamera != startingCamera, let camera = self.initialCamera {
            try await self.setCamera(camera)
          }
          self.readyForEvents = true
          if self.pendingReadyEvent {
            self.pendingReadyEvent = false
            self.onEvent?(.contentReady)
          }
        } catch {
          if !self.destroyed, self.generation == current {
            self.onEvent?(.failed(error as? TileflowMapError ?? .rendererFailed))
          }
        }
      }
    }
    bridge.onEvent = { [weak self] event, value in
      guard let self, !self.destroyed, self.generation == current else { return }
      self.receive(event, value)
    }
    self.bridge = bridge
    bridge.start()
    resources = handler
    webView = view
    addSubview(view)
    view.load(URLRequest(url: ResourceURL.runtimeURL))
  }

  private func receive(_ event: String, _ value: JSONValue) {
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
    case "contentReady": onEvent?(.contentReady)
    case "cameraChanged":
      if let raw = value["camera"], let bytes = try? JSONEncoder().encode(raw),
        let camera = try? JSONDecoder().decode(TileflowCamera.self, from: bytes)
      {
        initialCamera = camera
        onEvent?(.cameraChanged(camera, isFinal: value["final"]?.bool == true))
      }
    case "interaction":
      if let longitude = value["coordinate"]?["longitude"]?.number,
        let latitude = value["coordinate"]?["latitude"]?.number
      {
        onEvent?(.tap(longitude: longitude, latitude: latitude))
      }
    case "themeChanged":
      if let name = value["theme"]?.string { onEvent?(.themeChanged(name)) }
    case "error": onEvent?(.failed(MapBridge.error(value["code"]?.string)))
    default: break
    }
  }

  private func retireGeneration() {
    initialized = false
    readyForEvents = false
    pendingReadyEvent = false
    bridge?.retire()
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
        if !self.destroyed { self.onEvent?(.failed(error as? TileflowMapError ?? .rendererFailed)) }
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

  public func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView === self.webView, !destroyed else { return }
    retireGeneration()
    guard recoveryCount < 1 else {
      onEvent?(.failed(.rendererFailed))
      return
    }
    recoveryCount += 1
    do { try mount() } catch { onEvent?(.failed(.rendererFailed)) }
  }

  @objc private func background() {
    Task { [weak self] in
      await self?.hostedSession?.setBackgrounded(true)
      _ = try? await self?.bridge?.call(.setVisibility, payload: .object(["visible": .bool(false)]))
    }
  }
  @objc private func foreground() {
    Task { [weak self] in
      await self?.hostedSession?.setBackgrounded(false)
      _ = try? await self?.bridge?.call(.setVisibility, payload: .object(["visible": .bool(true)]))
    }
  }
}
