import UIKit

/// A corner of the map. Leading and trailing follow the layout direction.
public enum TileflowControlPosition: String, CaseIterable, Sendable {
  case topLeading, topTrailing, bottomLeading, bottomTrailing

  var isTop: Bool { self == .topLeading || self == .topTrailing }
  var isLeading: Bool { self == .topLeading || self == .bottomLeading }

  /// The renderer's name for the corner.
  func corner(rightToLeft: Bool) -> String {
    "\(isTop ? "top" : "bottom")-\(isLeading != rightToLeft ? "left" : "right")"
  }
}

public enum TileflowCompassVisibility: Sendable {
  /// Shown while the map is turned away from north.
  case adaptive
  case visible
  case hidden
}

public enum TileflowScaleBarUnits: Sendable {
  /// Miles and feet where the region uses them, otherwise kilometres and metres.
  case automatic
  case metric
  case imperial
}

/// The map's native controls. They stay inside the map's content insets, so system bars and
/// sheets never cover them. The attribution is always shown; only its corner can change.
public struct TileflowMapControls: Equatable, Sendable {
  public var compass: TileflowCompassVisibility
  public var compassPosition: TileflowControlPosition
  public var scaleBar: Bool
  public var scaleBarPosition: TileflowControlPosition
  public var scaleBarUnits: TileflowScaleBarUnits
  /// A button that recenters the map. While the map shows the person's location it follows the
  /// location, and turns between following the position and the heading; otherwise it reports
  /// ``TileflowMapEvent/recenterRequested`` and the application decides where the camera goes.
  public var recenterButton: Bool
  public var recenterButtonPosition: TileflowControlPosition
  public var attributionPosition: TileflowControlPosition

  public init(
    compass: TileflowCompassVisibility = .adaptive,
    compassPosition: TileflowControlPosition = .topTrailing, scaleBar: Bool = false,
    scaleBarPosition: TileflowControlPosition = .bottomLeading,
    scaleBarUnits: TileflowScaleBarUnits = .automatic, recenterButton: Bool = false,
    recenterButtonPosition: TileflowControlPosition = .bottomTrailing,
    attributionPosition: TileflowControlPosition = .bottomTrailing
  ) {
    self.compass = compass
    self.compassPosition = compassPosition
    self.scaleBar = scaleBar
    self.scaleBarPosition = scaleBarPosition
    self.scaleBarUnits = scaleBarUnits
    self.recenterButton = recenterButton
    self.recenterButtonPosition = recenterButtonPosition
    self.attributionPosition = attributionPosition
  }

  /// Whether the controls follow the camera while it moves.
  var followCamera: Bool { compass != .hidden || scaleBar }
}

/// The length and label of a scale bar.
struct ScaleBarMeasure: Equatable {
  /// The distance the bar shows, in metres.
  let meters: Double
  let unit: UnitLength
  /// The distance in `unit`.
  let value: Double
  /// The bar's length in points.
  let length: Double

  /// The longest round distance (1, 2 or 5 times a power of ten) that fits in `maximumLength`
  /// points at the camera's centre. MapLibre draws the world 512 points wide at zoom 0.
  init(camera: TileflowCamera, maximumLength: Double, imperial: Bool) {
    let metersPerPoint =
      40_075_016.686 * cos(camera.latitude * .pi / 180) / (512 * pow(2, camera.zoom))
    let maximum = maximumLength * metersPerPoint
    let round = { (value: Double) -> Double in
      let power = pow(10, floor(log10(value)))
      return [5, 2, 1].map { $0 * power }.first { $0 <= value } ?? power
    }
    let (unit, perUnit): (UnitLength, Double) =
      imperial
      ? (maximum >= 1609.344 ? (.miles, 1609.344) : (.feet, 0.3048))
      : (maximum >= 1000 ? (.kilometers, 1000) : (.meters, 1))
    value = round(maximum / perUnit)
    meters = value * perUnit
    self.unit = unit
    length = meters / metersPerPoint
  }
}

/// Native controls drawn over the renderer. Touches anywhere but on a control reach the map.
@MainActor
final class MapControlsView: UIView {
  /// Space kept free for the attribution in its corner.
  static let attributionSpace: CGFloat = 36
  static let margin: CGFloat = 8

  let compass = CompassButton()
  let scaleBar = ScaleBarView()
  let recenter = UIButton(type: .system)
  var onCompass: (() -> Void)?
  var onRecenter: (() -> Void)?
  var controls = TileflowMapControls() {
    didSet { update() }
  }
  var camera: TileflowCamera? {
    didSet { update() }
  }
  /// Whether the map shows the location, so the recenter button follows it.
  var locationShown = false {
    didSet { if locationShown != oldValue { updateRecenter() } }
  }
  var followMode: TileflowFollowMode = .none {
    didSet { if followMode != oldValue { updateRecenter() } }
  }
  var insets: UIEdgeInsets = .zero {
    didSet { if insets != oldValue { setNeedsLayout() } }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .clear
    compass.addAction(UIAction { [weak self] _ in self?.onCompass?() }, for: .primaryActionTriggered)
    updateRecenter()
    recenter.addAction(
      UIAction { [weak self] _ in self?.onRecenter?() }, for: .primaryActionTriggered)
    for control in [compass, recenter] as [UIView] {
      control.backgroundColor = .systemBackground.withAlphaComponent(0.92)
      control.layer.cornerRadius = 22
      control.layer.shadowColor = UIColor.black.cgColor
      control.layer.shadowOpacity = 0.2
      control.layer.shadowRadius = 3
      control.layer.shadowOffset = CGSize(width: 0, height: 1)
    }
    for control in [compass, scaleBar, recenter] as [UIView] {
      control.isHidden = true
      addSubview(control)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Created by TileflowMapView.") }

  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    subviews.contains {
      !$0.isHidden && $0.isUserInteractionEnabled && $0.frame.insetBy(dx: -4, dy: -4).contains(point)
    }
  }

  /// The recenter button shows whether, and how, the camera follows the location.
  private func updateRecenter() {
    let symbol: String
    switch (locationShown, followMode) {
    case (false, _), (true, .position): symbol = "location.fill"
    case (true, .none): symbol = "location"
    case (true, .heading), (true, .course): symbol = "location.north.line.fill"
    }
    recenter.setImage(UIImage(systemName: symbol), for: .normal)
    recenter.accessibilityLabel = locationShown ? "My location" : "Recenter map"
    switch (locationShown, followMode) {
    case (false, _), (true, .none): recenter.accessibilityValue = nil
    case (true, .position): recenter.accessibilityValue = "Following"
    case (true, .heading): recenter.accessibilityValue = "Following with heading"
    case (true, .course): recenter.accessibilityValue = "Following with course"
    }
  }

  private func update() {
    guard let camera else {
      for control in subviews { control.isHidden = true }
      return
    }
    compass.bearing = camera.bearing
    let turned = abs(camera.bearing.truncatingRemainder(dividingBy: 360)) >= 0.5
    compass.isHidden =
      controls.compass == .hidden || (controls.compass == .adaptive && !turned)
    scaleBar.isHidden = !controls.scaleBar
    if controls.scaleBar {
      let imperial: Bool
      switch controls.scaleBarUnits {
      case .metric: imperial = false
      case .imperial: imperial = true
      case .automatic:
        imperial = [.us, .uk].contains(Locale.current.measurementSystem)
      }
      scaleBar.measure = ScaleBarMeasure(camera: camera, maximumLength: 100, imperial: imperial)
    }
    recenter.isHidden = !controls.recenterButton
    setNeedsLayout()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let rightToLeft = effectiveUserInterfaceLayoutDirection == .rightToLeft
    let area = bounds.inset(by: insets).insetBy(dx: Self.margin, dy: Self.margin)
    var offsets: [TileflowControlPosition: CGFloat] = [controls.attributionPosition: Self.attributionSpace]
    for (control, position, size) in [
      (compass as UIView, controls.compassPosition, CGSize(width: 44, height: 44)),
      (recenter, controls.recenterButtonPosition, CGSize(width: 44, height: 44)),
      (scaleBar, controls.scaleBarPosition, scaleBar.intrinsicContentSize),
    ] where !control.isHidden {
      let offset = offsets[position, default: 0]
      let left = position.isLeading != rightToLeft
      control.frame = CGRect(
        x: left ? area.minX : area.maxX - size.width,
        y: position.isTop ? area.minY + offset : area.maxY - offset - size.height,
        width: size.width, height: size.height)
      offsets[position] = offset + size.height + Self.margin
    }
  }
}

/// A needle that points north and turns the map to north when tapped.
@MainActor
final class CompassButton: UIControl {
  private let needle = CALayer()

  var bearing: Double = 0 {
    didSet {
      CATransaction.begin()
      CATransaction.setDisableActions(true)
      needle.setAffineTransform(CGAffineTransform(rotationAngle: -bearing * .pi / 180))
      CATransaction.commit()
      accessibilityValue = "Heading \(Int(((bearing.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360).rounded())) degrees"
    }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isAccessibilityElement = true
    accessibilityLabel = "Compass"
    accessibilityHint = "Turns the map to north."
    accessibilityTraits = .button
    needle.frame = CGRect(x: 0, y: 0, width: 44, height: 44)
    for (points, color) in [
      ([CGPoint(x: 22, y: 8), CGPoint(x: 27, y: 22), CGPoint(x: 17, y: 22)], UIColor.systemRed),
      ([CGPoint(x: 17, y: 22), CGPoint(x: 27, y: 22), CGPoint(x: 22, y: 36)], UIColor.systemGray),
    ] {
      let path = UIBezierPath()
      path.move(to: points[0])
      for point in points.dropFirst() { path.addLine(to: point) }
      path.close()
      let shape = CAShapeLayer()
      shape.path = path.cgPath
      shape.fillColor = color.cgColor
      needle.addSublayer(shape)
    }
    layer.addSublayer(needle)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Created by TileflowMapView.") }
}

/// A bar of a round length with its distance, measured at the camera's centre.
@MainActor
final class ScaleBarView: UIView {
  private let label = UILabel()
  private let bar = CAShapeLayer()

  var measure: ScaleBarMeasure? {
    didSet {
      guard let measure, measure != oldValue else { return }
      let distance = Measurement(value: measure.value, unit: measure.unit)
      let formatter = MeasurementFormatter()
      formatter.unitOptions = .providedUnit
      formatter.numberFormatter.maximumFractionDigits = 2
      formatter.unitStyle = .short
      label.text = formatter.string(from: distance)
      formatter.unitStyle = .long
      accessibilityValue = formatter.string(from: distance)
      invalidateIntrinsicContentSize()
      superview?.setNeedsLayout()
      setNeedsLayout()
    }
  }

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false
    isAccessibilityElement = true
    accessibilityLabel = "Map scale"
    label.font = .systemFont(ofSize: 11, weight: .medium)
    label.textColor = .label
    label.shadowColor = .systemBackground
    label.shadowOffset = CGSize(width: 0, height: 1)
    addSubview(label)
    bar.fillColor = nil
    bar.strokeColor = UIColor.label.cgColor
    bar.lineWidth = 2
    layer.addSublayer(bar)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Created by TileflowMapView.") }

  override var intrinsicContentSize: CGSize {
    let text = label.intrinsicContentSize
    return CGSize(width: max(CGFloat(measure?.length ?? 0), text.width), height: text.height + 6)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let text = label.intrinsicContentSize
    label.frame = CGRect(origin: .zero, size: text)
    let length = CGFloat(measure?.length ?? 0)
    let path = UIBezierPath()
    path.move(to: CGPoint(x: 1, y: text.height))
    path.addLine(to: CGPoint(x: 1, y: text.height + 5))
    path.addLine(to: CGPoint(x: length - 1, y: text.height + 5))
    path.addLine(to: CGPoint(x: length - 1, y: text.height))
    bar.path = path.cgPath
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    bar.strokeColor = UIColor.label.resolvedColor(with: traitCollection).cgColor
  }
}
