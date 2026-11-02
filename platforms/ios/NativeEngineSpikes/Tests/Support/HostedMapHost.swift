import Foundation
import MapLibre
import XCTest

@testable import Tileflow

/// What a native host does before the engine draws a Hosted map: read the source's configuration,
/// start a session, read discovery and the profile manifest through the resource loader, project
/// the theme's style and give the document to the engine.
@MainActor
final class HostedMapHost {
  let loader: ResourceLoader
  let session: HostedSession
  let context = TransportAddress.newContext()
  let loadable: LoadableMapSource
  private(set) var projection: StyleProjection
  private(set) var styleURL: URL?

  init(source: TileflowMapSource) throws {
    loadable = try source.loadable()
    session = HostedSession(
      endpoint: loadable.hosted!, mapID: loadable.mapID!, surfaceID: loadable.surfaceID!)
    loader = ResourceLoader(
      policy: loadable.policy, hosted: session, apiOrigin: loadable.hosted?.apiOrigin,
      publicMetadataURLs: loadable.publicMetadataURLs, cache: .shared,
      grantScope: loadable.grantScope, offline: .shared)
    projection = StyleProjection(context: context, loader: loader)
    EngineURLProtocol.register(loader, context: context)
  }

  func close() {
    EngineURLProtocol.unregister(context: context)
    loader.close()
    session.close()
  }

  /// The projected style document of `theme`.
  func styleJSON(theme: String) async throws -> String {
    let discovery = try await StyleProjection.document(loadable.manifestURL, loader: loader)
    guard let representations = discovery["representations"] as? [String: Any],
      let profile = representations["webview-v1"] as? [String: Any],
      let profileURL = (profile["manifestUrl"] as? String).flatMap(URL.init(string:))
    else { throw NSError(domain: "HostedMapHost", code: 1) }
    let manifest = try await StyleProjection.document(profileURL, loader: loader)
    guard let maps = manifest["maps"] as? [String: Any],
      let map = maps[loadable.map] as? [String: Any],
      let themes = map["themes"] as? [String: Any],
      let entry = themes[theme] as? [String: Any],
      let url = (entry["styleUrl"] as? String).flatMap(URL.init(string:))
    else { throw NSError(domain: "HostedMapHost", code: 2) }
    styleURL = url
    let style = try await StyleProjection.document(url, loader: loader)
    var projection = self.projection
    let projected = try await projection.project(style, styleURL: url)
    self.projection = projection
    return try StyleProjection.json(projected)
  }
}

/// The fixture server's Hosted counters.
enum FixtureCounters {
  static func read(reset: Bool = false) async throws -> [String: Int] {
    var request = URLRequest(url: URL(string: "\(SpikeEnvironment.origin)/__fixture/hosted")!)
    request.httpMethod = reset ? "POST" : "GET"
    let (data, _) = try await URLSession.shared.data(for: request)
    let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    return value.compactMapValues { $0 as? Int }
  }

  static func require() async throws {
    do {
      _ = try await read()
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs with TILEFLOW_FIXTURE_PORT.")
    }
  }
}

/// An offline store of its own whose regions every map may use, removed after the test.
enum SpikeOfflineStore {
  static func make(
    client: @escaping @Sendable () throws -> OfflinePackClient, test: XCTestCase
  ) -> TileflowOfflineStore {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(
      "native-engine-offline-\(UUID().uuidString)", isDirectory: true)
    let store = TileflowOfflineStore(
      dependencies: OfflineStoreCore.Dependencies(
        layout: OfflineLayout(root: root), cache: .shared,
        fetcher: OfflineURLSessionFetcher(
          configuration: .ephemeral, directory: root.appendingPathComponent("transfers")),
        client: client, availableBytes: { nil }, index: .shared))
    test.addTeardownBlock {
      for region in await store.allRegions() { try? await store.removeRegion(id: region.id) }
      try? FileManager.default.removeItem(at: root)
    }
    return store
  }

  static func download(
    _ store: TileflowOfflineStore, id: String, options: TileflowOfflineRegionLoadOptions
  ) async throws {
    try await store.loadRegion(id: id, options: options)
    let deadline = Date().addingTimeInterval(30)
    var region = await store.region(id: id)
    while region?.state != .complete, Date() < deadline {
      try await Task.sleep(nanoseconds: 20_000_000)
      region = await store.region(id: id)
    }
    XCTAssertEqual(region?.state, .complete, "\(String(describing: region))")
  }
}
