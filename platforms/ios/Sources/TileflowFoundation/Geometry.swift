import CoreLocation
import Foundation

/// A WGS84 position. Service requests send it as `[longitude, latitude]`.
public struct TileflowPosition: Sendable, Hashable {
  public var longitude: Double
  public var latitude: Double

  public init(longitude: Double, latitude: Double) {
    self.longitude = longitude
    self.latitude = latitude
  }

  public init(_ coordinate: CLLocationCoordinate2D) {
    self.init(longitude: coordinate.longitude, latitude: coordinate.latitude)
  }

  public var coordinate: CLLocationCoordinate2D {
    CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
  }

  /// Finite, with a longitude within ±180 and a latitude within ±90.
  public var isValid: Bool {
    longitude.isFinite && latitude.isFinite && abs(longitude) <= 180 && abs(latitude) <= 90
  }

  /// The great-circle distance in metres, on a sphere of radius 6,371,008.8 m.
  public func distance(to other: TileflowPosition) -> Double {
    let radians = Double.pi / 180
    let dLat = (other.latitude - latitude) * radians
    let dLng = (other.longitude - longitude) * radians
    let h =
      pow(sin(dLat / 2), 2) + cos(latitude * radians) * cos(other.latitude * radians)
      * pow(sin(dLng / 2), 2)
    return 2 * 6_371_008.8 * asin(min(1, h.squareRoot()))
  }
}

/// A box between two meridians and two parallels, which does not cross the antimeridian.
public struct TileflowBoundingBox: Sendable, Hashable {
  public var west: Double
  public var south: Double
  public var east: Double
  public var north: Double

  public init(west: Double, south: Double, east: Double, north: Double) {
    self.west = west
    self.south = south
    self.east = east
    self.north = north
  }

  /// The smallest box around the positions, or nil without positions.
  public init?(_ positions: some Sequence<TileflowPosition>) {
    var iterator = positions.makeIterator()
    guard let first = iterator.next() else { return nil }
    var box = TileflowBoundingBox(
      west: first.longitude, south: first.latitude, east: first.longitude, north: first.latitude)
    while let position = iterator.next() {
      box.west = min(box.west, position.longitude)
      box.south = min(box.south, position.latitude)
      box.east = max(box.east, position.longitude)
      box.north = max(box.north, position.latitude)
    }
    self = box
  }

  /// Valid corners, with west less than east and south less than north.
  public var isValid: Bool {
    TileflowPosition(longitude: west, latitude: south).isValid
      && TileflowPosition(longitude: east, latitude: north).isValid && west < east
      && south < north
  }
}
