import Foundation

/// A map failure, warning or rejected call, with a code from the taxonomy the SDK shares with its
/// renderer and diagnostic context.
///
/// Errors compare and hash by ``code`` alone, so `error == .disposed` and `case .disposed:` match
/// whatever context an error carries. Switch over ``code`` to handle every case.
public struct TileflowMapError: Error, Hashable, Sendable, CustomStringConvertible {
  public let code: Code
  public let context: TileflowErrorContext

  public init(_ code: Code, context: TileflowErrorContext = .init()) {
    self.code = code
    self.context = context
  }

  /// Whether the same work can succeed later without the application changing anything.
  public var isRecoverable: Bool { code.isRecoverable }

  public static func == (lhs: Self, rhs: Self) -> Bool { lhs.code == rhs.code }
  public func hash(into hasher: inout Hasher) { hasher.combine(code) }

  public var description: String {
    let detail = context.description
    return detail.isEmpty ? "TileflowMapError.\(code)" : "TileflowMapError.\(code) (\(detail))"
  }
}

/// Diagnostic detail for a ``TileflowMapError``. It never holds a URL path, query or credential;
/// a resource is identified by its kind and origin only.
public struct TileflowErrorContext: Hashable, Sendable, CustomStringConvertible {
  /// A stable identifier for the cause within the code, for example `protocolVersion`,
  /// `dataTooLarge`, `dataIntegrity`, `invalidGeoJSON` or `graphicsContextLost`.
  public var reason: String?
  public var resource: TileflowResourceKind?
  /// The scheme, host and port of the resource, for example `https://tiles.example.com`.
  public var origin: String?
  /// The HTTP status of the resource's answer.
  public var status: Int?
  /// The limit that was exceeded, in bytes or items.
  public var limit: Int?
  /// A developer-facing explanation in English. Not for display to people using the app.
  public var message: String?

  public init(
    reason: String? = nil, resource: TileflowResourceKind? = nil, origin: String? = nil,
    status: Int? = nil, limit: Int? = nil, message: String? = nil
  ) {
    self.reason = reason
    self.resource = resource
    self.origin = origin
    self.status = status
    self.limit = limit
    self.message = message
  }

  public var description: String {
    var parts: [String] = []
    if let reason { parts.append("reason: \(reason)") }
    if let resource { parts.append("resource: \(resource.rawValue)") }
    if let origin { parts.append("origin: \(origin)") }
    if let status { parts.append("status: \(status)") }
    if let limit { parts.append("limit: \(limit)") }
    if let message { parts.append(message) }
    return parts.joined(separator: ", ")
  }
}

extension TileflowMapError {
  init(_ code: Code, reason: ProtocolContract.ErrorReason, limit: Int? = nil) {
    self.init(code, context: .init(reason: reason.rawValue, limit: limit))
  }

  /// An error the renderer sent. A code the renderer may not send is itself a renderer fault.
  init(wire value: JSONValue?) {
    guard let raw = value?["code"]?.string, ProtocolContract.runtimeErrors.contains(raw),
      let code = Code(rawValue: raw)
    else {
      self.init(.rendererFailed)
      return
    }
    let context = value?["context"]
    let status = context?["status"]?.number.flatMap { Int(exactly: $0) }
    let limit = context?["limit"]?.number.flatMap { Int(exactly: $0) }
    self.init(
      code,
      context: .init(
        reason: context?["reason"]?.string,
        resource: context?["resource"]?.string.flatMap(TileflowResourceKind.init(rawValue:)),
        origin: context?["origin"]?.string, status: status, limit: limit,
        message: value?["message"]?.string.map { String($0.prefix(512)) }))
  }
}
