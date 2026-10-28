import Foundation

extension TileflowMapController {
  /// See ``TileflowMapView/setViewMode(_:duration:)``.
  public func setViewMode(_ mode: TileflowViewMode, duration: TimeInterval = 0) async throws {
    try await attached().setViewMode(mode, duration: duration)
  }

  /// See ``TileflowMapView/setSun(_:duration:)``.
  public func setSun(_ sun: TileflowSun?, duration: TimeInterval = 0) async throws {
    try await attached().setSun(sun, duration: duration)
  }

  /// See ``TileflowMapView/setEmphasis(_:duration:)``.
  public func setEmphasis(_ emphasis: TileflowEmphasis?, duration: TimeInterval = 0) async throws {
    try await attached().setEmphasis(emphasis, duration: duration)
  }

  /// See ``TileflowMapView/setStyleState(_:to:duration:)``.
  public func setStyleState(
    _ name: String, to value: TileflowStyleValue, duration: TimeInterval = 0
  ) async throws {
    try await attached().setStyleState(name, to: value, duration: duration)
  }

  /// See ``TileflowMapView/routeInks()``.
  public func routeInks() async throws -> TileflowRouteInks { try await attached().routeInks() }

  /// See ``TileflowMapView/setBoundaryValues(_:)``.
  public func setBoundaryValues(_ values: TileflowBoundaryValues?) async throws {
    try await attached().setBoundaryValues(values)
  }

  /// See ``TileflowMapView/setImages(_:)``.
  public func setImages(_ images: [TileflowMapImage]) async throws {
    try await attached().setImages(images)
  }

  /// See ``TileflowMapView/setDepthMarkers(_:)``.
  public func setDepthMarkers(_ markers: [TileflowDepthMarker]) async throws {
    try await attached().setDepthMarkers(markers)
  }

  /// See ``TileflowMapView/animateLineProgress(layers:to:duration:)``.
  @discardableResult
  public func animateLineProgress(
    layers: [String], to progress: TileflowLineProgress, duration: TimeInterval
  ) async throws -> Bool {
    try await attached().animateLineProgress(layers: layers, to: progress, duration: duration)
  }

  /// See ``TileflowMapView/play(_:onCue:)``.
  @discardableResult
  public func play(_ shot: TileflowShot, onCue: (@MainActor (String) -> Void)? = nil)
    async throws -> Bool
  {
    try await attached().play(shot, onCue: onCue)
  }
}
