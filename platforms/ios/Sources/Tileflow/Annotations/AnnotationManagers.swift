import Foundation
import UIKit

/// A group of annotations of one kind drawn by one layer of the application's runtime style. The
/// manager's ``id`` names both its GeoJSON source and its layer, so other application layers can be
/// placed above or below it.
@MainActor
public protocol TileflowAnnotationManager: AnyObject {
  var id: String { get }
}

/// The geometry kinds of annotation managers and the MapLibre layer that draws each.
enum AnnotationKind: String, Sendable {
  case point, circle, polyline, polygon

  var layerType: String {
    switch self {
    case .point: "symbol"
    case .circle: "circle"
    case .polyline: "line"
    case .polygon: "fill"
    }
  }

  /// Per-annotation properties: MapLibre name, whether it is a layout property, and the value
  /// that applies when an annotation does not set it.
  var properties: [(name: String, layout: Bool, fallback: JSONValue)] {
    let black = JSONValue.string("#000000")
    switch self {
    case .point:
      return [
        ("icon-image", true, .string("")), ("icon-anchor", true, .string("center")),
        ("icon-offset", true, .array([.string("literal"), .array([.number(0), .number(0)])])),
        ("icon-rotate", true, .number(0)), ("icon-size", true, .number(1)),
        ("symbol-sort-key", true, .number(0)), ("icon-color", false, black),
        ("icon-opacity", false, .number(1)),
      ]
    case .circle:
      return [
        ("circle-sort-key", true, .number(0)), ("circle-radius", false, .number(5)),
        ("circle-color", false, black), ("circle-opacity", false, .number(1)),
        ("circle-stroke-color", false, black), ("circle-stroke-width", false, .number(0)),
        ("circle-stroke-opacity", false, .number(1)), ("circle-blur", false, .number(0)),
      ]
    case .polyline:
      return [
        ("line-sort-key", true, .number(0)), ("line-color", false, black),
        ("line-width", false, .number(1)), ("line-opacity", false, .number(1)),
        ("line-blur", false, .number(0)),
      ]
    case .polygon:
      return [
        ("fill-sort-key", true, .number(0)), ("fill-color", false, black),
        ("fill-opacity", false, .number(1)),
        (
          "fill-outline-color", false,
          .array([.string("coalesce"), .array([.string("get"), .string("fill-color")]), black])
        ),
      ]
    }
  }

  /// The manager's layer: every property an annotation uses reads it from the feature, falling
  /// back to its default; manager-wide layout properties are constants.
  func layerJSON(
    id: String, used: Set<String>, layout managerLayout: [String: JSONValue]
  ) -> JSONValue {
    var layout = managerLayout
    var paint: [String: JSONValue] = [:]
    if self == .polyline, layout["line-join"] == nil { layout["line-join"] = .string("round") }
    for property in properties where used.contains(property.name) {
      let value = JSONValue.array([
        .string("coalesce"), .array([.string("get"), .string(property.name)]), property.fallback,
      ])
      if property.layout { layout[property.name] = value } else { paint[property.name] = value }
    }
    var json: [String: JSONValue] = [
      "id": .string(id), "type": .string(layerType), "source": .string(id),
    ]
    if !layout.isEmpty { json["layout"] = .object(layout) }
    if !paint.isEmpty { json["paint"] = .object(paint) }
    return .object(json)
  }
}

/// A layer of the runtime style whose MapLibre JSON the manager writes itself.
struct AnnotationLayerSpec: TileflowLayer {
  static let type = "annotation"
  let id: String
  let slot: TileflowLayerSlot?
  let json: JSONValue
  func encode(to encoder: any Encoder) throws { try json.encode(to: encoder) }
}

/// An annotation that assistive technologies reach, at its representative coordinate.
struct AccessibleAnnotation {
  let key: String
  let coordinate: TileflowCoordinate
  let label: String
  let activate: (TileflowAnnotationInteractionContext) -> Bool
  let longPress: ((TileflowAnnotationInteractionContext) -> Bool)?
}

enum AnnotationDragPhase: String { case started, moved, ended }

/// What the orchestrator asks of every manager.
@MainActor
protocol AnnotationManaging: TileflowAnnotationManager {
  var core: AnnotationManagerCore { get }
  /// Calls the touched annotation's handler; true when it consumed the touch.
  func touch(_ id: String, longPress: Bool, context: TileflowAnnotationInteractionContext) -> Bool
  func drag(
    _ id: String, phase: AnnotationDragPhase, geometry: TileflowGeometry,
    context: TileflowAnnotationInteractionContext)
  var accessibleAnnotations: [AccessibleAnnotation] { get }
}

/// Keeps a manager's source, layer and images in step with its annotations, through the map
/// view's runtime style, which restores them after theme changes and for a new renderer.
@MainActor
final class AnnotationManagerCore {
  let id: String
  let kind: AnnotationKind
  let slot: TileflowLayerSlot?
  let position: TileflowLayerPosition
  weak var view: TileflowMapView?
  var features: () -> [any AnnotationFeature] = { [] }
  var images: () -> [TileflowPointAnnotation.Image] = { [] }
  var layout: () -> [String: JSONValue] = { [:] }
  /// Called after the annotations change, so assistive technologies follow them.
  var onChange: (() -> Void)?

  private var added = false
  /// The feature each annotation last sent, by identifier, in order.
  private(set) var synced: [String: JSONValue] = [:]
  private var syncedLayer: JSONValue?
  private var addedImages: Set<String> = []
  /// Flushes run one at a time across the map's managers, in the order they change, so a layer
  /// placed relative to another manager's layer finds it.
  var queue: AnnotationFlushQueue?

  init(id: String, kind: AnnotationKind, slot: TileflowLayerSlot?, position: TileflowLayerPosition)
  {
    self.id = id
    self.kind = kind
    self.slot = slot
    self.position = position
  }

  /// The source data, layer and changes of one flush, without sending them; tests read it.
  struct Plan: Equatable {
    var replace: JSONValue?
    var update: [JSONValue] = []
    var remove: [String] = []
    var layer: JSONValue?
  }

  func plan() -> Plan {
    let features = features()
    let layer = kind.layerJSON(
      id: id, used: Set(features.flatMap { $0.styleProperties.keys }), layout: layout())
    var plan = Plan(layer: layer == syncedLayer ? nil : layer)
    let current = features.map { ($0.id, $0.featureJSON) }
    let ids = Set(current.map(\.0))
    let changed = current.filter { synced[$0.0] != $0.1 }
    let removed = synced.keys.filter { !ids.contains($0) }.sorted()
    if !added || (changed.count + removed.count) * 2 > current.count {
      if added && changed.isEmpty && removed.isEmpty { return plan }
      plan.replace = .object([
        "type": .string("FeatureCollection"), "features": .array(current.map(\.1)),
      ])
    } else {
      plan.update = changed.map(\.1)
      plan.remove = removed
    }
    return plan
  }

  /// Records what the renderer holds after a flush.
  func recordSynced(_ features: [any AnnotationFeature], layer: JSONValue?) {
    added = true
    synced = Dictionary(features.map { ($0.id, $0.featureJSON) }, uniquingKeysWith: { $1 })
    syncedLayer = layer ?? syncedLayer
  }

  func changed() {
    onChange?()
    guard view != nil else { return }
    queue?.enqueue(self)
  }

  /// Records the geometry a drag gave the renderer, so it is not sent again while dragging; at the
  /// end of a drag the feature is sent once more, so later renderers receive it.
  func dragged(_ annotation: any AnnotationFeature, ended: Bool) {
    guard var previous = synced[annotation.id], case .object(var feature) = previous else { return }
    feature["geometry"] = annotation.geometry.wireValue
    previous = .object(feature)
    synced[annotation.id] = ended ? .null : previous
  }

  func flush() async {
    guard let view, !view.isDestroyed else { return }
    do {
      try await syncImages(on: view, removing: false)
      let plan = plan()
      let features = features()
      if !added {
        let data = try JSONEncoder().encode(plan.replace)
        try await view.addSource(
          TileflowGeoJSONSource(id: id, data: .geoJSON(data), promoteId: "id"))
        try await view.addLayer(
          AnnotationLayerSpec(id: id, slot: slot, json: plan.layer ?? .null), position: position)
      } else {
        if let replace = plan.replace {
          try await view.setGeoJSONSourceData(id, data: .geoJSON(try JSONEncoder().encode(replace)))
        } else {
          if !plan.remove.isEmpty {
            try await view.removeGeoJSONSourceFeatures(sourceId: id, featureIds: plan.remove)
          }
          if !plan.update.isEmpty {
            try await view.updateGeoJSONSourceFeatures(
              sourceId: id, features: plan.update.map(TileflowFeature.init(wire:)))
          }
        }
        if let layer = plan.layer {
          try await view.updateLayer(AnnotationLayerSpec(id: id, slot: slot, json: layer))
        }
      }
      recordSynced(features, layer: plan.layer)
      try await syncImages(on: view, removing: true)
    } catch {
      let error = error as? TileflowMapError ?? .invalidRequest
      if error == .disposed { return }
      view.onEvent?(.warning(TileflowMapWarning(error: error, occurrences: 1)))
    }
  }

  /// Adds the images the annotations carry before they are drawn, and removes those no annotation
  /// shows any more once they are not.
  private func syncImages(on view: TileflowMapView, removing: Bool) async throws {
    let images = images()
    let names = Set(images.map(\.name))
    if removing {
      for name in addedImages.subtracting(names) {
        try await view.removeImage(name)
        addedImages.remove(name)
      }
      return
    }
    for image in images where !addedImages.contains(image.name) {
      addedImages.insert(image.name)
      try await view.addImage(try TileflowMapImage(name: image.name, image: image.image))
    }
  }

  /// Draws the manager on `view`.
  func attach(to view: TileflowMapView) {
    self.view = view
    added = false
    synced = [:]
    syncedLayer = nil
    addedImages = []
    changed()
  }

  /// Takes the manager's layer, source and images off its view.
  func detach() {
    guard let view else { return }
    self.view = nil
    let (id, images, wasAdded) = (self.id, addedImages, added)
    added = false
    addedImages = []
    guard !view.isDestroyed else { return }
    Task {
      if wasAdded {
        try? await view.removeLayer(id)
        try? await view.removeSource(id)
      }
      for name in images { try? await view.removeImage(name) }
    }
  }
}

/// Runs managers' flushes one at a time; a manager that changes again while waiting flushes once.
@MainActor
final class AnnotationFlushQueue {
  private var pending: [AnnotationManagerCore] = []
  private var running = false

  func enqueue(_ core: AnnotationManagerCore) {
    if !pending.contains(where: { $0 === core }) { pending.append(core) }
    guard !running else { return }
    running = true
    Task { [weak self] in
      while let self, !self.pending.isEmpty {
        await self.pending.removeFirst().flush()
      }
      self?.running = false
    }
  }
}

/// Shared behaviour of the four managers, over their annotation type.
@MainActor
private func annotationTouch<T: AnnotationFeature>(
  _ annotations: [T], _ id: String, longPress: Bool, _ context: TileflowAnnotationInteractionContext
) -> Bool {
  guard let annotation = annotations.first(where: { $0.id == id }) else { return false }
  let handler = longPress ? annotation.longPressHandler : annotation.tapHandler
  return handler?(context) ?? false
}

@MainActor
private func accessibleEntries<T: AnnotationFeature>(
  _ annotations: [T], manager: String,
  touch: @escaping (String, Bool, TileflowAnnotationInteractionContext) -> Bool
) -> [AccessibleAnnotation] {
  annotations.compactMap { annotation in
    guard let label = annotation.accessibilityLabel, !label.isEmpty,
      let coordinate = annotation.representativeCoordinate
    else { return nil }
    let id = annotation.id
    return AccessibleAnnotation(
      key: "\(manager)\n\(id)", coordinate: coordinate, label: label,
      activate: { touch(id, false, $0) },
      longPress: annotation.longPressHandler == nil ? nil : { touch(id, true, $0) })
  }
}

/// Applies a drag to the annotation it moves and calls its drag handler for the phase.
@MainActor
private func annotationDrag<T: AnnotationFeature>(
  _ annotations: inout [T], _ id: String, phase: AnnotationDragPhase, geometry: TileflowGeometry,
  context: TileflowAnnotationInteractionContext, core: AnnotationManagerCore,
  handler: (T, AnnotationDragPhase) -> (
    @MainActor (inout T, TileflowAnnotationInteractionContext) -> Void
  )?
) {
  guard let index = annotations.firstIndex(where: { $0.id == id }),
    var moved = annotations[index].moved(to: geometry)
  else { return }
  handler(moved, phase)?(&moved, context)
  // The handler may change anything but the geometry the renderer already shows.
  moved = moved.moved(to: geometry) ?? moved
  core.dragged(moved, ended: phase == .ended)
  annotations[index] = moved
}

/// Point annotations: images at coordinates, drawn by a symbol layer that places them without
/// collisions unless ``iconAllowOverlap`` is set.
@MainActor
public final class TileflowPointAnnotationManager: AnnotationManaging {
  public let id: String
  public var annotations: [TileflowPointAnnotation] = [] { didSet { core.changed() } }
  /// Draws images even where they collide with other symbols.
  public var iconAllowOverlap: Bool? { didSet { core.changed() } }
  /// Lets other symbols draw where these images are.
  public var iconIgnorePlacement: Bool? { didSet { core.changed() } }
  let core: AnnotationManagerCore

  init(id: String, slot: TileflowLayerSlot?, position: TileflowLayerPosition) {
    self.id = id
    core = AnnotationManagerCore(id: id, kind: .point, slot: slot, position: position)
    core.features = { [unowned self] in annotations }
    core.images = { [unowned self] in
      var seen = Set<String>()
      return annotations.compactMap(\.image).filter { seen.insert($0.name).inserted }
    }
    core.layout = { [unowned self] in
      var layout: [String: JSONValue] = [:]
      if let iconAllowOverlap { layout["icon-allow-overlap"] = .bool(iconAllowOverlap) }
      if let iconIgnorePlacement { layout["icon-ignore-placement"] = .bool(iconIgnorePlacement) }
      return layout
    }
  }

  func touch(_ id: String, longPress: Bool, context: TileflowAnnotationInteractionContext) -> Bool {
    annotationTouch(annotations, id, longPress: longPress, context)
  }
  func drag(
    _ id: String, phase: AnnotationDragPhase, geometry: TileflowGeometry,
    context: TileflowAnnotationInteractionContext
  ) {
    annotationDrag(&annotations, id, phase: phase, geometry: geometry, context: context, core: core)
    {
      annotation, phase in
      switch phase {
      case .started: annotation.dragBeginHandler
      case .moved: annotation.dragChangeHandler
      case .ended: annotation.dragEndHandler
      }
    }
  }
  var accessibleAnnotations: [AccessibleAnnotation] {
    accessibleEntries(annotations, manager: id) { [weak self] in
      self?.touch($0, longPress: $1, context: $2) ?? false
    }
  }
}

/// Circle annotations, drawn by a circle layer.
@MainActor
public final class TileflowCircleAnnotationManager: AnnotationManaging {
  public let id: String
  public var annotations: [TileflowCircleAnnotation] = [] { didSet { core.changed() } }
  let core: AnnotationManagerCore

  init(id: String, slot: TileflowLayerSlot?, position: TileflowLayerPosition) {
    self.id = id
    core = AnnotationManagerCore(id: id, kind: .circle, slot: slot, position: position)
    core.features = { [unowned self] in annotations }
  }

  func touch(_ id: String, longPress: Bool, context: TileflowAnnotationInteractionContext) -> Bool {
    annotationTouch(annotations, id, longPress: longPress, context)
  }
  func drag(
    _ id: String, phase: AnnotationDragPhase, geometry: TileflowGeometry,
    context: TileflowAnnotationInteractionContext
  ) {
    annotationDrag(&annotations, id, phase: phase, geometry: geometry, context: context, core: core)
    {
      annotation, phase in
      switch phase {
      case .started: annotation.dragBeginHandler
      case .moved: annotation.dragChangeHandler
      case .ended: annotation.dragEndHandler
      }
    }
  }
  var accessibleAnnotations: [AccessibleAnnotation] {
    accessibleEntries(annotations, manager: id) { [weak self] in
      self?.touch($0, longPress: $1, context: $2) ?? false
    }
  }
}

/// Line annotations, drawn by a line layer with round joins.
@MainActor
public final class TileflowPolylineAnnotationManager: AnnotationManaging {
  public let id: String
  public var annotations: [TileflowPolylineAnnotation] = [] { didSet { core.changed() } }
  /// How the ends of every line are drawn.
  public var lineCap: TileflowLineCap? { didSet { core.changed() } }
  let core: AnnotationManagerCore

  init(id: String, slot: TileflowLayerSlot?, position: TileflowLayerPosition) {
    self.id = id
    core = AnnotationManagerCore(id: id, kind: .polyline, slot: slot, position: position)
    core.features = { [unowned self] in annotations }
    core.layout = { [unowned self] in
      lineCap.map { ["line-cap": .string($0.rawValue)] } ?? [:]
    }
  }

  func touch(_ id: String, longPress: Bool, context: TileflowAnnotationInteractionContext) -> Bool {
    annotationTouch(annotations, id, longPress: longPress, context)
  }
  func drag(
    _ id: String, phase: AnnotationDragPhase, geometry: TileflowGeometry,
    context: TileflowAnnotationInteractionContext
  ) {
    annotationDrag(&annotations, id, phase: phase, geometry: geometry, context: context, core: core)
    {
      annotation, phase in
      switch phase {
      case .started: annotation.dragBeginHandler
      case .moved: annotation.dragChangeHandler
      case .ended: annotation.dragEndHandler
      }
    }
  }
  var accessibleAnnotations: [AccessibleAnnotation] {
    accessibleEntries(annotations, manager: id) { [weak self] in
      self?.touch($0, longPress: $1, context: $2) ?? false
    }
  }
}

/// Polygon annotations, drawn by a fill layer.
@MainActor
public final class TileflowPolygonAnnotationManager: AnnotationManaging {
  public let id: String
  public var annotations: [TileflowPolygonAnnotation] = [] { didSet { core.changed() } }
  let core: AnnotationManagerCore

  init(id: String, slot: TileflowLayerSlot?, position: TileflowLayerPosition) {
    self.id = id
    core = AnnotationManagerCore(id: id, kind: .polygon, slot: slot, position: position)
    core.features = { [unowned self] in annotations }
  }

  func touch(_ id: String, longPress: Bool, context: TileflowAnnotationInteractionContext) -> Bool {
    annotationTouch(annotations, id, longPress: longPress, context)
  }
  func drag(
    _ id: String, phase: AnnotationDragPhase, geometry: TileflowGeometry,
    context: TileflowAnnotationInteractionContext
  ) {
    annotationDrag(&annotations, id, phase: phase, geometry: geometry, context: context, core: core)
    {
      annotation, phase in
      switch phase {
      case .started: annotation.dragBeginHandler
      case .moved: annotation.dragChangeHandler
      case .ended: annotation.dragEndHandler
      }
    }
  }
  var accessibleAnnotations: [AccessibleAnnotation] {
    accessibleEntries(annotations, manager: id) { [weak self] in
      self?.touch($0, longPress: $1, context: $2) ?? false
    }
  }
}
