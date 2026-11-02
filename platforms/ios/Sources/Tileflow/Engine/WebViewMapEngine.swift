import Foundation
import UIKit
import WebKit

/// The map drawn by the embedded web runtime in a `WKWebView`. Resources reach the runtime through
/// the `tileflow:` scheme and the generation's resource loader; commands and events cross the
/// generation's ``MapBridge``.
@MainActor
final class WebViewMapEngine: NSObject, MapEngine, WKNavigationDelegate, WKUIDelegate {
  var onReady: (() -> Void)?
  var onEvent: ((String, JSONValue) -> Void)?
  var onFailure: ((TileflowMapError) -> Void)?
  var onLoadFailure: ((TileflowMapError) -> Void)?
  var onExternalLink: ((URL) -> Void)?
  var onRendererTerminated: ((ProtocolContract.ErrorReason) -> Void)?

  private let webView: WKWebView
  private let bridge: MapBridge
  private let resources: ResourceSchemeHandler
  private var retired = false

  var view: UIView { webView }
  var data: DataChannel { bridge.data }

  /// Reads the embedded runtime's receipt once per process and starts verifying its files off the
  /// main thread. A missing or modified runtime fails here, before a generation starts.
  static func prepare() throws -> (root: URL, receipt: EmbeddedRuntime.Receipt) {
    let (root, receipt) = try EmbeddedRuntime.receipt()
    if case .failure(let error) = EmbeddedRuntime.verified { throw error }
    _ = EmbeddedRuntime.verification
    return (root, receipt)
  }

  init(
    runtime: (root: URL, receipt: EmbeddedRuntime.Receipt), instanceID: String, generation: Int,
    loader: any ResourceLoading, frame: CGRect
  ) throws {
    let data = DataChannel()
    let handler = ResourceSchemeHandler(loader: loader, runtimeRoot: runtime.root, data: data)
    let bridge = MapBridge(
      instanceID: instanceID, generation: generation, runtimeHash: runtime.receipt.runtimeHash,
      data: data)
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(handler, forURLScheme: ResourceURL.scheme)
    configuration.userContentController.add(bridge, name: "tileflow")
    let bootstrap: JSONValue = .object([
      "instanceId": .string(instanceID), "generation": .number(Double(generation)),
      "platform": .string("ios"), "protocol": MapBridge.supportedVersions,
    ])
    let json = String(decoding: try JSONEncoder().encode(bootstrap), as: UTF8.self)
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: "Object.defineProperty(window,'tileflowHost',{value:\(json)});",
        injectionTime: .atDocumentStart, forMainFrameOnly: true
      ))
    let view = WKWebView(frame: frame, configuration: configuration)
    view.scrollView.isScrollEnabled = false
    view.scrollView.contentInsetAdjustmentBehavior = .never
    view.scrollView.bounces = false
    view.isOpaque = false
    bridge.webView = view
    self.webView = view
    self.bridge = bridge
    self.resources = handler
    super.init()
    view.navigationDelegate = self
    view.uiDelegate = self
    handler.onFailure = { [weak self] error in self?.onFailure?(error) }
    bridge.onHello = { [weak self] in self?.onReady?() }
    bridge.onEvent = { [weak self] event, value in self?.onEvent?(event, value) }
    bridge.onFailure = { [weak self] error in self?.onFailure?(error) }
  }

  func start() {
    bridge.start()
    loadRuntime()
  }

  func call(_ command: MapEngineCommand, payload: JSONValue, data: [DataChannel.Reference])
    async throws -> JSONValue
  {
    try await bridge.call(command, payload: payload, data: data)
  }

  /// Loads the renderer once the embedded runtime is verified. The WebView's processes start
  /// meanwhile, so verification overlaps their launch.
  private func loadRuntime() {
    if case .success = EmbeddedRuntime.verified {
      webView.load(URLRequest(url: ResourceURL.runtimeURL))
      return
    }
    Task { [weak self] in
      let failure: TileflowMapError?
      do {
        try await EmbeddedRuntime.verification.value
        failure = nil
      } catch {
        failure = error as? TileflowMapError ?? .incompatibleRuntime
      }
      guard let self, !self.retired else { return }
      if let failure {
        self.onLoadFailure?(failure)
      } else {
        self.webView.load(URLRequest(url: ResourceURL.runtimeURL))
      }
    }
  }

  func retire(_ error: TileflowMapError) {
    guard !retired else { return }
    retired = true
    bridge.retire(error)
    resources.retire()
    webView.stopLoading()
    webView.configuration.userContentController.removeAllScriptMessageHandlers()
    webView.configuration.userContentController.removeAllUserScripts()
    webView.navigationDelegate = nil
    webView.uiDelegate = nil
    webView.removeFromSuperview()
    onReady = nil
    onEvent = nil
    onFailure = nil
    onLoadFailure = nil
    onExternalLink = nil
    onRendererTerminated = nil
  }

  // MARK: WKNavigationDelegate, WKUIDelegate

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction)
    async -> WKNavigationActionPolicy
  {
    if navigationAction.request.url == ResourceURL.runtimeURL { return .allow }
    requestExternalLink(navigationAction)
    return .cancel
  }

  func webView(
    _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
    for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures
  ) -> WKWebView? {
    requestExternalLink(navigationAction)
    return nil
  }

  private func requestExternalLink(_ action: WKNavigationAction) {
    guard !retired, action.navigationType == .linkActivated,
      let url = action.request.url, ["https", "http"].contains(url.scheme),
      url.user == nil, url.password == nil
    else { return }
    onExternalLink?(url)
  }

  /// The system may end a hidden renderer to reclaim memory; the view decides what follows.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    guard webView === self.webView, !retired else { return }
    onRendererTerminated?(.processTerminated)
  }
}
