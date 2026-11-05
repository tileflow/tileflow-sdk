import MapLibre
import UIKit

/// MapLibre owns the position and motion of this annotation. Options change its appearance.
@MainActor
final class NativeLocationPuck: MLNUserLocationAnnotationView {
  private let ground = CALayer()
  private let uncertainty = CAShapeLayer()
  private let cone = CAShapeLayer()
  private let dot = CALayer()
  private var state = State()

  struct State {
    var showsPuck = true
    var accuracy: Double?
    var direction: Double?
    var stale = false
  }

  init() {
    super.init(reuseIdentifier: nil)
    bounds = CGRect(x: 0, y: 0, width: 20, height: 20)
    ground.position = CGPoint(x: 10, y: 10)
    layer.addSublayer(ground)
    uncertainty.lineWidth = 1
    ground.addSublayer(uncertainty)
    let fan = UIBezierPath()
    fan.move(to: .zero)
    fan.addArc(
      withCenter: .zero, radius: 28, startAngle: -.pi * 0.72, endAngle: -.pi * 0.28, clockwise: true
    )
    fan.close()
    cone.path = fan.cgPath
    ground.addSublayer(cone)
    dot.frame = bounds
    dot.cornerRadius = 10
    dot.borderWidth = 3
    dot.borderColor = UIColor.white.cgColor
    layer.addSublayer(dot)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Not used.") }

  func apply(_ state: State) {
    self.state = state
    ground.isHidden = !state.showsPuck
    dot.isHidden = !state.showsPuck
    accessibilityElementsHidden = !state.showsPuck
    update()
  }

  override func update() {
    guard let mapView, let location = userLocation?.location else { return }
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    defer { CATransaction.commit() }
    let color =
      state.stale
      ? UIColor(red: 142 / 255, green: 142 / 255, blue: 147 / 255, alpha: 1)
      : UIColor(red: 26 / 255, green: 115 / 255, blue: 232 / 255, alpha: 1)
    dot.backgroundColor = color.cgColor
    ground.transform = CATransform3DMakeRotation(mapView.camera.pitch * .pi / 180, 1, 0, 0)

    let scale = mapView.metersPerPoint(atLatitude: location.coordinate.latitude)
    if let accuracy = state.accuracy, accuracy > 0, scale > 0 {
      let radius = accuracy / scale
      uncertainty.path =
        UIBezierPath(ovalIn: CGRect(x: -radius, y: -radius, width: radius * 2, height: radius * 2))
        .cgPath
      uncertainty.fillColor = color.withAlphaComponent(0.12).cgColor
      uncertainty.strokeColor = color.withAlphaComponent(0.3).cgColor
      uncertainty.isHidden = false
    } else {
      uncertainty.isHidden = true
    }
    if let direction = state.direction {
      cone.fillColor = color.withAlphaComponent(state.stale ? 0.25 : 0.6).cgColor
      cone.setAffineTransform(
        CGAffineTransform(rotationAngle: (direction - mapView.direction) * .pi / 180))
      cone.isHidden = false
    } else {
      cone.isHidden = true
    }
  }
}
