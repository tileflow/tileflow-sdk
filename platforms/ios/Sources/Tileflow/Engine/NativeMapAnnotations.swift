import MapLibre
import UIKit

/// Annotation interaction and frame projection owned by one MapLibre renderer.
@MainActor
final class NativeMapAnnotations {
  struct Pin {
    let id: String
    let title: String
    let color: UIColor
    let coordinate: TileflowCoordinate
  }
  struct Drag {
    let layer: String
    let source: String
    let feature: String
    let start: CGPoint
    let screenGeometry: JSONValue
    var geometry: JSONValue
    var point: CGPoint
    var moved = false
    var needsReport = false
  }

  unowned let engine: NativeMapEngine
  private var pins: [String: Pin] = [:]
  private var buttons: [String: MarkerButton] = [:]
  private var layers: [String] = []
  private var drag: Drag?
  private var tracked: [TileflowCoordinate] = []
  private var revision = 0
  private var lastProjection: [CGPoint?]?
  var dragging: Bool { drag?.moved == true }

  init(_ engine: NativeMapEngine) { self.engine = engine }

  static func pins(in request: JSONValue) throws -> [Pin] {
    guard let values = request["annotations"]?.array else { throw TileflowMapError.invalidRequest }
    return try values.map { value in
      guard let id = value["id"]?.string, let title = value["ariaLabel"]?.string,
        let coordinate = value["coordinate"]?.array, coordinate.count == 2,
        let lng = coordinate[0].number, let lat = coordinate[1].number,
        (-180...180).contains(lng), (-90...90).contains(lat),
        let css = value["marker"]?["color"]?.string, let color = NativeEvaluators.parseColour(css)
      else { throw TileflowMapError.invalidRequest }
      return Pin(
        id: id, title: title,
        color: UIColor(
          red: color[0] / 255, green: color[1] / 255, blue: color[2] / 255, alpha: color[3]),
        coordinate: .init(longitude: lng, latitude: lat))
    }
  }

  func setPins(_ definitions: [Pin]) {
    let next = Set(definitions.map(\.id))
    for id in buttons.keys where !next.contains(id) {
      buttons.removeValue(forKey: id)?.removeFromSuperview()
    }
    pins.removeAll(keepingCapacity: true)
    for pin in definitions {
      let button: MarkerButton
      if let existing = buttons[pin.id] {
        button = existing
      } else {
        button = MarkerButton(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
        button.accessibilityIdentifier = pin.id
        let id = pin.id
        button.addAction(
          UIAction { [weak self] _ in self?.activate(id) }, for: .primaryActionTriggered)
        engine.container.insertSubview(button, belowSubview: engine.attribution.view)
        buttons[id] = button
      }
      pins[pin.id] = pin
      button.dot.backgroundColor = pin.color
      button.accessibilityLabel = pin.title
    }
    project()
  }

  private func activate(_ id: String) {
    guard let pin = pins[id] else { return }
    engine.onEvent?(
      "annotationActivated",
      .object([
        "id": .string(id),
        "coordinate": .object([
          "longitude": .number(pin.coordinate.longitude),
          "latitude": .number(pin.coordinate.latitude),
        ]),
      ]))
  }

  func setLayers(_ request: JSONValue) throws {
    guard let values = request["layers"]?.array,
      values.count <= ProtocolContract.maximumAnnotationLayers
    else { throw TileflowMapError.invalidRequest }
    let ids = values.compactMap(\.string)
    guard ids.count == values.count, Set(ids).count == ids.count else {
      throw TileflowMapError.invalidRequest
    }
    layers = ids
    if let drag, !ids.contains(drag.layer) { endDrag() }
  }

  func setTracking(_ request: JSONValue) throws {
    guard let id = request["revision"]?.number.flatMap(Int.init(exactly:)),
      (0...9_007_199_254_740_991).contains(id),
      let points = request["points"]?.array, points.count <= ProtocolContract.maximumTrackedPoints
    else { throw TileflowMapError.invalidRequest }
    let next = try points.map { point -> TileflowCoordinate in
      guard let coordinate = point.array, coordinate.count == 2, let lng = coordinate[0].number,
        let lat = coordinate[1].number,
        lng.isFinite, lat.isFinite, (-180...180).contains(lng), (-90...90).contains(lat)
      else { throw TileflowMapError.invalidRequest }
      return .init(longitude: lng, latitude: lat)
    }
    revision = id
    tracked = next
    lastProjection = nil
    project()
  }

  private static func point(_ coordinate: TileflowCoordinate, on map: MLNMapView) -> CGPoint? {
    // MapLibre selects the nearest world copy after validating the geographic coordinate.
    let result = map.convert(
      CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude),
      toPointTo: map)
    return result.x.isFinite && result.y.isFinite ? result : nil
  }

  private func project() {
    guard !pins.isEmpty || !tracked.isEmpty || lastProjection == nil, let map = engine.mapView
    else { return }
    let pitch = map.camera.pitch * .pi / 180
    // MapLibre also projects ground behind the camera. Its fixed vertical field of view
    // gives a focal length of 1.5 viewport heights; the ground ends at this screen row.
    let horizon = pitch > 0
      ? map.convert(map.centerCoordinate, toPointTo: map).y - 1.5 * map.bounds.height / tan(pitch)
      : -CGFloat.infinity
    func visiblePoint(_ coordinate: TileflowCoordinate) -> CGPoint? {
      guard let point = Self.point(coordinate, on: map), point.y > horizon else { return nil }
      return point
    }

    for (id, pin) in pins {
      guard let button = buttons[id] else { continue }
      if let point = visiblePoint(pin.coordinate) {
        button.center = point
        button.isHidden = false
      } else {
        button.isHidden = true
      }
    }
    guard !tracked.isEmpty || lastProjection == nil else { return }
    let positions = tracked.map(visiblePoint)
    guard positions != lastProjection else { return }
    lastProjection = positions
    engine.onAnnotationFrame?(revision, positions)
  }

  /// Called immediately after MapLibre draws, before UIKit commits the view tree for this frame.
  func frame() {
    reportPendingDrag()
    project()
  }

  /// Touch tolerance and order match the mobile renderer. Restrict hits to the manager layers.
  func hits(at point: CGPoint) -> [JSONValue] {
    guard !layers.isEmpty, let map = engine.mapView, let style = map.style else { return [] }
    func corner(_ x: CGFloat, _ y: CGFloat) -> JSONValue {
      .object(["x": .number(x), "y": .number(y)])
    }
    let box = JSONValue.object([
      "box": .array([corner(point.x - 6, point.y - 6), corner(point.x + 6, point.y + 6)])
    ])
    let request = JSONValue.object([
      "geometry": box, "limit": .number(16), "layers": .array(layers.map(JSONValue.string)),
    ])
    return (try? engine.runtimeStyle.queryRendered(request, map: map, style: style).array)?
      .compactMap { hit in
        guard let layer = hit["layer"], let source = hit["source"],
          let id = hit["properties"]?["id"]?.string
        else { return nil }
        return .object([
          "layer": layer, "source": source, "id": .string(id),
          "draggable": hit["properties"]?["draggable"] ?? .bool(false),
        ])
      } ?? []
  }

  /// Follows the original, unclipped geometry under the finger, including every line and polygon vertex.
  func beginDrag(at point: CGPoint) -> Bool {
    endDrag()
    guard let map = engine.mapView, let hit = hits(at: point).first,
      hit["draggable"] == .bool(true),
      let layer = hit["layer"]?.string, let source = hit["source"]?.string,
      let id = hit["id"]?.string,
      let geometry = engine.runtimeStyle.annotationGeometry(source: source, id: id),
      let screen = Self.mapPositions(
        geometry,
        transform: { values in
          guard
            let p = Self.point(.init(longitude: values[0], latitude: values[1]), on: map)
          else { return nil }
          return [p.x, p.y] + values.dropFirst(2)
        })
    else { return false }
    drag = Drag(
      layer: layer, source: source, feature: id, start: point, screenGeometry: screen,
      geometry: geometry, point: point)
    return true
  }

  @discardableResult
  func moveDrag(to point: CGPoint) -> Bool {
    guard var current = drag, let map = engine.mapView, let style = map.style else { return false }
    guard point != current.point else { return current.moved }
    let dx = point.x - current.start.x
    let dy = point.y - current.start.y
    guard current.moved || hypot(dx, dy) > 3 else { return false }
    guard
      let geometry = Self.mapPositions(
        current.screenGeometry,
        transform: { vector in
          let coordinate = map.convert(
            CGPoint(x: vector[0] + dx, y: vector[1] + dy), toCoordinateFrom: map)
          guard coordinate.longitude.isFinite, coordinate.latitude.isFinite else { return nil }
          return [
            NativeCameraMath.wrap(coordinate.longitude), min(85, max(-85, coordinate.latitude)),
          ] + vector.dropFirst(2)
        }),
      engine.runtimeStyle.moveAnnotation(
        source: current.source, id: current.feature, to: geometry, style: style)
    else { return false }
    let started = !current.moved
    current.needsReport = !started
    current.moved = true
    current.geometry = geometry
    current.point = point
    drag = current
    if started { report(current, phase: "started") }
    return true
  }

  func endDrag(at point: CGPoint? = nil) {
    if let point, point != drag?.point { _ = moveDrag(to: point) }
    guard let current = drag else { return }
    drag = nil
    if current.moved { report(current, phase: "ended") }
  }

  private func reportPendingDrag() {
    guard var current = drag, current.needsReport else { return }
    current.needsReport = false
    drag = current
    report(current, phase: "moved")
  }

  private func report(_ drag: Drag, phase: String) {
    engine.onEvent?(
      "annotationDragged",
      .object([
        "phase": .string(phase), "layer": .string(drag.layer), "id": .string(drag.feature),
        "geometry": drag.geometry,
        "point": .object(["x": .number(drag.point.x), "y": .number(drag.point.y)]),
      ]))
  }

  private static func mapPositions(_ geometry: JSONValue, transform: ([Double]) -> [Double]?)
    -> JSONValue?
  {
    func walk(_ value: JSONValue) -> JSONValue? {
      guard let a = value.array else { return nil }
      if a.first?.number != nil {
        let coordinates = a.compactMap(\.number)
        guard coordinates.count == a.count, a.count >= 2, let result = transform(coordinates) else {
          return nil
        }
        return .array(result.map(JSONValue.number))
      }
      let children = a.compactMap(walk)
      return children.count == a.count ? .array(children) : nil
    }
    guard let type = geometry["type"], let coordinates = geometry["coordinates"].flatMap(walk)
    else { return nil }
    return .object(["type": type, "coordinates": coordinates])
  }

  func retire() {
    reportPendingDrag()
    drag = nil
    for button in buttons.values { button.removeFromSuperview() }
    buttons.removeAll()
    pins.removeAll()
    tracked.removeAll()
  }
}

private final class MarkerButton: UIButton {
  let dot = UIView(frame: CGRect(x: 10, y: 10, width: 24, height: 24))

  override init(frame: CGRect) {
    super.init(frame: frame)
    dot.isUserInteractionEnabled = false
    dot.layer.cornerRadius = 12
    dot.layer.borderWidth = 2
    dot.layer.borderColor = UIColor.white.cgColor
    dot.layer.shadowColor = UIColor.black.cgColor
    dot.layer.shadowOffset = CGSize(width: 0, height: 1)
    dot.layer.shadowRadius = 2
    dot.layer.shadowOpacity = 0.4
    addSubview(dot)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Not used.") }
}
