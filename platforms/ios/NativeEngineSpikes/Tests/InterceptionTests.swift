import MapLibre
import XCTest

@testable import Tileflow

private let hostedMapID = "map_offlinefixture01"
private let center = CLLocationCoordinate2D(latitude: 40.42, longitude: -3.7)
private let ground: UInt32 = 0xece6da
private let building: UInt32 = 0xd6ccb8
private let mark: UInt32 = 0xe03020

/// MapLibre Native draws the fixture's Hosted map with every request answered by the SDK's
/// resource loader: online through its session, and with the network switched off from the
/// downloaded region's packs.
@MainActor
final class InterceptionTests: XCTestCase {
  private var configuration: TileflowConfiguration!

  override func setUp() async throws {
    try await FixtureCounters.require()
    try await EngineNetwork.install()
    configuration = try TileflowConfiguration(
      apiOrigin: URL(string: SpikeEnvironment.origin)!,
      mapCredential: TileflowCredential("tf_public_" + String(repeating: "f", count: 48)))
    await TileflowMapCache.clear()
    EngineURLProtocol.reset()
  }

  func testAHostedMapLoadsOnlineThroughTheInterception() async throws {
    _ = try await FixtureCounters.read(reset: true)
    let host = try HostedMapHost(
      source: .hosted(mapID: hostedMapID, configuration: configuration))
    defer { host.close() }
    let json = try await host.styleJSON(theme: "labels")
    let harness = MapHarness()
    defer { harness.close() }
    harness.mapView.setCenter(center, zoomLevel: 15.5, animated: false)
    try await harness.load(styleJSON: json)
    let rendered = await harness.waitUntilRendered()
    try await Task.sleep(nanoseconds: 1_000_000_000)
    let image = harness.snapshot()
    let counters = try await FixtureCounters.read()
    let usage = await TileflowMapCache.usage()
    let report = evidence(
      "online", host: host, harness: harness, image: image, rendered: rendered,
      counters: counters, cacheEntries: usage.entries)
    let requests = EngineURLProtocol.requests
    let pixels = PixelReader(image)
    let all = CGRect(x: 0, y: 0, width: pixels.width, height: pixels.height)

    XCTAssertTrue(rendered)
    XCTAssertEqual(EngineURLProtocol.escaped, [], "The engine reached the network itself")
    XCTAssertTrue(requests.allSatisfy { $0.remote?.hasPrefix(SpikeEnvironment.origin) == true })
    let sprite = requests.filter { $0.remote?.contains("/sprites/fixture/sprite") == true }
    XCTAssertEqual(
      Set(sprite.compactMap(\.remote)),
      [
        "\(SpikeEnvironment.origin)/sprites/fixture/sprite@2x.json",
        "\(SpikeEnvironment.origin)/sprites/fixture/sprite@2x.png",
      ], "\(sprite)")
    XCTAssertTrue(sprite.allSatisfy { $0.status == 200 }, "\(sprite)")
    let glyphs = requests.filter { $0.remote?.contains("/fonts/") == true }
    XCTAssertEqual(
      glyphs.compactMap(\.remote),
      ["\(SpikeEnvironment.origin)/fonts/Noto%20Sans%20Regular/0-255.pbf"], "\(glyphs)")
    XCTAssertTrue(glyphs.allSatisfy { $0.status == 200 }, "\(glyphs)")
    XCTAssertEqual(counters["sessions"], 1)
    XCTAssertGreaterThan(counters["sessionResources"] ?? 0, 0)
    XCTAssertEqual(report.database["resources"], 0, "MapLibre stored a resource")
    XCTAssertEqual(report.database["tiles"], 0, "MapLibre stored a tile")
    XCTAssertGreaterThan(pixels.count(in: all, step: 2, building), 100, "No building drawn")
    XCTAssertGreaterThan(pixels.count(in: all, step: 1, mark, tolerance: 20), 0, "No sprite icon drawn")
  }

  func testAHostedMapLoadsFromItsPackWithTheNetworkOff() async throws {
    let configuration = configuration!
    let store = SpikeOfflineStore.make(
      client: { try OfflinePackClient(configuration: configuration) }, test: self)
    try await SpikeOfflineStore.download(
      store, id: "labels",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(west: -3.705, south: 40.416, east: -3.695, north: 40.424)),
        content: .hosted(mapID: hostedMapID, themes: ["labels"]), minZoom: 13, maxZoom: 15))

    _ = try await FixtureCounters.read(reset: true)
    EngineURLProtocol.reset()
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    let host = try HostedMapHost(
      source: .hosted(mapID: hostedMapID, configuration: configuration))
    defer { host.close() }
    let json = try await host.styleJSON(theme: "labels")
    let harness = MapHarness()
    defer { harness.close() }
    harness.mapView.setCenter(center, zoomLevel: 15.5, animated: false)
    try await harness.load(styleJSON: json)
    let rendered = await harness.waitUntilRendered()
    try await Task.sleep(nanoseconds: 1_000_000_000)
    let image = harness.snapshot()
    let counters = try await FixtureCounters.read()
    let usage = await TileflowMapCache.usage()
    let report = evidence(
      "offline", host: host, harness: harness, image: image, rendered: rendered,
      counters: counters, cacheEntries: usage.entries)
    let requests = EngineURLProtocol.requests
    let pixels = PixelReader(image)
    let all = CGRect(x: 0, y: 0, width: pixels.width, height: pixels.height)

    XCTAssertTrue(rendered)
    XCTAssertEqual(EngineURLProtocol.escaped, [], "The engine reached the network itself")
    XCTAssertEqual(counters["sessions"], 0, "No session starts without a network")
    XCTAssertEqual(counters["downloads"], 0, "Nothing was downloaded")
    XCTAssertEqual(counters["sessionResources"], 0)
    XCTAssertEqual(counters["notModified"], 0)
    XCTAssertEqual(usage.entries, 0, "Nothing came from the network")
    let sprite = requests.filter { $0.remote?.contains("/sprites/fixture/sprite") == true }
    XCTAssertEqual(sprite.count, 2, "\(sprite)")
    XCTAssertTrue(sprite.allSatisfy { $0.status == 200 }, "\(sprite)")
    let glyphs = requests.filter { $0.remote?.contains("/fonts/") == true }
    XCTAssertTrue(!glyphs.isEmpty && glyphs.allSatisfy { $0.status == 200 }, "\(glyphs)")
    XCTAssertEqual(report.database["resources"], 0)
    XCTAssertEqual(report.database["tiles"], 0)
    XCTAssertGreaterThan(pixels.count(in: all, step: 2, building), 100, "No building drawn")
    XCTAssertGreaterThan(pixels.count(in: all, step: 1, mark, tolerance: 20), 0, "No sprite icon drawn")
  }

  private struct Report {
    let database: [String: Int]
  }

  private func evidence(
    _ name: String, host: HostedMapHost, harness: MapHarness, image: UIImage, rendered: Bool,
    counters: [String: Int], cacheEntries: Int
  ) -> Report {
    let requests = EngineURLProtocol.requests
    let database = EngineNetwork.databaseRows()
    let pixels = PixelReader(image)
    let all = CGRect(x: 0, y: 0, width: pixels.width, height: pixels.height)
    var statuses: [String: Int] = [:]
    for request in requests { statuses[request.status.map(String.init) ?? "none", default: 0] += 1 }
    SpikeEnvironment.write(image, to: "interception-\(name).png")
    SpikeEnvironment.write(
      SpikeEnvironment.json([
        "device": SpikeEnvironment.device, "maplibre": Bundle(for: MLNMapView.self)
          .infoDictionary?["CFBundleShortVersionString"] ?? "?",
        "date": ISO8601DateFormatter().string(from: Date()), "fullyRendered": rendered,
        "frames": harness.renderedFrames, "fixtureCounters": counters,
        "sdkCacheEntries": cacheEntries, "maplibreDatabase": database,
        "maplibreDatabaseFile": (MLNOfflineStorage.shared.databasePath as NSString).lastPathComponent,
        "escaped": EngineURLProtocol.escaped, "requestCount": requests.count,
        "statuses": statuses, "maximumConcurrentRequests": EngineURLProtocol.maximumActive,
        "embeddedTileJSON": host.projection.embeddedTileJSON,
        "missingImages": harness.missingImages,
        "pixels": [
          "ground": pixels.count(in: all, step: 2, ground),
          "building": pixels.count(in: all, step: 2, building),
          "spriteIcon": pixels.count(in: all, step: 1, mark, tolerance: 20),
        ],
        "requests": requests.map { request -> [String: Any] in
          [
            "transport": request.transport, "remote": request.remote ?? "",
            "status": request.status ?? -1, "bytes": request.bytes,
            "contentType": request.contentType ?? "", "error": request.error ?? "",
            "headersSent": request.headersSent,
          ]
        },
      ]), to: "interception-\(name).json")
    return Report(database: database)
  }
}
