import Foundation
@_exported import TileflowConfiguration

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

/// Approximate facts about a network connection. Any of them may be missing.
public struct TileflowGeoIPLocation: Sendable, Hashable {
  public var city: String?
  /// AF, AN, AS, EU, NA, OC or SA.
  public var continentCode: String?
  /// ISO 3166-1 alpha-2.
  public var countryCode: String?
  public var isEUCountry: Bool?
  /// An approximate position, not the device's location.
  public var position: TileflowPosition?
  public var postalCode: String?
  public var region: String?
  public var regionCode: String?
  /// An IANA time zone name.
  public var timezone: String?

  public init(
    city: String? = nil, continentCode: String? = nil, countryCode: String? = nil,
    isEUCountry: Bool? = nil, position: TileflowPosition? = nil, postalCode: String? = nil,
    region: String? = nil, regionCode: String? = nil, timezone: String? = nil
  ) {
    self.city = city
    self.continentCode = continentCode
    self.countryCode = countryCode
    self.isEUCountry = isEUCountry
    self.position = position
    self.postalCode = postalCode
    self.region = region
    self.regionCode = regionCode
    self.timezone = timezone
  }
}

public struct TileflowGeoIPResponse: Sendable, Hashable {
  /// Nil when the service has no geography for the connection.
  public var location: TileflowGeoIPLocation?
  /// The API units the lookup used: always 0 for anonymous access.
  public var units: Int
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

// MARK: Decoding

extension TileflowGeoIPResponse {
  init(_ json: ServiceJSON) throws {
    _ = try json.object()
    guard try json.required("schemaVersion").integer() == 1 else {
      throw ServiceJSONError.invalid
    }
    let units = try json.required("usage").required("units").integer(0...1)
    switch try json.required("status").string() {
    case "unavailable":
      guard try json.required("location") == .null, units == 0 else {
        throw ServiceJSONError.invalid
      }
      self.init(location: nil, units: units)
    case "available":
      let location = try json.required("location")
      _ = try location.object()
      func text(_ key: String) throws -> String? {
        try location.optional(key)?.text(maximum: 256, trimmed: true)
      }
      let countryCode = try text("countryCode")
      if let countryCode, !countryCode.matches("^[A-Z]{2}$") || countryCode == "XX" {
        throw ServiceJSONError.invalid
      }
      let continentCode = try text("continentCode")
      if let continentCode, !["AF", "AN", "AS", "EU", "NA", "OC", "SA"].contains(continentCode) {
        throw ServiceJSONError.invalid
      }
      let value = TileflowGeoIPLocation(
        city: try text("city"), continentCode: continentCode, countryCode: countryCode,
        isEUCountry: try location.optional("isEUCountry")?.bool(),
        position: try location.optional("position")?.position(),
        postalCode: try text("postalCode"), region: try text("region"),
        regionCode: try text("regionCode"), timezone: try text("timezone"))
      // Anonymous lookups use no units.
      guard value != TileflowGeoIPLocation(), units == 0 else { throw ServiceJSONError.invalid }
      self.init(location: value, units: units)
    default:
      throw ServiceJSONError.invalid
    }
  }
}
