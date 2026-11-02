import Foundation
import MapLibre
import UIKit

/// A camera movement the view asked for, until MapLibre finishes it.
struct NativeCameraMovement {
  let id: Int
  /// Who asked: `api`, or `location` while following the location.
  let reason: String
  let completion: CheckedContinuation<JSONValue, any Error>
}

/// Camera reads, movements and their events on MapLibre Native.
extension NativeMapEngine {
  private static var movements = 0

  /// The camera in the SDK's form. MapLibre's direction runs from 0 to 360; the SDK's bearing
  /// runs from -180 to 180, as on the web.
  var cameraWire: JSONValue {
    guard let mapView else { return .null }
    let center = mapView.centerCoordinate
    var bearing = mapView.direction.truncatingRemainder(dividingBy: 360)
    if bearing > 180 { bearing -= 360 }
    if bearing <= -180 { bearing += 360 }
    return .object([
      "longitude": .number(Self.wrap(center.longitude)), "latitude": .number(center.latitude),
      "zoom": .number(mapView.zoomLevel), "bearing": .number(bearing),
      "pitch": .number(Double(mapView.camera.pitch)),
    ])
  }

  func mapCamera(_ camera: TileflowCamera) -> MLNMapCamera? {
    guard let mapView else { return nil }
    let center = CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude)
    let size = mapView.bounds.size
    guard size.width > 0, size.height > 0 else { return nil }
    let altitude = MLNAltitudeForZoomLevel(camera.zoom, camera.pitch, camera.latitude, size)
    return MLNMapCamera(
      lookingAtCenter: center, altitude: altitude, pitch: camera.pitch, heading: camera.bearing)
  }

  func apply(_ camera: TileflowCamera) {
    guard let mapView else { return }
    guard let target = mapCamera(camera) else {
      mapView.setCenter(
        CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude),
        zoomLevel: camera.zoom, direction: camera.bearing, animated: false)
      return
    }
    mapView.setCamera(target, animated: false)
  }

  // MARK: Movements

  func moveCamera(_ payload: JSONValue) async throws -> JSONValue {
    guard let mapView, let current = TileflowCamera(wire: cameraWire) else {
      throw TileflowMapError.notReady
    }
    let target: TileflowCamera
    if let fit = payload["fit"] {
      guard let camera = fitted(fit) else { throw TileflowMapError.invalidRequest }
      target = camera
    } else {
      let update = payload["target"]
      target = TileflowCamera(
        longitude: update?["center"]?["longitude"]?.number ?? current.longitude,
        latitude: update?["center"]?["latitude"]?.number ?? current.latitude,
        zoom: update?["zoom"]?.number ?? current.zoom,
        bearing: update?["bearing"]?.number ?? current.bearing,
        pitch: update?["pitch"]?.number ?? current.pitch)
    }
    finishMovement(.cancelled)
    let animation = payload["animation"]
    let type = animation?["type"]?.string ?? "jump"
    let duration = (animation?["duration"]?.number).map { $0 / 1000 }
    guard let camera = mapCamera(target) else {
      apply(target)
      return .object(["completion": .string("finished"), "camera": cameraWire])
    }
    Self.movements += 1
    let id = Self.movements
    return try await withCheckedThrowingContinuation { completion in
      movement = NativeCameraMovement(
        id: id, reason: payload["reason"]?.string ?? "api", completion: completion)
      let ended = { [weak self] in
        guard let self, self.movement?.id == id else { return }
        self.finishMovement(.finished)
      }
      switch type {
      case "ease" where (duration ?? 0) > 0:
        let points = (animation?["easing"]?.array ?? []).compactMap(\.number).map { Float($0) }
        let timing =
          points.count == 4
          ? CAMediaTimingFunction(controlPoints: points[0], points[1], points[2], points[3])
          : CAMediaTimingFunction(name: .easeInEaseOut)
        mapView.setCamera(
          camera, withDuration: duration ?? 0, animationTimingFunction: timing,
          completionHandler: ended)
      case "fly":
        mapView.fly(to: camera, withDuration: duration ?? -1, completionHandler: ended)
      default:
        mapView.setCamera(camera, animated: false)
        ended()
      }
    }
  }

  enum MovementOutcome: String {
    case finished, cancelled, interrupted
  }

  /// Ends the current movement with an outcome and the camera where it stopped.
  func finishMovement(_ outcome: MovementOutcome) {
    guard let movement else { return }
    self.movement = nil
    movement.completion.resume(
      returning: .object(["completion": .string(outcome.rawValue), "camera": cameraWire]))
  }

  func stopCamera() {
    guard let mapView else { return }
    // Setting the camera it shows stops MapLibre's transition.
    mapView.setCamera(mapView.camera, animated: false)
    finishMovement(.cancelled)
  }

  func cameraForBounds(_ payload: JSONValue) throws -> JSONValue {
    guard let camera = fitted(payload) else { return .null }
    return try .encoded(camera)
  }

  /// The camera that frames bounds with padding inside the content insets; nil when the padding
  /// leaves no room.
  private func fitted(_ fit: JSONValue) -> TileflowCamera? {
    guard let mapView, let wire = fit["bounds"], let bounds = TileflowBounds(wire: wire) else {
      return nil
    }
    let edge = { (key: String) in CGFloat(fit["padding"]?[key]?.number ?? 0) }
    let padding = UIEdgeInsets(
      top: edge("top"), left: edge("left"), bottom: edge("bottom"), right: edge("right"))
    let size = mapView.bounds.size
    let insets = mapView.contentInset
    guard size.width - padding.left - padding.right - insets.left - insets.right > 0,
      size.height - padding.top - padding.bottom - insets.top - insets.bottom > 0
    else { return nil }
    let base = MLNMapCamera(
      lookingAtCenter: mapView.centerCoordinate, altitude: mapView.camera.altitude,
      pitch: fit["pitch"]?.number ?? mapView.camera.pitch,
      heading: fit["bearing"]?.number ?? mapView.direction)
    let east = bounds.east < bounds.west ? bounds.east + 360 : bounds.east
    let camera = mapView.camera(
      base,
      fitting: MLNCoordinateBounds(
        sw: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.west),
        ne: CLLocationCoordinate2D(latitude: bounds.north, longitude: east)),
      edgePadding: padding)
    var zoom = MLNZoomLevelForAltitude(
      camera.altitude, camera.pitch, camera.centerCoordinate.latitude, size)
    if let maxZoom = fit["maxZoom"]?.number { zoom = min(zoom, maxZoom) }
    var bearing = camera.heading.truncatingRemainder(dividingBy: 360)
    if bearing > 180 { bearing -= 360 }
    return TileflowCamera(
      longitude: Self.wrap(camera.centerCoordinate.longitude),
      latitude: camera.centerCoordinate.latitude, zoom: min(24, max(0, zoom)), bearing: bearing,
      pitch: camera.pitch)
  }

  // MARK: Events

  private static let gestures: MLNCameraChangeReason = [
    .gesturePan, .gesturePinch, .gestureRotate, .gestureZoomIn, .gestureZoomOut,
    .gestureOneFingerZoom, .gestureTilt,
  ]

  /// Who moved the camera, in the SDK's terms.
  private func reason(_ reason: MLNCameraChangeReason) -> String {
    if !reason.intersection(Self.gestures).isEmpty { return "gesture" }
    return movement?.reason ?? (reason.contains(.programmatic) ? "api" : "system")
  }

  func cameraWillMove(_ change: MLNCameraChangeReason) {
    // A person's gesture interrupts the movement the application asked for.
    if movement != nil, !change.intersection(Self.gestures).isEmpty {
      finishMovement(.interrupted)
    }
    cameraMoving = true
    onEvent?("cameraMoveStarted", .object(["camera": cameraWire, "reason": .string(reason(change))]))
  }

  func cameraIsMoving(_ change: MLNCameraChangeReason) {
    onEvent?("cameraMoved", .object(["camera": cameraWire, "reason": .string(reason(change))]))
  }

  func cameraDidMove(_ change: MLNCameraChangeReason) {
    cameraMoving = false
    onEvent?("cameraMoveEnded", .object(["camera": cameraWire, "reason": .string(reason(change))]))
  }
}
