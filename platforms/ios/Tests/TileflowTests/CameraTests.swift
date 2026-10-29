import UIKit
import XCTest

@testable import Tileflow

@MainActor
private final class Received {
  var changes: [TileflowCameraChange] = []
}

/// Camera values the host checks before they reach the renderer, and camera state it keeps.
@MainActor
final class CameraTests: XCTestCase {
  func testMovementsCarryOnlyValidValuesToTheRenderer() throws {
    let update = TileflowCameraUpdate(zoom: 14, pitch: 85)
    XCTAssertNil(try update.wireValue()["center"])
    XCTAssertEqual(try update.wireValue()["pitch"]?.number, 85)
    XCTAssertNil(try update.wireValue()["bearing"], "Values left nil keep the current ones.")
    let camera = TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 12, bearing: 30, pitch: 10)
    XCTAssertEqual(
      TileflowCameraUpdate(zoom: 15).applied(to: camera),
      TileflowCamera(longitude: -3.7, latitude: 40.42, zoom: 15, bearing: 30, pitch: 10))
    for invalid in [
      TileflowCameraUpdate(pitch: 86), TileflowCameraUpdate(zoom: 25),
      TileflowCameraUpdate(center: .init(longitude: 181, latitude: 0)),
    ] {
      XCTAssertThrowsError(try invalid.wireValue()) {
        XCTAssertEqual($0 as? TileflowMapError, .invalidRequest)
      }
    }

    let ease = try TileflowCameraAnimation.ease(duration: 0.75, easing: .easeOut).wireValue
    XCTAssertEqual(ease["type"]?.string, "ease")
    XCTAssertEqual(ease["duration"]?.number, 750)
    let fly = try TileflowCameraAnimation.fly(.init(duration: 2, minZoom: 3)).wireValue
    XCTAssertEqual(fly["duration"]?.number, 2000)
    XCTAssertEqual(fly["minZoom"]?.number, 3)
    XCTAssertNil(try TileflowCameraAnimation.fly().wireValue["duration"])
    for invalid: TileflowCameraAnimation in [
      .ease(duration: 21), .ease(duration: -1),
      .ease(easing: TileflowEasing(x1: 1.5, y1: 0, x2: 0.5, y2: 1)), .fly(.init(speed: 0)),
    ] {
      XCTAssertThrowsError(try invalid.wireValue, "\(invalid)")
    }

    var limits = TileflowCameraLimits(
      minZoom: 3, maxZoom: 16, bounds: .init(west: 170, south: -10, east: -170, north: 10))
    XCTAssertEqual(try limits.wireValue()["maxPitch"]?.number, 85)
    XCTAssertEqual(try limits.wireValue()["bounds"]?["east"]?.number, -170)
    limits.minZoom = 17
    XCTAssertThrowsError(try limits.wireValue())
    XCTAssertThrowsError(try TileflowCameraLimits(maxPitch: 86).wireValue())
    XCTAssertThrowsError(
      try TileflowMapOptions(gestures: .init(doubleTapZoomDelta: 5)).validate())
  }

  func testOptionsPlaceTheAttributionByLayoutDirection() throws {
    let options = TileflowMapOptions(
      gestures: .init(cooperative: true),
      controls: .init(attributionPosition: .bottomLeading))
    XCTAssertEqual(try options.wireValue(rightToLeft: false)["attribution"]?.string, "bottom-left")
    XCTAssertEqual(try options.wireValue(rightToLeft: true)["attribution"]?.string, "bottom-right")
    XCTAssertEqual(
      try options.wireValue(rightToLeft: false)["gestures"]?["cooperative"]?.bool, true)
    XCTAssertFalse(TileflowGestures.none.movesMap)
  }

  func testBoundsEnclosingCoordinatesTakeTheNarrowerSideOfTheWorld() throws {
    let city = try XCTUnwrap(
      TileflowBounds(enclosing: [
        .init(longitude: -3.71, latitude: 40.41), .init(longitude: -3.69, latitude: 40.43),
        .init(longitude: -3.70, latitude: 40.40),
      ]))
    XCTAssertEqual(city, TileflowBounds(west: -3.71, south: 40.40, east: -3.69, north: 40.43))
    let pacific = try XCTUnwrap(
      TileflowBounds(enclosing: [
        .init(longitude: 178, latitude: -17), .init(longitude: -179, latitude: -16),
        .init(longitude: 179.5, latitude: -18),
      ]))
    XCTAssertEqual(pacific, TileflowBounds(west: 178, south: -18, east: -179, north: -16))
    XCTAssertNil(TileflowBounds(enclosing: []))
  }

  func testScaleBarShowsTheLongestRoundDistanceThatFits() {
    // At zoom 10 on the equator a point covers about 76.4 m, so 100 points cover 7.6 km.
    let equator = TileflowCamera(longitude: 0, latitude: 0, zoom: 10)
    let metric = ScaleBarMeasure(camera: equator, maximumLength: 100, imperial: false)
    XCTAssertEqual(metric.value, 5)
    XCTAssertEqual(metric.unit, .kilometers)
    XCTAssertEqual(metric.length, 65.4, accuracy: 0.1)
    let imperial = ScaleBarMeasure(camera: equator, maximumLength: 100, imperial: true)
    XCTAssertEqual(imperial.value, 2)
    XCTAssertEqual(imperial.unit, .miles)
    let street = ScaleBarMeasure(
      camera: .init(longitude: -3.7, latitude: 40.42, zoom: 18), maximumLength: 100,
      imperial: false)
    XCTAssertEqual(street.unit, .meters)
    XCTAssertEqual(street.value, 20)
    XCTAssertLessThanOrEqual(street.length, 100)
  }

  func testTheApplicationReceivesCameraEventsAtItsLevelAndInterval() async throws {
    let gate = CameraEventGate()
    func change(_ phase: TileflowCameraChangePhase, zoom: Double = 1) -> TileflowCameraChange {
      .init(camera: .init(longitude: 0, latitude: 0, zoom: zoom), reason: .gesture, phase: phase)
    }
    let received = Received()
    let deliver: @MainActor (TileflowCameraChange) -> Void = { received.changes.append($0) }
    var delivered: [TileflowCameraChange] {
      get { received.changes }
      set { received.changes = newValue }
    }
    // The SDK follows the movement even when the application only asks for the settled camera.
    gate.receive(change(.started), options: .init(), deliver: deliver)
    XCTAssertTrue(gate.isMoving)
    gate.receive(change(.moving), options: .init(), deliver: deliver)
    gate.receive(change(.ended), options: .init(), deliver: deliver)
    XCTAssertFalse(gate.isMoving)
    XCTAssertEqual(delivered.map(\.phase), [.ended])

    delivered.removeAll()
    let throttled = TileflowEventOptions(level: .continuous, cameraUpdateInterval: 0.2)
    gate.receive(change(.started), options: throttled, deliver: deliver)
    for zoom in [2.0, 3, 4] { gate.receive(change(.moving, zoom: zoom), options: throttled, deliver: deliver) }
    XCTAssertEqual(delivered.map(\.camera.zoom), [1, 2], "Later updates wait for the interval.")
    try await Task.sleep(for: .milliseconds(450))
    XCTAssertEqual(delivered.map(\.camera.zoom), [1, 2, 4], "The latest update arrives after it.")
    gate.receive(change(.moving, zoom: 5), options: throttled, deliver: deliver)
    gate.receive(change(.moving, zoom: 6), options: throttled, deliver: deliver)
    gate.receive(change(.ended, zoom: 7), options: throttled, deliver: deliver)
    try await Task.sleep(for: .milliseconds(350))
    XCTAssertEqual(
      delivered.map(\.camera.zoom), [1, 2, 4, 5, 7], "The settled camera replaces a pending one.")
  }

  func testTouchesAndGesturesFromTheRenderer() {
    let touch = TileflowMapTouch(
      wire: .object([
        "coordinate": .object(["longitude": .number(-3.7), "latitude": .number(40.42)]),
        "point": .object(["x": .number(120.5), "y": .number(-4)]),
      ]))
    XCTAssertEqual(touch?.point, CGPoint(x: 120.5, y: -4))
    XCTAssertEqual(touch?.coordinate.latitude, 40.42)
    XCTAssertNil(
      TileflowMapTouch(
        wire: .object([
          "coordinate": .object(["longitude": .number(200), "latitude": .number(0)]),
          "point": .object(["x": .number(0), "y": .number(0)]),
        ])))
    XCTAssertEqual(TileflowGesture(rawValue: "pitch"), .pitch)
  }

  func testTheMapClaimsTouchesFromContainersAndLeavesVetoedOnes() throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: URL(string: "https://maps.example.test/manifest.json")!))
    defer { view.destroy() }
    view.frame = CGRect(x: 0, y: 0, width: 300, height: 600)
    let scroll = UIScrollView()
    scroll.addSubview(view)
    let claim = try XCTUnwrap(view.gestureRecognizers?.compactMap { $0 as? MapTouchClaim }.first)
    XCTAssertTrue(
      claim.gestureRecognizer(claim, shouldBeRequiredToFailBy: scroll.panGestureRecognizer),
      "A scroll view around the map waits for the map's gesture.")
    let sibling = UIView()
    let pan = UIPanGestureRecognizer()
    sibling.addGestureRecognizer(pan)
    XCTAssertFalse(claim.gestureRecognizer(claim, shouldBeRequiredToFailBy: pan))
    XCTAssertTrue(claim.gestureRecognizer(claim, shouldRecognizeSimultaneouslyWith: pan))

    view.shouldReceiveTouch = { $0.y < 300 }
    XCTAssertNotNil(view.hitTest(CGPoint(x: 10, y: 100), with: nil))
    XCTAssertNil(view.hitTest(CGPoint(x: 10, y: 400), with: nil))
  }
}
