import Foundation
import MapLibre
import UIKit

/// The map drawn by MapLibre Native in an `MLNMapView`.
///
/// The map view is always created with an inline style document: created without one, MapLibre
/// requests its demo style from the network. The engine answers the commands it implements and
/// rejects the others with `invalidRequest`, so a view never believes a request took effect.
@MainActor
final class NativeMapEngine: NSObject, MapEngine, MLNMapViewDelegate {
  /// A style with nothing to draw, which needs no resource.
  static let emptyStyle = #"{"version":8,"sources":{},"layers":[]}"#

  var onReady: (() -> Void)?
  var onEvent: ((String, JSONValue) -> Void)?
  var onFailure: ((TileflowMapError) -> Void)?
  var onLoadFailure: ((TileflowMapError) -> Void)?
  var onExternalLink: ((URL) -> Void)?
  var onRendererTerminated: (() -> Void)?

  let data = DataChannel()
  let mapView: MLNMapView
  private var retired = false
  private var initialized = false
  /// Whether the map finished loading the style it has now.
  private var mapLoaded = false
  /// Whether `contentReady` waits for the current style to finish loading.
  private var contentPending = false

  var view: UIView { mapView }

  init(frame: CGRect) {
    mapView = MLNMapView(frame: frame, styleJSON: Self.emptyStyle)
    super.init()
    mapView.delegate = self
    // The SDK shows its own attribution; MapLibre's logo and button stay hidden.
    mapView.logoView.isHidden = true
    mapView.attributionButton.isHidden = true
    mapView.automaticallyAdjustsContentInset = false
    mapView.contentInset = .zero
  }

  func start() {
    // The view finishes configuring the engine before it hears that the engine is ready.
    Task { @MainActor [weak self] in
      guard let self, !self.retired else { return }
      self.onReady?()
    }
  }

  func call(_ command: MapEngineCommand, payload: JSONValue, data: [DataChannel.Reference])
    async throws -> JSONValue
  {
    defer { self.data.release(data) }
    guard !retired else { throw TileflowMapError.disposed }
    switch command {
    case .initialize:
      guard !initialized else { throw TileflowMapError.invalidRequest }
      initialized = true
      if let camera = TileflowCamera(wire: payload["camera"]) { apply(camera) }
      contentPending = true
      if mapLoaded { contentLoaded() }
      return .null
    case .getCamera:
      return cameraWire
    case .setVisibility, .setEvents, .setOptions, .setInsets:
      return .null
    case .setContent:
      guard payload["annotations"]?.array?.isEmpty != false,
        payload["overlays"]?.array?.isEmpty != false
      else { throw Self.unsupported(command) }
      return .null
    case .setAnnotationLayers:
      // The view sends the layers whenever an engine becomes ready.
      guard payload["layers"]?.array?.isEmpty != false else { throw Self.unsupported(command) }
      return .null
    case .setTrackedPoints:
      guard payload["points"]?.array?.isEmpty != false else { throw Self.unsupported(command) }
      return .null
    default:
      throw Self.unsupported(command)
    }
  }

  static func unsupported(_ command: MapEngineCommand) -> TileflowMapError {
    TileflowMapError(
      .invalidRequest,
      context: .init(message: "The native map engine does not support \(command.rawValue) yet."))
  }

  func retire(_ error: TileflowMapError) {
    guard !retired else { return }
    retired = true
    data.retire()
    mapView.delegate = nil
    mapView.removeFromSuperview()
    onReady = nil
    onEvent = nil
    onFailure = nil
    onLoadFailure = nil
    onExternalLink = nil
    onRendererTerminated = nil
  }

  // MARK: Camera

  /// The camera in the SDK's form. MapLibre's direction runs from 0 to 360; the SDK's bearing
  /// runs from -180 to 180, as on the web.
  var cameraWire: JSONValue {
    let center = mapView.centerCoordinate
    var bearing = mapView.direction.truncatingRemainder(dividingBy: 360)
    if bearing > 180 { bearing -= 360 }
    if bearing <= -180 { bearing += 360 }
    return .object([
      "longitude": .number(center.longitude), "latitude": .number(center.latitude),
      "zoom": .number(mapView.zoomLevel), "bearing": .number(bearing),
      "pitch": .number(Double(mapView.camera.pitch)),
    ])
  }

  func apply(_ camera: TileflowCamera) {
    let center = CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude)
    let size = mapView.bounds.size
    guard size.width > 0, size.height > 0 else {
      mapView.setCenter(center, zoomLevel: camera.zoom, direction: camera.bearing, animated: false)
      return
    }
    let altitude = MLNAltitudeForZoomLevel(camera.zoom, camera.pitch, camera.latitude, size)
    mapView.setCamera(
      MLNMapCamera(
        lookingAtCenter: center, altitude: altitude, pitch: camera.pitch, heading: camera.bearing),
      animated: false)
  }

  // MARK: Loading

  private func contentLoaded() {
    guard contentPending, !retired else { return }
    contentPending = false
    onEvent?("contentReady", .object(["camera": cameraWire]))
  }

  nonisolated func mapViewDidFinishLoadingMap(_ mapView: MLNMapView) {
    MainActor.assumeIsolated {
      mapLoaded = true
      contentLoaded()
    }
  }
}
