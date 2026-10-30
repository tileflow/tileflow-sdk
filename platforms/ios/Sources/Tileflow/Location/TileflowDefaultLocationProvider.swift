import CoreLocation
import Foundation
import UIKit

/// Whether the application may use the device's location.
public enum TileflowLocationAuthorization: String, Sendable {
  /// The person has not been asked yet.
  case notDetermined
  /// The person declined, or turned location services off.
  case denied
  /// Something other than the person, such as parental controls, prevents access.
  case restricted
  /// Allowed while the application is in use.
  case whenInUse
  /// Allowed at any time. The SDK never asks for it; the application may.
  case always

  /// Whether the application may measure the location now.
  public var allowsLocation: Bool { self == .whenInUse || self == .always }

  init(_ status: CLAuthorizationStatus) {
    switch status {
    case .notDetermined: self = .notDetermined
    case .restricted: self = .restricted
    case .denied: self = .denied
    case .authorizedAlways: self = .always
    case .authorizedWhenInUse: self = .whenInUse
    @unknown default: self = .denied
    }
  }
}

/// How precisely the application may know the location.
public enum TileflowLocationAccuracy: String, Sendable {
  /// The precise location.
  case full
  /// An approximate location, within a few kilometres.
  case reduced
}

/// Asks for and reads the application's access to the device's location.
///
/// The SDK never asks on its own: call ``requestWhenInUse()`` in response to something the person
/// does, such as tapping a location button. The application's Info.plist must describe why it
/// needs the location with `NSLocationWhenInUseUsageDescription`. The SDK never asks for access in
/// the background.
@MainActor
public enum TileflowLocationPermissions {
  /// The application's current access.
  public static var authorization: TileflowLocationAuthorization {
    TileflowLocationAuthorization(PermissionRequester.shared.manager.authorizationStatus)
  }

  /// Whether the application may know the precise location or an approximate one.
  public static var accuracy: TileflowLocationAccuracy {
    PermissionRequester.shared.manager.accuracyAuthorization == .fullAccuracy ? .full : .reduced
  }

  /// Asks for access while the application is in use and returns the person's answer. When the
  /// person has already answered, it returns the current access without asking again.
  @discardableResult
  public static func requestWhenInUse() async -> TileflowLocationAuthorization {
    await PermissionRequester.shared.requestWhenInUse()
  }

  /// Asks the person for the precise location once, while the application keeps reduced accuracy.
  /// `purposeKey` names an entry of `NSLocationTemporaryUsageDescriptionDictionary` in the
  /// Info.plist that explains why. Returns the accuracy afterwards; full accuracy lasts until the
  /// application is no longer in use.
  @discardableResult
  public static func requestFullAccuracy(purposeKey: String) async -> TileflowLocationAccuracy {
    await PermissionRequester.shared.requestFullAccuracy(purposeKey: purposeKey)
  }
}

/// Owns the location manager that asks for access, and waits for the person's answer.
@MainActor
final class PermissionRequester: NSObject, CLLocationManagerDelegate {
  static let shared = PermissionRequester()
  let manager = CLLocationManager()
  private var waiting: [CheckedContinuation<TileflowLocationAuthorization, Never>] = []

  override init() {
    super.init()
    manager.delegate = self
  }

  func requestWhenInUse() async -> TileflowLocationAuthorization {
    guard manager.authorizationStatus == .notDetermined else {
      return TileflowLocationAuthorization(manager.authorizationStatus)
    }
    return await withCheckedContinuation { continuation in
      waiting.append(continuation)
      manager.requestWhenInUseAuthorization()
    }
  }

  func requestFullAccuracy(purposeKey: String) async -> TileflowLocationAccuracy {
    guard manager.accuracyAuthorization != .fullAccuracy,
      TileflowLocationAuthorization(manager.authorizationStatus).allowsLocation
    else { return TileflowLocationPermissions.accuracy }
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      manager.requestTemporaryFullAccuracyAuthorization(withPurposeKey: purposeKey) { _ in
        continuation.resume()
      }
    }
    return TileflowLocationPermissions.accuracy
  }

  nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    let status = manager.authorizationStatus
    MainActor.assumeIsolated {
      // The first callback reports the status before the person answers.
      guard status != .notDetermined else { return }
      for continuation in waiting {
        continuation.resume(returning: TileflowLocationAuthorization(status))
      }
      waiting.removeAll()
    }
  }
}

/// The SDK's provider: CoreLocation, measuring only while a map or another consumer needs it and
/// the application has access.
///
/// It reports the most precise location the application may know, and the device's heading where
/// the device has a compass. It asks for no access by itself; see ``TileflowLocationPermissions``.
/// It never measures in the background.
@MainActor
public final class TileflowDefaultLocationProvider: NSObject, TileflowLocationProvider,
  CLLocationManagerDelegate
{
  private let manager = CLLocationManager()
  private var consumers = LocationConsumers()
  private var updating = false

  /// The latest position the provider reported.
  public private(set) var latestLocation: TileflowLocation?
  /// The latest heading the provider reported.
  public private(set) var latestHeading: TileflowHeading?

  /// The smallest movement, in metres, that produces a new position. 0 reports every change.
  public var distanceFilter: Double = 0 {
    didSet { manager.distanceFilter = distanceFilter > 0 ? distanceFilter : kCLDistanceFilterNone }
  }

  /// The smallest turn, in degrees, that produces a new heading.
  public var headingFilter: Double = 1 {
    didSet { manager.headingFilter = headingFilter }
  }

  public override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.headingFilter = headingFilter
    NotificationCenter.default.addObserver(
      self, selector: #selector(orientationChanged),
      name: UIDevice.orientationDidChangeNotification, object: nil)
  }

  public func addConsumer(_ consumer: any TileflowLocationConsumer) {
    guard consumers.add(consumer) else { return }
    if let latestLocation { consumer.locationUpdated(latestLocation) }
    if let latestHeading { consumer.headingUpdated(latestHeading) }
    update()
  }

  public func removeConsumer(_ consumer: any TileflowLocationConsumer) {
    consumers.remove(consumer)
    update()
  }

  /// Measures while there are consumers and access; stops otherwise.
  private func update() {
    let allowed = TileflowLocationAuthorization(manager.authorizationStatus).allowsLocation
    let wanted = !consumers.isEmpty && allowed
    guard wanted != updating else { return }
    updating = wanted
    if wanted {
      UIDevice.current.beginGeneratingDeviceOrientationNotifications()
      orientationChanged()
      manager.startUpdatingLocation()
      if CLLocationManager.headingAvailable() { manager.startUpdatingHeading() }
    } else {
      UIDevice.current.endGeneratingDeviceOrientationNotifications()
      manager.stopUpdatingLocation()
      manager.stopUpdatingHeading()
    }
  }

  /// The heading follows the top of the screen, whichever way the device is turned.
  @objc private func orientationChanged() {
    switch UIDevice.current.orientation {
    case .portrait: manager.headingOrientation = .portrait
    case .portraitUpsideDown: manager.headingOrientation = .portraitUpsideDown
    case .landscapeLeft: manager.headingOrientation = .landscapeLeft
    case .landscapeRight: manager.headingOrientation = .landscapeRight
    default: break
    }
  }

  nonisolated public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    MainActor.assumeIsolated { update() }
  }

  nonisolated public func locationManager(
    _ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]
  ) {
    let fixes = locations.compactMap(TileflowLocation.init)
    MainActor.assumeIsolated {
      guard let fix = fixes.last else { return }
      latestLocation = fix
      for consumer in consumers.all { consumer.locationUpdated(fix) }
    }
  }

  nonisolated public func locationManager(
    _ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading
  ) {
    guard newHeading.headingAccuracy >= 0 else { return }
    let heading = TileflowHeading(
      direction: newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading,
      accuracy: newHeading.headingAccuracy, timestamp: newHeading.timestamp)
    MainActor.assumeIsolated {
      latestHeading = heading
      for consumer in consumers.all { consumer.headingUpdated(heading) }
    }
  }

  nonisolated public func locationManager(
    _ manager: CLLocationManager, didFailWithError error: any Error
  ) {
    // CoreLocation keeps trying after a temporary failure; denied access arrives as a change.
  }
}
