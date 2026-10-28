import CoreGraphics
import Foundation

/// A change to some of the camera's values. Values left nil keep their current value, so an update
/// can, for example, turn the map to north without moving it.
public struct TileflowCameraUpdate: Equatable, Sendable {
  public var center: TileflowCoordinate?
  public var zoom: Double?
  /// Degrees clockwise from north.
  public var bearing: Double?
  /// Degrees from looking straight down, from 0 to 85.
  public var pitch: Double?

  public init(
    center: TileflowCoordinate? = nil, zoom: Double? = nil, bearing: Double? = nil,
    pitch: Double? = nil
  ) {
    self.center = center
    self.zoom = zoom
    self.bearing = bearing
    self.pitch = pitch
  }

  /// Every value of a camera.
  public init(_ camera: TileflowCamera) {
    self.init(
      center: TileflowCoordinate(longitude: camera.longitude, latitude: camera.latitude),
      zoom: camera.zoom, bearing: camera.bearing, pitch: camera.pitch)
  }

  /// The camera this update leads to from `camera`.
  func applied(to camera: TileflowCamera) -> TileflowCamera {
    TileflowCamera(
      longitude: center?.longitude ?? camera.longitude,
      latitude: center?.latitude ?? camera.latitude, zoom: zoom ?? camera.zoom,
      bearing: bearing ?? camera.bearing, pitch: pitch ?? camera.pitch)
  }

  func wireValue() throws -> JSONValue {
    var target: [String: JSONValue] = [:]
    if let center {
      guard (-180...180).contains(center.longitude), (-90...90).contains(center.latitude) else {
        throw TileflowMapError.invalidRequest
      }
      target["center"] = .object([
        "longitude": .number(center.longitude), "latitude": .number(center.latitude),
      ])
    }
    for (key, value, range) in [
      ("zoom", zoom, 0.0...24), ("bearing", bearing, -360.0...360),
      ("pitch", pitch, 0.0...TileflowCameraLimits.maximumPitch),
    ] {
      guard let value else { continue }
      guard range.contains(value) else { throw TileflowMapError.invalidRequest }
      target[key] = .number(value)
    }
    return .object(target)
  }
}

/// A timing curve for camera animations: a cubic Bézier through (0, 0) and (1, 1), as CSS
/// `cubic-bezier()`.
public struct TileflowEasing: Equatable, Sendable {
  public let x1: Double
  public let y1: Double
  public let x2: Double
  public let y2: Double

  /// The horizontal control coordinates `x1` and `x2` must lie between 0 and 1.
  public init(x1: Double, y1: Double, x2: Double, y2: Double) {
    self.x1 = x1
    self.y1 = y1
    self.x2 = x2
    self.y2 = y2
  }

  /// Starts quickly and settles gently; the default.
  public static let standard = TileflowEasing(x1: 0.25, y1: 0.1, x2: 0.25, y2: 1)
  public static let linear = TileflowEasing(x1: 0, y1: 0, x2: 1, y2: 1)
  public static let easeIn = TileflowEasing(x1: 0.42, y1: 0, x2: 1, y2: 1)
  public static let easeOut = TileflowEasing(x1: 0, y1: 0, x2: 0.58, y2: 1)
  public static let easeInOut = TileflowEasing(x1: 0.42, y1: 0, x2: 0.58, y2: 1)

  var wireValue: JSONValue {
    get throws {
      guard (0...1).contains(x1), (0...1).contains(x2), (-8...8).contains(y1),
        (-8...8).contains(y2)
      else { throw TileflowMapError.invalidRequest }
      return .array([.number(x1), .number(y1), .number(x2), .number(y2)])
    }
  }
}

/// A flight: the camera zooms out, travels and zooms in along a curve.
public struct TileflowFlyOptions: Equatable, Sendable {
  /// Nil derives the duration from ``speed``. Flights last at most 20 seconds; a longer one jumps.
  public var duration: TimeInterval?
  /// The average speed, in screenfuls per second along the curve, when ``duration`` is nil.
  public var speed: Double
  /// How far the camera zooms out along the way; 1.42 is the curve people perceive as natural.
  public var curve: Double
  /// The zoom at the top of the curve, instead of one derived from ``curve``.
  public var minZoom: Double?
  public var easing: TileflowEasing

  public init(
    duration: TimeInterval? = nil, speed: Double = 1.2, curve: Double = 1.42,
    minZoom: Double? = nil, easing: TileflowEasing = .standard
  ) {
    self.duration = duration
    self.speed = speed
    self.curve = curve
    self.minZoom = minZoom
    self.easing = easing
  }
}

/// How the camera reaches its target. Animations last at most 20 seconds.
///
/// When the device asks for reduced motion, the renderer may move at once instead of animating;
/// the movement still ends as ``TileflowCameraAnimationResult/finished``.
public enum TileflowCameraAnimation: Equatable, Sendable {
  /// Moves at once.
  case none
  /// Changes every value along the same timing curve.
  case ease(duration: TimeInterval = 0.5, easing: TileflowEasing = .standard)
  /// Zooms out, travels and zooms in.
  case fly(TileflowFlyOptions = .init())

  var wireValue: JSONValue {
    get throws {
      let duration = { (seconds: TimeInterval) throws -> JSONValue in
        guard seconds.isFinite, (0...TileflowCameraAnimation.maximumDuration).contains(seconds)
        else { throw TileflowMapError.invalidRequest }
        return .number((seconds * 1000).rounded())
      }
      switch self {
      case .none: return .object(["type": .string("jump")])
      case .ease(let seconds, let easing):
        return .object([
          "type": .string("ease"), "duration": try duration(seconds), "easing": try easing.wireValue,
        ])
      case .fly(let options):
        guard (0.01...100).contains(options.speed), (0.01...100).contains(options.curve),
          options.minZoom.map({ (0...24).contains($0) }) ?? true
        else { throw TileflowMapError.invalidRequest }
        var value: [String: JSONValue] = [
          "type": .string("fly"), "speed": .number(options.speed), "curve": .number(options.curve),
          "easing": try options.easing.wireValue,
        ]
        if let seconds = options.duration { value["duration"] = try duration(seconds) }
        if let minZoom = options.minZoom { value["minZoom"] = .number(minZoom) }
        return .object(value)
      }
    }
  }

  /// The longest animation, in seconds. Every movement answers within a request's time limit.
  public static let maximumDuration: TimeInterval = 20
}

/// How a camera movement ended.
public enum TileflowCameraAnimationResult: String, Sendable {
  /// The camera reached its target.
  case finished
  /// The application stopped the movement or started another one.
  case cancelled
  /// A person took over the map, or the map moved for another reason, before the target.
  case interrupted
}

/// Where the camera may go. Changing the limits moves a camera that lies outside them.
public struct TileflowCameraLimits: Equatable, Sendable {
  /// Tileflow's steepest pitch: the camera can look along a street to the sky.
  public static let maximumPitch: Double = 85

  public var minZoom: Double
  public var maxZoom: Double
  public var minPitch: Double
  public var maxPitch: Double
  /// The region the view must stay within, or nil for the whole world.
  public var bounds: TileflowBounds?

  public init(
    minZoom: Double = 0, maxZoom: Double = 24, minPitch: Double = 0,
    maxPitch: Double = TileflowCameraLimits.maximumPitch, bounds: TileflowBounds? = nil
  ) {
    self.minZoom = minZoom
    self.maxZoom = maxZoom
    self.minPitch = minPitch
    self.maxPitch = maxPitch
    self.bounds = bounds
  }

  func wireValue() throws -> JSONValue {
    guard (0...24).contains(minZoom), (0...24).contains(maxZoom), minZoom <= maxZoom,
      (0...Self.maximumPitch).contains(minPitch), (0...Self.maximumPitch).contains(maxPitch),
      minPitch <= maxPitch
    else { throw TileflowMapError.invalidRequest }
    return .object([
      "minZoom": .number(minZoom), "maxZoom": .number(maxZoom), "minPitch": .number(minPitch),
      "maxPitch": .number(maxPitch), "bounds": try bounds?.wireValue() ?? .null,
    ])
  }
}

extension TileflowBounds {
  /// The smallest bounds that contain every coordinate, crossing the antimeridian when that is
  /// narrower. Nil without coordinates.
  public init?(enclosing coordinates: [TileflowCoordinate]) {
    guard !coordinates.isEmpty else { return nil }
    let longitudes = coordinates.map(\.longitude).sorted()
    let latitudes = coordinates.map(\.latitude)
    // The widest gap between neighbouring longitudes, including the one across the antimeridian,
    // is the part of the world the bounds leave out.
    var gap = longitudes[0] + 360 - longitudes[longitudes.count - 1]
    var east = longitudes[longitudes.count - 1]
    var west = longitudes[0]
    for (previous, next) in zip(longitudes, longitudes.dropFirst()) where next - previous > gap {
      gap = next - previous
      west = next
      east = previous
    }
    self.init(west: west, south: latitudes.min()!, east: east, north: latitudes.max()!)
  }

  func wireValue() throws -> JSONValue {
    guard (-180...180).contains(west), (-180...180).contains(east), (-90...90).contains(south),
      (-90...90).contains(north), south <= north
    else { throw TileflowMapError.invalidRequest }
    return .object([
      "west": .number(west), "south": .number(south), "east": .number(east),
      "north": .number(north),
    ])
  }

  init?(wire value: JSONValue) {
    guard let west = value["west"]?.number, let south = value["south"]?.number,
      let east = value["east"]?.number, let north = value["north"]?.number
    else { return nil }
    self.init(west: west, south: south, east: east, north: north)
  }
}

/// A gesture a person makes on the map.
public enum TileflowGesture: String, CaseIterable, Sendable {
  case pan, zoom, rotate, pitch
}

/// Where a person touched the map: the coordinate under the touch and the point in the view's
/// coordinate system, in points.
public struct TileflowMapTouch: Equatable, Sendable {
  public let coordinate: TileflowCoordinate
  public let point: CGPoint

  public init(coordinate: TileflowCoordinate, point: CGPoint) {
    self.coordinate = coordinate
    self.point = point
  }

  init?(wire value: JSONValue) {
    guard let longitude = value["coordinate"]?["longitude"]?.number,
      let latitude = value["coordinate"]?["latitude"]?.number,
      let x = value["point"]?["x"]?.number, let y = value["point"]?["y"]?.number,
      (-180...180).contains(longitude), (-90...90).contains(latitude)
    else { return nil }
    self.init(
      coordinate: TileflowCoordinate(longitude: longitude, latitude: latitude),
      point: CGPoint(x: x, y: y))
  }
}

extension TileflowCamera {
  init?(wire value: JSONValue?) {
    guard let value, let longitude = value["longitude"]?.number,
      let latitude = value["latitude"]?.number, let zoom = value["zoom"]?.number,
      let bearing = value["bearing"]?.number, let pitch = value["pitch"]?.number
    else { return nil }
    let camera = TileflowCamera(
      longitude: longitude, latitude: latitude, zoom: zoom, bearing: bearing, pitch: pitch)
    guard (try? camera.validate()) != nil else { return nil }
    self = camera
  }
}
