import Foundation
import WebKit

/// One handler belongs to one WebView generation. Retirement precedes cancellation.
@MainActor
final class ResourceSchemeHandler: NSObject, WKURLSchemeHandler {
  private let loader: any ResourceLoading
  private let runtimeRoot: URL
  private let data: DataChannel?
  private var operations: [ObjectIdentifier: Task<Void, Never>] = [:]
  private var retired = false
  var onFailure: ((TileflowMapError) -> Void)?

  init(loader: any ResourceLoading, runtimeRoot: URL, data: DataChannel? = nil) {
    self.loader = loader
    self.runtimeRoot = runtimeRoot
    self.data = data
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
        case ResourceURL.dataHost:
          payload = try dataResource(urlSchemeTask.request)
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
        // The renderer reads World fair-use state from these headers, as the web adapters do.
        headers["Access-Control-Expose-Headers"] =
          "Tileflow-Fair-Use, Tileflow-Fair-Use-Notice, Tileflow-Protection"
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

  /// A registered payload, or 404 once its request has settled and released it.
  private func dataResource(_ request: URLRequest) throws -> ResourcePayload {
    guard let url = request.url, url.scheme == ResourceURL.scheme, url.user == nil,
      url.password == nil, url.port == nil, url.query == nil, url.fragment == nil,
      request.httpMethod ?? "GET" == "GET"
    else { throw ResourceError.invalidAddress }
    let id = String(url.path.dropFirst())
    guard (22...64).contains(id.count),
      id.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { throw ResourceError.invalidAddress }
    guard let entry = data?.payload(id) else {
      return ResourcePayload(bytes: Data(), status: 404, headers: ["Cache-Control": "no-store"])
    }
    return ResourcePayload(
      bytes: entry.bytes, status: 200,
      headers: [
        "Content-Type": entry.contentType, "Content-Length": String(entry.bytes.count),
        "Cache-Control": "no-store",
      ])
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
