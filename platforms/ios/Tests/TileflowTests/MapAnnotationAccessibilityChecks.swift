import UIKit
import XCTest

@testable import Tileflow

@MainActor
extension XCTestCase {
  func checkAnnotationRotor(on view: TileflowMapView) async throws {
    var actions: [String] = []
    view.annotationOverlay.forcesAccessibilityTracking = true
    let pins = view.annotations.makePointAnnotationManager(id: "pins")
    var labelled: [TileflowPointAnnotation] = []
    for (index, y) in [600.0, 200.0].enumerated() {
      var pin = TileflowPointAnnotation(
        id: "pin\(index)", coordinate: try await view.unproject(CGPoint(x: 100, y: y)),
        image: .init(image: MapTestFixtures.pinImage(), name: "red-pin"))
      pin.accessibilityLabel = "Pin \(index)"
      pin.tapHandler = { _ in
        actions.append("tap \(index)")
        return true
      }
      pin.longPressHandler = { _ in
        actions.append("hold \(index)")
        return true
      }
      labelled.append(pin)
    }
    // An annotation without a label is not an accessibility element.
    pins.annotations =
      labelled + [
        TileflowPointAnnotation(
          id: "silent", coordinate: TileflowCoordinate(longitude: -3.7, latitude: 40.42))
      ]
    let callout = UILabel()
    callout.text = "Callout"
    callout.sizeToFit()
    view.viewAnnotations.add(
      TileflowViewAnnotation(
        coordinate: try await view.unproject(CGPoint(x: 200, y: 400)), view: callout))

    let overlay = view.annotationOverlay
    for _ in 0..<200 where overlay.orderedAccessibilityElements().count != 3 {
      try await Task.sleep(for: .milliseconds(50))
    }
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
    XCTAssertEqual(actions, ["tap 1", "hold 1"])
    XCTAssertTrue(first.accessibilityTraits.contains(.button))
  }
}
