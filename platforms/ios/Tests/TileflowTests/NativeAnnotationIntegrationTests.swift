import MapLibre
import UIKit
import XCTest

@testable import Tileflow

@MainActor
final class NativeAnnotationIntegrationTests: XCTestCase {
  private let madrid = TileflowCoordinate(longitude: -3.7, latitude: 40.42)

  private func mounted() async throws -> (TileflowMapView, UIWindow, NativeMapEvents) {
    let events = NativeMapEvents()
    let view = TileflowMapView(
      source: .init(
        map: "city", manifestURL: NativeMapViewIntegrationTests.nativeManifest,
        allowsLoopbackHTTP: true),
      initialCamera: .init(
        longitude: madrid.longitude, latitude: madrid.latitude, zoom: 14, bearing: 0, pitch: 0))
    view.automaticallyAdjustsContentInsets = false
    view.onEvent = events.receive
    let window = MountedMap.sceneWindow()
    view.frame = window.bounds
    window.rootViewController?.view.addSubview(view)
    try await events.waitForLoads(1)
    return (view, window, events)
  }

  private func until(_ predicate: () -> Bool) async throws {
    for _ in 0..<150 {
      if predicate() { return }
      try await Task.sleep(for: .milliseconds(40))
    }
    throw WaitError.timedOut
  }

  private enum WaitError: Error { case timedOut }

  func testVoiceOverReachesAnnotationsInReadingOrderWithTheirActions() async throws {
    let (view, window, _) = try await mounted()
    defer { view.destroy(); window.isHidden = true }
    try await checkAnnotationRotor(on: view)
  }

  func testContentMarkersActivateUpdateAndReplay() async throws {
    let (view, window, events) = try await mounted()
    defer {
      view.destroy()
      window.isHidden = true
    }
    var activated: [String] = []
    view.onEvent = { event in
      events.receive(event)
      if case .annotationActivated(let id, _) = event { activated.append(id) }
    }
    let geometry = Data(#"{"type":"FeatureCollection","features":[]}"#.utf8)
    let overlay = try TileflowGeoJSONLayer(id: "stops", geoJSON: geometry, kind: .circle)
    var pin = TileflowAnnotation(id: "station", coordinate: madrid, title: "Station")
    func button() -> UIButton? {
      (view.engine as? NativeMapEngine)?.container.subviews.compactMap { $0 as? UIButton }
        .first { $0.accessibilityIdentifier == pin.id }
    }
    try await view.setContent(annotations: [pin], layers: [overlay])
    let first = try XCTUnwrap(button())
    XCTAssertTrue(first.isAccessibilityElement)
    XCTAssertEqual(first.accessibilityLabel, "Station")
    XCTAssertTrue(first.accessibilityTraits.contains(.button))
    first.sendActions(for: .primaryActionTriggered)
    XCTAssertEqual(activated, ["station"])
    pin.title = "West station"
    pin.coordinate.longitude -= 0.001
    try await view.setContent(annotations: [pin], layers: [overlay])
    XCTAssertTrue(button() === first)
    XCTAssertEqual(first.accessibilityLabel, "West station")
    let point = try await view.project(pin.coordinate)
    XCTAssertEqual(first.center.x, point.x, accuracy: 0.5)
    try view.reload()
    try await events.waitForLoads(2)
    let restored = try XCTUnwrap(button())
    XCTAssertFalse(restored === first)
    XCTAssertEqual(restored.accessibilityLabel, "West station")
    XCTAssertNil(first.superview)
    try await view.setContent()
    XCTAssertNil(button())
  }

  func testPinsAndViewsStayOnTheVisibleWorldAcrossTheAntimeridian() async throws {
    let (view, window, _) = try await mounted()
    defer {
      view.destroy()
      window.isHidden = true
    }
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    for longitude in [179.0, -179.0] {
      let center = TileflowCoordinate(longitude: longitude, latitude: 0)
      let across = TileflowCoordinate(longitude: -longitude, latitude: 0)
      try await view.move(to: .init(center: center, zoom: 4))
      let expected = try await view.project(across)
      XCTAssertTrue(view.bounds.contains(expected))

      try await view.setContent(
        annotations: [.init(id: "ferry", coordinate: across, title: "Ferry")])
      let pin = try XCTUnwrap(
        engine.container.subviews.first { $0.accessibilityIdentifier == "ferry" })
      XCTAssertFalse(pin.isHidden)
      XCTAssertEqual(pin.center.x, expected.x, accuracy: 0.5)

      let label = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 12))
      let annotation = TileflowViewAnnotation(coordinate: across, view: label)
      view.viewAnnotations.add(annotation)
      try await until { !annotation.isHidden }
      XCTAssertEqual(label.center.x, expected.x, accuracy: 0.5)
      annotation.remove()
    }
  }

  func testAnnotationsBehindThePitchedCameraAreHidden() async throws {
    let (view, window, _) = try await mounted()
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await view.move(to: .init(center: madrid, zoom: 14, bearing: 0, pitch: 80))
    let behind = TileflowCoordinate(longitude: madrid.longitude, latitude: madrid.latitude - 5)
    let far = TileflowViewAnnotation(
      coordinate: behind, view: UIView(frame: .init(x: 0, y: 0, width: 10, height: 10)))
    let near = TileflowViewAnnotation(coordinate: madrid, view: UIView(frame: far.view.bounds))
    view.viewAnnotations.add(far)
    view.viewAnnotations.add(near)
    try await until { !near.isHidden }
    XCTAssertTrue(far.isHidden)

    try await view.setContent(annotations: [.init(id: "bay", coordinate: behind, title: "Bay")])
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let pin = try XCTUnwrap(engine.container.subviews.first { $0.accessibilityIdentifier == "bay" })
    XCTAssertTrue(pin.isHidden)

    try await view.move(to: .init(center: behind))
    try await until { !pin.isHidden && !far.isHidden }
  }

  func testManagedAnnotationsReceiveHitsDragsAndAccessibilityOnTheNativeMap() async throws {
    let (view, window, events) = try await mounted()
    defer {
      view.destroy()
      window.isHidden = true
    }
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let gestures = try XCTUnwrap(engine.gestures)
    var log: [String] = []
    view.onEvent = { event in
      events.receive(event)
      if case .tap = event { log.append("map tap") }
      if case .longPress = event { log.append("map hold") }
    }
    view.annotationOverlay.forcesAccessibilityTracking = true
    let pins = view.annotations.makePointAnnotationManager(id: "pins")
    pins.iconAllowOverlap = true
    let image = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
      UIColor.red.setFill()
      context.fill(CGRect(x: 0, y: 0, width: 20, height: 20))
    }
    var pin = TileflowPointAnnotation(
      id: "station", coordinate: madrid, image: .init(image: image, name: "station"))
    pin.isDraggable = true
    pin.accessibilityLabel = "Station"
    pin.tapHandler = { _ in
      log.append("pin")
      return false
    }
    pin.longPressHandler = { _ in
      log.append("pin hold")
      return true
    }
    pin.dragBeginHandler = { _, _ in log.append("start") }
    pin.dragChangeHandler = { _, _ in log.append("move") }
    pin.dragEndHandler = { _, _ in log.append("end") }
    pins.annotations = [pin]
    let circles = view.annotations.makeCircleAnnotationManager(
      id: "circles", position: .below("pins"))
    var circle = TileflowCircleAnnotation(id: "zone", centerCoordinate: madrid)
    circle.circleRadius = 12
    circle.tapHandler = { _ in
      log.append("circle")
      return true
    }
    circles.annotations = [circle]

    let point = try await view.project(madrid)
    try await until {
      engine.mapAnnotations.hits(at: point).map { $0["id"]?.string } == ["station", "zone"]
    }
    gestures.tapped(FakeTap(point: point))
    gestures.pressed(FakeLongPress(point: point))
    gestures.tapped(FakeTap(point: .init(x: 20, y: 50)))
    gestures.pressed(FakeLongPress(point: .init(x: 20, y: 50)))
    XCTAssertEqual(log, ["pin", "circle", "pin hold", "map tap", "map hold"])

    let top = UILabel(frame: CGRect(x: 0, y: 0, width: 60, height: 20))
    top.accessibilityLabel = "North"
    view.viewAnnotations.add(
      .init(coordinate: try await view.unproject(CGPoint(x: point.x, y: point.y - 100)), view: top))
    try await until { view.annotationOverlay.orderedAccessibilityElements().count == 2 }
    let elements = view.annotationOverlay.orderedAccessibilityElements()
    XCTAssertTrue(elements[0] as? UIView === top)
    let station = try XCTUnwrap(elements[1] as? UIAccessibilityElement)
    XCTAssertEqual(station.accessibilityLabel, "Station")
    XCTAssertEqual(station.accessibilityFrameInContainerSpace.midX, point.x, accuracy: 0.5)
    _ = station.accessibilityActivate()
    let hold = try XCTUnwrap(station.accessibilityCustomActions?.first)
    XCTAssertTrue(hold.actionHandler?(hold) == true)
    XCTAssertEqual(log.suffix(2), ["pin", "pin hold"])

    let input = AnnotationTouch(point)
    let event = UIEvent()
    let drag = gestures.annotationDrag
    drag.touchesBegan([input], with: event)
    input.point.x += 15
    drag.touchesMoved([input], with: event)
    input.point.x += 16
    drag.touchesMoved([input], with: event)
    try await until { log.last == "move" }
    input.point.y += 18
    drag.touchesEnded([input], with: event)
    XCTAssertEqual(log.suffix(3), ["start", "move", "end"])
    let dropped = try await view.unproject(input.point)
    XCTAssertEqual(pins.annotations[0].coordinate.longitude, dropped.longitude, accuracy: 1e-7)
    XCTAssertEqual(pins.annotations[0].coordinate.latitude, dropped.latitude, accuracy: 1e-7)
    let camera = try await view.camera()
    XCTAssertEqual(camera.longitude, madrid.longitude, accuracy: 1e-8)

    try await view.setTheme("dark")
    try view.reload()
    try await events.waitForLoads(2)
    let replacement = try XCTUnwrap(view.engine as? NativeMapEngine)
    try await until {
      replacement.mapAnnotations.hits(at: input.point).first?["id"] == .string("station")
    }
    try await until {
      replacement.mapAnnotations.hits(at: point).map { $0["id"]?.string } == ["zone"]
    }
    view.annotations.removeAnnotationManager(withId: "pins")
    try await until { !view.sourceExists("pins") && !view.layerExists("pins") }
  }

  func testReloadKeepsTheLastPointOfAnUnfinishedDrag() async throws {
    let (view, window, events) = try await mounted()
    defer {
      view.destroy()
      window.isHidden = true
    }
    let circles = view.annotations.makeCircleAnnotationManager(id: "circles")
    var item = TileflowCircleAnnotation(id: "drop", centerCoordinate: madrid)
    item.isDraggable = true
    item.circleRadius = 7
    circles.annotations = [item]
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let point = try await view.project(madrid)
    let last = CGPoint(x: point.x + 66, y: point.y + 11)
    let expected = try await view.unproject(last)
    try await until { engine.mapAnnotations.hits(at: point).first?["id"] == .string("drop") }
    XCTAssertTrue(engine.mapAnnotations.beginDrag(at: point))
    XCTAssertTrue(engine.mapAnnotations.moveDrag(to: CGPoint(x: point.x + 15, y: point.y)))
    XCTAssertTrue(engine.mapAnnotations.moveDrag(to: last))
    // No display refresh or touch-up between the last move and retirement.
    try view.reload()
    try await events.waitForLoads(2)
    XCTAssertEqual(
      circles.annotations[0].centerCoordinate.longitude, expected.longitude, accuracy: 1e-7)
    XCTAssertEqual(
      circles.annotations[0].centerCoordinate.latitude, expected.latitude, accuracy: 1e-7)
    let replacement = try XCTUnwrap(view.engine as? NativeMapEngine)
    try await until { replacement.mapAnnotations.hits(at: last).first?["id"] == .string("drop") }
  }

  func testDraggingLinesAndPolygonsPreservesUnclippedVerticesAndHoles() async throws {
    let (view, window, _) = try await mounted()
    defer {
      view.destroy()
      window.isHidden = true
    }
    let engine = try XCTUnwrap(view.engine as? NativeMapEngine)
    let map = try XCTUnwrap(engine.mapView)
    func coordinate(_ x: CGFloat, _ y: CGFloat) -> TileflowCoordinate {
      let c = map.convert(CGPoint(x: x, y: y), toCoordinateFrom: map)
      return .init(longitude: c.longitude, latitude: c.latitude)
    }
    let line = [
      coordinate(-200, 110), coordinate(90, 110), coordinate(140, 150), coordinate(730, 160),
    ]
    let lines = view.annotations.makePolylineAnnotationManager(id: "lines")
    var path = TileflowPolylineAnnotation(id: "path", lineCoordinates: line)
    path.isDraggable = true
    path.lineWidth = 8
    lines.annotations = [path]
    let outer = [
      coordinate(30, 230), coordinate(270, 230), coordinate(270, 400), coordinate(30, 400),
      coordinate(30, 230),
    ]
    let hole = [
      coordinate(90, 270), coordinate(90, 310), coordinate(120, 310), coordinate(120, 270),
      coordinate(90, 270),
    ]
    let areas = view.annotations.makePolygonAnnotationManager(id: "areas")
    var polygon = TileflowPolygonAnnotation(id: "park", polygon: [outer, hole])
    polygon.isDraggable = true
    areas.annotations = [polygon]

    func move(_ id: String, at point: CGPoint) async throws {
      try await until { engine.mapAnnotations.hits(at: point).first?["id"] == .string(id) }
      XCTAssertTrue(engine.mapAnnotations.beginDrag(at: point))
      XCTAssertFalse(engine.mapAnnotations.moveDrag(to: CGPoint(x: point.x + 1, y: point.y)))
      engine.mapAnnotations.endDrag(at: CGPoint(x: point.x + 20, y: point.y + 12))
    }

    func assertMoved(_ original: [TileflowCoordinate], _ moved: [TileflowCoordinate]) {
      XCTAssertEqual(original.count, moved.count)
      for (a, b) in zip(original, moved) {
        let before = map.convert(
          CLLocationCoordinate2D(latitude: a.latitude, longitude: a.longitude), toPointTo: map)
        let after = map.convert(
          CLLocationCoordinate2D(latitude: b.latitude, longitude: b.longitude), toPointTo: map)
        XCTAssertEqual(after.x - before.x, 20, accuracy: 0.01)
        XCTAssertEqual(after.y - before.y, 12, accuracy: 0.01)
      }
    }

    try await move("path", at: CGPoint(x: 70, y: 110))
    assertMoved(line, lines.annotations[0].lineCoordinates)
    try await move("park", at: CGPoint(x: 160, y: 320))
    let moved = areas.annotations[0].polygon
    XCTAssertEqual(moved.count, 2)
    guard moved.count == 2 else { return }
    assertMoved(outer, moved[0])
    assertMoved(hole, moved[1])
    XCTAssertEqual(moved[1].first, moved[1].last)
  }

  func testTwoHundredViewsShareTheRenderedMapFrameDuringAFastPan() async throws {
    let (view, window, _) = try await mounted()
    defer {
      view.destroy()
      window.isHidden = true
    }
    let map = try XCTUnwrap((view.engine as? NativeMapEngine)?.mapView)
    let w = map.bounds.width
    let h = map.bounds.height
    var annotations: [TileflowViewAnnotation] = []
    var features: [[String: Any]] = []
    for row in 0..<20 {
      for column in 0..<10 {
        let point = CGPoint(x: -w + CGFloat(column) * w / 3, y: (CGFloat(row) + 0.5) * h / 20)
        let coordinate = try await view.unproject(point)
        let marker = UIView(frame: CGRect(x: 0, y: 0, width: 6, height: 6))
        marker.backgroundColor = .magenta
        let annotation = TileflowViewAnnotation(coordinate: coordinate, view: marker)
        annotation.allowOverlap = true
        view.viewAnnotations.add(annotation)
        annotations.append(annotation)
        features.append([
          "type": "Feature", "properties": [:],
          "geometry": [
            "type": "Point", "coordinates": [coordinate.longitude, coordinate.latitude],
          ],
        ])
      }
    }
    try await view.addSource(
      id: "alignment",
      properties: ["type": "geojson", "data": ["type": "FeatureCollection", "features": features]])
    try await view.addLayer(properties: [
      "id": "reference", "type": "circle", "source": "alignment",
      "paint": ["circle-radius": 12, "circle-color": "#0000ff"],
    ])
    try await until { annotations.allSatisfy { !$0.isHidden } }
    let east = try await view.unproject(CGPoint(x: w * 1.5, y: h / 2))
    let probe = AnnotationFrameProbe(map: map, annotations: annotations)
    probe.start()
    defer { probe.stop() }
    for sweep in 0..<3 {
      for center in [east, madrid] {
        let motion = Task {
          try await view.ease(to: .init(center: center), duration: 0.5, easing: .linear)
        }
        if sweep == 1 {
          try await Task.sleep(for: .milliseconds(240))
          probe.capturePixels(in: window)
        }
        _ = try await motion.value
      }
    }
    probe.stop()
    print(
      "Native annotation alignment: 200 views, \(probe.movingFrames) moving frames, \(probe.widths) view widths, max lag \(probe.lagFrames) frames, max error \(probe.maximumError) pt, \(probe.pixelPairs) rendered circle/UIView pairs, worst pixel offset \(probe.pixelOffset) pt"
    )
    XCTAssertGreaterThan(probe.movingFrames, 90)
    XCTAssertGreaterThan(probe.widths, 5.5)
    XCTAssertEqual(probe.lagFrames, 0)
    XCTAssertLessThanOrEqual(probe.maximumError, 1)
    XCTAssertGreaterThan(probe.pixelPairs, 12)
    XCTAssertLessThanOrEqual(probe.pixelOffset, 1.5)
    annotations[0].visible = false
    try await until { annotations[0].isHidden && annotations[0].view.isHidden }
    view.viewAnnotations.removeAll()
    XCTAssertTrue(annotations.allSatisfy { $0.view.superview == nil })
  }
}

private final class AnnotationTouch: UITouch {
  var point: CGPoint
  init(_ point: CGPoint) {
    self.point = point
    super.init()
  }
  override func location(in view: UIView?) -> CGPoint { point }
}

@MainActor
private final class AnnotationFrameProbe: NSObject {
  let map: MLNMapView
  let annotations: [TileflowViewAnnotation]
  private let reference = AnnotationRenderReference(identifier: "frame-observer")
  private var link: CADisplayLink?
  private var previous: CGPoint?
  private var travel: CGFloat = 0
  private(set) var movingFrames = 0
  private(set) var lagFrames = 0
  private(set) var maximumError: CGFloat = 0
  private(set) var pixelPairs = 0
  private(set) var pixelOffset: CGFloat = 0
  var widths: CGFloat { travel / map.bounds.width }

  init(map: MLNMapView, annotations: [TileflowViewAnnotation]) {
    self.map = map
    self.annotations = annotations
  }

  func start() {
    map.style?.addLayer(reference)
    let link = CADisplayLink(target: self, selector: #selector(check))
    link.add(to: .main, forMode: .common)
    self.link = link
  }

  func stop() {
    guard let link else { return }
    link.invalidate()
    self.link = nil
    map.style?.removeLayer(reference)
  }

  @objc private func check() {
    // MapLibre can already be animating the next camera. Use the camera actually passed to
    // the Metal draw, independent of the camera getter and the SDK's frame callback.
    guard let frame = reference.camera.withLock({ $0 }) else { return }
    let current = frame.project(annotations[0].coordinate)
    defer { previous = current }
    guard let previous else { return }
    let stride = hypot(current.x - previous.x, current.y - previous.y)
    travel += stride
    guard stride > 1 else { return }
    movingFrames += 1
    for annotation in annotations {
      let point = frame.project(annotation.coordinate)
      let drawn = annotation.view.center
      let distance = hypot(point.x - drawn.x, point.y - drawn.y)
      maximumError = max(maximumError, distance)
      lagFrames = max(lagFrames, Int((distance / stride).rounded()))
    }
  }

  func capturePixels(in window: UIWindow) {
    // A magenta UIKit view sits over a blue MapLibre circle. Read their relative centres
    // from the same composited image, independent of both the SDK and the projection API.
    let pixels = PixelReader(NativeOfflineElevationTests.snapshot(window))
    for annotation in annotations {
      let point = annotation.view.convert(CGPoint(x: 3, y: 3), to: window)
      guard window.bounds.insetBy(dx: 48, dy: 28).contains(point) else { continue }
      var blue: [CGPoint] = []
      var magenta: [CGPoint] = []
      for y in (Int(point.y) - 18)...(Int(point.y) + 18) {
        for x in (Int(point.x) - 40)...(Int(point.x) + 40) {
          let p = CGPoint(x: x, y: y)
          if pixels.matches(p, 0x0000ff) { blue.append(p) }
          if pixels.matches(p, 0xff00ff) { magenta.append(p) }
        }
      }
      guard !magenta.isEmpty, !blue.isEmpty else { continue }
      func middle(_ points: [CGPoint]) -> CGPoint {
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        return CGPoint(x: (xs.min()! + xs.max()!) / 2, y: (ys.min()! + ys.max()!) / 2)
      }
      let a = middle(blue)
      let b = middle(magenta)
      pixelPairs += 1
      pixelOffset = max(pixelOffset, hypot(a.x - b.x, a.y - b.y))
    }
  }
}

/// Records the camera that Metal received for this draw. The test uses a flat, north-up map.
private final class AnnotationRenderReference: MLNCustomStyleLayer {
  struct Camera: Sendable {
    let size: CGSize
    let longitude: Double
    let latitude: Double
    let zoom: Double

    func project(_ coordinate: TileflowCoordinate) -> CGPoint {
      let world = 512 * exp2(zoom)
      func northing(_ latitude: Double) -> Double { asinh(tan(latitude * .pi / 180)) / (2 * .pi) }
      return CGPoint(
        x: size.width / 2 + (coordinate.longitude - longitude) * world / 360,
        y: size.height / 2 + (northing(latitude) - northing(coordinate.latitude)) * world)
    }
  }

  let camera = LockedValue<Camera?>(nil)

  override func draw(in mapView: MLNMapView, with context: MLNStyleLayerDrawingContext) {
    let frame = Camera(
      size: context.size, longitude: context.centerCoordinate.longitude,
      latitude: context.centerCoordinate.latitude, zoom: context.zoomLevel)
    camera.withLock { $0 = frame }
  }
}
