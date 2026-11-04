import Foundation
import Tileflow

/// Converts offline store arguments and answers between JavaScript objects and the SDK's types.
enum OfflineBridge {
  // MARK: Options

  static func options(_ value: Any?) throws -> TileflowOfflineRegionLoadOptions {
    let options = try BridgeObject(value, path: "options")
    return TileflowOfflineRegionLoadOptions(
      geometry: try geometry(options.object("geometry")),
      content: try content(options.object("content")),
      minZoom: try options.optionalInt("minZoom") ?? 0,
      maxZoom: try options.optionalInt("maxZoom") ?? 15,
      terrainMaxZoom: try options.optionalInt("terrainMaxZoom") ?? 12,
      networkRestriction: try options.choice(
        "networkRestriction", TileflowOfflineNetworkRestriction.self) ?? .none,
      metadata: try options.optionalStringMap("metadata") ?? [:])
  }

  static func geometry(_ geometry: BridgeObject) throws -> TileflowOfflineGeometry {
    switch try geometry.string("type") {
    case "boundingBox":
      return .boundingBox(
        TileflowBoundingBox(
          west: try geometry.double("west"), south: try geometry.double("south"),
          east: try geometry.double("east"), north: try geometry.double("north")))
    case "corridor":
      return .corridor(line: try geometry.positions("line"), width: try geometry.double("width"))
    default:
      // Any other type is a GeoJSON geometry, which the SDK reads and validates.
      let text = String(
        data: try JSONSerialization.data(withJSONObject: geometry.values), encoding: .utf8)!
      return try TileflowOfflineGeometry(geoJSON: text)
    }
  }

  static func content(_ content: BridgeObject) throws -> TileflowOfflineContent {
    switch try content.string("type") {
    case "hosted":
      return .hosted(mapID: try content.string("mapId"), themes: try content.strings("themes"))
    case "manifest":
      guard let url = URL(string: try content.string("url")) else {
        throw BridgeArgumentError(path: "\(content.path).url", expected: "a URL")
      }
      let sources = try content.array("sources").enumerated().map { index, value in
        let source = try BridgeObject(value, path: "\(content.path).sources[\(index)]")
        return TileflowOfflineTileSource(
          id: try source.string("id"), template: try source.string("template"),
          minZoom: try source.optionalInt("minZoom") ?? 0, maxZoom: try source.int("maxZoom"))
      }
      return .manifest(url: url, map: try content.string("map"), sources: sources)
    default:
      throw BridgeArgumentError(path: "\(content.path).type", expected: "hosted or manifest")
    }
  }

  static func encode(_ options: TileflowOfflineRegionLoadOptions) -> [String: Any] {
    let geometry: [String: Any]
    switch options.geometry {
    case .boundingBox(let box):
      geometry = [
        "type": "boundingBox", "west": box.west, "south": box.south, "east": box.east,
        "north": box.north,
      ]
    case .geometry(let value): geometry = encode(value)
    case .geometryCollection(let values):
      geometry = ["type": "GeometryCollection", "geometries": values.map(encode)]
    case .corridor(let line, let width):
      geometry = [
        "type": "corridor", "line": line.map { [$0.longitude, $0.latitude] }, "width": width,
      ]
    }
    let content: [String: Any]
    switch options.content {
    case .hosted(let mapID, let themes):
      content = ["type": "hosted", "mapId": mapID, "themes": themes]
    case .manifest(let url, let map, let sources):
      content = [
        "type": "manifest", "url": url.absoluteString, "map": map,
        "sources": sources.map {
          ["id": $0.id, "template": $0.template, "minZoom": $0.minZoom, "maxZoom": $0.maxZoom]
        },
      ]
    }
    return [
      "geometry": geometry, "content": content, "minZoom": options.minZoom,
      "maxZoom": options.maxZoom, "terrainMaxZoom": options.terrainMaxZoom,
      "networkRestriction": options.networkRestriction.rawValue, "metadata": options.metadata,
    ]
  }

  static func encode(_ geometry: TileflowGeometry) -> [String: Any] {
    func position(_ coordinate: TileflowCoordinate) -> [Double] {
      [coordinate.longitude, coordinate.latitude]
    }
    switch geometry {
    case .point(let point): return ["type": "Point", "coordinates": position(point)]
    case .multiPoint(let points):
      return ["type": "MultiPoint", "coordinates": points.map(position)]
    case .lineString(let line): return ["type": "LineString", "coordinates": line.map(position)]
    case .multiLineString(let lines):
      return ["type": "MultiLineString", "coordinates": lines.map { $0.map(position) }]
    case .polygon(let rings):
      return ["type": "Polygon", "coordinates": rings.map { $0.map(position) }]
    case .multiPolygon(let polygons):
      return [
        "type": "MultiPolygon", "coordinates": polygons.map { $0.map { $0.map(position) } },
      ]
    }
  }

  // MARK: Answers

  static func encode(_ region: TileflowOfflineRegion) -> [String: Any] {
    var result: [String: Any] = [
      "id": region.id, "options": encode(region.options), "state": region.state.rawValue,
      "isAvailable": region.isAvailable, "requiredPackCount": region.requiredPackCount,
      "completedPackCount": region.completedPackCount,
      "requiredResourceCount": region.requiredResourceCount,
      "completedResourceCount": region.completedResourceCount,
      "completedResourceBytes": NSNumber(value: region.completedResourceBytes),
      "loadedResourceCount": region.loadedResourceCount,
      "loadedResourceBytes": NSNumber(value: region.loadedResourceBytes),
      "billableResourceCount": region.billableResourceCount,
    ]
    if let bytes = region.requiredResourceBytes {
      result["requiredResourceBytes"] = NSNumber(value: bytes)
    }
    if let error = region.error { result["error"] = info(error) }
    if let date = region.retryDate { result["retryDate"] = milliseconds(date) }
    if let date = region.completedAt { result["completedAt"] = milliseconds(date) }
    if let date = region.checkedAt { result["checkedAt"] = milliseconds(date) }
    if let date = region.expiresAt { result["expiresAt"] = milliseconds(date) }
    switch region.updateState {
    case .current: result["updateState"] = ["type": "current"]
    case .updateAvailable: result["updateState"] = ["type": "updateAvailable"]
    case .notUpdatable(let reason):
      result["updateState"] = ["type": "notUpdatable", "reason": reason]
    case nil: break
    }
    switch region.expiryState {
    case .valid: result["expiryState"] = ["type": "valid"]
    case .gracePeriod(let endsAt):
      result["expiryState"] = ["type": "gracePeriod", "endsAt": milliseconds(endsAt)]
    case .expired: result["expiryState"] = ["type": "expired"]
    case nil: break
    }
    return result
  }

  static func encode(_ estimate: TileflowOfflineRegionEstimate) -> [String: Any] {
    BridgeJSON.encode(estimate) as? [String: Any] ?? [:]
  }

  static func encode(_ event: TileflowOfflineRegionEvent) -> [String: Any] {
    switch event {
    case .changed(let region): ["type": "changed", "region": encode(region)]
    case .removed(let id): ["type": "removed", "id": id]
    case .warning(let warning):
      ["type": "warning", "code": warning.code.rawValue, "message": warning.message]
    }
  }

  // MARK: Errors

  static func info(_ error: TileflowOfflineError) -> [String: Any] {
    var info: [String: Any] = ["code": error.code.rawValue, "recoverable": error.isRecoverable]
    if let reason = error.context.reason { info["reason"] = reason }
    if let status = error.context.status { info["status"] = status }
    if let limit = error.context.limit { info["limit"] = limit }
    if let retryAfter = error.retryAfter { info["retryAfter"] = (retryAfter * 1000).rounded() }
    return info
  }

  static func failure(_ error: Error) -> BridgeFailure {
    switch error {
    case let error as BridgeArgumentError:
      return BridgeFailure(
        code: "invalidOptions", message: error.description,
        info: ["code": "invalidOptions", "recoverable": false, "reason": error.description])
    case let error as TileflowOfflineError:
      return BridgeFailure(code: error.code.rawValue, message: error.description, info: info(error))
    default:
      return BridgeFailure(
        code: "unavailable", message: "Tileflow offline store failed",
        info: ["code": "unavailable", "recoverable": true])
    }
  }

  private static func milliseconds(_ date: Date) -> Double {
    (date.timeIntervalSince1970 * 1000).rounded()
  }
}
