import Foundation
import UIKit

/// Only one edit may validate, change and roll back the view's retained style at a time.
@MainActor
final class StyleEditQueue {
  private var held = false
  private var waiting: [(id: UUID, call: CheckedContinuation<Void, any Error>)] = []

  func acquire() async throws {
    try Task.checkCancellation()
    if !held {
      held = true
      return
    }
    let id = UUID()
    try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (call: CheckedContinuation<Void, any Error>) in
        waiting.append((id, call))
      }
    } onCancel: {
      Task { @MainActor in
        if let index = self.waiting.firstIndex(where: { $0.id == id }) {
          self.waiting.remove(at: index).call.resume(throwing: CancellationError())
        }
      }
    }
    if Task.isCancelled {
      release()
      throw CancellationError()
    }
  }

  func release() {
    if waiting.isEmpty { held = false } else { waiting.removeFirst().call.resume() }
  }
}

/// The application's runtime style the view keeps, so the renderer restores it after a style
/// change and a new renderer receives it again: sources with their data and feature updates,
/// layers in order, and feature state.
struct RuntimeStyle {
  struct Source {
    let id: String
    /// The MapLibre source without its GeoJSON data.
    let spec: [String: JSONValue]
    var geoJSON: GeoJSONLog?
  }
  struct Layer {
    let id: String
    var json: JSONValue
    var slot: TileflowLayerSlot?
  }
  var sources: [Source] = []
  /// Application layers as the application arranged them, bottom to top.
  var layers: [Layer] = []
  /// Feature state by source and source layer, then by feature.
  var states: [String: [String: [String: TileflowStyleValue]]] = [:]

  static func stateKey(_ source: String, _ sourceLayer: String?) -> String {
    "\(source)\n\(sourceLayer ?? "")"
  }
}

/// A GeoJSON source's data and the feature updates since, compacted into new data in the
/// background once the updates outweigh it.
struct GeoJSONLog {
  enum Base: Equatable {
    case bytes(Data, digest: String)
    case url(URL)
    case empty
  }
  struct Update {
    var add: Data?
    var remove: [String]
  }
  var base: Base
  var updates: [Update] = []
  var updateBytes = 0
  var promoteId: String?
  /// Changes each time the data is replaced, so a compaction of older data is dropped.
  var revision = 0
  var compacting = false

  var needsCompaction: Bool {
    guard case .url = base else {
      let size: Int = if case .bytes(let data, _) = base { data.count } else { 0 }
      return !compacting && updates.count > 1 && updateBytes > max(size, 4 << 20)
    }
    return false
  }

  /// The base and updates applied in order: a FeatureCollection keyed as MapLibre keys features.
  static func compact(base: Data?, updates: [Update], promoteId: String?) -> Data? {
    var order: [String] = []
    var features: [String: Any] = [:]
    func key(_ feature: [String: Any]) -> String? {
      let id = promoteId.map { (feature["properties"] as? [String: Any])?[$0] } ?? feature["id"]
      switch id {
      case let number as NSNumber where CFGetTypeID(number) != CFBooleanGetTypeID():
        return TileflowFeature.text(number.doubleValue)
      case let text as String: return text
      default: return nil
      }
    }
    func add(_ feature: Any) -> Bool {
      guard let feature = feature as? [String: Any], let id = key(feature) else { return false }
      if features[id] == nil { order.append(id) }
      features[id] = feature
      return true
    }
    if let base {
      guard let value = try? JSONSerialization.jsonObject(with: base) as? [String: Any],
        let list = value["features"] as? [Any], list.allSatisfy(add)
      else { return nil }
    }
    for update in updates {
      let removed = Set(update.remove)
      if !removed.isEmpty {
        order.removeAll { removed.contains($0) }
        for id in removed { features.removeValue(forKey: id) }
      }
      if let added = update.add {
        guard let list = try? JSONSerialization.jsonObject(with: added) as? [Any],
          list.allSatisfy(add)
        else { return nil }
      }
    }
    let collection: [String: Any] = [
      "type": "FeatureCollection", "features": order.compactMap { features[$0] },
    ]
    return try? JSONSerialization.data(withJSONObject: collection)
  }
}

extension TileflowMapView {
  // MARK: Sources

  /// Adds a source to the application's runtime style. GeoJSON data travels over the SDK's data
  /// channel, up to 32 MiB. The source and everything drawn from it survive theme changes and a
  /// new renderer.
  public func addSource(_ source: any TileflowSource) async throws {
    let (spec, log) = try Self.sourceWire(source)
    try await addSource(.init(id: source.id, spec: spec, geoJSON: log))
  }

  /// Adds a style-spec source supplied as JSON. Inline GeoJSON uses the same data channel as a typed source.
  public func addSource(id: String, properties: [String: Any]) async throws {
    var properties = properties
    guard let type = properties["type"] as? String,
      ["geojson", "vector", "raster", "raster-dem", "image"].contains(type)
    else { throw TileflowMapError.invalidRequest }

    var log: GeoJSONLog?
    if type == "geojson" {
      let data: TileflowGeoJSONData
      switch properties.removeValue(forKey: "data") {
      case let object as [String: Any]:
        guard let type = object["type"] as? String, Self.geoJSONTypes.contains(type),
          JSONSerialization.isValidJSONObject(object)
        else { throw TileflowMapError.invalidRequest }
        data = .geoJSON(try JSONSerialization.data(withJSONObject: object))
      case let text as String:
        guard let url = URL(string: text), url.scheme != nil else {
          throw TileflowMapError.invalidRequest
        }
        data = .url(url)
      case nil: data = .empty
      default: throw TileflowMapError.invalidRequest
      }
      log = GeoJSONLog(
        base: try Self.geoJSONBase(data).0, promoteId: properties["promoteId"] as? String)
    }
    guard JSONSerialization.isValidJSONObject(properties) else {
      throw TileflowMapError.invalidRequest
    }
    try await addSource(
      .init(id: id, spec: properties.mapValues(JSONValue.init(foundation:)), geoJSON: log))
  }

  private static let geoJSONTypes: Set<String> = [
    "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon",
    "GeometryCollection", "Feature", "FeatureCollection",
  ]

  private func addSource(_ record: RuntimeStyle.Source) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    try Self.validateIdentifier(record.id)
    guard !sourceExists(record.id) else { throw TileflowMapError.invalidRequest }
    if styleEngine == nil { try engineKind.validateQueued(record) }
    try await changeStyle({ $0.sources.append(record) }) { engine in
      try await self.sendAddSource(record, through: engine)
    }
  }

  /// Removes a source no application layer draws.
  public func removeSource(_ id: String) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    guard runtimeStyle.sources.contains(where: { $0.id == id }) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownSource)
    }
    guard !runtimeStyle.layers.contains(where: { $0.json["source"]?.string == id }) else {
      throw TileflowMapError.invalidRequest
    }
    try await changeStyle({ style in
      style.sources.removeAll { $0.id == id }
      style.states = style.states.filter { !$0.key.hasPrefix("\(id)\n") }
    }) { engine in
      _ = try await engine.call(.removeSource, payload: .object(["id": .string(id)]))
    }
  }

  /// Whether the application's runtime style holds a source.
  public func sourceExists(_ id: String) -> Bool {
    runtimeStyle.sources.contains { $0.id == id }
  }

  /// Replaces a GeoJSON source's data; feature state stays with feature identifiers.
  public func setGeoJSONSourceData(_ sourceId: String, data: TileflowGeoJSONData) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    let index = try geoJSONSource(sourceId)
    let (base, _) = try Self.geoJSONBase(data)
    try await changeStyle({ style in
      let promoteId = style.sources[index].geoJSON?.promoteId
      let revision = (style.sources[index].geoJSON?.revision ?? 0) + 1
      style.sources[index].geoJSON = GeoJSONLog(
        base: base, promoteId: promoteId, revision: revision)
    }) { engine in
      let (value, references) = try Self.geoJSONWire(base, channel: engine.data)
      _ = try await engine.call(
        .setGeoJSONSourceData, payload: .object(["id": .string(sourceId), "data": value]),
        data: references)
    }
  }

  /// Adds features to a GeoJSON source, or replaces those whose identifier it holds, without
  /// sending the rest again. Each feature needs an identifier, or the source's `promoteId`.
  public func addGeoJSONSourceFeatures(sourceId: String, features: [TileflowFeature])
    async throws
  {
    try await updateFeatures(sourceId, add: features, remove: [])
  }

  /// Replaces features of a GeoJSON source by identifier.
  public func updateGeoJSONSourceFeatures(sourceId: String, features: [TileflowFeature])
    async throws
  {
    try await updateFeatures(sourceId, add: features, remove: [])
  }

  /// Removes features of a GeoJSON source by identifier; unknown identifiers are ignored.
  public func removeGeoJSONSourceFeatures(sourceId: String, featureIds: [String]) async throws {
    try await updateFeatures(sourceId, add: [], remove: featureIds)
  }

  private func updateFeatures(_ sourceId: String, add: [TileflowFeature], remove: [String])
    async throws
  {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    let index = try geoJSONSource(sourceId)
    if case .url = runtimeStyle.sources[index].geoJSON?.base { throw TileflowMapError.invalidRequest }
    guard !add.isEmpty || !remove.isEmpty else { return }
    guard remove.allSatisfy({ !$0.isEmpty && $0.count <= 128 }) else {
      throw TileflowMapError.invalidRequest
    }
    let promoteId = runtimeStyle.sources[index].geoJSON?.promoteId
    guard
      add.allSatisfy({ feature in
        promoteId.map { feature.properties[$0] != nil } ?? (feature.id != nil)
      })
    else { throw TileflowMapError.invalidRequest }
    let bytes =
      add.isEmpty
      ? nil : try JSONEncoder().encode(JSONValue.array(add.map(\.wireValue)))
    guard (bytes?.count ?? 0) <= ProtocolContract.maximumDataBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataBytes)
    }
    let update = GeoJSONLog.Update(add: bytes, remove: remove)
    try await changeStyle({ style in
      style.sources[index].geoJSON?.updates.append(update)
      style.sources[index].geoJSON?.updateBytes +=
        (bytes?.count ?? 0) + remove.reduce(0) { $0 + $1.utf8.count }
    }) { engine in
      try await self.sendUpdate(update, source: sourceId, through: engine)
    }
    compactIfNeeded(sourceId)
  }

  // MARK: Layers

  /// Adds a layer of the application's runtime style. A layer placed above or below another takes
  /// that layer's slot; otherwise it goes on top of its own slot.
  public func addLayer(_ layer: any TileflowLayer, position: TileflowLayerPosition = .default)
    async throws
  {
    try await addLayer(
      id: layer.id, json: JSONValue.encoded(layer), slot: layer.slot, position: position)
  }

  /// Adds a style-spec layer supplied as JSON, using the application's layer identifiers.
  public func addLayer(properties: [String: Any], position: TileflowLayerPosition = .default)
    async throws
  {
    let layer = try Self.styleLayer(properties)
    try await addLayer(id: layer.id, json: layer.json, slot: layer.slot, position: position)
  }

  private static func styleLayer(_ properties: [String: Any]) throws -> RuntimeStyle.Layer {
    var properties = properties
    guard JSONSerialization.isValidJSONObject(properties),
      let id = properties["id"] as? String, let type = properties["type"] as? String,
      [
        "fill", "line", "symbol", "circle", "heatmap", "fill-extrusion", "raster", "hillshade",
        "color-relief", "background",
      ].contains(type),
      type == "background" ? properties["source"] == nil : properties["source"] is String
    else { throw TileflowMapError.invalidRequest }
    var slot: TileflowLayerSlot?
    if let value = properties.removeValue(forKey: "slot") {
      guard let name = value as? String, let parsed = TileflowLayerSlot(rawValue: name) else {
        throw TileflowMapError.invalidRequest
      }
      slot = parsed
    }
    return RuntimeStyle.Layer(id: id, json: JSONValue(foundation: properties), slot: slot)
  }

  private func addLayer(
    id: String, json: JSONValue, slot: TileflowLayerSlot?, position: TileflowLayerPosition
  )
    async throws
  {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    try Self.validateIdentifier(id)
    guard !layerExists(id), runtimeStyle.layers.count < 1024 else {
      throw TileflowMapError.invalidRequest
    }
    if let source = json["source"]?.string, !sourceExists(source) {
      throw TileflowMapError(.invalidRequest, reason: .unknownSource)
    }
    var record = RuntimeStyle.Layer(id: id, json: json, slot: slot)
    let at = try insertionIndex(for: position, slot: &record.slot)
    let fixed = record
    if styleEngine == nil { try engineKind.validateQueued(fixed) }
    try await changeStyle({ $0.layers.insert(fixed, at: at) }) { engine in
      var payload: [String: JSONValue] = ["layer": json]
      if let slot = fixed.slot, position == .default { payload["slot"] = .string(slot.rawValue) }
      if let position = position.wireValue { payload["position"] = position }
      _ = try await engine.call(.addLayer, payload: .object(payload))
    }
  }

  /// Replaces a layer's definition in place; only the properties that changed reach the map.
  public func updateLayer(_ layer: any TileflowLayer) async throws {
    try await updateLayer(.init(id: layer.id, json: JSONValue.encoded(layer), slot: layer.slot))
  }

  /// Replaces the definition of an existing application layer with style-spec JSON.
  public func updateLayer(properties: [String: Any]) async throws {
    try await updateLayer(Self.styleLayer(properties))
  }

  private func updateLayer(_ layer: RuntimeStyle.Layer) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    guard let index = runtimeStyle.layers.firstIndex(where: { $0.id == layer.id }) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownLayer)
    }
    if let source = layer.json["source"]?.string, !sourceExists(source) {
      throw TileflowMapError(.invalidRequest, reason: .unknownSource)
    }
    if styleEngine == nil { try engineKind.validateQueued(layer) }
    try await changeStyle({ $0.layers[index] = layer }) { engine in
      var payload: [String: JSONValue] = ["layer": layer.json]
      if let slot = layer.slot { payload["slot"] = .string(slot.rawValue) }
      _ = try await engine.call(.updateLayer, payload: .object(payload))
    }
  }

  /// Moves a layer relative to the application's other layers; ``TileflowLayerPosition/default``
  /// puts it on top of its slot.
  public func moveLayer(_ id: String, position: TileflowLayerPosition) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    guard let index = runtimeStyle.layers.firstIndex(where: { $0.id == id }) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownLayer)
    }
    var record = runtimeStyle.layers[index]
    var rest = runtimeStyle.layers
    rest.remove(at: index)
    if case .above(let other) = position, other == id { throw TileflowMapError.invalidRequest }
    if case .below(let other) = position, other == id { throw TileflowMapError.invalidRequest }
    let at = try Self.insertionIndex(in: rest, for: position, slot: &record.slot)
    let moved = record
    try await changeStyle({ style in
      style.layers.remove(at: index)
      style.layers.insert(moved, at: at)
    }) { engine in
      var payload: [String: JSONValue] = ["id": .string(id)]
      if let wire = position.wireValue {
        payload["position"] = wire
      } else if let slot = moved.slot {
        payload["slot"] = .string(slot.rawValue)
      }
      _ = try await engine.call(.moveLayer, payload: .object(payload))
    }
  }

  public func removeLayer(_ id: String) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    guard runtimeStyle.layers.contains(where: { $0.id == id }) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownLayer)
    }
    try await changeStyle({ $0.layers.removeAll { $0.id == id } }) { engine in
      _ = try await engine.call(.removeLayer, payload: .object(["id": .string(id)]))
    }
  }

  /// Whether the application's runtime style holds a layer.
  public func layerExists(_ id: String) -> Bool {
    runtimeStyle.layers.contains { $0.id == id }
  }

  // MARK: Feature state

  /// Merges `state` into a feature's state, which layers read with `feature-state`. The state
  /// survives theme changes and a new renderer. A vector source needs its `sourceLayer`.
  public func setFeatureState(
    sourceId: String, sourceLayer: String? = nil, featureId: String,
    state: [String: TileflowStyleValue]
  ) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    guard sourceExists(sourceId) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownSource)
    }
    guard !featureId.isEmpty, featureId.count <= 128, state.count <= 64 else {
      throw TileflowMapError.invalidRequest
    }
    let key = RuntimeStyle.stateKey(sourceId, sourceLayer)
    try await changeStyle({ style in
      style.states[key, default: [:]][featureId, default: [:]].merge(state) { $1 }
    }) { engine in
      _ = try await engine.call(
        .setFeatureState,
        payload: Self.featureTarget(sourceId, sourceLayer, featureId).merging([
          "state": .object(state.mapValues(\.wireValue))
        ]) { $1 }.json)
    }
  }

  /// A feature's state, as the application set it.
  public func featureState(sourceId: String, sourceLayer: String? = nil, featureId: String)
    async throws -> [String: TileflowStyleValue]
  {
    guard !isDestroyed else { throw TileflowMapError.disposed }
    guard sourceExists(sourceId) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownSource)
    }
    return runtimeStyle.states[RuntimeStyle.stateKey(sourceId, sourceLayer)]?[featureId] ?? [:]
  }

  /// Removes one key of a feature's state, all of it, or, without a feature, the state of every
  /// feature of the source.
  public func removeFeatureState(
    sourceId: String, sourceLayer: String? = nil, featureId: String? = nil, key: String? = nil
  ) async throws {
    try await styleEdits.acquire()
    defer { styleEdits.release() }

    guard sourceExists(sourceId) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownSource)
    }
    guard key == nil || featureId != nil else { throw TileflowMapError.invalidRequest }
    let stateKey = RuntimeStyle.stateKey(sourceId, sourceLayer)
    try await changeStyle({ style in
      if let featureId, let key {
        style.states[stateKey]?[featureId]?.removeValue(forKey: key)
      } else if let featureId {
        style.states[stateKey]?.removeValue(forKey: featureId)
      } else {
        style.states.removeValue(forKey: stateKey)
      }
    }) { engine in
      var payload: [String: JSONValue] = ["source": .string(sourceId)]
      if let sourceLayer { payload["sourceLayer"] = .string(sourceLayer) }
      if let featureId { payload["id"] = TileflowFeature.wireID(featureId) }
      if let key { payload["key"] = .string(key) }
      _ = try await engine.call(.removeFeatureState, payload: .object(payload))
    }
  }

  // MARK: Queries

  /// Features the application's layers draw in part of the view, topmost first. At a steep pitch
  /// the renderer reads the view in bands, so features near the horizon are found too.
  public func queryRenderedFeatures(
    in geometry: TileflowQueryGeometry = .view,
    options: TileflowRenderedQueryOptions = .init()
  ) async throws -> [TileflowQueriedFeature] {
    guard (1...100_000).contains(options.limit) else { throw TileflowMapError.invalidRequest }
    var payload: [String: JSONValue] = ["limit": .number(Double(options.limit))]
    if let value = try geometry.wireValue() { payload["geometry"] = value }
    if let layers = options.layerIds { payload["layers"] = .array(layers.map(JSONValue.string)) }
    if let filter = options.filter { payload["filter"] = filter.json }
    return try Self.features(try await styleRenderer().call(.queryRenderedFeatures, payload: .object(payload)))
  }

  /// Features of a source in the tiles the map has loaded, whether or not they are drawn. A
  /// feature that crosses tiles is returned once when it has an identifier.
  public func querySourceFeatures(
    sourceId: String, options: TileflowSourceQueryOptions = .init()
  ) async throws -> [TileflowQueriedFeature] {
    guard (1...100_000).contains(options.limit) else { throw TileflowMapError.invalidRequest }
    var payload: [String: JSONValue] = [
      "source": .string(sourceId), "limit": .number(Double(options.limit)),
    ]
    if let layers = options.sourceLayerIds {
      payload["sourceLayers"] = .array(layers.map(JSONValue.string))
    }
    if let filter = options.filter { payload["filter"] = filter.json }
    return try Self.features(try await styleRenderer().call(.querySourceFeatures, payload: .object(payload)))
  }

  /// The clusters and points one level below a cluster of a clustering GeoJSON source.
  public func clusterChildren(sourceId: String, clusterId: Int) async throws
    -> [TileflowQueriedFeature]
  {
    try Self.features(try await cluster(sourceId, clusterId, "children"))
  }

  /// The points of a cluster, `limit` of them from `offset`.
  public func clusterLeaves(sourceId: String, clusterId: Int, limit: Int = 10, offset: Int = 0)
    async throws -> [TileflowQueriedFeature]
  {
    guard (1...100_000).contains(limit), offset >= 0 else { throw TileflowMapError.invalidRequest }
    return try Self.features(
      try await cluster(sourceId, clusterId, "leaves", ["limit": .number(Double(limit)), "offset": .number(Double(offset))]))
  }

  /// The zoom level at which a cluster splits into its children.
  public func clusterExpansionZoom(sourceId: String, clusterId: Int) async throws -> Double {
    guard let zoom = try await cluster(sourceId, clusterId, "expansionZoom").number else {
      throw TileflowMapError.rendererFailed
    }
    return zoom
  }

  // MARK: Images

  /// Adds an application image, or replaces the one of the same name, keeping the others.
  public func addImage(_ image: TileflowMapImage) async throws {
    var next = images.filter { $0.name != image.name }
    next.append(image)
    try await setImages(next)
  }

  /// Removes an application image.
  public func removeImage(_ name: String) async throws {
    try await setImages(images.filter { $0.name != name })
  }

  // MARK: Implementation

  private func cluster(
    _ sourceId: String, _ clusterId: Int, _ query: String, _ extra: [String: JSONValue] = [:]
  ) async throws -> JSONValue {
    guard clusterId >= 0 else { throw TileflowMapError.invalidRequest }
    let payload = extra.merging([
      "source": .string(sourceId), "cluster": .number(Double(clusterId)),
      "query": .string(query),
    ]) { $1 }
    return try await styleRenderer().call(.queryCluster, payload: .object(payload))
  }

  private func styleRenderer() throws -> any MapEngine {
    guard !isDestroyed else { throw TileflowMapError.disposed }
    guard let engine = readyEngine else { throw TileflowMapError.notReady }
    return engine
  }

  private static func features(_ value: JSONValue) throws -> [TileflowQueriedFeature] {
    guard case .array(let items) = value else { throw TileflowMapError.rendererFailed }
    return items.map(TileflowQueriedFeature.init(wire:))
  }

  private static func featureTarget(_ source: String, _ sourceLayer: String?, _ id: String)
    -> [String: JSONValue]
  {
    var value: [String: JSONValue] = ["source": .string(source), "id": TileflowFeature.wireID(id)]
    if let sourceLayer { value["sourceLayer"] = .string(sourceLayer) }
    return value
  }

  static func validateIdentifier(_ id: String) throws {
    guard HostedContract.matches(id, #"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$"#) else {
      throw TileflowMapError.invalidRequest
    }
  }

  private func geoJSONSource(_ id: String) throws -> Int {
    guard let index = runtimeStyle.sources.firstIndex(where: { $0.id == id }) else {
      throw TileflowMapError(.invalidRequest, reason: .unknownSource)
    }
    guard runtimeStyle.sources[index].geoJSON != nil else { throw TileflowMapError.invalidRequest }
    return index
  }

  private func insertionIndex(for position: TileflowLayerPosition, slot: inout TileflowLayerSlot?)
    throws -> Int
  {
    try Self.insertionIndex(in: runtimeStyle.layers, for: position, slot: &slot)
  }

  private static func insertionIndex(
    in layers: [RuntimeStyle.Layer], for position: TileflowLayerPosition,
    slot: inout TileflowLayerSlot?
  ) throws -> Int {
    switch position {
    case .default: return layers.count
    case .above(let id), .below(let id):
      guard let index = layers.firstIndex(where: { $0.id == id }) else {
        throw TileflowMapError(.invalidRequest, reason: .unknownLayer)
      }
      slot = layers[index].slot
      if case .above = position { return index + 1 }
      return index
    }
  }

  /// A source's MapLibre specification without its data, and the GeoJSON it starts with.
  static func sourceWire(_ source: any TileflowSource) throws -> ([String: JSONValue], GeoJSONLog?) {
    func zooms(_ value: inout [String: JSONValue], _ minZoom: Double?, _ maxZoom: Double?) {
      if let minZoom { value["minzoom"] = .number(minZoom) }
      if let maxZoom { value["maxzoom"] = .number(maxZoom) }
    }
    func tiled(_ type: String, _ tiles: TileflowTiles, _ bounds: TileflowBounds?, _ attribution: String?)
      -> [String: JSONValue]
    {
      var value: [String: JSONValue] = ["type": .string(type)]
      switch tiles {
      case .tileJSON(let url): value["url"] = .string(url.absoluteString)
      case .templates(let templates): value["tiles"] = .array(templates.map(JSONValue.string))
      }
      if let bounds {
        value["bounds"] = .array(
          [bounds.west, bounds.south, bounds.east, bounds.north].map(JSONValue.number))
      }
      if let attribution { value["attribution"] = .string(attribution) }
      return value
    }
    switch source {
    case let source as TileflowGeoJSONSource:
      var value: [String: JSONValue] = ["type": .string("geojson")]
      if let maxZoom = source.maxZoom { value["maxzoom"] = .number(maxZoom) }
      if let attribution = source.attribution { value["attribution"] = .string(attribution) }
      if let buffer = source.buffer { value["buffer"] = .number(Double(buffer)) }
      if let tolerance = source.tolerance { value["tolerance"] = .number(tolerance) }
      if let filter = source.filter { value["filter"] = filter.json }
      if source.cluster { value["cluster"] = .bool(true) }
      if let radius = source.clusterRadius { value["clusterRadius"] = .number(radius) }
      if let zoom = source.clusterMaxZoom { value["clusterMaxZoom"] = .number(zoom) }
      if let points = source.clusterMinPoints { value["clusterMinPoints"] = .number(Double(points)) }
      if !source.clusterProperties.isEmpty {
        value["clusterProperties"] = .object(source.clusterProperties.mapValues(\.json))
      }
      if source.lineMetrics { value["lineMetrics"] = .bool(true) }
      if source.generateId { value["generateId"] = .bool(true) }
      if let promoteId = source.promoteId { value["promoteId"] = .string(promoteId) }
      let (base, _) = try geoJSONBase(source.data)
      return (value, GeoJSONLog(base: base, promoteId: source.promoteId))
    case let source as TileflowVectorSource:
      var value = tiled("vector", source.tiles, source.bounds, source.attribution)
      zooms(&value, source.minZoom, source.maxZoom)
      if let promoteId = source.promoteId { value["promoteId"] = .string(promoteId) }
      return (value, nil)
    case let source as TileflowRasterSource:
      var value = tiled("raster", source.tiles, source.bounds, source.attribution)
      zooms(&value, source.minZoom, source.maxZoom)
      if let size = source.tileSize { value["tileSize"] = .number(Double(size)) }
      return (value, nil)
    case let source as TileflowRasterDEMSource:
      var value = tiled("raster-dem", source.tiles, source.bounds, source.attribution)
      zooms(&value, source.minZoom, source.maxZoom)
      if let size = source.tileSize { value["tileSize"] = .number(Double(size)) }
      if let encoding = source.encoding { value["encoding"] = .string(encoding.rawValue) }
      return (value, nil)
    case let source as TileflowImageSource:
      guard source.coordinates.count == 4 else { throw TileflowMapError.invalidRequest }
      return (
        [
          "type": .string("image"), "url": .string(source.url.absoluteString),
          "coordinates": .array(
            source.coordinates.map { .array([.number($0.longitude), .number($0.latitude)]) }),
        ], nil
      )
    default:
      throw TileflowMapError.invalidRequest
    }
  }

  static func geoJSONBase(_ data: TileflowGeoJSONData) throws -> (GeoJSONLog.Base, Int) {
    let bytes: Data
    switch data {
    case .url(let url): return (.url(url), 0)
    case .empty: return (.empty, 0)
    case .geoJSON(let value): bytes = value
    case .features(let features):
      bytes = try JSONEncoder().encode(
        JSONValue.object([
          "type": .string("FeatureCollection"), "features": .array(features.map(\.wireValue)),
        ]))
    }
    guard !bytes.isEmpty, bytes.count <= ProtocolContract.maximumDataBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataBytes)
    }
    return (.bytes(bytes, digest: DataChannel.digest(bytes)), bytes.count)
  }

  static func geoJSONWire(_ base: GeoJSONLog.Base, channel: DataChannel) throws
    -> (JSONValue, [DataChannel.Reference])
  {
    switch base {
    case .url(let url): return (.object(["url": .string(url.absoluteString)]), [])
    case .empty: return (.object(["empty": .bool(true)]), [])
    case .bytes(let bytes, let digest):
      let reference = try channel.register(bytes, digest: digest, contentType: "application/geo+json")
      return (reference.wireValue, [reference])
    }
  }

  private func sendAddSource(_ record: RuntimeStyle.Source, through engine: any MapEngine) async throws {
    var spec = record.spec
    var references: [DataChannel.Reference] = []
    if let log = record.geoJSON {
      let (value, registered) = try Self.geoJSONWire(log.base, channel: engine.data)
      spec["data"] = value
      references = registered
    }
    _ = try await engine.call(
      .addSource, payload: .object(["id": .string(record.id), "source": .object(spec)]),
      data: references)
  }

  private func sendUpdate(_ update: GeoJSONLog.Update, source: String, through engine: any MapEngine)
    async throws
  {
    var payload: [String: JSONValue] = ["id": .string(source)]
    var references: [DataChannel.Reference] = []
    if let add = update.add {
      let reference = try engine.data.register(
        add, digest: DataChannel.digest(add), contentType: "application/json")
      references.append(reference)
      payload["add"] = reference.wireValue
    }
    if !update.remove.isEmpty {
      payload["remove"] = .array(update.remove.map(TileflowFeature.wireID))
    }
    _ = try await engine.call(.updateGeoJSONSource, payload: .object(payload), data: references)
  }

  /// Keeps a change for later renderers and sends it to the current one. A change the renderer
  /// refuses is not kept.
  private func changeStyle(
    _ change: (inout RuntimeStyle) -> Void, send: (any MapEngine) async throws -> Void
  ) async throws {
    guard !isDestroyed else { throw TileflowMapError.disposed }
    let previous = runtimeStyle
    change(&runtimeStyle)
    guard let engine = styleEngine else { return }
    do {
      try await send(engine)
    } catch {
      runtimeStyle = previous
      throw error
    }
  }

  /// Folds a GeoJSON source's updates into its data in the background once they outweigh it.
  private func compactIfNeeded(_ sourceId: String) {
    guard let index = runtimeStyle.sources.firstIndex(where: { $0.id == sourceId }),
      let log = runtimeStyle.sources[index].geoJSON, log.needsCompaction
    else { return }
    runtimeStyle.sources[index].geoJSON?.compacting = true
    let base: Data? = if case .bytes(let data, _) = log.base { data } else { nil }
    let updates = log.updates
    let revision = log.revision
    let promoteId = log.promoteId
    Task { @MainActor [weak self] in
      let compacted = await Task.detached(priority: .utility) {
        GeoJSONLog.compact(base: base, updates: updates, promoteId: promoteId)
      }.value
      guard let self,
        let index = self.runtimeStyle.sources.firstIndex(where: { $0.id == sourceId }),
        var current = self.runtimeStyle.sources[index].geoJSON
      else { return }
      current.compacting = false
      if current.revision == revision, current.updates.count >= updates.count,
        let compacted, compacted.count <= ProtocolContract.maximumDataBytes
      {
        current.base = .bytes(compacted, digest: DataChannel.digest(compacted))
        current.updates.removeFirst(updates.count)
        current.updateBytes = current.updates.reduce(0) {
          $0 + ($1.add?.count ?? 0) + $1.remove.reduce(0) { $0 + $1.utf8.count }
        }
      }
      self.runtimeStyle.sources[index].geoJSON = current
    }
  }

  /// Gives a new renderer the application's runtime style: sources and their updates, layers in
  /// order, then feature state.
  func replayStyle(through engine: any MapEngine) async throws {
    try await styleEdits.acquire()
    defer {
      if readyEngine === engine { styleRestored = true }
      styleEdits.release()
    }

    let style = runtimeStyle
    for source in style.sources {
      try await sendAddSource(source, through: engine)
      for update in source.geoJSON?.updates ?? [] {
        try await sendUpdate(update, source: source.id, through: engine)
      }
    }
    for layer in style.layers {
      var payload: [String: JSONValue] = ["layer": layer.json]
      if let slot = layer.slot { payload["slot"] = .string(slot.rawValue) }
      _ = try await engine.call(.addLayer, payload: .object(payload))
    }
    var states: [JSONValue] = []
    for (key, features) in style.states {
      let parts = key.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
      for (id, state) in features where !state.isEmpty {
        states.append(
          Self.featureTarget(parts[0], parts[1].isEmpty ? nil : parts[1], id).merging([
            "state": .object(state.mapValues(\.wireValue))
          ]) { $1 }.json)
      }
    }
    // Feature state goes in groups of requests in flight, well inside the renderer's budget.
    for start in stride(from: 0, to: states.count, by: 32) {
      let calls = states[start..<min(start + 32, states.count)].map { payload in
        Task { @MainActor in _ = try await engine.call(.setFeatureState, payload: payload) }
      }
      for call in calls { try await call.value }
    }
  }
}

extension Dictionary where Key == String, Value == JSONValue {
  var json: JSONValue { .object(self) }
}
