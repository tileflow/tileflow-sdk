import CoreLocation
import Foundation
import MapLibre
import TileflowStyleBridge

extension NativeRuntimeStyle {
  static func identifier(_ value: JSONValue) -> String? {
    if let number = value.number { return TileflowFeature.text(number) }
    return value.string
  }

  func applyState(
    sourceID id: String, sourceLayer: String, feature: String, values: [String: JSONValue],
    in style: MLNStyle
  ) throws {
    let properties = values.mapValues(\.foundation)
    let ok: Bool
    switch style.source(withIdentifier: sourceID(id)) {
    case let geoJSON as MLNShapeSource where sourceLayer.isEmpty:
      ok = geoJSON.setFeatureState(featureID: feature, state: properties)
    case let vector as MLNVectorTileSource where !sourceLayer.isEmpty:
      ok = vector.setFeatureState(sourceLayerID: sourceLayer, featureID: feature, state: properties)
    default: throw TileflowMapError.invalidRequest
    }
    guard ok else { throw TileflowMapError.invalidRequest }
    pendingState.insert(StateTarget(source: id, layer: sourceLayer, feature: feature))
  }

  /// The style can contain a source one frame before the renderer creates its render source.
  /// MapLibre accepts a state write in that interval and drops it. Verify against the renderer
  /// on its next frame and retry only targets whose state has not reached it yet.
  func confirmState(in style: MLNStyle) {
    // The setter requests a frame itself. Let that frame confirm without requesting another
    // while a source is unused; adding a layer or moving the camera will draw again.
    let last = stateRetriedLastFrame
    stateRetriedLastFrame.removeAll(keepingCapacity: true)
    for target in pendingState {
      let key = RuntimeStyle.stateKey(target.source, target.layer)
      guard let values = states[key]?[target.feature], !values.isEmpty else {
        pendingState.remove(target)
        continue
      }
      let current: [String: Any]?
      switch style.source(withIdentifier: sourceID(target.source)) {
      case let source as MLNShapeSource:
        current = source.featureState(featureID: target.feature)
      case let source as MLNVectorTileSource:
        current = source.featureState(sourceLayerID: target.layer, featureID: target.feature)
      default: continue
      }
      if let current,
        values.allSatisfy({ current[$0.key].map(JSONValue.init(foundation:)) == $0.value })
      {
        pendingState.remove(target)
      } else if !last.contains(target) {
        stateRetriedLastFrame.insert(target)
        try? applyState(
          sourceID: target.source, sourceLayer: target.layer, feature: target.feature,
          values: values, in: style)
      }
    }
  }

  func changeState(_ method: MapEngineCommand, request: JSONValue, style: MLNStyle?) throws {
    guard let id = request["source"]?.string, let source = sources[id] else {
      throw TileflowMapError.invalidRequest
    }
    let layer = request["sourceLayer"]?.string ?? ""
    guard
      (source.spec["type"] == .string("geojson") && layer.isEmpty)
        || (source.spec["type"] == .string("vector") && !layer.isEmpty)
    else { throw TileflowMapError.invalidRequest }
    let target = RuntimeStyle.stateKey(id, layer)
    let feature = request["id"].flatMap(Self.identifier)
    if method == .setFeatureState {
      guard let feature, case .object(let values) = request["state"] else {
        throw TileflowMapError.invalidRequest
      }
      if let style {
        try applyState(
          sourceID: id, sourceLayer: layer, feature: feature, values: values, in: style)
      }
      states[target, default: [:]][feature, default: [:]].merge(values) { $1 }
    } else {
      let key = request["key"]?.string
      if let style {
        switch style.source(withIdentifier: sourceID(id)) {
        case let geo as MLNShapeSource:
          if let feature, let key {
            _ = geo.removeFeatureState(featureID: feature, stateKey: key)
          } else if let feature {
            _ = geo.removeFeatureState(featureID: feature)
          } else {
            _ = geo.resetFeatureStates()
          }
        case let vector as MLNVectorTileSource:
          if let feature, let key {
            _ = vector.removeFeatureState(sourceLayerID: layer, featureID: feature, stateKey: key)
          } else if let feature {
            _ = vector.removeFeatureState(sourceLayerID: layer, featureID: feature)
          } else {
            _ = vector.resetFeatureStates(sourceLayerID: layer)
          }
        default: throw TileflowMapError.invalidRequest
        }
      }
      if let feature, let key {
        states[target]?[feature]?.removeValue(forKey: key)
      } else if let feature {
        states[target]?.removeValue(forKey: feature)
      } else {
        states.removeValue(forKey: target)
      }
    }
  }

  private func wire(
    _ feature: any MLNFeature, source: String, sourceLayer: String? = nil, layer: String? = nil
  ) -> JSONValue {
    let json = JSONValue(foundation: feature.geoJSONDictionary())
    let id = json["id"] ?? .null
    let state =
      Self.identifier(id).flatMap { states[RuntimeStyle.stateKey(source, sourceLayer)]?[$0] } ?? [:]
    var result: [String: JSONValue] = [
      "source": .string(source), "id": id, "geometry": json["geometry"] ?? .null,
      "properties": json["properties"] ?? .object([:]), "state": .object(state),
    ]
    if let sourceLayer { result["sourceLayer"] = .string(sourceLayer) }
    if let layer { result["layer"] = .string(layer) }
    return .object(result)
  }

  func queryCluster(_ request: JSONValue, style: MLNStyle) throws -> JSONValue {
    guard let id = request["source"]?.string, let value = request["cluster"]?.number,
      let number = UInt32(exactly: value),
      let source = style.source(withIdentifier: sourceID(id)) as? MLNShapeSource,
      sources[id]?.spec["cluster"]?.bool == true
    else { throw TileflowMapError.invalidRequest }
    let cluster = MLNPointFeatureCluster()
    cluster.attributes = ["cluster": true, "cluster_id": NSNumber(value: number), "point_count": 1]
    cluster.identifier = NSNumber(value: number)
    let zoom = source.zoomLevel(forExpanding: cluster)
    guard zoom >= 0 else { throw TileflowMapError.invalidRequest }
    switch request["query"]?.string {
    case "children": return .array(source.children(of: cluster).map { wire($0, source: id) })
    case "leaves":
      let limit = UInt(request["limit"]?.number ?? 10)
      let offset = UInt(request["offset"]?.number ?? 0)
      return .array(
        source.leaves(of: cluster, offset: offset, limit: limit).map { wire($0, source: id) })
    case "expansionZoom": return .number(zoom)
    default: throw TileflowMapError.invalidRequest
    }
  }

  func querySource(_ request: JSONValue, style: MLNStyle) throws -> JSONValue {
    guard let id = request["source"]?.string, let item = sources[id],
      let source = style.source(withIdentifier: sourceID(id))
    else { throw TileflowMapError.invalidRequest }
    let predicate = try request["filter"].map(Self.predicate)
    let limit = Int(request["limit"]?.number ?? 1000)
    var results: [JSONValue] = []
    var seen = Set<String>()
    func append(_ features: [any MLNFeature], layer: String?) {
      for feature in features where results.count < limit {
        if let identity = feature.identifier.map({ String(describing: $0) }),
          !seen.insert((layer ?? "") + "\n" + identity).inserted
        {
          continue
        }
        results.append(wire(feature, source: id, sourceLayer: layer))
      }
    }
    if let geo = source as? MLNShapeSource {
      append(geo.features(matching: predicate), layer: nil)
    } else if let vector = source as? MLNVectorTileSource {
      let requested =
        request["sourceLayers"]?.array?.compactMap(\.string)
        ?? Array(
          Set(
            (item.spec["vector_layers"]?.array?.compactMap { $0["id"]?.string } ?? [])
              + layers.filter { $0.json["source"] == .string(id) }.compactMap {
                $0.json["source-layer"]?.string
              })
        ).sorted()
      for name in requested where results.count < limit {
        append(vector.features(sourceLayerIdentifiers: [name], predicate: predicate), layer: name)
      }
    }
    return .array(results)
  }

  func queryRendered(_ request: JSONValue, map: MLNMapView, style: MLNStyle) throws -> JSONValue {
    let selected = request["layers"]?.array?.compactMap(\.string).map(layerID)
    let predicate = try request["filter"].map(Self.predicate)
    let limit = Int(request["limit"]?.number ?? 1000)
    let geometry = request["geometry"]
    let point = try geometry?["point"].map(NativeMapEngine.point)
    let polygon = try geometry?["polygon"]?.array?.map(NativeMapEngine.point)
    let corners = try geometry?["box"]?.array?.map(NativeMapEngine.point)
    let requestedBounds =
      (polygon ?? corners).map { points in
        points.reduce(CGRect.null) { $0.union(CGRect(origin: $1, size: .zero)) }
      } ?? map.bounds
    let bounds = requestedBounds.intersection(map.bounds)
    guard !bounds.isNull else { return .array([]) }
    let bands: [CGRect]
    if point == nil, map.camera.pitch >= 60, bounds.height > 64 {
      bands = stride(from: bounds.minY, to: bounds.maxY, by: 64).map { y in
        CGRect(x: bounds.minX, y: y, width: bounds.width, height: min(64, bounds.maxY - y))
      }
    } else {
      bands = [bounds]
    }
    let byID = Dictionary(uniqueKeysWithValues: layers.map { (layerID($0.id), $0) })
    var results: [JSONValue] = []
    for native in style.layers.reversed()
    where selected?.contains(native.identifier) != false && native.isVisible {
      guard let layer = byID[native.identifier], let source = layer.json["source"]?.string else {
        continue
      }
      var seen = Set<String>()
      var anonymousGeometries = Set<Data>()
      for band in bands {
        let features: [any MLNFeature]
        if let point {
          features = map.visibleFeatures(
            at: point, styleLayerIdentifiers: [native.identifier], predicate: predicate)
        } else {
          features = map.visibleFeatures(
            in: band, styleLayerIdentifiers: [native.identifier], predicate: predicate)
        }
        for feature in features {
          if let id = feature.identifier.map({ String(describing: $0) }), !seen.insert(id).inserted
          {
            continue
          }
          if bands.count > 1, feature.identifier == nil {
            let key = try JSONSerialization.data(
              withJSONObject: feature.geoJSONDictionary(), options: .sortedKeys)
            guard anonymousGeometries.insert(key).inserted else { continue }
          }
          let value = wire(
            feature, source: source, sourceLayer: layer.json["source-layer"]?.string,
            layer: layer.id)
          if let polygon, let shape = value["geometry"],
            !Self.intersects(polygon, geometry: shape, map: map)
          {
            continue
          }
          results.append(value)
          if results.count == limit { return .array(results) }
        }
      }
    }
    return .array(results)
  }

  /// MapLibre Darwin queries point or rectangle. Clip the candidate geometries to the screen polygon.
  private static func intersects(_ screen: [CGPoint], geometry: JSONValue, map: MLNMapView) -> Bool
  {
    func point(_ value: JSONValue) -> CGPoint? {
      guard let pair = value.array, pair.count >= 2, let lng = pair[0].number,
        let lat = pair[1].number
      else { return nil }
      return map.convert(CLLocationCoordinate2D(latitude: lat, longitude: lng), toPointTo: map)
    }
    func cross(_ a: CGPoint, _ b: CGPoint, _ c: CGPoint) -> CGFloat {
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
    }
    func edges(_ points: [CGPoint], closed: Bool) -> [(CGPoint, CGPoint)] {
      guard let first = points.first, let last = points.last else { return [] }
      return Array(zip(points, points.dropFirst()))
        + (closed && first != last ? [(last, first)] : [])
    }
    func inside(_ p: CGPoint, _ ring: [CGPoint]) -> Bool {
      var hit = false
      for (a, b) in edges(ring, closed: true) {
        if (a.y > p.y) != (b.y > p.y), p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
          hit.toggle()
        }
      }
      return hit
    }
    let boundary = edges(screen, closed: true)
    func line(_ points: [CGPoint], closed: Bool) -> Bool {
      if points.contains(where: { inside($0, screen) }) { return true }
      for (a, b) in edges(points, closed: closed) {
        for (c, d) in boundary {
          guard max(a.x, b.x) >= min(c.x, d.x), max(c.x, d.x) >= min(a.x, b.x),
            max(a.y, b.y) >= min(c.y, d.y), max(c.y, d.y) >= min(a.y, b.y)
          else { continue }
          if cross(a, b, c) * cross(a, b, d) <= 0, cross(c, d, a) * cross(c, d, b) <= 0 {
            return true
          }
        }
      }
      return false
    }
    func polygon(_ coords: JSONValue) -> Bool {
      let rings = coords.array?.compactMap { $0.array?.compactMap(point) } ?? []
      guard let outer = rings.first else { return false }
      return rings.contains { line($0, closed: true) }
        || screen.contains { p in inside(p, outer) && !rings.dropFirst().contains { inside(p, $0) }
        }
    }
    let coords = geometry["coordinates"] ?? .null
    switch geometry["type"]?.string {
    case "Point": return point(coords).map { inside($0, screen) } ?? false
    case "MultiPoint":
      return coords.array?.compactMap(point).contains { inside($0, screen) } ?? false
    case "LineString": return line(coords.array?.compactMap(point) ?? [], closed: false)
    case "MultiLineString":
      return coords.array?.contains { line($0.array?.compactMap(point) ?? [], closed: false) }
        ?? false
    case "Polygon": return polygon(coords)
    case "MultiPolygon": return coords.array?.contains(where: polygon) ?? false
    case "GeometryCollection":
      return geometry["geometries"]?.array?.contains { intersects(screen, geometry: $0, map: map) }
        ?? false
    default: return false
    }
  }
}
