import Foundation
import UIKit

/// Creates and keeps the map's annotation managers. Reach it as ``TileflowMapView/annotations`` or
/// ``TileflowMapController/annotations``.
///
/// Each manager draws its annotations with one source and one layer of the application's runtime
/// style, so they follow theme changes and a new renderer like any application layer. Taps and long
/// presses on an annotation reach its handlers first; a handler that returns true keeps the touch
/// from the annotations below and from the map's `tap` and `longPress` events.
@MainActor
public final class TileflowAnnotationOrchestrator {
  private var managers: [any AnnotationManaging] = []
  private let queue = AnnotationFlushQueue()
  private(set) weak var view: TileflowMapView?

  init() {}

  /// An orchestrator that starts on `view`, empty, so the view has nothing to update.
  init(view: TileflowMapView) {
    self.view = view
  }

  /// The managers by identifier.
  public var annotationManagersById: [String: any TileflowAnnotationManager] {
    Dictionary(
      managers.map { ($0.id, $0 as any TileflowAnnotationManager) }, uniquingKeysWith: { $1 })
  }

  /// A manager of point annotations. `id` names its source and layer (a new identifier when nil);
  /// `slot` and `position` place its layer as ``TileflowMapView/addLayer(_:position:)`` does. A
  /// manager with the identifier of an existing one replaces it.
  public func makePointAnnotationManager(
    id: String? = nil, slot: TileflowLayerSlot? = nil, position: TileflowLayerPosition = .default
  ) -> TileflowPointAnnotationManager {
    add(TileflowPointAnnotationManager(id: identifier(id), slot: slot, position: position))
  }

  /// A manager of circle annotations; see ``makePointAnnotationManager(id:slot:position:)``.
  public func makeCircleAnnotationManager(
    id: String? = nil, slot: TileflowLayerSlot? = nil, position: TileflowLayerPosition = .default
  ) -> TileflowCircleAnnotationManager {
    add(TileflowCircleAnnotationManager(id: identifier(id), slot: slot, position: position))
  }

  /// A manager of line annotations; see ``makePointAnnotationManager(id:slot:position:)``.
  public func makePolylineAnnotationManager(
    id: String? = nil, slot: TileflowLayerSlot? = nil, position: TileflowLayerPosition = .default
  ) -> TileflowPolylineAnnotationManager {
    add(TileflowPolylineAnnotationManager(id: identifier(id), slot: slot, position: position))
  }

  /// A manager of polygon annotations; see ``makePointAnnotationManager(id:slot:position:)``.
  public func makePolygonAnnotationManager(
    id: String? = nil, slot: TileflowLayerSlot? = nil, position: TileflowLayerPosition = .default
  ) -> TileflowPolygonAnnotationManager {
    add(TileflowPolygonAnnotationManager(id: identifier(id), slot: slot, position: position))
  }

  /// Removes a manager with its layer, source and the images it added.
  public func removeAnnotationManager(withId id: String) {
    guard let index = managers.firstIndex(where: { $0.id == id }) else { return }
    managers.remove(at: index).core.detach()
    changed(layers: true)
  }

  private func identifier(_ id: String?) -> String {
    guard let id else { return UUID().uuidString }
    // An identifier the style refuses is reported when the manager first draws.
    return id
  }

  private func add<M: AnnotationManaging>(_ manager: M) -> M {
    removeAnnotationManager(withId: manager.id)
    managers.append(manager)
    manager.core.queue = queue
    manager.core.onChange = { [weak self] in self?.changed(layers: false) }
    if let view { manager.core.attach(to: view) }
    changed(layers: true)
    return manager
  }

  private func changed(layers: Bool) {
    guard let view else { return }
    if layers { view.annotationLayersChanged() }
    view.annotationOverlay.trackingChanged()
  }

  /// Draws every manager on `view`, after taking them off the view they were on.
  func bind(_ view: TileflowMapView) {
    guard self.view !== view else { return }
    unbind()
    self.view = view
    for manager in managers { manager.core.attach(to: view) }
    changed(layers: true)
  }

  func unbind() {
    guard let previous = view else { return }
    for manager in managers { manager.core.detach() }
    view = nil
    previous.annotationLayersChanged()
    previous.annotationOverlay.trackingChanged()
  }

  /// The layers the renderer treats as annotations.
  var layerIDs: [String] { managers.map(\.id) }
  var isEmpty: Bool { managers.isEmpty }

  /// Gives a tap or long press to the touched annotations, topmost first, until a handler consumes
  /// it. Returns whether one did.
  func touch(
    _ hits: [(layer: String, id: String)], longPress: Bool,
    context: TileflowAnnotationInteractionContext
  ) -> Bool {
    for hit in hits {
      guard let manager = managers.first(where: { $0.id == hit.layer }) else { continue }
      if manager.touch(hit.id, longPress: longPress, context: context) { return true }
    }
    return false
  }

  func drag(
    layer: String, id: String, phase: AnnotationDragPhase, geometry: TileflowGeometry,
    context: TileflowAnnotationInteractionContext
  ) {
    managers.first(where: { $0.id == layer })?.drag(
      id, phase: phase, geometry: geometry, context: context)
  }

  var accessibleAnnotations: [AccessibleAnnotation] {
    managers.flatMap(\.accessibleAnnotations)
  }
}
