import Foundation
import UIKit

extension TileflowMapView {
  /// The touch's annotations, topmost first, from a `tap` or `longPress` event.
  nonisolated static func annotationHits(_ value: JSONValue) -> [(layer: String, id: String)] {
    guard case .array(let items) = value["annotations"] else { return [] }
    return items.compactMap { item in
      guard let layer = item["layer"]?.string, let id = item["id"]?.string else { return nil }
      return (layer, id)
    }
  }

  /// Gives a tap or long press to the touched annotations; true when a handler consumed it, so
  /// the application's map event is not sent.
  func annotationTouch(_ value: JSONValue, touch: TileflowMapTouch, longPress: Bool) -> Bool {
    let hits = Self.annotationHits(value)
    guard !hits.isEmpty else { return false }
    return annotations.touch(
      hits, longPress: longPress,
      context: TileflowAnnotationInteractionContext(
        point: touch.point, coordinate: touch.coordinate))
  }

  func receiveAnnotationDrag(_ value: JSONValue) {
    guard let phase = value["phase"]?.string.flatMap(AnnotationDragPhase.init(rawValue:)),
      let layer = value["layer"]?.string, let id = value["id"]?.string,
      let geometry = value["geometry"].flatMap(TileflowGeometry.init),
      let x = value["point"]?["x"]?.number, let y = value["point"]?["y"]?.number,
      let coordinate = geometry.representativeCoordinate
    else { return }
    annotations.drag(
      layer: layer, id: id, phase: phase, geometry: geometry,
      context: TileflowAnnotationInteractionContext(
        point: CGPoint(x: x, y: y), coordinate: coordinate))
  }

  /// The annotation layers changed: tell the renderer which layers people touch and drag.
  func annotationLayersChanged() {
    setAnnotationInteraction(!annotations.isEmpty)
    guard let bridge = readyBridge else { return }
    let layers = annotations.layerIDs
    Task {
      _ = try? await bridge.call(
        .setAnnotationLayers, payload: .object(["layers": .array(layers.map(JSONValue.string))]))
    }
  }

  /// Gives a new renderer the annotation layers and the tracked points.
  func replayAnnotations(through bridge: MapBridge) async throws {
    if !annotations.isEmpty {
      _ = try await bridge.call(
        .setAnnotationLayers,
        payload: .object(["layers": .array(annotations.layerIDs.map(JSONValue.string))]))
    }
    annotationOverlay.trackingChanged()
  }

  /// Makes the view draw a controller's annotations and view annotations instead of its own.
  func adopt(
    annotations orchestrator: TileflowAnnotationOrchestrator,
    viewAnnotations manager: TileflowViewAnnotationManager
  ) {
    if annotations !== orchestrator {
      annotations.unbind()
      annotations = orchestrator
    }
    if viewAnnotations !== manager {
      viewAnnotations.unbind()
      viewAnnotations = manager
    }
    orchestrator.bind(self)
    manager.bind(self)
  }

  /// Gives the view empty annotations of its own again when a controller leaves it.
  func release(
    annotations orchestrator: TileflowAnnotationOrchestrator,
    viewAnnotations manager: TileflowViewAnnotationManager
  ) {
    if annotations === orchestrator {
      orchestrator.unbind()
      annotations = TileflowAnnotationOrchestrator(view: self)
    }
    if viewAnnotations === manager {
      manager.unbind()
      viewAnnotations = TileflowViewAnnotationManager(view: self)
    }
  }

  /// The custom rotor that walks the map's annotations in reading order.
  func makeAnnotationRotor() -> UIAccessibilityCustomRotor {
    UIAccessibilityCustomRotor(name: "Annotations") { [weak self] predicate in
      guard let self else { return nil }
      let elements = self.annotationOverlay.orderedAccessibilityElements()
      guard !elements.isEmpty else { return nil }
      let current = predicate.currentItem.targetElement.flatMap { target in
        elements.firstIndex { ($0 as AnyObject) === (target as AnyObject) }
      }
      let index: Int
      switch (predicate.searchDirection, current) {
      case (.next, nil): index = 0
      case (.previous, nil): index = elements.count - 1
      case (.next, let current?): index = current + 1
      case (.previous, let current?): index = current - 1
      @unknown default: return nil
      }
      guard elements.indices.contains(index),
        let target = elements[index] as? NSObjectProtocol
      else { return nil }
      return UIAccessibilityCustomRotorItemResult(targetElement: target, targetRange: nil)
    }
  }
}
