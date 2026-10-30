import Foundation

/// The map fixture that `scripts/mobile-fixture-server.mjs` serves. `TILEFLOW_FIXTURE_PORT` moves
/// it off its default port, for example when several suites run on one machine; with
/// `xcodebuild`, pass it as `TEST_RUNNER_TILEFLOW_FIXTURE_PORT`.
enum FixtureServer {
  static let origin =
    "http://127.0.0.1:\(ProcessInfo.processInfo.environment["TILEFLOW_FIXTURE_PORT"] ?? "18645")"
  static let manifest = URL(string: "\(origin)/manifest.json")!
}
