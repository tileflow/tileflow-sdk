import Foundation

/// Replays a route at a constant speed, for tests, demonstrations and the simulator.
///
/// Each update moves along the route by the distance the speed covers in the update interval and
/// reports the position, with the direction of travel as both the course and the heading. While
/// it plays automatically it starts with its first consumer and pauses without consumers;
/// ``advance(by:)`` moves it by hand, for deterministic tests.
@MainActor
public final class TileflowSimulatedLocationProvider: TileflowLocationProvider {
  public let route: [TileflowCoordinate]
  /// Metres per second.
  public let speed: Double
  /// The time between updates while it plays automatically.
  public let updateInterval: TimeInterval
  /// The accuracy reported with each position, in metres.
  public let horizontalAccuracy: Double
  /// Whether the route starts again from its first point when it ends.
  public let loops: Bool
  /// The distance travelled along the route, in metres.
  public private(set) var distance: Double = 0
  /// The latest position the provider reported.
  public private(set) var latestLocation: TileflowLocation?

  private let playsAutomatically: Bool
  private let lengths: [Double]
  private var consumers = LocationConsumers()
  private var timer: Timer?

  /// - Parameters:
  ///   - route: At least one coordinate.
  ///   - playsAutomatically: Replays in real time while there are consumers. When false, only
  ///     ``advance(by:)`` moves along the route.
  public init(
    route: [TileflowCoordinate], speed: Double = 10, updateInterval: TimeInterval = 1,
    horizontalAccuracy: Double = 5, loops: Bool = false, playsAutomatically: Bool = true
  ) {
    precondition(!route.isEmpty, "A simulated route needs at least one coordinate.")
    precondition(speed >= 0 && updateInterval > 0 && horizontalAccuracy >= 0)
    self.route = route
    self.speed = speed
    self.updateInterval = updateInterval
    self.horizontalAccuracy = horizontalAccuracy
    self.loops = loops
    self.playsAutomatically = playsAutomatically
    lengths = zip(route, route.dropFirst()).map { Self.meters(from: $0, to: $1) }
  }

  /// The route's length in metres.
  public var length: Double { lengths.reduce(0, +) }

  /// Whether the replay reached the end of a route that does not loop.
  public var isFinished: Bool { !loops && distance >= length }

  public func addConsumer(_ consumer: any TileflowLocationConsumer) {
    guard consumers.add(consumer) else { return }
    if let latestLocation {
      consumer.locationUpdated(latestLocation)
      if let course = latestLocation.course {
        consumer.headingUpdated(
          TileflowHeading(direction: course, timestamp: latestLocation.timestamp))
      }
    } else {
      // The first consumer starts the replay at the route's first point.
      report()
    }
    play()
  }

  public func removeConsumer(_ consumer: any TileflowLocationConsumer) {
    consumers.remove(consumer)
    if consumers.isEmpty { pause() }
  }

  /// Moves along the route by what the speed covers in `interval`, and reports the position.
  @discardableResult
  public func advance(by interval: TimeInterval) -> TileflowLocation {
    let total = length
    distance += speed * max(interval, 0)
    if loops, total > 0 {
      distance = distance.truncatingRemainder(dividingBy: total)
    } else {
      distance = min(distance, total)
    }
    return report()
  }

  /// The position and direction of travel at `distance` metres along the route.
  public func point(at distance: Double) -> (coordinate: TileflowCoordinate, course: Double?) {
    var remaining = max(distance, 0)
    for (index, length) in lengths.enumerated() {
      let from = route[index]
      let to = route[index + 1]
      if remaining <= length || index == lengths.count - 1 {
        let t = length > 0 ? min(remaining / length, 1) : 1
        return (
          TileflowCoordinate(
            longitude: from.longitude + (to.longitude - from.longitude) * t,
            latitude: from.latitude + (to.latitude - from.latitude) * t),
          length > 0 ? Self.course(from: from, to: to) : nil
        )
      }
      remaining -= length
    }
    return (route[0], nil)
  }

  @discardableResult
  private func report() -> TileflowLocation {
    let (coordinate, course) = point(at: distance)
    let location = TileflowLocation(
      coordinate: coordinate, timestamp: Date(), horizontalAccuracy: horizontalAccuracy,
      course: course, speed: isFinished ? 0 : speed)
    latestLocation = location
    for consumer in consumers.all {
      consumer.locationUpdated(location)
      if let course {
        consumer.headingUpdated(TileflowHeading(direction: course, timestamp: location.timestamp))
      }
    }
    if isFinished { pause() }
    return location
  }

  private func play() {
    guard playsAutomatically, timer == nil, !isFinished else { return }
    timer = Timer.scheduledTimer(withTimeInterval: updateInterval, repeats: true) { [weak self] _ in
      MainActor.assumeIsolated {
        guard let self else { return }
        self.advance(by: self.updateInterval)
      }
    }
  }

  private func pause() {
    timer?.invalidate()
    timer = nil
  }

  /// The great-circle distance in metres.
  nonisolated static func meters(from a: TileflowCoordinate, to b: TileflowCoordinate) -> Double {
    let radians = Double.pi / 180
    let dLat = (b.latitude - a.latitude) * radians
    let dLon = (b.longitude - a.longitude) * radians
    let h =
      sin(dLat / 2) * sin(dLat / 2)
      + cos(a.latitude * radians) * cos(b.latitude * radians) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * 6_371_008.8 * asin(min(1, sqrt(h)))
  }

  /// The initial bearing from `a` to `b`, in degrees clockwise from true north.
  nonisolated static func course(from a: TileflowCoordinate, to b: TileflowCoordinate) -> Double {
    let radians = Double.pi / 180
    let dLon = (b.longitude - a.longitude) * radians
    let y = sin(dLon) * cos(b.latitude * radians)
    let x =
      cos(a.latitude * radians) * sin(b.latitude * radians)
      - sin(a.latitude * radians) * cos(b.latitude * radians) * cos(dLon)
    let degrees = atan2(y, x) / radians
    return (degrees + 360).truncatingRemainder(dividingBy: 360)
  }
}
