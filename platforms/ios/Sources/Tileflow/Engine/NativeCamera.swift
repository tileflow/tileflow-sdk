import MapLibre
import UIKit

/// The camera of a map that MapLibre Native draws: movements and how they end, limits, content
/// insets, and camera events with who moved the camera.
///
/// A movement the view asks for answers once: `finished` when MapLibre completes it, `cancelled`
/// when the view stops or replaces it, and `interrupted` when anything else ends it first, such as
/// a person touching the map. MapLibre ends the transition in progress whenever another camera
/// change starts, so the changes the engine itself hands MapLibre (``issue(_:_:)``) never count as
/// interruptions of the movement they start.
///
/// MapLibre reports every camera change synchronously, with the reasons it knows: the gestures that
/// caused it, and whether it cancelled a transition. The camera adds who asked for the changes the
/// engine makes: the application (`api`), a person through the map's controls (`gesture`), the
/// location (`location`) or the SDK itself (`system`).
@MainActor
final class NativeCamera {
  enum Outcome: String {
    case finished, cancelled, interrupted
  }

  /// How a movement reaches its target.
  enum Animation {
    case jump
    case ease(TimeInterval, CAMediaTimingFunction)
    case fly(TimeInterval, minZoom: Double?)
  }

  /// Where the camera may go, as the view's options give it.
  struct Limits: Equatable {
    var minZoom = 0.0
    var maxZoom = 24.0
    var minPitch = 0.0
    var maxPitch = TileflowCameraLimits.maximumPitch
    var bounds: TileflowBounds?
  }

  private struct Movement {
    let id: Int
    let reason: String
    let completion: CheckedContinuation<JSONValue, any Error>
  }

  /// The gestures MapLibre names in its camera change reasons.
  static let gestureReasons: [(TileflowGesture, MLNCameraChangeReason)] = [
    (.pan, .gesturePan),
    (.zoom, [.gesturePinch, .gestureZoomIn, .gestureZoomOut, .gestureOneFingerZoom]),
    (.rotate, .gestureRotate),
    (.pitch, .gestureTilt),
  ]
  static let anyGesture: MLNCameraChangeReason = gestureReasons.reduce([]) { $0.union($1.1) }
  /// A flight longer than this jumps, so it never outlives its request.
  static let maximumDuration = TileflowCameraAnimation.maximumDuration

  private weak var mapView: MLNMapView?
  private let emit: (String, JSONValue) -> Void
  private var movement: Movement?
  private var sequence = 0
  private(set) var isMoving = false
  /// Who moves the camera in the change under way.
  private var changeReason = "system"
  /// Who asked for the change the engine is handing MapLibre, and whether it started to move.
  private var issuer: String?
  private var issuedStart = false
  /// Set while the engine stops MapLibre's transition: that change is not reported.
  private var quiet = false
  private var quietChange = false
  /// Content insets that wait for the camera to settle, so they never stop an animation.
  private var pendingInsets: UIEdgeInsets?
  private(set) var limits = Limits()
  private var bounded = false
  /// Whether the view follows the camera frame by frame: `cameraMoved` costs a call per frame.
  var followsFrames = true
  /// Gestures a person is making, and those that ended in the change under way.
  private(set) var gestures: Set<TileflowGesture> = []
  private var endedGestures: Set<TileflowGesture> = []
  private var retired = false

  init(mapView: MLNMapView, emit: @escaping (String, JSONValue) -> Void) {
    self.mapView = mapView
    self.emit = emit
  }

  // MARK: Reading

  /// The camera in the SDK's form. MapLibre's direction runs from 0 to 360; the SDK's bearing runs
  /// from -180 to 180, as on the web.
  var current: TileflowCamera? {
    guard let mapView else { return nil }
    let center = mapView.centerCoordinate
    var bearing = mapView.direction.truncatingRemainder(dividingBy: 360)
    if bearing > 180 { bearing -= 360 }
    if bearing <= -180 { bearing += 360 }
    return TileflowCamera(
      longitude: NativeCameraMath.wrap(center.longitude), latitude: center.latitude,
      zoom: min(24, max(0, mapView.zoomLevel)), bearing: bearing,
      pitch: min(TileflowCameraLimits.maximumPitch, max(0, Double(mapView.camera.pitch))))
  }

  var wire: JSONValue {
    guard let camera = current else { return .null }
    return .object([
      "longitude": .number(camera.longitude), "latitude": .number(camera.latitude),
      "zoom": .number(camera.zoom), "bearing": .number(camera.bearing),
      "pitch": .number(camera.pitch),
    ])
  }

  /// The region the view shows, as the web describes it: longitudes within [-180, 180], an east
  /// edge west of the west edge across the antimeridian, and the whole world when the view is wider.
  var visibleBounds: TileflowBounds? {
    guard let mapView else { return nil }
    let bounds = mapView.visibleCoordinateBounds
    var east = bounds.ne.longitude
    if east < bounds.sw.longitude { east += 360 }
    return NativeCameraMath.normalized(
      west: bounds.sw.longitude, south: bounds.sw.latitude, east: east, north: bounds.ne.latitude)
  }

  func point(for coordinate: TileflowCoordinate) -> CGPoint? {
    guard let mapView else { return nil }
    return mapView.convert(
      CLLocationCoordinate2D(latitude: coordinate.latitude, longitude: coordinate.longitude),
      toPointTo: mapView)
  }

  func coordinate(at point: CGPoint) -> TileflowCoordinate? {
    guard let mapView else { return nil }
    let coordinate = mapView.convert(point, toCoordinateFrom: mapView)
    return TileflowCoordinate(
      longitude: NativeCameraMath.wrap(coordinate.longitude), latitude: coordinate.latitude)
  }

  /// MapLibre's camera for one of the SDK's, or nil before the view has a size.
  func mapCamera(_ camera: TileflowCamera) -> MLNMapCamera? {
    guard let mapView else { return nil }
    let size = mapView.bounds.size
    guard size.width > 0, size.height > 0 else { return nil }
    let center = CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude)
    let altitude = MLNAltitudeForZoomLevel(camera.zoom, camera.pitch, camera.latitude, size)
    return MLNMapCamera(
      lookingAtCenter: center, altitude: altitude, pitch: camera.pitch, heading: camera.bearing)
  }

  // MARK: Movements

  /// Moves to a camera at once, for the SDK: the camera a map starts at.
  func jump(to camera: TileflowCamera) {
    guard let mapView else { return }
    issue("system") {
      if let target = mapCamera(camera) {
        mapView.setCamera(target, animated: false)
      } else {
        mapView.setCenter(
          CLLocationCoordinate2D(latitude: camera.latitude, longitude: camera.longitude),
          zoomLevel: camera.zoom, direction: camera.bearing, animated: false)
      }
    }
  }

  func shotStarted() {
    stop()
    emit("cameraMoveStarted", .object(["camera": wire, "reason": .string("api")]))
  }

  func shotFrame(_ frame: TileflowCamera) {
    quiet = true
    jump(to: frame)
    quiet = false
    if followsFrames { emit("cameraMoved", .object(["camera": wire, "reason": .string("api")])) }
  }

  func shotEnded() {
    emit("cameraMoveEnded", .object(["camera": wire, "reason": .string("api")]))
  }

  /// Runs one movement the view asked for and answers with how it ended and where the camera is.
  /// Cancelling the calling task stops the movement in MapLibre and throws `CancellationError`.
  func move(_ payload: JSONValue) async throws -> JSONValue {
    guard let mapView, let start = current else { throw TileflowMapError.notReady }
    let target = try target(of: payload, from: start)
    let reason = payload["reason"]?.string ?? "api"
    let animation = Self.animation(
      payload["animation"], from: start, to: target, size: mapView.bounds.size)
    end(.cancelled)
    sequence += 1
    let id = sequence
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { completion in
        movement = Movement(id: id, reason: reason, completion: completion)
        run(animation, to: target, id: id, reason: reason)
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.abandon(id) }
    }
  }

  private func target(of payload: JSONValue, from start: TileflowCamera) throws -> TileflowCamera {
    if let fit = payload["fit"] {
      guard let camera = fitted(fit) else {
        throw TileflowMapError(
          .invalidRequest,
          context: .init(message: "The bounds do not fit the view with this padding."))
      }
      return camera
    }
    let update = payload["target"]
    return TileflowCamera(
      longitude: update?["center"]?["longitude"]?.number ?? start.longitude,
      latitude: update?["center"]?["latitude"]?.number ?? start.latitude,
      zoom: update?["zoom"]?.number ?? start.zoom,
      bearing: update?["bearing"]?.number ?? start.bearing,
      pitch: update?["pitch"]?.number ?? start.pitch)
  }

  /// The animation MapLibre runs. A device that asks for reduced motion moves at once, and so does
  /// a flight that would last longer than the limit.
  static func animation(
    _ value: JSONValue?, from start: TileflowCamera, to target: TileflowCamera, size: CGSize
  ) -> Animation {
    let duration = (value?["duration"]?.number).map { $0 / 1000 }
    switch value?["type"]?.string {
    case "ease":
      guard let duration, duration > 0, !UIAccessibility.isReduceMotionEnabled else { return .jump }
      let points = (value?["easing"]?.array ?? []).compactMap(\.number).map { Float($0) }
      let timing =
        points.count == 4
        ? CAMediaTimingFunction(controlPoints: points[0], points[1], points[2], points[3])
        : CAMediaTimingFunction(controlPoints: 0.25, 0.1, 0.25, 1)
      return .ease(min(duration, maximumDuration), timing)
    case "fly":
      guard !UIAccessibility.isReduceMotionEnabled else { return .jump }
      let minZoom = value?["minZoom"]?.number
      let length =
        duration
        ?? NativeCameraMath.flightDuration(
          from: start, to: target, size: size, speed: value?["speed"]?.number ?? 1.2,
          curve: value?["curve"]?.number ?? 1.42, minZoom: minZoom)
      guard length > 0, length <= maximumDuration else { return .jump }
      return .fly(length, minZoom: minZoom)
    default:
      return .jump
    }
  }

  private func run(_ animation: Animation, to target: TileflowCamera, id: Int, reason: String) {
    guard let mapView, let camera = mapCamera(target) else {
      jump(to: target)
      end(.finished, id: id)
      return
    }
    // MapLibre calls completion handlers on the main queue once a transition ends, also when
    // another change cancels it; a movement that already ended ignores its handler.
    let completed: () -> Void = { [weak self] in
      MainActor.assumeIsolated { self?.end(.finished, id: id) }
    }
    let started = issue(reason) {
      switch animation {
      case .jump:
        mapView.setCamera(camera, animated: false)
      case .ease(let duration, let timing):
        mapView.setCamera(
          camera, withDuration: duration, animationTimingFunction: timing,
          completionHandler: completed)
      case .fly(let duration, let minZoom):
        mapView.fly(
          to: camera, withDuration: duration,
          peakAltitude: minZoom.map { peakAltitude($0, to: target) } ?? -1,
          completionHandler: completed)
      }
    }
    // A jump completes as it starts. A movement that changes nothing never starts, and nothing
    // can interrupt it.
    if case .jump = animation {
      end(.finished, id: id)
    } else if !started {
      end(.finished, id: id)
    }
  }

  /// MapLibre's peak altitude for a flight's lowest zoom, as it converts it back: at the pitch and
  /// latitude halfway along.
  private func peakAltitude(_ zoom: Double, to target: TileflowCamera) -> CLLocationDistance {
    guard let mapView else { return -1 }
    let latitude = (mapView.centerCoordinate.latitude + target.latitude) / 2
    let pitch = (Double(mapView.camera.pitch) + target.pitch) / 2
    return MLNAltitudeForZoomLevel(zoom, pitch, latitude, mapView.frame.size)
  }

  /// Ends the movement in progress, or the one with `id`, with an outcome and the camera.
  func end(_ outcome: Outcome, id: Int? = nil) {
    guard let movement, id == nil || movement.id == id else { return }
    self.movement = nil
    movement.completion.resume(
      returning: .object(["completion": .string(outcome.rawValue), "camera": wire]))
  }

  /// The calling task gave up its movement: MapLibre stops, and the call throws.
  private func abandon(_ id: Int) {
    guard let movement, movement.id == id else { return }
    self.movement = nil
    halt(movement.reason)
    movement.completion.resume(throwing: CancellationError())
  }

  /// Stops the camera, whether the application or a person moved it.
  func stop() {
    let reason = movement?.reason ?? changeReason
    end(.cancelled)
    halt(reason)
  }

  /// Stops MapLibre's transition in progress. MapLibre cancels a transition whenever the camera
  /// jumps; a jump to the camera it shows does nothing, so this one differs by a millimetre of
  /// altitude, and is not reported.
  private func halt(_ reason: String) {
    guard isMoving, let mapView, let camera = mapView.camera.copy() as? MLNMapCamera else { return }
    camera.altitude += 0.001
    quiet = true
    issue(reason) { mapView.setCamera(camera, animated: false) }
    quiet = false
    quietChange = false
  }

  /// Hands MapLibre a change the engine makes for `reason`. Returns whether the camera started to
  /// move; MapLibre does nothing for a camera it already shows.
  @discardableResult
  private func issue(_ reason: String, _ change: () -> Void) -> Bool {
    let previous = (issuer, issuedStart)
    issuer = reason
    issuedStart = false
    change()
    let started = issuedStart
    (issuer, issuedStart) = previous
    return started
  }

  func stopLocation() {
    guard isMoving, changeReason == "location" else { return }
    halt("location")
  }

  func locationChange(_ change: () -> Void) { issue("location", change) }

  /// Uses the same zoom, inset and event conventions as movements the application requests.
  func moveForLocation(to target: TileflowCamera, duration: TimeInterval, completion: (() -> Void)? = nil) {
    guard let mapView, let native = mapCamera(target) else { completion?(); return }
    locationChange {
      mapView.setCamera(native, withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : duration,
        animationTimingFunction: CAMediaTimingFunction(name: .linear), completionHandler: completion)
    }
  }

  /// A person's double tap: the zoom changes by `delta` around `point`, as MapLibre's own double tap
  /// does by one level.
  func zoom(by delta: Double, around point: CGPoint) {
    guard let mapView, let start = current, let anchor = coordinate(at: point) else { return }
    let zoom = min(limits.maxZoom, max(limits.minZoom, start.zoom + delta))
    let center = NativeCameraMath.center(
      zoomingBy: zoom - start.zoom, around: anchor,
      from: TileflowCoordinate(longitude: start.longitude, latitude: start.latitude))
    var target = start
    target.longitude = center.longitude
    target.latitude = center.latitude
    target.zoom = zoom
    guard let camera = mapCamera(target) else { return }
    // A person takes over the movement the application asked for.
    end(.interrupted)
    let started = issue("gesture") {
      mapView.setCamera(
        camera, withDuration: 0.3, animationTimingFunction: CAMediaTimingFunction(name: .easeOut),
        completionHandler: nil)
    }
    guard started, !gestures.contains(.zoom) else { return }
    gestures.insert(.zoom)
    emit("gestureStarted", .object(["gesture": .string(TileflowGesture.zoom.rawValue)]))
  }

  // MARK: Limits and insets

  /// Applies the view's limits; a camera outside them moves inside.
  func setLimits(_ value: JSONValue?) {
    guard let mapView, let value else { return }
    let next = Limits(
      minZoom: value["minZoom"]?.number ?? 0, maxZoom: value["maxZoom"]?.number ?? 24,
      minPitch: value["minPitch"]?.number ?? 0,
      maxPitch: value["maxPitch"]?.number ?? TileflowCameraLimits.maximumPitch,
      bounds: value["bounds"].flatMap { TileflowBounds(wire: $0) })
    guard next != limits else { return }
    limits = next
    // Reset first, so new limits never cross the previous ones while they are applied.
    mapView.minimumZoomLevel = 0
    mapView.maximumZoomLevel = next.maxZoom
    mapView.minimumZoomLevel = next.minZoom
    mapView.minimumPitch = 0
    mapView.maximumPitch = min(next.maxPitch, TileflowCameraLimits.maximumPitch)
    mapView.minimumPitch = next.minPitch
    if let bounds = next.bounds {
      // MapLibre keeps the whole view inside screen bounds, as `maxBounds` does on the web.
      let east = bounds.east < bounds.west ? bounds.east + 360 : bounds.east
      mapView.maximumScreenBounds = MLNCoordinateBounds(
        sw: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.west),
        ne: CLLocationCoordinate2D(latitude: bounds.north, longitude: east))
      bounded = true
    } else if bounded {
      // MapLibre keeps screen bounds once set; bounds as wide as the projection free the view
      // again, while the latitudes still end where the world does.
      mapView.maximumScreenBounds = MLNCoordinateBounds(
        sw: CLLocationCoordinate2D(latitude: -NativeCameraMath.maximumLatitude, longitude: -1e6),
        ne: CLLocationCoordinate2D(latitude: NativeCameraMath.maximumLatitude, longitude: 1e6))
      bounded = false
    }
    constrain()
  }

  /// Moves a camera that lies outside the limits inside them. MapLibre applies its limits to the
  /// next change, so the camera jumps to where it is, at most a millimetre of altitude away.
  private func constrain() {
    guard let mapView, var camera = current else { return }
    let zoom = min(limits.maxZoom, max(limits.minZoom, camera.zoom))
    let pitch = min(limits.maxPitch, max(limits.minPitch, camera.pitch))
    guard zoom != camera.zoom || pitch != camera.pitch || limits.bounds != nil else { return }
    camera.zoom = zoom
    camera.pitch = pitch
    guard let target = mapCamera(camera) else { return }
    target.altitude += 0.001
    issue("system") { mapView.setCamera(target, animated: false) }
  }

  /// Space covered at each edge. The camera centres on the rest of the view; a change while the
  /// camera moves applies when it settles, so it never stops an animation.
  func setInsets(_ insets: UIEdgeInsets) {
    pendingInsets = insets
    applyInsets()
  }

  private func applyInsets() {
    guard !isMoving, !retired, let insets = pendingInsets, let mapView else { return }
    pendingInsets = nil
    guard mapView.contentInset != insets else { return }
    issue("system") { mapView.contentInset = insets }
  }

  // MARK: Framing

  /// The camera that frames bounds with padding inside the content insets; nil when the padding
  /// leaves no room. The zoom stays within `maxZoom` and the limits.
  func fitted(_ fit: JSONValue) -> TileflowCamera? {
    guard let mapView, let wire = fit["bounds"], let bounds = TileflowBounds(wire: wire) else {
      return nil
    }
    let edge = { (key: String) in CGFloat(fit["padding"]?[key]?.number ?? 0) }
    let padding = UIEdgeInsets(
      top: edge("top"), left: edge("left"), bottom: edge("bottom"), right: edge("right"))
    let size = mapView.bounds.size
    let insets = mapView.contentInset
    guard size.width - padding.left - padding.right - insets.left - insets.right > 0,
      size.height - padding.top - padding.bottom - insets.top - insets.bottom > 0
    else { return nil }
    let base = MLNMapCamera(
      lookingAtCenter: mapView.centerCoordinate, altitude: mapView.camera.altitude,
      pitch: fit["pitch"]?.number ?? mapView.camera.pitch,
      heading: fit["bearing"]?.number ?? mapView.direction)
    let east = bounds.east < bounds.west ? bounds.east + 360 : bounds.east
    let camera = mapView.camera(
      base,
      fitting: MLNCoordinateBounds(
        sw: CLLocationCoordinate2D(latitude: bounds.south, longitude: bounds.west),
        ne: CLLocationCoordinate2D(latitude: bounds.north, longitude: east)),
      edgePadding: padding)
    var zoom = MLNZoomLevelForAltitude(
      camera.altitude, camera.pitch, camera.centerCoordinate.latitude, size)
    zoom = min(zoom, fit["maxZoom"]?.number ?? limits.maxZoom, limits.maxZoom)
    zoom = min(24, max(0, max(zoom, limits.minZoom)))
    var bearing = camera.heading.truncatingRemainder(dividingBy: 360)
    if bearing > 180 { bearing -= 360 }
    // MapLibre centres the bounds in the view less the padding and the insets; the camera's centre
    // is the centre of the view less the insets only, so uneven padding moves it.
    let center = NativeCameraMath.shifted(
      TileflowCoordinate(
        longitude: camera.centerCoordinate.longitude, latitude: camera.centerCoordinate.latitude),
      by: CGPoint(x: (padding.right - padding.left) / 2, y: (padding.bottom - padding.top) / 2),
      zoom: zoom, bearing: bearing)
    return TileflowCamera(
      longitude: NativeCameraMath.wrap(center.longitude), latitude: center.latitude, zoom: zoom,
      bearing: bearing, pitch: min(TileflowCameraLimits.maximumPitch, Double(camera.pitch)))
  }

  // MARK: MapLibre's camera changes

  func willChange(_ change: MLNCameraChangeReason) {
    if issuer != nil { issuedStart = true }
    if quiet {
      quietChange = true
      return
    }
    let gesture = !change.isDisjoint(with: Self.anyGesture)
    // A person's gesture takes over the movement the application asked for.
    if gesture, issuer == nil { end(.interrupted) }
    // Heading callbacks can arrive from the location manager after the original delegate call.
    let tracking = mapView.map { $0.userTrackingMode != .none } ?? false
    changeReason = gesture ? "gesture" : issuer ?? movement?.reason ?? (tracking ? "location" : "system")
    if !isMoving {
      isMoving = true
      emit("cameraMoveStarted", .object(["camera": wire, "reason": .string(changeReason)]))
    }
    track(change)
  }

  func isChanging(_ change: MLNCameraChangeReason) {
    if quietChange { return }
    if !change.isDisjoint(with: Self.anyGesture) {
      if issuer == nil { end(.interrupted) }
      changeReason = "gesture"
    }
    track(change)
    guard followsFrames else { return }
    emit("cameraMoved", .object(["camera": wire, "reason": .string(changeReason)]))
  }

  func didChange(_ change: MLNCameraChangeReason) {
    if quietChange {
      quietChange = false
      return
    }
    if !change.isDisjoint(with: Self.anyGesture) { changeReason = "gesture" }
    for gesture in TileflowGesture.allCases where gestures.contains(gesture) {
      emit("gestureEnded", .object(["gesture": .string(gesture.rawValue)]))
    }
    gestures.removeAll()
    endedGestures.removeAll()
    if isMoving {
      isMoving = false
      emit("cameraMoveEnded", .object(["camera": wire, "reason": .string(changeReason)]))
    }
    // Something other than the engine cancelled the transition: a person touched the map, or
    // MapLibre moved the camera for another reason.
    if change.contains(.transitionCancelled), issuer == nil { end(.interrupted) }
    if pendingInsets != nil {
      Task { @MainActor [weak self] in self?.applyInsets() }
    }
  }

  /// A gesture MapLibre names starts once per change.
  private func track(_ change: MLNCameraChangeReason) {
    for (gesture, reasons) in Self.gestureReasons
    where !change.isDisjoint(with: reasons) && !gestures.contains(gesture)
      && !endedGestures.contains(gesture)
    {
      gestures.insert(gesture)
      emit("gestureStarted", .object(["gesture": .string(gesture.rawValue)]))
    }
  }

  /// A person lifted the fingers of a gesture; the camera may still move, decelerating.
  func gestureEnded(_ gesture: TileflowGesture) {
    guard gestures.remove(gesture) != nil else { return }
    endedGestures.insert(gesture)
    emit("gestureEnded", .object(["gesture": .string(gesture.rawValue)]))
  }

  func retire(_ error: TileflowMapError) {
    retired = true
    guard let movement else { return }
    self.movement = nil
    movement.completion.resume(throwing: error)
  }
}

/// Web Mercator and flight arithmetic for the camera, in MapLibre's terms: the world is 512 points
/// wide at zoom 0.
enum NativeCameraMath {
  /// The latitude where Web Mercator's square world ends.
  static let maximumLatitude = 85.051_128_779_806_59

  static func wrap(_ longitude: Double) -> Double {
    guard longitude < -180 || longitude > 180 else { return longitude }
    let wrapped = (longitude + 180).truncatingRemainder(dividingBy: 360)
    return (wrapped < 0 ? wrapped + 360 : wrapped) - 180
  }

  /// A coordinate in the world's unit square: x eastwards and y southwards, from 0 to 1.
  static func project(_ coordinate: TileflowCoordinate) -> CGPoint {
    let latitude = min(maximumLatitude, max(-maximumLatitude, coordinate.latitude))
    let sine = sin(latitude * .pi / 180)
    return CGPoint(
      x: (coordinate.longitude + 180) / 360,
      y: 0.5 - log((1 + sine) / (1 - sine)) / (4 * .pi))
  }

  static func unproject(_ point: CGPoint) -> TileflowCoordinate {
    let y = (0.5 - Double(point.y)) * 2 * .pi
    return TileflowCoordinate(
      longitude: wrap(Double(point.x) * 360 - 180), latitude: atan(sinh(y)) * 180 / .pi)
  }

  /// Bounds as the web reports a view: longitudes within [-180, 180], an east edge west of the west
  /// edge across the antimeridian, and the whole world for a view wider than it.
  static func normalized(west: Double, south: Double, east: Double, north: Double)
    -> TileflowBounds
  {
    let width = east - west
    guard width < 360 else { return TileflowBounds(west: -180, south: south, east: 180, north: north) }
    let start = wrap(west)
    let end = start + width
    return TileflowBounds(west: start, south: south, east: end > 180 ? end - 360 : end, north: north)
  }

  /// The centre after zooming by `delta` levels while `anchor` stays where it is on screen.
  static func center(
    zoomingBy delta: Double, around anchor: TileflowCoordinate, from center: TileflowCoordinate
  ) -> TileflowCoordinate {
    let a = project(anchor)
    var c = project(center)
    // Across the antimeridian, the shorter way round.
    if c.x - a.x > 0.5 { c.x -= 1 } else if a.x - c.x > 0.5 { c.x += 1 }
    let scale = pow(2, -delta)
    return unproject(CGPoint(x: a.x + (c.x - a.x) * scale, y: a.y + (c.y - a.y) * scale))
  }

  /// The coordinate `offset` points away on screen, ignoring pitch. With a bearing, the top of the
  /// screen points that way, so screen vectors turn clockwise by the bearing onto the map.
  static func shifted(
    _ coordinate: TileflowCoordinate, by offset: CGPoint, zoom: Double, bearing: Double
  ) -> TileflowCoordinate {
    guard offset != .zero else { return coordinate }
    let world = 512 * pow(2, zoom)
    let angle = bearing * .pi / 180
    let x = Double(offset.x) * cos(angle) - Double(offset.y) * sin(angle)
    let y = Double(offset.x) * sin(angle) + Double(offset.y) * cos(angle)
    let point = project(coordinate)
    return unproject(CGPoint(x: Double(point.x) + x / world, y: Double(point.y) + y / world))
  }

  /// How long a flight lasts at `speed` screenfuls per second along the zoom and pan curve of van
  /// Wijk and Nuij, "Smooth and efficient zooming and panning" (2003). `curve` is the curve's ρ;
  /// `minZoom` sets the curve's highest point instead.
  static func flightDuration(
    from start: TileflowCamera, to end: TileflowCamera, size: CGSize, speed: Double, curve: Double,
    minZoom: Double?
  ) -> TimeInterval {
    let w0 = Double(max(size.width, size.height))
    guard w0 > 0, speed > 0 else { return 0 }
    let w1 = w0 / pow(2, end.zoom - start.zoom)
    let a = project(TileflowCoordinate(longitude: start.longitude, latitude: start.latitude))
    let b = project(TileflowCoordinate(longitude: end.longitude, latitude: end.latitude))
    var dx = Double(b.x - a.x)
    if dx > 0.5 { dx -= 1 } else if dx < -0.5 { dx += 1 }
    // The distance between the centres, in points at the starting zoom.
    let u1 = hypot(dx, Double(b.y - a.y)) * 512 * pow(2, start.zoom)
    var rho = curve
    if let minZoom, u1 > 0 {
      let peak = min(minZoom, start.zoom, end.zoom)
      rho = sqrt(w0 / pow(2, peak - start.zoom) / u1 * 2)
    }
    let rho2 = rho * rho
    func r(_ end: Bool) -> Double {
      let w = end ? w1 : w0
      let b = (w1 * w1 - w0 * w0 + (end ? -1 : 1) * rho2 * rho2 * u1 * u1) / (2 * w * rho2 * u1)
      return log(sqrt(b * b + 1) - b)
    }
    var length = (r(true) - r(false)) / rho
    if abs(u1) < 1e-6 || !length.isFinite {
      guard abs(w0 - w1) >= 1e-6 else { return 0 }
      length = abs(log(w1 / w0)) / rho
    }
    return length / speed
  }
}
