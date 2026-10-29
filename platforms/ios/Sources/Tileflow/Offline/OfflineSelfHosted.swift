import Foundation

/// Resolves what a self-hosted style needs besides tiles.
enum OfflineSelfHosted {
  /// Glyph ranges as renderers request them: 256 code points each, up to U+FFFF.
  static let glyphRanges = (0..<256).map { "\($0 * 256)-\($0 * 256 + 255)" }
  /// The font stack renderers use for text without `text-font`.
  static let defaultFontStack = ["Open Sans Regular", "Arial Unicode MS Regular"]

  static func validate(_ sources: [TileflowOfflineTileSource]) throws {
    var ids = Set<String>()
    for source in sources {
      guard !source.id.isEmpty, ids.insert(source.id).inserted,
        tileURL(source.template, z: 0, x: 0, y: 0) != nil,
        (0...OfflineZooms.maximum).contains(source.minZoom), source.minZoom <= source.maxZoom
      else { throw TileflowOfflineError.options("invalidSource") }
    }
  }

  static func validate(manifest url: URL, map: String) throws {
    guard ["https", "http"].contains(url.scheme), url.host != nil else {
      throw TileflowOfflineError.options("invalidManifestURL")
    }
    guard !map.isEmpty, map.count <= 128 else { throw TileflowOfflineError.options("invalidMap") }
  }

  /// The map's theme styles, and the manifest with the font files its themes name, as absolute
  /// URLs.
  static func manifest(_ url: URL, data: Data, map: String) throws -> (
    styles: [URL], documents: [URL]
  ) {
    guard let manifest = try? JSONDecoder().decode(JSONValue.self, from: data),
      case .object(let themes) = manifest["maps"]?[map]?["themes"]
    else {
      throw TileflowOfflineError(.invalidResponse, context: .init(reason: "invalidManifest"))
    }
    var styles: [URL] = []
    var documents = [url]
    for name in themes.keys.sorted() {
      guard let theme = themes[name] else { continue }
      if let style = theme["styleUrl"]?.string.flatMap({ resolve($0, against: url) }),
        !styles.contains(style)
      {
        styles.append(style)
      }
      documents += fontFiles(theme["fontFaces"], against: url)
    }
    guard !styles.isEmpty else {
      throw TileflowOfflineError(.invalidResponse, context: .init(reason: "invalidManifest"))
    }
    return (styles, documents)
  }

  /// The style, the font files and source documents it names, its sprite sheets at 1x and 2x, and
  /// every glyph range of the font stacks its layers name literally, as absolute URLs.
  static func documents(style url: URL, data: Data) throws -> [URL] {
    guard let style = try? JSONDecoder().decode(JSONValue.self, from: data),
      case .object = style
    else { throw TileflowOfflineError(.invalidResponse, context: .init(reason: "invalidStyle")) }
    var documents = [url]
    documents += fontFiles(style["metadata"]?["tileflow:fontFaces"], against: url)
    if case .object(let sources) = style["sources"] {
      for name in sources.keys.sorted() {
        // TileJSON documents and GeoJSON data; tiles come from the region's tile sources.
        for member in ["url", "data"] {
          if let text = sources[name]?[member]?.string, let document = resolve(text, against: url) {
            documents.append(document)
          }
        }
      }
    }
    var sprites: [String] = []
    switch style["sprite"] {
    case .string(let base): sprites = [base]
    case .array(let items): sprites = items.compactMap { $0["url"]?.string }
    default: break
    }
    for base in sprites {
      for suffix in [".json", ".png", "@2x.json", "@2x.png"] {
        if let sprite = resolve(base, against: url, suffix: suffix) { documents.append(sprite) }
      }
    }
    if let template = style["glyphs"]?.string {
      for stack in fontStacks(style) {
        let name =
          stack.joined(separator: ",").addingPercentEncoding(
            withAllowedCharacters: unreserved) ?? ""
        for range in glyphRanges {
          let text = template.replacingOccurrences(of: "{fontstack}", with: name)
            .replacingOccurrences(of: "{range}", with: range)
          if let glyph = resolve(text, against: url) { documents.append(glyph) }
        }
      }
    }
    return documents
  }

  static func tileURL(_ template: String, z: Int, x: Int, y: Int) -> URL? {
    guard ["{z}", "{x}", "{y}"].allSatisfy({ template.components(separatedBy: $0).count == 2 })
    else { return nil }
    let text = template.replacingOccurrences(of: "{z}", with: String(z))
      .replacingOccurrences(of: "{x}", with: String(x))
      .replacingOccurrences(of: "{y}", with: String(y))
    guard let url = URL(string: text), ["https", "http"].contains(url.scheme), url.host != nil
    else { return nil }
    return url
  }

  /// The font files of `tileflow:fontFaces` entries: each face's `source`, or the `url` of each
  /// of its `sources`.
  private static func fontFiles(_ value: JSONValue?, against base: URL) -> [URL] {
    guard case .array(let faces) = value else { return [] }
    var files: [URL] = []
    for face in faces {
      var names = face["source"]?.string.map { [$0] } ?? []
      if case .array(let sources) = face["sources"] {
        names += sources.compactMap { $0["url"]?.string ?? $0.string }
      }
      files += names.compactMap { resolve($0, against: base) }
    }
    return files
  }

  /// Font stacks of symbol layers: literal `text-font` arrays, or the default stack for text
  /// without one. Stacks chosen by data expressions are not resolved.
  private static func fontStacks(_ style: JSONValue) -> [[String]] {
    guard case .array(let layers) = style["layers"] else { return [] }
    var stacks: [[String]] = []
    func add(_ stack: [String]) {
      if !stack.isEmpty, !stacks.contains(stack) { stacks.append(stack) }
    }
    for layer in layers where layer["type"]?.string == "symbol" {
      let layout = layer["layout"]
      switch layout?["text-font"] {
      case .array(let items) where items.allSatisfy({ $0.string != nil }):
        add(items.compactMap(\.string))
      case .array(let items) where items.count == 2 && items[0].string == "literal":
        if case .array(let names) = items[1] { add(names.compactMap(\.string)) }
      case nil where layout?["text-field"] != nil:
        add(defaultFontStack)
      default:
        break
      }
    }
    return stacks
  }

  private static func resolve(_ text: String, against base: URL, suffix: String = "") -> URL? {
    guard let url = URL(string: text, relativeTo: base)?.absoluteURL,
      var components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      ["https", "http"].contains(components.scheme)
    else { return nil }
    components.path += suffix
    return components.url
  }

  /// RFC 3986 unreserved characters, as `encodeURIComponent` leaves them.
  private static let unreserved = CharacterSet(
    charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.!~*'()")
}
