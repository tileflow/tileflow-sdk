import CryptoKit
import MapLibre
import XCTest

@testable import Tileflow

/// With the network off, a Bathymetry elevation tile that the downloaded region covers but does
/// not store answers 204, as the source does online. The engine should then draw the stored parent
/// overscaled.
///
/// The documents (style pack with the elevation TileJSON) and the source's template, version and
/// `absentStatus` come from the platform's marine pack fixture, release 1; set
/// `TILEFLOW_MARINE_FIXTURE_DIR` to its directory. The fixture's tiles are placeholders, so the
/// tile packs here hold real terrarium WebP tiles: -2000 m at z8, -500 m at z9.
@MainActor
final class OfflineElevationTests: XCTestCase {
  private let api = URL(string: "https://api.tileflow.test")!
  private let mapID = "map_offlinefixture00"
  private let background: UInt32 = 0x303030
  /// The relief colour of the z8 parent (-2000 m) and of a stored z9 tile (-500 m).
  private let parentColour: UInt32 = 0x00c080
  private let childColour: UInt32 = 0xf0a000
  private var directory: URL!

  override func setUp() async throws {
    try await EngineNetwork.install()
    EngineURLProtocol.reset()
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "offline-elevation-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  override func tearDown() async throws {
    try? FileManager.default.removeItem(at: directory)
  }

  /// The region stores z8; its z9 tiles are absent and answer 204.
  func testAnAbsentElevationTileDrawsItsStoredParentOffline() async throws {
    let result = try await draw(
      name: "parent-stored", zooms: 8...9,
      stored: [OfflineTileID(z: 8, x: 125, y: 96): "dem-z8-minus2000"])
    XCTAssertEqual(result.statuses["9/250/193"], 204)
    XCTAssertEqual(result.statuses["8/125/96"], 200, "The engine did not ask for the parent")
    for (name, point) in result.quadrants {
      XCTAssertTrue(
        result.pixels.matches(point, parentColour, tolerance: 16),
        "\(name) is \(result.pixels.hex(point)), not the parent's relief")
    }
  }

  /// As above, with the projection raising the source's `minzoom` to the lowest zoom the
  /// region stores, so the engine never asks for ancestors the region cannot have.
  func testWithMinzoomAtTheStoredZoomTheMapFinishesRendering() async throws {
    let result = try await draw(
      name: "parent-stored-minzoom", zooms: 8...9,
      stored: [OfflineTileID(z: 8, x: 125, y: 96): "dem-z8-minus2000"], sourceMinZoom: 8)
    XCTAssertEqual(result.statuses["8/125/96"], 200)
    XCTAssertTrue(result.rendered, "The map never finished rendering")
    for (name, point) in result.quadrants {
      XCTAssertTrue(
        result.pixels.matches(point, parentColour, tolerance: 16),
        "\(name) is \(result.pixels.hex(point))")
    }
  }

  /// Release 1 as generated: the download starts at z10, so the elevation source holds only z9.
  /// A covered z9 tile that is absent has no stored parent to draw.
  func testWithOnlyZ9StoredAnAbsentTileHasNoParentOffline() async throws {
    let result = try await draw(
      name: "z9-only", zooms: 9...9,
      stored: [OfflineTileID(z: 9, x: 250, y: 193): "dem-z9-minus500"])
    XCTAssertEqual(result.statuses["9/250/193"], 200)
    XCTAssertEqual(result.statuses["9/251/193"], 204)
    let southWest = result.quadrants["south-west (9/250/193)"]!
    XCTAssertTrue(result.pixels.matches(southWest, childColour, tolerance: 16))
    // Recorded, not asserted: what the engine drew where the parent was missing.
  }

  // MARK: Helpers

  private struct Result {
    let pixels: PixelReader
    let quadrants: [String: CGPoint]
    let statuses: [String: Int]
    let rendered: Bool
  }

  private func draw(
    name: String, zooms: ClosedRange<Int>, stored: [OfflineTileID: String],
    sourceMinZoom: Int? = nil
  ) async throws -> Result {
    let fixture = try marineFixture()
    let manifest =
      try JSONSerialization.jsonObject(
        with: Data(contentsOf: fixture.appendingPathComponent("release-1/create-response.json")))
      as! [String: Any]
    let created = (manifest["manifest"] as? [String: Any]) ?? manifest
    let source = (created["sources"] as! [[String: Any]]).first {
      $0["source"] as? String == "bathymetry-dem"
    }!
    let template = source["template"] as! String
    let absentStatus = source["absentStatus"] as! Int
    let styleFile = fixture.appendingPathComponent("release-1/packs/style.tfpack")
    let styleBytes = try Data(contentsOf: styleFile).count
    let styleIndex = try OfflinePackFormat.verify(styleFile, bytes: styleBytes, kind: .documents)
      .index
    let tilejsonURL = "https://api.tileflow.test/tiles/bathymetry/dem/tiles.json?map=\(mapID)"
    let tilejsonEntry = try XCTUnwrap(styleIndex.entries[tilejsonURL])

    // The tile pack of the region's anchor 7/62/48, holding `stored`.
    var entries: [(name: String, body: Data)] = []
    for (tile, resource) in stored.sorted(by: { $0.key.z < $1.key.z }) {
      let url = Bundle(for: Self.self).url(
        forResource: resource, withExtension: "webp", subdirectory: "Fixtures")!
      entries.append(("\(tile.z)/\(tile.x)/\(tile.y)", try Data(contentsOf: url)))
    }
    let tilePack = directory.appendingPathComponent("\(name).tfpack")
    let tileData = Self.pack(kind: 1, entries)
    try tileData.write(to: tilePack)
    _ = try OfflinePackFormat.verify(tilePack, bytes: tileData.count, kind: .tiles)

    var packs = OfflineServedPacks()
    packs.documents[tilejsonURL] = (styleFile, tilejsonEntry)
    var served = OfflineServedTiles(
      template: OfflineTileTemplate(template)!, zooms: zooms, absentStatus: absentStatus)
    // The region: z8 tile 125/96 over Madrid, slightly inset.
    served.covers = [
      try OfflineCover.of(
        [OfflinePackRegion.canonical(-4.2, 39.92, -2.83, 40.97)!], minZoom: zooms.lowerBound,
        maxZoom: zooms.upperBound)
    ]
    served.anchors[OfflineTileID(z: 7, x: 62, y: 48)] = [tilePack]
    packs.tiles[template] = served

    let scope = ResourceCacheScope.grant(apiOrigin: api, mapID: mapID)
    let index = OfflineServingIndex()
    index.publish(OfflineServingSnapshot(packs: [scope.directory: packs]), from: self)
    let cache = ResourceCacheStore(
      ambientRoot: directory.appendingPathComponent("ambient"),
      durableRoot: directory.appendingPathComponent("durable"), maximumBytes: 1 << 24)
    let session = HostedSession(
      endpoint: try HostedEndpoint(
        TileflowConfiguration(
          apiOrigin: api,
          mapCredential: TileflowCredential("tf_public_" + String(repeating: "a", count: 48)))),
      mapID: mapID, surfaceID: "mobile-map")
    let loader = ResourceLoader(
      policy: ResourcePolicy(origins: ["https://api.tileflow.test"]), hosted: session,
      apiOrigin: api, cache: cache, grantScope: scope, offline: index,
      networkEnabled: { false }, reachable: { false })
    let context = TransportAddress.newContext()
    EngineURLProtocol.register(loader, context: context)
    defer {
      EngineURLProtocol.unregister(context: context)
      loader.close()
      session.close()
    }

    // The style a Bathymetry relief declares (Core: terrarium, 512), drawn as colour relief.
    let style: [String: Any] = [
      "version": 8,
      "sources": [
        "bathymetry-dem": [
          "type": "raster-dem", "url": tilejsonURL, "encoding": "terrarium", "tileSize": 512,
        ]
      ],
      "layers": [
        ["id": "background", "type": "background", "paint": ["background-color": "#303030"]],
        [
          "id": "relief", "type": "color-relief", "source": "bathymetry-dem",
          "paint": [
            "color-relief-color": [
              "interpolate", ["linear"], ["elevation"], -3000, "#000080", -2000, "#00c080",
              -500, "#f0a000", 0, "#ffffff",
            ]
          ],
        ],
      ],
    ]
    var projection = StyleProjection(context: context, loader: loader)
    var projected = try await projection.project(
      style, styleURL: URL(string: "https://api.tileflow.test/maps/\(mapID)/style.json")!)
    if let sourceMinZoom, var sources = projected["sources"] as? [String: Any],
      var dem = sources["bathymetry-dem"] as? [String: Any]
    {
      dem["minzoom"] = sourceMinZoom
      sources["bathymetry-dem"] = dem
      projected["sources"] = sources
    }
    let harness = MapHarness()
    defer { harness.close() }
    // The corner of z9 tiles 250–251 / 192–193, the centre of z8 tile 125/96.
    harness.mapView.setCenter(
      CLLocationCoordinate2D(latitude: Self.latitude(y: 96.5, z: 8), longitude: Self.longitude(x: 125.5, z: 8)),
      zoomLevel: 9.5, animated: false)
    try await harness.load(styleJSON: try StyleProjection.json(projected))
    let rendered = await harness.waitUntilRendered(timeout: 20)
    // Let the engine retry anything that failed.
    try await Task.sleep(nanoseconds: 4_000_000_000)
    let image = harness.snapshot()
    let pixels = PixelReader(image)
    let center = CGPoint(x: pixels.width / 2, y: pixels.height / 2)
    let quadrants: [String: CGPoint] = [
      "north-west (9/250/192)": CGPoint(x: center.x - 100, y: center.y - 200),
      "north-east (9/251/192)": CGPoint(x: center.x + 100, y: center.y - 200),
      "south-west (9/250/193)": CGPoint(x: center.x - 100, y: center.y + 200),
      "south-east (9/251/193)": CGPoint(x: center.x + 100, y: center.y + 200),
    ]
    let requests = EngineURLProtocol.requests
    var statuses: [String: Int] = [:]
    var attempts: [String: Int] = [:]
    for request in requests {
      guard let remote = request.remote, let tile = OfflineTileTemplate(template)?.tile(remote)
      else { continue }
      statuses[tile.name] = request.status ?? -1
      attempts[tile.name, default: 0] += 1
    }
    SpikeEnvironment.write(image, to: "offline-elevation-\(name).png")
    SpikeEnvironment.write(
      SpikeEnvironment.json([
        "device": SpikeEnvironment.device,
        "maplibre": Bundle(for: MLNMapView.self).infoDictionary?["CFBundleShortVersionString"]
          ?? "?", "date": ISO8601DateFormatter().string(from: Date()),
        "fullyRendered": rendered, "zoom": harness.mapView.zoomLevel,
        "packZooms": [zooms.lowerBound, zooms.upperBound],
        "stored": stored.keys.map(\.name).sorted(), "absentStatus": absentStatus,
        "template": template, "tileStatuses": statuses, "tileAttempts": attempts,
        "escaped": EngineURLProtocol.escaped,
        "quadrants": quadrants.mapValues { pixels.hex($0) },
        "requests": requests.map { "\($0)" },
      ]), to: "offline-elevation-\(name).json")
    XCTAssertEqual(EngineURLProtocol.escaped, [])
    return Result(pixels: pixels, quadrants: quadrants, statuses: statuses, rendered: rendered)
  }

  private func marineFixture() throws -> URL {
    guard let path = ProcessInfo.processInfo.environment["TILEFLOW_MARINE_FIXTURE_DIR"] else {
      throw XCTSkip("Set TILEFLOW_MARINE_FIXTURE_DIR to the marine pack fixture.")
    }
    return URL(fileURLWithPath: path, isDirectory: true)
  }

  static func longitude(x: Double, z: Int) -> Double { x / Double(1 << z) * 360 - 180 }

  static func latitude(y: Double, z: Int) -> Double {
    let n = Double.pi * (1 - 2 * y / Double(1 << z))
    return atan(sinh(n)) * 180 / .pi
  }

  /// A pack in the service's format 2 (`kind` 1 = tiles), as the service builds it.
  static func pack(kind: UInt8, _ entries: [(name: String, body: Data)]) -> Data {
    func little(_ value: UInt64, _ width: Int) -> Data {
      Data((0..<width).map { UInt8(truncatingIfNeeded: value >> (8 * $0)) })
    }
    var index = Data()
    var data = Data()
    for entry in entries {
      let name = Data(entry.name.utf8)
      let type = Data("image/webp".utf8)
      index += little(UInt64(name.count), 2) + name
      index += [UInt8(type.count)] + type
      index += [0]
      index += little(UInt64(data.count), 8)
      index += little(UInt64(entry.body.count), 4)
      data += entry.body
    }
    var pack = Data("TFPK".utf8) + little(1, 2) + [kind, 0]
    pack += little(UInt64(entries.count), 4) + little(UInt64(index.count), 4)
    pack += little(UInt64(data.count), 8) + little(0, 8)
    pack += index + data
    return pack + Data(SHA256.hash(data: pack))
  }
}
