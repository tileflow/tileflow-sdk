import Foundation
import Tileflow

func exampleSource() -> TileflowMapSource {
  let arguments = ProcessInfo.processInfo.arguments
  func value(after flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag), index + 1 < arguments.count else {
      return nil
    }
    return arguments[index + 1]
  }
  let url = URL(string: value(after: "--manifest") ?? "http://127.0.0.1:18645/manifest.json")!
  return TileflowMapSource(
    map: value(after: "--map") ?? "fixture",
    manifestURL: url,
    allowsLoopbackHTTP: url.host == "127.0.0.1"
  )
}
