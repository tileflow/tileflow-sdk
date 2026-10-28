import Foundation
@_exported import TileflowConfiguration

/// A failed Elevation call. `code` is set only when the service's answer carries a documented
/// code with its documented status.
public struct TileflowElevationError: Error, Sendable, Equatable, CustomStringConvertible {
  public enum Code: String, Sendable, CaseIterable {
    case invalidRequest = "ELEVATION_INVALID_REQUEST"
    case requestTooLarge = "ELEVATION_REQUEST_TOO_LARGE"
    /// No credential, or one without the Elevation permission. The status is 403, or 401 from
    /// the shared credential check.
    case accessDenied = "ELEVATION_ACCESS_DENIED"
    /// A publishable credential that does not list this app.
    case originNotAllowed = "ELEVATION_ORIGIN_NOT_ALLOWED"
    case rateLimited = "ELEVATION_RATE_LIMITED"
    case quotaExceeded = "ELEVATION_QUOTA_EXCEEDED"
    case cancelled = "ELEVATION_CANCELLED"
    case unavailable = "ELEVATION_UNAVAILABLE"
    case timeout = "ELEVATION_TIMEOUT"

    /// The HTTP status the service answers this code with.
    public var status: Int {
      switch self {
      case .invalidRequest: 400
      case .requestTooLarge: 413
      case .accessDenied, .originNotAllowed: 403
      case .rateLimited, .quotaExceeded: 429
      case .cancelled: 499
      case .unavailable: 503
      case .timeout: 504
      }
    }
  }

  public let kind: TileflowServiceErrorKind
  public let code: Code?
  /// The HTTP status of the answer, or nil when none arrived or nothing was sent.
  public let status: Int?
  public let requestID: String?
  /// Seconds to wait before retrying, when the service said so.
  public let retryAfter: TimeInterval?
  public let message: String

  init(_ failure: ServiceFailure) {
    kind = failure.kind
    code = failure.code.flatMap(Code.init(rawValue:))
    status = failure.status
    requestID = failure.requestID
    retryAfter = failure.retryAfter
    message = failure.message
  }

  public var description: String {
    "TileflowElevationError(\(kind), code: \(code?.rawValue ?? "nil"), status: \(status.map(String.init) ?? "nil")): \(message)"
  }

  static let policy = ServiceErrorPolicy(
    name: "Elevation",
    statuses: Dictionary(uniqueKeysWithValues: Code.allCases.map { ($0.rawValue, $0.status) }),
    alsoUnauthorized: Code.accessDenied.rawValue)

  static func invalid(_ message: String = "Invalid Tileflow Elevation request") -> ServiceFailure {
    ServiceFailure(.invalidRequest, message: message)
  }
}
