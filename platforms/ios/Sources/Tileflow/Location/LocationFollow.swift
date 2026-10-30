import Foundation

/// How the camera follows the person's location.
public enum TileflowFollowMode: String, Codable, CaseIterable, Sendable {
  /// The camera does not follow.
  case none
  /// The camera keeps the location at the centre of the content insets.
  case position
  /// The camera also turns with the device, so the map ahead is up.
  case heading
  /// The camera also turns with the direction of travel, so the way ahead is up.
  case course

  /// The renderer's name for the mode.
  var wireValue: String { rawValue }
}

/// Why the follow mode changed without the application setting it.
public enum TileflowFollowModeChangeReason: String, Sendable {
  /// A person moved the map, or tapped the compass or the recenter button.
  case gesture
  /// The application moved the camera or turned the location off.
  case api
}

public struct TileflowFollowModeChange: Equatable, Sendable {
  public let mode: TileflowFollowMode
  public let reason: TileflowFollowModeChangeReason

  public init(mode: TileflowFollowMode, reason: TileflowFollowModeChangeReason) {
    self.mode = mode
    self.reason = reason
  }
}

/// What the puck's direction indicator shows.
public enum TileflowPuckBearing: String, Sendable {
  /// No direction indicator.
  case none
  /// The direction the device points.
  case heading
  /// The direction of travel, once the device moves.
  case course
}

/// How the map shows the person's location.
///
/// The renderer draws the location as a puck with a circle of its accuracy, an optional direction
/// indicator, and a grey dot once the latest position is older than ``staleAfter``. Showing the
/// location starts the map's location provider while the map is visible; the provider measures
/// only when the application has access (see ``TileflowLocationPermissions``).
public struct TileflowLocationOptions: Equatable, Sendable {
  /// Shows the location and follows it when a follow mode is set.
  public var enabled: Bool
  public var puckBearing: TileflowPuckBearing
  /// Draws a circle of the position's accuracy around the puck.
  public var showsAccuracy: Bool
  /// How old the latest position may be before the puck turns grey, from 1 second to 1 hour.
  public var staleAfter: TimeInterval
  /// The camera zooms in to at least this level when it starts to follow; nil keeps the zoom.
  public var followZoom: Double?

  public init(
    enabled: Bool = false, puckBearing: TileflowPuckBearing = .none, showsAccuracy: Bool = true,
    staleAfter: TimeInterval = 30, followZoom: Double? = 15
  ) {
    self.enabled = enabled
    self.puckBearing = puckBearing
    self.showsAccuracy = showsAccuracy
    self.staleAfter = staleAfter
    self.followZoom = followZoom
  }

  func wireValue() throws -> JSONValue {
    guard (1...3600).contains(staleAfter), followZoom.map({ (0...24).contains($0) }) ?? true
    else { throw TileflowMapError.invalidRequest }
    return .object([
      "enabled": .bool(enabled), "bearing": .string(puckBearing.rawValue),
      "accuracy": .bool(showsAccuracy), "staleAfterMs": .number((staleAfter * 1000).rounded()),
    ])
  }
}

/// The follow mode, and what each person's or application's action does to it.
struct FollowModeState: Equatable {
  private(set) var mode: TileflowFollowMode = .none
  /// The mode the recenter button returns to.
  private(set) var lastFollowing: TileflowFollowMode = .position

  /// The application sets a mode. Returns whether it changed.
  @discardableResult
  mutating func set(_ next: TileflowFollowMode) -> Bool {
    guard next != mode else { return false }
    mode = next
    if next != .none { lastFollowing = next }
    return true
  }

  /// A person moved the map, or the application moved the camera or turned the location off.
  mutating func end(_ reason: TileflowFollowModeChangeReason) -> TileflowFollowModeChange? {
    guard mode != .none else { return nil }
    mode = .none
    return TileflowFollowModeChange(mode: .none, reason: reason)
  }

  /// The recenter button: follows again, and turns between following the position and the
  /// heading, as the platforms' own location buttons do.
  mutating func recenter() -> TileflowFollowModeChange {
    let next: TileflowFollowMode
    switch mode {
    case .none: next = lastFollowing
    case .position: next = .heading
    case .heading, .course: next = .position
    }
    set(next)
    return TileflowFollowModeChange(mode: next, reason: .gesture)
  }

  /// The compass turns the map to north: the heading and course modes become the position mode.
  /// Returns the change, if the mode changed.
  mutating func compass() -> TileflowFollowModeChange? {
    guard mode == .heading || mode == .course else { return nil }
    set(.position)
    return TileflowFollowModeChange(mode: .position, reason: .gesture)
  }
}
