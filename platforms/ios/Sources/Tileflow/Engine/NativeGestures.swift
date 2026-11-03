import MapLibre
import UIKit

/// What a person does on a map that MapLibre Native draws: which gestures move the camera, taps
/// and long presses with their coordinate, double taps that zoom by the chosen amount, the end of
/// each gesture, and the hint of cooperative gestures.
///
/// MapLibre's own recognizers pan, pinch, rotate, tilt and zoom on double taps. The SDK turns them
/// on and off, listens to them to learn when a person lifts their fingers, and adds its own
/// recognizers for taps, long presses, double taps of another amount and the hint. A tap waits
/// until no double tap, quick zoom or long press can claim the touch, so it is never part of one.
@MainActor
final class NativeGestures: NSObject, UIGestureRecognizerDelegate {
  /// How long a press must hold still before it is a long press, as on the web.
  static let longPressDuration: TimeInterval = 0.5
  /// How far a touch may move, in points, before it is no longer a press.
  static let slop: CGFloat = 10
  static let hintText = "Use two fingers to move the map"

  private weak var mapView: MLNMapView?
  private weak var camera: NativeCamera?
  private let emit: (String, JSONValue) -> Void
  let tap = UITapGestureRecognizer()
  let longPress = UILongPressGestureRecognizer()
  /// A double tap that zooms by an amount other than MapLibre's single level.
  let doubleTap = UITapGestureRecognizer()
  /// One finger trying to move a map with cooperative gestures.
  let hintPan = UIPanGestureRecognizer()
  /// MapLibre's double tap that zooms in and two-finger tap that zooms out.
  private var zoomTaps: [UITapGestureRecognizer] = []
  /// MapLibre's continuous recognizers and the gesture each makes.
  private var tracked: [(UIGestureRecognizer, TileflowGesture)] = []
  private(set) var settings = TileflowGestures()
  /// The hint of cooperative gestures, centred over the map.
  let hint = UIView()
  private let hintLabel = UILabel()
  private var hintTimer: Task<Void, Never>?

  init(
    mapView: MLNMapView, container: UIView, camera: NativeCamera,
    emit: @escaping (String, JSONValue) -> Void
  ) {
    self.mapView = mapView
    self.camera = camera
    self.emit = emit
    super.init()
    var quickZoom: [UIGestureRecognizer] = []
    for recognizer in mapView.gestureRecognizers ?? [] {
      switch recognizer {
      case let tap as UITapGestureRecognizer
      where tap.numberOfTapsRequired == 2 || tap.numberOfTouchesRequired == 2:
        zoomTaps.append(tap)
      case is UIPinchGestureRecognizer: tracked.append((recognizer, .zoom))
      case is UIRotationGestureRecognizer: tracked.append((recognizer, .rotate))
      case let pan as UIPanGestureRecognizer:
        tracked.append((pan, pan.minimumNumberOfTouches >= 2 ? .pitch : .pan))
      case let press as UILongPressGestureRecognizer:
        // MapLibre's quick zoom: tap, then hold and drag up or down.
        tracked.append((press, .zoom))
        quickZoom.append(press)
      default: break
      }
    }
    for (recognizer, _) in tracked {
      recognizer.addTarget(self, action: #selector(trackedChanged(_:)))
    }
    tap.addTarget(self, action: #selector(tapped(_:)))
    longPress.addTarget(self, action: #selector(pressed(_:)))
    longPress.minimumPressDuration = Self.longPressDuration
    longPress.allowableMovement = Self.slop
    doubleTap.addTarget(self, action: #selector(doubleTapped(_:)))
    doubleTap.numberOfTapsRequired = 2
    doubleTap.isEnabled = false
    hintPan.addTarget(self, action: #selector(hinted(_:)))
    hintPan.maximumNumberOfTouches = 1
    hintPan.isEnabled = false
    tap.require(toFail: longPress)
    tap.require(toFail: doubleTap)
    for other in zoomTaps where other.numberOfTapsRequired == 2 { tap.require(toFail: other) }
    for other in quickZoom { tap.require(toFail: other) }
    for recognizer in [tap, longPress, doubleTap, hintPan] as [UIGestureRecognizer] {
      recognizer.delegate = self
      recognizer.cancelsTouchesInView = false
      mapView.addGestureRecognizer(recognizer)
    }

    hintLabel.text = Self.hintText
    hintLabel.textAlignment = .center
    hintLabel.numberOfLines = 0
    hintLabel.font = .preferredFont(forTextStyle: .subheadline)
    hintLabel.adjustsFontForContentSizeCategory = true
    hintLabel.textColor = .white
    hintLabel.translatesAutoresizingMaskIntoConstraints = false
    hint.backgroundColor = UIColor.black.withAlphaComponent(0.65)
    hint.layer.cornerRadius = 8
    hint.alpha = 0
    hint.isUserInteractionEnabled = false
    hint.isAccessibilityElement = false
    hint.translatesAutoresizingMaskIntoConstraints = false
    hint.addSubview(hintLabel)
    container.addSubview(hint)
    NSLayoutConstraint.activate([
      hintLabel.leadingAnchor.constraint(equalTo: hint.leadingAnchor, constant: 16),
      hintLabel.trailingAnchor.constraint(equalTo: hint.trailingAnchor, constant: -16),
      hintLabel.topAnchor.constraint(equalTo: hint.topAnchor, constant: 10),
      hintLabel.bottomAnchor.constraint(equalTo: hint.bottomAnchor, constant: -10),
      hint.centerXAnchor.constraint(equalTo: container.centerXAnchor),
      hint.centerYAnchor.constraint(equalTo: container.centerYAnchor),
      hint.widthAnchor.constraint(lessThanOrEqualTo: container.widthAnchor, constant: -48),
    ])
  }

  /// Turns gestures on and off as the view's options say.
  func apply(_ value: JSONValue?) {
    guard let mapView else { return }
    var gestures = TileflowGestures()
    if let value {
      gestures = TileflowGestures(
        pan: value["pan"]?.bool ?? true, zoom: value["zoom"]?.bool ?? true,
        rotate: value["rotate"]?.bool ?? true, pitch: value["pitch"]?.bool ?? true,
        doubleTapZoom: value["doubleTapZoom"]?.bool ?? true,
        doubleTapZoomDelta: value["doubleTapZoomDelta"]?.number ?? 1,
        cooperative: value["cooperative"]?.bool ?? false)
    }
    settings = gestures
    // With cooperative gestures one finger leaves the map; two fingers pan it as they pinch.
    mapView.isScrollEnabled = gestures.pan && !gestures.cooperative
    // MapLibre turns its double tap, two-finger tap, pinch and quick zoom on with zoom.
    mapView.isZoomEnabled = gestures.zoom
    mapView.isRotateEnabled = gestures.rotate
    mapView.isPitchEnabled = gestures.pitch
    let taps = gestures.zoom && gestures.doubleTapZoom
    for recognizer in zoomTaps {
      recognizer.isEnabled =
        taps && (recognizer.numberOfTapsRequired != 2 || gestures.doubleTapZoomDelta == 1)
    }
    doubleTap.isEnabled = taps && gestures.doubleTapZoomDelta != 1
    hintPan.isEnabled = gestures.cooperative && gestures.pan
    if !hintPan.isEnabled { hideHint(animated: false) }
  }

  // MARK: Recognizers

  @objc func tapped(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    report("tap", at: recognizer.location(in: mapView))
  }

  @objc func pressed(_ recognizer: UILongPressGestureRecognizer) {
    guard recognizer.state == .began else { return }
    report("longPress", at: recognizer.location(in: mapView))
  }

  @objc func doubleTapped(_ recognizer: UITapGestureRecognizer) {
    guard recognizer.state == .ended else { return }
    camera?.zoom(by: settings.doubleTapZoomDelta, around: recognizer.location(in: mapView))
  }

  @objc func hinted(_ recognizer: UIPanGestureRecognizer) {
    guard recognizer.state == .began else { return }
    showHint()
  }

  @objc private func trackedChanged(_ recognizer: UIGestureRecognizer) {
    guard [.ended, .cancelled, .failed].contains(recognizer.state),
      let gesture = tracked.first(where: { $0.0 === recognizer })?.1
    else { return }
    camera?.gestureEnded(gesture)
  }

  private func report(_ event: String, at point: CGPoint) {
    guard let coordinate = camera?.coordinate(at: point) else { return }
    emit(
      event,
      .object([
        "coordinate": .object([
          "longitude": .number(coordinate.longitude), "latitude": .number(coordinate.latitude),
        ]),
        "point": .object(["x": .number(point.x), "y": .number(point.y)]),
      ]))
  }

  // MARK: Hint

  func showHint() {
    hintTimer?.cancel()
    UIView.animate(withDuration: 0.2) { self.hint.alpha = 1 }
    hintTimer = Task { @MainActor [weak self] in
      try? await Task.sleep(for: .milliseconds(1500))
      guard !Task.isCancelled else { return }
      self?.hideHint(animated: true)
    }
  }

  private func hideHint(animated: Bool) {
    hintTimer?.cancel()
    hintTimer = nil
    guard hint.alpha > 0 else { return }
    if animated {
      UIView.animate(withDuration: 0.3) { self.hint.alpha = 0 }
    } else {
      hint.alpha = 0
    }
  }

  func retire() {
    hintTimer?.cancel()
    hintTimer = nil
  }

  // MARK: UIGestureRecognizerDelegate

  nonisolated func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool { true }
}
