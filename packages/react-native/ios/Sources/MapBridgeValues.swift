import Foundation
import Tileflow
import UIKit

/// Converts the React Native contract through the SDK's public value types.
enum MapBridgeValues {
  static func object(_ text: String) throws -> BridgeObject {
    guard text.utf8.count <= 64 * 1024 * 1024,
      let value = try? JSONSerialization.jsonObject(with: Data(text.utf8))
    else { throw BridgeArgumentError(path: "payload", expected: "a JSON object within 64 MiB") }
    return try BridgeObject(value)
  }

  static func json(_ value: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }

  static func coordinate(_ value: Any, path: String = "coordinate") throws -> TileflowCoordinate {
    let point = try BridgeObject.position(value, path: path)
    guard (-180...180).contains(point.longitude), (-90...90).contains(point.latitude) else {
      throw BridgeArgumentError(path: path, expected: "a longitude and latitude in range")
    }
    return TileflowCoordinate(point)
  }

  static func point(_ value: Any) throws -> CGPoint {
    guard let values = value as? [Any], values.count == 2,
      let x = BridgeObject.number(values[0]), let y = BridgeObject.number(values[1]),
      x.isFinite, y.isFinite
    else { throw BridgeArgumentError(path: "point", expected: "[x, y]") }
    return CGPoint(x: x, y: y)
  }

  static func bounds(_ input: BridgeObject) throws -> TileflowBounds {
    let ne = try coordinate(input.array("ne"), path: "bounds.ne")
    let sw = try coordinate(input.array("sw"), path: "bounds.sw")
    return TileflowBounds(west: sw.longitude, south: sw.latitude, east: ne.longitude, north: ne.latitude)
  }

  static func boundsJSON(_ bounds: TileflowBounds) -> [String: Any] {
    ["ne": [bounds.east, bounds.north], "sw": [bounds.west, bounds.south]]
  }

  static func padding(_ input: BridgeObject?) throws -> UIEdgeInsets {
    guard let input else { return .zero }
    let top = try input.optionalDouble("paddingTop") ?? 0
    let right = try input.optionalDouble("paddingRight") ?? 0
    let bottom = try input.optionalDouble("paddingBottom") ?? 0
    let left = try input.optionalDouble("paddingLeft") ?? 0
    guard [top, right, bottom, left].allSatisfy({ $0.isFinite && (0...8192).contains($0) }) else {
      throw BridgeArgumentError(path: "padding", expected: "finite nonnegative insets")
    }
    return UIEdgeInsets(top: top, left: left, bottom: bottom, right: right)
  }

  static func source(_ input: BridgeObject, surfaceID: String?) throws -> TileflowMapSource {
    if input.has("mapId") {
      guard Set(input.values.keys) == ["mapId"] else {
        throw BridgeArgumentError(path: "source", expected: "a Hosted mapId")
      }
      return .hosted(mapID: try input.string("mapId"), surfaceID: surfaceID ?? "mobile-map")
    }
    let allowed: Set<String> = ["map", "manifestUrl", "resourceOrigins", "allowsLoopbackHttp"]
    guard Set(input.values.keys).isSubset(of: allowed),
      let url = URL(string: try input.string("manifestUrl")), url.scheme != nil
    else { throw BridgeArgumentError(path: "source", expected: "a map and manifestUrl") }
    return TileflowMapSource(
      map: try input.string("map"), manifestURL: url,
      resourceOrigins: Set(try (input.has("resourceOrigins") ? input.strings("resourceOrigins") : []).map {
        guard let origin = URL(string: $0), origin.scheme != nil else {
          throw BridgeArgumentError(path: "resourceOrigins", expected: "absolute origins")
        }
        return origin
      }),
      allowsLoopbackHTTP: try input.bool("allowsLoopbackHttp", default: false))
  }

  static func options(_ input: BridgeObject) throws -> TileflowMapOptions {
    var value = TileflowMapOptions()
    if let quality = try input.optionalString("quality"), quality != "auto" {
      guard let parsed = TileflowQuality(rawValue: quality == "medium" ? "balanced" : quality) else {
        throw BridgeArgumentError(path: "quality", expected: "auto, low, medium or high")
      }
      value.quality = parsed
    }
    value.gestures.pan = try input.bool("scrollEnabled", default: true)
    value.gestures.zoom = try input.bool("zoomEnabled", default: true)
    value.gestures.rotate = try input.bool("rotateEnabled", default: true)
    value.gestures.pitch = try input.bool("pitchEnabled", default: true)
    value.controls.compass = try input.bool("compassEnabled", default: true) ? .adaptive : .hidden
    value.controls.scaleBar = try input.bool("scaleBarEnabled", default: false)
    if let position = try input.optionalString("attributionPosition") {
      let positions: [String: TileflowControlPosition] = [
        "topLeft": .topLeading, "topRight": .topTrailing,
        "bottomLeft": .bottomLeading, "bottomRight": .bottomTrailing,
      ]
      guard let corner = positions[position] else {
        throw BridgeArgumentError(path: "attributionPosition", expected: "a map corner")
      }
      value.controls.attributionPosition = corner
    }
    if let limits = try input.optionalObject("cameraLimits") {
      value.cameraLimits.minZoom = try limits.optionalDouble("minZoomLevel") ?? 0
      value.cameraLimits.maxZoom = try limits.optionalDouble("maxZoomLevel") ?? 24
      value.cameraLimits.bounds = try limits.optionalObject("maxBounds").map(bounds)
    }
    value.events.level = try input.choice("eventLevel", TileflowEventLevel.self) ?? .continuous
    return value
  }

  static func camera(_ input: BridgeObject) throws -> TileflowCameraUpdate {
    TileflowCameraUpdate(
      center: try input.optionalArray("centerCoordinate").map { try coordinate($0) },
      zoom: try input.optionalDouble("zoomLevel"), bearing: try input.optionalDouble("heading"),
      pitch: try input.optionalDouble("pitch"))
  }

  static func animation(_ input: BridgeObject) throws -> TileflowCameraAnimation {
    let milliseconds = try input.optionalDouble("animationDuration")
    if let milliseconds, !milliseconds.isFinite || !(0...20_000).contains(milliseconds) {
      throw BridgeArgumentError(path: "animationDuration", expected: "0 to 20000 milliseconds")
    }
    let duration = milliseconds.map { $0 / 1000 }
    switch try input.optionalString("animationMode") ?? "none" {
    case "none", "moveTo": return .none
    case "easeTo": return .ease(duration: duration ?? 0.5)
    case "linearTo": return .ease(duration: duration ?? 0.5, easing: .linear)
    case "flyTo": return .fly(TileflowFlyOptions(duration: duration))
    default: throw BridgeArgumentError(path: "animationMode", expected: "a camera animation")
    }
  }

  static func cameraJSON(_ camera: TileflowCamera) -> [String: Any] {
    ["centerCoordinate": [camera.longitude, camera.latitude], "zoomLevel": camera.zoom,
     "heading": camera.bearing, "pitch": camera.pitch]
  }

  static func cameraEvent(_ change: TileflowCameraChange, gestureActive: Bool, timestamp: Double)
    -> [String: Any]?
  {
    guard let bounds = change.bounds else { return nil }
    return [
      "properties": ["center": [change.camera.longitude, change.camera.latitude],
        "bounds": boundsJSON(bounds), "zoom": change.camera.zoom,
        "heading": change.camera.bearing, "pitch": change.camera.pitch],
      "gestures": ["isGestureActive": gestureActive], "timestamp": timestamp,
      "phase": change.phase.rawValue,
    ]
  }

  static func query(_ input: BridgeObject) throws -> TileflowQueryGeometry {
    switch try input.string("type") {
    case "view": return .view
    case "point": return .point(try point(input.array("point")))
    case "box":
      let values = try input.array("box")
      guard values.count == 4 else { throw BridgeArgumentError(path: "box", expected: "[left, top, right, bottom]") }
      let a = try point(Array(values[0...1])), b = try point(Array(values[2...3]))
      guard a.x <= b.x, a.y <= b.y else { throw BridgeArgumentError(path: "box", expected: "ordered bounds") }
      return .box(CGRect(x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y))
    case "polygon": return .polygon(try input.array("points").map(point))
    default: throw BridgeArgumentError(path: "geometry.type", expected: "point, box, polygon or view")
    }
  }

  static func filter(_ value: Any?) throws -> TileflowExpression? {
    guard let value, !(value is NSNull) else { return nil }
    return try TileflowExpression(json: json(value))
  }

  static func position(
    _ input: BridgeObject?, layerId: String? = nil, operation: String = "addLayer"
  ) throws -> TileflowLayerPosition {
    guard let input else { return .default }
    guard Set(input.values.keys).isSubset(of: ["aboveLayerId", "belowLayerId", "slotIndex", "slot"]),
      ["aboveLayerId", "belowLayerId", "slotIndex"].filter(input.has).count <= 1 else {
      throw TileflowMapError(.invalidRequest, context: .init(
        reason: "invalidLayerPosition", operation: operation, path: "position",
        layerId: layerId, slot: try input.optionalString("slot"), rule: "onePosition",
        corrections: [.init(code: "chooseOnePosition",
          message: "Choose one of aboveLayerId, belowLayerId or slotIndex.")]))
    }
    if let above = try input.optionalString("aboveLayerId") { return .above(above) }
    if let below = try input.optionalString("belowLayerId") { return .below(below) }
    if let index = try input.optionalInt("slotIndex") { return .atSlotIndex(index) }
    return .default
  }

  static func state(_ input: BridgeObject) throws -> [String: TileflowStyleValue] {
    try input.values.mapValues { value in
      switch try property(value) {
      case .null: return .null
      case .bool(let value): return .bool(value)
      case .number(let value): return .number(value)
      case .string(let value): return .string(value)
      default: throw BridgeArgumentError(path: input.path, expected: "scalar state values")
      }
    }
  }

  static func property(_ value: Any) throws -> TileflowJSON {
    if value is NSNull { return .null }
    if let number = value as? NSNumber {
      if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
      guard number.doubleValue.isFinite else { throw BridgeArgumentError(path: "number", expected: "a finite value") }
      return .number(number.doubleValue)
    }
    if let string = value as? String { return .string(string) }
    if let list = value as? [Any] { return .array(try list.map(property)) }
    if let object = value as? [String: Any] { return .object(try object.mapValues(property)) }
    throw BridgeArgumentError(path: "value", expected: "JSON")
  }

  static func feature(_ value: Any) throws -> TileflowFeature {
    let input = try BridgeObject(value)
    guard try input.string("type") == "Feature" else {
      throw BridgeArgumentError(path: "feature.type", expected: "Feature")
    }
    let id: String?
    if let value = input.values["id"], !(value is NSNull) {
      if let text = value as? String { id = text }
      else if let number = BridgeObject.number(value), number.isFinite { id = String(format: "%.15g", number) }
      else { throw BridgeArgumentError(path: "feature.id", expected: "a string or number") }
    } else { id = nil }
    return TileflowFeature(
      id: id, geometry: try input.optionalObject("geometry").map(geometry),
      properties: try (input.optionalObject("properties")?.values ?? [:]).mapValues(property))
  }

  static func geometry(_ input: BridgeObject) throws -> TileflowGeometry {
    func positions(_ value: Any) throws -> [TileflowCoordinate] {
      guard let values = value as? [Any] else { throw BridgeArgumentError(path: "coordinates", expected: "an array") }
      return try values.map { try coordinate($0) }
    }
    func lines(_ value: Any) throws -> [[TileflowCoordinate]] {
      guard let values = value as? [Any] else { throw BridgeArgumentError(path: "coordinates", expected: "an array") }
      return try values.map(positions)
    }
    let value = try input.array("coordinates")
    switch try input.string("type") {
    case "Point": return .point(try coordinate(value))
    case "MultiPoint": return .multiPoint(try positions(value))
    case "LineString": return .lineString(try positions(value))
    case "MultiLineString": return .multiLineString(try lines(value))
    case "Polygon": return .polygon(try lines(value))
    case "MultiPolygon": return .multiPolygon(try value.map(lines))
    default: throw BridgeArgumentError(path: "geometry.type", expected: "a supported GeoJSON geometry")
    }
  }

  static func geometryJSON(_ geometry: TileflowGeometry) -> [String: Any] {
    let points: ([TileflowCoordinate]) -> [[Double]] = { $0.map { [$0.longitude, $0.latitude] } }
    let type: String, coordinates: Any
    switch geometry {
    case .point(let point): type = "Point"; coordinates = [point.longitude, point.latitude]
    case .multiPoint(let values): type = "MultiPoint"; coordinates = points(values)
    case .lineString(let values): type = "LineString"; coordinates = points(values)
    case .multiLineString(let values): type = "MultiLineString"; coordinates = values.map(points)
    case .polygon(let values): type = "Polygon"; coordinates = values.map(points)
    case .multiPolygon(let values): type = "MultiPolygon"; coordinates = values.map { $0.map(points) }
    }
    return ["type": type, "coordinates": coordinates]
  }

  static func propertyJSON(_ value: TileflowJSON) -> Any {
    switch value {
    case .null: return NSNull()
    case .bool(let value): return value
    case .number(let value): return value
    case .string(let value): return value
    case .array(let values): return values.map(propertyJSON)
    case .object(let values): return values.mapValues(propertyJSON)
    }
  }

  static func stateJSON(_ values: [String: TileflowStyleValue]) -> [String: Any] {
    values.mapValues { value in
      switch value {
      case .null: return NSNull()
      case .bool(let value): return value
      case .number(let value): return value
      case .string(let value): return value
      }
    }
  }

  static func featureJSON(_ result: TileflowQueriedFeature) -> [String: Any] {
    var value: [String: Any] = ["type": "Feature", "properties": result.feature.properties.mapValues(propertyJSON),
      "geometry": result.feature.geometry.map { geometryJSON($0) as Any } ?? NSNull()]
    if let id = result.feature.id {
      if id.range(of: "^(0|[1-9][0-9]{0,14})$", options: .regularExpression) != nil, let number = Double(id) {
        value["id"] = number
      } else { value["id"] = id }
    }
    if let source = result.source { value["source"] = source }
    if let sourceLayer = result.sourceLayer { value["sourceLayer"] = sourceLayer }
    if let layer = result.layer { value["layer"] = ["id": layer] }
    if !result.state.isEmpty { value["state"] = stateJSON(result.state) }
    return value
  }

  static func touch(_ coordinate: TileflowCoordinate, point: CGPoint) -> [String: Any] {
    ["type": "Feature", "geometry": ["type": "Point", "coordinates": [coordinate.longitude, coordinate.latitude]],
      "properties": ["screenPointX": point.x, "screenPointY": point.y]]
  }

  static func failure(_ error: Error) -> BridgeFailure {
    if let error = error as? BridgeArgumentError {
      return BridgeFailure(code: "invalidRequest", message: error.description, info: ["recoverable": false])
    }
    let error = error as? TileflowMapError ?? (error is CancellationError ? .cancelled : .resourceFailed)
    var info: [String: Any] = ["recoverable": error.isRecoverable]
    var context: [String: Any] = [:]
    if let reason = error.context.reason { context["reason"] = reason }
    if let feature = error.context.feature { context["feature"] = feature }
    if let resource = error.context.resource { context["resource"] = resource.rawValue }
    if let status = error.context.status { context["status"] = status }
    if let limit = error.context.limit { context["limit"] = limit }
    if let count = error.context.count { context["count"] = count }
    if let operation = error.context.operation { context["operation"] = operation }
    if let path = error.context.path { context["path"] = path }
    if let layerId = error.context.layerId { context["layerId"] = layerId }
    if let reference = error.context.referenceLayerId { context["referenceLayerId"] = reference }
    if let rule = error.context.rule { context["rule"] = rule }
    if error.context.operation != nil {
      context["slot"] = error.context.slot as Any? ?? NSNull()
    }
    if error.context.referenceLayerId != nil {
      context["referenceSlot"] = error.context.referenceSlot as Any? ?? NSNull()
    }
    if !error.context.corrections.isEmpty {
      context["corrections"] = error.context.corrections.map { ["code": $0.code, "message": $0.message] }
    }
    if !context.isEmpty { info["context"] = context }
    let message = error.context.reason == "invalidGeoJSON" && error.context.rule == "pointFeatures"
      ? error.context.message : nil
    return BridgeFailure(code: error.code.rawValue,
      message: message ?? "Map operation failed (\(error.code.rawValue)).", info: info)
  }
}
