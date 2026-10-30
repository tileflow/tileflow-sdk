import Foundation
@_exported import TileflowConfiguration

/// A failed Search call. `code` is set only when the service's answer carries a documented code
/// with its documented status, or when the client refuses an unsupported filter combination.
public struct TileflowSearchError: Error, Sendable, Equatable, CustomStringConvertible {
  public enum Code: String, Sendable, CaseIterable {
    case filterUnsupported = "GEOCODING_FILTER_UNSUPPORTED"
    case planUnavailable = "GEOCODING_PLAN_UNAVAILABLE"
    case evaluationRequired = "GEOCODING_EVALUATION_REQUIRED"
    case evaluationExpired = "GEOCODING_EVALUATION_EXPIRED"
    case evaluationExhausted = "GEOCODING_EVALUATION_EXHAUSTED"
    case invalidCursor = "GEOCODING_INVALID_CURSOR"
    case cursorExpired = "GEOCODING_CURSOR_EXPIRED"
    case aborted = "GEOCODING_ABORTED"
    case disabled = "GEOCODING_DISABLED"
    case invalidRequest = "GEOCODING_INVALID_REQUEST"
    case invalidSuggestion = "GEOCODING_INVALID_SUGGESTION"
    case originNotAllowed = "GEOCODING_ORIGIN_NOT_ALLOWED"
    case pickLimitExceeded = "GEOCODING_PICK_LIMIT_EXCEEDED"
    case quotaExceeded = "GEOCODING_QUOTA_EXCEEDED"
    case requestTooLarge = "GEOCODING_REQUEST_TOO_LARGE"
    case spendingLimitReached = "GEOCODING_SPENDING_LIMIT_REACHED"
    case credentialQuotaExceeded = "GEOCODING_CREDENTIAL_QUOTA_EXCEEDED"
    case suggestionExpired = "GEOCODING_SUGGESTION_EXPIRED"
    case suspended = "GEOCODING_SUSPENDED"
    case unavailable = "GEOCODING_UNAVAILABLE"
    case unpaidBudgetExhausted = "GEOCODING_UNPAID_BUDGET_EXHAUSTED"
    case unpaidLimitReached = "GEOCODING_UNPAID_LIMIT_REACHED"
    case upstreamInvalid = "GEOCODING_UPSTREAM_INVALID"
    case upstreamThrottled = "GEOCODING_UPSTREAM_THROTTLED"
    case upstreamTimeout = "GEOCODING_UPSTREAM_TIMEOUT"
    case upstreamUnavailable = "GEOCODING_UPSTREAM_UNAVAILABLE"
    case usageUnconfirmed = "GEOCODING_USAGE_UNCONFIRMED"

    /// The HTTP status the service answers this code with.
    public var status: Int {
      switch self {
      case .filterUnsupported: 422
      case .planUnavailable, .evaluationRequired, .evaluationExpired, .originNotAllowed,
        .suspended:
        403
      case .evaluationExhausted, .pickLimitExceeded, .quotaExceeded, .spendingLimitReached,
        .credentialQuotaExceeded, .unpaidBudgetExhausted, .unpaidLimitReached, .upstreamThrottled:
        429
      case .invalidCursor, .invalidRequest, .invalidSuggestion: 400
      case .cursorExpired, .suggestionExpired: 410
      case .aborted: 499
      case .disabled, .unavailable, .usageUnconfirmed: 503
      case .requestTooLarge: 413
      case .upstreamInvalid, .upstreamUnavailable: 502
      case .upstreamTimeout: 504
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
    "TileflowSearchError(\(kind), code: \(code?.rawValue ?? "nil"), status: \(status.map(String.init) ?? "nil")): \(message)"
  }

  static let policy = ServiceErrorPolicy(
    name: "Search",
    statuses: Dictionary(uniqueKeysWithValues: Code.allCases.map { ($0.rawValue, $0.status) }),
    uncodedStatuses: [401, 403, 429])

  static func unsupportedFilter() -> ServiceFailure {
    ServiceFailure(
      .invalidRequest, code: Code.filterUnsupported.rawValue,
      message: "Unsupported Tileflow Search filters")
  }

  static func invalid(_ message: String = "Invalid Tileflow Search request") -> ServiceFailure {
    ServiceFailure(.invalidRequest, message: message)
  }
}
