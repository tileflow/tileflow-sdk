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

public struct TileflowMapOptions: Codable, Equatable, Sendable {
  public var viewMode: TileflowViewMode
  public var quality: TileflowQuality
  public var gestures: TileflowGestures
  public var controls: Bool
  public init(
    viewMode: TileflowViewMode = .flat, quality: TileflowQuality = .balanced,
    gestures: TileflowGestures = .init(), controls: Bool = true
  ) {
    self.viewMode = viewMode
    self.quality = quality
    self.gestures = gestures
    self.controls = controls
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
