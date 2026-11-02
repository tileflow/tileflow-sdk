import Foundation
import MapLibre

/// MapLibre's warnings and errors, as its logging handler reports them.
enum EngineLog {
  private static let lock = NSLock()
  private static var messages: [String] = []

  static func install() {
    MLNLoggingConfiguration.shared.loggingLevel = .warning
    MLNLoggingConfiguration.shared.handler = { level, _, _, message in
      let name = level == .fault ? "fault" : level == .error ? "error" : "warning"
      lock.withLock { messages.append("\(name): \(message)") }
    }
  }

  static func drain() -> [String] {
    lock.withLock {
      defer { messages = [] }
      return messages
    }
  }
}
