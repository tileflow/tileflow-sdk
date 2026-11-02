import Foundation

@testable import Tileflow

/// Turns a style document into the one the engine receives: every TileJSON referenced by `url` is
/// read through the resource loader and embedded, and every resource address (tiles, sprite,
/// glyphs, font faces, GeoJSON data, images) becomes a transport address with the map's context.
/// Relative addresses resolve against the style's own address first, because the engine receives
/// the document itself, never its URL.
struct StyleProjection {
  enum ResourceClass: String {
    case tile, sprite, glyphs, fontFace, data, image
  }

  let context: String
  let loader: any ResourceLoading
  private(set) var classes: [String: ResourceClass] = [:]
  private(set) var embeddedTileJSON: [String] = []

  init(context: String, loader: any ResourceLoading) {
    self.context = context
    self.loader = loader
  }

  /// Reads a JSON document through the loader.
  static func document(_ url: URL, loader: any ResourceLoading) async throws -> [String: Any] {
    let payload = try await loader.load(URLRequest(url: url))
    guard payload.status == 200,
      let value = try JSONSerialization.jsonObject(with: payload.bytes) as? [String: Any]
    else {
      throw NSError(
        domain: "StyleProjection", code: payload.status,
        userInfo: [NSLocalizedDescriptionKey: "\(url.absoluteString) answered \(payload.status)"])
    }
    return value
  }

  mutating func project(_ style: [String: Any], styleURL: URL) async throws -> [String: Any] {
    var style = style
    let base = styleURL.absoluteString
    if let sprite = style["sprite"] as? String {
      style["sprite"] = address(sprite, base: base, as: .sprite)
    } else if let sprites = style["sprite"] as? [[String: Any]] {
      style["sprite"] = sprites.map { item -> [String: Any] in
        var item = item
        if let url = item["url"] as? String { item["url"] = address(url, base: base, as: .sprite) }
        return item
      }
    }
    if let glyphs = style["glyphs"] as? String {
      style["glyphs"] = address(glyphs, base: base, as: .glyphs)
    }
    if let faces = style["font-faces"] as? [String: Any] {
      var projected: [String: Any] = [:]
      for (name, value) in faces {
        if let url = value as? String {
          projected[name] = address(url, base: base, as: .fontFace)
        } else if let files = value as? [[String: Any]] {
          projected[name] = files.map { file -> [String: Any] in
            var file = file
            if let url = file["url"] as? String {
              file["url"] = address(url, base: base, as: .fontFace)
            }
            return file
          }
        } else {
          projected[name] = value
        }
      }
      style["font-faces"] = projected
    }
    if var sources = style["sources"] as? [String: Any] {
      for (id, value) in sources {
        guard var source = value as? [String: Any] else { continue }
        var sourceBase = base
        if let url = source["url"] as? String,
          ["vector", "raster", "raster-dem"].contains(source["type"] as? String ?? "")
        {
          let resolved = Self.resolve(url, base: base)
          guard let tilejsonURL = URL(string: resolved) else { continue }
          let tilejson = try await Self.document(tilejsonURL, loader: loader)
          embeddedTileJSON.append(resolved)
          source.removeValue(forKey: "url")
          for key in [
            "tiles", "minzoom", "maxzoom", "bounds", "scheme", "attribution", "encoding",
            "tileSize", "vector_layers", "redFactor", "blueFactor", "greenFactor", "baseShift",
          ] where source[key] == nil {
            if let item = tilejson[key] { source[key] = item }
          }
          sourceBase = resolved
        }
        if let tiles = source["tiles"] as? [String] {
          source["tiles"] = tiles.map { address($0, base: sourceBase, as: .tile) }
        }
        if source["type"] as? String == "geojson", let data = source["data"] as? String {
          source["data"] = address(data, base: base, as: .data)
        }
        if source["type"] as? String == "image", let url = source["url"] as? String {
          source["url"] = address(url, base: base, as: .image)
        }
        sources[id] = source
      }
      style["sources"] = sources
    }
    return style
  }

  private mutating func address(_ url: String, base: String, as resourceClass: ResourceClass)
    -> String
  {
    let resolved = Self.resolve(url, base: base)
    guard let projected = TransportAddress.encode(resolved, context: context) else { return url }
    classes[projected] = resourceClass
    return projected
  }

  /// Resolves `url` against `base`, keeping engine placeholders such as `{z}` intact.
  static func resolve(_ url: String, base: String) -> String {
    if url.range(of: "^[A-Za-z][A-Za-z0-9+.-]*://", options: .regularExpression) != nil {
      return url
    }
    let escaped = url.replacingOccurrences(of: "{", with: "%7B")
      .replacingOccurrences(of: "}", with: "%7D")
    guard let resolved = URL(string: escaped, relativeTo: URL(string: base))?.absoluteString
    else { return url }
    return resolved.replacingOccurrences(of: "%7B", with: "{")
      .replacingOccurrences(of: "%7D", with: "}")
  }

  static func json(_ style: [String: Any]) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: style), as: UTF8.self)
  }
}
