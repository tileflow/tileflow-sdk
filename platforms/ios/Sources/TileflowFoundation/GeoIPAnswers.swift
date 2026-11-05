import Foundation

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

// MARK: Decoding

extension TileflowGeoIPResponse {
  package init(_ json: ServiceJSON) throws {
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
