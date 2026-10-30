import Foundation
import UIKit

/// Where a person touched an annotation: the point in the map view and its coordinate.
public struct TileflowAnnotationInteractionContext: Sendable, Equatable {
  /// In points of the map view.
  public let point: CGPoint
  public let coordinate: TileflowCoordinate

  public init(point: CGPoint, coordinate: TileflowCoordinate) {
    self.point = point
    self.coordinate = coordinate
  }
}

/// What every annotation kind gives its manager: its feature, style properties and handlers.
@MainActor
protocol AnnotationFeature {
  var id: String { get }
  var isDraggable: Bool { get }
  var accessibilityLabel: String? { get }
  var geometry: TileflowGeometry { get }
  /// The style properties the annotation sets, by MapLibre name.
  var styleProperties: [String: JSONValue] { get }
  var tapHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)? { get }
  var longPressHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)? { get }
  /// The same annotation drawn with another geometry, for a drag.
  func moved(to geometry: TileflowGeometry) -> Self?
}

extension AnnotationFeature {
  /// The GeoJSON feature the manager's source holds. The identifier is a property the source
  /// promotes, because MapLibre keeps only numeric feature identifiers.
  var featureJSON: JSONValue {
    var properties = styleProperties
    properties["id"] = .string(id)
    properties["draggable"] = .bool(isDraggable)
    return .object([
      "type": .string("Feature"), "properties": .object(properties),
      "geometry": geometry.wireValue,
    ])
  }

  /// Where assistive technologies place the annotation: the point, a circle's centre, a line's
  /// middle vertex or the average of a polygon's outer ring.
  var representativeCoordinate: TileflowCoordinate? { geometry.representativeCoordinate }
}

extension TileflowGeometry {
  var representativeCoordinate: TileflowCoordinate? {
    switch self {
    case .point(let point): return point
    case .lineString(let line), .multiPoint(let line):
      return line.isEmpty ? nil : line[line.count / 2]
    case .polygon(let rings):
      guard var ring = rings.first, !ring.isEmpty else { return nil }
      if ring.count > 1, ring.first == ring.last { ring.removeLast() }
      let count = Double(ring.count)
      return TileflowCoordinate(
        longitude: ring.reduce(0) { $0 + $1.longitude } / count,
        latitude: ring.reduce(0) { $0 + $1.latitude } / count)
    case .multiLineString(let lines):
      return lines.first.flatMap { $0.isEmpty ? nil : $0[$0.count / 2] }
    case .multiPolygon(let polygons):
      return polygons.first.flatMap { TileflowGeometry.polygon($0).representativeCoordinate }
    }
  }
}

private func number(_ value: Double?) -> JSONValue? { value.map(JSONValue.number) }
private func color(_ value: TileflowColor?) -> JSONValue? { value.map { .string($0.css) } }

private func compact(_ values: [String: JSONValue?]) -> [String: JSONValue] {
  values.compactMapValues { $0 }
}

/// A picture drawn at a coordinate, as a symbol of the manager's layer.
public struct TileflowPointAnnotation: Sendable {
  /// An image the manager adds to the map's application images under `name`, and removes once no
  /// annotation of the manager shows it.
  public struct Image: Sendable, Equatable {
    public let image: UIImage
    public let name: String
    public init(image: UIImage, name: String) {
      self.image = image
      self.name = name
    }
  }

  public let id: String
  public var coordinate: TileflowCoordinate
  /// The image to draw, which the manager adds to the map.
  public var image: Image?
  /// The name of an application image the map already holds; ``image`` takes precedence.
  public var iconImage: String?
  /// Which part of the image sits on the coordinate. Default: center.
  public var iconAnchor: TileflowIconAnchor?
  /// The image's offset from its anchor, in points: right and down.
  public var iconOffset: [Double]?
  /// Clockwise rotation in degrees.
  public var iconRotate: Double?
  public var iconSize: Double?
  /// Recolours a signed distance field image.
  public var iconColor: TileflowColor?
  public var iconOpacity: Double?
  /// Annotations with a lower key are placed first, so they win collisions.
  public var symbolSortKey: Double?
  /// A pan that starts on the annotation moves it instead of the map.
  public var isDraggable = false
  /// Exposes the annotation to VoiceOver and other assistive technologies under this label.
  public var accessibilityLabel: String?
  /// Return true to stop the tap from reaching annotations below and the map's `tap` event.
  public var tapHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  /// Return true to stop the long press from reaching annotations below and the map.
  public var longPressHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  public var dragBeginHandler:
    (@MainActor (inout TileflowPointAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragChangeHandler:
    (@MainActor (inout TileflowPointAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragEndHandler:
    (@MainActor (inout TileflowPointAnnotation, TileflowAnnotationInteractionContext) -> Void)?

  public init(id: String = UUID().uuidString, coordinate: TileflowCoordinate) {
    self.id = id
    self.coordinate = coordinate
  }

  /// A point annotation showing `image`.
  public init(id: String = UUID().uuidString, coordinate: TileflowCoordinate, image: Image) {
    self.init(id: id, coordinate: coordinate)
    self.image = image
  }
}

extension TileflowPointAnnotation: AnnotationFeature {
  var geometry: TileflowGeometry { .point(coordinate) }
  var styleProperties: [String: JSONValue] {
    compact([
      "icon-image": (image?.name ?? iconImage).map(JSONValue.string),
      "icon-anchor": iconAnchor.map { .string($0.rawValue) },
      "icon-offset": iconOffset.map { .array($0.map(JSONValue.number)) },
      "icon-rotate": number(iconRotate), "icon-size": number(iconSize),
      "icon-color": color(iconColor), "icon-opacity": number(iconOpacity),
      "symbol-sort-key": number(symbolSortKey),
    ])
  }
  func moved(to geometry: TileflowGeometry) -> TileflowPointAnnotation? {
    guard case .point(let point) = geometry else { return nil }
    var next = self
    next.coordinate = point
    return next
  }
}

/// A circle drawn around a coordinate, as a feature of the manager's circle layer.
public struct TileflowCircleAnnotation: Sendable {
  public let id: String
  public var centerCoordinate: TileflowCoordinate
  /// In points.
  public var circleRadius: Double?
  public var circleColor: TileflowColor?
  public var circleOpacity: Double?
  public var circleStrokeColor: TileflowColor?
  public var circleStrokeWidth: Double?
  public var circleStrokeOpacity: Double?
  public var circleBlur: Double?
  /// Circles with a higher key are drawn above those with a lower one.
  public var circleSortKey: Double?
  public var isDraggable = false
  public var accessibilityLabel: String?
  public var tapHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  public var longPressHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  public var dragBeginHandler:
    (@MainActor (inout TileflowCircleAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragChangeHandler:
    (@MainActor (inout TileflowCircleAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragEndHandler:
    (@MainActor (inout TileflowCircleAnnotation, TileflowAnnotationInteractionContext) -> Void)?

  public init(id: String = UUID().uuidString, centerCoordinate: TileflowCoordinate) {
    self.id = id
    self.centerCoordinate = centerCoordinate
  }
}

extension TileflowCircleAnnotation: AnnotationFeature {
  var geometry: TileflowGeometry { .point(centerCoordinate) }
  var styleProperties: [String: JSONValue] {
    compact([
      "circle-radius": number(circleRadius), "circle-color": color(circleColor),
      "circle-opacity": number(circleOpacity), "circle-stroke-color": color(circleStrokeColor),
      "circle-stroke-width": number(circleStrokeWidth),
      "circle-stroke-opacity": number(circleStrokeOpacity), "circle-blur": number(circleBlur),
      "circle-sort-key": number(circleSortKey),
    ])
  }
  func moved(to geometry: TileflowGeometry) -> TileflowCircleAnnotation? {
    guard case .point(let point) = geometry else { return nil }
    var next = self
    next.centerCoordinate = point
    return next
  }
}

/// A line through coordinates, as a feature of the manager's line layer.
public struct TileflowPolylineAnnotation: Sendable {
  public let id: String
  public var lineCoordinates: [TileflowCoordinate]
  public var lineColor: TileflowColor?
  /// In points.
  public var lineWidth: Double?
  public var lineOpacity: Double?
  public var lineBlur: Double?
  /// Lines with a higher key are drawn above those with a lower one.
  public var lineSortKey: Double?
  public var isDraggable = false
  public var accessibilityLabel: String?
  public var tapHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  public var longPressHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  public var dragBeginHandler:
    (@MainActor (inout TileflowPolylineAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragChangeHandler:
    (@MainActor (inout TileflowPolylineAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragEndHandler:
    (@MainActor (inout TileflowPolylineAnnotation, TileflowAnnotationInteractionContext) -> Void)?

  public init(id: String = UUID().uuidString, lineCoordinates: [TileflowCoordinate]) {
    self.id = id
    self.lineCoordinates = lineCoordinates
  }
}

extension TileflowPolylineAnnotation: AnnotationFeature {
  var geometry: TileflowGeometry { .lineString(lineCoordinates) }
  var styleProperties: [String: JSONValue] {
    compact([
      "line-color": color(lineColor), "line-width": number(lineWidth),
      "line-opacity": number(lineOpacity), "line-blur": number(lineBlur),
      "line-sort-key": number(lineSortKey),
    ])
  }
  func moved(to geometry: TileflowGeometry) -> TileflowPolylineAnnotation? {
    guard case .lineString(let line) = geometry else { return nil }
    var next = self
    next.lineCoordinates = line
    return next
  }
}

/// A filled area, as a feature of the manager's fill layer.
public struct TileflowPolygonAnnotation: Sendable {
  public let id: String
  /// Rings, the outer one first and the rest holes. The manager closes open rings.
  public var polygon: [[TileflowCoordinate]]
  public var fillColor: TileflowColor?
  public var fillOpacity: Double?
  /// The outline; by default the fill colour.
  public var fillOutlineColor: TileflowColor?
  /// Polygons with a higher key are drawn above those with a lower one.
  public var fillSortKey: Double?
  public var isDraggable = false
  public var accessibilityLabel: String?
  public var tapHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  public var longPressHandler: (@MainActor (TileflowAnnotationInteractionContext) -> Bool)?
  public var dragBeginHandler:
    (@MainActor (inout TileflowPolygonAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragChangeHandler:
    (@MainActor (inout TileflowPolygonAnnotation, TileflowAnnotationInteractionContext) -> Void)?
  public var dragEndHandler:
    (@MainActor (inout TileflowPolygonAnnotation, TileflowAnnotationInteractionContext) -> Void)?

  public init(id: String = UUID().uuidString, polygon: [[TileflowCoordinate]]) {
    self.id = id
    self.polygon = polygon
  }
}

extension TileflowPolygonAnnotation: AnnotationFeature {
  var geometry: TileflowGeometry {
    .polygon(
      polygon.map { ring in ring.first != nil && ring.first != ring.last ? ring + [ring[0]] : ring }
    )
  }
  var styleProperties: [String: JSONValue] {
    compact([
      "fill-color": color(fillColor), "fill-opacity": number(fillOpacity),
      "fill-outline-color": color(fillOutlineColor), "fill-sort-key": number(fillSortKey),
    ])
  }
  func moved(to geometry: TileflowGeometry) -> TileflowPolygonAnnotation? {
    guard case .polygon(let rings) = geometry else { return nil }
    var next = self
    next.polygon = rings
    return next
  }
}
