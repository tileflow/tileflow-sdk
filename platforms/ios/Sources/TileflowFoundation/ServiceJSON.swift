import Foundation

/// A JSON value as the service clients send and read it. Reading never coerces between types.
package enum ServiceJSON: Sendable, Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([ServiceJSON])
  case object([String: ServiceJSON])

  /// Parses a UTF-8 JSON document.
  package static func parse(_ data: Data) throws -> ServiceJSON {
    guard String(data: data, encoding: .utf8) != nil else { throw ServiceJSONError.invalid }
    let value: Any
    do {
      value = try JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    } catch {
      throw ServiceJSONError.invalid
    }
    return try ServiceJSON(foundation: value)
  }

  private init(foundation value: Any) throws {
    switch value {
    case is NSNull: self = .null
    case let number as NSNumber:
      if CFGetTypeID(number) == CFBooleanGetTypeID() {
        self = .bool(number.boolValue)
      } else {
        let double = number.doubleValue
        guard double.isFinite else { throw ServiceJSONError.invalid }
        self = .number(double)
      }
    case let string as String: self = .string(string)
    case let array as [Any]: self = .array(try array.map { try ServiceJSON(foundation: $0) })
    case let object as [String: Any]:
      self = .object(try object.mapValues { try ServiceJSON(foundation: $0) })
    default: throw ServiceJSONError.invalid
    }
  }

  /// Compact JSON with sorted keys and the shortest digits that read back as the same numbers.
  package func encoded() -> Data {
    var output = ""
    write(to: &output)
    return Data(output.utf8)
  }

  private func write(to output: inout String) {
    switch self {
    case .null: output += "null"
    case .bool(let value): output += value ? "true" : "false"
    case .number(let value):
      if value == value.rounded(), abs(value) < 1e15 {
        output += String(Int64(value))
      } else {
        output += "\(value)"
      }
    case .string(let value): Self.write(string: value, to: &output)
    case .array(let values):
      output += "["
      for (index, value) in values.enumerated() {
        if index > 0 { output += "," }
        value.write(to: &output)
      }
      output += "]"
    case .object(let members):
      output += "{"
      for (index, key) in members.keys.sorted().enumerated() {
        if index > 0 { output += "," }
        Self.write(string: key, to: &output)
        output += ":"
        members[key]!.write(to: &output)
      }
      output += "}"
    }
  }

  private static func write(string: String, to output: inout String) {
    output += "\""
    for scalar in string.unicodeScalars {
      switch scalar {
      case "\"": output += "\\\""
      case "\\": output += "\\\\"
      case "\n": output += "\\n"
      case "\r": output += "\\r"
      case "\t": output += "\\t"
      case _ where scalar.value < 0x20:
        output += String(format: "\\u%04x", scalar.value)
      default: output.unicodeScalars.append(scalar)
      }
    }
    output += "\""
  }

  // MARK: Reading

  package subscript(key: String) -> ServiceJSON? {
    guard case .object(let members) = self else { return nil }
    return members[key]
  }

  package func object() throws -> [String: ServiceJSON] {
    guard case .object(let members) = self else { throw ServiceJSONError.invalid }
    return members
  }

  package func array(count range: ClosedRange<Int> = 0...Int.max) throws -> [ServiceJSON] {
    guard case .array(let values) = self, range.contains(values.count) else {
      throw ServiceJSONError.invalid
    }
    return values
  }

  package func string() throws -> String {
    guard case .string(let value) = self else { throw ServiceJSONError.invalid }
    return value
  }

  package func bool() throws -> Bool {
    guard case .bool(let value) = self else { throw ServiceJSONError.invalid }
    return value
  }

  package func number(
    _ range: ClosedRange<Double> = -.greatestFiniteMagnitude ... .greatestFiniteMagnitude
  )
    throws -> Double
  {
    guard case .number(let value) = self, range.contains(value) else {
      throw ServiceJSONError.invalid
    }
    return value
  }

  package func integer(_ range: ClosedRange<Int> = Int.min...Int.max) throws -> Int {
    let value = try number()
    guard value == value.rounded(), abs(value) <= 9_007_199_254_740_991,
      range.contains(Int(value))
    else { throw ServiceJSONError.invalid }
    return Int(value)
  }

  /// Text of 1 to `maximum` UTF-16 code units without control characters, trimmed when `trimmed`.
  package func text(maximum: Int, trimmed: Bool = false) throws -> String {
    var value = try string()
    if trimmed { value = value.trimmingCharacters(in: .whitespacesAndNewlines) }
    guard !value.isEmpty, value.utf16.count <= maximum, !value.containsControlCharacters else {
      throw ServiceJSONError.invalid
    }
    return value
  }

  /// `[longitude, latitude]`, optionally followed by more numbers the caller reads itself.
  package func position(extra: Int = 0) throws -> TileflowPosition {
    let values = try array(count: (2 + extra)...(2 + extra))
    let position = TileflowPosition(
      longitude: try values[0].number(-180...180), latitude: try values[1].number(-90...90))
    return position
  }

  /// `[west, south, east, north]` with west < east and south < north.
  package func boundingBox() throws -> TileflowBoundingBox {
    let values = try array(count: 4...4)
    let box = TileflowBoundingBox(
      west: try values[0].number(), south: try values[1].number(),
      east: try values[2].number(), north: try values[3].number())
    guard box.isValid else { throw ServiceJSONError.invalid }
    return box
  }

  /// A JSON object's member, which must be present.
  package func required(_ key: String) throws -> ServiceJSON {
    guard let value = self[key] else { throw ServiceJSONError.invalid }
    return value
  }

  /// A JSON object's member, absent or null as nil.
  package func optional(_ key: String) -> ServiceJSON? {
    guard let value = self[key], value != .null else { return nil }
    return value
  }

  package static func position(_ position: TileflowPosition) -> ServiceJSON {
    .array([.number(position.longitude), .number(position.latitude)])
  }

  package static func boundingBox(_ box: TileflowBoundingBox) -> ServiceJSON {
    .array([.number(box.west), .number(box.south), .number(box.east), .number(box.north)])
  }
}

package enum ServiceJSONError: Error { case invalid }

extension String {
  /// Whether the text has a C0 or C1 control character (Unicode category Cc).
  package var containsControlCharacters: Bool {
    unicodeScalars.contains { $0.properties.generalCategory == .control }
  }

  /// 1 to `maximum` characters of printable ASCII without spaces (`!` to `~`).
  package func isPrintableToken(maximum: Int) -> Bool {
    (1...maximum).contains(utf8.count) && utf8.allSatisfy { (0x21...0x7e).contains($0) }
  }

  package func matches(_ pattern: String) -> Bool {
    range(of: pattern, options: .regularExpression) == startIndex..<endIndex
  }
}
