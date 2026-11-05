import Foundation
import UIKit
import XCTest

@testable import TileflowReactNativeBridge
@testable import Tileflow

@MainActor
final class MapBridgeTests: XCTestCase {
  private var fixture: BridgeObject!

  override func setUpWithError() throws {
    fixture = try BridgeObject(Fixtures.json("packages/react-native/test/native/map-bridge.json"))
  }

  func testCameraUnitsAndFrameBoundsMatchTheSharedContract() throws {
    let input = try fixture.object("camera").object("command")
    let camera = try MapBridgeValues.camera(input)
    let native = try fixture.object("camera").object("native")
    XCTAssertEqual(camera.center?.longitude, try native.double("longitude"))
    XCTAssertEqual(camera.center?.latitude, try native.double("latitude"))
    XCTAssertEqual(camera.zoom, try native.double("zoom"))
    guard case .ease(let duration, _) = try MapBridgeValues.animation(input) else {
      return XCTFail("Expected ease")
    }
    XCTAssertEqual(duration, try native.double("durationSeconds"))
    let expected = try fixture.object("camera").object("event").object("payload")
    let bounds = try MapBridgeValues.bounds(expected.object("properties").object("bounds"))
    let change = try TileflowCameraChange(
      camera: .init(longitude: native.double("longitude"), latitude: native.double("latitude"),
        zoom: native.double("zoom"), bearing: native.double("bearing"), pitch: native.double("pitch")),
      reason: .gesture, phase: .moving, bounds: bounds)
    let event = try XCTUnwrap(MapBridgeValues.cameraEvent(change, gestureActive: true,
      timestamp: expected.double("timestamp")))
    XCTAssertEqual(Fixtures.canonical(event), Fixtures.canonical(expected.values))
    let padding = try MapBridgeValues.padding(input.object("padding"))
    XCTAssertEqual(padding, UIEdgeInsets(top: 7, left: 17, bottom: 13, right: 11))
  }

  func testQueriesUsePointsAndPreserveGeoJSON() throws {
    let queries = try fixture.object("queries")
    guard case .point(let point) = try MapBridgeValues.query(queries.object("point").object("geometry")),
      case .box(let box) = try MapBridgeValues.query(queries.object("box").object("geometry")),
      case .polygon(let polygon) = try MapBridgeValues.query(queries.object("polygon").object("geometry"))
    else { return XCTFail("Wrong query geometry") }
    XCTAssertEqual(point, CGPoint(x: 31.5, y: 46.25))
    XCTAssertEqual(box, CGRect(x: 10, y: 20, width: 100, height: 60))
    XCTAssertEqual(polygon.count, 4)
    let feature = try MapBridgeValues.feature(queries.array("features")[0])
    XCTAssertEqual(feature.id, "fixture-point")
    XCTAssertEqual(feature.geometry, .point(.init(longitude: -3.7038, latitude: 40.4168)))
    let touch = MapBridgeValues.touch(.init(longitude: -3.7038, latitude: 40.4168), point: point)
    XCTAssertEqual(Fixtures.canonical(touch), Fixtures.canonical(try fixture.object("tap").values))
    let options = try MapBridgeValues.options(fixture.object("options"))
    XCTAssertEqual(options.quality, .balanced)
    XCTAssertFalse(options.gestures.zoom)
    XCTAssertEqual(options.events.level, .continuous)
  }

  func testOnlyNativeConfigurationSuppliesCredentials() throws {
    let source = try fixture.object("sources").object("hosted")
    XCTAssertNoThrow(try MapBridgeValues.source(source, surfaceID: "fixture"))
    for key in ["apiKey", "token", "apiOrigin", "authorization"] {
      var invalid = source.values
      invalid[key] = "never-accepted"
      XCTAssertThrowsError(try MapBridgeValues.source(BridgeObject(invalid), surfaceID: nil))
    }
    XCTAssertThrowsError(try MapBridgeValues.coordinate([181, 0]))
    XCTAssertThrowsError(try MapBridgeValues.point([true, 3]))
    XCTAssertThrowsError(try MapBridgeValues.animation(BridgeObject(["animationDuration": -1])))
  }

  func testWarningsPreserveDiagnosticContextForConsoleAndRecovery() throws {
    let failure = MapBridgeValues.failure(TileflowMapError(.rendererFailed,
      context: .init(reason: "featureUnavailable", feature: "scene3d")))
    XCTAssertEqual(failure.code, "rendererFailed")
    let context = try BridgeObject(failure.info["context"])
    XCTAssertEqual(try context.string("reason"), "featureUnavailable")
    XCTAssertEqual(try context.string("feature"), "scene3d")
    XCTAssertNil(failure.info["feature"])
  }

  func testMultiplePositionsReturnAnActionableStructuredError() throws {
    do {
      _ = try MapBridgeValues.position(BridgeObject(["aboveLayerId": "a", "slotIndex": 1]))
      XCTFail("Two positions were accepted")
    } catch {
      let failure = MapBridgeValues.failure(error)
      XCTAssertEqual(failure.code, "invalidRequest")
      let context = try BridgeObject(failure.info["context"])
      XCTAssertEqual(try context.string("reason"), "invalidLayerPosition")
      XCTAssertEqual(try context.string("path"), "position")
      XCTAssertEqual(try context.string("rule"), "onePosition")
      let correction = try BridgeObject(context.array("corrections")[0])
      XCTAssertEqual(try correction.string("code"), "chooseOnePosition")
    }
  }

  func testBlendListsAndTransitionDurationsReachNativeUnits() throws {
    let blend = try MapBridgeValues.blend(BridgeObject([
      "themes": ["dawn", "day", "night"], "position": 1.5, "hold": true,
    ]))
    XCTAssertEqual(blend.themes, ["dawn", "day", "night"])
    XCTAssertEqual(blend.position, 1.5)
    XCTAssertTrue(blend.hold)
    let duration = try MapBridgeValues.themeDuration(BridgeObject(["themeTransition": ["duration": 250]]))
    XCTAssertEqual(duration, 0.25)
    let shorthand = try MapBridgeValues.blend(fixture.object("appearance").object("themeBlend"))
    XCTAssertEqual(shorthand.themes, ["day", "night"])
    XCTAssertEqual(shorthand.position, 0.25)
  }

  func testEmptySourceWaitsForInitialCameraAndRetiredCallsFail() async throws {
    let host = TFMapHostView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    defer { host.dispose() }
    var events: [String] = []
    host.eventHandler = { _, type, _ in events.append(type) }
    host.update(reactTag: 42, instanceID: "first", sourceJSON: "", appearanceJSON: "{}", optionsJSON: "{}")
    XCTAssertNil(host.map)
    XCTAssertEqual(events, [])
    let source = try MapBridgeValues.json(fixture.object("sources").object("manifest").values)
    host.update(reactTag: 42, instanceID: "first", sourceJSON: source, appearanceJSON: "{}",
      optionsJSON: #"{"initialCamera":{"zoomLevel":16,"padding":{"paddingTop":25}}}"#)
    XCTAssertNotNil(host.map)
    XCTAssertEqual(host.map?.contentInsets.top, 25)
    host.update(reactTag: 42, instanceID: "first", sourceJSON: source, appearanceJSON: #"{"theme":"dark"}"#,
      optionsJSON: #"{"initialCamera":{"zoomLevel":16}}"#)
    XCTAssertEqual(host.map?.contentInsets.top, 25)
    let oldGeneration = host.generation
    host.update(reactTag: 42, instanceID: "second", sourceJSON: source, appearanceJSON: "{}", optionsJSON: "{}")
    XCTAssertThrowsError(try host.checkGeneration(oldGeneration))
    let rejected = expectation(description: "old instance rejected")
    TFMapHostView.call(reactTag: 42, instanceID: "first", method: "getCamera", payload: "{}",
      resolve: { _ in XCTFail("Retired call resolved") },
      reject: { code, _, _ in XCTAssertEqual(code, "disposed"); rejected.fulfill() })
    await fulfillment(of: [rejected], timeout: 1)
  }

  func testChangingReactTagRetiresCallsEvenWhenTheInstanceStringIsReused() throws {
    let host = TFMapHostView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    defer { host.dispose() }
    let source = try MapBridgeValues.json(fixture.object("sources").object("manifest").values)
    host.update(reactTag: 100, instanceID: "reused", sourceJSON: source,
      appearanceJSON: "{}", optionsJSON: "{}")
    let generation = host.generation
    let retired = try XCTUnwrap(host.map)
    host.update(reactTag: 101, instanceID: "reused", sourceJSON: source,
      appearanceJSON: "{}", optionsJSON: "{}")
    XCTAssertThrowsError(try host.checkGeneration(generation))
    XCTAssertTrue(retired.isDestroyed)
    XCTAssertFalse(retired === host.map)
  }

  func testHiddenLocationKeepsConsumptionEnabledUntilUnsubscribed() async throws {
    let host = TFMapHostView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    defer { host.dispose() }
    host.update(reactTag: 43, instanceID: "location", sourceJSON: try MapBridgeValues.json(
      fixture.object("sources").object("manifest").values), appearanceJSON: "{}", optionsJSON: "{}")
    await Task.yield()
    try await host.setUserLocation(fixture.object("hiddenLocation").object("request"), generation: host.generation)
    XCTAssertTrue(host.map?.options.location.enabled == true)
    XCTAssertFalse(host.map?.options.location.showsPuck == true)
    try await host.setUserLocation(BridgeObject(["visible": false, "emitsUpdates": false]), generation: host.generation)
    XCTAssertFalse(host.map?.options.location.enabled == true)
  }

  func testMarkerKeepsTheApplicationViewAndRegularChildrenStayAboveTheMap() throws {
    let host = TFMapHostView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    defer { host.dispose() }
    host.update(reactTag: 45, instanceID: "marker", sourceJSON: "", appearanceJSON: "{}", optionsJSON: "{}")
    let child = UIButton(frame: CGRect(x: 0, y: 0, width: 80, height: 40))
    let binding = TFMarkerBinding(view: child)
    binding.update(instanceID: "marker", annotationID: "test", optionsJSON: try MapBridgeValues.json(
      fixture.object("marker").values))
    host.addMarker(binding)
    let overlay = UIButton(frame: CGRect(x: 20, y: 20, width: 80, height: 40))
    host.mountContent(overlay, index: 0)
    host.update(reactTag: 45, instanceID: "marker", sourceJSON: try MapBridgeValues.json(
      fixture.object("sources").object("manifest").values), appearanceJSON: "{}", optionsJSON: "{}")
    let map = try XCTUnwrap(host.map)
    XCTAssertEqual(map.viewAnnotations.annotations.count, 1)
    XCTAssertTrue(map.viewAnnotations.annotations.first?.view === child)
    XCTAssertTrue(host.subviews.first === map)
    XCTAssertTrue(host.subviews.last === overlay)
    binding.reset()
    XCTAssertEqual(map.viewAnnotations.annotations.count, 0)
  }

  func testDataAndFileImageURIsLoadTheSameBytesAndCancellationStopsReads() async throws {
    let expected = Data([0, 1, 127, 255])
    let base64 = "data:application/octet-stream;base64," + expected.base64EncodedString()
    let encoded = try await MapImageLoader.data(base64)
    XCTAssertEqual(encoded, expected)
    let percent = try await MapImageLoader.data("data:application/octet-stream,%00%01%7F%FF")
    XCTAssertEqual(percent, expected)
    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try expected.write(to: file)
    defer { try? FileManager.default.removeItem(at: file) }
    let loaded = try await MapImageLoader.data(file.absoluteString)
    XCTAssertEqual(loaded, expected)
    let cancelled = Task { try await MapImageLoader.data(file.absoluteString) }
    cancelled.cancel()
    do { _ = try await cancelled.value; XCTFail("Cancelled read succeeded") }
    catch is CancellationError {}
  }

  func testLateImageLoadCannotOverwriteANewerSet() async throws {
    let host = TFMapHostView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    defer { host.dispose() }
    host.update(reactTag: 44, instanceID: "images", sourceJSON: try MapBridgeValues.json(
      fixture.object("sources").object("manifest").values), appearanceJSON: "{}", optionsJSON: "{}")
    let image = UIGraphicsImageRenderer(size: CGSize(width: 1, height: 1)).image { context in
      UIColor.red.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 1, height: 1))
    }
    let old = try TileflowMapImage(name: "old", image: image)
    let new = try TileflowMapImage(name: "new", image: image)
    var held: CheckedContinuation<Void, Never>?
    let started = expectation(description: "old load started")
    var calls = 0
    host.loadImages = { _ in
      calls += 1
      if calls == 1 {
        await withCheckedContinuation { continuation in held = continuation; started.fulfill() }
        return [old]
      }
      return [new]
    }
    let oldEnded = expectation(description: "old load cancelled")
    TFMapHostView.call(reactTag: 44, instanceID: "images", method: "setImages", payload: #"{"images":[]}"#,
      resolve: { _ in XCTFail("Stale image load resolved"); oldEnded.fulfill() },
      reject: { code, _, _ in XCTAssertEqual(code, "cancelled"); oldEnded.fulfill() })
    await fulfillment(of: [started], timeout: 1)
    let newEnded = expectation(description: "new load installed")
    TFMapHostView.call(reactTag: 44, instanceID: "images", method: "setImages", payload: #"{"images":[]}"#,
      resolve: { value in XCTAssertEqual(value as? String, "null"); newEnded.fulfill() },
      reject: { _, _, _ in XCTFail("New load failed"); newEnded.fulfill() })
    await fulfillment(of: [newEnded], timeout: 1)
    held?.resume()
    await fulfillment(of: [oldEnded], timeout: 1)
    XCTAssertEqual(host.map?.images.map(\.name), ["new"])
  }
}
