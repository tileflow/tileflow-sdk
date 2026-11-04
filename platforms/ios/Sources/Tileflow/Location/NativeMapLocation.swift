import CoreLocation
import MapLibre
import UIKit
import UIKit.UIGestureRecognizerSubclass

/// One renderer's location component. The view owns the provider and follow state across reloads.
@MainActor
final class NativeMapLocation {
  private struct Follow {
    let mode: TileflowFollowMode
    let revision: Int
    let minimumZoom: Double?
    let pitch: Double?
    let bearing: Double?
    let duration: TimeInterval
  }

  private unowned let engine: NativeMapEngine
  let manager = NativeLocationManager()
  private var puck: NativeLocationPuck?
  private var enabled = false
  private var visible = true
  private var bearing = TileflowPuckBearing.none
  private var accuracy = true
  private var staleAfter: TimeInterval = 30
  private var timer: Task<Void, Never>?
  private var staleDeadline: Date?
  private var follow: Follow?
  private var entering = false
  private var belowTrackingZoom = false
  private var generation = 0
  private var held = false
  private var received: Date?
  private var touches: LocationTouches?

  init(_ engine: NativeMapEngine) { self.engine = engine }

  func install(on map: MLNMapView) {
    map.shouldRequestAuthorizationToUseLocationServices = false
    map.displayHeadingCalibration = false
    map.dynamicNavigationCameraAnimationDuration = true
    map.locationManager = manager
    let touches = LocationTouches { [weak self] held in self?.hold(held) }
    touches.isEnabled = false
    map.addGestureRecognizer(touches)
    self.touches = touches
  }

  func makePuck() -> NativeLocationPuck {
    let view = NativeLocationPuck()
    puck = view
    view.apply(state)
    return view
  }

  func setOptions(_ value: JSONValue?) {
    let wasEnabled = enabled
    enabled = value?["enabled"]?.bool ?? false
    bearing = value?["bearing"]?.string.flatMap(TileflowPuckBearing.init(rawValue:)) ?? .none
    accuracy = value?["accuracy"]?.bool ?? true
    staleAfter = (value?["staleAfterMs"]?.number ?? 30_000) / 1000
    refresh()
    if wasEnabled != enabled, enabled { startFollow() }
  }

  func setVisible(_ shown: Bool) {
    guard visible != shown else { return }
    visible = shown
    if !shown { engine.camera?.stopLocation() }
    generation += 1
    entering = false
    refresh()
    if shown { startFollow() }
  }

  private var state: NativeLocationPuck.State {
    let fix = manager.fix
    let radius = fix?.horizontalAccuracy
    var direction: Double?
    if bearing == .heading { direction = manager.heading?.trueHeading }
    if bearing == .course, let course = fix?.course, course >= 0 { direction = course }
    return .init(
      accuracy: accuracy ? radius : nil, direction: direction,
      stale: fix.map { -$0.timestamp.timeIntervalSinceNow >= staleAfter } ?? false)
  }

  private func refresh() {
    guard let map = engine.mapView else { return }
    let show = enabled && visible && manager.fix != nil
    if map.showsUserLocation != show {
      map.showsUserLocation = show
      if show { manager.sendHeading() } else { puck = nil }
    }
    puck?.apply(state)
    let deadline = show ? manager.fix?.timestamp.addingTimeInterval(staleAfter) : nil
    guard staleDeadline != deadline else { return }
    staleDeadline = deadline
    timer?.cancel()
    timer = nil
    if let remaining = deadline?.timeIntervalSinceNow, remaining > 0 {
      timer = Task { @MainActor [weak self] in
        try? await Task.sleep(for: .seconds(remaining))
        guard !Task.isCancelled, let self else { return }
        self.puck?.apply(self.state)
      }
    }
  }

  func update(_ value: JSONValue) throws {
    let now = Date()
    let previous = received
    var nextFix = manager.fix
    var nextDirection = manager.heading?.trueHeading
    if let raw = value["location"] {
      if raw == .null {
        nextFix = nil
      } else {
        guard let lng = raw["longitude"]?.number, let lat = raw["latitude"]?.number,
          (-180...180).contains(lng), (-90...90).contains(lat)
        else { throw TileflowMapError.invalidRequest }
        let age = raw["age"]?.number ?? 0
        nextFix = CLLocation(
          coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
          altitude: 0, horizontalAccuracy: raw["accuracy"]?.number ?? -1, verticalAccuracy: -1,
          course: raw["course"]?.number ?? -1, speed: -1,
          timestamp: now.addingTimeInterval(-age / 1000))
      }
    }
    if let raw = value["heading"] {
      if raw == .null {
        nextDirection = nil
      } else {
        guard let heading = raw["direction"]?.number, (0...360).contains(heading) else {
          throw TileflowMapError.invalidRequest
        }
        nextDirection = heading
      }
    }
    let first = manager.fix == nil
    if value["location"] != nil {
      received = nextFix?.timestamp
      engine.camera?.locationChange { self.manager.set(fix: nextFix) }
    }
    if value["heading"] != nil { manager.set(direction: nextDirection) }
    refresh()
    guard follow != nil, !held, !entering else { return }
    if first || engine.mapView?.userTrackingMode == MLNUserTrackingMode.none && !belowTrackingZoom {
      startFollow()
    } else if belowTrackingZoom {
      let duration =
        value["location"] != nil
        ? min(1, max(0, previous.map { now.timeIntervalSince($0) } ?? 0)) : 0.25
      move(duration: duration)
    }
  }

  func setFollow(_ value: JSONValue) throws {
    guard let mode = value["mode"]?.string.flatMap(TileflowFollowMode.init(rawValue:)),
      let revision = Int(exactly: value["revision"]?.number ?? 0)
    else { throw TileflowMapError.invalidRequest }
    generation += 1
    entering = false
    belowTrackingZoom = false
    follow =
      mode == .none
      ? nil
      : Follow(
        mode: mode, revision: revision,
        minimumZoom: value["minimumZoom"]?.number, pitch: value["pitch"]?.number,
        bearing: value["bearing"]?.number, duration: (value["duration"]?.number ?? 0) / 1000)
    touches?.isEnabled = mode != .none
    if mode == .none {
      stopTracking()
      engine.camera?.stopLocation()
    } else {
      startFollow()
    }
  }

  private func target() -> TileflowCamera? {
    guard let follow, let camera = engine.camera?.current, let fix = manager.fix else { return nil }
    let angle: Double
    switch follow.mode {
    case .course: angle = fix.course >= 0 ? fix.course : camera.bearing
    case .heading: angle = manager.heading?.trueHeading ?? camera.bearing
    default: angle = follow.bearing ?? camera.bearing
    }
    return .init(
      longitude: fix.coordinate.longitude, latitude: fix.coordinate.latitude,
      zoom: max(camera.zoom, follow.minimumZoom ?? camera.zoom), bearing: angle,
      pitch: follow.pitch ?? camera.pitch)
  }

  private func startFollow() {
    guard !held, enabled, visible, let follow, let target = target(), let map = engine.mapView
    else { return }
    generation += 1
    let current = generation
    entering = true
    belowTrackingZoom = target.zoom < 10.5
    stopTracking()
    engine.camera?.moveForLocation(to: target, duration: follow.duration) { [weak self] in
      guard let self, self.generation == current, !self.held else { return }
      self.entering = false
      if self.belowTrackingZoom {
        // MapLibre's first tracking fix forces its own zoom below 10.5.
        self.move(duration: 0.25)
        return
      }
      let mode: MLNUserTrackingMode =
        switch follow.mode {
        case .heading: .followWithHeading
        case .course: .followWithCourse
        default: .follow
        }
      self.engine.camera?.locationChange {
        map.setUserTrackingMode(mode, animated: false, completionHandler: nil)
      }
      if follow.mode == .heading { self.manager.sendHeading() }
    }
  }

  private func move(duration: TimeInterval) {
    guard !held, enabled, visible, let target = target() else { return }
    engine.camera?.moveForLocation(to: target, duration: duration)
  }

  private func stopTracking() {
    guard let map = engine.mapView, map.userTrackingMode != .none else { return }
    engine.camera?.locationChange {
      map.setUserTrackingMode(.none, animated: false, completionHandler: nil)
    }
  }

  func interrupt(_ reason: TileflowFollowModeChangeReason) {
    guard let request = follow else { return }
    generation += 1
    follow = nil
    entering = false
    belowTrackingZoom = false
    stopTracking()
    if reason == .api { engine.camera?.stopLocation() }
    touches?.isEnabled = false
    engine.onEvent?(
      "followModeChanged",
      .object([
        "mode": .string("none"), "reason": .string(reason.rawValue),
        "revision": .number(Double(request.revision)),
      ]))
  }

  private func hold(_ value: Bool) {
    guard held != value else { return }
    held = value
    guard follow != nil else { return }
    if value {
      generation += 1
      entering = false
      stopTracking()
      engine.camera?.stopLocation()
    } else {
      startFollow()
    }
  }

  func retire() {
    follow = nil
    generation += 1
    timer?.cancel()
    if let touches { engine.mapView?.removeGestureRecognizer(touches) }
    engine.mapView?.showsUserLocation = false
    manager.delegate = nil
    puck = nil
  }
}

/// Watches touches without claiming them from the map or annotations.
final class LocationTouches: UIGestureRecognizer {
  private var fingers = Set<UITouch>()
  private let changed: (Bool) -> Void
  init(_ changed: @escaping (Bool) -> Void) {
    self.changed = changed
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
  }
  override func canPrevent(_ other: UIGestureRecognizer) -> Bool { false }
  override func canBePrevented(by other: UIGestureRecognizer) -> Bool { false }
  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    fingers.formUnion(touches)
    changed(true)
  }
  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    fingers.subtract(touches)
    if fingers.isEmpty {
      state = .failed
      changed(false)
    }
  }
  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    fingers.removeAll()
    state = .failed
    changed(false)
  }
  override func reset() {
    fingers.removeAll()
    changed(false)
    super.reset()
  }
}
