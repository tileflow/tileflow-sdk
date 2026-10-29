import CoreGraphics
import Foundation
import UIKit

/// A stable imperative handle for a SwiftUI map. A controller attaches to one view at a time.
/// Each call forwards to ``TileflowMapView``; see it for details.
@MainActor
public final class TileflowMapController {
  private weak var view: TileflowMapView?
  public init() {}

  /// The camera the map last reported, or nil while no map is attached or before it is known.
  public var currentCamera: TileflowCamera? { view?.currentCamera }
  /// Whether the attached map's camera is moving.
  public var isMoving: Bool { view?.isMoving ?? false }

  public func setCamera(_ camera: TileflowCamera, duration: TimeInterval = 0) async throws {
    try await attached().setCamera(camera, duration: duration)
  }
  public func camera() async throws -> TileflowCamera { try await attached().camera() }

  @discardableResult
  public func move(
    to update: TileflowCameraUpdate, animation: TileflowCameraAnimation = .none
  ) async throws -> TileflowCameraAnimationResult {
    try await attached().move(to: update, animation: animation)
  }
  @discardableResult
  public func move(
    to camera: TileflowCamera, animation: TileflowCameraAnimation = .none
  ) async throws -> TileflowCameraAnimationResult {
    try await attached().move(to: camera, animation: animation)
  }
  @discardableResult
  public func jump(to update: TileflowCameraUpdate) async throws -> TileflowCameraAnimationResult {
    try await attached().jump(to: update)
  }
  @discardableResult
  public func jump(to camera: TileflowCamera) async throws -> TileflowCameraAnimationResult {
    try await attached().jump(to: camera)
  }
  @discardableResult
  public func ease(
    to update: TileflowCameraUpdate, duration: TimeInterval = 0.5,
    easing: TileflowEasing = .standard
  ) async throws -> TileflowCameraAnimationResult {
    try await attached().ease(to: update, duration: duration, easing: easing)
  }
  @discardableResult
  public func ease(
    to camera: TileflowCamera, duration: TimeInterval = 0.5, easing: TileflowEasing = .standard
  ) async throws -> TileflowCameraAnimationResult {
    try await attached().ease(to: camera, duration: duration, easing: easing)
  }
  @discardableResult
  public func fly(
    to update: TileflowCameraUpdate, options: TileflowFlyOptions = .init()
  ) async throws -> TileflowCameraAnimationResult {
    try await attached().fly(to: update, options: options)
  }
  @discardableResult
  public func fly(
    to camera: TileflowCamera, options: TileflowFlyOptions = .init()
  ) async throws -> TileflowCameraAnimationResult {
    try await attached().fly(to: camera, options: options)
  }
  @discardableResult
  public func fit(
    _ bounds: TileflowBounds, padding: UIEdgeInsets, bearing: Double? = nil,
    pitch: Double? = nil, maxZoom: Double? = nil, animation: TileflowCameraAnimation = .none
  ) async throws -> TileflowCameraAnimationResult {
    try await attached().fit(
      bounds, padding: padding, bearing: bearing, pitch: pitch, maxZoom: maxZoom,
      animation: animation)
  }
  public func fit(
    _ bounds: TileflowBounds, padding: Double = 24, maxZoom: Double = 20, duration: TimeInterval = 0
  ) async throws {
    try await attached().fit(bounds, padding: padding, maxZoom: maxZoom, duration: duration)
  }
  public func stopCamera() { view?.stopCamera() }
  public func camera(
    for bounds: TileflowBounds, padding: UIEdgeInsets = .zero, bearing: Double? = nil,
    pitch: Double? = nil, maxZoom: Double? = nil
  ) async throws -> TileflowCamera? {
    try await attached().camera(
      for: bounds, padding: padding, bearing: bearing, pitch: pitch, maxZoom: maxZoom)
  }
  public func camera(
    fitting coordinates: [TileflowCoordinate], padding: UIEdgeInsets = .zero,
    bearing: Double? = nil, pitch: Double? = nil, maxZoom: Double? = nil
  ) async throws -> TileflowCamera? {
    try await attached().camera(
      fitting: coordinates, padding: padding, bearing: bearing, pitch: pitch, maxZoom: maxZoom)
  }
  public func visibleBounds() async throws -> TileflowBounds {
    try await attached().visibleBounds()
  }

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
