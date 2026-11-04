import Foundation

/// Resolves and projects a map for a view or a snapshot, using the same profile when opening a pack.
struct NativeMapPreparation: Sendable {
  let loader: any ResourceLoading
  let context: String
  let storedZooms: NativeStyleDocument.StoredZooms?

  /// Foundation JSON is handed to one owner after the loader finishes reading it.
  struct Document: @unchecked Sendable {
    let value: [String: Any]
  }

  struct Map: Sendable {
    let manifest: NativeManifest
    let theme: NativeManifest.Theme
    let document: Document
    let projected: ProjectedStyle
  }

  func map(
    _ name: String, manifestURL: URL, discoveryMapID: String?, theme: String?, colorScheme: String,
    fromPacks: Bool
  ) async throws -> Map {
    func manifest(native: Bool) async throws -> NativeManifest {
      try await NativeManifest.load(
        map: name, manifestURL: manifestURL, discoveryMapID: discoveryMapID, fromPacks: fromPacks,
        native: native,
        read: { url, kind in try await Self.read(url, kind: kind, loader: loader).value })
    }
    func prepare(_ value: NativeManifest, _ chosen: NativeManifest.Theme) async throws -> Map {
      let (document, projected) = try await style(chosen.styleURL)
      return Map(manifest: value, theme: chosen, document: document, projected: projected)
    }
    let current = try await manifest(native: true)
    let selected = try current.resolve(theme, colorScheme: colorScheme)
    do {
      return try await prepare(current, selected)
    } catch  where fromPacks && current.representation == .native {
      // A cached native manifest may name a style that the older pack did not download.
      let older = try await manifest(native: false)
      return try await prepare(older, older.resolve(theme, colorScheme: colorScheme))
    }
  }

  func style(_ url: URL) async throws -> (Document, ProjectedStyle) {
    let document = try await Self.read(url, kind: .style, loader: loader)
    let projected = try await project(document, styleURL: url)
    return (document, projected)
  }

  func project(_ style: Document, styleURL: URL) async throws -> ProjectedStyle {
    try await NativeStyleDocument.project(
      style.value, styleURL: styleURL, context: context,
      load: { url, kind in try await Self.read(url, kind: kind, loader: loader).value },
      storedZooms: storedZooms)
  }

  static func read(_ url: URL, kind: TileflowResourceKind, loader: any ResourceLoading)
    async throws -> Document
  {
    let payload = try await loader.load(URLRequest(url: url))
    guard payload.status == 200,
      let value = try? JSONSerialization.jsonObject(with: payload.bytes) as? [String: Any]
    else {
      throw TileflowMapError(
        .resourceFailed,
        context: .init(resource: kind, origin: ResourcePolicy.origin(url), status: payload.status))
    }
    return Document(value: value)
  }
}
