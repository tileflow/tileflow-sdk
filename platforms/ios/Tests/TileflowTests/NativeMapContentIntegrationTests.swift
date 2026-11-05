import MapLibre
import SwiftUI
import XCTest

@testable import Tileflow

@MainActor
final class NativeMapContentIntegrationTests: XCTestCase {
  private enum Stage { case empty, live, reordered, collision, failing }
  private final class Model: ObservableObject {
    @Published var tick = 0
    @Published var stage = Stage.empty
    @Published var receivedError = false
    var loads = 0
    var errors: [TileflowMapError] = []
  }
  private struct Screen: View {
    @ObservedObject var model: Model
    let controller: TileflowMapController
    let provider: TileflowSimulatedLocationProvider
    private let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)

    var body: some View {
      let options = TileflowMapOptions(location: .init(staleAfter: 42))
      TileflowMap(
        source: .init(
          map: "city", manifestURL: NativeMapViewIntegrationTests.nativeManifest,
          allowsLoopbackHTTP: true),
        initialCamera: .init(longitude: center.longitude, latitude: center.latitude, zoom: 14),
        options: options, controller: controller,
        onEvent: { event in
          if case .contentReady = event { model.loads += 1 }
          if case .failed(let error) = event {
            model.errors.append(error)
            if !model.receivedError { model.receivedError = true }
          }
        }
      )
      .locationProvider(provider)
      .content {
        if model.stage != .empty {
          for id in model.stage == .reordered ? ["b", "a"] : ["a", "b"] {
            layer(id)
          }
          source
          TileflowAnnotation(id: "stop", coordinate: center, title: "Stop \(model.tick)")
          TileflowLocationOptions(enabled: true, showsAccuracy: false, staleAfter: 9)
          if model.stage == .collision { TileflowGeoJSONSource(id: "outside", data: .empty) }
          if model.stage == .failing {
            TileflowGeoJSONSource(id: "temporary", data: .empty)
            TileflowVectorSource(
              id: "invalid",
              tiles: .tileJSON(
                URL(string: "\(FixtureServer.origin)/runtime-style/invalid-tiles.json")!))
          }
        }
      }
    }
    private func layer(_ id: String) -> TileflowCircleLayer {
      var circle = TileflowCircleLayer(id: id, source: "places")
      circle.circleRadius = .constant(id == "a" ? 6 + Double(model.tick) : 4)
      circle.circleColor = .constant("#2727ee")
      return circle
    }
    private var source: TileflowGeoJSONSource {
      let data = Data(
        "{\"type\":\"FeatureCollection\",\"features\":[{\"type\":\"Feature\",\"id\":1,\"properties\":{\"v\":\(model.tick/2)},\"geometry\":{\"type\":\"Point\",\"coordinates\":[-3.70,40.42]}}]}"
          .utf8)
      var source = TileflowGeoJSONSource(id: "places", data: .geoJSON(data))
      if model.stage == .failing { source.buffer = 64 }
      return source
    }
  }

  private func until(_ detail: String, line: UInt = #line, _ check: () -> Bool) async throws {
    for _ in 0..<220 {
      if check() { return }
      try await Task.sleep(for: .milliseconds(40))
    }
    XCTFail(detail, line: line)
    throw WaitError.timedOut
  }
  private enum WaitError: Error { case timedOut }

  func testSwiftUIUpdatesContentTenTimesASecondWithoutReplacingTheRenderer() async throws {
    let controller = TileflowMapController()
    let model = Model()
    let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)
    let provider = TileflowSimulatedLocationProvider(
      route: [center, .init(longitude: -3.69, latitude: 40.42)], playsAutomatically: false)
    let window = MountedMap.sceneWindow()
    window.rootViewController = UIHostingController(
      rootView: Screen(model: model, controller: controller, provider: provider))
    window.layoutIfNeeded()
    defer {
      window.isHidden = true
      window.rootViewController = nil
    }
    try await until("SwiftUI did not mount the map") { model.loads == 1 }
    let view = try controller.attached()
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let map = try XCTUnwrap(engine.mapView)
    let style = try XCTUnwrap(map.style)
    try await view.addSource(TileflowGeoJSONSource(id: "outside", data: .empty))
    let externalPin = TileflowAnnotation(id: "outside", coordinate: center, title: "Imperative")
    let overlay = try TileflowGeoJSONLayer(
      id: "external",
      geoJSON: Data(
        #"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"LineString","coordinates":[[-3.71,40.42],[-3.69,40.42]]}}]}"#
          .utf8),
      kind: .line, progress: .init(end: 0))
    try await view.setContent(annotations: [externalPin], layers: [overlay])
    let originalOverlay = try XCTUnwrap(style.layer(withIdentifier: "__tileflow_app_external"))
    model.stage = .live
    try await until("Declared layers, pins or location were not installed") {
      style.layer(withIdentifier: "__tileflow_layer_a") != nil && view.options.location.enabled
        && view.content.annotations.count == 2
    }
    let animation = Task {
      try await view.animateLineProgress(layers: ["external"], to: .init(end: 0.9), duration: 1.5)
    }
    try await until("The imperative route did not start animating") {
      engine.received[.animateLineProgress] == 1
    }
    let marker = try XCTUnwrap(engine.container.subviews.first { $0.accessibilityIdentifier == "stop" })
    var shownTitles: [String?] = []
    let before = engine.received
    let started = ContinuousClock.now
    for tick in 1...10 {
      model.tick = tick
      try await ContinuousClock().sleep(until: started.advanced(by: .milliseconds(tick * 100)))
      shownTitles.append(marker.accessibilityLabel)
    }
    try await until("The last marker and radius were not rendered") {
      let circle = style.layer(withIdentifier: "__tileflow_layer_a") as? MLNCircleStyleLayer
      return (circle?.circleRadius.constantValue as? NSNumber)?.intValue == 16
        && engine.container.subviews.contains { $0.accessibilityLabel == "Stop 10" }
    }
    let completed = try await animation.value
    XCTAssertTrue(completed, "Declarative pin edits interrupted the imperative route")
    func changes(_ command: MapEngineCommand) -> Int {
      (engine.received[command] ?? 0) - (before[command] ?? 0)
    }
    XCTAssertEqual(changes(.updateLayer), 10)
    XCTAssertEqual(changes(.setGeoJSONSourceData), 5)
    XCTAssertEqual(shownTitles, (1...10).map { "Stop \($0)" })
    XCTAssertEqual(changes(.setContent), 0)
    for command in [MapEngineCommand.addSource, .removeSource, .addLayer, .removeLayer, .moveLayer]
    { XCTAssertEqual(changes(command), 0) }
    XCTAssertTrue(try controller.attached() === view)
    XCTAssertTrue(view.engine === engine && engine.mapView === map)
    XCTAssertTrue(style.layer(withIdentifier: "__tileflow_app_external") === originalOverlay)
    XCTAssertEqual(model.loads, 1)
    XCTAssertTrue(model.errors.isEmpty)

    model.stage = .reordered
    try await until("The declared layer order was not reconciled") {
      style.layers.filter {
        $0.identifier == "__tileflow_layer_a" || $0.identifier == "__tileflow_layer_b"
      }.map(\.identifier) == ["__tileflow_layer_b", "__tileflow_layer_a"]
    }
    XCTAssertEqual(changes(.moveLayer), 1)
    try await view.setFeatureState(
      sourceId: "places", featureId: "1", state: ["selected": .bool(true)])

    model.stage = .collision
    try await until("Collision with an imperative source was silent") { model.errors.count == 1 }
    XCTAssertEqual(model.errors.first, .invalidRequest)
    XCTAssertNotNil(style.source(withIdentifier: "__tileflow_source_outside"))
    XCTAssertEqual(view.content.annotations.map(\.id), ["outside", "stop"])
    model.stage = .failing
    try await until("The remote edit did not begin") { view.sourceExists("invalid") }
    let concurrent = Task {
      try await view.addSource(TileflowGeoJSONSource(id: "concurrent", data: .empty))
    }
    // The remote TileJSON is still in flight. SwiftUI submits two newer revisions.
    model.stage = .reordered
    model.tick = 11
    try await Task.sleep(for: .milliseconds(50))
    model.tick = 12
    try await until("Remote rejection was silent") { model.errors.count == 2 }
    try await concurrent.value
    try await until("The newest content was lost during rollback") {
      let circle = style.layer(withIdentifier: "__tileflow_layer_a") as? MLNCircleStyleLayer
      return (circle?.circleRadius.constantValue as? NSNumber)?.intValue == 18
    }
    XCTAssertNotNil(style.source(withIdentifier: "__tileflow_source_concurrent"))
    XCTAssertFalse(view.sourceExists("temporary"))
    XCTAssertFalse(view.sourceExists("invalid"))
    XCTAssertNotNil(style.source(withIdentifier: "__tileflow_source_places"))
    XCTAssertNotNil(style.layer(withIdentifier: "__tileflow_layer_a"))
    let geo = try XCTUnwrap(
      style.source(withIdentifier: "__tileflow_source_places") as? MLNShapeSource)
    try await until("Rollback discarded existing feature state") {
      (geo.featureState(featureID: "1")?["selected"] as? Bool) == true
    }
    XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["b", "a"])
    XCTAssertTrue(view.engine === engine)

    try await view.addLayer(TileflowCircleLayer(id: "client", source: "places"))
    model.stage = .empty
    try await until("Removing a controller dependency was accepted") { model.errors.count == 3 }
    XCTAssertTrue(view.sourceExists("places") && view.layerExists("client"))
    try await view.removeLayer("client")
    model.stage = .live
    try await until("The host did not resume after a rejection") {
      view.runtimeStyle.layers.map(\.id) == ["a", "b"]
    }
    model.stage = .empty
    try await until("Retired declarations or location were retained") {
      !view.sourceExists("places") && !view.layerExists("a") && !view.layerExists("b")
        && !view.options.location.enabled
        && view.content.annotations == [externalPin]
    }
    XCTAssertEqual(view.options.location.staleAfter, 42)
    XCTAssertTrue(view.sourceExists("outside"))
    XCTAssertTrue(style.layer(withIdentifier: "__tileflow_app_external") === originalOverlay)
    XCTAssertTrue(view.engine === engine)
  }

  func testRejectedInitialContentLeavesTheBaseMapReady() async throws {
    let controller = TileflowMapController()
    let model = Model()
    model.stage = .failing
    let provider = TileflowSimulatedLocationProvider(
      route: [
        .init(longitude: -3.7, latitude: 40.42), .init(longitude: -3.69, latitude: 40.42),
      ], playsAutomatically: false)
    let window = MountedMap.sceneWindow()
    window.rootViewController = UIHostingController(
      rootView: Screen(model: model, controller: controller, provider: provider))
    window.layoutIfNeeded()
    defer {
      window.isHidden = true
      window.rootViewController = nil
    }
    try await until("Initial content's rejection did not reach SwiftUI") {
      model.loads == 1 && model.errors.count == 1
    }
    let view = try controller.attached()
    XCTAssertFalse(
      view.sourceExists("places") || view.sourceExists("invalid") || view.sourceExists("temporary"))
    XCTAssertFalse(view.layerExists("a") || view.layerExists("b"))
    XCTAssertTrue(view.content.annotations.isEmpty)
    XCTAssertFalse(view.options.location.enabled)
    XCTAssertNotNil(view.readyEngine)
    try await Task.sleep(for: .milliseconds(400))
    XCTAssertEqual(model.errors.count, 1)
  }

  func testMapSummaryActionsMoveTheMapAndPreserveItsOtherAccessibleElements() async throws {
    let view = TileflowMapView(
      source: .init(
        map: "city", manifestURL: NativeMapViewIntegrationTests.nativeManifest,
        allowsLoopbackHTTP: true),
      initialCamera: .init(longitude: -3.7, latitude: 40.42, zoom: 14, bearing: 90))
    let events = NativeMapEvents()
    view.onEvent = events.receive
    let window = MountedMap.sceneWindow()
    view.frame = window.bounds
    window.rootViewController?.view.addSubview(view)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let elements = try XCTUnwrap(view.accessibilityElements)
    let summary = try XCTUnwrap(elements.compactMap { $0 as? MapAccessibilitySummary }.first)
    for child in [engine.view, view.controlsView, view.annotationOverlay] {
      XCTAssertTrue(elements.contains { ($0 as? UIView) === child })
    }
    XCTAssertTrue(engine.attribution.view.control.isDescendant(of: engine.view))
    XCTAssertFalse(view.accessibilityCustomRotors?.isEmpty ?? true)
    let initial = summary.accessibilityValue
    XCTAssertTrue(initial?.contains("city") == true)
    let actions = try XCTUnwrap(summary.accessibilityCustomActions)
    XCTAssertEqual(actions.count, 6)
    func activate(_ name: String) throws {
      let action = try XCTUnwrap(actions.first { $0.name == name })
      XCTAssertTrue(action.actionHandler?(action) == true)
    }
    try activate("Zoom in")
    try await until("Zoom in did not move the camera") {
      !view.isMoving && abs((view.currentCamera?.zoom ?? 0) - 15) < 0.03
    }
    XCTAssertNotEqual(summary.accessibilityValue, initial)
    try activate("Zoom out")
    try await until("Zoom out did not restore zoom") {
      !view.isMoving && abs((view.currentCamera?.zoom ?? 0) - 14) < 0.03
    }
    for (action, sign, latitude) in [
      ("Pan north", 1.0, true), ("Pan south", -1.0, true), ("Pan east", 1.0, false),
      ("Pan west", -1.0, false),
    ] {
      let before = try await view.camera()
      try activate(action)
      try await until("The map did not pan toward \(action)") {
        guard let camera = view.currentCamera else { return false }
        let delta =
          latitude ? camera.latitude - before.latitude : camera.longitude - before.longitude
        return !view.isMoving && delta * sign > 0.0001
      }
    }
  }
}
