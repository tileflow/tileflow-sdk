import CoreGraphics
import Foundation

/// A stable imperative handle for a SwiftUI map. A controller attaches to one view at a time.
@MainActor
public final class TileflowMapController {
  private weak var view: TileflowMapView?
  public init() {}

  public func setCamera(_ camera: TileflowCamera, duration: TimeInterval = 0) async throws {
    try await attached().setCamera(camera, duration: duration)
  }
  public func camera() async throws -> TileflowCamera { try await attached().camera() }
  public func setTheme(
    _ theme: String?, timeOfDay: TileflowTimeOfDay? = nil, duration: TimeInterval = 0
  ) async throws {
    try await attached().setTheme(theme, timeOfDay: timeOfDay, duration: duration)
  }
  public func setBlend(
    themes: [String], position: Double, hold: Bool = false, duration: TimeInterval = 0
  ) async throws {
    try await attached().setBlend(
      themes: themes, position: position, hold: hold, duration: duration)
  }
  public func setOptions(_ options: TileflowMapOptions) async throws {
    try await attached().setOptions(options)
  }
  public func setContent(
    annotations: [TileflowAnnotation] = [], layers: [TileflowGeoJSONLayer] = []
  ) async throws {
    try await attached().setContent(annotations: annotations, layers: layers)
  }
  public func query(at point: CGPoint) async throws -> [TileflowRenderedFeature] {
    try await attached().query(at: point)
  }
  public func project(_ coordinate: TileflowCoordinate) async throws -> CGPoint {
    try await attached().project(coordinate)
  }
  public func unproject(_ point: CGPoint) async throws -> TileflowCoordinate {
    try await attached().unproject(point)
  }
  public func fit(
    _ bounds: TileflowBounds, padding: Double = 24, maxZoom: Double = 20, duration: TimeInterval = 0
  ) async throws {
    try await attached().fit(bounds, padding: padding, maxZoom: maxZoom, duration: duration)
  }
  public func reload() throws { try attached().reload() }

  func attach(_ view: TileflowMapView) throws {
    guard self.view == nil || self.view === view else { throw TileflowMapError.invalidRequest }
    self.view = view
  }
  func detach(_ view: TileflowMapView) { if self.view === view { self.view = nil } }
  private func attached() throws -> TileflowMapView {
    guard let view else { throw TileflowMapError.notReady }
    return view
  }
}
