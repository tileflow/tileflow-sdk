import Foundation
import TileflowFoundation

/// Approximate geography for the device's network connection, from anonymous Tileflow GeoIP.
///
/// Use it as an optional hint, such as an initial map viewport, never as the device's location.
/// Anonymous access needs no credential, has shared best-effort limits and no availability
/// guarantee: keep a fallback, and never replace a camera the person has already moved.
public struct TileflowGeoIP: Sendable {
  private let transport: ServiceTransport

  /// - Parameters:
  ///   - configuration: Overrides ``Tileflow/configuration()`` for this client. Only its API
  ///     origin is used.
  ///   - session: The session that sends requests. Redirects are never followed.
  public init(configuration: TileflowConfiguration? = nil, session: URLSession = .shared) {
    transport = ServiceTransport(
      configuration: configuration, session: session, policy: TileflowGeoIPError.policy)
  }

  /// Approximate geography for the calling connection. `location` is nil when the service has
  /// none for it.
  public func locate() async throws -> TileflowGeoIPResponse {
    do {
      return try await transport.call(
        ServiceRequest(
          service: .geoIP, path: "/v1/geoip", body: .object([:]), maximumRequestBytes: 1024,
          maximumResponseBytes: 8 * 1024)
      ) { try TileflowGeoIPResponse($0) }
    } catch let failure as ServiceFailure {
      throw TileflowGeoIPError(failure)
    }
  }
}

/// A failed GeoIP call. `code` is set only when the service's answer carries a documented code
/// with its documented status.
public struct TileflowGeoIPError: Error, Sendable, Equatable, CustomStringConvertible {
  public enum Code: String, Sendable, CaseIterable {
    case aborted = "GEOIP_ABORTED"
    /// The shared anonymous limits are exhausted for now.
    case anonymousLimited = "GEOIP_ANONYMOUS_LIMITED"
    case disabled = "GEOIP_DISABLED"
    case invalidRequest = "GEOIP_INVALID_REQUEST"
    case mapNotFound = "GEOIP_MAP_NOT_FOUND"
    case originForbidden = "GEOIP_ORIGIN_FORBIDDEN"
    case quotaExceeded = "GEOIP_QUOTA_EXCEEDED"
    case requestTooLarge = "GEOIP_REQUEST_TOO_LARGE"
    case unavailable = "GEOIP_UNAVAILABLE"
    case usageUnconfirmed = "GEOIP_USAGE_UNCONFIRMED"

    /// The HTTP status the service answers this code with.
    public var status: Int {
      switch self {
      case .aborted: 499
      case .anonymousLimited, .quotaExceeded: 429
      case .disabled, .unavailable, .usageUnconfirmed: 503
      case .invalidRequest: 400
      case .mapNotFound: 404
      case .originForbidden: 403
      case .requestTooLarge: 413
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
    "TileflowGeoIPError(\(kind), code: \(code?.rawValue ?? "nil"), status: \(status.map(String.init) ?? "nil")): \(message)"
  }

  static let policy = ServiceErrorPolicy(
    name: "GeoIP",
    statuses: Dictionary(uniqueKeysWithValues: Code.allCases.map { ($0.rawValue, $0.status) }),
    uncodedStatuses: [403, 429], requestIDPattern: "^[A-Za-z0-9._:-]{1,128}$")
}
