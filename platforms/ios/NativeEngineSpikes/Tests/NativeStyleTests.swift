import MapLibre
import XCTest

@testable import Tileflow

/// Streets' twelve native themes, as `packages/dev` writes them for the native renderer, load in
/// MapLibre Native iOS through the interception: sprite, font faces, a label drawn with a font face
/// and a colour read from global state.
///
/// Start the fixture server with `TILEFLOW_NATIVE_BUILD_DIR` set to the native build directory
/// (`<out>/build/native` from `scripts/streets-native-styles.ts`). The style's World and terrain
/// sources point at production services; they are replaced with the fixture's city tiles and an
/// absent elevation template, so nothing leaves the machine.
@MainActor
final class NativeStyleTests: XCTestCase {
  private static let themes = [
    "dark", "dark-faded", "dark-monochrome", "dawn", "dawn-faded", "dawn-monochrome", "dusk",
    "dusk-faded", "dusk-monochrome", "faded", "light", "monochrome",
  ]
  private let center = CLLocationCoordinate2D(latitude: 40.42, longitude: -3.7)
  private let marker = CLLocationCoordinate2D(latitude: 40.4215, longitude: -3.7)
  private let labelColour: UInt32 = 0xff00ff

  override func setUp() async throws {
    try await FixtureCounters.require()
    try await EngineNetwork.install()
    EngineURLProtocol.reset()
    _ = EngineLog.drain()
  }

  func testStreetsNativeThemesLoad() async throws {
    let origin = SpikeEnvironment.origin
    let loader = ResourceLoader(
      policy: ResourcePolicy(origins: [origin], allowsLoopbackHTTP: true), cache: nil)
    let context = TransportAddress.newContext()
    EngineURLProtocol.register(loader, context: context)
    defer {
      EngineURLProtocol.unregister(context: context)
      loader.close()
    }
    let harness = MapHarness()
    defer { harness.close() }
    harness.mapView.setCenter(center, zoomLevel: 16, animated: false)
    var rows: [[String: Any]] = []
    var failures: [String] = []
    for theme in Self.themes {
      EngineURLProtocol.reset()
      _ = EngineLog.drain()
      let styleURL = URL(string: "\(origin)/native-build/styles/streets/\(theme).json")!
      let json: String
      let layerCount: Int
      do {
        let style = try await StyleProjection.document(styleURL, loader: loader)
        layerCount = (style["layers"] as? [Any])?.count ?? 0
        var projection = StyleProjection(context: context, loader: loader)
        let projected = try await projection.project(
          prepared(style, theme: theme), styleURL: styleURL)
        json = try StyleProjection.json(projected)
      } catch {
        failures.append("\(theme): \(error)")
        continue
      }
      let started = Date()
      var row: [String: Any] = ["theme": theme, "styleLayers": layerCount]
      do {
        try await harness.load(styleJSON: json, timeout: 30)
      } catch {
        row["loadError"] = "\(error)"
        failures.append("\(theme) did not load: \(error)")
        rows.append(row)
        continue
      }
      row["styleLoadSeconds"] = Date().timeIntervalSince(started)
      row["engineLayers"] = harness.mapView.style?.layers.count ?? -1
      let rendered = await harness.waitUntilRendered(timeout: 20)
      row["fullyRendered"] = rendered
      let markerPoint = harness.mapView.convert(marker, toPointTo: harness.mapView)
      let before = PixelReader(harness.snapshot())
      let stateBefore = before.hex(markerPoint)
      let baseline = harness.fullyRenderedFrames
      harness.mapView.style?.setGlobalStateValue("#ff0000", forProperty: "spike-colour")
      await harness.waitUntilRendered(timeout: 10, after: baseline)
      let image = harness.snapshot()
      SpikeEnvironment.write(image, to: "streets-\(theme).png")
      let pixels = PixelReader(image)
      let all = CGRect(x: 0, y: 0, width: pixels.width, height: pixels.height)
      let labels = harness.mapView.visibleFeatures(
        in: harness.mapView.bounds, styleLayerIdentifiers: ["spike-label"])
      let requests = EngineURLProtocol.requests
      func summary(_ filter: (String) -> Bool) -> [String] {
        requests.filter { filter($0.remote ?? "") }.map {
          "\($0.status ?? -1) \($0.bytes)B \(($0.remote ?? "").replacingOccurrences(of: origin, with: ""))"
        }
      }
      row["sprite"] = summary { $0.contains("/icons/") }
      row["fontFaces"] = summary { $0.contains("/fonts/") }
      row["tiles"] = summary { $0.contains("/city/") || $0.contains("/absent/") }.count
      row["failedRequests"] = requests.filter { ($0.status ?? 0) >= 400 && !($0.remote ?? "").contains("/absent/") }.map(\.description)
      row["escaped"] = EngineURLProtocol.escaped
      row["engineWarnings"] = EngineLog.drain()
      row["missingImages"] = harness.missingImages.count
      row["labelPixels"] = pixels.count(in: all, step: 1, labelColour, tolerance: 60)
      row["labelFeaturesPlaced"] = labels.count
      row["globalStateBefore"] = stateBefore
      row["globalStateAfter"] = pixels.hex(markerPoint)
      rows.append(row)

      if (row["labelPixels"] as? Int ?? 0) == 0 { failures.append("\(theme): no label drawn") }
      if !before.matches(markerPoint, 0x00ff00, tolerance: 30) {
        failures.append("\(theme): global state default not drawn (\(stateBefore))")
      }
      if !pixels.matches(markerPoint, 0xff0000, tolerance: 30) {
        failures.append("\(theme): global state change not drawn (\(pixels.hex(markerPoint)))")
      }
      if !EngineURLProtocol.escaped.isEmpty { failures.append("\(theme): escaped requests") }
    }
    SpikeEnvironment.write(
      SpikeEnvironment.json([
        "device": SpikeEnvironment.device,
        "maplibre": Bundle(for: MLNMapView.self).infoDictionary?["CFBundleShortVersionString"]
          ?? "?", "date": ISO8601DateFormatter().string(from: Date()), "themes": rows,
        "failures": failures,
      ]), to: "streets-native.json")
    XCTAssertEqual(failures, [])
  }

  /// The sprite and a font face with a query: the engine's suffixes go before it.
  func testSuffixesGoBeforeTheQuery() async throws {
    let origin = SpikeEnvironment.origin
    let loader = ResourceLoader(
      policy: ResourcePolicy(origins: [origin], allowsLoopbackHTTP: true), cache: nil)
    let context = TransportAddress.newContext()
    EngineURLProtocol.register(loader, context: context)
    defer {
      EngineURLProtocol.unregister(context: context)
      loader.close()
    }
    let styleURL = URL(string: "\(origin)/native-build/styles/streets/light.json")!
    var style = prepared(try await StyleProjection.document(styleURL, loader: loader), theme: "light")
    style["sprite"] = "../../icons/streets/sprite?release=1"
    style["glyphs"] = "\(origin)/glyphs/{fontstack}/{range}.pbf?release=1"
    var layers = style["layers"] as! [[String: Any]]
    // A font stack without a font face, so the engine asks the glyphs template for it.
    layers.append([
      "id": "glyph-label", "type": "symbol", "source": "spike-label",
      "layout": ["text-field": "Glyphs", "text-font": ["Fixture Sans, Bold"], "text-allow-overlap": true],
    ])
    style["layers"] = layers
    var projection = StyleProjection(context: context, loader: loader)
    let projected = try await projection.project(style, styleURL: styleURL)
    let harness = MapHarness()
    defer { harness.close() }
    harness.mapView.setCenter(center, zoomLevel: 16, animated: false)
    try await harness.load(styleJSON: try StyleProjection.json(projected))
    await harness.waitUntilRendered(timeout: 20)
    let remote = EngineURLProtocol.requests.compactMap(\.remote)
    let transport = EngineURLProtocol.requests.map(\.transport)
    SpikeEnvironment.write(
      SpikeEnvironment.json(["remote": remote, "transport": transport]), to: "suffixes-query.json")
    XCTAssertTrue(remote.contains("\(origin)/native-build/icons/streets/sprite@2x.json?release=1"))
    XCTAssertTrue(remote.contains("\(origin)/native-build/icons/streets/sprite@2x.png?release=1"))
    // The engine percent-encodes the font stack with lowercase hex (`%2c`), unlike
    // `encodeURIComponent` (`%2C`).
    XCTAssertTrue(
      remote.contains("\(origin)/glyphs/Fixture%20Sans%2c%20Bold/0-255.pbf?release=1"), "\(remote)")
  }

  /// The theme with its production data sources replaced by the fixture's, a label drawn with
  /// one of the theme's font faces and a marker coloured by global state.
  private func prepared(_ style: [String: Any], theme: String) -> [String: Any] {
    let origin = SpikeEnvironment.origin
    var style = style
    var sources = style["sources"] as? [String: Any] ?? [:]
    if var world = sources["tileflow"] as? [String: Any] {
      world.removeValue(forKey: "url")
      world["tiles"] = ["\(origin)/city/{z}/{x}/{y}.mvt"]
      world["minzoom"] = 13
      world["maxzoom"] = 15
      sources["tileflow"] = world
    }
    if var terrain = sources["tileflow-terrain"] as? [String: Any] {
      terrain["tiles"] = ["\(origin)/native-build/absent/{z}/{x}/{y}.png"]
      sources["tileflow-terrain"] = terrain
    }
    sources["spike-label"] = [
      "type": "geojson",
      "data": [
        "type": "FeatureCollection",
        "features": [
          [
            "type": "Feature", "properties": ["kind": "label"],
            "geometry": ["type": "Point", "coordinates": [center.longitude, center.latitude]],
          ],
          [
            "type": "Feature", "properties": ["kind": "state"],
            "geometry": ["type": "Point", "coordinates": [marker.longitude, marker.latitude]],
          ],
        ],
      ],
    ]
    style["sources"] = sources
    style["state"] = ["spike-colour": ["default": "#00ff00"]]
    var layers = style["layers"] as? [[String: Any]] ?? []
    layers.append([
      "id": "spike-state", "type": "circle", "source": "spike-label",
      "filter": ["==", ["get", "kind"], "state"],
      "paint": ["circle-radius": 30, "circle-color": ["to-color", ["global-state", "spike-colour"]]],
    ])
    layers.append([
      "id": "spike-label", "type": "symbol", "source": "spike-label",
      "filter": ["==", ["get", "kind"], "label"],
      "layout": [
        "text-field": "Tileflow 123", "text-font": ["Noto Sans Regular"], "text-size": 40,
        "text-allow-overlap": true, "text-ignore-placement": true,
      ],
      "paint": ["text-color": "#ff00ff"],
    ])
    style["layers"] = layers
    return style
  }
}
