import Foundation

public enum TileflowTimeOfDay: String, Codable, Sendable { case day, dawn, dusk, night }
public enum TileflowViewMode: String, Codable, Sendable {
  case flat = "2d"
  case threeDimensional = "3d"
}
/// Explicit rendering budgets. Device performance still depends on the map's data and design.
public enum TileflowQuality: String, Codable, Sendable { case low, balanced, high }

public struct TileflowGestures: Codable, Equatable, Sendable {
  public var pan: Bool
  public var zoom: Bool
  public var rotate: Bool
  public var pitch: Bool
  public init(pan: Bool = true, zoom: Bool = true, rotate: Bool = true, pitch: Bool = true) {
    self.pan = pan
    self.zoom = zoom
    self.rotate = rotate
    self.pitch = pitch
  }
}

/// Which events the map reports. Events beyond the chosen level are never sent by the renderer,
/// so a map that does not need camera updates does not pay for them.
public struct TileflowEventOptions: Equatable, Sendable {
  /// `.essential` reports the camera when it settles, `.camera` also when it starts to move, and
  /// `.continuous` also while it moves.
  public var level: TileflowEventLevel
  /// At `.continuous`, the shortest time between camera updates while the camera moves, from 0
  /// (once per rendered frame) to 60 seconds. The latest camera is always delivered.
  public var cameraUpdateInterval: TimeInterval

  public init(level: TileflowEventLevel = .essential, cameraUpdateInterval: TimeInterval = 0) {
    self.level = level
    self.cameraUpdateInterval = cameraUpdateInterval
  }

  func validate() throws {
    guard
      (0...Double(ProtocolContract.maximumThrottleMilliseconds) / 1000)
        .contains(cameraUpdateInterval)
    else { throw TileflowMapError.invalidRequest }
  }
}

public struct TileflowMapOptions: Codable, Equatable, Sendable {
  public var viewMode: TileflowViewMode
  /// The rendering quality. Nil uses ``TileflowDeviceProfile/current``'s quality when the options
  /// reach the map.
  public var quality: TileflowQuality?
  public var gestures: TileflowGestures
  public var controls: Bool
  /// Which events the map reports. Delivery is set up by the SDK, not by the renderer's options.
  public var events: TileflowEventOptions = .init()

  public init(
    viewMode: TileflowViewMode = .flat, quality: TileflowQuality? = nil,
    gestures: TileflowGestures = .init(), controls: Bool = true,
    events: TileflowEventOptions = .init()
  ) {
    self.viewMode = viewMode
    self.quality = quality
    self.gestures = gestures
    self.controls = controls
    self.events = events
  }

  private enum CodingKeys: String, CodingKey { case viewMode, quality, gestures, controls }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(viewMode, forKey: .viewMode)
    try container.encode(quality ?? TileflowDeviceProfile.current.quality, forKey: .quality)
    try container.encode(gestures, forKey: .gestures)
    try container.encode(controls, forKey: .controls)
  }
}

public struct TileflowCoordinate: Codable, Equatable, Sendable {
  public var longitude: Double
  public var latitude: Double
  public init(longitude: Double, latitude: Double) {
    self.longitude = longitude
    self.latitude = latitude
  }
}

public struct TileflowBounds: Codable, Equatable, Sendable {
  public var west: Double
  public var south: Double
  public var east: Double
  public var north: Double
  /// An east edge west of the west edge describes a region crossing the antimeridian.
  public init(west: Double, south: Double, east: Double, north: Double) {
    self.west = west
    self.south = south
    self.east = east
    self.north = north
  }
}

extension TileflowCamera {
  func validate() throws {
    guard (-180...180).contains(longitude), (-90...90).contains(latitude),
      (0...24).contains(zoom), (-360...360).contains(bearing), (0...85).contains(pitch)
    else { throw TileflowMapError.invalidRequest }
  }
}
