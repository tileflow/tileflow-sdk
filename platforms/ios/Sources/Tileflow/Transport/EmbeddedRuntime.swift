import CryptoKit
import Foundation
import WebKit

/// The renderer embedded in the SDK's bundle. Its receipt is read once per process and its files'
/// SHA-256 digests are verified once per process, off the main thread.
enum EmbeddedRuntime {
  struct Receipt: Decodable, Sendable {
    let runtimeHash: String
    let protocolVersion: Int
    let files: [String: String]
  }

  static let files: Set<String> = [
    "index.html", "runtime.js", "maplibre.css", "notices.txt", "dependencies.json",
  ]

  private static let loaded: Result<(root: URL, receipt: Receipt), TileflowMapError> = {
    guard let root = Bundle.module.resourceURL?.appendingPathComponent("EmbeddedRuntime"),
      let bytes = try? Data(contentsOf: root.appendingPathComponent("receipt.json")),
      let receipt = try? JSONDecoder().decode(Receipt.self, from: bytes),
      Set(receipt.files.keys) == files
    else { return .failure(.missingRuntime) }
    guard
      (ProtocolContract.minimumVersion...ProtocolContract.version)
        .contains(receipt.protocolVersion)
    else { return .failure(TileflowMapError(.incompatibleRuntime, reason: .protocolVersion)) }
    return .success((root, receipt))
  }()

  /// The runtime's directory and receipt. Reading them is cheap; the files are verified by
  /// ``verification``.
  static func receipt() throws -> (root: URL, receipt: Receipt) {
    try loaded.get()
  }

  private static let outcome = LockedValue<Result<Void, TileflowMapError>?>(nil)

  /// Whether verification finished, and how. Nil while it runs.
  static var verified: Result<Void, TileflowMapError>? { outcome.withLock { $0 } }

  /// Hashes every runtime file once per process at user-initiated priority.
  static let verification: Task<Void, any Error> = Task.detached(priority: .userInitiated) {
    let result: Result<Void, TileflowMapError>
    do {
      let (root, receipt) = try receipt()
      for (name, expected) in receipt.files {
        let data = try Data(contentsOf: root.appendingPathComponent(name), options: .mappedIfSafe)
        guard DataChannel.digest(data) == expected else {
          throw TileflowMapError.incompatibleRuntime
        }
      }
      result = .success(())
    } catch {
      result = .failure(error as? TileflowMapError ?? .missingRuntime)
    }
    outcome.withLock { $0 = result }
    try result.get()
  }
}

extension TileflowMapView {
  /// Prepares what every map needs before the first one is shown: verifies the embedded renderer,
  /// reads the device profile, opens the shared HTTP client and resource cache, and starts
  /// WebKit's helper processes. Call it early, for example at launch or before navigating to a
  /// screen with a map; calling it again does nothing. Maps work without it, but the first one
  /// then pays these costs while it loads.
  public static func prewarm() {
    _ = EmbeddedRuntime.verification
    Task.detached(priority: .utility) {
      _ = TileflowDeviceProfile.current
      _ = TileflowHTTPClient.shared
      _ = ResourceCacheStore.shared
    }
    WebKitPrewarmer.shared.start()
  }
}

/// Keeps a blank WebView alive briefly so WebKit launches its web content, GPU and networking
/// processes before the first map needs them.
@MainActor
final class WebKitPrewarmer: NSObject, WKNavigationDelegate {
  static let shared = WebKitPrewarmer()
  private var webView: WKWebView?
  private var started = false

  func start() {
    guard !started else { return }
    started = true
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let view = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
    view.navigationDelegate = self
    webView = view
    view.loadHTMLString("<!doctype html><meta charset=utf-8>", baseURL: nil)
    // WebKit keeps a prewarmed process for the next view after this one is released.
    Task { @MainActor [weak self] in
      try? await Task.sleep(for: .seconds(10))
      self?.release()
    }
  }

  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction)
    async -> WKNavigationActionPolicy
  {
    navigationAction.request.url?.absoluteString == "about:blank" ? .allow : .cancel
  }

  private func release() {
    webView?.navigationDelegate = nil
    webView?.stopLoading()
    webView = nil
  }
}
