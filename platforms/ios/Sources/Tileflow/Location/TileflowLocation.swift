import CoreLocation
import Foundation

/// A position of the device, as a location provider reports it.
public struct TileflowLocation: Equatable, Sendable {
  public var coordinate: TileflowCoordinate
  /// When the position was measured.
  public var timestamp: Date
  /// The radius of uncertainty around ``coordinate``, in metres; nil when unknown.
  public var horizontalAccuracy: Double?
  /// The altitude above mean sea level, in metres; nil when unknown.
  public var altitude: Double?
  /// The direction of travel, in degrees clockwise from true north; nil when unknown.
  public var course: Double?
  /// The speed, in metres per second; nil when unknown.
  public var speed: Double?

  public init(
    coordinate: TileflowCoordinate, timestamp: Date = Date(), horizontalAccuracy: Double? = nil,
    altitude: Double? = nil, course: Double? = nil, speed: Double? = nil
  ) {
    self.coordinate = coordinate
    self.timestamp = timestamp
    self.horizontalAccuracy = horizontalAccuracy
    self.altitude = altitude
    self.course = course
    self.speed = speed
  }

  /// A CoreLocation fix. Nil when it holds no valid position. Negative values, which CoreLocation
  /// uses for unknown accuracy, course and speed, become nil.
  public init?(_ location: CLLocation) {
    guard location.horizontalAccuracy >= 0, CLLocationCoordinate2DIsValid(location.coordinate)
    else { return nil }
    self.init(
      coordinate: TileflowCoordinate(
        longitude: location.coordinate.longitude, latitude: location.coordinate.latitude),
      timestamp: location.timestamp, horizontalAccuracy: location.horizontalAccuracy,
      altitude: location.verticalAccuracy >= 0 ? location.altitude : nil,
      course: location.course >= 0 ? location.course : nil,
      speed: location.speed >= 0 ? location.speed : nil)
  }

  /// Whether the values are within the ranges the map draws.
  var isValid: Bool {
    (-180...180).contains(coordinate.longitude) && (-90...90).contains(coordinate.latitude)
      && (horizontalAccuracy.map { $0.isFinite && $0 >= 0 } ?? true)
      && (course.map { $0.isFinite } ?? true)
  }
}

/// The direction the device points, as a location provider reports it.
public struct TileflowHeading: Equatable, Sendable {
  /// Degrees clockwise from true north toward which the top of the device points.
  public var direction: Double
  /// The maximum deviation of ``direction``, in degrees; nil when unknown.
  public var accuracy: Double?
  public var timestamp: Date

  public init(direction: Double, accuracy: Double? = nil, timestamp: Date = Date()) {
    self.direction = direction
    self.accuracy = accuracy
    self.timestamp = timestamp
  }
}

/// Receives the positions and headings a ``TileflowLocationProvider`` reports. A map is one.
@MainActor
public protocol TileflowLocationConsumer: AnyObject {
  func locationUpdated(_ location: TileflowLocation)
  func headingUpdated(_ heading: TileflowHeading)
}

extension TileflowLocationConsumer {
  public func headingUpdated(_ heading: TileflowHeading) {}
}

/// A source of positions and headings for maps.
///
/// A provider delivers on the main actor to every consumer it holds. It should measure only while
/// it has consumers: a map adds itself while it shows the location and is visible, and removes
/// itself otherwise. A new consumer receives the latest known position at once, if there is one.
/// ``TileflowDefaultLocationProvider`` measures the device; ``TileflowSimulatedLocationProvider``
/// replays a route.
@MainActor
public protocol TileflowLocationProvider: AnyObject {
  func addConsumer(_ consumer: any TileflowLocationConsumer)
  func removeConsumer(_ consumer: any TileflowLocationConsumer)
}

/// The consumers of a provider, held weakly so a forgotten map is never kept alive.
@MainActor
struct LocationConsumers {
  private var entries: [WeakConsumer] = []

  private struct WeakConsumer {
    weak var value: (any TileflowLocationConsumer)?
  }

  var isEmpty: Bool { all.isEmpty }
  var all: [any TileflowLocationConsumer] { entries.compactMap(\.value) }

  /// Returns whether the consumer was new.
  @discardableResult
  mutating func add(_ consumer: any TileflowLocationConsumer) -> Bool {
    entries.removeAll { $0.value == nil }
    guard !entries.contains(where: { $0.value === consumer }) else { return false }
    entries.append(WeakConsumer(value: consumer))
    return true
  }

  mutating func remove(_ consumer: any TileflowLocationConsumer) {
    entries.removeAll { $0.value == nil || $0.value === consumer }
  }
}
