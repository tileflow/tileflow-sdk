import UIKit

/// Commands the view replays to each renderer generation.
typealias MapEngineCommand = MapContract.Method

/// What draws one generation of a ``TileflowMapView``.
///
/// The view owns everything the application asked for: source, theme, options, camera, content,
/// scene, runtime style, location and annotations. It creates an engine for each renderer
/// generation, waits for ``onReady``, sends `initialize` and replays the rest. The engine draws,
/// answers commands and reports events in the SDK's event vocabulary (`contentReady`,
/// `cameraMoveEnded`, `tap`, `warning`, …) through ``onEvent``.
@MainActor
protocol MapEngine: AnyObject, Sendable {
  /// The view that shows the map. The map view places it under its annotations and controls.
  var view: UIView { get }
  /// Payloads that requests refer to, such as GeoJSON or images. A request releases its own when
  /// it ends; retiring the engine releases everything.
  var data: MapPayloadStore { get }
  /// The engine accepts `initialize`.
  var onReady: (() -> Void)? { get set }
  /// An event and its value.
  var onEvent: ((String, JSONValue) -> Void)? { get set }
  /// Positions of tracked views when the engine draws in the same UIKit frame.
  var onAnnotationFrame: ((Int, [CGPoint?]) -> Void)? { get set }
  /// The engine cannot continue in this generation.
  var onFailure: ((TileflowMapError) -> Void)? { get set }
  /// The engine could not start, before it was ready; the view reports it as it is.
  var onLoadFailure: ((TileflowMapError) -> Void)? { get set }
  /// A person activated a link the map shows.
  var onExternalLink: ((URL) -> Void)? { get set }
  /// The renderer lost its graphics context; the view decides whether to replace it.
  var onRendererTerminated: ((MapContract.ErrorReason) -> Void)? { get set }

  /// Starts loading. ``onReady`` follows.
  func start()
  /// Sends a command. Cancelling the calling task cancels it in the engine as well.
  func call(_ command: MapEngineCommand, payload: JSONValue, data: [MapPayloadStore.Reference])
    async throws -> JSONValue
  /// Updates the map's simple markers while application overlays keep drawing.
  func setAnnotations(_ annotations: [TileflowAnnotation]) async throws
  /// Pending calls fail with `error`; the engine stops and leaves the view hierarchy.
  func retire(_ error: TileflowMapError)
}

extension MapEngine {
  func call(_ command: MapEngineCommand) async throws -> JSONValue {
    try await call(command, payload: .null, data: [])
  }

  func call(_ command: MapEngineCommand, payload: JSONValue) async throws -> JSONValue {
    try await call(command, payload: payload, data: [])
  }
}
