import Foundation
import UIKit

/// Which part of a view annotation sits on its coordinate.
public enum TileflowViewAnnotationAnchor: String, Sendable, CaseIterable {
  case center, top, bottom, left, right, topLeft, topRight, bottomLeft, bottomRight
}

/// An anchor and an offset in points: `offsetX` moves the view right, `offsetY` moves it up.
public struct TileflowViewAnnotationAnchorConfig: Sendable, Equatable {
  public var anchor: TileflowViewAnnotationAnchor
  public var offsetX: CGFloat
  public var offsetY: CGFloat

  public init(anchor: TileflowViewAnnotationAnchor, offsetX: CGFloat = 0, offsetY: CGFloat = 0) {
    self.anchor = anchor
    self.offsetX = offsetX
    self.offsetY = offsetY
  }

  public static let center = TileflowViewAnnotationAnchorConfig(anchor: .center)
  public static let bottom = TileflowViewAnnotationAnchorConfig(anchor: .bottom)

  /// The view's frame for this anchor with its anchor point at `point`.
  func frame(at point: CGPoint, size: CGSize) -> CGRect {
    let (w, h) = (size.width, size.height)
    let origin: CGPoint =
      switch anchor {
      case .center: CGPoint(x: point.x - w / 2, y: point.y - h / 2)
      case .top: CGPoint(x: point.x - w / 2, y: point.y)
      case .bottom: CGPoint(x: point.x - w / 2, y: point.y - h)
      case .left: CGPoint(x: point.x, y: point.y - h / 2)
      case .right: CGPoint(x: point.x - w, y: point.y - h / 2)
      case .topLeft: point
      case .topRight: CGPoint(x: point.x - w, y: point.y)
      case .bottomLeft: CGPoint(x: point.x, y: point.y - h)
      case .bottomRight: CGPoint(x: point.x - w, y: point.y - h)
      }
    return CGRect(origin: CGPoint(x: origin.x + offsetX, y: origin.y - offsetY), size: size)
  }
}

/// A native view that follows a coordinate of the map, frame by frame, such as a marker or a
/// callout the application presents. Add it with ``TileflowViewAnnotationManager/add(_:)``.
///
/// The view keeps its own size, or its fitting size when it has none; call ``setNeedsUpdateSize()``
/// after its content changes. Views that do not ``allowOverlap`` hide where they would cover a view
/// placed before them: selected views first, then those of higher ``priority``, then in the order
/// they were added. Each view takes the first of its ``variableAnchors`` that fits.
@MainActor
public final class TileflowViewAnnotation {
  public let view: UIView
  public var coordinate: TileflowCoordinate { didSet { manager?.changed(tracking: true) } }
  public var variableAnchors: [TileflowViewAnnotationAnchorConfig] = [.center] {
    didSet { manager?.changed(tracking: false) }
  }
  public var allowOverlap = false { didSet { manager?.changed(tracking: false) } }
  public var priority = 0 { didSet { manager?.changed(tracking: false) } }
  /// Hides the view and stops following its coordinate while false.
  public var visible = true { didSet { manager?.changed(tracking: true) } }
  /// A selected view is placed before every other, so it is never hidden by a collision.
  public var selected = false { didSet { manager?.changed(tracking: false) } }
  /// The anchor the view shows with, or nil while it is hidden.
  public private(set) var anchorConfig: TileflowViewAnnotationAnchorConfig?
  /// Whether the view is hidden: not visible, behind the globe or terrain, not yet placed, or
  /// covered by a view placed before it.
  public var isHidden: Bool { anchorConfig == nil }
  public var onAnchorChanged: ((TileflowViewAnnotationAnchorConfig) -> Void)?
  public var onVisibilityChanged: ((Bool) -> Void)?

  weak var manager: TileflowViewAnnotationManager?
  /// The order it was added in, for placement.
  var sequence = 0
  private var measured: CGSize?

  public init(coordinate: TileflowCoordinate, view: UIView) {
    self.coordinate = coordinate
    self.view = view
  }

  /// Measures the view again at the next placement.
  public func setNeedsUpdateSize() {
    measured = nil
    manager?.changed(tracking: false)
  }

  /// Removes the view from its map.
  public func remove() { manager?.remove(self) }

  var size: CGSize {
    if let measured { return measured }
    var size = view.bounds.size
    if size.width <= 0 || size.height <= 0 {
      size = view.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    }
    measured = size
    return size
  }

  /// Records where placement put the view and reports what changed.
  func place(_ config: TileflowViewAnnotationAnchorConfig?) {
    let wasHidden = isHidden
    let previous = anchorConfig
    anchorConfig = config
    if let config, config != previous { onAnchorChanged?(config) }
    if wasHidden != isHidden { onVisibilityChanged?(!isHidden) }
  }
}

/// The map's native view annotations. Reach it as ``TileflowMapView/viewAnnotations`` or
/// ``TileflowMapController/viewAnnotations``.
@MainActor
public final class TileflowViewAnnotationManager {
  public private(set) var annotations: [TileflowViewAnnotation] = []
  private(set) weak var view: TileflowMapView?
  private var sequence = 0

  init() {}

  /// A manager that starts on `view`, empty.
  init(view: TileflowMapView) {
    self.view = view
  }

  /// Adds a view annotation; adding one again does nothing. A view annotation belongs to one map.
  public func add(_ annotation: TileflowViewAnnotation) {
    guard annotation.manager !== self else { return }
    annotation.manager?.remove(annotation)
    sequence += 1
    annotation.sequence = sequence
    annotation.manager = self
    annotations.append(annotation)
    changed(tracking: true)
  }

  public func remove(_ annotation: TileflowViewAnnotation) {
    guard annotation.manager === self else { return }
    annotations.removeAll { $0 === annotation }
    annotation.manager = nil
    view?.annotationOverlay.uninstall(annotation)
    annotation.place(nil)
    changed(tracking: true)
  }

  public func removeAll() {
    for annotation in annotations { remove(annotation) }
  }

  func changed(tracking: Bool) {
    guard let overlay = view?.annotationOverlay else { return }
    if tracking { overlay.trackingChanged() } else { overlay.setNeedsPlacement() }
  }

  func bind(_ view: TileflowMapView) {
    guard self.view !== view else { return }
    unbind()
    self.view = view
    changed(tracking: true)
  }

  func unbind() {
    guard let previous = view else { return }
    view = nil
    for annotation in annotations {
      previous.annotationOverlay.uninstall(annotation)
      annotation.place(nil)
    }
    previous.annotationOverlay.trackingChanged()
  }
}

/// Where view annotations go: selected first, then by priority, then in the order they were added;
/// each takes its first anchor whose frame covers no view placed before it, unless it allows
/// overlap.
enum ViewAnnotationPlacement {
  struct Item {
    let point: CGPoint?
    let size: CGSize
    let anchors: [TileflowViewAnnotationAnchorConfig]
    let allowOverlap: Bool
    let priority: Int
    let selected: Bool
    let sequence: Int
  }
  struct Placed: Equatable {
    let frame: CGRect
    let anchor: TileflowViewAnnotationAnchorConfig
  }

  static func place(_ items: [Item]) -> [Placed?] {
    var result = [Placed?](repeating: nil, count: items.count)
    let order = items.indices.sorted { a, b in
      let (x, y) = (items[a], items[b])
      if x.selected != y.selected { return x.selected }
      if x.priority != y.priority { return x.priority > y.priority }
      return x.sequence < y.sequence
    }
    var occupied: [CGRect] = []
    for index in order {
      let item = items[index]
      guard let point = item.point else { continue }
      for anchor in item.anchors.isEmpty ? [.center] : item.anchors {
        let frame = anchor.frame(at: point, size: item.size)
        if !item.allowOverlap, occupied.contains(where: { $0.intersects(frame) }) { continue }
        result[index] = Placed(frame: frame, anchor: anchor)
        // A view that allows overlap still occupies its place for those after it.
        occupied.append(frame)
        break
      }
    }
    return result
  }
}
