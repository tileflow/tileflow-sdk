import Foundation
import MapLibre
import UIKit
import XCTest

@testable import Tileflow

/// A Hosted map opened from its downloaded region with the network off draws Bathymetry's
/// elevation model where the region stores no tile: the absent tile answers 204, as the source
/// does online, and MapLibre Native draws the stored parent. The projection starts the source at
/// the lowest zoom the region stores, so the engine asks for no ancestor the region cannot hold.
///
/// The release, the elevation source's template, zooms and absent status, its TileJSON and the
/// names of the tiles its pack stores come from the platform's marine pack fixture. The fixture's
/// tile bodies are placeholders, so the pack here holds the same tiles as terrarium WebP images:
/// -2000 m for the z8 parent and -500 m for the stored z9 tile.
@MainActor
final class NativeOfflineElevationTests: XCTestCase {
  private let api = URL(string: "https://api.tileflow.test")!
  private let mapID = "map_offlinefixture00"
  private let parentColour: UInt32 = 0x00c080
  private let childColour: UInt32 = 0xf0a000
  private var directory: URL!

  override func setUp() async throws {
    directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "native-elevation-\(UUID().uuidString)", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }

  override func tearDown() async throws {
    MapLibreResourceProtocol.answerObserver = nil
    MapLibreResourceProtocol.foreignRequestObserver = nil
    TileflowOfflineSwitch.shared.isNetworkEnabled = true
    try? FileManager.default.removeItem(at: directory)
  }

  func testAnAbsentElevationTileDrawsItsStoredParentOffline() async throws {
    let fixture = try XCTUnwrap(
      Bundle.module.url(forResource: "packs-v2", withExtension: nil, subdirectory: "Fixtures/Offline"))
    let created = try JSONDecoder().decode(
      JSONValue.self,
      from: Data(contentsOf: fixture.appendingPathComponent("release-1/create-response.json")))
    let manifest = try XCTUnwrap(created["manifest"])
    let source = try XCTUnwrap(
      manifest["sources"]?.array?.first { $0["source"]?.string == "bathymetry-dem" })
    let template = try XCTUnwrap(source["template"]?.string)
    let zooms = try XCTUnwrap(source["zooms"]?.array?.compactMap(\.number).map { Int($0) })
    XCTAssertEqual(zooms, [8, 9], "The release stores the elevation model's parents")
    let absentStatus = try XCTUnwrap(source["absentStatus"]?.number.map { Int($0) })
    let credits = OfflineCredit.credits(manifest["attribution"]?["sources"]?.array ?? [])
    // Bathymetry and its DEM over Madrid share EMODnet's credit, which shows once.
    XCTAssertEqual(credits.map(\.id), ["emodnet"])

    // The style pack's elevation TileJSON, and the tile pack's entry names, as the release has them.
    let styleFile = fixture.appendingPathComponent("release-1/packs/style.tfpack")
    let styleIndex = try OfflinePackFormat.verify(
      styleFile, bytes: try Data(contentsOf: styleFile).count, kind: .documents
    ).index
    let tileJSONURL = "https://api.tileflow.test/tiles/bathymetry/dem/tiles.json?map=\(mapID)"
    let tileJSON = try XCTUnwrap(styleIndex.entries[tileJSONURL])
    let demFile = fixture.appendingPathComponent("release-1/packs/tiles/bathymetry-dem/7/62/48.tfpack")
    let demNames = try OfflinePackFormat.verify(
      demFile, bytes: try Data(contentsOf: demFile).count, kind: .tiles
    ).index.entries.keys.sorted()
    XCTAssertEqual(demNames, ["8/125/96", "9/250/193"])
    let tiles = try write(
      .tiles,
      try demNames.map { name in
        OfflinePackBuilder.Entry(
          name: name, contentType: "image/webp", encoding: nil,
          body: try terrarium(name.hasPrefix("8/") ? "terrarium-minus2000" : "terrarium-minus500"))
      })

    // Discovery, profile and a relief theme: the map the application opens.
    let discovery = "\(api.absoluteString)/maps/\(mapID)/mobile/manifest.json"
    let profile = "\(api.absoluteString)/maps/\(mapID)/mobile/webview-v1/manifest.json"
    let styleURL = "\(api.absoluteString)/maps/\(mapID)/mobile/webview-v1/v1/relief.json"
    let documents: [(String, Any)] = [
      (
        discovery,
        [
          "version": 1, "mapId": mapID, "deploymentVersion": 1,
          "representations": ["webview-v1": ["manifestUrl": profile]],
        ]
      ),
      (
        profile,
        [
          "version": 1,
          "maps": [
            "map": [
              "mapId": mapID, "defaultTheme": "relief",
              "themes": ["relief": ["styleUrl": styleURL, "colorScheme": "light"]],
            ]
          ],
        ]
      ),
      (
        styleURL,
        [
          "version": 8,
          "sources": [
            "bathymetry-dem": [
              "type": "raster-dem", "url": tileJSONURL, "encoding": "terrarium", "tileSize": 512,
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
      ),
    ]
    let documentFile = try write(
      .documents,
      try documents.map { url, value in
        OfflinePackBuilder.Entry(
          name: url, contentType: "application/json", encoding: nil,
          body: try JSONSerialization.data(withJSONObject: value))
      })
    let documentIndex = try OfflinePackFormat.verify(
      documentFile, bytes: try Data(contentsOf: documentFile).count, kind: .documents
    ).index

    var packs = OfflineServedPacks()
    for (url, _) in documents { packs.documents[url] = (documentFile, documentIndex.entries[url]!) }
    packs.documents[tileJSONURL] = (styleFile, tileJSON)
    var served = OfflineServedTiles(
      template: try XCTUnwrap(OfflineTileTemplate(template)), zooms: 8...9,
      absentStatus: absentStatus)
    // The region over Madrid, inside z8 tile 125/96.
    served.covers = [
      try OfflineCover.of(
        [OfflinePackRegion.canonical(-4.2, 39.92, -2.83, 40.97)!], minZoom: 8, maxZoom: 9)
    ]
    served.anchors[OfflineTileID(z: 7, x: 62, y: 48)] = [tiles]
    packs.tiles[template] = served
    let scope = ResourceCacheScope.grant(apiOrigin: api, mapID: mapID)
    let index = OfflineServingIndex()
    index.publish(
      OfflineServingSnapshot(packs: [scope.directory: packs], credits: [scope.directory: credits]),
      from: self)

    let cache = ResourceCacheStore(
      ambientRoot: directory.appendingPathComponent("ambient"),
      durableRoot: directory.appendingPathComponent("durable"), maximumBytes: 1 << 24)
    let session = HostedSession(
      endpoint: try HostedEndpoint(
        TileflowConfiguration(
          apiOrigin: api,
          mapCredential: TileflowCredential("tf_public_" + String(repeating: "a", count: 48)))),
      mapID: mapID, surfaceID: "mobile-map")
    defer { session.close() }
    let loader = ResourceLoader(
      policy: ResourcePolicy(origins: [api.absoluteString]), hosted: session, apiOrigin: api,
      cache: cache, grantScope: scope, offline: index, networkEnabled: { false },
      reachable: { false })
    let answers = LockedValue<[(remote: String, status: Int?)]>([])
    let foreign = LockedValue<[String]>([])
    MapLibreResourceProtocol.answerObserver = { url, status in
      answers.withLock { $0.append((url.absoluteString, status)) }
    }
    MapLibreResourceProtocol.foreignRequestObserver = { url in
      foreign.withLock { $0.append(url.absoluteString) }
    }
    TileflowOfflineSwitch.shared.isNetworkEnabled = false

    // The corner of z9 tiles 250–251 / 192–193, the centre of z8 tile 125/96.
    let window = MountedMap.sceneWindow()
    defer { window.isHidden = true }
    let engine = NativeMapEngine(
      frame: window.bounds, loader: loader, grantScope: scope, offline: index)
    defer { engine.retire(.disposed) }
    window.rootViewController?.view.addSubview(engine.view)
    var warnings: [JSONValue] = []
    let content = expectation(description: "Content ready")
    engine.onEvent = { event, value in
      if event == "contentReady" { content.fulfill() }
      if event == "warning" { warnings.append(value) }
    }
    let ready = expectation(description: "Engine ready")
    engine.onReady = { ready.fulfill() }
    engine.start()
    await fulfillment(of: [ready], timeout: 10)
    let camera = TileflowCamera(
      longitude: Self.longitude(x: 125.5, z: 8), latitude: Self.latitude(y: 96.5, z: 8),
      zoom: 9.5)
    _ = try await engine.call(
      .initialize,
      payload: .object([
        "source": .object([
          "map": .string("map"), "manifestUrl": .string(discovery), "discoveryMapId": .string(mapID),
        ]),
        "theme": .null, "colorScheme": .string("light"), "camera": try .encoded(camera),
        "credits": .array(credits.map(\.wireValue)),
      ]))
    await fulfillment(of: [content], timeout: 30)
    // Let anything that failed be retried before reading the picture.
    try await Task.sleep(nanoseconds: 2_000_000_000)

    var statuses: [String: Int] = [:]
    let parsed = try XCTUnwrap(OfflineTileTemplate(template))
    for answer in answers.withLock({ $0 }) {
      guard let tile = parsed.tile(answer.remote) else { continue }
      statuses[tile.name] = answer.status ?? -1
    }
    XCTAssertEqual(statuses["8/125/96"], 200, "The engine did not ask for the stored parent")
    XCTAssertEqual(statuses["9/250/193"], 200)
    for absent in ["9/250/192", "9/251/192", "9/251/193"] {
      XCTAssertEqual(statuses[absent], 204, absent)
    }
    XCTAssertTrue(
      statuses.keys.allSatisfy { Int($0.split(separator: "/")[0])! >= 8 },
      "The engine asked for ancestors the region cannot hold: \(statuses)")
    XCTAssertEqual(warnings, [], "Every tile answered")
    XCTAssertEqual(foreign.withLock { $0 }, [])

    let pixels = PixelReader(Self.snapshot(window))
    let center = CGPoint(x: pixels.width / 2, y: pixels.height / 2)
    let quadrants: [(String, CGPoint, UInt32)] = [
      ("north-west, absent", CGPoint(x: center.x - 100, y: center.y - 200), parentColour),
      ("north-east, absent", CGPoint(x: center.x + 100, y: center.y - 200), parentColour),
      ("south-east, absent", CGPoint(x: center.x + 100, y: center.y + 200), parentColour),
      ("south-west, stored", CGPoint(x: center.x - 100, y: center.y + 200), childColour),
    ]
    for (name, point, colour) in quadrants {
      XCTAssertTrue(
        pixels.matches(point, colour, tolerance: 16), "\(name) is \(pixels.hex(point))")
    }

    // The regional credit of the release shows while its box is in view.
    let emodnet = try XCTUnwrap(credits.first)
    XCTAssertTrue(engine.attribution.entries.contains { $0.text == emodnet.text })
    let moved = expectation(description: "Camera moved away")
    moved.assertForOverFulfill = false
    let previous = engine.attribution.entries
    engine.apply(TileflowCamera(longitude: 139.7, latitude: 35.7, zoom: 9.5))
    Task {
      while engine.attribution.entries == previous {
        try await Task.sleep(nanoseconds: 50_000_000)
      }
      moved.fulfill()
    }
    await fulfillment(of: [moved], timeout: 10)
    XCTAssertFalse(engine.attribution.entries.contains { $0.text == emodnet.text })
  }

  // MARK: Support

  private func terrarium(_ name: String) throws -> Data {
    try Data(
      contentsOf: XCTUnwrap(
        Bundle.module.url(forResource: name, withExtension: "webp", subdirectory: "Fixtures/Marine")))
  }

  private func write(_ kind: OfflinePackKind, _ entries: [OfflinePackBuilder.Entry]) throws -> URL {
    let file = directory.appendingPathComponent("\(UUID().uuidString).tfpack")
    try OfflinePackBuilder.build(kind, entries).write(to: file)
    return file
  }

  static func longitude(x: Double, z: Int) -> Double { x / Double(1 << z) * 360 - 180 }

  static func latitude(y: Double, z: Int) -> Double {
    atan(sinh(Double.pi * (1 - 2 * y / Double(1 << z)))) * 180 / .pi
  }

  /// The window as the screen shows it, including MapLibre's Metal layer.
  static func snapshot(_ window: UIWindow) -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
      window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }
  }
}

/// Reads pixels of a rendered image.
struct PixelReader {
  let width: Int
  let height: Int
  private let bytes: [UInt8]

  init(_ image: UIImage) {
    let cgImage = image.cgImage!
    width = cgImage.width
    height = cgImage.height
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let context = CGContext(
      data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    self.bytes = bytes
  }

  /// RGB at `point`, top-left origin.
  func rgb(_ point: CGPoint) -> (r: Int, g: Int, b: Int) {
    let x = min(max(Int(point.x), 0), width - 1)
    let y = min(max(Int(point.y), 0), height - 1)
    let offset = (y * width + x) * 4
    return (Int(bytes[offset]), Int(bytes[offset + 1]), Int(bytes[offset + 2]))
  }

  func matches(_ point: CGPoint, _ hex: UInt32, tolerance: Int = 12) -> Bool {
    let pixel = rgb(point)
    return abs(pixel.r - Int(hex >> 16 & 0xff)) <= tolerance
      && abs(pixel.g - Int(hex >> 8 & 0xff)) <= tolerance
      && abs(pixel.b - Int(hex & 0xff)) <= tolerance
  }

  func hex(_ point: CGPoint) -> String {
    let pixel = rgb(point)
    return String(format: "#%02x%02x%02x", pixel.r, pixel.g, pixel.b)
  }
}
