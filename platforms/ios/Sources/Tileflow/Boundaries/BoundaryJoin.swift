import Foundation

public enum TileflowBoundaryKey: Hashable, Sendable, Codable, ExpressibleByStringLiteral,
  ExpressibleByIntegerLiteral, ExpressibleByFloatLiteral
{
  case number(Double)
  case string(String)

  public init(stringLiteral value: String) { self = .string(value) }
  public init(integerLiteral value: Int) { self = .number(Double(value)) }
  public init(floatLiteral value: Double) { self = .number(value) }

  // Swift strings compare canonically equivalent Unicode spellings; JavaScript keys do not.
  public static func == (lhs: Self, rhs: Self) -> Bool {
    switch (lhs, rhs) {
    case (.number(let left), .number(let right)): left == right
    case (.string(let left), .string(let right)): left.utf8.elementsEqual(right.utf8)
    default: false
    }
  }

  public func hash(into hasher: inout Hasher) {
    switch self {
    case .number(let number):
      hasher.combine(0)
      hasher.combine(number)
    case .string(let string):
      hasher.combine(1)
      for byte in string.utf8 { hasher.combine(byte) }
    }
  }

  public init(from decoder: any Decoder) throws {
    let value = try decoder.singleValueContainer()
    if let number = try? value.decode(Double.self) {
      self = .number(number)
    } else {
      self = .string(try value.decode(String.self))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var value = encoder.singleValueContainer()
    switch self {
    case .number(let number): try value.encode(number)
    case .string(let string): try value.encode(string)
    }
  }
}

public enum TileflowBoundaryCode: String, CaseIterable, Codable, Sendable {
  case id, ref, nuts, wikidata
  case iso31661 = "iso_3166_1"
  case iso31662 = "iso_3166_2"
}

public enum TileflowBoundaryTarget: String, Codable, Sendable {
  case id, ref
}

public enum TileflowBoundaryClass: String, CaseIterable, Codable, Sendable {
  case country, dependency, region
  case provinceOrCounty = "province_or_county"
  case municipality, district, neighbourhood
}

public struct TileflowBoundaryRow: Equatable, Sendable, Codable {
  public let key: TileflowBoundaryKey
  public let value: TileflowBoundaryValue?

  public init(key: TileflowBoundaryKey, value: TileflowBoundaryValue?) {
    self.key = key
    self.value = value
  }

  private enum CodingKeys: String, CodingKey { case key, value }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    key = try container.decode(TileflowBoundaryKey.self, forKey: .key)
    if try container.decodeNil(forKey: .value) {
      value = nil
    } else if let number = try? container.decode(Double.self, forKey: .value) {
      value = .number(number)
    } else {
      value = .category(try container.decode(String.self, forKey: .value))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(key, forKey: .key)
    switch value {
    case .number(let number): try container.encode(number, forKey: .value)
    case .category(let string): try container.encode(string, forKey: .value)
    case nil: try container.encodeNil(forKey: .value)
    }
  }
}

public struct TileflowBoundaryLookupRow: Equatable, Sendable, Codable {
  public let id: Double
  public let `class`: TileflowBoundaryClass
  public var adminLevel: Int?
  public var classTier: String?
  public var iso31661: String?
  public var iso31662: String?
  public var name: String?
  public var nameEn: String?
  public var nuts: String?
  public var ref: String?
  public var wikidata: String?

  public init(
    id: Double, class boundaryClass: TileflowBoundaryClass, adminLevel: Int? = nil,
    classTier: String? = nil, iso31661: String? = nil, iso31662: String? = nil,
    name: String? = nil, nameEn: String? = nil, nuts: String? = nil, ref: String? = nil,
    wikidata: String? = nil
  ) {
    self.id = id
    self.class = boundaryClass
    self.adminLevel = adminLevel
    self.classTier = classTier
    self.iso31661 = iso31661
    self.iso31662 = iso31662
    self.name = name
    self.nameEn = nameEn
    self.nuts = nuts
    self.ref = ref
    self.wikidata = wikidata
  }

  enum CodingKeys: String, CodingKey {
    case id, `class`, name, nuts, ref, wikidata
    case adminLevel = "admin_level"
    case classTier = "class_tier"
    case iso31661 = "iso_3166_1"
    case iso31662 = "iso_3166_2"
    case nameEn = "name_en"
  }

  func key(_ code: TileflowBoundaryCode) -> TileflowBoundaryKey? {
    switch code {
    case .id: .number(id)
    case .ref: ref.map(TileflowBoundaryKey.string)
    case .iso31661: iso31661.map(TileflowBoundaryKey.string)
    case .iso31662: iso31662.map(TileflowBoundaryKey.string)
    case .nuts: nuts.map(TileflowBoundaryKey.string)
    case .wikidata: wikidata.map(TileflowBoundaryKey.string)
    }
  }
}

public struct TileflowBoundaryLookup: Sendable, Codable {
  public let rows: [TileflowBoundaryLookupRow]
  private let indexes: [TileflowBoundaryCode: [TileflowBoundaryKey: [Int]]]

  public init(rows: [TileflowBoundaryLookupRow]) throws {
    var indexes: [TileflowBoundaryCode: [TileflowBoundaryKey: [Int]]] = [:]
    for (position, row) in rows.enumerated() {
      guard BoundaryCodeNormalization.safeID(row.id) else {
        throw TileflowBoundaryJoinError.invalidLookupID
      }
      for code in TileflowBoundaryCode.allCases {
        guard let raw = row.key(code), let key = BoundaryCodeNormalization.key(raw, code: code)
        else { continue }
        indexes[code, default: [:]][key, default: []].append(position)
      }
    }
    self.rows = rows
    self.indexes = indexes
  }

  private enum CodingKeys: String, CodingKey { case rows }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    try self.init(rows: container.decode([TileflowBoundaryLookupRow].self, forKey: .rows))
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(rows, forKey: .rows)
  }

  public func find(
    _ code: TileflowBoundaryCode, key: TileflowBoundaryKey,
    classes: [TileflowBoundaryClass]? = nil
  ) -> [TileflowBoundaryLookupRow] {
    guard let normalized = BoundaryCodeNormalization.key(key, code: code) else { return [] }
    return (indexes[code]?[normalized] ?? []).map { rows[$0] }.filter {
      classes?.contains($0.class) ?? true
    }
  }
}

public struct JoinBoundaryRowsOptions: Sendable, Codable {
  public let joinBy: TileflowBoundaryCode
  public var to: TileflowBoundaryTarget = .id
  public var classes: [TileflowBoundaryClass]?
  public var lookup: TileflowBoundaryLookup?

  public init(
    joinBy: TileflowBoundaryCode, to: TileflowBoundaryTarget = .id,
    classes: [TileflowBoundaryClass]? = nil, lookup: TileflowBoundaryLookup? = nil
  ) {
    self.joinBy = joinBy
    self.to = to
    self.classes = classes
    self.lookup = lookup
  }

  private enum CodingKeys: String, CodingKey { case joinBy, to, classes, lookup }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    joinBy = try container.decode(TileflowBoundaryCode.self, forKey: .joinBy)
    to = try container.decodeIfPresent(TileflowBoundaryTarget.self, forKey: .to) ?? .id
    classes = try container.decodeIfPresent([TileflowBoundaryClass].self, forKey: .classes)
    lookup = try container.decodeIfPresent(TileflowBoundaryLookup.self, forKey: .lookup)
  }
}

public struct TileflowBoundaryJoinResult: Equatable, Sendable, Codable {
  public let joinBy: TileflowBoundaryTarget
  public let rows: [TileflowBoundaryRow]
  public let duplicates: [TileflowBoundaryKey]
  public let ambiguous: [TileflowBoundaryKey]
  public let unmatched: [TileflowBoundaryKey]

  /// Setting values replaces the previous set, so omitted null rows clear previous values.
  public func values(labels: Bool = false, state: String = "value") -> TileflowBoundaryValues {
    switch joinBy {
    case .id:
      var values: [Int: TileflowBoundaryValue] = [:]
      for row in rows {
        if case .number(let id) = row.key, let value = row.value { values[Int(id)] = value }
      }
      return TileflowBoundaryValues(ids: values, labels: labels, state: state)
    case .ref:
      var values: [String: TileflowBoundaryValue] = [:]
      for row in rows {
        if case .string(let ref) = row.key, let value = row.value { values[ref] = value }
      }
      return TileflowBoundaryValues(refs: values, labels: labels, state: state)
    }
  }
}

public enum TileflowBoundaryJoinError: Error, Equatable, Sendable, LocalizedError {
  case lookupRequired
  case invalidLookupID
  case invalidCSV
  case offline
  case lookupUnavailable
  case accessDenied
  case mapChanged
  case requestFailed(status: Int)
  case dataTooLarge(limit: Int)

  public var errorDescription: String? {
    switch self {
    case .lookupRequired: "Joining these rows requires the Boundaries lookup table."
    case .invalidLookupID: "The Boundaries lookup has an invalid registry ID."
    case .invalidCSV: "The Boundaries lookup CSV is invalid."
    case .offline: "This map release's Boundaries lookup is not stored on this device; connect to download it."
    case .lookupUnavailable: "This map release does not provide the requested Boundaries lookup."
    case .accessDenied: "The map cannot access its Boundaries lookup."
    case .mapChanged: "The map changed while its Boundaries lookup was loading."
    case .dataTooLarge(let limit): "The Boundaries lookup exceeds \(limit) bytes."
    case .requestFailed(let status): "The Boundaries lookup request failed (HTTP \(status))."
    }
  }
}

/// Re-keys rows with Core's normalization, insertion order and reporting semantics.
public func joinBoundaryRows(
  _ rows: [TileflowBoundaryRow], options: JoinBoundaryRowsOptions
) throws -> TileflowBoundaryJoinResult {
  let direct = options.joinBy.rawValue == options.to.rawValue
  guard direct || options.lookup != nil else { throw TileflowBoundaryJoinError.lookupRequired }

  var result: [TileflowBoundaryRow] = []
  var positions: [TileflowBoundaryKey: Int] = [:]
  var seen = Set<TileflowBoundaryKey>()
  var duplicateSet = Set<TileflowBoundaryKey>()
  var duplicates: [TileflowBoundaryKey] = []
  var ambiguous: [TileflowBoundaryKey] = []
  var unmatched: [TileflowBoundaryKey] = []

  func store(_ key: TileflowBoundaryKey, value: TileflowBoundaryValue?) {
    let row = TileflowBoundaryRow(key: key, value: value)
    if let position = positions[key] {
      result[position] = row
    } else {
      positions[key] = result.count
      result.append(row)
    }
  }

  for row in rows {
    guard let key = BoundaryCodeNormalization.key(row.key, code: options.joinBy) else {
      unmatched.append(row.key)
      continue
    }
    if !seen.insert(key).inserted, duplicateSet.insert(key).inserted { duplicates.append(key) }
    if direct {
      store(key, value: row.value)
      continue
    }

    let matches = options.lookup!.find(options.joinBy, key: key, classes: options.classes)
    guard !matches.isEmpty else {
      unmatched.append(row.key)
      continue
    }
    guard Set(matches.map(\.id)).count == 1 else {
      ambiguous.append(row.key)
      continue
    }
    let targets: [TileflowBoundaryKey] =
      options.to == .id
      ? [.number(matches[0].id)] : matches.compactMap { $0.ref.map(TileflowBoundaryKey.string) }
    if targets.isEmpty { unmatched.append(row.key) }
    for target in targets { store(target, value: row.value) }
  }

  return TileflowBoundaryJoinResult(
    joinBy: options.to, rows: result, duplicates: duplicates, ambiguous: ambiguous,
    unmatched: unmatched)
}

enum BoundaryCodeNormalization {
  static func safeID(_ value: Double) -> Bool {
    value.isFinite && value >= 0 && value <= 9_007_199_254_740_991 && value.rounded() == value
  }

  // ECMAScript WhiteSpace and LineTerminator, including BOM but excluding U+0085.
  static let whitespace = CharacterSet(
    charactersIn:
      "\u{0009}\u{000a}\u{000b}\u{000c}\u{000d}\u{0020}\u{00a0}\u{1680}"
      + "\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}"
      + "\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}")

  static func key(_ value: TileflowBoundaryKey, code: TileflowBoundaryCode) -> TileflowBoundaryKey?
  {
    if code == .id {
      let number: Double?
      switch value {
      case .number(let value): number = value
      case .string(let value):
        let trimmed = value.trimmingCharacters(in: whitespace)
        number = trimmed.isEmpty ? nil : numeric(trimmed)
      }
      guard let number, safeID(number) else { return nil }
      return .number(number)
    }
    guard case .string(let text) = value else { return nil }
    let trimmed = text.trimmingCharacters(in: whitespace)
    guard !trimmed.isEmpty else { return nil }
    return .string(code == .ref ? trimmed : trimmed.uppercased())
  }

  static func numeric(_ text: String) -> Double? {
    let text = text.trimmingCharacters(in: whitespace)
    if text.isEmpty { return 0 }
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
      if text.lowercased().hasPrefix(prefix) {
        let digits = text.dropFirst(2)
        guard !digits.isEmpty else { return nil }
        var value = 0.0
        for character in digits {
          guard character.isASCII, let digit = character.hexDigitValue, digit < radix else {
            return nil
          }
          value = value * Double(radix) + Double(digit)
        }
        return value
      }
    }
    guard
      text.range(
        of: #"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$"#,
        options: .regularExpression) != nil
    else { return nil }
    return Double(text)
  }
}
