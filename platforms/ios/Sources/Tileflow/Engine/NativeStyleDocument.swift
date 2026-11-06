import Foundation

/// A style document as MapLibre Native receives it from the SDK.
struct ProjectedStyle: Sendable {
  /// The style JSON. The engine always receives a document, never a style URL.
  let json: String
  /// The attribution of each source, by source id, without empty or repeated text.
  let attributions: [String]
  /// The kind of resource behind each projected remote address, by the address's literal start.
  let kinds: [(prefix: String, kind: TileflowResourceKind)]
  /// What the engine cannot draw from this document and the projection left out, such as `text`.
  let omitted: [String]
  var boundaryLookup: BoundaryLookupDescriptor? = nil

  /// The kind of a remote resource the engine requested: the longest literal start it matches.
  func kind(of remote: URL) -> TileflowResourceKind {
    let text = remote.absoluteString
    var best: (length: Int, kind: TileflowResourceKind)?
    for entry in kinds where text.hasPrefix(entry.prefix) {
      if entry.prefix.count > best?.length ?? -1 { best = (entry.prefix.count, entry.kind) }
    }
    return best?.kind ?? .tile
  }
}

/// Projects a style document for MapLibre Native, for one mounted map.
///
/// Every TileJSON a source references by `url` is read through the map's transport and embedded,
/// because the engine would otherwise request it outside the map's context. Every address the
/// engine requests (tiles, GeoJSON data, images, `pmtiles://` archives, the sprite, glyphs and font
/// faces) becomes a ``MapResourceAddress`` with the map's context, so the SDK's transport answers
/// it. Relative addresses resolve against the style's own address first, since the engine never
/// sees that address.
///
/// When a map opens from its downloaded regions, each raster-dem source starts at the lowest zoom
/// the regions store for it: the renderer asks for every ancestor of a tile it cannot draw, and the
/// regions hold none below that zoom.
///
/// An image source that covers the whole Web Mercator world, such as Streets' climate underlay,
/// reaches the engine as a raster source whose only tile, at zoom 0, is that image
/// (``worldImageTile(_:)``).
enum NativeStyleDocument {
  /// The latitude where Web Mercator ends, north and south.
  static let mercatorLatitude = 85.0511287798066

  /// An image source that covers exactly the Web Mercator world, as a raster source whose only
  /// tile is that image; nil for any other source.
  ///
  /// MapLibre Native counts an image source as loaded only once it has drawn it, and it draws it
  /// only while one of its layers is inside its zoom range. Until then the map never finishes
  /// loading: no complete frame, no idle state, and so no `contentReady` and no theme change that
  /// waits for the new style to draw. Streets' underlay stops at zoom 11, so every map opened at
  /// city zoom waited forever. A raster source that no layer needs is complete, and its zoom-0
  /// tile covers the same extent as the image at every zoom, so the map draws the same.
  static func worldImageTile(_ source: [String: Any]) -> [String: Any]? {
    guard let url = source["url"] as? String, let corners = source["coordinates"] as? [[Any]],
      corners.count == 4
    else { return nil }
    let world: [[Double]] = [
      [-180, mercatorLatitude], [180, mercatorLatitude], [180, -mercatorLatitude],
      [-180, -mercatorLatitude],
    ]
    for (corner, expected) in zip(corners, world) {
      guard corner.count == 2 else { return nil }
      for (value, target) in zip(corner, expected) {
        guard let number = (value as? NSNumber)?.doubleValue, abs(number - target) < 1e-6 else {
          return nil
        }
      }
    }
    var tile: [String: Any] = [
      "type": "raster", "tiles": [url], "tileSize": 512, "minzoom": 0, "maxzoom": 0,
    ]
    if let attribution = source["attribution"] { tile["attribution"] = attribution }
    return tile
  }

  /// Reads a JSON document through the map's transport, or throws `resourceFailed`.
  typealias Load = (URL, TileflowResourceKind) async throws -> [String: Any]
  /// The lowest zoom the map's regions store for a tile template, when the map opens from them.
  typealias StoredZooms = @Sendable (String) async -> ClosedRange<Int>?

  static func project(
    _ document: [String: Any], styleURL: URL, context: String, load: Load,
    storedZooms: StoredZooms? = nil
  ) async throws -> ProjectedStyle {
    var style = document
    var kinds: [(prefix: String, kind: TileflowResourceKind)] = []
    let base = styleURL.absoluteString
    func address(_ url: String, base: String, kind: TileflowResourceKind) throws -> String {
      let resolved = MapResourceAddress.resolve(url, against: base)
      guard let projected = MapResourceAddress.encode(resolved, context: context) else {
        // MapLibre can turn provider aliases into network URLs after projection.
        if resolved.hasPrefix("asset://") || resolved.hasPrefix("file://")
          || resolved.hasPrefix("data:") {
          return url
        }
        throw TileflowMapError(.resourceFailed, context: .init(resource: kind))
      }
      let literal = resolved.firstIndex(of: "{").map { String(resolved[..<$0]) } ?? resolved
      kinds.append((literal, kind))
      return projected
    }

    var boundaryLookup: BoundaryLookupDescriptor?
    var attributions: [String] = []
    if var sources = style["sources"] as? [String: Any] {
      // Sources keep the document's order where it has one; JSON objects do not, so sort.
      for id in sources.keys.sorted() {
        guard var source = sources[id] as? [String: Any] else { continue }
        let type = source["type"] as? String ?? ""
        var sourceBase = base
        if ["vector", "raster", "raster-dem"].contains(type), let url = source["url"] as? String {
          if url.hasPrefix("pmtiles://") {
            let archive = String(url.dropFirst("pmtiles://".count))
            source["url"] = try "pmtiles://" + address(archive, base: base, kind: .tile)
          } else {
            let resolved = MapResourceAddress.resolve(url, against: base)
            guard let tileJSONURL = URL(string: resolved) else {
              throw TileflowMapError(.resourceFailed, context: .init(resource: .source))
            }
            let tileJSON = try await load(tileJSONURL, .source)
            if id == "tileflow-boundaries", type == "vector", source["tiles"] == nil {
              boundaryLookup = BoundaryLookupDescriptor(tileJSON: tileJSON, sourceURL: tileJSONURL)
            }
            source.removeValue(forKey: "url")
            for key in [
              "tiles", "minzoom", "maxzoom", "bounds", "scheme", "attribution", "encoding",
              "tileSize", "vector_layers", "redFactor", "greenFactor", "blueFactor", "baseShift",
            ] where source[key] == nil {
              if let value = tileJSON[key] { source[key] = value }
            }
            sourceBase = resolved
          }
        }
        if let tiles = source["tiles"] as? [String] {
          if type == "raster-dem", let storedZooms, let template = tiles.first.map({
            MapResourceAddress.resolve($0, against: sourceBase)
          }), let zooms = await storedZooms(template) {
            let minimum = (source["minzoom"] as? NSNumber)?.intValue ?? 0
            source["minzoom"] = max(minimum, zooms.lowerBound)
          }
          source["tiles"] = try tiles.map { try address($0, base: sourceBase, kind: .tile) }
        }
        if type == "geojson", let data = source["data"] as? String {
          source["data"] = try address(data, base: base, kind: .data)
        }
        if type == "image", let url = source["url"] as? String {
          source["url"] = try address(url, base: base, kind: .image)
          if let tile = worldImageTile(source) { source = tile }
        }
        if let text = source["attribution"] as? String, !text.isEmpty,
          !attributions.contains(text)
        {
          attributions.append(text)
        }
        sources[id] = source
      }
      style["sources"] = sources
    }
    if let sprite = style["sprite"] as? String {
      style["sprite"] = try address(sprite, base: base, kind: .sprite)
    } else if let sprites = style["sprite"] as? [[String: Any]] {
      style["sprite"] = try sprites.map { entry -> [String: Any] in
        var entry = entry
        if let url = entry["url"] as? String {
          entry["url"] = try address(url, base: base, kind: .sprite)
        }
        return entry
      }
    }
    if let glyphs = style["glyphs"] as? String {
      style["glyphs"] = try address(glyphs, base: base, kind: .glyphs)
    }
    if let faces = style["font-faces"] as? [String: Any] {
      style["font-faces"] = try faces.mapValues { value -> Any in
        if let url = value as? String { return try address(url, base: base, kind: .font) }
        guard let files = value as? [[String: Any]] else { return value }
        return try files.map { file -> [String: Any] in
          var file = file
          if let url = file["url"] as? String {
            file["url"] = try address(url, base: base, kind: .font)
          }
          return file
        }
      }
    }
    // Text needs glyphs or font faces. Without either (a style that draws its labels with web
    // fonts), MapLibre Native requests glyphs from an empty address and never finishes drawing,
    // so the labels are left out and the rest of the map draws.
    var omitted: [String] = []
    if style["glyphs"] == nil, style["font-faces"] == nil,
      var layers = style["layers"] as? [[String: Any]]
    {
      for index in layers.indices {
        guard layers[index]["type"] as? String == "symbol",
          var layout = layers[index]["layout"] as? [String: Any], layout["text-field"] != nil
        else { continue }
        layout.removeValue(forKey: "text-field")
        layers[index]["layout"] = layout
        if !omitted.contains("text") { omitted.append("text") }
      }
      style["layers"] = layers
    }
    let data = try JSONSerialization.data(withJSONObject: style)
    return ProjectedStyle(
      json: String(decoding: data, as: UTF8.self), attributions: attributions, kinds: kinds,
      omitted: omitted, boundaryLookup: boundaryLookup)
  }
}
