import Foundation
import TileflowConfiguration

// Values as they cross the React Native bridge: Foundation objects from JavaScript in, Foundation
// objects for JavaScript out. Nothing here imports React, so the conversions are tested on their
// own.

/// A JavaScript argument that does not have the documented shape.
struct BridgeArgumentError: Error, CustomStringConvertible {
  let path: String
  let expected: String
  var description: String { "\(path) must be \(expected)" }
}

/// A JavaScript object read with the path of each key, for errors that name the bad field.
struct BridgeObject {
  let values: [String: Any]
  let path: String

  init(_ value: Any?, path: String = "request") throws {
    guard let values = value as? [String: Any] else {
      throw BridgeArgumentError(path: path, expected: "an object")
    }
    self.values = values
    self.path = path
  }

  private func present(_ key: String) -> Any? {
    guard let value = values[key], !(value is NSNull) else { return nil }
    return value
  }

  private func error(_ key: String, _ expected: String) -> BridgeArgumentError {
    BridgeArgumentError(path: "\(path).\(key)", expected: expected)
  }

  func has(_ key: String) -> Bool { present(key) != nil }

  func string(_ key: String) throws -> String {
    guard let value = try optionalString(key) else { throw error(key, "a string") }
    return value
  }

  func optionalString(_ key: String) throws -> String? {
    guard let value = present(key) else { return nil }
    guard let text = value as? String else { throw error(key, "a string") }
    return text
  }

  func double(_ key: String) throws -> Double {
    guard let value = try optionalDouble(key) else { throw error(key, "a number") }
    return value
  }

  func optionalDouble(_ key: String) throws -> Double? {
    guard let value = present(key) else { return nil }
    guard let number = BridgeObject.number(value), number.isFinite else {
      throw error(key, "a finite number")
    }
    return number
  }

  func int(_ key: String) throws -> Int {
    guard let value = try optionalInt(key) else { throw error(key, "an integer") }
    return value
  }

  func optionalInt(_ key: String) throws -> Int? {
    guard let value = try optionalDouble(key) else { return nil }
    guard value == value.rounded(), abs(value) <= 9_007_199_254_740_991 else {
      throw error(key, "an integer")
    }
    return Int(value)
  }

  func bool(_ key: String, default fallback: Bool) throws -> Bool {
    try optionalBool(key) ?? fallback
  }

  func optionalBool(_ key: String) throws -> Bool? {
    guard let value = present(key) else { return nil }
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
      throw error(key, "a boolean")
    }
    return number.boolValue
  }

  func object(_ key: String) throws -> BridgeObject {
    guard let value = try optionalObject(key) else { throw error(key, "an object") }
    return value
  }

  func optionalObject(_ key: String) throws -> BridgeObject? {
    guard let value = present(key) else { return nil }
    return try BridgeObject(value, path: "\(path).\(key)")
  }

  func array(_ key: String) throws -> [Any] {
    guard let value = try optionalArray(key) else { throw error(key, "an array") }
    return value
  }

  func optionalArray(_ key: String) throws -> [Any]? {
    guard let value = present(key) else { return nil }
    guard let array = value as? [Any] else { throw error(key, "an array") }
    return array
  }

  func strings(_ key: String) throws -> [String] {
    try (optionalArray(key) ?? []).enumerated().map { index, value in
      guard let text = value as? String else {
        throw BridgeArgumentError(path: "\(path).\(key)[\(index)]", expected: "a string")
      }
      return text
    }
  }

  func ints(_ key: String) throws -> [Int] {
    try (optionalArray(key) ?? []).enumerated().map { index, value in
      guard let number = BridgeObject.number(value), number == number.rounded() else {
        throw BridgeArgumentError(path: "\(path).\(key)[\(index)]", expected: "an integer")
      }
      return Int(number)
    }
  }

  /// A string of a fixed set, as JavaScript writes the native case.
  func choice<Value: RawRepresentable>(_ key: String, _: Value.Type) throws -> Value?
  where Value.RawValue == String {
    guard let text = try optionalString(key) else { return nil }
    guard let value = Value(rawValue: text) else { throw error(key, "a supported value") }
    return value
  }

  func choices<Value: RawRepresentable>(_ key: String, _: Value.Type) throws -> [Value]
  where Value.RawValue == String {
    try strings(key).map { text in
      guard let value = Value(rawValue: text) else { throw error(key, "supported values") }
      return value
    }
  }

  func position(_ key: String) throws -> TileflowPosition {
    guard let value = try optionalPosition(key) else { throw error(key, "[longitude, latitude]") }
    return value
  }

  func optionalPosition(_ key: String) throws -> TileflowPosition? {
    guard let value = present(key) else { return nil }
    return try BridgeObject.position(value, path: "\(path).\(key)")
  }

  func positions(_ key: String) throws -> [TileflowPosition] {
    try BridgeObject.positions(array(key), path: "\(path).\(key)")
  }

  func optionalBoundingBox(_ key: String) throws -> TileflowBoundingBox? {
    guard let value = present(key) else { return nil }
    guard let numbers = (value as? [Any])?.compactMap(BridgeObject.number), numbers.count == 4,
      numbers.allSatisfy(\.isFinite)
    else { throw error(key, "[west, south, east, north]") }
    return TileflowBoundingBox(
      west: numbers[0], south: numbers[1], east: numbers[2], north: numbers[3])
  }

  /// A string-to-string object, such as region metadata.
  func optionalStringMap(_ key: String) throws -> [String: String]? {
    guard let value = present(key) else { return nil }
    guard let map = value as? [String: Any] else { throw error(key, "an object of strings") }
    return try map.mapValues { item in
      guard let text = item as? String else { throw error(key, "an object of strings") }
      return text
    }
  }

  static func number(_ value: Any) -> Double? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
      return nil
    }
    return number.doubleValue
  }

  static func position(_ value: Any, path: String) throws -> TileflowPosition {
    guard let numbers = (value as? [Any])?.compactMap(number), numbers.count == 2,
      numbers.allSatisfy(\.isFinite)
    else { throw BridgeArgumentError(path: path, expected: "[longitude, latitude]") }
    return TileflowPosition(longitude: numbers[0], latitude: numbers[1])
  }

  static func positions(_ values: [Any], path: String) throws -> [TileflowPosition] {
    try values.enumerated().map { index, value in
      try position(value, path: "\(path)[\(index)]")
    }
  }
}

/// Converts SDK values into Foundation objects for JavaScript.
///
/// Stored properties become keys, with acronyms written as words (`queryID` → `queryId`,
/// `isEUCountry` → `isEuCountry`); absent optionals are left out; positions are
/// `[longitude, latitude]`, boxes `[west, south, east, north]`, dates milliseconds since the
/// epoch, closed ranges `[lower, upper]` and string-backed values their raw value.
enum BridgeJSON {
  static func encode(_ value: Any) -> Any? {
    let mirror = Mirror(reflecting: value)
    if mirror.displayStyle == .optional {
      guard let wrapped = mirror.children.first?.value else { return nil }
      return encode(wrapped)
    }
    switch value {
    case let value as String: return value
    case let value as Bool: return value
    case let value as Int: return value
    case let value as Int64: return NSNumber(value: value)
    case let value as Double: return value.isFinite ? value : nil
    case let value as Date: return (value.timeIntervalSince1970 * 1000).rounded()
    case let value as URL: return value.absoluteString
    case let value as TileflowPosition: return [value.longitude, value.latitude]
    case let value as TileflowBoundingBox: return [value.west, value.south, value.east, value.north]
    case let value as ClosedRange<Int>: return [value.lowerBound, value.upperBound]
    case let value as any RawRepresentable:
      if let raw = value.rawValue as? String { return raw }
    default: break
    }
    switch mirror.displayStyle {
    case .collection, .set:
      // Absent elements stay as null so that positions in a list keep their index.
      return mirror.children.map { encode($0.value) ?? NSNull() }
    case .dictionary:
      var result: [String: Any] = [:]
      for child in mirror.children {
        let pair = Array(Mirror(reflecting: child.value).children)
        guard pair.count == 2, let key = pair[0].value as? String else { continue }
        result[key] = encode(pair[1].value) ?? NSNull()
      }
      return result
    case .enum:
      guard let payload = mirror.children.first else { return "\(value)" }
      var result = (encode(payload.value) as? [String: Any]) ?? [:]
      result["type"] = payload.label
      return result
    default:
      var result: [String: Any] = [:]
      for child in mirror.children {
        guard let label = child.label, let encoded = encode(child.value) else { continue }
        result[key(label)] = encoded
      }
      return result
    }
  }

  /// A Swift property name as JavaScript names it: runs of capitals are words (`ID` → `Id`).
  static func key(_ name: String) -> String {
    let characters = Array(name)
    var result = ""
    var index = 0
    while index < characters.count {
      guard characters[index].isUppercase else {
        result.append(characters[index])
        index += 1
        continue
      }
      var end = index
      while end < characters.count, characters[end].isUppercase { end += 1 }
      // In "EUCountry" the last capital starts the next word.
      let followedByWord = end < characters.count && characters[end].isLowercase
      let acronymEnd = followedByWord && end - index > 1 ? end - 1 : end
      let acronym = characters[index..<acronymEnd]
      result.append(index == 0 ? String(acronym).lowercased() : acronym.first!.uppercased())
      if index > 0 { result += String(acronym.dropFirst()).lowercased() }
      index = acronymEnd
    }
    return result
  }
}
