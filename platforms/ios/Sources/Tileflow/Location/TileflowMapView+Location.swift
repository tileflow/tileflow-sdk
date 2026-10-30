import Foundation

/// The person's location on the map: where the positions come from, and how the camera follows
/// them. ``TileflowMapOptions/location`` shows the location.
extension TileflowMapView {
  /// Where the map's positions and headings come from; nil uses a
  /// ``TileflowDefaultLocationProvider`` that the map creates when it first shows the location.
  public var locationProvider: (any TileflowLocationProvider)? {
    get { location.custom }
    set {
      location.custom = newValue
      location.consume(provider: nil)
      refreshLocation()
    }
  }

  /// The latest position the map received, or nil before the first.
  public var latestLocation: TileflowLocation? { location.latest }

  /// How the camera follows the location. A gesture that moves the map, and a camera movement the
  /// application asks for, set it to ``TileflowFollowMode/none`` and report
  /// ``TileflowMapEvent/followModeChanged(_:)``. The camera follows only while
  /// ``TileflowLocationOptions/enabled``; setting a mode before keeps it until then.
  public var followMode: TileflowFollowMode {
    get { location.follow.mode }
    set {
      guard !isDestroyed else { return }
      let previous = location.follow.mode
      guard location.follow.set(newValue) else { return }
      sendFollowMode(entering: previous == .none, duration: 1)
    }
  }

  /// Starts or stops taking positions from the provider: only while the location is shown and the
  /// map is visible, so a hidden map never keeps the location measured.
  func refreshLocation() {
    guard !isDestroyed else { return location.consume(provider: nil) }
    location.consume(provider: options.location.enabled && isShown ? location.provider : nil)
  }

  /// The location options changed: turning the location off ends following.
  func locationOptionsChanged(from previous: TileflowLocationOptions) {
    if previous.enabled, !options.location.enabled { endFollowing(.api) }
    refreshLocation()
  }

  /// Ends following because a person or the application moved the camera, reporting the change.
  func endFollowing(_ reason: TileflowFollowModeChangeReason) {
    guard let change = location.follow.end(reason) else { return }
    // The renderer may not know yet, for example when the location was turned off.
    sendFollowMode(entering: false, duration: 0)
    onEvent?(.followModeChanged(change))
  }

  /// The recenter button follows the location while the map shows it.
  func recenterTapped() {
    guard options.location.enabled else {
      onEvent?(.recenterRequested)
      return
    }
    let entering = location.follow.mode == .none
    let change = location.follow.recenter()
    sendFollowMode(entering: entering, duration: entering ? 1 : 0.5)
    onEvent?(.followModeChanged(change))
  }

  /// The compass turns the map to north. While following, it keeps following the position.
  func compassTapped() {
    guard options.location.enabled, location.follow.mode != .none else {
      Task { [weak self] in
        _ = try? await self?.move(
          to: .init(bearing: 0), animation: .ease(duration: 0.3), reason: "gesture")
      }
      return
    }
    let change = location.follow.compass()
    sendFollowMode(entering: false, duration: 0.3, bearing: 0)
    if let change { onEvent?(.followModeChanged(change)) }
  }

  func receiveFollowModeChanged(_ value: JSONValue) {
    guard
      let reason = value["reason"]?.string.flatMap(TileflowFollowModeChangeReason.init(rawValue:)),
      let revision = value["revision"]?.number, Int(revision) == location.revision
    else { return }
    // The renderer ended the request the view sent last; a later request is still in force.
    endFollowing(reason)
  }

  /// Gives a new renderer the latest position, heading and follow mode.
  func replayLocation(through bridge: MapBridge) async throws {
    if let payload = location.payload(location: true, heading: true) {
      _ = try await bridge.call(.updateLocation, payload: payload)
    }
    if location.follow.mode != .none {
      // A mode set before the first renderer still zooms in as it starts to follow.
      let entering = location.pendingEntry
      location.pendingEntry = false
      _ = try await bridge.call(
        .setFollowMode, payload: followPayload(entering: entering, duration: entering ? 1 : 0))
    }
  }

  private func sendFollowMode(entering: Bool, duration: TimeInterval, bearing: Double? = nil) {
    location.revision += 1
    controlsView.followMode = location.follow.mode
    guard let bridge = readyBridge else {
      location.pendingEntry = location.follow.mode != .none && (entering || location.pendingEntry)
      return
    }
    let payload = followPayload(entering: entering, duration: duration, bearing: bearing)
    Task { _ = try? await bridge.call(.setFollowMode, payload: payload) }
  }

  private func followPayload(entering: Bool, duration: TimeInterval, bearing: Double? = nil)
    -> JSONValue
  {
    var payload: [String: JSONValue] = [
      "mode": .string(location.follow.mode.wireValue),
      "duration": .number((duration * 1000).rounded()),
      "revision": .number(Double(location.revision)),
    ]
    if entering, let zoom = options.location.followZoom { payload["minimumZoom"] = .number(zoom) }
    if let bearing { payload["bearing"] = .number(bearing) }
    return .object(payload)
  }
}

/// The map's side of its location: the provider it takes positions from, the latest of them, the
/// follow mode, and one update in flight to the renderer at a time with the latest values.
@MainActor
final class MapLocation: TileflowLocationConsumer {
  weak var view: TileflowMapView?
  var custom: (any TileflowLocationProvider)?
  private var fallback: TileflowDefaultLocationProvider?
  private var consumed: (any TileflowLocationProvider)?
  private(set) var latest: TileflowLocation?
  private(set) var heading: TileflowHeading?
  var follow = FollowModeState()
  /// The view's count of its follow requests; see `followModeChanged`.
  var revision = 0
  /// Whether the renderer has yet to start following a mode set before it could.
  var pendingEntry = false
  private var locationChanged = false
  private var headingChanged = false
  private var sending = false

  var provider: any TileflowLocationProvider {
    if let custom { return custom }
    if let fallback { return fallback }
    let created = TileflowDefaultLocationProvider()
    fallback = created
    return created
  }

  func consume(provider next: (any TileflowLocationProvider)?) {
    guard consumed !== next else { return }
    consumed?.removeConsumer(self)
    consumed = next
    next?.addConsumer(self)
  }

  func locationUpdated(_ location: TileflowLocation) {
    guard location.isValid else { return }
    latest = location
    locationChanged = true
    flush()
  }

  func headingUpdated(_ heading: TileflowHeading) {
    guard heading.direction.isFinite else { return }
    self.heading = heading
    headingChanged = true
    flush()
  }

  /// Sends what changed once the previous update is answered, so updates never queue up.
  func flush() {
    guard !sending, locationChanged || headingChanged, let bridge = view?.readyBridge,
      let payload = payload(location: locationChanged, heading: headingChanged)
    else { return }
    locationChanged = false
    headingChanged = false
    sending = true
    Task { [weak self] in
      _ = try? await bridge.call(.updateLocation, payload: payload)
      guard let self else { return }
      self.sending = false
      self.flush()
    }
  }

  func payload(location includeLocation: Bool, heading includeHeading: Bool) -> JSONValue? {
    var payload: [String: JSONValue] = [:]
    if includeLocation, let latest {
      payload["location"] = Self.wire(latest)
    }
    if includeHeading, let heading {
      payload["heading"] = .object(["direction": .number(Self.normalized(heading.direction))])
    }
    return payload.isEmpty ? nil : .object(payload)
  }

  nonisolated static func normalized(_ degrees: Double) -> Double {
    let value = degrees.truncatingRemainder(dividingBy: 360)
    return value < 0 ? value + 360 : value
  }

  /// A position as the renderer takes it: its age is measured now, so a replay ages correctly.
  nonisolated static func wire(_ location: TileflowLocation, now: Date = Date()) -> JSONValue {
    var fix: [String: JSONValue] = [
      "longitude": .number(location.coordinate.longitude),
      "latitude": .number(location.coordinate.latitude),
      "age": .number(min(max(now.timeIntervalSince(location.timestamp) * 1000, 0), 86_400_000)),
    ]
    if let accuracy = location.horizontalAccuracy {
      fix["accuracy"] = .number(min(accuracy, 1_000_000))
    }
    if let course = location.course, course.isFinite { fix["course"] = .number(normalized(course)) }
    return .object(fix)
  }
}
