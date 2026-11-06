import Foundation

/// The map document a native engine draws: the map's entry in its manifest, its themes and where
/// its family document is.
///
/// A self-hosted source names its manifest, normally the `manifest.json` that
/// `tileflow build --renderer native` writes, and its family document is the build's
/// `families/<map>.json`. A Hosted source names its mobile discovery document, whose `native-v1`
/// representation names the native manifest and the deployment's family document with its
/// revision. A downloaded region may still contain an older `webview-v1` manifest and style;
/// the engine can translate them while opening the map offline.
struct NativeManifest: Sendable {
  struct Theme: Sendable {
    let name: String
    let styleURL: URL
  }

  /// Where the map's documents come from.
  enum Representation: String, Sendable {
    case native = "native-v1"
    case webView = "webview-v1"
    case selfHosted
  }

  let map: String
  let representation: Representation
  /// A Hosted deployment's family document and its SHA-256 revision, from discovery.
  var family: (url: URL, revision: String?)?
  let catalog: NativeEvaluators.ThemeCatalog
  /// Each theme's style, by name.
  let styles: [String: URL]
  /// The map's authored view, used when the application gives no camera.
  let view: TileflowCamera

  /// The style of a theme the catalog resolved.
  func theme(_ name: String) throws -> Theme {
    guard let url = styles[name] else { throw Self.failure("The map has no theme \(name).", .style) }
    return Theme(name: name, styleURL: url)
  }

  /// The theme a selection shows: nil for the default, `system` by colour scheme, and a time of
  /// day's variant. Unknown themes fail with `resourceFailed`.
  func resolve(_ selection: String?, colorScheme: String, timeOfDay: String? = nil) throws -> Theme {
    do {
      return try theme(
        NativeEvaluators.theme(
          catalog, selection: selection, colorScheme: colorScheme, timeOfDay: timeOfDay))
    } catch let failure as NativeEvaluators.Failure {
      throw Self.failure(failure.message, .style)
    }
  }

  /// The map's family document: the one Hosted discovery names, or the `families/<map>.json` a
  /// native build writes two levels above its styles.
  func familyURL(styleURL: URL) -> URL? {
    switch representation {
    case .native: return family?.url
    case .selfHosted: return MapResourceAddress.familyURL(style: styleURL, map: map)
    case .webView: return nil
    }
  }

  /// Reads the map's manifest. `fromPacks` says the map opens from its downloaded regions;
  /// `native` false reads the WebView profile even when discovery announces the native one.
  static func load(
    map: String, manifestURL: URL, discoveryMapID: String?, fromPacks: Bool = false,
    native allowsNative: Bool = true, read: (URL, TileflowResourceKind) async throws -> [String: Any]
  ) async throws -> NativeManifest {
    guard let discoveryMapID else {
      return try parse(
        try await read(manifestURL, .manifest), map: map, url: manifestURL,
        representation: .selfHosted)
    }
    let discovery = try await read(manifestURL, .manifest)
    guard discovery["mapId"] as? String == discoveryMapID,
      let representations = discovery["representations"] as? [String: Any]
    else { throw failure("The Map's discovery document is not valid.", .manifest) }
    func profileURL(_ representation: Representation) -> URL? {
      ((representations[representation.rawValue] as? [String: Any])?["manifestUrl"] as? String)
        .flatMap(URL.init(string:))
    }
    if allowsNative, let native = profileURL(.native) {
      do {
        var manifest = try parse(
          try await read(native, .manifest), map: map, url: native, representation: .native,
          mapID: discoveryMapID)
        let family = (representations[Representation.native.rawValue] as? [String: Any])?["family"]
          as? [String: Any]
        if let url = (family?["url"] as? String).flatMap(URL.init(string:)) {
          manifest.family = (url, family?["revision"] as? String)
        }
        return manifest
      } catch {
        // Downloaded regions may hold the WebView profile only.
        guard fromPacks, profileURL(.webView) != nil else { throw error }
      }
    }
    guard fromPacks, let webView = profileURL(.webView) else {
      throw TileflowMapError(.nativePublicationRequired, context: .init(
        resource: .manifest,
        message: #"This Map is published for web only. Add platforms: ["web", "native"] to its configuration and run tileflow deploy again."#))
    }
    return try parse(
      try await read(webView, .manifest), map: map, url: webView, representation: .webView,
      mapID: discoveryMapID)
  }

  static func parse(
    _ manifest: [String: Any], map: String, url: URL, representation: Representation,
    mapID: String? = nil
  ) throws -> NativeManifest {
    guard let maps = manifest["maps"] as? [String: Any] else {
      throw failure("The map is not in the manifest.", .manifest)
    }
    let name: String
    if let mapID {
      let matches = maps.keys.filter { (maps[$0] as? [String: Any])?["mapId"] as? String == mapID }
      guard matches.count == 1 else {
        throw failure("The manifest must contain exactly one entry for the Map's identity.", .manifest)
      }
      name = matches[0]
    } else {
      name = map
    }

    guard let entry = maps[name] as? [String: Any],
      let themes = entry["themes"] as? [String: Any],
      let defaultTheme = entry["defaultTheme"] as? String
    else { throw failure("The map is not in the manifest.", .manifest) }
    var styles: [String: URL] = [:]
    for (name, value) in themes {
      guard let styleURL = ((value as? [String: Any])?["styleUrl"] as? String).flatMap({
        URL(string: $0, relativeTo: url)?.absoluteURL
      }) else { continue }
      styles[name] = styleURL
    }
    let strings = { (value: Any?) -> [String: String]? in
      (value as? [String: Any])?.compactMapValues { $0 as? String }
    }
    let timeOfDay = (entry["timeOfDay"] as? [String: Any])?.compactMapValues(strings)
    return NativeManifest(
      map: name, representation: representation,
      catalog: .init(
        defaultTheme: defaultTheme, systemThemes: strings(entry["systemThemes"]),
        timeOfDay: timeOfDay, themes: Set(styles.keys)),
      styles: styles, view: Self.view(entry["view"]))
  }

  /// The authored view, or the whole world when the map declares none.
  private static func view(_ value: Any?) -> TileflowCamera {
    let view = value as? [String: Any] ?? [:]
    let center = (view["center"] as? [Any])?.compactMap { ($0 as? NSNumber)?.doubleValue }
    let camera = TileflowCamera(
      longitude: center?.count == 2 ? center![0] : 0, latitude: center?.count == 2 ? center![1] : 0,
      zoom: (view["zoom"] as? NSNumber)?.doubleValue ?? 0,
      bearing: (view["bearing"] as? NSNumber)?.doubleValue ?? 0,
      pitch: (view["pitch"] as? NSNumber)?.doubleValue ?? 0)
    return (try? camera.validate()) != nil
      ? camera : TileflowCamera(longitude: 0, latitude: 0, zoom: 0)
  }

  static func failure(_ message: String, _ kind: TileflowResourceKind) -> TileflowMapError {
    TileflowMapError(.resourceFailed, context: .init(resource: kind, message: message))
  }
}
