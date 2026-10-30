import Foundation

/// What a result is. Values the client does not know yet decode as they are.
public struct TileflowPlaceKind: RawRepresentable, Hashable, Sendable {
  public let rawValue: String
  public init(rawValue: String) { self.rawValue = rawValue }

  public static let address = Self(rawValue: "address")
  public static let street = Self(rawValue: "street")
  public static let locality = Self(rawValue: "locality")
  public static let district = Self(rawValue: "district")
  public static let county = Self(rawValue: "county")
  public static let region = Self(rawValue: "region")
  public static let country = Self(rawValue: "country")
  public static let place = Self(rawValue: "place")
  public static let unknown = Self(rawValue: "unknown")
}

public struct TileflowAddress: Sendable, Hashable {
  public var name: String?
  public var houseNumber: String?
  public var street: String?
  public var locality: String?
  public var district: String?
  public var city: String?
  public var county: String?
  public var region: String?
  public var postalCode: String?
  public var country: String?
  /// ISO 3166-1 alpha-2.
  public var countryCode: String?
}

public struct TileflowSearchCategory: Sendable, Hashable {
  public var id: String
  public var name: String
  public var localizedName: String?
  public var primary: Bool?
}

public struct TileflowBusinessChain: Sendable, Hashable {
  public var id: String
  public var name: String
}

/// A provider's contact value. It is text, not a validated link: check its scheme before
/// opening it.
public struct TileflowContact: Sendable, Hashable {
  public var value: String
  public var label: String?
}

public struct TileflowContacts: Sendable, Hashable {
  public var phones: [TileflowContact]
  public var websites: [TileflowContact]
  public var emails: [TileflowContact]
}

public struct TileflowOpeningHours: Sendable, Hashable {
  /// Lines ready to show, in the requested language.
  public var display: [String]
  public var openNow: Bool?
}

public struct TileflowTimeZone: Sendable, Hashable {
  /// An IANA time zone name.
  public var name: String
  public var utcOffsetSeconds: Int?
}

/// A geocoding, autocomplete, resolution or Nearby place.
public struct TileflowPlace: Sendable, Hashable {
  public var kind: TileflowPlaceKind
  public var label: String
  public var position: TileflowPosition
  public var address: TileflowAddress
  public var bounds: TileflowBoundingBox?
  public var sourceRef: String?
  public var name: String?
  public var categories: [TileflowSearchCategory]
  public var foodTypes: [TileflowSearchCategory]
  public var businessChains: [TileflowBusinessChain]
  public var distanceMeters: Double?
  public var contacts: TileflowContacts?
  public var openingHours: [TileflowOpeningHours]
  public var timeZone: TileflowTimeZone?
  public var accessPoints: [TileflowPosition]
  /// A Nearby result's token, which ``TileflowSearch/resolveSuggestion(_:)`` resolves.
  public var token: String?
}

public struct TileflowSearchSource: Sendable, Hashable {
  public var id: String
  public var revision: String?
}

/// A credit to show with the results.
public struct TileflowSearchAttribution: Sendable, Hashable {
  public var text: String
  /// An HTTPS link without credentials.
  public var url: URL?
}

public struct TileflowGeocodeResponse: Sendable, Hashable {
  public var queryID: String
  public var results: [TileflowPlace]
  public var source: TileflowSearchSource
  public var attribution: [TileflowSearchAttribution]
  /// The API units the operation used.
  public var units: Int
}

public struct TileflowSuggestion: Sendable, Hashable {
  public var kind: TileflowPlaceKind
  public var label: String
  public var addressLabel: String?
  /// Present when the request asked for places.
  public var place: TileflowPlace?
  public var token: String
}

public struct TileflowAutocompleteResponse: Sendable, Hashable {
  public var suggestions: [TileflowSuggestion]
  public var source: TileflowSearchSource
  public var attribution: [TileflowSearchAttribution]
  public var units: Int
}

public struct TileflowResolveSuggestionResponse: Sendable, Hashable {
  public var result: TileflowPlace
  public var source: TileflowSearchSource
  public var attribution: [TileflowSearchAttribution]
  public var units: Int
}

public struct TileflowNearbyResponse: Sendable, Hashable {
  public var results: [TileflowPlace]
  /// Pass it as the next request's `cursor` for more results.
  public var nextCursor: String?
  public var source: TileflowSearchSource
  public var attribution: [TileflowSearchAttribution]
  public var units: Int
}

public struct TileflowSearchCategoriesResponse: Sendable, Hashable {
  public var categories: [TileflowSearchCategory]
  public var source: TileflowSearchSource
  public var attribution: [TileflowSearchAttribution]
}

// MARK: Decoding

extension TileflowGeocodeResponse {
  init(_ json: ServiceJSON) throws {
    try SearchDecoding.schema(json)
    let queryID = try json.required("queryId").string()
    guard
      queryID.matches(
        "^gq_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    else { throw ServiceJSONError.invalid }
    self.init(
      queryID: queryID,
      results: try json.required("results").array(count: 0...10).map {
        try SearchDecoding.place($0)
      },
      source: try SearchDecoding.source(json),
      attribution: try SearchDecoding.attribution(json),
      units: try SearchDecoding.units(json))
  }
}

extension TileflowAutocompleteResponse {
  init(_ json: ServiceJSON) throws {
    try SearchDecoding.schema(json)
    self.init(
      suggestions: try json.required("suggestions").array(count: 0...10).map { item in
        TileflowSuggestion(
          kind: try SearchDecoding.kind(item.required("kind")),
          label: try item.required("label").text(maximum: 512, trimmed: true),
          addressLabel: try item.optional("addressLabel")?.text(maximum: 512, trimmed: true),
          place: try item.optional("place").map { try SearchDecoding.place($0) },
          token: try SearchDecoding.token(item.required("token"), maximum: 2048))
      },
      source: try SearchDecoding.source(json),
      attribution: try SearchDecoding.attribution(json),
      units: try SearchDecoding.units(json))
  }
}

extension TileflowResolveSuggestionResponse {
  init(_ json: ServiceJSON) throws {
    try SearchDecoding.schema(json)
    self.init(
      result: try SearchDecoding.place(json.required("result")),
      source: try SearchDecoding.source(json),
      attribution: try SearchDecoding.attribution(json),
      units: try SearchDecoding.units(json))
  }
}

extension TileflowNearbyResponse {
  init(_ json: ServiceJSON) throws {
    try SearchDecoding.schema(json)
    let results = try json.required("results").array(count: 0...100).map {
      try SearchDecoding.place($0, nearby: true)
    }
    guard results.allSatisfy({ $0.kind == .place }) else { throw ServiceJSONError.invalid }
    self.init(
      results: results,
      nextCursor: try json.optional("nextCursor").map {
        try SearchDecoding.token($0, maximum: 8192)
      },
      source: try SearchDecoding.source(json),
      attribution: try SearchDecoding.attribution(json),
      units: try SearchDecoding.units(json))
  }
}

extension TileflowSearchCategoriesResponse {
  init(_ json: ServiceJSON) throws {
    try SearchDecoding.schema(json)
    self.init(
      categories: try json.required("categories").array(count: 1...2000).map {
        try SearchDecoding.category($0)
      },
      source: try SearchDecoding.source(json),
      attribution: try SearchDecoding.attribution(json))
  }
}

enum SearchDecoding {
  static func schema(_ json: ServiceJSON) throws {
    _ = try json.object()
    guard try json.required("schemaVersion").integer() == 1 else {
      throw ServiceJSONError.invalid
    }
  }

  static func units(_ json: ServiceJSON) throws -> Int {
    try json.required("usage").required("units").integer(0...1000)
  }

  static func source(_ json: ServiceJSON) throws -> TileflowSearchSource {
    let source = try json.required("source")
    return TileflowSearchSource(
      id: try source.required("id").text(maximum: 128, trimmed: true),
      revision: try source.optional("revision")?.text(maximum: 128, trimmed: true))
  }

  static func attribution(_ json: ServiceJSON) throws -> [TileflowSearchAttribution] {
    try json.required("attribution").array(count: 1...8).map { item in
      var url: URL?
      if let link = item.optional("url") {
        let text = try link.string()
        guard text.utf16.count <= 2048, !text.containsControlCharacters,
          let components = URLComponents(string: text), components.scheme == "https",
          components.host?.isEmpty == false, components.user == nil, components.password == nil,
          let parsed = components.url
        else { throw ServiceJSONError.invalid }
        url = parsed
      }
      return TileflowSearchAttribution(
        text: try item.required("text").text(maximum: 512, trimmed: true), url: url)
    }
  }

  static func kind(_ json: ServiceJSON) throws -> TileflowPlaceKind {
    let value = try json.string()
    guard value.matches("^[a-z][a-z0-9_-]{0,63}$") else { throw ServiceJSONError.invalid }
    return TileflowPlaceKind(rawValue: value)
  }

  static func token(_ json: ServiceJSON, maximum: Int) throws -> String {
    let value = try json.string()
    guard value.isPrintableToken(maximum: maximum) else { throw ServiceJSONError.invalid }
    return value
  }

  static func category(_ json: ServiceJSON) throws -> TileflowSearchCategory {
    TileflowSearchCategory(
      id: try json.required("id").text(maximum: 100),
      name: try json.required("name").text(maximum: 100),
      localizedName: try json.optional("localizedName")?.text(maximum: 100),
      primary: try json.optional("primary")?.bool())
  }

  static func place(_ json: ServiceJSON, nearby: Bool = false) throws -> TileflowPlace {
    let address = try json.required("address")
    _ = try address.object()
    func part(_ key: String) throws -> String? {
      try address.optional(key)?.text(maximum: 256, trimmed: true)
    }
    let countryCode = try address.optional("countryCode")?.string()
    if let countryCode, !countryCode.matches("^[A-Z]{2}$") { throw ServiceJSONError.invalid }
    func list<Item>(_ key: String, _ count: ClosedRange<Int>, _ read: (ServiceJSON) throws -> Item)
      throws -> [Item]
    {
      try json.optional(key)?.array(count: count).map(read) ?? []
    }
    let contacts = try json.optional("contacts").map { value -> TileflowContacts in
      func entries(_ key: String) throws -> [TileflowContact] {
        try value.optional(key)?.array(count: 1...100).map { item in
          TileflowContact(
            value: try item.required("value").text(maximum: 2048),
            label: try item.optional("label")?.text(maximum: 256))
        } ?? []
      }
      return TileflowContacts(
        phones: try entries("phones"), websites: try entries("websites"),
        emails: try entries("emails"))
    }
    let sourceRef = try json.optional("sourceRef")?.string()
    if let sourceRef, !sourceRef.matches("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$") {
      throw ServiceJSONError.invalid
    }
    let distance = try json.optional("distanceMeters")?.number(0 ... .greatestFiniteMagnitude)
    return TileflowPlace(
      kind: try kind(json.required("kind")),
      label: try json.required("label").text(maximum: 512, trimmed: true),
      position: try json.required("position").position(),
      address: TileflowAddress(
        name: try part("name"), houseNumber: try part("houseNumber"), street: try part("street"),
        locality: try part("locality"), district: try part("district"), city: try part("city"),
        county: try part("county"), region: try part("region"),
        postalCode: try part("postalCode"), country: try part("country"),
        countryCode: countryCode),
      bounds: try json.optional("bounds")?.boundingBox(),
      sourceRef: sourceRef,
      name: try json.optional("name")?.text(maximum: 200),
      categories: try list("categories", 1...100, category),
      foodTypes: try list("foodTypes", 1...100, category),
      businessChains: try list("businessChains", 1...100) { item in
        TileflowBusinessChain(
          id: try item.required("id").text(maximum: 100),
          name: try item.required("name").text(maximum: 100))
      },
      distanceMeters: distance,
      contacts: contacts,
      openingHours: try list("openingHours", 1...20) { item in
        TileflowOpeningHours(
          display: try item.optional("display")?.array(count: 1...50).map {
            try $0.text(maximum: 256)
          } ?? [],
          openNow: try item.optional("openNow")?.bool())
      },
      timeZone: try json.optional("timeZone").map { zone in
        TileflowTimeZone(
          name: try zone.required("name").text(maximum: 64),
          utcOffsetSeconds: try zone.optional("utcOffsetSeconds")?.integer(-86_400...86_400))
      },
      accessPoints: try list("accessPoints", 1...100) { try $0.required("position").position() },
      token: nearby ? try json.optional("token").map { try token($0, maximum: 2048) } : nil)
  }
}
