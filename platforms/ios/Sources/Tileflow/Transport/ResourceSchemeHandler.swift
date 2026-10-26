import Foundation
import WebKit

/// One handler belongs to one WebView generation. Retirement precedes cancellation.
@MainActor
final class ResourceSchemeHandler: NSObject, WKURLSchemeHandler {
  private let loader: any ResourceLoading
  private let runtimeRoot: URL
  private var operations: [ObjectIdentifier: Task<Void, Never>] = [:]
  private var retired = false
  var onFailure: ((TileflowMapError) -> Void)?

  init(loader: any ResourceLoading, runtimeRoot: URL) {
    self.loader = loader
    self.runtimeRoot = runtimeRoot
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
    let identity = ObjectIdentifier(urlSchemeTask)
    guard !retired else {
      urlSchemeTask.didFailWithError(ResourceError.disposed)
      return
    }
    operations[identity] = Task { [weak self] in
      guard let self else { return }
      do {
        guard let url = urlSchemeTask.request.url else { throw ResourceError.invalidAddress }
        let payload: ResourcePayload
        switch url.host {
        case ResourceURL.runtimeHost:
          payload = try runtimeResource(url)
        case ResourceURL.resourceHost:
          var request = urlSchemeTask.request
          request.url = try ResourceURL.decode(url)
          payload = try await loader.load(request)
        default:
          throw ResourceError.invalidAddress
        }
        guard !retired, operations[identity] != nil, !Task.isCancelled else { return }
        var headers = payload.headers
        headers["Access-Control-Allow-Origin"] = "*"
        guard
          let response = HTTPURLResponse(
            url: url, statusCode: payload.status, httpVersion: "HTTP/1.1", headerFields: headers
          )
        else { throw ResourceError.invalidResponse }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(payload.bytes)
        urlSchemeTask.didFinish()
      } catch {
        if !retired, operations[identity] != nil, !Task.isCancelled {
          if let error = error as? TileflowMapError { onFailure?(error) }
          urlSchemeTask.didFailWithError(error)
        }
      }
      operations.removeValue(forKey: identity)
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
    operations.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel()
  }

  func retire() {
    retired = true
    onFailure = nil
    let tasks = operations.values
    operations.removeAll()
    for task in tasks { task.cancel() }
    loader.close()
  }

  private func runtimeResource(_ url: URL) throws -> ResourcePayload {
    guard url.scheme == ResourceURL.scheme, url.user == nil, url.password == nil,
      url.port == nil, url.query == nil, url.fragment == nil
    else { throw ResourceError.invalidAddress }
    let name = String(url.path.dropFirst())
    guard !name.isEmpty, !name.contains("/"), !name.contains("\\"),
      !name.contains(".."), !name.contains("%")
    else { throw ResourceError.invalidAddress }
    let file = runtimeRoot.appendingPathComponent(name)
    let types = [
      "html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
      "css": "text/css; charset=utf-8", "json": "application/json",
    ]
    guard let type = types[file.pathExtension] else { throw ResourceError.invalidAddress }
    let data = try Data(contentsOf: file)
    return ResourcePayload(
      bytes: data, status: 200,
      headers: [
        "Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-store",
      ])
  }
}
