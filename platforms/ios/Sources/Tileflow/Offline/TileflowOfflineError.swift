import Foundation

/// Why an offline region could not be planned, created or checked.
///
/// Errors compare and hash by ``code`` alone. A Hosted refusal carries the service's code as the
/// context's `reason` and its HTTP status; size limits carry the `limit`.
public struct TileflowOfflineError: Error, Hashable, Sendable, CustomStringConvertible {
  public enum Code: String, Sendable, CaseIterable {
    /// The region cannot be downloaded as given; the context's reason says why. Nothing was sent.
    case invalidRegion
    /// A zoom, theme or Map ID is outside its documented range. Nothing was sent.
    case invalidOptions
    /// The configuration has no map credential. Nothing was sent.
    case missingCredential
    /// The configured API origin cannot serve Hosted maps. Nothing was sent.
    case invalidConfiguration
    /// The map credential is invalid, revoked or expired.
    case credentialRejected
    /// The pack's grant is forged, expired or out of date. Create the pack again; creation decides
    /// whether access continues.
    case grantRejected
    /// The credential does not authorize this Map, or a resource is not part of the pack.
    case accessDenied
    /// The Map has no current mobile delivery, or a theme does not exist.
    case notFound
    /// The Team's plan does not include offline packs.
    case notIncluded
    /// Offline downloads are turned off for this credential.
    case downloadsDisabled
    /// The pack has more billable resources than the plan allows, given as the `limit`. Choose a
    /// smaller region or fewer zooms.
    case packTooLarge
    /// Nothing in the region can be downloaded.
    case notDownloadable
    /// The device would hold more billable resources than the plan allows, given as the `limit`.
    case deviceLimitExceeded
    /// The credential's daily download limit is reached until ``TileflowOfflineError/retryAfter``.
    case dailyLimitReached
    /// The Team's map view or spending limit is reached.
    case quotaExceeded
    /// Too many requests from this network. Retry after ``TileflowOfflineError/retryAfter``.
    case rateLimited
    /// The Map changed since the pack was created. Revalidate, then create the pack again.
    case superseded
    /// The service refused the request as malformed.
    case rejected
    /// Offline packs are disabled or temporarily unavailable. Retry later.
    case unavailable
    /// No HTTP answer arrived.
    case network
    /// The service answered outside its contract, or a body did not match its manifest.
    case invalidResponse
    /// The device does not have room for the region. Free space, then resume it.
    case insufficientStorage
    /// No region has this identifier.
    case regionNotFound
  }

  public let code: Code
  public let context: TileflowErrorContext
  /// The wait the service asked for, in seconds, when it sent one.
  public let retryAfter: TimeInterval?

  public init(
    _ code: Code, context: TileflowErrorContext = .init(), retryAfter: TimeInterval? = nil
  ) {
    self.code = code
    self.context = context
    self.retryAfter = retryAfter
  }

  /// Whether the same request can succeed later without the application changing anything.
  public var isRecoverable: Bool {
    [.dailyLimitReached, .rateLimited, .unavailable, .network].contains(code)
  }

  public static func == (lhs: Self, rhs: Self) -> Bool { lhs.code == rhs.code }
  public func hash(into hasher: inout Hasher) { hasher.combine(code) }

  public var description: String {
    var detail = context.description
    if let retryAfter { detail += (detail.isEmpty ? "" : ", ") + "retry after: \(retryAfter) s" }
    return detail.isEmpty
      ? "TileflowOfflineError.\(code.rawValue)"
      : "TileflowOfflineError.\(code.rawValue) (\(detail))"
  }
}

extension TileflowOfflineError {
  static func region(_ reason: String) -> TileflowOfflineError {
    TileflowOfflineError(.invalidRegion, context: .init(reason: reason))
  }

  static func options(_ reason: String) -> TileflowOfflineError {
    TileflowOfflineError(.invalidOptions, context: .init(reason: reason))
  }
}
