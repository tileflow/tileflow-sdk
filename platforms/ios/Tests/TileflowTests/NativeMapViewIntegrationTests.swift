import Foundation
import MapLibre
import UIKit
import XCTest

@testable import Tileflow

/// The map view's integration checks on MapLibre Native: loading, theme changes, blends, emphasis,
/// the view mode, degradation warnings, renderer recovery and camera events. They use the fixture's
/// self-hosted map built for the native renderer (`/native/manifest.json`) and its Hosted map's
/// `native-v1` representation. There is no data channel to a web process: what the WebView suite
/// reads with JavaScript, these checks read from the view and its engine.
@MainActor
final class NativeMapViewIntegrationTests: XCTestCase {
  static let nativeManifest = URL(string: "\(FixtureServer.origin)/native/manifest.json")!
  static let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)

  /// The native map is built when the fixture server starts; the first request waits for it.
  private func requireNativeFixture() async throws {
    var request = URLRequest(url: Self.nativeManifest)
    request.timeoutInterval = 180
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run native map integration.")
    }
  }

  private var citySource: TileflowMapSource {
    TileflowMapSource(map: "city", manifestURL: Self.nativeManifest, allowsLoopbackHTTP: true)
  }

  func testRuntimeJSONSurvivesThemeAndCanBeRemoved() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native

    do {
      try await view.addSource(
        id: "remote", properties: ["type": "geojson", "data": "file:///outside-map.geojson"])
      XCTFail("Expected invalidRequest before mount")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error, .invalidRequest)
    }
    XCTAssertFalse(view.sourceExists("remote"))

    let data: [String: Any] = ["type": "Point", "coordinates": [-3.70, 40.42]]
    try await view.addSource(id: "places", properties: ["type": "geojson", "data": data])
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    try await view.addLayer(properties: [
      "id": "points", "type": "circle", "source": "places", "paint": ["circle-radius": 11],
    ])

    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    try await view.addLayer(
      TileflowCircleLayer(id: "under", source: "places"), position: .below("points"))
    do {
      try await view.addLayer(properties: [
        "id": "bad", "type": "circle", "source": "places", "paint": ["circle-radius": -1],
      ])
      XCTFail("Expected invalidRequest")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error, .invalidRequest)
    }
    XCTAssertFalse(view.layerExists("bad"))

    func checkStyle() async throws {
      let map = try XCTUnwrap(engine.mapView)
      let style = try XCTUnwrap(map.style)
      let layer = try XCTUnwrap(
        style.layer(withIdentifier: "__tileflow_layer_points") as? MLNCircleStyleLayer)
      XCTAssertEqual(layer.circleRadius.constantValue as? NSNumber, 11)
      XCTAssertEqual(
        style.layers.suffix(2).map(\.identifier),
        ["__tileflow_layer_under", "__tileflow_layer_points"])

      let point = try await view.project(Self.center)
      try await waitUntil {
        !map.visibleFeatures(at: point, styleLayerIdentifiers: [layer.identifier]).isEmpty
      }
    }
    try await checkStyle()
    try await view.setTheme("dark")
    try await checkStyle()

    try await view.removeLayer("under")
    try await view.removeLayer("points")
    try await view.removeSource("places")
    XCTAssertNil(engine.mapView?.style?.layer(withIdentifier: "__tileflow_layer_points"))
    XCTAssertNil(engine.mapView?.style?.source(withIdentifier: "__tileflow_source_places"))
  }

  func testNativeClusteredStyleSurvivesThemeAndRenderer() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(
      source: citySource, initialCamera: .init(longitude: -3.7, latitude: 40.42, zoom: 9))
    view.engineKind = .native
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    try await view.addSource(
      TileflowGeoJSONSource(
        id: "points", data: .geoJSON(MapStyleIntegrationTests.points(100_000)), cluster: true,
        clusterRadius: 50, clusterProperties: ["rankSum": .sum(.get("rank"))]))

    var clusters = TileflowCircleLayer(id: "clusters", source: "points")
    clusters.filter = .has("point_count")
    clusters.circleColor = .expression(
      .step(.get("point_count"), "#51bbd6", 100, "#f1f075", 750, "#f28cb1"))
    clusters.circleRadius = .expression(.step(.get("point_count"), 16, 100, 22, 750, 30))
    clusters.slot = .aboveLabels
    try await view.addLayer(clusters)
    var point = TileflowCircleLayer(id: "point", source: "points")
    point.filter = .not(.has("point_count"))
    point.circleRadius = 5
    point.circleColor = .expression(
      .switchCase(.boolean(.featureState("selected"), false), "#ff0000", "#11b4da"))
    try await view.addLayer(point)
    var heat = TileflowHeatmapLayer(id: "heat", source: "points")
    heat.maxZoom = 9
    try await view.addLayer(heat, position: .below("clusters"))
    try await view.addImage(MapStyleIntegrationTests.sdfDisc())
    var marks = TileflowSymbolLayer(id: "marks", source: "points")
    marks.filter = .not(.has("point_count"))
    marks.iconImage = "disc"
    marks.iconColor = "#2a9d8f"
    marks.iconAllowOverlap = true
    try await view.addLayer(marks)
    XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["heat", "clusters", "point", "marks"])

    func hits(_ id: String, at geometry: TileflowQueryGeometry = .view) async throws
      -> [TileflowQueriedFeature]
    {
      for _ in 0..<200 {
        let features = try await view.queryRenderedFeatures(
          in: geometry, options: .init(layerIds: [id]))
        if !features.isEmpty { return features }
        try await Task.sleep(for: .milliseconds(50))
      }
      return []
    }
    let clustersHit = try await hits("clusters")
    let largest = try XCTUnwrap(
      clustersHit.max {
        ($0.feature.properties["point_count"]?.number ?? 0)
          < ($1.feature.properties["point_count"]?.number ?? 0)
      })
    let cluster = try XCTUnwrap(largest.feature.clusterId)
    XCTAssertGreaterThan(largest.feature.properties["rankSum"]?.number ?? 0, 0)
    let children = try await view.clusterChildren(sourceId: "points", clusterId: cluster)
    XCTAssertGreaterThan(children.count, 1)
    let leaves = try await view.clusterLeaves(sourceId: "points", clusterId: cluster, limit: 2000)
    XCTAssertEqual(
      leaves.count, min(2000, Int(largest.feature.properties["point_count"]?.number ?? 0)))
    let zoom = try await view.clusterExpansionZoom(sourceId: "points", clusterId: cluster)
    XCTAssertGreaterThan(zoom, 9)

    try await view.move(
      to: .init(longitude: -3.7, latitude: 40.42, zoom: 12, pitch: 80), animation: .none)
    var steep: [TileflowQueriedFeature] = []
    for _ in 0..<100 {
      steep = try await view.queryRenderedFeatures(options: .init(limit: 100_000))
      if !steep.isEmpty { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTAssertFalse(steep.isEmpty)

    let center = TileflowCoordinate(longitude: -3.895, latitude: 40.3)
    try await view.setFeatureState(sourceId: "points", featureId: "5", state: ["selected": true])
    try await view.move(
      to: .init(longitude: center.longitude, latitude: center.latitude, zoom: 17), animation: .none)
    func checkSelected() async throws {
      let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
      let native = try XCTUnwrap(engine.mapView?.style)
      let source = try XCTUnwrap(
        native.source(withIdentifier: "__tileflow_source_points") as? MLNShapeSource)
      try await waitUntil(seconds: 5) { source.featureState(featureID: "5")?["selected"] as? Bool == true }
      XCTAssertEqual(native.image(forName: "disc")?.renderingMode, .alwaysTemplate)
      let at = try await view.project(center)
      let rendered = try await hits("point", at: .point(at))
      XCTAssertTrue(rendered.contains { $0.feature.id == "5" && $0.state["selected"] == true })
      let symbols = try await hits("marks", at: .point(at))
      XCTAssertTrue(symbols.contains { $0.feature.id == "5" })
    }
    try await checkSelected()
    try await view.setTheme("dark")
    try await checkSelected()
    try view.reload()
    try await events.waitForLoads(2)
    try await checkSelected()
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  func testNativeSourceAndLayerKindsUseTheMapTransport() async throws {
    try await requireNativeFixture()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let events = NativeMapEvents()
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let base = FixtureServer.origin
    try await view.addSource(
      id: "places", properties: ["type": "geojson", "data": base + "/data.json"])
    do {
      try await view.addSource(id: "volatile", properties: [
        "type": "vector", "tiles": [base + "/city/{z}/{x}/{y}.mvt"], "volatile": true,
      ])
      XCTFail("Expected a cache policy the renderer cannot apply to be rejected")
    } catch let error as TileflowMapError { XCTAssertEqual(error, .invalidRequest) }
    XCTAssertFalse(view.sourceExists("volatile"))
    try await view.addSource(
      id: "opentiles", properties: ["type": "vector", "tiles": [base + "/city/{z}/{x}/{y}.mvt"]])
    try await view.addSource(
      id: "tiles",
      properties: ["type": "raster", "tiles": [base + "/imagery/{z}/{x}/{y}.png"], "tileSize": 256])
    try await view.addSource(
      id: "terrain",
      properties: [
        "type": "raster-dem", "tiles": [base + "/relief/{z}/{x}/{y}.png"], "encoding": "terrarium",
      ])
    try await view.addSource(
      id: "overlay",
      properties: [
        "type": "image", "url": base + "/overlay.png",
        "coordinates": [[-3.71, 40.43], [-3.69, 40.43], [-3.69, 40.41], [-3.71, 40.41]],
      ])

    let style = try XCTUnwrap(engine.mapView?.style)
    XCTAssertTrue(style.source(withIdentifier: "__tileflow_source_places") is MLNShapeSource)
    XCTAssertTrue(
      style.source(withIdentifier: "__tileflow_source_opentiles") is MLNVectorTileSource)
    XCTAssertTrue(style.source(withIdentifier: "__tileflow_source_tiles") is MLNRasterTileSource)
    XCTAssertTrue(style.source(withIdentifier: "__tileflow_source_terrain") is MLNRasterDEMSource)
    let image = try XCTUnwrap(
      style.source(withIdentifier: "__tileflow_source_overlay") as? MLNImageSource)
    // An image destined for the network must still use this map's routing context.
    XCTAssertEqual(image.url?.host, MapResourceAddress.host)

    let definitions: [(String, String?)] = [
      ("fill", "places"), ("line", "opentiles"), ("circle", "places"), ("symbol", "places"),
      ("heatmap", "places"), ("fill-extrusion", "places"), ("raster", "tiles"),
      ("color-relief", "terrain"), ("hillshade", "terrain"), ("background", nil),
    ]
    for (type, source) in definitions {
      var spec: [String: Any] = ["type": type, "id": type, "minzoom": 23, "slot": "below-labels"]
      if let source { spec["source"] = source }
      if type == "line" {
        spec["source-layer"] = "transportation"; spec["layout"] = ["line-cap": "round"]
      }
      try await view.addLayer(properties: spec)
      XCTAssertNotNil(style.layer(withIdentifier: "__tileflow_layer_" + type))
    }
    try await view.addLayer(properties: [
      "type": "raster", "id": "photo", "source": "overlay", "minzoom": 23,
    ])

    try await view.moveLayer("photo", position: .below("fill"))
    let order = style.layers.map(\.identifier)
    XCTAssertLessThan(
      try XCTUnwrap(order.firstIndex(of: "__tileflow_layer_photo")),
      try XCTUnwrap(order.firstIndex(of: "__tileflow_layer_fill")))
    for id in definitions.map(\.0) + ["photo"] { try await view.removeLayer(id) }
    for id in ["places", "opentiles", "tiles", "terrain", "overlay"] {
      try await view.removeSource(id)
    }
  }

  func testNativeFeatureUpdatesAndPolygonQueries() async throws {
    try await requireNativeFixture()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let events = NativeMapEvents()
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    try await view.addSource(TileflowGeoJSONSource(id: "points", data: .empty))
    var circles = TileflowCircleLayer(id: "items", source: "points")
    circles.circleRadius = 8
    try await view.addLayer(circles)
    circles.circleRadius = 9
    try await view.updateLayer(circles)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let edited = try XCTUnwrap(
      engine.mapView?.style?.layer(withIdentifier: "__tileflow_layer_items") as? MLNCircleStyleLayer
    )
    XCTAssertEqual(edited.circleRadius.constantValue as? NSNumber, 9)

    let one = try await view.unproject(CGPoint(x: 80, y: 80))
    let two = try await view.unproject(CGPoint(x: 160, y: 160))
    try await view.addGeoJSONSourceFeatures(
      sourceId: "points",
      features: [
        TileflowFeature(id: "1", geometry: .point(one), properties: ["rank": 1]),
        TileflowFeature(id: "2", geometry: .point(two), properties: ["rank": 2]),
      ])
    let box = TileflowQueryGeometry.box(CGRect(x: 50, y: 50, width: 150, height: 150))
    let triangle = TileflowQueryGeometry.polygon([
      CGPoint(x: 50, y: 50), CGPoint(x: 200, y: 50), CGPoint(x: 50, y: 200),
    ])
    func ids(_ shape: TileflowQueryGeometry) async throws -> Set<String> {
      Set(
        try await view.queryRenderedFeatures(in: shape, options: .init(layerIds: ["items"]))
          .compactMap { $0.feature.id })
    }
    for _ in 0..<100 {
      if try await ids(box) == ["1", "2"] { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    let boxHits = try await ids(box)
    let polygonHits = try await ids(triangle)
    XCTAssertEqual(boxHits, ["1", "2"])
    XCTAssertEqual(polygonHits, ["1"])

    try await view.updateGeoJSONSourceFeatures(
      sourceId: "points",
      features: [TileflowFeature(id: "1", geometry: .point(two), properties: ["rank": 3])])
    try await view.removeGeoJSONSourceFeatures(sourceId: "points", featureIds: ["2"])
    var last: [TileflowQueriedFeature] = []
    for _ in 0..<100 {
      last = try await view.querySourceFeatures(sourceId: "points")
      if last.count == 1 && last.first?.feature.properties["rank"]?.number == 3 { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTAssertEqual(last.compactMap { $0.feature.id }, ["1"])
    XCTAssertEqual(last.first?.feature.properties["rank"]?.number, 3)
    let final = try await ids(triangle)
    XCTAssertTrue(final.isEmpty)
  }

  func testFilteredGeoJSONRemovesAFeatureWhenItsPropertiesChange() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let first = TileflowFeature(id: "1", geometry: .point(Self.center), properties: ["rank": 1])
    var source = TileflowGeoJSONSource(id: "ranked", data: .features([first]))
    source.filter = .eq(.get("rank"), 1)
    try await view.addSource(source)
    try await view.addLayer(TileflowCircleLayer(id: "ranked-points", source: "ranked"))
    let at = try await view.project(Self.center)
    func visible() async throws -> Bool {
      try await view.queryRenderedFeatures(
        in: .point(at), options: .init(layerIds: ["ranked-points"])
      ).contains { $0.feature.id == "1" }
    }
    for _ in 0..<100 {
      if try await visible() { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    let before = try await visible()
    XCTAssertTrue(before)
    var changed = first
    changed.properties["rank"] = 0
    try await view.updateGeoJSONSourceFeatures(sourceId: "ranked", features: [changed])
    for _ in 0..<100 {
      if try await !visible() { break }
      try await Task.sleep(for: .milliseconds(50))
    }
    let after = try await visible()
    XCTAssertFalse(after)
  }

  func testCallerCanCancelAnInFlightSourceRead() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }

    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let sent = engine.received[.addSource, default: 0]
    let pending = Task { @MainActor in
      try await view.addSource(
        id: "cancelled",
        properties: ["type": "vector", "url": "\(FixtureServer.origin)/runtime-style/invalid-tiles.json"])
    }
    try await waitUntil { engine.received[.addSource, default: 0] > sent }
    pending.cancel()
    do {
      try await pending.value
      XCTFail("The source was added after the caller cancelled")
    } catch is CancellationError {}
    XCTAssertFalse(view.sourceExists("cancelled"))
    XCTAssertNil(engine.mapView?.style?.source(withIdentifier: "__tileflow_source_cancelled"))
  }

  func testReloadCancelsThePreviousRenderersSourceLoad() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let initial = try XCTUnwrap(view.engine as? NativeMapEngine)
    let count = initial.received[.addSource, default: 0]
    let loading = Task { @MainActor in
      try await view.addSource(
        id: "retired",
        properties: [
          "type": "vector", "url": FixtureServer.origin + "/runtime-style/invalid-tiles.json",
        ])
    }
    try await waitUntil { initial.received[.addSource, default: 0] > count }
    try view.reload()
    do {
      try await loading.value
      XCTFail("Expected the request to retire with its renderer")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error, .cancelled)
    }
    XCTAssertNil(initial.mapView?.style?.source(withIdentifier: "__tileflow_source_retired"))
    try await waitUntil(seconds: 5) { events.loads == 2 || !events.failures.isEmpty }
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    XCTAssertEqual(events.loads, 2)
    XCTAssertFalse(view.sourceExists("retired"))
    let replacement = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertNil(replacement.mapView?.style?.source(withIdentifier: "__tileflow_source_retired"))
  }

  func testConcurrentSourceRejectionKeepsTheSuccessfulSource() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let initial = try XCTUnwrap(view.engine as? NativeMapEngine)
    let baseline = initial.received[.addSource, default: 0]
    let rejected = Task { @MainActor in
      try await view.addSource(
        id: "rejected", properties: [
          "type": "vector", "url": FixtureServer.origin + "/runtime-style/invalid-tiles.json",
        ])
    }
    try await waitUntil { initial.received[.addSource, default: 0] > baseline }
    let point: [String: Any] = ["type": "Point", "coordinates": [-3.70, 40.42]]
    try await view.addSource(id: "kept", properties: ["type": "geojson", "data": point])
    do {
      try await rejected.value
      XCTFail("Expected invalid TileJSON to fail")
    } catch let failure as TileflowMapError {
      XCTAssertEqual(failure.code, .resourceFailed)
    }

    func check(_ engine: NativeMapEngine) {
      XCTAssertFalse(view.sourceExists("rejected"))
      XCTAssertTrue(view.sourceExists("kept"))
      XCTAssertNil(engine.mapView?.style?.source(withIdentifier: "__tileflow_source_rejected"))
      XCTAssertNotNil(engine.mapView?.style?.source(withIdentifier: "__tileflow_source_kept"))
    }
    check(initial)
    try view.reload()
    // A rejected source left in the registry fails replay before the map becomes ready.
    try await waitUntil(seconds: 5) { events.loads == 2 || !events.failures.isEmpty }
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    XCTAssertEqual(events.loads, 2)
    check(try XCTUnwrap(view.engine as? NativeMapEngine))
  }

  func testSceneLightStateBoundariesAndImageVariantsReachMapLibre() async throws {
    let source = TileflowMapSource(
      map: "appearance", manifestURL: Self.nativeManifest, allowsLoopbackHTTP: true)
    let events = NativeMapEvents()
    let view = TileflowMapView(source: source)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    func style() throws -> MLNStyle { try XCTUnwrap(engine.mapView?.style) }
    let before = try XCTUnwrap(try style().light.position.constantValue as? NSValue)
      .mlnSphericalPositionValue
    try await view.setSun(.direction(azimuth: 15, altitude: 23), duration: 0.05)
    var lit = try XCTUnwrap(try style().light.position.constantValue as? NSValue)
      .mlnSphericalPositionValue
    XCTAssertEqual(lit.azimuthal, 15, accuracy: 0.01)
    XCTAssertEqual(lit.polar, 67, accuracy: 0.01)
    try await view.setSun(nil)
    lit = try XCTUnwrap(try style().light.position.constantValue as? NSValue)
      .mlnSphericalPositionValue
    XCTAssertEqual(lit.azimuthal, before.azimuthal, accuracy: 0.01)
    XCTAssertEqual(lit.polar, before.polar, accuracy: 0.01)

    try await view.setStyleState("fixture-mode", to: "test")
    try await view.setStyleState("fixture-opacity", to: 0)
    try await view.setStyleState("fixture-opacity", to: 0.75, duration: 0.1)
    XCTAssertEqual(try style().globalState["fixture-opacity"] as? Double, 0.75)
    XCTAssertEqual(try style().globalState["fixture-mode"] as? String, "test")

    func pixels(_ color: UIColor) -> UIImage {
      let renderer = UIGraphicsImageRenderer(size: CGSize(width: 8, height: 8))
      return renderer.image { context in
        color.setFill(); context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
      }
    }
    try await view.setImages([
      try .init(name: "pin", image: pixels(.red), variants: ["dark": pixels(.blue)])
    ])
    let light = try XCTUnwrap(try style().image(forName: "pin")?.pngData())
    try await view.setBoundaryValues(.init(ids: [41: 7], labels: true, state: "score"))
    func checkScore(_ expected: Double?, layer: String = "boundary_area") async throws {
      let source = try XCTUnwrap(
        try style().source(withIdentifier: "tileflow-boundaries") as? MLNVectorTileSource)
      try await waitUntil {
        source.featureState(sourceLayerID: layer, featureID: "41")?["score"] as? Double == expected
      }
    }
    try await checkScore(7)
    try await checkScore(7, layer: "boundary_label")
    let point = try await view.project(Self.center)
    try await waitUntil {
      engine.mapView?.visibleFeatures(at: point, styleLayerIdentifiers: ["score-fill"]).contains {
        ($0.identifier as? NSNumber)?.intValue == 41
      } == true
    }
    try await view.setTheme("dark")
    try await checkScore(7)
    XCTAssertNotEqual(try style().image(forName: "pin")?.pngData(), light)
    XCTAssertEqual(try style().globalState["fixture-mode"] as? String, "test")
    try await view.setBoundaryValues(nil)
    try await checkScore(nil)
    try await view.setBlend(themes: ["light", "dark"], position: 0)
    XCTAssertEqual(try style().image(forName: "pin")?.pngData(), light)
    try await view.setBlend(themes: ["light", "dark"], position: 1)
    XCTAssertNotEqual(try style().image(forName: "pin")?.pngData(), light)
    try view.reload()
    try await events.waitForLoads(2)
    let replacement = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertEqual(replacement.mapView?.style?.globalState["fixture-opacity"] as? Double, 0.75)
    XCTAssertTrue(events.failures.isEmpty)
  }

  func testBoundaryReplacementErasesEachOldValueAndPreservesOtherKeys() async throws {
    let source = TileflowMapSource(
      map: "appearance", manifestURL: Self.nativeManifest, allowsLoopbackHTTP: true)
    let view = TileflowMapView(source: source)
    view.engineKind = .native
    let events = NativeMapEvents()
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    guard let engine = view.engine as? NativeMapEngine, let map = engine.mapView else {
      return XCTFail("A native map")
    }
    let areas = try XCTUnwrap(
      map.style?.source(withIdentifier: "tileflow-boundaries") as? MLNVectorTileSource)
    for id in ["41", "42"] {
      XCTAssertTrue(
        areas.setFeatureState(sourceLayerID: "boundary_area", featureID: id, state: ["other": true])
      )
    }
    try await view.setBoundaryValues(.init(ids: [41: 7, 42: 8], labels: true, state: "score"))
    func contains(_ layer: String, _ id: String, _ key: String) -> Bool {
      areas.featureState(sourceLayerID: layer, featureID: id)?[key] != nil
    }
    try await waitUntil {
      ["41", "42"].allSatisfy {
        contains("boundary_area", $0, "score") && contains("boundary_label", $0, "score")
      }
    }
    try await view.setBoundaryValues(.init(ids: [43: 9], state: "score"))
    try await waitUntil(seconds: 2) {
      ["41", "42"].allSatisfy {
        !contains("boundary_area", $0, "score") && !contains("boundary_label", $0, "score")
      }
    }
    XCTAssertTrue(contains("boundary_area", "43", "score"))
    XCTAssertFalse(contains("boundary_label", "43", "score"))
    XCTAssertTrue(contains("boundary_area", "41", "other"))
    XCTAssertTrue(contains("boundary_area", "42", "other"))
  }

  func testStateResetRestoresDefaultsFromTheNewThemeAndDateUsesTheMapCenter() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "scene", manifestURL: FixtureServer.manifest, allowsLoopbackHTTP: true))
    view.engineKind = .native
    let events = NativeMapEvents()
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    func style() throws -> MLNStyle { try XCTUnwrap(engine.mapView?.style) }
    try await view.setStyleState("fixture-opacity", to: 0.25)
    try await view.setStyleState("fixture-mode", to: "overridden")
    try await view.setStyleState("fixture-mode", to: .null)
    try await view.setStyleState("fixture-opacity", to: .null)
    XCTAssertEqual(try style().globalState["fixture-mode"] as? String, "base")
    XCTAssertEqual(try style().globalState["fixture-opacity"] as? Double, 1)
    let camera = try await view.camera()
    let time = 1_782_064_800.0
    let expected = NativeSun.position(
      date: time * 1000, location: .init(longitude: camera.longitude, latitude: camera.latitude))
    try await view.setSun(.date(Date(timeIntervalSince1970: time)))
    let light = try XCTUnwrap(try style().light.position.constantValue as? NSValue)
      .mlnSphericalPositionValue
    XCTAssertEqual(light.azimuthal, expected.azimuth, accuracy: 0.001)
    XCTAssertEqual(light.polar, min(90, max(0, 90 - expected.altitude)), accuracy: 0.001)
    try await view.setTheme("night")
    XCTAssertEqual(try style().globalState["fixture-mode"] as? String, "base")
    XCTAssertEqual(try style().globalState["fixture-opacity"] as? Double, 1)
  }

  func testBoundaryFeatureStateChangesRenderedDistrictPixels() async throws {
    try await checkBoundaryPixels(map: "districts", manifest: FixtureServer.manifest, layer: "district-fill")
  }

  func testCompiledBoundaryScaleChangesRenderedDistrictPixels() async throws {
    try await checkBoundaryPixels(map: "appearance", manifest: Self.nativeManifest, layer: "score-fill")
  }

  private func checkBoundaryPixels(map name: String, manifest: URL, layer: String) async throws {
    let source = TileflowMapSource(map: name, manifestURL: manifest, allowsLoopbackHTTP: true)
    let view = TileflowMapView(source: source)
    view.engineKind = .native
    let events = NativeMapEvents()
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    let map = try XCTUnwrap((view.engine as? NativeMapEngine)?.mapView)
    let point = try await view.project(Self.center)
    try await waitUntil {
      map.visibleFeatures(at: point, styleLayerIdentifiers: [layer]).contains {
        ($0.identifier as? NSNumber)?.intValue == 41
      }
    }
    let pixel = view.convert(point, to: window)
    func waitForColor(_ expected: UInt32) async throws {
      var last = ""
      for _ in 0..<60 {
        let image = PixelReader(NativeOfflineElevationTests.snapshot(window))
        last = image.hex(pixel)
        if image.matches(pixel, expected) { return }
        try await Task.sleep(for: .milliseconds(50))
      }
      XCTFail("Expected district color \(String(expected, radix:16)), saw \(last)")
    }
    try await waitForColor(0x00ff00)
    try await view.setBoundaryValues(.init(ids: [41: 1]))
    try await waitForColor(0xff0000)
    try await view.setBoundaryValues(.init(ids: [41: 2]))
    try await waitForColor(0x0000ff)
    try await view.setBoundaryValues(nil)
    try await waitForColor(0x00ff00)
  }

  func testNativeSceneDrawsProgressAndDepthSymbolsAndPlaysShots() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer { view.destroy(); window.isHidden = true }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let pin = UIGraphicsImageRenderer(size: CGSize(width: 12, height: 16)).image { context in
      UIColor.orange.setFill(); context.fill(CGRect(x: 0, y: 0, width: 12, height: 16))
    }
    try await view.setImages([try .init(name: "pin", image: pin)])
    let marker = TileflowDepthMarker(
      id: "cafe", coordinate: Self.center, image: "pin", size: CGSize(width: 12, height: 16),
      anchor: .bottom)
    try await view.setDepthMarkers([marker])
    let map = try XCTUnwrap(engine.mapView)
    let at = try await view.project(Self.center)
    try await waitUntil {
      !map.visibleFeatures(at: at, styleLayerIdentifiers: ["__tileflow_depth_cafe"]).isEmpty
    }
    do {
      var invalid = marker; invalid.image = "absent"
      try await view.setDepthMarkers([invalid]); XCTFail("Expected invalidImage")
    } catch let error as TileflowMapError { XCTAssertEqual(error.context.reason, "invalidImage") }
    XCTAssertNotNil(map.style?.layer(withIdentifier: "__tileflow_depth_cafe"))

    let route = Data(
      #"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-3.715,40.415],[-3.7,40.42],[-3.685,40.425]]}}]}"#
        .utf8)
    let layer = try TileflowGeoJSONLayer(
      id: "route", geoJSON: route, kind: .line, ink: .line, placement: .ground,
      progress: .init(end: 0, highlight: "#ffffff"))
    try await view.setContent(layers: [layer])
    func gradient() throws -> JSONValue {
      let line = try XCTUnwrap(
        map.style?.layer(withIdentifier: "__tileflow_app_route") as? MLNLineStyleLayer)
      return JSONValue(foundation: line.lineGradient.mgl_jsonExpressionObject)
    }
    try await view.setContent(
      annotations: [.init(id: "pin", coordinate: Self.center, title: "Mixed")], layers: [layer])
    XCTAssertNotNil(map.style?.layer(withIdentifier: "__tileflow_app_route"))
    let initial = try gradient()
    let drawn = try await view.animateLineProgress(
      layers: ["route"], to: .init(end: 0.7, light: 0.55), duration: 0.1)
    XCTAssertTrue(drawn)
    XCTAssertNotEqual(try gradient(), initial)
    try await view.setTheme("dark")
    XCTAssertNotNil(map.style?.layer(withIdentifier: "__tileflow_app_route"))
    XCTAssertNotNil(map.style?.image(forName: "__tileflow_depth_image_cafe"))
    do {
      _ = try await view.animateLineProgress(layers: ["missing"], to: .init(), duration: 0)
      XCTFail("Expected unknownLayer")
    } catch let error as TileflowMapError { XCTAssertEqual(error.context.reason, "unknownLayer") }

    let a = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 15, bearing: 0, pitch: 5)
    let b = TileflowCamera(longitude: -3.69, latitude: 40.425, zoom: 15, bearing: 24, pitch: 40)
    var cues: [String] = []
    let shot = TileflowShot(
      keyframes: [.init(time: 0, camera: a), .init(time: 0.25, camera: b)],
      cues: [
        .init(time: 0, id: "start"), .init(time: 0.12, id: "mid"), .init(time: 0.25, id: "end"),
      ])
    let played = try await view.play(shot, onCue: { cues.append($0) })
    XCTAssertTrue(played); XCTAssertEqual(cues, ["start", "mid", "end"])
    let final = try await view.camera()
    XCTAssertEqual(final.latitude, b.latitude, accuracy: 0.00001)
    XCTAssertEqual(final.bearing, b.bearing, accuracy: 0.01)
    XCTAssertEqual(final.pitch, b.pitch, accuracy: 0.01)
    let longShot = TileflowShot(keyframes: [.init(time: 0, camera: b), .init(time: 30, camera: a)])
    let first = Task { try await view.play(longShot) }
    try await Task.sleep(for: .milliseconds(50))
    let replacement = try await view.play(shot)
    let superseded = try await first.value
    XCTAssertTrue(replacement); XCTAssertFalse(superseded)
    let cancelled = Task { try await view.play(longShot) }
    try await Task.sleep(for: .milliseconds(50)); cancelled.cancel()
    do {
      _ = try await cancelled.value; XCTFail("Expected cancellation")
    } catch is CancellationError {}
    try view.reload(); try await events.waitForLoads(2)
    let newMap = try XCTUnwrap((view.engine as? NativeMapEngine)?.mapView)
    XCTAssertNotNil(newMap.style?.layer(withIdentifier: "__tileflow_depth_cafe"))
    XCTAssertNotNil(newMap.style?.layer(withIdentifier: "__tileflow_app_route"))
    try await view.setImages([])
    XCTAssertNil(newMap.style?.layer(withIdentifier: "__tileflow_depth_cafe"))
    XCTAssertTrue(events.failures.isEmpty)
  }

  func testOnlineMapLoadsChangesThemeAndRetires() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    let initial = try await view.camera()
    XCTAssertEqual(initial.longitude, -3.70, accuracy: 0.01)
    XCTAssertEqual(initial.zoom, 16, accuracy: 0.01)
    try await assertBuildings(view)
    let point = try await view.project(Self.center)
    let coordinate = try await view.unproject(point)
    XCTAssertEqual(coordinate.longitude, -3.70, accuracy: 0.0001)
    XCTAssertEqual(coordinate.latitude, 40.42, accuracy: 0.0001)

    // Each degradation the style records arrives once, as a warning and in the console.
    try await waitUntil { Set(events.features) == ["scene3d", "sky", "trees3d"] }
    XCTAssertEqual(events.features.sorted(), ["scene3d", "sky", "trees3d"])
    let degradation = try XCTUnwrap(events.warnings.first { $0.error.context.feature == "scene3d" })
    XCTAssertEqual(degradation.error.code, .rendererFailed)
    XCTAssertEqual(degradation.error.context.reason, "featureUnavailable")

    // A theme change reports its phases and the route inks of the theme on screen.
    try await view.setTheme("dark", duration: 0.3)
    XCTAssertEqual(events.transitions.map(\.phase), [.preloading, .applying, .ready])
    XCTAssertEqual(events.transitions.last?.currentTheme, "dark")
    XCTAssertNotNil(events.transitions.last?.routeInks)
    XCTAssertEqual(events.themes, ["dark"])
    try await assertBuildings(view)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let darkInks = try await view.routeInks()

    // A blend loads one style, and moving it changes the live style without loading again.
    try await view.setBlend(themes: ["light", "dark"], position: 0.5)
    XCTAssertEqual(engine.shown?.theme, "dark")
    let loads = engine.received[.setBlend] ?? 0
    try await view.setBlend(themes: ["light", "dark"], position: 0.2)
    XCTAssertEqual(engine.received[.setBlend], loads + 1)
    XCTAssertEqual(engine.shown?.theme, "light")
    let blended = try await view.routeInks()
    XCTAssertNotEqual(blended.line, darkInks.line)
    try await assertBuildings(view)

    // Emphasis recedes a module and returns it to its design.
    try await view.setTheme("light")
    try await view.setEmphasis(.init(recede: [.buildings: 1], labels: 0.5), duration: 0.3)
    let fill = try XCTUnwrap(
      engine.mapView?.style?.layer(withIdentifier: "tileflow-buildings-fill") as? MLNFillStyleLayer)
    let receded = fill.fillColor
    try await view.setEmphasis(nil, duration: 0.2)
    XCTAssertNotEqual(fill.fillColor, receded)

    // The 3D view shows the extrusions that stand in for the scene; the flat view hides them.
    let extrusion = { engine.mapView?.style?.layer(withIdentifier: "tileflow-buildings-native-extrusion") }
    XCTAssertEqual(extrusion()?.isVisible, false)
    try await view.setViewMode(.threeDimensional, duration: 0.3)
    try await waitUntil { extrusion()?.isVisible == true && engine.viewModeMotion == nil }
    try await view.setOptions(.init(viewMode: .flat, quality: .low))
    XCTAssertEqual(extrusion()?.isVisible, false)

    try await view.setCamera(TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 14))
    let camera = try await view.camera()
    XCTAssertEqual(camera.zoom, 14, accuracy: 0.01)
    // The city's buildings draw from z15.
    try await view.setCamera(TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 16))
    try view.reload()
    try await events.waitForLoads(2)
    try await assertBuildings(view)
    XCTAssertTrue(events.failures.isEmpty, "Late map errors: \(events.failures)")
    view.destroy()
    do {
      try await view.setTheme("light")
      XCTFail("A destroyed map accepted an update.")
    } catch {
      XCTAssertEqual(error as? TileflowMapError, .disposed)
    }
  }

  func testStreetsLoadsAtCityZoomWithItsHostedClimateLayer() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let source = TileflowMapSource(
      map: "streets", manifestURL: Self.nativeManifest, allowsLoopbackHTTP: true)
    let view = TileflowMapView(source: source)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }

    try await events.waitForLoads(1)
    let camera = try await view.camera()
    let style = try XCTUnwrap((view.engine as? NativeMapEngine)?.mapView?.style)
    let climate = try XCTUnwrap(
      style.layer(withIdentifier: "tileflow-global-landcover-underlay") as? MLNRasterStyleLayer)
    XCTAssertGreaterThan(camera.zoom, Double(climate.maximumZoomLevel))
    XCTAssertTrue(
      style.source(withIdentifier: "tileflow-landcover-underlay") is MLNRasterTileSource)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  /// The city map holds a world image drawn only below zoom 11, as Streets' climate underlay is. At
  /// zoom 16 no layer draws it, which MapLibre Native takes for an image source still loading: the
  /// map must load all the same, and draw the image once the camera zooms out to it.
  func testAWorldImageOutsideItsZoomsLetsTheMapLoadAndDrawsWhenInRange() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let style = try XCTUnwrap(engine.mapView?.style)
    let underlay = try XCTUnwrap(
      style.layer(withIdentifier: "tileflow-global-landcover-underlay") as? MLNRasterStyleLayer)
    XCTAssertEqual(underlay.maximumZoomLevel, 11)
    XCTAssertTrue(style.source(withIdentifier: "tileflow-landcover-underlay") is MLNRasterTileSource)
    XCTAssertLessThan(Self.underlayShare(window), 0.01, "At zoom 16 no layer draws the image")

    try await view.setCamera(TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 5))
    try await waitUntil { Self.underlayShare(window) > 0.5 }
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  /// The share of the window in the fixture underlay's green, `#01a004`.
  private static func underlayShare(_ window: UIWindow) -> Double {
    let pixels = PixelReader(NativeOfflineElevationTests.snapshot(window))
    var green = 0
    var total = 0
    for y in stride(from: 0, to: pixels.height, by: 8) {
      for x in stride(from: 0, to: pixels.width, by: 8) {
        let pixel = pixels.rgb(CGPoint(x: x, y: y))
        total += 1
        if pixel.r < 60, pixel.g > 120, pixel.b < 60 { green += 1 }
      }
    }
    return Double(green) / Double(max(total, 1))
  }

  func testRendererLossWhileHiddenWaitsForVisibilityAndInvalidRequestsAnswerAtOnce() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    // Off-screen points are valid; an invalid request fails at once rather than at its timeout.
    let started = ContinuousClock.now
    _ = try await view.unproject(CGPoint(x: -40, y: -40))
    _ = try await view.query(at: CGPoint(x: -40, y: 5_000))
    XCTAssertLessThan(started.duration(to: .now), .seconds(5))
    // iOS draws the steepest pitch the camera API allows. MapLibre lowers it while the top inset
    // exceeds the bottom one, as the safe area does, so the camera's centre stays in view.
    view.automaticallyAdjustsContentInsets = false
    try await waitUntil { (view.engine as? NativeMapEngine)?.mapView?.contentInset == .zero }
    try await view.setCamera(TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16, pitch: 85))
    let steep = try await view.camera()
    XCTAssertEqual(steep.pitch, 85, accuracy: 0.5)
    XCTAssertFalse(events.features.contains("pitchAbove60"))
    try await view.setCamera(TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 16))

    // A renderer that loses its graphics context while the app is hidden is replaced only once it
    // is visible.
    NotificationCenter.default.post(name: UIApplication.didEnterBackgroundNotification, object: nil)
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    XCTAssertNil(view.engine)
    NotificationCenter.default.post(
      name: UIApplication.willEnterForegroundNotification, object: nil)
    try await events.waitForLoads(2)
    // Loading resets the recovery budget, so a later loss is recovered too.
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    try await events.waitForLoads(3)
    try await assertBuildings(view)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    // A loss before the replacement loads is reported, as a recoverable failure.
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    try XCTUnwrap(view.engine as? NativeMapEngine).graphicsContextLost()
    try await waitUntil { !events.failures.isEmpty }
    XCTAssertEqual(events.failures.first?.code, .rendererFailed)
    XCTAssertEqual(events.failures.first?.context.reason, "graphicsContextLost")
    XCTAssertEqual(events.failures.first?.isRecoverable, true)
  }

  func testEventLevelsAndCameraReasons() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)

    // At the default level only the settled camera arrives, tagged with who moved it.
    events.changes.removeAll()
    try await view.setCamera(.init(longitude: -3.69, latitude: 40.42, zoom: 13), duration: 0.6)
    try await waitUntil { events.changes.contains(where: \.isFinal) }
    XCTAssertEqual(events.changes.map(\.phase), [.ended])
    XCTAssertEqual(events.changes.last?.reason, .api)
    // The continuous level adds the start and throttled updates.
    try await view.setOptions(.init(events: .init(level: .continuous, cameraUpdateInterval: 0.1)))
    events.changes.removeAll()
    try await view.setCamera(.init(longitude: -3.70, latitude: 40.42, zoom: 14), duration: 0.8)
    try await waitUntil { events.changes.contains(where: \.isFinal) }
    XCTAssertEqual(events.changes.first?.phase, .started)
    XCTAssertTrue(events.changes.allSatisfy { $0.reason == .api }, "\(events.changes.map(\.reason))")
    let moving = events.changes.filter { $0.phase == .moving }.count
    XCTAssertTrue((1...11).contains(moving), "\(moving) throttled updates in 0.8 s")
    XCTAssertEqual(events.changes.last?.camera.zoom ?? 0, 14, accuracy: 0.01)
    // A movement another one replaces ends as cancelled.
    let first = Task {
      try await view.ease(
        to: TileflowCamera(longitude: -3.71, latitude: 40.42, zoom: 15), duration: 2)
    }
    try await Task.sleep(for: .milliseconds(200))
    let second = try await view.jump(to: TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 15))
    let replaced = try await first.value
    XCTAssertEqual(replaced, .cancelled)
    XCTAssertEqual(second, .finished)
    // Framing bounds settles on a camera that holds them.
    try await view.fit(.init(west: -3.71, south: 40.41, east: -3.69, north: 40.43))
    let bounds = try await view.visibleBounds()
    XCTAssertLessThanOrEqual(bounds.west, -3.71)
    XCTAssertGreaterThanOrEqual(bounds.north, 40.43)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  /// The Hosted map's native representation: themes and blends from its family document, its
  /// degradations, and one reload when a later deployment supersedes the styles it reads.
  func testAHostedMapReadsItsNativeRepresentationAndReloadsOnceWhenSuperseded() async throws {
    try await requireNativeFixture()
    _ = try await fixtureCounters(reset: true)
    defer { Task { _ = try? await fixtureCounters(reset: true) } }
    let events = NativeMapEvents()
    let view = TileflowMapView(
      source: .hosted(mapID: Self.hostedFixtureMapID, configuration: try fixtureConfiguration()))
    view.engineKind = .native
    view.automaticallyAdjustsContentInsets = false
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertEqual(engine.manifest?.representation, .native)
    XCTAssertNotNil(engine.family)
    try await waitUntil { events.features == ["scene3d"] }
    try await view.setTheme("system")
    try await view.setBlend(themes: ["day", "night"], position: 0.5)
    try await view.setBlend(themes: ["day", "night"], position: 0.75)
    XCTAssertEqual(engine.shown?.theme, "night")
    do {
      try await view.setBlend(themes: ["day", "labels"], position: 0.5)
      XCTFail("Themes of different structure blended.")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.code, .invalidRequest)
    }

    // A later deployment supersedes version 1: its next style answers 409 and the map reloads
    // once, from the new deployment, in the theme the application asked for.
    var activate = URLRequest(url: URL(string: "\(FixtureServer.origin)/__fixture/hosted?deployment=2")!)
    activate.httpMethod = "POST"
    _ = try await URLSession.shared.data(for: activate)
    _ = try? await view.setTheme("terrain")
    try await events.waitForLoads(2)
    let reloaded = try XCTUnwrap(view.engine as? NativeMapEngine)
    XCTAssertEqual(reloaded.shown?.theme, "terrain")
    try await waitUntil { events.features.contains("terrain3d") }
    XCTAssertEqual(events.loads, 2)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  func testTwoMapsAtOnceAndRotation() async throws {
    try await requireNativeFixture()
    let window = MountedMap.sceneWindow()
    defer { window.isHidden = true }
    let root = try XCTUnwrap(window.rootViewController?.view)
    var maps: [(TileflowMapView, NativeMapEvents)] = []
    for (index, theme) in ["light", "dark"].enumerated() {
      let events = NativeMapEvents()
      let view = TileflowMapView(source: citySource, theme: theme)
      view.engineKind = .native
      view.automaticallyAdjustsContentInsets = false
      view.onEvent = events.receive
      view.frame = CGRect(x: 0, y: CGFloat(index) * 422, width: 390, height: 422)
      root.addSubview(view)
      maps.append((view, events))
    }
    defer { for (view, _) in maps { view.destroy() } }
    for (view, events) in maps {
      try await events.waitForLoads(1)
      try await assertBuildings(view)
    }
    XCTAssertEqual((maps[1].0.engine as? NativeMapEngine)?.shown?.theme, "dark")
    // Turning the device lays the views out again; the camera keeps its centre.
    window.frame = CGRect(x: 0, y: 0, width: 844, height: 390)
    for (index, (view, _)) in maps.enumerated() {
      view.frame = CGRect(x: CGFloat(index) * 422, y: 0, width: 422, height: 390)
    }
    window.layoutIfNeeded()
    for (view, events) in maps {
      try await waitUntil { (view.engine as? NativeMapEngine)?.mapView?.bounds.width == 422 }
      let camera = try await view.camera()
      XCTAssertEqual(camera.longitude, -3.70, accuracy: 0.001)
      XCTAssertEqual(camera.latitude, 40.42, accuracy: 0.001)
      try await assertBuildings(view)
      XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
    }
  }

  /// A static view annotation keeps its tracking registration across frames.
  func testUnchangedTrackedPointsAreNotSentAgain() async throws {
    try await requireNativeFixture()
    let events = NativeMapEvents()
    let view = TileflowMapView(source: citySource)
    view.engineKind = .native
    let window = mount(view, events: events)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    view.viewAnnotations.add(
      TileflowViewAnnotation(coordinate: Self.center, view: UIView(frame: CGRect(x: 0, y: 0, width: 20, height: 20))))
    try await Task.sleep(for: .seconds(1))
    XCTAssertLessThanOrEqual(engine.received[.setTrackedPoints] ?? 0, 2)
    try await Task.sleep(for: .seconds(1))
    XCTAssertLessThanOrEqual(engine.received[.setTrackedPoints] ?? 0, 2)
  }

  // MARK: Support

  private func mount(_ view: TileflowMapView, events: NativeMapEvents) -> UIWindow {
    let window = MountedMap.sceneWindow()
    view.onEvent = events.receive
    view.frame = window.bounds
    window.rootViewController?.view.addSubview(view)
    return window
  }

  private func assertBuildings(_ view: TileflowMapView) async throws {
    var observed: [TileflowRenderedFeature] = []
    for _ in 0..<100 {
      if let point = try? await view.project(Self.center),
        let features = try? await view.query(at: point)
      {
        observed = features
        if features.contains(where: { $0.layer.hasPrefix("tileflow-buildings") }) { return }
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTFail("The buildings did not render: \(observed)")
  }

  private func waitUntil(seconds: Int = 10, _ condition: () -> Bool) async throws {
    for _ in 0..<(seconds * 20) {
      if condition() { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("Timed out.")
  }
}

/// What a map view reported during a check.
@MainActor
final class NativeMapEvents {
  var loads = 0
  var failures: [TileflowMapError] = []
  var warnings: [TileflowMapWarning] = []
  var transitions: [TileflowThemeTransition] = []
  var themes: [String] = []
  var changes: [TileflowCameraChange] = []

  /// The capabilities reported as unavailable, in order.
  var features: [String] {
    warnings.compactMap { $0.error.context.reason == "featureUnavailable" ? $0.error.context.feature : nil }
  }

  func receive(_ event: TileflowMapEvent) {
    switch event {
    case .contentReady: loads += 1
    case .failed(let error): failures.append(error)
    case .warning(let warning): warnings.append(warning)
    case .themeTransition(let transition): transitions.append(transition)
    case .themeChanged(let theme): themes.append(theme)
    case .cameraChanged(let change): changes.append(change)
    default: break
    }
  }

  func waitForLoads(_ count: Int, seconds: Int = 60) async throws {
    for _ in 0..<(seconds * 20) {
      if loads >= count { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    XCTFail("The map loaded \(loads) times, expected \(count): \(failures)")
  }
}
