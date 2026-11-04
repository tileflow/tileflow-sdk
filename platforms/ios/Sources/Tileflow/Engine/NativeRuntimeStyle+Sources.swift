import CoreLocation
import Foundation
import MapLibre
import TileflowStyleBridge

extension NativeRuntimeStyle {
  static let emptyCollection = Data(#"{"type":"FeatureCollection","features":[]}"#.utf8)

  static func validateQueuedSource(_ source: RuntimeStyle.Source) throws {
    try validateSource(source.spec)
    if case .url(let url) = source.geoJSON?.base { try validateAddress(url.absoluteString) }
    if case .bytes(let bytes, _) = source.geoJSON?.base { _ = try shape(bytes) }
  }

  static func validateAddress(_ text: String) throws {
    let trimmed = text.hasPrefix("pmtiles://") ? String(text.dropFirst(10)) : text
    let resolved = MapResourceAddress.resolve(trimmed, against: "https://fixture.invalid/")
    guard !text.isEmpty,
      MapResourceAddress.encode(resolved, context: String(repeating: "a", count: 32)) != nil
    else { throw TileflowMapError.invalidRequest }
  }

  private static func validateSource(_ spec: [String: JSONValue]) throws {
    let keys = Set(spec.keys)
    let tiles: Set<String> = [
      "type", "url", "tiles", "minzoom", "maxzoom", "scheme", "bounds", "attribution",
    ]
    switch spec["type"]?.string {
    case "geojson":
      guard
        keys.isSubset(of: [
          "type", "data", "maxzoom", "minzoom", "buffer", "tolerance", "cluster", "clusterRadius",
          "clusterMaxZoom", "clusterMinPoints", "clusterProperties", "lineMetrics", "generateId",
          "promoteId", "filter", "attribution",
        ])
      else { throw TileflowMapError.invalidRequest }
      if let generate = spec["generateId"], generate.bool == nil {
        throw TileflowMapError.invalidRequest
      }
      if let promote = spec["promoteId"], promote.string?.isEmpty != false {
        throw TileflowMapError.invalidRequest
      }
      if let filter = spec["filter"] { _ = try predicate(filter) }
      _ = try shapeOptions(spec)
    case "vector", "raster", "raster-dem":
      let type = spec["type"]?.string
      let extra: Set<String> =
        type == "vector"
        ? ["encoding"] : type == "raster" ? ["tileSize"] : ["tileSize", "encoding"]
      guard keys.isSubset(of: tiles.union(extra)), (spec["url"] == nil) != (spec["tiles"] == nil),
        spec["scheme"] == nil || ["xyz", "tms"].contains(spec["scheme"]?.string),
        type != "raster-dem" || spec["encoding"] == nil
          || ["mapbox", "terrarium"].contains(spec["encoding"]?.string),
        type != "vector" || spec["encoding"] == nil
          || ["mvt", "mlt"].contains(spec["encoding"]?.string)
      else { throw TileflowMapError.invalidRequest }
      if let url = spec["url"] {
        guard let url = url.string else { throw TileflowMapError.invalidRequest }
        try validateAddress(url)
      }
      if let tiles = spec["tiles"] {
        guard let values = tiles.array, (1...16).contains(values.count) else {
          throw TileflowMapError.invalidRequest
        }
        for tile in values {
          guard let text = tile.string else { throw TileflowMapError.invalidRequest }
          try validateAddress(text)
        }
      }
      _ = try tileOptions(spec)
    case "image":
      guard keys.isSubset(of: ["type", "url", "coordinates"]), let url = spec["url"]?.string else {
        throw TileflowMapError.invalidRequest
      }
      try validateAddress(url)
      _ = try quad(spec["coordinates"])
    default: throw TileflowMapError.invalidRequest
    }
  }

  private static func shape(_ bytes: Data) throws -> MLNShape {
    guard let shape = try? MLNShape(data: bytes, encoding: String.Encoding.utf8.rawValue) else {
      throw TileflowMapError.invalidRequest
    }
    return shape
  }

  private static func shapeOptions(_ spec: [String: JSONValue]) throws -> [MLNShapeSourceOption:
    Any]
  {
    var options: [MLNShapeSourceOption: Any] = [:]
    for (key, option) in [
      ("cluster", MLNShapeSourceOption.clustered), ("lineMetrics", .lineDistanceMetrics),
    ] {
      if let value = spec[key] {
        guard let enabled = value.bool else { throw TileflowMapError.invalidRequest }
        options[option] = enabled
      }
    }
    let numeric: [(String, MLNShapeSourceOption, ClosedRange<Double>)] = [
      ("maxzoom", .maximumZoomLevel, 0...24), ("minzoom", .minimumZoomLevel, 0...24),
      ("clusterMaxZoom", .maximumZoomLevelForClustering, 0...24), ("buffer", .buffer, 0...512),
      ("clusterMinPoints", .clusterMinPoints, 2...Double(UInt32.max)),
      ("clusterRadius", .clusterRadius, 0...Double(UInt16.max)),
      ("tolerance", .simplificationTolerance, 0...Double(Float.greatestFiniteMagnitude)),
    ]
    for (key, option, range) in numeric {
      if let value = spec[key] {
        guard let number = value.number, range.contains(number) else {
          throw TileflowMapError.invalidRequest
        }
        options[option] = number
      }
    }
    if let value = spec["clusterProperties"] {
      guard case .object(let properties) = value else { throw TileflowMapError.invalidRequest }
      var clusters: [String: [NSExpression]] = [:]
      for (name, property) in properties {
        guard let args = property.array, args.count == 2 else {
          throw TileflowMapError.invalidRequest
        }
        let reduce: JSONValue =
          if let op = args[0].string {
            .array([
              .string(op), .array([.string("accumulated")]),
              .array([.string("get"), .string(name)]),
            ])
          } else { args[0] }
        guard let expression = TFStyleExpression(reduce.foundation),
          let map = TFStyleExpression(args[1].foundation)
        else { throw TileflowMapError.invalidRequest }
        clusters[name] = [expression, map]
      }
      options[.clusterProperties] = clusters
    }
    return options
  }

  private static func tileOptions(_ spec: [String: JSONValue]) throws -> [MLNTileSourceOption: Any]
  {
    var options: [MLNTileSourceOption: Any] = [:]
    for (key, option, range) in [
      ("minzoom", MLNTileSourceOption.minimumZoomLevel, 0.0...24),
      ("maxzoom", .maximumZoomLevel, 0.0...24),
      ("tileSize", .tileSize, 64.0...1024),
    ] {
      if let value = spec[key] {
        guard let number = value.number, range.contains(number), number.rounded() == number else {
          throw TileflowMapError.invalidRequest
        }
        options[option] = number
      }
    }
    if let bounds = spec["bounds"] {
      guard let coordinates = bounds.array?.compactMap(\.number), coordinates.count == 4 else {
        throw TileflowMapError.invalidRequest
      }
      let value = MLNCoordinateBounds(
        sw: CLLocationCoordinate2D(latitude: coordinates[1], longitude: coordinates[0]),
        ne: CLLocationCoordinate2D(latitude: coordinates[3], longitude: coordinates[2]))
      options[.coordinateBounds] = NSValue(mlnCoordinateBounds: value)
    }
    if spec["scheme"] == .string("tms") {
      options[.tileCoordinateSystem] = NSNumber(value: MLNTileCoordinateSystem.TMS.rawValue)
    }
    if let attribution = spec["attribution"]?.string {
      options[.attributionHTMLString] = attribution
    }
    if spec["encoding"] == .string("mlt") {
      options[.vectorTileSourceOptionEncoding] = NSNumber(
        value: MLNVectorTileSourceEncoding.MLT.rawValue)
    }
    if spec["encoding"] == .string("terrarium") {
      options[.demEncoding] = NSNumber(value: MLNDEMEncoding.terrarium.rawValue)
    }
    return options
  }

  private static func quad(_ coordinates: JSONValue?) throws -> MLNCoordinateQuad {
    guard let ring = coordinates?.array, ring.count == 4 else {
      throw TileflowMapError.invalidRequest
    }
    let points = try ring.map { point in
      guard let pair = point.array, pair.count == 2, let x = pair[0].number, let y = pair[1].number,
        (-180...180).contains(x), (-90...90).contains(y)
      else { throw TileflowMapError.invalidRequest }
      return CLLocationCoordinate2D(latitude: y, longitude: x)
    }
    return MLNCoordinateQuad(
      topLeft: points[0], bottomLeft: points[3], bottomRight: points[2], topRight: points[1])
  }

  static func makeSource(_ item: Source) throws -> MLNSource {
    let key = sourceID(item.id)
    let spec = item.spec
    let type = spec["type"]?.string
    if type == "geojson" {
      let options = try shapeOptions(spec)
      guard let shape = item.shape else { throw TileflowMapError.invalidRequest }
      var source: MLNShapeSource?
      guard
        TFStylePerform({ source = MLNShapeSource(identifier: key, shape: shape, options: options) }
        ), let source
      else { throw TileflowMapError.invalidRequest }
      return source
    }
    if type == "image" {
      guard let url = spec["url"]?.string.flatMap(URL.init(string:)) else {
        throw TileflowMapError.invalidRequest
      }
      return try MLNImageSource(
        identifier: key, coordinateQuad: quad(spec["coordinates"]), url: url)
    }
    if let config = spec["url"]?.string.flatMap(URL.init(string:)) {
      switch type {
      case "vector": return MLNVectorTileSource(identifier: key, configurationURL: config)
      case "raster":
        return MLNRasterTileSource(
          identifier: key, configurationURL: config, tileSize: spec["tileSize"]?.number ?? 512)
      case "raster-dem":
        return MLNRasterDEMSource(
          identifier: key, configurationURL: config, tileSize: spec["tileSize"]?.number ?? 512)
      default: throw TileflowMapError.invalidRequest
      }
    }
    guard let tiles = spec["tiles"]?.array?.compactMap(\.string), !tiles.isEmpty else {
      throw TileflowMapError.invalidRequest
    }
    let options = try tileOptions(spec)
    switch type {
    case "vector":
      return MLNVectorTileSource(identifier: key, tileURLTemplates: tiles, options: options)
    case "raster":
      return MLNRasterTileSource(identifier: key, tileURLTemplates: tiles, options: options)
    case "raster-dem":
      return MLNRasterDEMSource(identifier: key, tileURLTemplates: tiles, options: options)
    default: throw TileflowMapError.invalidRequest
    }
  }
}

extension NativeRuntimeStyle {
  /// Resolves external references through the map's resource policy before handing them to MapLibre.
  static func prepareSource(
    _ request: JSONValue, channel: DataChannel, styleURL: URL,
    load: @MainActor (URL) async throws -> Data,
    project: @MainActor ([String: Any], URL) async throws -> ProjectedStyle
  ) async throws -> Source {
    guard let id = request["id"]?.string, case .object(var spec) = request["source"] else {
      throw TileflowMapError.invalidRequest
    }
    try validateSource(spec)
    var item = Source(id: id, spec: spec)
    if spec["type"] == .string("geojson") {
      guard let data = spec.removeValue(forKey: "data") else {
        throw TileflowMapError.invalidRequest
      }
      item.spec = spec
      let bytes = try await geoJSONBytes(data, channel: channel, styleURL: styleURL, load: load)
      try setBytes(bytes, on: &item)
      return item
    }
    let result = try await project(["sources": [id: spec.mapValues(\.foundation)]], styleURL)
    guard
      let object = try? JSONSerialization.jsonObject(with: Data(result.json.utf8))
        as? [String: Any],
      let sources = object["sources"] as? [String: [String: Any]], let spec = sources[id]
    else { throw TileflowMapError.invalidRequest }
    for text in (spec["tiles"] as? [String] ?? []) + [spec["url"] as? String].compactMap({ $0 }) {
      let projected = text.hasPrefix("pmtiles://") ? String(text.dropFirst(10)) : text
      guard projected.hasPrefix("https://" + MapResourceAddress.host + "/") else {
        throw TileflowMapError.invalidRequest
      }
    }
    item.spec = spec.mapValues(JSONValue.init(foundation:))
    item.resourceKinds = result.kinds
    return item
  }

  static func geoJSONBytes(
    _ data: JSONValue, channel: DataChannel, styleURL: URL,
    load: @MainActor (URL) async throws -> Data
  ) async throws -> Data {
    if let id = data["id"]?.string, let payload = channel.payload(id) { return payload.bytes }
    if data["empty"]?.bool == true { return emptyCollection }
    if let text = data["url"]?.string {
      try validateAddress(text)
      guard
        let url = URL(string: MapResourceAddress.resolve(text, against: styleURL.absoluteString)),
        ["http", "https"].contains(url.scheme?.lowercased()), url.user == nil, url.password == nil
      else { throw TileflowMapError.invalidRequest }
      return try await load(url)
    }
    throw TileflowMapError.invalidRequest
  }

  private static func setBytes(_ input: Data, on source: inout Source) throws {
    var bytes = input
    let promote = source.spec["promoteId"]?.string
    let generate = source.spec["generateId"]?.bool == true
    let filter = source.spec["filter"]
    if promote != nil || generate || filter != nil {
      guard let object = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
        throw TileflowMapError.invalidRequest
      }
      var features: [[String: Any]]
      switch object["type"] as? String {
      case "FeatureCollection":
        guard let items = object["features"] as? [[String: Any]] else {
          throw TileflowMapError.invalidRequest
        }
        features = items
      case "Feature": features = [object]
      default: features = [["type": "Feature", "properties": [:], "geometry": object]]
      }
      let predicate = try filter.map { try Self.predicate($0) }
      var prepared: [[String: Any]] = []
      for (index, var feature) in features.enumerated() {
        let properties = feature["properties"] as? [String: Any] ?? [:]
        if let promote {
          feature["id"] = properties[promote]
        } else if generate && feature["id"] == nil {
          feature["id"] = index
        }
        if let predicate {
          let type = (feature["geometry"] as? [String: Any])?["type"] as? String ?? ""
          let context: [String: Any] = [
            "featureAttributes": properties,
            "featureIdentifier": feature["id"] ?? NSNull(),
            "geometryType": type.hasPrefix("Multi") ? String(type.dropFirst(5)) : type,
          ]
          var include = false
          guard
            TFStylePerform({
              include = predicate.evaluate(with: properties, substitutionVariables: context)
            })
          else { throw TileflowMapError.invalidRequest }
          if !include { continue }
        }
        prepared.append(feature)
      }
      bytes = try JSONSerialization.data(withJSONObject: [
        "type": "FeatureCollection", "features": prepared,
      ])
    }
    source.shape = try shape(bytes)
    source.features = nil
  }

  func addSource(_ item: Source, in style: MLNStyle?) throws {
    guard sources[item.id] == nil, style?.source(withIdentifier: Self.sourceID(item.id)) == nil
    else { throw TileflowMapError.invalidRequest }
    let source = try Self.makeSource(item)
    if let style, !TFStylePerform({ style.addSource(source) }) {
      throw TileflowMapError.invalidRequest
    }
    sources[item.id] = item
  }

  func replaceData(_ bytes: Data, source id: String, in style: MLNStyle?) throws {
    guard var item = sources[id], item.spec["type"] == .string("geojson") else {
      throw TileflowMapError.invalidRequest
    }
    try Self.setBytes(bytes, on: &item)
    if let style {
      guard let source = style.source(withIdentifier: Self.sourceID(id)) as? MLNShapeSource else {
        throw TileflowMapError.invalidRequest
      }
      source.shape = item.shape
    }
    sources[id] = item
  }

  /// Native shape sources replace a collection atomically. Index the shapes on the first edit so
  /// later edits reuse untouched geometries without serializing or reparsing the entire GeoJSON.
  @MainActor struct FeatureIndex {
    typealias Feature = MLNShape & MLNFeature
    var order: [String] = []
    var features: [String: Feature] = [:]

    init(_ shape: MLNShape) throws {
      if let collection = shape as? MLNShapeCollectionFeature {
        for feature in collection.shapes { try add(feature, replace: false) }
      } else if let feature = shape as? Feature {
        try add(feature, replace: false)
      } else {
        throw TileflowMapError.invalidRequest
      }
    }

    mutating func add(_ feature: Feature, replace: Bool) throws {
      guard
        let id = feature.identifier.map(JSONValue.init(foundation:)).flatMap(
          NativeRuntimeStyle.identifier),
        replace || features[id] == nil
      else { throw TileflowMapError.invalidRequest }
      if features[id] == nil { order.append(id) }
      features[id] = feature
    }
  }

  func updateFeatures(_ request: JSONValue, channel: DataChannel, in style: MLNStyle?) throws {
    guard let id = request["id"]?.string, var item = sources[id], let shape = item.shape else {
      throw TileflowMapError.invalidRequest
    }
    var index = try item.features ?? FeatureIndex(shape)
    let removed = Set((request["remove"]?.array ?? []).compactMap(Self.identifier))
    if !removed.isEmpty {
      index.order.removeAll { removed.contains($0) }
      for id in removed { index.features.removeValue(forKey: id) }
    }
    if let ref = request["add"] {
      guard let id = ref["id"]?.string, let data = channel.payload(id),
        let added = try? JSONSerialization.jsonObject(with: data.bytes) as? [[String: Any]]
      else { throw TileflowMapError.invalidRequest }
      var patch = item
      let bytes = try JSONSerialization.data(withJSONObject: [
        "type": "FeatureCollection", "features": added,
      ])
      try Self.setBytes(bytes, on: &patch)
      guard let collection = patch.shape as? MLNShapeCollectionFeature else {
        throw TileflowMapError.invalidRequest
      }
      if item.spec["filter"] != nil {
        // Replacing a previously visible feature can move it outside the source filter.
        let promote = item.spec["promoteId"]?.string
        let requested = Set(
          added.compactMap { feature -> String? in
            let value =
              promote.flatMap { (feature["properties"] as? [String: Any])?[$0] } ?? feature["id"]
            return value.map(JSONValue.init(foundation:)).flatMap(Self.identifier)
          })
        let visible = Set(
          collection.shapes.compactMap {
            $0.identifier.map(JSONValue.init(foundation:)).flatMap(Self.identifier)
          })
        let hidden = requested.subtracting(visible)
        index.order.removeAll { hidden.contains($0) }
        for id in hidden { index.features.removeValue(forKey: id) }
      }
      for feature in collection.shapes { try index.add(feature, replace: true) }
    }
    let next = MLNShapeCollectionFeature(shapes: index.order.compactMap { index.features[$0] })
    if let style {
      guard let source = style.source(withIdentifier: Self.sourceID(id)) as? MLNShapeSource else {
        throw TileflowMapError.invalidRequest
      }
      source.shape = next
    }
    item.shape = next
    item.features = index
    sources[id] = item
  }

  func removeSource(_ request: JSONValue, style: MLNStyle?) throws {
    guard let id = request["id"]?.string, sources[id] != nil,
      !layers.contains(where: { $0.json["source"]?.string == id })
    else { throw TileflowMapError.invalidRequest }
    if let style, let source = style.source(withIdentifier: Self.sourceID(id)),
      !TFStylePerform({ style.removeSource(source) })
    {
      throw TileflowMapError.invalidRequest
    }
    sources.removeValue(forKey: id)
    states = states.filter { !$0.key.hasPrefix(id + "\n") }
  }
}
