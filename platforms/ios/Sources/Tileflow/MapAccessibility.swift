import UIKit

/// A focusable summary alongside the renderer, controls, credits and annotation rotor.
@MainActor
final class MapAccessibilitySummary: UIAccessibilityElement {
  private weak var map: TileflowMapView?

  init(map: TileflowMapView) {
    self.map = map
    super.init(accessibilityContainer: map)
    accessibilityTraits = [.image]
    accessibilityCustomActions = Action.allCases.map { action in
      UIAccessibilityCustomAction(name: action.rawValue) { [weak self] _ in
        self?.perform(action) ?? false
      }
    }
  }

  override var accessibilityLabel: String? {
    get { map?.accessibilityLabel ?? "Interactive map" }
    set {}
  }

  override var accessibilityValue: String? {
    get {
      guard let map else { return nil }
      guard let camera = map.currentCamera else { return map.source.map }
      return String(
        format: "%@, latitude %.4f, longitude %.4f, zoom %.1f", map.source.map, camera.latitude,
        camera.longitude, camera.zoom)
    }
    set {}
  }

  override var accessibilityFrameInContainerSpace: CGRect {
    get { map?.bounds ?? .zero }
    set {}
  }

  private enum Action: String, CaseIterable {
    case zoomIn = "Zoom in"
    case zoomOut = "Zoom out"
    case north = "Pan north"
    case south = "Pan south"
    case
      east = "Pan east"
    case west = "Pan west"
  }

  private func perform(_ action: Action) -> Bool {
    guard let map, map.readyEngine != nil, let camera = map.currentCamera else { return false }
    Task { @MainActor [weak map] in
      guard let map else { return }
      do {
        let update: TileflowCameraUpdate
        switch action {
        case .zoomIn, .zoomOut:
          let limits = map.options.cameraLimits
          let zoom = min(
            limits.maxZoom, max(limits.minZoom, camera.zoom + (action == .zoomIn ? 1 : -1)))
          update = .init(zoom: zoom)
        case .north, .south, .east, .west:
          let center = try await map.project(
            .init(longitude: camera.longitude, latitude: camera.latitude))
          let bearing = camera.bearing * .pi / 180
          let step = min(map.bounds.width, map.bounds.height) / 3
          let east: Double = action == .east ? 1 : action == .west ? -1 : 0
          let north: Double = action == .north ? 1 : action == .south ? -1 : 0
          let point = CGPoint(
            x: center.x + step * (east * cos(bearing) - north * sin(bearing)),
            y: center.y - step * (east * sin(bearing) + north * cos(bearing)))
          var coordinate = try await map.unproject(point)
          if east == 0 {
            coordinate.longitude = camera.longitude
          } else {
            coordinate.latitude = camera.latitude
          }
          update = .init(center: coordinate)
        }
        _ = try await map.move(to: update, animation: .ease(duration: 0.2), reason: "gesture")
      } catch { map.report(propertyError: error) }
    }
    return true
  }
}
