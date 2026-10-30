import Foundation

// Match SwiftPM's resource accessor when the same tests run in the hosted test target.
extension Bundle {
  static var module: Bundle { Bundle(for: TestBundle.self) }
}

private final class TestBundle {}
