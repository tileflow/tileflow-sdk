import CoreLocation
import MapLibre

/// MapLibre receives only the fixes supplied by the map's TileflowLocationProvider.
@MainActor
final class NativeLocationManager: NSObject, @preconcurrency MLNLocationManager {
  weak var delegate: (any MLNLocationManagerDelegate)?
  // This adapter only replays application data. The app's provider manages device access.
  let authorizationStatus = CLAuthorizationStatus.authorizedWhenInUse
  var headingOrientation = CLDeviceOrientation.unknown
  private(set) var fix: CLLocation?
  private(set) var heading: CLHeading?

  func requestAlwaysAuthorization() {}
  func requestWhenInUseAuthorization() {}
  func dismissHeadingCalibrationDisplay() {}

  func startUpdatingLocation() { sendFix() }
  func stopUpdatingLocation() {}
  func startUpdatingHeading() { sendHeading() }
  func stopUpdatingHeading() {}

  func set(fix: CLLocation?) {
    self.fix = fix
    sendFix()
  }

  func set(direction: Double?) {
    heading = direction.map(ProviderHeading.init)
    sendHeading()
  }

  private func sendFix() {
    if let fix { delegate?.locationManager(self, didUpdate: [fix]) }
  }

  func sendHeading() {
    if let heading { delegate?.locationManager(self, didUpdate: heading) }
  }
}

/// Core Location has no public initializer for a heading supplied by an application.
private final class ProviderHeading: CLHeading, @unchecked Sendable {
  private let degrees: Double
  private let observed = Date()

  init(_ degrees: Double) {
    self.degrees = degrees
    super.init()
  }
  required init?(coder: NSCoder) { nil }
  override var trueHeading: CLLocationDirection { degrees }
  override var magneticHeading: CLLocationDirection { degrees }
  override var headingAccuracy: CLLocationDirection { 0 }
  override var timestamp: Date { observed }
}
