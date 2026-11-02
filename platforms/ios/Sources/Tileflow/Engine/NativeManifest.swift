import Foundation

/// The map document a native engine draws: the map's entry in its manifest and the theme to show.
///
/// A self-hosted source names its manifest. A Hosted source names its mobile discovery document,
/// whose representation names the profile manifest.
struct NativeManifest: Sendable {
  struct Theme: Sendable {
    let name: String
    let styleURL: URL
  }

  let theme: Theme
  /// The map's authored view, used when the application gives no camera.
  let view: TileflowCamera

  /// The representation a Hosted map is read from. The fixture and the service announce the
  /// WebView profile today; the native profile replaces it once its artifacts are delivered.
  static let hostedProfile = "webview-v1"

  static func load(
    map: String, manifestURL: URL, discoveryMapID: String?, theme requested: String?,
    colorScheme: String, read: (URL, TileflowResourceKind) async throws -> [String: Any]
  ) async throws -> NativeManifest {
    var url = manifestURL
    if let discoveryMapID {
      let discovery = try await read(manifestURL, .manifest)
      guard discovery["mapId"] as? String == discoveryMapID,
        let representations = discovery["representations"] as? [String: Any],
        let profile = representations[hostedProfile] as? [String: Any],
        let profileURL = (profile["manifestUrl"] as? String).flatMap(URL.init(string:))
      else { throw failure("This Map has no \(hostedProfile) representation.", .manifest) }
      url = profileURL
    }
    let manifest = try await read(url, .manifest)
    guard let maps = manifest["maps"] as? [String: Any], let entry = maps[map] as? [String: Any],
      let themes = entry["themes"] as? [String: Any]
    else { throw failure("The map is not in the manifest.", .manifest) }
    let name: String?
    switch requested {
    case nil: name = entry["defaultTheme"] as? String
    case "system": name = (entry["systemThemes"] as? [String: Any])?[colorScheme] as? String
    case let theme?: name = theme
    }
    guard let name, let theme = themes[name] as? [String: Any],
      let styleURL = (theme["styleUrl"] as? String).flatMap({
        URL(string: $0, relativeTo: url)?.absoluteURL
      })
    else { throw failure("The map has no usable theme.", .style) }
    return NativeManifest(
      theme: Theme(name: name, styleURL: styleURL), view: Self.view(entry["view"]))
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

  private static func failure(_ message: String, _ kind: TileflowResourceKind) -> TileflowMapError
  {
    TileflowMapError(.resourceFailed, context: .init(resource: kind, message: message))
  }
}
