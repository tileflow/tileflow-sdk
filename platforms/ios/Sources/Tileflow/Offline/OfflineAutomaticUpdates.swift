import Foundation

#if canImport(BackgroundTasks)
  import BackgroundTasks
#endif

/// Whether the device may update regions by itself now: on Wi-Fi or another network that is
/// neither expensive nor constrained (Low Data Mode), and not in Low Power Mode.
struct OfflineUpdateConditions: Sendable, Equatable {
  var isUnmetered: Bool
  var isLowPower: Bool

  var allowsUpdates: Bool { isUnmetered && !isLowPower }

  /// No automatic update runs.
  static let unavailable = OfflineUpdateConditions(isUnmetered: false, isLowPower: false)

  /// The device's network and power, as the system reports them.
  static func current() -> OfflineUpdateConditions {
    OfflineUpdateConditions(
      isUnmetered: OfflineReachability.shared.isUnmetered,
      isLowPower: ProcessInfo.processInfo.isLowPowerModeEnabled)
  }
}

/// Asks the system to run the store's automatic updates in the background.
protocol OfflineUpdateScheduling: Sendable {
  /// Asks for a run no earlier than `earliest`, replacing any earlier request.
  func schedule(earliest: Date) throws
  func cancel()
}

/// Schedules automatic updates as a background app refresh task. The task only revalidates
/// regions and starts their downloads, which the background `URLSession` then carries on without
/// the task. The system decides when it runs; the store checks the network and power when it does.
struct OfflineBackgroundTaskScheduler: OfflineUpdateScheduling {
  static let identifier = "dev.tileflow.offline.update"

  func schedule(earliest: Date) throws {
    #if canImport(BackgroundTasks)
      let request = BGAppRefreshTaskRequest(identifier: Self.identifier)
      request.earliestBeginDate = earliest
      do {
        try BGTaskScheduler.shared.submit(request)
      } catch let error as BGTaskScheduler.Error where error.code == .notPermitted {
        throw TileflowOfflineError(
          .invalidConfiguration, context: .init(reason: "backgroundTaskNotPermitted"))
      } catch {
        // Unavailable here, as in the Simulator or with Background App Refresh turned off:
        // updates still run when the network returns while the app is in use.
      }
    #endif
  }

  func cancel() {
    #if canImport(BackgroundTasks)
      BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: Self.identifier)
    #endif
  }
}

/// The store's settings, beside its records: `settings.json`, replaced atomically.
struct OfflineSettings: Codable, Sendable, Equatable {
  var automaticUpdates = false
  /// When the last automatic update pass ran, in milliseconds since 1970.
  var lastAutomaticUpdate: Int64?

  static func read(_ url: URL) -> OfflineSettings {
    guard let data = try? Data(contentsOf: url),
      let settings = try? JSONDecoder().decode(OfflineSettings.self, from: data)
    else { return OfflineSettings() }
    return settings
  }

  func write(_ url: URL) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    try OfflineLayout.write(encoder.encode(self), to: url)
  }
}
