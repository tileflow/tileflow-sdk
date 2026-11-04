import Foundation
import MapLibre
import UIKit

/// Camera commands, options and MapLibre's camera changes, handed to ``NativeCamera`` and
/// ``NativeGestures``.
extension NativeMapEngine {
  /// The camera in the SDK's form, or null before MapLibre's view exists.
  var cameraWire: JSONValue { camera?.wire ?? .null }

  /// Moves to a camera at once, for the SDK.
  func apply(_ camera: TileflowCamera) {
    self.camera?.jump(to: camera)
  }

  /// Creates the camera and the gestures of a new MapLibre view. MapLibre's own compass, scale bar
  /// and logo stay hidden: the SDK draws its controls.
  func prepareCamera(_ mapView: MLNMapView) {
    mapView.showsCompassView = false
    mapView.showsScale = false
    mapView.showsLogoView = false
    mapView.maximumZoomLevel = 24
    let emit: (String, JSONValue) -> Void = { [weak self] event, value in
      guard let self, !self.retired else { return }
      if event == "cameraMoveStarted", value["reason"] == .string("gesture") {
        self.mapLocation.interrupt(.gesture)
      }
      self.onEvent?(event, value)
    }
    let camera = NativeCamera(mapView: mapView, emit: emit)
    self.camera = camera
    gestures = NativeGestures(mapView: mapView, container: container, camera: camera, annotations: mapAnnotations, emit: emit)
  }

  /// Applies what `initialize` carries for the camera before the map's first camera: the events
  /// the view follows, limits, gestures and insets.
  func configureCamera(_ payload: JSONValue) {
    setEvents(payload["events"])
    applyCameraOptions(payload["options"])
    if let insets = payload["insets"] { camera?.setInsets(Self.insets(insets)) }
  }

  func applyCameraOptions(_ options: JSONValue?) {
    guard let options else { return }
    mapLocation.setOptions(options["location"])
    gestures?.apply(options["gestures"])
    camera?.setLimits(options["limits"])
  }

  /// The view follows the camera frame by frame only when it subscribes to `cameraMoved`.
  func setEvents(_ events: JSONValue?) {
    guard case .object(let subscribed)? = events else { return }
    camera?.followsFrames = subscribed[ProtocolContract.Event.cameraMoved.rawValue] != nil
  }

  /// The commands ``cameraCommand(_:payload:)`` answers.
  static let cameraCommands: Set<MapEngineCommand> = [
    .getCamera, .moveCamera, .stopCamera, .cameraForBounds, .visibleBounds, .project, .unproject,
    .setInsets, .setEvents,
  ]

  /// Answers the camera commands; nil for any other command.
  func cameraCommand(_ command: MapEngineCommand, payload: JSONValue) async throws -> JSONValue? {
    guard Self.cameraCommands.contains(command) else { return nil }
    guard let camera else { throw TileflowMapError.notReady }
    switch command {
    case .getCamera:
      return camera.wire
    case .moveCamera:
      mapLocation.interrupt(payload["reason"]?.string == "gesture" ? .gesture : .api)
      sceneAnimations.stopShot()
      return try await camera.move(payload)
    case .stopCamera:
      mapLocation.interrupt(.api)
      sceneAnimations.stopShot()
      camera.stop()
      return .null
    case .cameraForBounds:
      guard let fitted = camera.fitted(payload) else { return .null }
      return try .encoded(fitted)
    case .visibleBounds:
      guard let bounds = camera.visibleBounds else { throw TileflowMapError.notReady }
      return try bounds.wireValue()
    case .project:
      guard let longitude = payload["longitude"]?.number, let latitude = payload["latitude"]?.number,
        let point = camera.point(for: TileflowCoordinate(longitude: longitude, latitude: latitude))
      else { throw TileflowMapError.invalidRequest }
      return .object(["x": .number(point.x), "y": .number(point.y)])
    case .unproject:
      guard let coordinate = camera.coordinate(at: try Self.point(payload)) else {
        throw TileflowMapError.notReady
      }
      return .object([
        "longitude": .number(coordinate.longitude), "latitude": .number(coordinate.latitude),
      ])
    case .setInsets:
      camera.setInsets(Self.insets(payload))
      attribution.place(corner: nil, insets: payload)
      return .null
    case .setEvents:
      setEvents(payload["events"])
      return .null
    default:
      return nil
    }
  }

  static func insets(_ value: JSONValue) -> UIEdgeInsets {
    let edge = { (key: String) in CGFloat(value[key]?.number ?? 0) }
    return UIEdgeInsets(top: edge("top"), left: edge("left"), bottom: edge("bottom"), right: edge("right"))
  }
}
