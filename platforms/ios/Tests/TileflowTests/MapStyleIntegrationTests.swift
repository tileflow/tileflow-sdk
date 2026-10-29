import Foundation
import UIKit
import WebKit
import XCTest

@testable import Tileflow

/// The application's runtime style through the embedded renderer: 100,000 clustered points with
/// an interactive cluster, feature state, images and queries, all surviving a theme change and a
/// new renderer. The test prints its measurements for the device it runs on.
@MainActor
final class MapStyleIntegrationTests: XCTestCase {
  private var window: UIWindow?

  override func tearDown() async throws {
    window?.isHidden = true
    window = nil
  }

  private func show() async throws -> (TileflowMapView, () -> Int, () -> [TileflowMapError]) {
    do {
      _ = try await URLSession.shared.data(from: FixtureServer.manifest)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run map style integration.")
    }
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest, allowsLoopbackHTTP: true),
      initialCamera: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 9))
    var loads = 0
    var failures: [TileflowMapError] = []
    view.onEvent = { event in
      switch event {
      case .contentReady: loads += 1
      case .failed(let error): failures.append(error)
      default: break
      }
    }
    let window =
      (UIApplication.shared.connectedScenes.first as? UIWindowScene).map {
        UIWindow(windowScene: $0)
      } ?? UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let controller = UIViewController()
    window.rootViewController = controller
    view.frame = controller.view.bounds
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    controller.view.addSubview(view)
    window.makeKeyAndVisible()
    self.window = window
    return (view, { loads }, { failures })
  }

  private func waitUntil(
    _ label: String, timeout: TimeInterval = 30, _ condition: () async throws -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if try await condition() { return }
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTFail("Timed out waiting for \(label).")
    throw TileflowMapError.timeout
  }

  private func elapsed(_ work: () async throws -> Void) async rethrows -> Double {
    let started = ContinuousClock.now
    try await work()
    let duration = started.duration(to: .now)
    return Double(duration.components.seconds) * 1000
      + Double(duration.components.attoseconds) / 1e15
  }

  /// Frame intervals in the renderer while the camera eases, as p50 and p95 in milliseconds.
  private func frames(_ view: TileflowMapView, to camera: TileflowCamera) async throws
    -> (Double, Double)
  {
    let webView = try XCTUnwrap(view.subviews.compactMap { $0 as? WKWebView }.first)
    let sampling = Task { @MainActor in
      let value = try await webView.callAsyncJavaScript(
      """
      return await new Promise((resolve) => {
        const intervals = [];
        let last;
        const frame = (time) => {
          if (last !== undefined) intervals.push(time - last);
          last = time;
          if (intervals.length < 90) requestAnimationFrame(frame); else resolve(intervals);
        };
        requestAnimationFrame(frame);
      });
      """, arguments: [:], contentWorld: .page)
      return (value as? [NSNumber] ?? []).map(\.doubleValue)
    }
    try await view.move(to: camera, animation: .ease(duration: 1.5))
    let intervals = try await sampling.value.sorted()
    guard !intervals.isEmpty else { return (0, 0) }
    return (intervals[intervals.count / 2], intervals[Int(Double(intervals.count - 1) * 0.95)])
  }

  /// Points on a grid around the fixture map, each with a numeric identifier and a rank.
  private static func points(_ count: Int) -> Data {
    var text = #"{"type":"FeatureCollection","features":["#
    text.reserveCapacity(count * 120)
    for index in 0..<count {
      if index > 0 { text += "," }
      let longitude = -3.9 + Double(index % 400) / 1000
      let latitude = 40.3 + Double(index / 400) / 1000
      text +=
        #"{"type":"Feature","id":\#(index),"properties":{"rank":\#(index % 10)},"geometry":{"type":"Point","coordinates":[\#(longitude),\#(latitude)]}}"#
    }
    return Data((text + "]}").utf8)
  }

  /// A white disc on transparency: a signed distance field the layer recolours.
  private static func sdfDisc() throws -> TileflowMapImage {
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24))
    let image = renderer.image { context in
      UIColor.white.setFill()
      context.cgContext.fillEllipse(in: CGRect(x: 4, y: 4, width: 16, height: 16))
    }
    return try TileflowMapImage(name: "disc", image: image, sdf: true)
  }

  func testHundredThousandClusteredPointsSurviveAThemeChangeAndANewRenderer() async throws {
    let (view, loads, failures) = try await show()
    defer { view.destroy() }
    try await waitUntil("the map") { loads() >= 1 }
    var measurements: [String] = []
    // The same movement without the points, for comparison on this device.
    let (baseP50, baseP95) = try await frames(
      view, to: TileflowCamera(longitude: -3.65, latitude: 40.42, zoom: 9))
    measurements.append(
      String(format: "frames while panning without points p50 %.1f / p95 %.1f ms", baseP50, baseP95))
    try await view.move(
      to: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 9), animation: .none)
    let data = Self.points(100_000)
    let addSource = try await elapsed {
      try await view.addSource(
        TileflowGeoJSONSource(
          id: "points", data: .geoJSON(data), cluster: true, clusterRadius: 50,
          clusterProperties: ["rankSum": .sum(.get("rank"))]))
    }
    measurements.append(
      String(format: "addSource 100k points (%.1f MiB) %.0f ms", Double(data.count) / 1_048_576, addSource))
    var clusters = TileflowCircleLayer(id: "clusters", source: "points")
    clusters.filter = .has("point_count")
    clusters.circleColor = .expression(.step(.get("point_count"), "#51bbd6", 100, "#f1f075", 750, "#f28cb1"))
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
    try await view.addImage(Self.sdfDisc())
    var marks = TileflowSymbolLayer(id: "marks", source: "points")
    marks.filter = .not(.has("point_count"))
    marks.iconImage = "disc"
    marks.iconColor = "#2a9d8f"
    marks.iconAllowOverlap = true
    try await view.addLayer(marks)
    XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["heat", "clusters", "point", "marks"])

    var found: [TileflowQueriedFeature] = []
    let firstClusters = try await elapsed {
      try await waitUntil("clusters") {
        found = try await view.queryRenderedFeatures(options: .init(layerIds: ["clusters"]))
        return !found.isEmpty
      }
    }
    measurements.append(String(format: "first clusters queried %.0f ms", firstClusters))
    let largest = try XCTUnwrap(
      found.max { ($0.feature.properties["point_count"]?.number ?? 0) < ($1.feature.properties["point_count"]?.number ?? 0) })
    XCTAssertEqual(largest.layer, "clusters")
    XCTAssertGreaterThan(largest.feature.properties["rankSum"]?.number ?? 0, 0)
    let clusterID = try XCTUnwrap(largest.feature.clusterID)
    guard case .point(let center) = largest.feature.geometry else { return XCTFail("A point") }
    let children = try await view.clusterChildren(sourceId: "points", clusterId: clusterID)
    XCTAssertGreaterThan(children.count, 1)
    let leaves = try await view.clusterLeaves(sourceId: "points", clusterId: clusterID, limit: 2000)
    XCTAssertEqual(leaves.count, min(2000, Int(largest.feature.properties["point_count"]?.number ?? 0)))

    // An interactive cluster: a tap finds it and the map zooms to where it splits.
    let tapped = try await view.project(center)
    var zoom = 0.0
    let tap = try await elapsed {
      let hits = try await view.queryRenderedFeatures(
        in: .point(tapped), options: .init(layerIds: ["clusters"]))
      let id = try XCTUnwrap(hits.first?.feature.clusterID)
      zoom = try await view.clusterExpansionZoom(sourceId: "points", clusterId: id)
    }
    measurements.append(String(format: "cluster tap to expansion zoom %.0f ms", tap))
    XCTAssertGreaterThan(zoom, 9)
    let (p50, p95) = try await frames(
      view, to: TileflowCamera(longitude: center.longitude, latitude: center.latitude, zoom: zoom))
    measurements.append(String(format: "frames while zooming into a cluster p50 %.1f / p95 %.1f ms", p50, p95))
    let (panP50, panP95) = try await frames(
      view, to: TileflowCamera(longitude: center.longitude + 0.05, latitude: center.latitude, zoom: zoom))
    measurements.append(String(format: "frames while panning p50 %.1f / p95 %.1f ms", panP50, panP95))
    let steep = try await elapsed {
      try await view.move(
        to: TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 12, pitch: 80), animation: .none)
      try await waitUntil("features at pitch 80") {
        !(try await view.queryRenderedFeatures(options: .init(limit: 100_000))).isEmpty
      }
    }
    measurements.append(String(format: "whole-view query at pitch 80 %.0f ms", steep))

    // Feature state and images survive a theme change.
    try await view.setFeatureState(sourceId: "points", featureId: "5", state: ["selected": true])
    let selected = TileflowCamera(longitude: -3.895, latitude: 40.3, zoom: 17)
    try await view.move(to: selected, animation: .none)
    let theme = try await elapsed { try await view.setTheme("dark") }
    measurements.append(String(format: "theme change with 100k points %.0f ms", theme))
    try await waitUntil("the selected point after a theme change") {
      let at = try await view.project(TileflowCoordinate(longitude: -3.895, latitude: 40.3))
      let hits = try await view.queryRenderedFeatures(
        in: .point(at), options: .init(layerIds: ["point", "marks"]))
      return hits.contains { $0.layer == "point" && $0.state["selected"] == true }
        && hits.contains { $0.layer == "marks" }
    }

    // A new renderer receives the whole style again.
    try view.reload()
    let replay = try await elapsed {
      try await waitUntil("the new renderer") { loads() >= 2 }
      try await waitUntil("the style on the new renderer") {
        let at = try await view.project(TileflowCoordinate(longitude: -3.895, latitude: 40.3))
        let hits = try await view.queryRenderedFeatures(in: .point(at), options: .init(layerIds: ["point"]))
        return hits.contains { $0.state["selected"] == true }
      }
    }
    measurements.append(String(format: "new renderer with the style replayed %.0f ms", replay))
    XCTAssertTrue(failures().isEmpty, "\(failures())")
    print("Tileflow runtime style on \(UIDevice.current.model) \(UIDevice.current.systemVersion): \(measurements.joined(separator: ", ")).")
  }
}
