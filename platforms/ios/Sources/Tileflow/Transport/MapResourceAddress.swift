import Foundation

/// The address MapLibre Native requests for a resource of one mounted map:
/// `https://tileflow.invalid/<context>/<origin as base64url>/<path>?<query>`.
///
/// The context names the map, is random for each map and engine generation, carries no credential
/// and never leaves the process. The remote path and query follow the encoded origin unchanged, so
/// the engine's own substitutions (`{z}/{x}/{y}`, `{fontstack}/{range}`) and the suffixes it adds
/// to a sprite (`@2x`, `.json`, `.png`) land where they would on the remote address. The scheme is
/// `https` because the Android engine completes no other, and `.invalid` never resolves.
enum MapResourceAddress {
  static let host = "tileflow.invalid"
  private static let prefix = "https://\(host)/"

  /// A self-hosted build keeps its family in the same generation as its theme styles.
  static func familyURL(style: URL, map: String) -> URL? {
    let segment = CharacterSet.urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))
    guard let name = map.addingPercentEncoding(withAllowedCharacters: segment) else { return nil }
    return URL(string: "../../families/\(name).json", relativeTo: style)?.absoluteURL
  }

  /// The address of an absolute `http` or `https` URL, or nil for any other.
  static func encode(_ remote: String, context: String) -> String? {
    guard let separator = remote.range(of: "://") else { return nil }
    let scheme = remote[..<separator.lowerBound].lowercased()
    guard scheme == "https" || scheme == "http" else { return nil }
    let afterScheme = remote[separator.upperBound...]
    let hostEnd =
      afterScheme.firstIndex(where: { $0 == "/" || $0 == "?" || $0 == "#" }) ?? afterScheme.endIndex
    let authority = afterScheme[..<hostEnd]
    guard !authority.isEmpty, !authority.contains("@") else { return nil }
    var rest = String(remote[hostEnd...])
    if let fragment = rest.firstIndex(of: "#") { rest = String(rest[..<fragment]) }
    if !rest.hasPrefix("/") { rest = "/" + rest }
    return "\(prefix)\(context)/\(base64URL("\(scheme)://\(authority)"))\(rest)"
  }

  /// The context and remote URL an address names, or nil for anything else.
  static func decode(_ url: URL) -> (context: String, remote: URL)? {
    let text = url.absoluteString
    guard text.hasPrefix(prefix) else { return nil }
    let parts = text.dropFirst(prefix.count).split(
      separator: "/", maxSplits: 2, omittingEmptySubsequences: false)
    guard parts.count == 3, isContext(parts[0]),
      let origin = fromBase64URL(String(parts[1])), let base = URL(string: origin),
      ["http", "https"].contains(base.scheme), base.host?.isEmpty == false, base.user == nil,
      base.password == nil, base.path.isEmpty, base.query == nil,
      let remote = URL(string: origin + "/" + parts[2])
    else { return nil }
    return (String(parts[0]), remote)
  }

  /// Resolves `reference` against `base`, keeping engine placeholders such as `{z}` intact.
  static func resolve(_ reference: String, against base: String) -> String {
    if reference.range(of: "^[A-Za-z][A-Za-z0-9+.-]*:", options: .regularExpression) != nil {
      return reference
    }
    let escaped = reference.replacingOccurrences(of: "{", with: "%7B")
      .replacingOccurrences(of: "}", with: "%7D")
    guard let resolved = URL(string: escaped, relativeTo: URL(string: base))?.absoluteString
    else { return reference }
    return resolved.replacingOccurrences(of: "%7B", with: "{")
      .replacingOccurrences(of: "%7D", with: "}")
  }

  /// A new random context: 16 bytes as base64url.
  static func newContext() -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0..<16).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    return base64URL(bytes: Data(bytes))
  }

  private static func isContext(_ text: Substring) -> Bool {
    text.count == 22
      && text.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
  }

  private static func base64URL(_ text: String) -> String { base64URL(bytes: Data(text.utf8)) }

  private static func base64URL(bytes: Data) -> String {
    bytes.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  private static func fromBase64URL(_ token: String) -> String? {
    guard !token.isEmpty,
      token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { return nil }
    let base64 = token.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let padded = base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: padded).flatMap { String(data: $0, encoding: .utf8) }
  }
}
