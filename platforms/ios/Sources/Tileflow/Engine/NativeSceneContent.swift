import Foundation
import MapLibre
import TileflowStyleBridge
import UIKit

/// Scene-owned overlays and symbols use the runtime style machinery in their own name spaces.
@MainActor
final class NativeSceneContent {
  struct Overlay {
    let id: String
    let definition: JSONValue
    let digest: String
    let source: NativeRuntimeStyle.Source
    var progress: JSONValue?
  }

  unowned let engine: NativeMapEngine
  private var overlays = NativeRuntimeStyle(.overlays)
  private var markers = NativeRuntimeStyle(.markers)
  private var items: [String: Overlay] = [:]
  private var overlayDefinitions: [JSONValue] = []
  private var markerDefinitions: [JSONValue] = []
  private var markerImages: [String: UIImage] = [:]
  private var inks: JSONValue?

  init(_ engine: NativeMapEngine) { self.engine = engine }
  var style: MLNStyle? { engine.styleLoaded ? engine.mapView?.style : nil }

  func restore(in style: MLNStyle) throws {
    try refreshInks()
    for registry in [overlays, markers] {
      configure(registry)
      try registry.restore(in: style)
    }
  }

  private func configure(_ registry: NativeRuntimeStyle) {
    registry.configure(
      theme: engine.shown?.theme, metadata: engine.document?.style["metadata"] as? [String: Any])
  }

  /// Returns whether the overlays changed. A pin edit leaves installed layers and their active
  /// line animations alone. Data-channel handles are temporary; compare their verified digests.
  func setContent(_ request: JSONValue, data: DataChannel) throws -> Bool {
    guard let definitions = request["overlays"]?.array else {
      throw TileflowMapError.invalidRequest
    }
    let normalized: [JSONValue] = try definitions.map { json in
      guard case .object(var fields) = json, let handle = json["data"]?["id"]?.string,
        let reference = data.reference(handle), reference.wireValue == json["data"]
      else { throw TileflowMapError.invalidRequest }
      fields["data"] = .string(reference.sha256)
      return .object(fields)
    }
    guard normalized != overlayDefinitions else { return false }
    let next = NativeRuntimeStyle(.overlays)
    configure(next)
    var desired: [String: Overlay] = [:]
    for json in definitions {
      guard let id = json["id"]?.string, desired[id] == nil,
        let digest = json["data"]?["sha256"]?.string,
        let ref = json["data"]?["id"]?.string, let payload = data.payload(ref)
      else { throw TileflowMapError.invalidRequest }
      let old = items[id]
      let measured = json["progress"] != nil
      let source: NativeRuntimeStyle.Source
      if let old, old.digest == digest, (old.definition["progress"] != nil) == measured {
        source = old.source
      } else {
        guard let geometry = try? JSONDecoder().decode(JSONValue.self, from: payload.bytes),
          Self.validCollection(geometry)
        else { throw TileflowMapError(.invalidRequest, reason: .invalidGeoJSON) }
        source = try NativeRuntimeStyle.inlineSource(
          id, bytes: payload.bytes, lineMetrics: measured)
      }
      let progress =
        json["progress"] == old?.definition["progress"] ? old?.progress : json["progress"]
      let overlay = Overlay(
        id: id, definition: json, digest: digest, source: source, progress: progress)
      try next.addSource(source, in: nil)
      try next.modifyLayer(.addLayer, request: layer(overlay, inks: engine.routeInks), style: nil)
      desired[id] = overlay
    }
    if let style { try overlays.replace(with: next, in: style) }
    overlays = next
    items = desired
    if items.values.contains(where: { ($0.definition["occludedOpacity"]?.number ?? 0) > 0 }) {
      warnOcclusion()
    }
    inks = engine.routeInks
    overlayDefinitions = normalized
    return true
  }

  private static func validCollection(_ value: JSONValue) -> Bool {
    func box(_ value: JSONValue?) -> Bool {
      guard let value else { return true }
      guard let array = value.array, [4, 6].contains(array.count),
        array.allSatisfy({ $0.number != nil })
      else { return false }
      return true
    }
    func validProperty(_ value: JSONValue, depth: Int) -> Bool {
      switch value {
      case .array(let values):
        return depth < 64 && values.allSatisfy { validProperty($0, depth: depth + 1) }
      case .object(let values):
        return depth < 64 && values.values.allSatisfy { validProperty($0, depth: depth + 1) }
      default: return true
      }
    }
    func pos(_ v: JSONValue) -> Bool {
      guard let a = v.array, [2, 3].contains(a.count), let x = a[0].number, let y = a[1].number
      else { return false }
      return (-180...180).contains(x) && (-90...90).contains(y)
        && (a.count == 2 || a[2].number != nil)
    }
    func list(_ v: JSONValue, _ min: Int, _ check: (JSONValue) -> Bool) -> Bool {
      guard let a = v.array else { return false }
      return a.count >= min && a.allSatisfy(check)
    }
    func ring(_ v: JSONValue) -> Bool { list(v, 4, pos) && v.array?.first == v.array?.last }
    func polygon(_ v: JSONValue) -> Bool { list(v, 1, ring) }
    guard case .object(let collection) = value,
      Set(collection.keys).isSubset(of: ["type", "bbox", "features"]),
      value["type"] == .string("FeatureCollection"), box(value["bbox"]),
      let features = value["features"]?.array
    else { return false }
    for feature in features {
      guard case .object(let f) = feature,
        Set(f.keys).isSubset(of: ["type", "properties", "bbox", "geometry", "id"]),
        f["type"] == .string("Feature"), box(f["bbox"]),
        let geometry = f["geometry"]
      else { return false }
      if let id = f["id"] {
        switch id {
        case .string(let text) where text.utf16.count <= 128: break
        case .number(let number)
        where Int64(exactly: number) != nil && abs(number) <= 9_007_199_254_740_991: break
        default: return false
        }
      }
      switch f["properties"] {
      case .object(let values):
        guard values.allSatisfy({ $0.key.utf16.count <= 128 && validProperty($0.value, depth: 0) })
        else { return false }
      case .some(.null): break
      default: return false
      }
      if geometry == .null { continue }
      guard case .object(let g) = geometry,
        Set(g.keys).isSubset(of: ["type", "coordinates", "bbox"]), box(g["bbox"]),
        let coords = g["coordinates"]
      else { return false }
      let valid: Bool
      switch g["type"]?.string {
      case "Point": valid = pos(coords)
      case "MultiPoint": valid = list(coords, 0, pos)
      case "LineString": valid = list(coords, 2, pos)
      case "MultiLineString": valid = list(coords, 0, { list($0, 2, pos) })
      case "Polygon": valid = polygon(coords)
      case "MultiPolygon": valid = list(coords, 0, polygon)
      default: valid = false
      }
      if !valid { return false }
    }
    return true
  }

  private func layer(_ overlay: Overlay, inks: JSONValue) -> JSONValue {
    let d = overlay.definition
    let id = overlay.id
    let kind = d["kind"]?.string ?? "line"
    let ink = d["ink"]?.string
    let color = ink.flatMap { inks[$0]?.string } ?? d["color"]?.string ?? "#e9573f"
    let opacity = (d["opacity"]?.number ?? 1) * (ink.flatMap { inks[$0 + "Opacity"]?.number } ?? 1)
    var paint: [String: JSONValue] = [
      kind + "-color": .string(color), kind + "-opacity": .number(opacity),
    ]
    var layer: [String: JSONValue] = [
      "type": .string(kind), "id": .string(id), "source": .string(id),
    ]
    if kind == "circle" { paint["circle-radius"] = d["size"] }
    if kind == "line" {
      layer["layout"] = .object(["line-join": .string("round"), "line-cap": .string("round")])
      paint["line-width"] = d["size"]
      if let state = overlay.progress {
        paint["line-gradient"] = Self.gradient(
          state, color: color, highlight: d["progress"]?["highlight"]?.string ?? color)
        paint["line-opacity"] = .number(opacity * (state["opacity"]?.number ?? 1))
      }
    }
    layer["paint"] = .object(paint)
    var result = ["layer": JSONValue.object(layer)]
    if d["placement"] == .string("ground") { result["slot"] = .string("below-labels") }
    return .object(result)
  }

  /// The same ordered colour stops as Core's tileflowLineProgressGradient.
  static func gradient(_ state: JSONValue, color: String, highlight: String) -> JSONValue {
    let start = state["start"]?.number ?? 0
    let end = max(start, state["end"]?.number ?? 1)
    let epsilon = 0.0005
    let transparent = "rgba(0, 0, 0, 0)"
    var expression: [JSONValue] = [
      .string("interpolate"), .array([.string("linear")]), .array([.string("line-progress")]),
    ]
    var last: Double = -1
    func stop(_ at: Double, _ color: String) {
      guard (0...1).contains(at), at > last else { return }
      expression += [.number(at), .string(color)]
      last = at
    }
    if end - start < epsilon {
      stop(0, transparent)
      stop(1, transparent)
      return .array(expression)
    }
    if start > 0 { stop(start - epsilon, transparent) }
    stop(start, color)
    if let light = state["light"]?.number, light > start, light <= end {
      stop(max(start, light - 0.04), color)
      stop(light, highlight)
      if light < end { stop(min(end, light + 0.014), color) }
    }
    if end < 1 {
      stop(max(start, end - 0.04), color)
      stop(end, highlight)
      stop(end + epsilon, transparent)
    } else {
      stop(end, color)
    }
    return .array(expression)
  }

  func refreshInks() throws {
    let next = engine.routeInks
    guard next != inks else { return }
    for item in items.values where item.definition["ink"] != nil {
      try overlays.modifyLayer(.updateLayer, request: layer(item, inks: next), style: style)
    }
    inks = next
  }

  func progress(for ids: [String]) throws -> [String: JSONValue] {
    var result: [String: JSONValue] = [:]
    for id in ids {
      guard let state = items[id]?.progress else {
        throw TileflowMapError(.invalidRequest, reason: .unknownLayer)
      }
      result[id] = state
    }
    return result
  }

  func applyProgress(_ values: [String: JSONValue]) throws {
    for (id, value) in values {
      guard var item = items[id], item.progress != nil else {
        throw TileflowMapError(.invalidRequest, reason: .unknownLayer)
      }
      item.progress = value
      try overlays.modifyLayer(
        .updateLayer, request: layer(item, inks: engine.routeInks), style: style)
      items[id] = item
    }
  }

  func setMarkers(_ definitions: [JSONValue]) throws {
    let next = NativeRuntimeStyle(.markers)
    configure(next)
    var usedImages: [String: UIImage] = [:]
    for marker in definitions {
      guard let id = marker["id"]?.string, let name = marker["image"]?.string,
        let image = engine.runtimeStyle.images[name]?.base, let size = marker["size"]?.array,
        let width = size.first?.number, let height = size.last?.number,
        let lng = marker["coordinate"]?["longitude"]?.number,
        let lat = marker["coordinate"]?["latitude"]?.number
      else { throw TileflowMapError(.invalidRequest, reason: .invalidImage) }
      usedImages[name] = image
      if width == 0 || height == 0 { continue }
      let ground = marker["alignment"] == .string("ground")
      let sprite = "__tileflow_depth_image_" + id
      let span = max(width, height)
      let pixels = max(image.size.width * image.scale, image.size.height * image.scale)
      let sizeInPixels = CGSize(
        width: max(1, (pixels * width / span).rounded()),
        height: max(1, (pixels * height / span).rounded()))
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      let texture = UIGraphicsImageRenderer(size: sizeInPixels, format: format).image { _ in
        image.withRenderingMode(.alwaysOriginal).draw(in: CGRect(origin: .zero, size: sizeInPixels))
      }
      next.images[sprite] = .init(base: texture, variants: [:])
      let coordinate: [Double] = [lng, lat]
      let data = try JSONSerialization.data(withJSONObject: [
        "type": "Feature", "id": id, "properties": [:],
        "geometry": ["type": "Point", "coordinates": coordinate],
      ])
      try next.addSource(NativeRuntimeStyle.inlineSource(id, bytes: data), in: nil)
      let scale = span / pixels
      let mapScale = scale * 512 / (40_075_016.68557849 * max(0.00001, cos(lat * .pi / 180)))
      let iconSize: JSONValue =
        ground
        ? .array([
          .string("interpolate"), .array([.string("exponential"), .number(2)]),
          .array([.string("zoom")]), .number(0), .number(mapScale), .number(24),
          .number(mapScale * 16_777_216),
        ]) : .number(scale)
      var layout: [String: JSONValue] = [
        "icon-image": .string(sprite), "icon-size": iconSize, "icon-allow-overlap": .bool(true),
        "icon-ignore-placement": .bool(true),
        "icon-anchor": marker["anchor"] ?? .string("center"),
        "icon-rotate": marker["rotation"] ?? .number(0),
        "icon-pitch-alignment": .string(ground ? "map" : "viewport"),
        "icon-rotation-alignment": .string(ground ? "map" : "viewport"),
      ]
      if !ground, let offset = marker["offset"]?.array {
        layout["icon-offset"] = .array(offset.map { .number(($0.number ?? 0) / scale) })
      }
      let symbol: JSONValue = .object([
        "type": .string("symbol"), "id": .string(id), "source": .string(id),
        "layout": .object(layout),
        "paint": .object(["icon-opacity": marker["opacity"] ?? .number(1)]),
      ])
      try next.modifyLayer(.addLayer, request: .object(["layer": symbol]), style: nil)
    }
    if let style { try markers.replace(with: next, in: style) }
    markers = next
    markerDefinitions = definitions
    markerImages = usedImages
    if definitions.contains(where: { $0["occlude"]?.bool == true }) { warnOcclusion() }
    if definitions.contains(where: { ($0["altitude"]?.number ?? 0) != 0 }),
      engine.reportedFeatures.insert("markerAltitude").inserted
    {
      engine.warnFeature(
        "markerAltitude", message: "Native maps draw elevated markers as symbols at ground level.")
    }
  }

  private func warnOcclusion() {
    if engine.reportedFeatures.insert("sceneOcclusion").inserted {
      engine.warnFeature(
        "sceneOcclusion",
        message: "Native maps draw ground overlays and markers without scene occlusion.")
    }
  }

  func imagesChanged() throws {
    guard markerImages.contains(where: { engine.runtimeStyle.images[$0.key]?.base !== $0.value })
    else { return }
    try setMarkers(
      markerDefinitions.filter {
        $0["image"]?.string.flatMap { engine.runtimeStyle.images[$0] } != nil
      })
  }
}
