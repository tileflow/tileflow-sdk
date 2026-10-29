import Foundation
import WebKit
import XCTest

@testable import Tileflow

@MainActor
final class ResourceWebKitTests: XCTestCase {
  func testHTTPHeadRangeAndRedirectBoundaries() async throws {
    let origin = FixtureServer.origin
    do {
      _ = try await URLSession.shared.data(from: URL(string: "\(origin)/manifest.json")!)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run HTTP transport integration.")
    }
    let loader = ResourceLoader(
      policy: ResourcePolicy(origins: [origin], allowsLoopbackHTTP: true), maximumBytes: 65_536)
    defer { loader.close() }
    var request = URLRequest(url: URL(string: "\(origin)/archive.bin")!)
    request.httpMethod = "HEAD"
    let head = try await loader.load(request)
    XCTAssertTrue(head.bytes.isEmpty)
    XCTAssertEqual(head.headers["Content-Length"], String(9 * 1024 * 1024))
    request.httpMethod = "GET"
    request.setValue("bytes=16-17", forHTTPHeaderField: "Range")
    let range = try await loader.load(request)
    XCTAssertEqual(range.status, 206)
    XCTAssertEqual(range.bytes, Data([16, 17]))
    XCTAssertEqual(range.headers["Content-Range"], "bytes 16-17/9437184")
    for path in ["archive.bin", "redirect"] {
      do {
        _ = try await loader.load(URLRequest(url: URL(string: "\(origin)/\(path)")!))
        XCTFail("Transport accepted an excessive body or redirect.")
      } catch {
        XCTAssertEqual(error as? ResourceError, .invalidResponse)
      }
    }
  }

  func testSchemeTransportsFetchImagesFontsAndWorkerRequests() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: root) }
    let font = try Data(
      contentsOf: Bundle.module.resourceURL!
        .appendingPathComponent("Fixtures/test-font.woff2"))
    let bytes = Data((0..<65536).map { UInt8($0 % 251) })
    let loader = ProbeLoader(bytes: bytes, font: font)
    let handler = ResourceSchemeHandler(loader: loader, runtimeRoot: root)
    let bytesURL = ResourceURL.encode(URL(string: "https://fixture.example/bytes")!).absoluteString
    let fontURL = ResourceURL.encode(URL(string: "https://fixture.example/font")!).absoluteString
    let imageURL = ResourceURL.encode(URL(string: "https://fixture.example/image")!).absoluteString
    let script = """
      <!doctype html><meta charset="utf-8"><script>
      (async () => {
        try {
          const response = await fetch('\(bytesURL)');
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (bytes.length !== 65536 || bytes[65535] !== 24) throw new Error('binary');
          const font = new FontFace('TransportProbe', await (await fetch('\(fontURL)')).arrayBuffer());
          await font.load(); document.fonts.add(font);
          await new Promise((resolve, reject) => {
            const image = new Image(); image.onload = resolve; image.onerror = reject;
            image.src = '\(imageURL)'; document.body.appendChild(image);
          });
          const workerSource = `fetch('\(bytesURL)').then(r=>r.arrayBuffer())
            .then(b=>postMessage(b.byteLength)).catch(e=>postMessage(String(e)))`;
          const workerURL = URL.createObjectURL(new Blob([workerSource], {type:'text/javascript'}));
          const worker = new Worker(workerURL);
          const count = await new Promise((resolve,reject) => {
            worker.onmessage = e=>resolve(e.data); worker.onerror = reject;
          });
          worker.terminate(); URL.revokeObjectURL(workerURL);
          if (count !== 65536) throw new Error('worker: '+count);
          window.webkit.messageHandlers.probe.postMessage('ok');
        } catch(error) { window.webkit.messageHandlers.probe.postMessage(String(error)); }
      })();
      </script><body></body>
      """
    try Data(script.utf8).write(to: root.appendingPathComponent("index.html"))
    let done = expectation(description: "WebKit transport")
    let receiver = ProbeReceiver { message in
      XCTAssertEqual(message, "ok")
      done.fulfill()
    }
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    configuration.setURLSchemeHandler(handler, forURLScheme: ResourceURL.scheme)
    configuration.userContentController.add(receiver, name: "probe")
    let webView = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 320, height: 480), configuration: configuration)
    let window = UIWindow(frame: webView.frame)
    let controller = UIViewController()
    window.rootViewController = controller
    controller.view.addSubview(webView)
    window.makeKeyAndVisible()
    webView.load(URLRequest(url: ResourceURL.runtimeURL))
    await fulfillment(of: [done], timeout: 30)
    handler.retire()
    webView.stopLoading()
    configuration.userContentController.removeScriptMessageHandler(forName: "probe")
    window.isHidden = true
  }
}

private struct ProbeLoader: ResourceLoading {
  let bytes: Data
  let font: Data

  func load(_ request: URLRequest) async throws -> ResourcePayload {
    switch request.url?.path {
    case "/bytes":
      return ResourcePayload(
        bytes: bytes, status: 200, headers: ["Content-Type": "application/octet-stream"])
    case "/font":
      return ResourcePayload(bytes: font, status: 200, headers: ["Content-Type": "font/woff2"])
    case "/image":
      return ResourcePayload(
        bytes: Data(
          base64Encoded:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
        )!,
        status: 200, headers: ["Content-Type": "image/png"]
      )
    default:
      throw ResourceError.invalidAddress
    }
  }
}

@MainActor
private final class ProbeReceiver: NSObject, WKScriptMessageHandler {
  let receive: (String) -> Void
  init(receive: @escaping (String) -> Void) { self.receive = receive }
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    receive(String(describing: message.body))
  }
}
