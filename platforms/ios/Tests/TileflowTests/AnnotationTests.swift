import CoreGraphics
import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// Annotation managers' style output and touch dispatch, view annotation placement and the
/// positions the renderer reports for tracked points.
@MainActor
final class AnnotationTests: XCTestCase {
  private func json(_ text: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
  }
  private let madrid = TileflowCoordinate(longitude: -3.7, latitude: 40.42)

  func testAnchorsPlaceTheViewAroundItsPointWithMapboxOffsets() {
    let size = CGSize(width: 40, height: 20)
    let point = CGPoint(x: 100, y: 100)
    let frames: [TileflowViewAnnotationAnchor: CGPoint] = [
      .center: CGPoint(x: 80, y: 90), .top: CGPoint(x: 80, y: 100),
      .bottom: CGPoint(x: 80, y: 80), .left: CGPoint(x: 100, y: 90),
      .right: CGPoint(x: 60, y: 90), .topLeft: CGPoint(x: 100, y: 100),
      .topRight: CGPoint(x: 60, y: 100), .bottomLeft: CGPoint(x: 100, y: 80),
      .bottomRight: CGPoint(x: 60, y: 80),
    ]
    for anchor in TileflowViewAnnotationAnchor.allCases {
      XCTAssertEqual(
        TileflowViewAnnotationAnchorConfig(anchor: anchor).frame(at: point, size: size).origin,
        frames[anchor], "\(anchor)")
    }
    // A positive offsetY moves the view up, as in the Mapbox SDKs.
    XCTAssertEqual(
      TileflowViewAnnotationAnchorConfig(anchor: .bottom, offsetX: 5, offsetY: 10)
        .frame(at: point, size: size).origin,
      CGPoint(x: 85, y: 70))
  }

  func testPlacementHonoursSelectionPriorityOrderAndVariableAnchors() {
    typealias Item = ViewAnnotationPlacement.Item
    let size = CGSize(width: 40, height: 40)
    func item(
      _ x: CGFloat, priority: Int = 0, selected: Bool = false, overlap: Bool = false,
      anchors: [TileflowViewAnnotationAnchorConfig] = [.center], sequence: Int
    ) -> Item {
      Item(
        point: CGPoint(x: x, y: 100), size: size, anchors: anchors, allowOverlap: overlap,
        priority: priority, selected: selected, sequence: sequence)
    }
    // The earlier view wins a collision; a higher priority wins over order.
    var placed = ViewAnnotationPlacement.place([item(100, sequence: 1), item(110, sequence: 2)])
    XCTAssertNotNil(placed[0])
    XCTAssertNil(placed[1])
    placed = ViewAnnotationPlacement.place([
      item(100, sequence: 1), item(110, priority: 1, sequence: 2),
    ])
    XCTAssertNil(placed[0])
    XCTAssertNotNil(placed[1])
    // A selected view is placed before any priority.
    placed = ViewAnnotationPlacement.place([
      item(100, priority: 5, sequence: 1), item(110, selected: true, sequence: 2),
    ])
    XCTAssertNil(placed[0])
    XCTAssertNotNil(placed[1])
    // A view that allows overlap shows anyway.
    placed = ViewAnnotationPlacement.place([
      item(100, sequence: 1), item(110, overlap: true, sequence: 2),
    ])
    XCTAssertNotNil(placed[1])
    // The second anchor that fits is chosen.
    placed = ViewAnnotationPlacement.place([
      item(100, sequence: 1),
      item(
        110, anchors: [.center, TileflowViewAnnotationAnchorConfig(anchor: .left, offsetX: 20)],
        sequence: 2),
    ])
    XCTAssertEqual(placed[1]?.anchor.anchor, .left)
    XCTAssertEqual(placed[1]?.frame.minX, 130)
    // A view without a position is hidden and takes no space.
    placed = ViewAnnotationPlacement.place([
      Item(
        point: nil, size: size, anchors: [.center], allowOverlap: false, priority: 9,
        selected: false, sequence: 1),
      item(100, sequence: 2),
    ])
    XCTAssertNil(placed[0])
    XCTAssertNotNil(placed[1])
  }

  func testPointManagerDrawsWithItsIdentifierAndFeatureProperties() throws {
    let orchestrator = TileflowAnnotationOrchestrator()
    let manager = orchestrator.makePointAnnotationManager(id: "pins", slot: .aboveLabels)
    manager.iconAllowOverlap = true
    var pin = TileflowPointAnnotation(id: "a", coordinate: madrid)
    pin.iconImage = "pin"
    pin.iconAnchor = .bottom
    pin.iconOffset = [0, -4]
    pin.isDraggable = true
    manager.annotations = [pin, TileflowPointAnnotation(id: "b", coordinate: madrid)]
    let plan = manager.core.plan()
    XCTAssertEqual(
      plan.layer,
      try json(
        """
        {"id":"pins","type":"symbol","source":"pins",
         "layout":{"icon-allow-overlap":true,
          "icon-image":["coalesce",["get","icon-image"],""],
          "icon-anchor":["coalesce",["get","icon-anchor"],"center"],
          "icon-offset":["coalesce",["get","icon-offset"],["literal",[0,0]]]}}
        """))
    XCTAssertEqual(
      plan.replace,
      try json(
        """
        {"type":"FeatureCollection","features":[
         {"type":"Feature","geometry":{"type":"Point","coordinates":[-3.7,40.42]},
          "properties":{"id":"a","draggable":true,"icon-image":"pin","icon-anchor":"bottom",
           "icon-offset":[0,-4]}},
         {"type":"Feature","geometry":{"type":"Point","coordinates":[-3.7,40.42]},
          "properties":{"id":"b","draggable":false}}]}
        """))
    XCTAssertEqual(orchestrator.layerIDs, ["pins"])
    XCTAssertEqual(manager.core.slot, .aboveLabels)
  }

  func testManagersSendOnlyChangedFeaturesUnlessMostChanged() {
    let manager = TileflowAnnotationOrchestrator().makeCircleAnnotationManager(id: "circles")
    manager.annotations = (0..<10).map {
      TileflowCircleAnnotation(
        id: "c\($0)", centerCoordinate: TileflowCoordinate(longitude: Double($0), latitude: 0))
    }
    let first = manager.core.plan()
    XCTAssertNotNil(first.replace)
    manager.core.recordSynced(manager.annotations, layer: first.layer)
    XCTAssertEqual(manager.core.plan(), .init())
    manager.annotations[3].circleRadius = 9
    manager.annotations.removeLast()
    var plan = manager.core.plan()
    XCTAssertNil(plan.replace)
    XCTAssertEqual(plan.update.map { $0["properties"]?["id"]?.string }, ["c3"])
    XCTAssertEqual(plan.remove, ["c9"])
    // The radius is now read from features.
    XCTAssertNotNil(plan.layer?["paint"]?["circle-radius"])
    manager.annotations = manager.annotations.map {
      var circle = $0
      circle.circleColor = "#ff0000"
      return circle
    }
    plan = manager.core.plan()
    XCTAssertNotNil(plan.replace)
  }

  func testPolygonsCloseTheirRingsAndPolylinesJoinRound() throws {
    let orchestrator = TileflowAnnotationOrchestrator()
    let polygons = orchestrator.makePolygonAnnotationManager(id: "areas")
    polygons.annotations = [
      TileflowPolygonAnnotation(
        id: "p",
        polygon: [
          [
            TileflowCoordinate(longitude: 0, latitude: 0),
            TileflowCoordinate(longitude: 1, latitude: 0),
            TileflowCoordinate(longitude: 1, latitude: 1),
          ]
        ])
    ]
    let ring = polygons.core.plan().replace?["features"].flatMap {
      if case .array(let features) = $0 { features.first } else { nil }
    }?["geometry"]?["coordinates"]
    XCTAssertEqual(ring, try json("[[[0,0],[1,0],[1,1],[0,0]]]"))
    XCTAssertEqual(
      polygons.annotations[0].representativeCoordinate?.latitude ?? 0, 1.0 / 3, accuracy: 1e-9)
    let lines = orchestrator.makePolylineAnnotationManager(id: "routes")
    lines.lineCap = .round
    lines.annotations = [TileflowPolylineAnnotation(id: "l", lineCoordinates: [madrid, madrid])]
    XCTAssertEqual(
      lines.core.plan().layer?["layout"],
      try json(#"{"line-cap":"round","line-join":"round"}"#))
  }

  func testTouchesReachTheTopmostHandlerThatConsumesThem() {
    let orchestrator = TileflowAnnotationOrchestrator()
    let pins = orchestrator.makePointAnnotationManager(id: "pins")
    let circles = orchestrator.makeCircleAnnotationManager(id: "circles")
    let calls = Log()
    var pin = TileflowPointAnnotation(id: "pin", coordinate: madrid)
    pin.tapHandler = { _ in
      calls.items.append("pin")
      return false
    }
    var circle = TileflowCircleAnnotation(id: "circle", centerCoordinate: madrid)
    circle.tapHandler = { context in
      calls.items.append("circle \(context.point.x)")
      return true
    }
    circle.longPressHandler = { _ in
      calls.items.append("held")
      return false
    }
    pins.annotations = [pin]
    circles.annotations = [circle]
    let context = TileflowAnnotationInteractionContext(
      point: CGPoint(x: 4, y: 5), coordinate: madrid)
    XCTAssertTrue(
      orchestrator.touch(
        [("pins", "pin"), ("circles", "circle"), ("pins", "pin")], longPress: false,
        context: context))
    XCTAssertEqual(calls.items, ["pin", "circle 4.0"])
    // Annotations without a consuming handler, and unknown layers, leave the touch to the map.
    XCTAssertFalse(
      orchestrator.touch(
        [("circles", "circle"), ("other", "x")], longPress: true, context: context))
    XCTAssertFalse(orchestrator.touch([("pins", "missing")], longPress: false, context: context))
    XCTAssertEqual(calls.items.last, "held")
    // A removed manager no longer receives touches.
    orchestrator.removeAnnotationManager(withId: "circles")
    XCTAssertNil(orchestrator.annotationManagersById["circles"])
    XCTAssertFalse(
      orchestrator.touch([("circles", "circle")], longPress: false, context: context))
    let hits = TileflowMapView.annotationHits(
      .object([
        "annotations": .array([
          .object(["layer": .string("pins"), "id": .string("a")]), .object(["layer": .null]),
        ])
      ]))
    XCTAssertEqual(hits.map(\.layer), ["pins"])
  }

  func testDragsMoveTheAnnotationAndCallItsHandlers() {
    let orchestrator = TileflowAnnotationOrchestrator()
    let pins = orchestrator.makePointAnnotationManager(id: "pins")
    let phases = Log()
    var pin = TileflowPointAnnotation(id: "pin", coordinate: madrid)
    pin.isDraggable = true
    pin.dragBeginHandler = { annotation, _ in
      phases.items.append("began")
      annotation.iconSize = 2
    }
    pin.dragChangeHandler = { annotation, context in
      phases.items.append("changed \(annotation.coordinate.longitude) \(context.point.y)")
    }
    pin.dragEndHandler = { _, _ in phases.items.append("ended") }
    pins.annotations = [
      pin, TileflowPointAnnotation(id: "b", coordinate: madrid),
      TileflowPointAnnotation(id: "c", coordinate: madrid),
    ]
    pins.core.recordSynced(pins.annotations, layer: pins.core.plan().layer)
    let context = TileflowAnnotationInteractionContext(
      point: CGPoint(x: 1, y: 2), coordinate: madrid)
    let moved = TileflowGeometry.point(TileflowCoordinate(longitude: 1, latitude: 2))
    orchestrator.drag(layer: "pins", id: "pin", phase: .started, geometry: moved, context: context)
    orchestrator.drag(layer: "pins", id: "pin", phase: .moved, geometry: moved, context: context)
    XCTAssertEqual(pins.annotations[0].coordinate, TileflowCoordinate(longitude: 1, latitude: 2))
    XCTAssertEqual(pins.annotations[0].iconSize, 2)
    // While dragging, the renderer already shows the geometry: only the handler's change is sent.
    XCTAssertEqual(pins.core.plan().update.count, 1)
    pins.core.recordSynced(pins.annotations, layer: pins.core.plan().layer)
    XCTAssertEqual(pins.core.plan(), .init())
    orchestrator.drag(layer: "pins", id: "pin", phase: .ended, geometry: moved, context: context)
    XCTAssertEqual(phases.items, ["began", "changed 1.0 2.0", "ended"])
    // The end of a drag is recorded, so later renderers draw the annotation where it was dropped.
    XCTAssertEqual(pins.core.plan().update.count, 1)
  }

  func testPositionsApplyToThePointsOfTheirOwnSet() {
    var tracked = TrackedPositions()
    let a = TrackedPositions.Key.annotation("a")
    let b = TrackedPositions.Key.annotation("b")
    let first = tracked.begin([a, b])
    let second = tracked.begin([b])
    // Positions of the earlier set still move its points while the later one is in flight.
    XCTAssertTrue(tracked.apply(revision: first, positions: [1, 2, nil, nil]))
    XCTAssertEqual(tracked.positions[a], CGPoint(x: 1, y: 2))
    XCTAssertNil(tracked.positions[b])
    XCTAssertFalse(tracked.apply(revision: first, positions: [1, 2]))
    XCTAssertTrue(tracked.apply(revision: second, positions: [5, 6]))
    XCTAssertEqual(tracked.positions, [b: CGPoint(x: 5, y: 6)])
    // A set older than the newest applied one is gone.
    XCTAssertFalse(tracked.apply(revision: first, positions: [1, 2, 3, 4]))
    XCTAssertFalse(tracked.apply(revision: 99, positions: []))
  }

  func testLagStatisticsKeepTheLatestSamples() {
    var lag = LagStatistics()
    for value in 1...1200 { lag.add(Double(value)) }
    XCTAssertEqual(lag.samples.count, 1000)
    XCTAssertEqual(lag.maximum, 1200)
    XCTAssertEqual(lag.percentile(0), 201)
    XCTAssertEqual(lag.percentile(0.5) ?? 0, 700, accuracy: 1)
  }

  func testAnnotationsAskForTheEventsTheyNeed() {
    var subscriptions = EventSubscriptions()
    XCTAssertNil(subscriptions.events[.trackedPointsMoved])
    subscriptions.set(.annotations, [.trackedPointsMoved: 0, .annotationDragged: 0])
    XCTAssertEqual(subscriptions.events[.trackedPointsMoved], 0)
    XCTAssertEqual(subscriptions.events[.annotationDragged], 0)
  }

  func testViewAnnotationsReportAnchorAndVisibilityChanges() {
    let annotation = TileflowViewAnnotation(
      coordinate: madrid, view: UIView(frame: CGRect(x: 0, y: 0, width: 30, height: 10)))
    var anchors: [TileflowViewAnnotationAnchor] = []
    var visibility: [Bool] = []
    annotation.onAnchorChanged = { anchors.append($0.anchor) }
    annotation.onVisibilityChanged = { visibility.append($0) }
    XCTAssertTrue(annotation.isHidden)
    annotation.place(.bottom)
    annotation.place(.bottom)
    annotation.place(.center)
    annotation.place(nil)
    XCTAssertEqual(anchors, [.bottom, .center])
    XCTAssertEqual(visibility, [true, false])
    XCTAssertEqual(annotation.size, CGSize(width: 30, height: 10))
  }
}

/// Records calls from handlers, which run on the main actor.
@MainActor
private final class Log {
  var items: [String] = []
}
