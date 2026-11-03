import UIKit
import XCTest

@testable import Tileflow

/// The camera arithmetic of the native engine: flight durations, visible bounds as the web reports
/// them, zooming around a point and offsets on screen.
final class NativeCameraTests: XCTestCase {
  private let size = CGSize(width: 390, height: 844)

  func testAFlightLastsItsPathLengthOverItsSpeed() {
    let start = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 12)
    // Zooming in place travels ln(w0 / w1) / ρ screenfuls.
    let zoomIn = NativeCameraMath.flightDuration(
      from: start, to: TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 14), size: size,
      speed: 1.2, curve: 1.42, minZoom: nil)
    XCTAssertEqual(zoomIn, log(4) / 1.42 / 1.2, accuracy: 1e-9)
    XCTAssertEqual(
      NativeCameraMath.flightDuration(
        from: start, to: start, size: size, speed: 1.2, curve: 1.42, minZoom: nil), 0)
    // A longer way takes longer; twice the speed takes half the time; the way back is as long.
    let madrid = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 12)
    let paris = TileflowCamera(longitude: 2.35, latitude: 48.86, zoom: 12)
    let tokyo = TileflowCamera(longitude: 139.70, latitude: 35.70, zoom: 12)
    let near = NativeCameraMath.flightDuration(
      from: madrid, to: paris, size: size, speed: 1.2, curve: 1.42, minZoom: nil)
    let far = NativeCameraMath.flightDuration(
      from: madrid, to: tokyo, size: size, speed: 1.2, curve: 1.42, minZoom: nil)
    XCTAssertGreaterThan(far, near)
    XCTAssertEqual(
      NativeCameraMath.flightDuration(
        from: madrid, to: paris, size: size, speed: 2.4, curve: 1.42, minZoom: nil), near / 2,
      accuracy: 1e-9)
    XCTAssertEqual(
      NativeCameraMath.flightDuration(
        from: paris, to: madrid, size: size, speed: 1.2, curve: 1.42, minZoom: nil), near,
      accuracy: 1e-9)
    // The shorter way round crosses the antimeridian.
    let west = TileflowCamera(longitude: 179.9, latitude: 0, zoom: 10)
    let east = TileflowCamera(longitude: -179.9, latitude: 0, zoom: 10)
    let across = NativeCameraMath.flightDuration(
      from: west, to: east, size: size, speed: 1.2, curve: 1.42, minZoom: nil)
    XCTAssertLessThan(across, 5)
  }

  @MainActor
  func testAFlightLongerThanTheLimitJumps() {
    let start = TileflowCamera(longitude: -3.70, latitude: 40.42, zoom: 16)
    let end = TileflowCamera(longitude: 139.70, latitude: 35.70, zoom: 16)
    let slow: JSONValue = .object(["type": .string("fly"), "speed": .number(0.01)])
    guard case .jump = NativeCamera.animation(slow, from: start, to: end, size: size) else {
      return XCTFail("A flight longer than 20 seconds animated.")
    }
    let quick: JSONValue = .object(["type": .string("fly")])
    guard case .fly(let duration, nil) = NativeCamera.animation(quick, from: start, to: end, size: size)
    else { return XCTFail("A flight did not fly.") }
    XCTAssertLessThanOrEqual(duration, 20)
    let timed: JSONValue = .object(["type": .string("ease"), "duration": .number(400)])
    guard case .ease(let seconds, _) = NativeCamera.animation(timed, from: start, to: end, size: size)
    else { return XCTFail("An ease did not ease.") }
    XCTAssertEqual(seconds, 0.4, accuracy: 1e-9)
  }

  func testVisibleBoundsAreReportedAsOnTheWeb() {
    let plain = NativeCameraMath.normalized(west: -3.8, south: 40.3, east: -3.6, north: 40.5)
    XCTAssertEqual(plain, TileflowBounds(west: -3.8, south: 40.3, east: -3.6, north: 40.5))
    // Across the antimeridian the east edge lies west of the west edge.
    let across = NativeCameraMath.normalized(west: 170, south: -10, east: 190, north: 10)
    XCTAssertEqual(across.west, 170, accuracy: 1e-9)
    XCTAssertEqual(across.east, -170, accuracy: 1e-9)
    let unwrapped = NativeCameraMath.normalized(west: -190, south: -10, east: -170, north: 10)
    XCTAssertEqual(unwrapped.west, 170, accuracy: 1e-9)
    XCTAssertEqual(unwrapped.east, -170, accuracy: 1e-9)
    // A view wider than the world shows all of it.
    let world = NativeCameraMath.normalized(west: -300, south: -80, east: 300, north: 80)
    XCTAssertEqual(world, TileflowBounds(west: -180, south: -80, east: 180, north: 80))
  }

  func testZoomingAroundAPointKeepsItInPlace() {
    let center = TileflowCoordinate(longitude: -3.70, latitude: 40.42)
    let anchor = TileflowCoordinate(longitude: -3.68, latitude: 40.43)
    let zoomed = NativeCameraMath.center(zoomingBy: 2, around: anchor, from: center)
    // The anchor's offset from the centre, in the world, shrinks by 2².
    let a = NativeCameraMath.project(anchor)
    let c = NativeCameraMath.project(center)
    let z = NativeCameraMath.project(zoomed)
    XCTAssertEqual(Double(a.x - z.x), Double(a.x - c.x) / 4, accuracy: 1e-12)
    XCTAssertEqual(Double(a.y - z.y), Double(a.y - c.y) / 4, accuracy: 1e-12)
    XCTAssertEqual(
      NativeCameraMath.center(zoomingBy: 0, around: anchor, from: center).longitude,
      center.longitude, accuracy: 1e-9)
  }

  func testOffsetsOnScreenTurnWithTheBearing() {
    let start = TileflowCoordinate(longitude: 0, latitude: 0)
    // At zoom 0 the world is 512 points wide: 128 points to the right is 90° east.
    let east = NativeCameraMath.shifted(start, by: CGPoint(x: 128, y: 0), zoom: 0, bearing: 0)
    XCTAssertEqual(east.longitude, 90, accuracy: 1e-9)
    XCTAssertEqual(east.latitude, 0, accuracy: 1e-9)
    // With the top of the screen pointing east, the right of the screen points south.
    let south = NativeCameraMath.shifted(start, by: CGPoint(x: 1, y: 0), zoom: 10, bearing: 90)
    XCTAssertEqual(south.longitude, 0, accuracy: 1e-9)
    XCTAssertLessThan(south.latitude, 0)
    let up = NativeCameraMath.shifted(start, by: CGPoint(x: 0, y: -1), zoom: 10, bearing: 90)
    XCTAssertGreaterThan(up.longitude, 0)
    XCTAssertEqual(up.latitude, 0, accuracy: 1e-9)
  }
}
