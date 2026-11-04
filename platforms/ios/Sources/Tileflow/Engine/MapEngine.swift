import UIKit

/// Which engine draws a ``TileflowMapView``. Internal: applications always get the default.
enum MapEngineKind: Sendable {
  /// The embedded web runtime in a `WKWebView`.
  case webView
  /// MapLibre Native.
  case native

  @MainActor func validateQueued(_ source: RuntimeStyle.Source) throws {
    if self == .native { try NativeRuntimeStyle.validateQueuedSource(source) }
  }

  @MainActor func validateQueued(_ layer: RuntimeStyle.Layer) throws {
    if self == .native {
      try NativeRuntimeStyle.validateQueuedLayer(layer)
    }
  }
}

/// The commands a view sends to its engine, with the JSON payloads the view has validated. Both
/// engines read the same requests, so the view keeps one copy of what the application asked for
/// and replays it to each new engine.
typealias MapEngineCommand = ProtocolContract.Method

/// The part of the map a command belongs to.
enum MapEngineArea: Sendable {
  /// Loading the map, its renderer generation and its visibility.
  case load
  /// Themes and theme blends.
  case theme
  /// Options, insets and the events the view subscribes to.
  case options
  /// Camera movement, reads, projection and visible bounds.
  case camera
  /// Annotations and GeoJSON layers set with `setContent`.
  case content
  /// The scene beyond the theme: view mode, sun, emphasis, style state, images, animations.
  case scene
  /// The application's runtime style, feature state and queries.
  case style
  /// The location puck and following.
  case location
  /// Annotation layers and the points that view annotations track.
  case annotations
}

extension ProtocolContract.Method {
  var area: MapEngineArea {
    switch self {
    case .initialize, .cancel, .readResult, .dispose, .setVisibility: .load
    case .setTheme, .setBlend: .theme
    case .setOptions, .setEvents, .setInsets: .options
    case .moveCamera, .stopCamera, .getCamera, .cameraForBounds, .visibleBounds, .project,
      .unproject:
      .camera
    case .setContent: .content
    case .setViewMode, .setSun, .setEmphasis, .setStyleState, .getRouteInks, .setBoundaryValues,
      .setImages, .setDepthMarkers, .animateLineProgress, .playShot, .stopAnimation:
      .scene
    case .addSource, .removeSource, .setGeoJSONSourceData, .updateGeoJSONSource, .addLayer,
      .updateLayer, .moveLayer, .removeLayer, .setFeatureState, .getFeatureState,
      .removeFeatureState, .queryRenderedFeatures, .querySourceFeatures, .queryCluster,
      .queryAtPoint:
      .style
    case .updateLocation, .setFollowMode: .location
    case .setAnnotationLayers, .setTrackedPoints: .annotations
    }
  }
}

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
  var data: DataChannel { get }
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
  /// The renderer's process ended (`processTerminated`) or it lost its graphics context
  /// (`graphicsContextLost`); the view decides whether to replace it.
  var onRendererTerminated: ((ProtocolContract.ErrorReason) -> Void)? { get set }

  /// Starts loading. ``onReady`` follows.
  func start()
  /// Sends a command. Cancelling the calling task cancels it in the engine as well.
  func call(_ command: MapEngineCommand, payload: JSONValue, data: [DataChannel.Reference])
    async throws -> JSONValue
  /// Pending calls fail with `error`; the engine stops and leaves the view hierarchy.
  func retire(_ error: TileflowMapError)
}

extension MapEngine {
  /// A separate renderer process delivers positions in its tracked-points events.
  var onAnnotationFrame: ((Int, [CGPoint?]) -> Void)? {
    get { nil }
    set {}
  }

  func call(_ command: MapEngineCommand) async throws -> JSONValue {
    try await call(command, payload: .null, data: [])
  }

  func call(_ command: MapEngineCommand, payload: JSONValue) async throws -> JSONValue {
    try await call(command, payload: payload, data: [])
  }
}
