import Tileflow
import UIKit

/// Draggable pins with a callout, a circle and an area. A UIKit map view and a SwiftUI map
/// controller offer the same `annotations` and `viewAnnotations`.
@MainActor
enum AnnotationsExample {
  private static var callout: TileflowViewAnnotation?

  /// Shows the annotations around `center`; `report` receives what a person does with them.
  static func show(
    annotations: TileflowAnnotationOrchestrator, viewAnnotations: TileflowViewAnnotationManager,
    around center: TileflowCoordinate, report: @escaping @MainActor (String) -> Void
  ) {
    let area = annotations.makePolygonAnnotationManager(id: "example-area")
    var polygon = TileflowPolygonAnnotation(
      polygon: [
        [
          offset(center, -0.006, -0.004), offset(center, 0.006, -0.004),
          offset(center, 0.006, 0.004), offset(center, -0.006, 0.004),
        ]
      ])
    polygon.fillColor = "#2563eb"
    polygon.fillOpacity = 0.15
    polygon.fillOutlineColor = "#2563eb"
    polygon.accessibilityLabel = "Walking area"
    area.annotations = [polygon]

    let circles = annotations.makeCircleAnnotationManager(id: "example-circles")
    var meeting = TileflowCircleAnnotation(centerCoordinate: offset(center, 0, -0.003))
    meeting.circleRadius = 10
    meeting.circleColor = "#16a34a"
    meeting.circleStrokeColor = "#ffffff"
    meeting.circleStrokeWidth = 2
    meeting.accessibilityLabel = "Meeting point"
    meeting.tapHandler = { _ in
      report("Meeting point")
      return true
    }
    circles.annotations = [meeting]

    let pins = annotations.makePointAnnotationManager(id: "example-pins")
    let image = TileflowPointAnnotation.Image(image: pinImage(), name: "example-pin")
    pins.annotations = [("Café", 0.003, 0.002), ("Museum", -0.003, 0.001), ("Park", 0.0, 0.003)]
      .map { name, east, north in
        var pin = TileflowPointAnnotation(coordinate: offset(center, east, north), image: image)
        let id = pin.id
        pin.iconAnchor = .bottom
        pin.isDraggable = true
        pin.accessibilityLabel = name
        pin.tapHandler = { _ in
          present(name, at: id, in: pins, viewAnnotations: viewAnnotations)
          report("\(name) selected")
          return true
        }
        pin.dragChangeHandler = { annotation, _ in
          if callout?.view.accessibilityIdentifier == annotation.id {
            callout?.coordinate = annotation.coordinate
          }
        }
        pin.dragEndHandler = { _, _ in report("\(name) moved") }
        return pin
      }
  }

  /// A callout above the pin: the application's own view, which the SDK keeps on the pin.
  private static func present(
    _ name: String, at id: String, in pins: TileflowPointAnnotationManager,
    viewAnnotations: TileflowViewAnnotationManager
  ) {
    guard let pin = pins.annotations.first(where: { $0.id == id }) else { return }
    callout?.remove()
    let label = UILabel()
    label.text = name
    label.font = .preferredFont(forTextStyle: .headline)
    label.textAlignment = .center
    label.backgroundColor = .systemBackground
    label.layer.cornerRadius = 8
    label.layer.masksToBounds = true
    label.frame.size = CGSize(
      width: label.intrinsicContentSize.width + 24, height: label.intrinsicContentSize.height + 12)
    label.accessibilityIdentifier = id
    let annotation = TileflowViewAnnotation(coordinate: pin.coordinate, view: label)
    // Above the pin image, which is 32 points tall and sits on the coordinate.
    annotation.variableAnchors = [.init(anchor: .bottom, offsetY: 36)]
    annotation.selected = true
    viewAnnotations.add(annotation)
    callout = annotation
  }

  private static func offset(_ center: TileflowCoordinate, _ east: Double, _ north: Double)
    -> TileflowCoordinate
  {
    TileflowCoordinate(longitude: center.longitude + east, latitude: center.latitude + north)
  }

  /// A teardrop pin drawn in code.
  private static func pinImage() -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 24, height: 32)).image { context in
      let path = UIBezierPath()
      path.move(to: CGPoint(x: 12, y: 32))
      path.addCurve(
        to: CGPoint(x: 12, y: 0), controlPoint1: CGPoint(x: -4, y: 14),
        controlPoint2: CGPoint(x: 2, y: 0))
      path.addCurve(
        to: CGPoint(x: 12, y: 32), controlPoint1: CGPoint(x: 22, y: 0),
        controlPoint2: CGPoint(x: 28, y: 14))
      UIColor.systemRed.setFill()
      path.fill()
      UIColor.white.setFill()
      context.cgContext.fillEllipse(in: CGRect(x: 8, y: 7, width: 8, height: 8))
    }
  }
}
