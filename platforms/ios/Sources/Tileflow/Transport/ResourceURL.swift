import Foundation

/// Local transport addresses carry no credentials. The native policy validates every decoded URL.
enum ResourceURL {
  static let scheme = "tileflow"
  static let resourceHost = "resource"
  static let runtimeHost = "runtime"
  static let runtimeURL = URL(string: "tileflow://runtime/index.html")!

  static func encode(_ url: URL) -> URL {
    let encoded = Data(url.absoluteString.utf8).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    return URL(string: "\(scheme)://\(resourceHost)/\(encoded)")!
  }

  static func decode(_ url: URL) throws -> URL {
    guard url.scheme == scheme, url.host == resourceHost,
      url.user == nil, url.password == nil, url.port == nil,
      url.query == nil, url.fragment == nil
    else { throw ResourceError.invalidAddress }
    let parts = url.path.split(separator: "/", omittingEmptySubsequences: false).dropFirst()
    guard parts.count == 1 || parts.count == 4, let first = parts.first else {
      throw ResourceError.invalidAddress
    }
    let token = String(first)
    guard !token.isEmpty, token.count <= 8192,
      token.allSatisfy({ $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    else { throw ResourceError.invalidAddress }
    let base64 = token.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let padded = base64 + String(repeating: "=", count: (4 - base64.count % 4) % 4)
    guard let data = Data(base64Encoded: padded),
      var text = String(data: data, encoding: .utf8),
      let remote = URL(string: text),
      encode(remote).absoluteString == "\(scheme)://\(resourceHost)/\(token)"
    else { throw ResourceError.invalidAddress }
    if parts.count == 1 { return remote }
    let coordinates = parts.dropFirst().map(String.init)
    guard
      coordinates.allSatisfy({
        $0.range(of: #"^(0|[1-9][0-9]{0,7})$"#, options: .regularExpression) != nil
      }),
      let z = Int(coordinates[0]), z <= 24,
      let x = Int(coordinates[1]), x < 1 << z,
      let y = Int(coordinates[2]), y < 1 << z
    else { throw ResourceError.invalidAddress }
    for (axis, coordinate) in zip(["z", "x", "y"], coordinates) {
      let placeholder = "%7B\(axis)%7D"
      guard text.contains(placeholder) else { throw ResourceError.invalidAddress }
      text = text.replacingOccurrences(of: placeholder, with: coordinate)
    }
    guard let expanded = URL(string: text) else { throw ResourceError.invalidAddress }
    return expanded
  }
}

enum ResourceError: Error, Equatable {
  case invalidAddress
  case forbiddenOrigin
  case unsupportedRequest
  case responseTooLarge
  case invalidResponse
  case disposed
  case missingRuntime
}
