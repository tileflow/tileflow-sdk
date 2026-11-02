import Foundation

/// A map's family document (`kind: tileflow-native-family`): every theme's route inks, sun and
/// emphasis table, and blend plans for the whole family, which the native evaluators fill.
struct NativeFamily: Sendable {
  let document: JSONValue
  let themes: [JSONValue]
  let groups: [JSONValue]

  init?(_ document: JSONValue) {
    guard document["kind"]?.string == "tileflow-native-family",
      document["schemaVersion"]?.number == 1, let themes = document["themes"]?.array,
      !themes.isEmpty
    else { return nil }
    self.document = document
    self.themes = themes
    groups = document["blend"]?["groups"]?.array ?? []
  }

  func index(of theme: String) -> Int? {
    themes.firstIndex { $0["name"]?.string == theme }
  }

  func theme(_ name: String) -> JSONValue? {
    index(of: name).map { themes[$0] }
  }

  /// The blend group that holds every named theme, and the selection: each theme's index in the
  /// group's themes, in blend order. Nil when the themes cannot blend.
  func blend(_ names: [String]) -> (group: Int, selection: [Int])? {
    let indices = names.compactMap(index(of:))
    guard indices.count == names.count else { return nil }
    for (number, group) in groups.enumerated() {
      let members = (group["themes"]?.array ?? []).compactMap { $0.number.map { Int($0) } }
      let selection = indices.compactMap { members.firstIndex(of: $0) }
      if selection.count == indices.count { return (number, selection) }
    }
    return nil
  }

  /// The route inks of one theme, or of a blend at a position.
  func routeInks(_ names: [String], position: Double = 0) -> JSONValue? {
    let inks = names.compactMap { theme($0)?["routeInks"] }
    guard inks.count == names.count else { return nil }
    return NativeEvaluators.at(inks, position: position, mix: NativeEvaluators.mixRouteInks)
  }
}

extension JSONValue {
  /// A Foundation JSON value (`JSONSerialization`), with booleans kept apart from numbers.
  init(foundation value: Any) {
    switch value {
    case let number as NSNumber:
      self =
        CFGetTypeID(number) == CFBooleanGetTypeID()
        ? .bool(number.boolValue) : .number(number.doubleValue)
    case let text as String: self = .string(text)
    case let array as [Any]: self = .array(array.map(JSONValue.init(foundation:)))
    case let object as [String: Any]: self = .object(object.mapValues(JSONValue.init(foundation:)))
    default: self = .null
    }
  }

  /// The value as `JSONSerialization` and MapLibre's JSON expressions take it.
  var foundation: Any {
    switch self {
    case .null: NSNull()
    case .bool(let value): NSNumber(value: value)
    case .number(let value): NSNumber(value: value)
    case .string(let value): value
    case .array(let values): values.map(\.foundation)
    case .object(let values): values.mapValues(\.foundation)
    }
  }
}
