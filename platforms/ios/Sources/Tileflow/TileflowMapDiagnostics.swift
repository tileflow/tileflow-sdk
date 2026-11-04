import Foundation
import OSLog

/// Delivers structured map diagnostics to an application-owned destination.
public final class TileflowMapDiagnostics: Equatable, Sendable {
  public enum Level: Int, Sendable { case debug, info, warning, error }

  public enum Event: String, Sendable {
    case loading, contentReady, warning, failure

    public var level: Level {
      switch self {
      case .loading: .debug
      case .contentReady: .info
      case .warning: .warning
      case .failure: .error
      }
    }
  }

  /// Only typed event and resource metadata reach the sink.
  public struct Entry: Equatable, Sendable {
    public let event: Event
    public let code: TileflowMapError.Code?
    public let resource: TileflowResourceKind?
    public let feature: String?
    public let status: Int?
    public let occurrences: Int
  }

  public let minimumLevel: Level
  private let sink: @MainActor @Sendable (Entry) -> Void

  public init(minimumLevel: Level = .warning, sink: @escaping @MainActor @Sendable (Entry) -> Void)
  {
    self.minimumLevel = minimumLevel
    self.sink = sink
  }

  public static func == (lhs: TileflowMapDiagnostics, rhs: TileflowMapDiagnostics) -> Bool {
    lhs === rhs
  }

  private static let logger = Logger(subsystem: "dev.tileflow", category: "map")
  private static let features: Set<String> = [
    "scene3d", "models3d", "trees3d", "streetLights", "terrain3d", "globe", "sky", "pitchAbove60",
    "deviceContours", "pathGround", "embeddedImages", "nauticalLightRhythm", "symbolOverlap",
    "reliefResampling", "text",
  ]

  @MainActor
  static func report(_ event: TileflowMapEvent, to diagnostics: TileflowMapDiagnostics?) {
    if let diagnostics {
      diagnostics.record(event)
    } else if case .warning(let warning) = event,
      warning.error.context.reason == ProtocolContract.ErrorReason.featureUnavailable.rawValue
    {
      let feature = knownFeature(warning.error.context.feature) ?? "unrecognized"
      logger.warning("Native map feature unavailable (\(feature, privacy: .public)).")
    }
  }

  private static func knownFeature(_ feature: String?) -> String? {
    feature.flatMap { features.contains($0) ? $0 : nil }
  }

  @MainActor
  private func record(_ event: TileflowMapEvent) {
    switch event {
    case .loading: write(.loading)
    case .contentReady: write(.contentReady)
    case .warning(let warning):
      write(.warning, error: warning.error, occurrences: warning.occurrences)
    case .failed(let error): write(.failure, error: error)
    default: break
    }
  }

  @MainActor
  private func write(_ event: Event, error: TileflowMapError? = nil, occurrences: Int = 1) {
    guard event.level.rawValue >= minimumLevel.rawValue else { return }
    let context = error?.context
    sink(
      Entry(
        event: event, code: error?.code, resource: context?.resource,
        feature: Self.knownFeature(context?.feature), status: context?.status,
        occurrences: occurrences))
  }
}
