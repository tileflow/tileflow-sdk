import Foundation

/// Tileflow Search: geocoding, reverse geocoding, autocomplete, Nearby and categories.
///
/// The client reads the process configuration on every call unless it is given one. It needs a
/// publishable credential with the Search permission that lists this app's bundle identifier.
public struct TileflowSearch: Sendable {
  private let transport: ServiceTransport

  /// - Parameters:
  ///   - configuration: Overrides ``Tileflow/configuration()`` for this client.
  ///   - session: The session that sends requests. Redirects are never followed.
  public init(configuration: TileflowConfiguration? = nil, session: URLSession = .shared) {
    transport = ServiceTransport(
      configuration: configuration, session: session, policy: TileflowSearchError.policy)
  }

  /// Places matching a query, best match first.
  public func geocode(_ request: TileflowGeocodeRequest) async throws -> TileflowGeocodeResponse {
    try await run {
      let body = try request.wireValue()
      let units = request.include.isEmpty ? 10 : 30
      return try await transport.call(
        Self.request("/v1/geocoding/forward", body)
      ) { json in
        let answer = try TileflowGeocodeResponse(json)
        guard answer.units == units,
          answer.results.count <= (request.limit ?? SearchLimits.defaultLimit)
        else { throw ServiceJSONError.invalid }
        return answer
      }
    }
  }

  /// Addresses, streets, localities and places at a position, nearest first.
  public func reverseGeocode(_ request: TileflowReverseGeocodeRequest) async throws
    -> TileflowGeocodeResponse
  {
    try await run {
      let body = try request.wireValue()
      let units = request.include.isEmpty ? 10 : 30
      let kinds = Set(request.kinds.map(\.rawValue))
      return try await transport.call(Self.request("/v1/geocoding/reverse", body)) { json in
        let answer = try TileflowGeocodeResponse(json)
        guard answer.units == units, answer.results.count <= request.limit,
          kinds.isEmpty || answer.results.allSatisfy({ kinds.contains($0.kind.rawValue) })
        else { throw ServiceJSONError.invalid }
        return answer
      }
    }
  }

  /// Suggestions while a person types. Resolve the chosen suggestion with
  /// ``resolveSuggestion(_:)``, or ask for its place up front with `includesPlaces`.
  public func autocomplete(_ request: TileflowAutocompleteRequest) async throws
    -> TileflowAutocompleteResponse
  {
    try await run {
      let body = try request.wireValue()
      return try await transport.call(Self.request("/v1/geocoding/autocomplete", body)) { json in
        let answer = try TileflowAutocompleteResponse(json)
        guard answer.units == (request.includesPlaces ? 10 : 4),
          answer.suggestions.count <= request.limit,
          answer.suggestions.allSatisfy({ ($0.place != nil) == request.includesPlaces })
        else { throw ServiceJSONError.invalid }
        return answer
      }
    }
  }

  /// The place of an autocomplete suggestion or a Nearby result token.
  public func resolveSuggestion(_ request: TileflowResolveSuggestionRequest) async throws
    -> TileflowResolveSuggestionResponse
  {
    try await run {
      let body = try request.wireValue()
      let units = request.include.isEmpty ? 10 : 30
      return try await transport.call(Self.request("/v1/geocoding/resolve", body)) { json in
        let answer = try TileflowResolveSuggestionResponse(json)
        guard answer.units == units else { throw ServiceJSONError.invalid }
        return answer
      }
    }
  }

  /// Places around a position, optionally filtered by category and country, nearest first.
  public func searchNearby(_ request: TileflowNearbyRequest) async throws -> TileflowNearbyResponse
  {
    try await run {
      let body = try request.wireValue()
      let units = request.include.isEmpty ? 10 : 30
      return try await transport.call(
        Self.request(
          "/v1/geocoding/nearby", body, requestBytes: SearchLimits.nearbyRequestBytes,
          responseBytes: SearchLimits.nearbyResponseBytes)
      ) { json in
        let answer = try TileflowNearbyResponse(json)
        guard answer.units == units, answer.results.count <= request.limit else {
          throw ServiceJSONError.invalid
        }
        return answer
      }
    }
  }

  /// The categories Nearby can filter by. Listing them uses no API units.
  public func listCategories() async throws -> TileflowSearchCategoriesResponse {
    try await run {
      try await transport.call(
        ServiceRequest(
          service: .search, method: "GET", path: "/v1/geocoding/categories", body: nil,
          maximumRequestBytes: 0, maximumResponseBytes: SearchLimits.nearbyResponseBytes)
      ) { json in try TileflowSearchCategoriesResponse(json) }
    }
  }

  private static func request(
    _ path: String, _ body: ServiceJSON, requestBytes: Int = SearchLimits.requestBytes,
    responseBytes: Int = SearchLimits.responseBytes
  ) -> ServiceRequest {
    ServiceRequest(
      service: .search, path: path, body: body, maximumRequestBytes: requestBytes,
      maximumResponseBytes: responseBytes)
  }

  private func run<Answer>(_ work: () async throws -> Answer) async throws -> Answer {
    do {
      return try await work()
    } catch let failure as ServiceFailure {
      throw TileflowSearchError(failure)
    }
  }
}

enum SearchLimits {
  static let defaultLimit = 5
  static let requestBytes = 8 * 1024
  static let responseBytes = 64 * 1024
  static let nearbyRequestBytes = 32 * 1024
  static let nearbyResponseBytes = 512 * 1024
}

/// Optional place details. Asking for any of them makes the operation an extended one with a
/// higher unit weight. Contacts and opening hours need bounds, Nearby or a resolution.
public enum TileflowPlaceDetail: String, Sendable, CaseIterable {
  case contacts
  case openingHours
  case timeZone
  case accessPoints
}

public enum TileflowReverseGeocodingKind: String, Sendable, CaseIterable {
  case address
  case street
  case locality
  case place
}

/// A forward geocoding request. `bounds` restricts results to a box; `proximity` ranks nearer
/// matches first without excluding others. They are mutually exclusive.
public struct TileflowGeocodeRequest: Sendable, Equatable {
  public var query: String
  public var language: String?
  /// 1 to 10; the service returns at most 5 when nil.
  public var limit: Int?
  public var bounds: TileflowBoundingBox?
  public var proximity: TileflowPosition?
  public var include: [TileflowPlaceDetail]

  public init(
    query: String, language: String? = nil, limit: Int? = nil,
    bounds: TileflowBoundingBox? = nil, proximity: TileflowPosition? = nil,
    include: [TileflowPlaceDetail] = []
  ) {
    self.query = query
    self.language = language
    self.limit = limit
    self.bounds = bounds
    self.proximity = proximity
    self.include = include
  }

  func wireValue() throws -> ServiceJSON {
    var body: [String: ServiceJSON] = [
      "query": .string(try SearchValidation.query(query)), "retention": .string("temporary"),
    ]
    try SearchValidation.area(bounds: bounds, proximity: proximity, into: &body)
    if let language { body["language"] = .string(try SearchValidation.language(language)) }
    if let limit {
      guard (1...10).contains(limit) else { throw TileflowSearchError.invalid() }
      body["limit"] = .number(Double(limit))
    }
    if !include.isEmpty {
      body["include"] = try SearchValidation.include(include)
      // Contacts and opening hours come from a text search inside bounds, not from geocoding.
      if bounds == nil, SearchValidation.hasContactDetails(include) {
        throw TileflowSearchError.unsupportedFilter()
      }
    }
    return .object(body)
  }
}

public struct TileflowReverseGeocodeRequest: Sendable, Equatable {
  public var position: TileflowPosition
  /// Up to four kinds, any of which may match. Empty accepts every kind.
  public var kinds: [TileflowReverseGeocodingKind]
  public var language: String?
  /// 1 to 10.
  public var limit: Int
  /// Time zones and access points. Contacts and opening hours are not available here.
  public var include: [TileflowPlaceDetail]

  public init(
    position: TileflowPosition, kinds: [TileflowReverseGeocodingKind] = [],
    language: String? = nil, limit: Int = 1, include: [TileflowPlaceDetail] = []
  ) {
    self.position = position
    self.kinds = kinds
    self.language = language
    self.limit = limit
    self.include = include
  }

  func wireValue() throws -> ServiceJSON {
    guard position.isValid, (1...10).contains(limit), kinds.count <= 4 else {
      throw TileflowSearchError.invalid()
    }
    var body: [String: ServiceJSON] = [
      "position": .position(position), "limit": .number(Double(limit)),
      "retention": .string("temporary"),
    ]
    if !kinds.isEmpty { body["kinds"] = .array(kinds.map { .string($0.rawValue) }) }
    if let language { body["language"] = .string(try SearchValidation.language(language)) }
    if !include.isEmpty {
      body["include"] = try SearchValidation.include(include)
      if SearchValidation.hasContactDetails(include) {
        throw TileflowSearchError.unsupportedFilter()
      }
    }
    return .object(body)
  }
}

public struct TileflowAutocompleteRequest: Sendable, Equatable {
  public var query: String
  public var language: String?
  /// 1 to 10.
  public var limit: Int
  public var bounds: TileflowBoundingBox?
  public var proximity: TileflowPosition?
  /// Returns each suggestion's place, with its position, for a higher unit weight.
  public var includesPlaces: Bool

  public init(
    query: String, language: String? = nil, limit: Int = 5, bounds: TileflowBoundingBox? = nil,
    proximity: TileflowPosition? = nil, includesPlaces: Bool = false
  ) {
    self.query = query
    self.language = language
    self.limit = limit
    self.bounds = bounds
    self.proximity = proximity
    self.includesPlaces = includesPlaces
  }

  func wireValue() throws -> ServiceJSON {
    guard (1...10).contains(limit) else { throw TileflowSearchError.invalid() }
    var body: [String: ServiceJSON] = [
      "query": .string(try SearchValidation.query(query)), "limit": .number(Double(limit)),
    ]
    try SearchValidation.area(bounds: bounds, proximity: proximity, into: &body)
    if let language { body["language"] = .string(try SearchValidation.language(language)) }
    if includesPlaces { body["include"] = .array([.string("place")]) }
    return .object(body)
  }
}

public struct TileflowResolveSuggestionRequest: Sendable, Equatable {
  /// A suggestion's or a Nearby result's token.
  public var token: String
  public var include: [TileflowPlaceDetail]

  public init(token: String, include: [TileflowPlaceDetail] = []) {
    self.token = token
    self.include = include
  }

  func wireValue() throws -> ServiceJSON {
    guard token.isPrintableToken(maximum: 2048) else { throw TileflowSearchError.invalid() }
    var body: [String: ServiceJSON] = [
      "token": .string(token), "retention": .string("temporary"),
    ]
    if !include.isEmpty { body["include"] = try SearchValidation.include(include) }
    return .object(body)
  }
}

/// Places around a position. `radiusMeters` and `bounds` are mutually exclusive, and a category
/// cannot be both included and excluded.
public struct TileflowNearbyRequest: Sendable, Equatable {
  public var position: TileflowPosition
  /// 1 to 21,000,000 metres.
  public var radiusMeters: Int?
  public var bounds: TileflowBoundingBox?
  /// Up to 10 category IDs from ``TileflowSearch/listCategories()``.
  public var includeCategories: [String]
  public var excludeCategories: [String]
  /// Up to 100 ISO 3166 alpha-2 or alpha-3 country codes.
  public var countries: [String]
  public var language: String?
  public var include: [TileflowPlaceDetail]
  /// 1 to 100.
  public var limit: Int
  /// The previous answer's `nextCursor`, for the next page.
  public var cursor: String?

  public init(
    position: TileflowPosition, radiusMeters: Int? = nil, bounds: TileflowBoundingBox? = nil,
    includeCategories: [String] = [], excludeCategories: [String] = [], countries: [String] = [],
    language: String? = nil, include: [TileflowPlaceDetail] = [], limit: Int = 20,
    cursor: String? = nil
  ) {
    self.position = position
    self.radiusMeters = radiusMeters
    self.bounds = bounds
    self.includeCategories = includeCategories
    self.excludeCategories = excludeCategories
    self.countries = countries
    self.language = language
    self.include = include
    self.limit = limit
    self.cursor = cursor
  }

  func wireValue() throws -> ServiceJSON {
    guard position.isValid, (1...100).contains(limit) else { throw TileflowSearchError.invalid() }
    var body: [String: ServiceJSON] = [
      "position": .position(position), "limit": .number(Double(limit)),
    ]
    if let radiusMeters {
      guard (1...21_000_000).contains(radiusMeters) else { throw TileflowSearchError.invalid() }
      body["radiusMeters"] = .number(Double(radiusMeters))
    }
    if let bounds {
      guard bounds.isValid else { throw TileflowSearchError.invalid() }
      body["bounds"] = .boundingBox(bounds)
    }
    for (key, categories) in [
      ("includeCategories", includeCategories), ("excludeCategories", excludeCategories),
    ] where !categories.isEmpty {
      guard categories.count <= 10,
        categories.allSatisfy({
          (1...100).contains($0.utf16.count) && !$0.containsControlCharacters
        })
      else { throw TileflowSearchError.invalid() }
      body[key] = .array(categories.map(ServiceJSON.string))
    }
    if !countries.isEmpty {
      guard countries.count <= 100,
        countries.allSatisfy({ $0.matches("^(?:[A-Z]{2}|[A-Z]{3})$") })
      else { throw TileflowSearchError.invalid() }
      body["countries"] = .array(countries.map(ServiceJSON.string))
    }
    if let language { body["language"] = .string(try SearchValidation.language(language)) }
    if !include.isEmpty { body["include"] = try SearchValidation.include(include) }
    if let cursor {
      guard cursor.isPrintableToken(maximum: 8192) else { throw TileflowSearchError.invalid() }
      body["cursor"] = .string(cursor)
    }
    if (radiusMeters != nil && bounds != nil)
      || !Set(includeCategories).isDisjoint(with: excludeCategories)
    {
      throw TileflowSearchError.unsupportedFilter()
    }
    return .object(body)
  }
}

enum SearchValidation {
  static func query(_ value: String) throws -> String {
    let query = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard (1...200).contains(query.utf16.count), !query.containsControlCharacters else {
      throw TileflowSearchError.invalid()
    }
    return query
  }

  static func language(_ value: String) throws -> String {
    guard value.utf16.count <= 35, value.matches("^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$") else {
      throw TileflowSearchError.invalid()
    }
    return value
  }

  static func include(_ details: [TileflowPlaceDetail]) throws -> ServiceJSON {
    guard Set(details).count == details.count else { throw TileflowSearchError.invalid() }
    return .array(details.map { .string($0.rawValue) })
  }

  static func area(
    bounds: TileflowBoundingBox?, proximity: TileflowPosition?,
    into body: inout [String: ServiceJSON]
  ) throws {
    guard bounds == nil || proximity == nil else { throw TileflowSearchError.invalid() }
    if let bounds {
      guard bounds.isValid else { throw TileflowSearchError.invalid() }
      body["bounds"] = .boundingBox(bounds)
    }
    if let proximity {
      guard proximity.isValid else { throw TileflowSearchError.invalid() }
      body["proximity"] = .position(proximity)
    }
  }

  static func hasContactDetails(_ details: [TileflowPlaceDetail]) -> Bool {
    details.contains(.contacts) || details.contains(.openingHours)
  }
}
