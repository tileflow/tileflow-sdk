import Foundation
import UIKit

/// Where the fixture server listens and where evidence files go. With `xcodebuild`, pass
/// `TEST_RUNNER_TILEFLOW_FIXTURE_PORT` and `TEST_RUNNER_NATIVE_ENGINE_EVIDENCE_DIR`.
enum SpikeEnvironment {
  static let port = ProcessInfo.processInfo.environment["TILEFLOW_FIXTURE_PORT"] ?? "18681"
  static let origin = "http://127.0.0.1:\(port)"

  static var evidenceDirectory: URL {
    let path =
      ProcessInfo.processInfo.environment["NATIVE_ENGINE_EVIDENCE_DIR"]
      ?? FileManager.default.temporaryDirectory.appendingPathComponent("native-engine-evidence").path
    let url = URL(fileURLWithPath: path, isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  static func write(_ text: String, to name: String) {
    try? Data(text.utf8).write(to: evidenceDirectory.appendingPathComponent(name))
  }

  static func write(_ image: UIImage, to name: String) {
    try? image.pngData()?.write(to: evidenceDirectory.appendingPathComponent(name))
  }

  static func json(_ value: Any) -> String {
    guard
      let data = try? JSONSerialization.data(
        withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    else { return "\(value)" }
    return String(decoding: data, as: UTF8.self)
  }

  static var device: String {
    let environment = ProcessInfo.processInfo.environment
    return [
      environment["SIMULATOR_MODEL_IDENTIFIER"], environment["SIMULATOR_DEVICE_NAME"],
      UIDevice.current.systemName + " " + UIDevice.current.systemVersion,
    ].compactMap { $0 }.joined(separator: ", ")
  }
}
