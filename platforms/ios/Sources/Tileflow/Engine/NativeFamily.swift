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

  /// Reads the family that belongs to the selected style. Hosted discovery binds its bytes by SHA-256.
  @MainActor
  static func load(
    _ manifest: NativeManifest, styleURL: URL, loader: any ResourceLoading,
    style: [String: Any]? = nil, theme: String? = nil,
    mismatch: (URL) -> Void = { _ in }
  ) async -> NativeFamily? {
    guard let url = manifest.familyURL(styleURL: styleURL),
      let payload = try? await loader.load(URLRequest(url: url)),
      payload.status == 200
    else { return nil }
    let bound = (style?["metadata"] as? [String: Any])?["tileflow:nativeFamilySha256"] as? String
    let revisions = [manifest.family?.revision, bound].compactMap { $0 }
    if !revisions.isEmpty {
      let digest = ResourceDigest.sha256(payload.bytes)
      if revisions.contains(where: { $0 != digest }) {
        mismatch(url)
        return nil
      }
    }
    guard let document = try? JSONDecoder().decode(JSONValue.self, from: payload.bytes) else {
      return nil
    }
    guard let family = NativeFamily(document) else { return nil }
    if let theme, let style, !family.matches(manifest, theme: theme, style: style) {
      mismatch(url)
      return nil
    }
    return family
  }

  /// Older styles have no family digest. Check the plan's physical layers against the style
  /// before giving it to the renderer. Core may split one original layer into several copies.
  func matches(_ manifest: NativeManifest, theme: String, style: [String: Any]) -> Bool {
    let names = themes.compactMap { $0["name"]?.string }
    guard document["map"]?.string == manifest.map, names.count == themes.count,
      names.count == manifest.styles.count, Set(names) == Set(manifest.styles.keys),
      let index = index(of: theme), let layers = style["layers"] as? [[String: Any]]
    else { return false }
    let byID = Dictionary(
      layers.compactMap { layer in (layer["id"] as? String).map { ($0, layer) } },
      uniquingKeysWith: { first, _ in first })
    for group in groups {
      guard let members = group["themes"]?.array, members.allSatisfy({
        guard let number = $0.number else { return false }
        return number >= 0 && number < Double(themes.count) && number.rounded() == number
      }) else { return false }
      if !members.contains(.number(Double(index))) { continue }
      guard let planned = group["layers"]?.array, !planned.isEmpty else { return false }
      var originals = Set<String>()
      for layer in planned {
        guard let id = layer["id"]?.string else { return false }
        let original = byID[id] == nil
          ? id.replacingOccurrences(of: #"::(?:branch|theme)-[0-9]+$"#, with: "", options: .regularExpression)
          : id
        guard let base = byID[original], ["type", "source", "source-layer"].allSatisfy({
          layer[$0]?.string == base[$0] as? String
        }) else { return false }
        originals.insert(original)
      }
      if originals != Set(byID.keys) { return false }
    }
    return true
  }

  /// Core's route inks for a colour scheme, for maps without a family document.
  static func defaultRouteInks(_ scheme: String) -> JSONValue {
    let dark = scheme == "dark"
    return .object([
      "line": .string(dark ? "#60a5fa" : "#2563eb"),
      "casing": .string(dark ? "#0b1220" : "#1e3a8a"),
      "core": .string("#eff6ff"), "glow": .string(dark ? "#60a5fa" : "#2563eb"),
      "alternative": .string("#64748b"), "glowOpacity": .number(dark ? 0.4 : 0.16),
      "coreOpacity": .number(dark ? 0.7 : 0),
    ])
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
