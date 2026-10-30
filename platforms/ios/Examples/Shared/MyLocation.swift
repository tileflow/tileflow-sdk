import Foundation
import Tileflow

/// Asks for the location while the app is in use, then once for the precise location if the
/// person shared only an approximate one. Returns whether the map may show the location.
///
/// The Info.plist explains why in `NSLocationWhenInUseUsageDescription`, and why the precise
/// location helps in the `FollowLocation` entry of `NSLocationTemporaryUsageDescriptionDictionary`.
@MainActor
func requestLocationAccess() async -> Bool {
  guard await TileflowLocationPermissions.requestWhenInUse().allowsLocation else { return false }
  if TileflowLocationPermissions.accuracy == .reduced {
    await TileflowLocationPermissions.requestFullAccuracy(purposeKey: "FollowLocation")
  }
  return true
}

/// With `--simulate-location`, a walk through central Madrid instead of the device's location,
/// for the simulator and for demonstrations.
@MainActor
func exampleLocationProvider() -> (any TileflowLocationProvider)? {
  guard ProcessInfo.processInfo.arguments.contains("--simulate-location") else { return nil }
  return TileflowSimulatedLocationProvider(
    route: [
      .init(longitude: -3.7038, latitude: 40.4168), .init(longitude: -3.6996, latitude: 40.4180),
      .init(longitude: -3.6922, latitude: 40.4194), .init(longitude: -3.6884, latitude: 40.4153),
    ], speed: 6, loops: true)
}
