import Foundation

/// The finalized style's semantic POI layers and field aliases, as published by Tileflow.
struct NativePoiCatalog {
  struct Layer {
    let source: String
    let sourceLayer: String?
    let representationRank: Int
    let priority: Int
  }

  enum FeatureID: Equatable {
    case number(Int64)
    case string(String)
    init?(_ value: Any?) {
      switch value.map(JSONValue.init(foundation:)) {
      case .number(let number) where abs(number) <= 9_007_199_254_740_991:
        guard let integer = Int64(exactly: number) else { return nil }
        self = .number(integer)
      case .string(let text) where !text.isEmpty && text.utf16.count <= 128:
        self = .string(text)
      default: return nil
      }
    }
    var text: String {
      switch self {
      case .number(let number): String(number)
      case .string(let text): text
      }
    }
  }

  struct Match {
    let id: FeatureID?
    let category: String
    let name: String?
    let layer: Layer

    func payload(coordinate: JSONValue) -> JSONValue {
      .object([
        "id": id.map { .string($0.text) } ?? .null, "category": .string(category),
        "name": name.map(JSONValue.string) ?? .null, "coordinate": coordinate,
      ])
    }
  }

  let layers: [String: Layer]
  private let categoryField: String
  private let nameField: String
  private static let representations = Set(["marker", "icon", "combined", "label"])
  private static let categories: Set<String> = [
    "arts-entertainment", "education", "food-drink", "landmark",
    "lodging", "medical", "park-nature", "public-services", "religion", "retail", "sport-leisure",
    "transport", "visitor-amenity",
  ]

  init?(style: [String: Any]) {
    guard let metadata = style["metadata"] as? [String: Any],
      let raw = metadata["tileflow:interaction-manifest"]
    else { return nil }
    let catalog = JSONValue(foundation: raw)
    guard catalog["version"]?.number == 3, let poi = catalog["domains"]?["poi"],
      poi["identity"]?.string == "maplibre-feature-id-if-present", let fields = poi["fields"],
      ["category", "filterRank", "icon", "name", "sizeRank", "type"].allSatisfy({
        Self.safeName(fields[$0]?.string)
      }),
      let categoryField = fields["category"]?.string, let nameField = fields["name"]?.string,
      let dedup = poi["deduplication"],
      dedup["identity"] == .array(["source", "source-layer", "feature-id"].map(JSONValue.string)),
      let priorities = dedup["representationPriority"]?.array, priorities.count == 4,
      Set(priorities.compactMap(\.string)) == Self.representations,
      poi["hitTesting"]?["frequency"]?.string == "animation-frame",
      poi["hitTesting"]?["order"]?.string == "rendered-topmost",
      let entries = poi["layers"]?.array, (1...256).contains(entries.count),
      let styleLayers = style["layers"] as? [[String: Any]]
    else { return nil }
    let styleByID = Dictionary(
      styleLayers.compactMap { layer in (layer["id"] as? String).map { ($0, layer) } },
      uniquingKeysWith: { _, last in last })
    var result: [String: Layer] = [:]
    for entry in entries {
      let sourceLayer = entry["sourceLayer"]?.string
      guard let id = entry["layerId"]?.string, Self.safeName(id), result[id] == nil,
        let source = entry["source"]?.string, Self.safeName(source),
        entry["sourceLayer"] == nil || Self.safeName(sourceLayer),
        entry["anchor"]?.string == "pointer-coordinate",
        let representation = entry["representation"],
        let rank = priorities.firstIndex(of: representation),
        let priority = entry["priority"]?.number.flatMap(Int.init(exactly:)),
        (0...100_000).contains(priority),
        let styleLayer = styleByID[id], styleLayer["source"] as? String == source,
        (styleLayer["source-layer"] == nil || styleLayer["source-layer"] is String),
        styleLayer["source-layer"] as? String == sourceLayer
      else { return nil }
      if let prior = result.values.first, prior.source != source || prior.sourceLayer != sourceLayer
      {
        return nil
      }
      result[id] = Layer(
        source: source, sourceLayer: sourceLayer, representationRank: rank, priority: priority)
    }
    self.layers = result
    self.categoryField = categoryField
    self.nameField = nameField
  }

  private static func safeName(_ text: String?) -> Bool {
    guard let text, (1...256).contains(text.utf16.count) else { return false }
    return !text.unicodeScalars.contains { $0.value <= 31 || $0.value == 127 }
  }

  /// Hits arrive in rendered order. The topmost identity wins; another representation of
  /// that same identity may supply the selection according to the style's priority.
  func consider(layer: Layer, id: Any?, properties: [String: Any], winner: inout Match?) {
    guard let category = properties[categoryField] as? String, Self.categories.contains(category)
    else { return }
    let id = FeatureID(id)
    if let prior = winner {
      guard let id, prior.id == id,
        layer.representationRank < prior.layer.representationRank
          || (layer.representationRank == prior.layer.representationRank
            && layer.priority > prior.layer.priority)
      else { return }
    }
    let name = (properties[nameField] as? String).flatMap { $0.utf16.count <= 4096 ? $0 : nil }
    winner = Match(id: id, category: category, name: name, layer: layer)
  }
}
