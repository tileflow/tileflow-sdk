import Foundation

struct ResourcePolicy: Sendable {
  let origins: Set<String>
  var allowsLoopbackHTTP = false

  func validate(_ url: URL) throws {
    guard url.absoluteString.utf8.count <= 6144,
      url.user == nil, url.password == nil, url.fragment == nil,
      let host = url.host, !host.isEmpty,
      !url.absoluteString.contains("\\"),
      !url.absoluteString.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }),
      url.scheme == "https"
        || (allowsLoopbackHTTP && url.scheme == "http"
          && ["127.0.0.1", "[::1]", "localhost"].contains(host))
    else { throw ResourceError.invalidAddress }
    guard origins.contains(Self.origin(url)) else { throw ResourceError.forbiddenOrigin }
  }

  static func origin(_ url: URL) -> String {
    let scheme = url.scheme?.lowercased() ?? ""
    let host = url.host?.lowercased() ?? ""
    let port = url.port
    let defaultPort = (scheme == "https" && port == 443) || (scheme == "http" && port == 80)
    return "\(scheme)://\(host)" + (port == nil || defaultPort ? "" : ":\(port!)")
  }
}
