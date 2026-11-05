import Foundation
import Tileflow
import UIKit

/// Fabric keeps the child view; the SDK owns its geographic placement and visibility.
@MainActor
@objc(TFMarkerBinding)
public final class TFMarkerBinding: NSObject {
  private weak var view: UIView?
  private weak var owner: TFMapHostView?
  private var annotation: TileflowViewAnnotation?
  private var instanceID = ""
  private var annotationID = ""
  private var input: BridgeObject?

  @objc public init(view: UIView) { self.view = view }

  @objc(updateWithInstanceId:annotationId:optionsJSON:)
  public func update(instanceID: String, annotationID: String, optionsJSON: String) {
    if self.instanceID != instanceID || self.annotationID != annotationID { detachAnnotation() }
    self.instanceID = instanceID
    self.annotationID = annotationID
    do {
      input = try MapBridgeValues.object(optionsJSON)
      try apply()
    } catch {
      let failure = MapBridgeValues.failure(error)
      owner?.emit("failed", value: ["code": failure.code, "message": failure.message], generation: owner?.generation ?? -1)
    }
  }

  @objc public func layoutChanged() {
    do { try apply() } catch { detachAnnotation() }
  }

  func attach(to owner: TFMapHostView) {
    if self.owner !== owner { detachAnnotation() }
    self.owner = owner
    do { try apply() } catch { detachAnnotation() }
  }

  func detachAnnotation() {
    annotation?.remove()
    annotation = nil
  }

  @objc public func reset() {
    owner?.removeMarker(self)
    owner = nil
    input = nil
    instanceID = ""
    annotationID = ""
    detachAnnotation()
  }

  private func apply() throws {
    guard let owner, owner.instanceID == instanceID, let map = owner.map,
      let input, let view, !annotationID.isEmpty
    else { detachAnnotation(); return }
    let coordinate = try MapBridgeValues.coordinate(input.array("coordinate"))
    let anchor = try input.optionalObject("anchor")
    let x = try anchor?.optionalDouble("x") ?? 0.5
    let y = try anchor?.optionalDouble("y") ?? 0.5
    guard (0...1).contains(x), (0...1).contains(y) else {
      throw BridgeArgumentError(path: "anchor", expected: "fractions from 0 to 1")
    }
    let offset = try input.optionalArray("offset").map(MapBridgeValues.point) ?? .zero
    let overlap = try input.bool("allowOverlap", default: false)
    let selected = try input.bool("isSelected", default: false)
    let priority = try input.optionalInt("priority") ?? 0
    let created = annotation == nil
    let value = annotation ?? TileflowViewAnnotation(coordinate: coordinate, view: view)
    value.coordinate = coordinate
    value.variableAnchors = [.init(anchor: .topLeft,
      offsetX: offset.x - x * view.bounds.width, offsetY: y * view.bounds.height - offset.y)]
    value.allowOverlap = overlap
    value.selected = selected
    value.priority = priority
    annotation = value
    if created { map.viewAnnotations.add(value) }
    value.setNeedsUpdateSize()
  }
}
