import Foundation

public enum TileflowTimeOfDay: String, Codable, Sendable { case day, dawn, dusk, night }
public enum TileflowViewMode: String, Codable, Sendable {
  case flat = "2d"
  case threeDimensional = "3d"
}
/// Explicit rendering budgets. Device performance still depends on the map's data and design.
public enum TileflowQuality: String, Codable, Sendable { case low, balanced, high }

/// Which gestures move the map, and how.
public struct TileflowGestures: Codable, Equatable, Sendable {
  public var pan: Bool
  /// Pinching, double taps and other zoom gestures.
  public var zoom: Bool
  public var rotate: Bool
  public var pitch: Bool
  /// Whether a double tap zooms in and a two-finger tap zooms out, while ``zoom`` is on.
  public var doubleTapZoom: Bool
  /// How many zoom levels a double tap adds, from 0.25 to 4.
  public var doubleTapZoomDelta: Double
  /// One finger scrolls what surrounds the map, such as a list or a page, and two fingers move
  /// the map. The map shows a hint when one finger tries to move it.
  public var cooperative: Bool

  public init(
    pan: Bool = true, zoom: Bool = true, rotate: Bool = true, pitch: Bool = true,
    doubleTapZoom: Bool = true, doubleTapZoomDelta: Double = 1, cooperative: Bool = false
  ) {
    self.pan = pan
    self.zoom = zoom
    self.rotate = rotate
    self.pitch = pitch
    self.doubleTapZoom = doubleTapZoom
    self.doubleTapZoomDelta = doubleTapZoomDelta
    self.cooperative = cooperative
  }

  /// No gesture moves the map; taps and long presses are still reported.
  public static let none = TileflowGestures(
    pan: false, zoom: false, rotate: false, pitch: false, doubleTapZoom: false)

  /// Whether any gesture moves the map, so the map takes touches from scroll views around it.
  var movesMap: Bool { pan || zoom || rotate || pitch }

  func wireValue() throws -> JSONValue {
    guard (0.25...4).contains(doubleTapZoomDelta) else { throw TileflowMapError.invalidRequest }
    return .object([
      "pan": .bool(pan), "zoom": .bool(zoom), "rotate": .bool(rotate), "pitch": .bool(pitch),
      "doubleTapZoom": .bool(doubleTapZoom), "doubleTapZoomDelta": .number(doubleTapZoomDelta),
      "cooperative": .bool(cooperative),
    ])
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

public struct TileflowMapOptions: Equatable, Sendable {
  public var viewMode: TileflowViewMode
  /// The rendering quality. Nil uses ``TileflowDeviceProfile/current``'s quality when the options
  /// reach the map.
  public var quality: TileflowQuality?
  public var gestures: TileflowGestures
  /// The compass, scale bar, recenter button and attribution. The attribution is always shown.
  public var controls: TileflowMapControls
  /// Where the camera may go.
  public var cameraLimits: TileflowCameraLimits
  /// Which events the map reports. Delivery is set up by the SDK, not by the renderer's options.
  public var events: TileflowEventOptions = .init()

  public init(
    viewMode: TileflowViewMode = .flat, quality: TileflowQuality? = nil,
    gestures: TileflowGestures = .init(), controls: TileflowMapControls = .init(),
    cameraLimits: TileflowCameraLimits = .init(), events: TileflowEventOptions = .init()
  ) {
    self.viewMode = viewMode
    self.quality = quality
    self.gestures = gestures
    self.controls = controls
    self.cameraLimits = cameraLimits
    self.events = events
  }

  /// The renderer's options. The attribution's corner follows the layout direction.
  func wireValue(rightToLeft: Bool) throws -> JSONValue {
    let quality = quality ?? TileflowDeviceProfile.current.quality
    return .object([
      "viewMode": .string(viewMode.rawValue), "quality": .string(quality.rawValue),
      "gestures": try gestures.wireValue(), "limits": try cameraLimits.wireValue(),
      "attribution": .string(controls.attributionPosition.corner(rightToLeft: rightToLeft)),
    ])
  }

  func validate() throws {
    try events.validate()
    _ = try wireValue(rightToLeft: false)
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
      (0...24).contains(zoom), (-360...360).contains(bearing),
      (0...TileflowCameraLimits.maximumPitch).contains(pitch)
    else { throw TileflowMapError.invalidRequest }
  }
}
