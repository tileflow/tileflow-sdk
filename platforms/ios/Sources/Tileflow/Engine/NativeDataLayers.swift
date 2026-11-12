import Foundation

/// Declarative data replaces only named GeoJSON data; the authored source keeps its options.
struct NativeDataLayers: Sendable, Equatable {
  let sources: [String: JSONValue]
  let overlays: [String: JSONValue]

  init(_ value: JSONValue = .object([:])) throws {
    guard case .object(let fields) = value,
      case .object(let sources) = fields["dataSources"] ?? .object([:]),
      case .object(let overlays) = fields["dataOverlays"] ?? .object([:])
    else { throw TileflowMapError.invalidRequest }
    self.sources = sources
    self.overlays = overlays
  }

  @MainActor
  static func wire(_ input: JSONValue, channel: MapPayloadStore) throws -> (
    JSONValue, [MapPayloadStore.Reference]
  ) {
    guard case .object(var value) = input,
      case .object(var sources) = value["dataSources"]
    else { throw TileflowMapError.invalidRequest }
    var references: [MapPayloadStore.Reference] = []
    do {
      for (id, definition) in sources {
        guard case .object(var source) = definition, source["dataReference"] == nil,
          let data = source["data"]
        else { throw TileflowMapError.invalidRequest }
        if case .string = data { continue }
        guard case .object = data else { throw TileflowMapError.invalidRequest }
        let bytes = try JSONEncoder().encode(data)
        let reference = try channel.register(
          bytes, digest: ResourceDigest.sha256(bytes), contentType: "application/geo+json")
        references.append(reference)
        source.removeValue(forKey: "data")
        source["dataReference"] = reference.wireValue
        sources[id] = .object(source)
      }
      value["dataSources"] = .object(sources)
      return (.object(value), references)
    } catch {
      channel.release(references)
      throw error
    }
  }

  @MainActor
  static func decode(
    _ input: JSONValue, channel: MapPayloadStore, references: [MapPayloadStore.Reference]
  ) throws -> JSONValue {
    guard case .object(var value) = input,
      case .object(var sources) = value["dataSources"]
    else { throw TileflowMapError.invalidRequest }
    for (id, definition) in sources {
      guard case .object(var source) = definition else { throw TileflowMapError.invalidRequest }
      guard let reference = source.removeValue(forKey: "dataReference") else { continue }
      guard source["data"] == nil, let key = reference["id"]?.string,
        references.contains(where: { $0.id == key && $0.wireValue == reference }),
        let payload = channel.payload(key)
      else { throw TileflowMapError.invalidRequest }
      source["data"] = try JSONDecoder().decode(JSONValue.self, from: payload.bytes)
      sources[id] = .object(source)
    }
    value["dataSources"] = .object(sources)
    return .object(value)
  }

  func applying(to style: [String: Any]) throws -> [String: Any] {
    var result = style
    var sourceValues = style["sources"] as? [String: Any] ?? [:]
    var layers = style["layers"] as? [[String: Any]] ?? []
    let originalIds = Set(layers.compactMap { $0["id"] as? String })
    let metadata = style["metadata"] as? [String: Any] ?? [:]
    let placement = metadata["tileflow:overlay-placement-manifest"] as? [String: Any]
    let anchors = placement?["anchors"] as? [String: String] ?? [:]
    let font = layers.compactMap { ($0["layout"] as? [String: Any])?["text-font"] as? [String] }
      .first { !$0.isEmpty && !$0.contains { $0.hasPrefix("tileflow-line-background") } }

    for id in sources.keys.sorted() {
      guard case .object(var value) = sources[id],
        value.removeValue(forKey: "kind") == .string("geojson"),
        let data = value["data"]
      else { throw TileflowMapError.invalidRequest }
      if var existing = sourceValues[id] as? [String: Any] {
        guard existing["type"] as? String == "geojson" else {
          throw TileflowMapError.invalidRequest
        }
        existing["data"] = data.foundation
        sourceValues[id] = existing
      } else {
        value["type"] = .string("geojson")
        sourceValues[id] = JSONValue.object(value).foundation
      }
    }

    var added = Set<String>()
    for id in overlays.keys.sorted() {
      guard let overlay = overlays[id], overlay["kind"]?.string == "maplibre-overlay",
        let source = overlay["source"]?.string, sourceValues[source] != nil,
        let slot = overlay["placement"]?.string,
        [
          "above-water", "below-roads", "above-roads", "above-buildings", "below-labels",
          "above-labels",
        ].contains(slot),
        let definitions = overlay["layers"]?.array
      else { throw TileflowMapError.invalidRequest }
      for definition in definitions {
        guard var layer = definition.foundation as? [String: Any],
          let layerId = layer["id"] as? String,
          layer["type"] is String, !layerId.isEmpty
        else { throw TileflowMapError.invalidRequest }
        if originalIds.contains(layerId) { continue }
        guard added.insert(layerId).inserted else { throw TileflowMapError.invalidRequest }
        layer["source"] = source
        let cluster = (layer["metadata"] as? [String: Any])?["tileflow:cluster"] as? [String: Any]
        if cluster?["role"] as? String == "count" {
          var layout = layer["layout"] as? [String: Any] ?? [:]
          if layout["text-font"] == nil {
            guard let font else { throw TileflowMapError.invalidRequest }
            layout["text-font"] = font
            layer["layout"] = layout
          }
        }
        let index = anchors[slot].flatMap { anchor in
          layers.firstIndex { $0["id"] as? String == anchor }
        }
        layers.insert(layer, at: index ?? layers.count)
      }
    }
    result["sources"] = sourceValues
    result["layers"] = layers
    return result
  }
}
