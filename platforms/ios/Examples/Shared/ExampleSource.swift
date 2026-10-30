import Foundation
import Tileflow

/// The value after a launch argument, such as `--map-id map_…`.
func launchArgument(_ flag: String) -> String? {
  let arguments = ProcessInfo.processInfo.arguments
  guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
    return nil
  }
  return arguments[index + 1]
}

/// Applications usually set `TileflowMapCredential` and `TileflowServicesCredential` in their
/// Info.plist. The examples also accept `--map-credential tf_public_…`,
/// `--services-credential tf_public_…` and `--api-origin https://…` launch arguments, which
/// replace the Info.plist configuration. Call it before showing a map or calling a service.
func configureExample() {
  let mapCredential = launchArgument("--map-credential")
  let servicesCredential = launchArgument("--services-credential")
  guard mapCredential != nil || servicesCredential != nil else { return }
  // An invalid value leaves the Info.plist configuration; the map then reports what is missing.
  guard
    let configuration = try? TileflowConfiguration(
      apiOrigin: launchArgument("--api-origin").flatMap(URL.init(string:))
        ?? TileflowConfiguration.defaultAPIOrigin,
      servicesCredential: servicesCredential.map(TileflowCredential.init),
      mapCredential: mapCredential.map(TileflowCredential.init))
  else { return }
  Tileflow.configure(configuration)
}

/// With `--map-id map_…`, a Hosted map that reads its credential from the configuration.
/// Otherwise the map in `--manifest`, by default the fixture that
/// `scripts/mobile-fixture-server.mjs` serves.
func exampleSource() -> TileflowMapSource {
  if let mapID = launchArgument("--map-id") { return .hosted(mapID: mapID) }
  let url = URL(string: launchArgument("--manifest") ?? "http://127.0.0.1:18645/manifest.json")!
  return TileflowMapSource(
    map: launchArgument("--map") ?? "fixture",
    manifestURL: url,
    allowsLoopbackHTTP: url.host == "127.0.0.1"
  )
}
