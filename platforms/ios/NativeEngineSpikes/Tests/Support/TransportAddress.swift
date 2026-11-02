import Foundation

/// A resource address the map engine requests and the interception answers:
/// `https://tileflow.invalid/<context>/<origin as base64url>/<path>?<query>`.
///
/// The engine's own substitutions (`{z}/{x}/{y}`, `{fontstack}/{range}`, sprite suffixes) stay in
/// the path or the query, so the decoded remote address is the one the engine would have built.
enum TransportAddress {
  static let host = "tileflow.invalid"

  static func encode(_ remote: String, context: String) -> String? {
    guard let separator = remote.range(of: "://") else { return nil }
    let scheme = remote[..<separator.lowerBound].lowercased()
    guard scheme == "https" || scheme == "http" else { return nil }
    let afterScheme = remote[separator.upperBound...]
    let hostEnd = afterScheme.firstIndex(where: { $0 == "/" || $0 == "?" }) ?? afterScheme.endIndex
    let origin = String(remote[..<hostEnd])
    var rest = String(remote[hostEnd...])
    if !rest.hasPrefix("/") { rest = "/" + rest }
    return "https://\(host)/\(context)/\(base64URL(origin))\(rest)"
  }

  static func decode(_ url: URL) -> (context: String, remote: URL)? {
    let text = url.absoluteString
    let prefix = "https://\(host)/"
    guard text.hasPrefix(prefix) else { return nil }
    let parts = text.dropFirst(prefix.count).split(
      separator: "/", maxSplits: 2, omittingEmptySubsequences: false)
    guard parts.count == 3, let origin = fromBase64URL(String(parts[1])) else { return nil }
    guard let remote = URL(string: origin + "/" + parts[2]) else { return nil }
    return (String(parts[0]), remote)
  }

  static func base64URL(_ text: String) -> String {
    Data(text.utf8).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func fromBase64URL(_ token: String) -> String? {
    let base64 = token.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let padded = base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: padded).flatMap { String(data: $0, encoding: .utf8) }
  }

  static func newContext() -> String {
    var bytes = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    return Data(bytes).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
