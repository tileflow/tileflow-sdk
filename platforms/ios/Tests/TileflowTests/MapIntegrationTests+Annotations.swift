import UIKit
import WebKit
import XCTest

@testable import Tileflow

/// Annotations through the real renderer: managers drawn by runtime style layers, taps and drags
/// that reach their handlers, native views that follow a fast pan, and VoiceOver's traversal. It
/// draws the map, so it belongs to `MapIntegrationTests`, which runs where WebKit can render.
extension MapIntegrationTests {
  private static let madrid = TileflowCoordinate(longitude: -3.7, latitude: 40.42)

  private func showAnnotationMap() async throws -> (
    TileflowMapView, UIWindow, () -> Int, () -> [TileflowMapEvent]
  ) {
    do {
      _ = try await URLSession.shared.data(from: FixtureServer.manifest)
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run online map integration.")
    }
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest, allowsLoopbackHTTP: true),
      initialCamera: TileflowCamera(
        longitude: Self.madrid.longitude, latitude: Self.madrid.latitude, zoom: 14))
    view.automaticallyAdjustsContentInsets = false
    var loads = 0
    var events: [TileflowMapEvent] = []
    view.onEvent = { event in
      events.append(event)
      if case .contentReady = event { loads += 1 }
    }
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    let controller = UIViewController()
    window.rootViewController = controller
    view.frame = window.bounds
    controller.view.addSubview(view)
    window.makeKeyAndVisible()
    try await waitUntil(seconds: 30) { loads == 1 }
    return (view, window, { loads }, { events })
  }

  private static func pinImage() -> UIImage {
    UIGraphicsImageRenderer(size: CGSize(width: 24, height: 24)).image { context in
      UIColor.systemRed.setFill()
      context.cgContext.fillEllipse(in: CGRect(x: 2, y: 2, width: 20, height: 20))
    }
  }

  /// Synthetic input in the renderer, as WebKit delivers a touch: pointer and mouse events.
  private func press(
    _ view: TileflowMapView, from start: CGPoint, to end: CGPoint, steps: Int
  ) async throws {
    _ = try await renderer(view).callAsyncJavaScript(
      """
      const target = document.querySelector('.maplibregl-canvas-container');
      const at = (type, x, y, extra = {}) => target.dispatchEvent(
        new (type.startsWith('pointer') ? PointerEvent : MouseEvent)(type, {
          bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: 1,
          isPrimary: true, pointerId: 1, ...extra}));
      const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      at('pointerdown', x0, y0);
      at('mousedown', x0, y0);
      for (let step = 1; step <= steps; step++) {
        const x = x0 + (x1 - x0) * step / steps, y = y0 + (y1 - y0) * step / steps;
        at('pointermove', x, y);
        at('mousemove', x, y);
        await pause(16);
      }
      at('pointerup', x1, y1, {buttons: 0});
      at('mouseup', x1, y1, {buttons: 0});
      if (steps === 0) at('click', x1, y1, {buttons: 0});
      """,
      arguments: [
        "x0": start.x, "y0": start.y, "x1": end.x, "y1": end.y, "steps": steps,
      ], in: nil, contentWorld: .page)
  }

  func testAnnotationManagersDrawTakeTapsAndDragsAndSurviveANewRenderer() async throws {
    let (view, window, loads, events) = try await showAnnotationMap()
    defer {
      view.destroy()
      window.isHidden = true
    }
    let log = AnnotationLog()
    let pins = view.annotations.makePointAnnotationManager(id: "pins")
    pins.iconAllowOverlap = true
    var pin = TileflowPointAnnotation(
      id: "pin", coordinate: Self.madrid, image: .init(image: Self.pinImage(), name: "red-pin"))
    pin.isDraggable = true
    pin.tapHandler = { _ in
      log.items.append("tap")
      return true
    }
    pin.dragBeginHandler = { _, _ in log.items.append("drag began") }
    pin.dragEndHandler = { annotation, _ in
      log.items.append("drag ended")
      log.dropped = annotation.coordinate
    }
    pins.annotations = [pin]
    let circles = view.annotations.makeCircleAnnotationManager(
      id: "circles", position: .below("pins"))
    var circle = TileflowCircleAnnotation(
      id: "circle", centerCoordinate: TileflowCoordinate(longitude: -3.698, latitude: 40.421))
    circle.circleRadius = 12
    circle.circleColor = "#2266ff"
    circles.annotations = [circle]

    // Both managers draw through the runtime style, in the order asked for.
    try await waitUntil(seconds: 10) { view.layerExists("pins") && view.layerExists("circles") }
    var drawn: [TileflowQueriedFeature] = []
    for _ in 0..<100 where drawn.count < 2 {
      drawn =
        (try? await view.queryRenderedFeatures(options: .init(layerIds: ["pins", "circles"]))) ?? []
      try await Task.sleep(for: .milliseconds(100))
    }
    XCTAssertEqual(
      Set(drawn.compactMap(\.feature.properties["id"]?.string)), ["pin", "circle"],
      "Warnings: \(events().filter { if case .warning = $0 { true } else { false } })")

    // A tap on the pin reaches its handler, which consumes it: the map's tap is not sent.
    let point = try await view.project(Self.madrid)
    try await press(view, from: point, to: point, steps: 0)
    try await waitUntil { log.items == ["tap"] }
    let taps = events().filter { if case .tap = $0 { true } else { false } }
    XCTAssertTrue(taps.isEmpty, "The consumed tap reached the map.")
    // A tap away from annotations reaches the map.
    try await press(view, from: CGPoint(x: 40, y: 700), to: CGPoint(x: 40, y: 700), steps: 0)
    try await waitUntil {
      events().contains { if case .tap = $0 { true } else { false } }
    }

    // A pan that starts on the draggable pin moves it, not the map.
    let camera = try XCTUnwrap(view.currentCamera)
    let target = CGPoint(x: point.x + 60, y: point.y + 40)
    try await press(view, from: point, to: target, steps: 8)
    try await waitUntil { log.items.last == "drag ended" }
    XCTAssertEqual(log.items, ["tap", "drag began", "drag ended"])
    let expected = try await view.unproject(target)
    let dropped = try XCTUnwrap(log.dropped)
    XCTAssertEqual(dropped.longitude, expected.longitude, accuracy: 1e-4)
    XCTAssertEqual(dropped.latitude, expected.latitude, accuracy: 1e-4)
    XCTAssertEqual(pins.annotations[0].coordinate, dropped)
    XCTAssertEqual(view.currentCamera?.longitude ?? 0, camera.longitude, accuracy: 1e-9)

    // A new renderer draws the pin where it was dropped.
    try view.reload()
    try await waitUntil(seconds: 30) { loads() == 2 }
    var restored: [TileflowQueriedFeature] = []
    for _ in 0..<100 where restored.isEmpty {
      restored = (try? await view.querySourceFeatures(sourceId: "pins")) ?? []
      try await Task.sleep(for: .milliseconds(100))
    }
    guard case .point(let coordinate) = restored.first?.feature.geometry else {
      return XCTFail("The pin was not restored: \(restored)")
    }
    XCTAssertEqual(coordinate.longitude, dropped.longitude, accuracy: 1e-6)
    XCTAssertEqual(coordinate.latitude, dropped.latitude, accuracy: 1e-6)

    view.annotations.removeAnnotationManager(withId: "circles")
    try await waitUntil { !view.layerExists("circles") && !view.sourceExists("circles") }
  }

  func testTwoHundredViewAnnotationsFollowAFastPan() async throws {
    let (view, window, _, _) = try await showAnnotationMap()
    defer {
      view.destroy()
      window.isHidden = true
    }
    // Two hundred views over the view and beyond it, so views enter and leave during the pans.
    var annotations: [TileflowViewAnnotation] = []
    for row in 0..<20 {
      for column in 0..<10 {
        let coordinate = try await view.unproject(
          CGPoint(x: -390 + Double(column) * 117, y: 30 + Double(row) * 40))
        let marker = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 12))
        marker.backgroundColor = .systemBlue
        let annotation = TileflowViewAnnotation(coordinate: coordinate, view: marker)
        annotation.allowOverlap = true
        view.viewAnnotations.add(annotation)
        annotations.append(annotation)
      }
    }
    try await waitUntil(seconds: 10) { annotations.allSatisfy { !$0.isHidden } }

    // Fast pans: one view width in half a second, back and forth.
    let overlay = view.annotationOverlay
    overlay.resetLag()
    let east = try await view.unproject(CGPoint(x: 195 + 390, y: 422))
    let west = Self.madrid
    let started = Date()
    for _ in 0..<3 {
      for center in [east, west] {
        _ = try await view.ease(
          to: TileflowCameraUpdate(center: center), duration: 0.5, easing: .linear)
      }
    }
    let seconds = Date().timeIntervalSince(started)
    let lag = overlay.lag
    let p50 = try XCTUnwrap(lag.percentile(0.5))
    let p95 = try XCTUnwrap(lag.percentile(0.95))
    let maximum = try XCTUnwrap(lag.maximum)
    let frame = 1000.0 / 60
    print(
      String(
        format:
          "View annotations: 200 views, 6 pans of one view width (390 pt) in 0.5 s; %d renderer frames applied in %.1f s; lag p50 %.1f ms (%.2f frames), p95 %.1f ms (%.2f frames), max %.1f ms (%.2f frames)",
        overlay.appliedFrames, seconds, p50, p50 / frame, p95, p95 / frame, maximum,
        maximum / frame))
    XCTAssertGreaterThan(overlay.appliedFrames, 90, "Most renderer frames moved the views.")
    // A generous ceiling: machines under load must not flake; the numbers are printed above.
    XCTAssertLessThan(p95, 100)

    // Once the camera settles, every shown view sits where the renderer projects its coordinate.
    try await Task.sleep(for: .milliseconds(300))
    for annotation in annotations.prefix(40) where !annotation.isHidden {
      let projected = try await view.project(annotation.coordinate)
      XCTAssertEqual(annotation.view.center.x, projected.x, accuracy: 1)
      XCTAssertEqual(annotation.view.center.y, projected.y, accuracy: 1)
    }
    // Hiding a view stops following it; removing all takes the views off the map.
    annotations[0].visible = false
    try await waitUntil { annotations[0].isHidden && annotations[0].view.isHidden }
    view.viewAnnotations.removeAll()
    XCTAssertTrue(annotations.allSatisfy { $0.view.superview == nil })
  }

  func testVoiceOverReachesAnnotationsInReadingOrderWithTheirActions() async throws {
    let (view, window, _, _) = try await showAnnotationMap()
    defer {
      view.destroy()
      window.isHidden = true
    }
    let log = AnnotationLog()
    view.annotationOverlay.forcesAccessibilityTracking = true
    let pins = view.annotations.makePointAnnotationManager(id: "pins")
    var labelled: [TileflowPointAnnotation] = []
    for (index, y) in [600.0, 200.0].enumerated() {
      var pin = TileflowPointAnnotation(
        id: "pin\(index)", coordinate: try await view.unproject(CGPoint(x: 100, y: y)),
        image: .init(image: Self.pinImage(), name: "red-pin"))
      pin.accessibilityLabel = "Pin \(index)"
      pin.tapHandler = { _ in
        log.items.append("tap \(index)")
        return true
      }
      pin.longPressHandler = { _ in
        log.items.append("hold \(index)")
        return true
      }
      labelled.append(pin)
    }
    // An annotation without a label is not an accessibility element.
    pins.annotations = labelled + [TileflowPointAnnotation(id: "silent", coordinate: Self.madrid)]
    let callout = UILabel()
    callout.text = "Callout"
    callout.sizeToFit()
    view.viewAnnotations.add(
      TileflowViewAnnotation(
        coordinate: try await view.unproject(CGPoint(x: 200, y: 400)), view: callout))

    let overlay = view.annotationOverlay
    try await waitUntil(seconds: 10) { overlay.orderedAccessibilityElements().count == 3 }
    let elements = overlay.orderedAccessibilityElements()
    guard elements.count == 3 else {
      return XCTFail("Accessibility elements: \(elements)")
    }
    let labels = elements.map { ($0 as? NSObject)?.accessibilityLabel ?? ($0 as? UILabel)?.text }
    XCTAssertEqual(labels, ["Pin 1", "Callout", "Pin 0"])

    // The rotor walks the same order, both ways.
    let rotor = try XCTUnwrap(view.accessibilityCustomRotors?.first { $0.name == "Annotations" })
    var walked: [String?] = []
    // Searching from the map itself starts at the first annotation.
    var current: NSObjectProtocol = view
    for _ in 0..<4 {
      let predicate = UIAccessibilityCustomRotorSearchPredicate()
      predicate.currentItem = UIAccessibilityCustomRotorItemResult(
        targetElement: current, targetRange: nil)
      predicate.searchDirection = .next
      guard let found = rotor.itemSearchBlock(predicate)?.targetElement else { break }
      current = found
      walked.append((current as? NSObject)?.accessibilityLabel ?? (current as? UILabel)?.text)
    }
    XCTAssertEqual(walked, ["Pin 1", "Callout", "Pin 0"])
    let predicate = UIAccessibilityCustomRotorSearchPredicate()
    predicate.currentItem = UIAccessibilityCustomRotorItemResult(
      targetElement: current, targetRange: nil)
    predicate.searchDirection = .previous
    XCTAssertTrue(rotor.itemSearchBlock(predicate)?.targetElement === elements[1] as AnyObject)

    // Activating an element taps the annotation; its custom action holds it.
    let first = try XCTUnwrap(elements[0] as? UIAccessibilityElement)
    XCTAssertTrue(first.accessibilityActivate())
    let action = try XCTUnwrap(first.accessibilityCustomActions?.first { $0.name == "Long press" })
    XCTAssertTrue(action.actionHandler?(action) ?? false)
    XCTAssertEqual(log.items, ["tap 1", "hold 1"])
    XCTAssertTrue(first.accessibilityTraits.contains(.button))
  }

  func testAControllerKeepsItsAnnotationsForTheMapItAttachesTo() async throws {
    let controller = TileflowMapController()
    let pins = controller.annotations.makePointAnnotationManager(id: "pins")
    pins.annotations = [TileflowPointAnnotation(coordinate: Self.madrid)]
    let marker = TileflowViewAnnotation(coordinate: Self.madrid, view: UIView())
    controller.viewAnnotations.add(marker)
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: FixtureServer.manifest, allowsLoopbackHTTP: true))
    defer { view.destroy() }
    try controller.attach(view)
    XCTAssertTrue(view.annotations === controller.annotations)
    XCTAssertTrue(view.viewAnnotations === controller.viewAnnotations)
    try await waitUntil { view.layerExists("pins") }
    controller.detach(view)
    XCTAssertFalse(view.annotations === controller.annotations)
    XCTAssertTrue(view.viewAnnotations.annotations.isEmpty)
  }
}

/// Records what handlers saw; they run on the main actor.
@MainActor
private final class AnnotationLog {
  var items: [String] = []
  var dropped: TileflowCoordinate?
}
