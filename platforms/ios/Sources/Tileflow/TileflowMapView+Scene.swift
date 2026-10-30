import Foundation

/// A scene request the view keeps, so a new renderer receives it again. Its data is registered on
/// the renderer's data channel each time it is sent.
struct SceneCommand {
  let method: ProtocolContract.Method
  /// The payload and the data it carries; `replaying` applies it at once, without a transition.
  let build: @MainActor (DataChannel, _ replaying: Bool) throws -> (JSONValue, [DataChannel.Reference])

  init(_ method: ProtocolContract.Method, payload: JSONValue) {
    self.method = method
    self.build = { _, replaying in (replaying ? Self.immediate(payload) : payload, []) }
  }

  init(
    _ method: ProtocolContract.Method,
    build: @escaping @MainActor (DataChannel, Bool) throws -> (JSONValue, [DataChannel.Reference])
  ) {
    self.method = method
    self.build = build
  }

  static func immediate(_ payload: JSONValue) -> JSONValue {
    guard case .object(var value) = payload, value["duration"] != nil else { return payload }
    value["duration"] = .number(0)
    return .object(value)
  }
}

/// The scene beyond the theme that the application asked for, in the order a renderer needs it:
/// images before the markers that show them.
struct SceneState {
  var images: SceneCommand?
  var depthMarkers: SceneCommand?
  var sun: SceneCommand?
  var emphasis: SceneCommand?
  var styleStates: [(name: String, command: SceneCommand)] = []
  var boundaries: SceneCommand?

  var commands: [SceneCommand] {
    [images, depthMarkers, sun, emphasis].compactMap { $0 } + styleStates.map(\.command)
      + [boundaries].compactMap { $0 }
  }

  mutating func setStyleState(_ name: String, _ command: SceneCommand) {
    styleStates.removeAll { $0.name == name }
    styleStates.append((name, command))
  }
}

/// Calls that wait for an animation of the current renderer to end.
@MainActor
final class AnimationWaiters {
  private var waiting: [String: CheckedContinuation<Bool, any Error>] = [:]
  private var cues: [String: (String) -> Void] = [:]
  /// Ends that arrived before their call learned the animation's identifier.
  private var ended: [String: Bool] = [:]

  func wait(for id: String, onCue: ((String) -> Void)?) async throws -> Bool {
    if let finished = ended.removeValue(forKey: id) { return finished }
    if let onCue { cues[id] = onCue }
    return try await withCheckedThrowingContinuation { waiting[id] = $0 }
  }

  func receive(_ event: String, _ value: JSONValue) {
    guard let id = value["animation"]?.string else { return }
    switch event {
    case "shotCue":
      if let cue = value["cue"]?.string { cues[id]?(cue) }
    case "animationEnded":
      let finished = value["finished"]?.bool ?? false
      cues.removeValue(forKey: id)
      if let continuation = waiting.removeValue(forKey: id) {
        continuation.resume(returning: finished)
      } else if ended.count < 64 {
        ended[id] = finished
      }
    default: break
    }
  }

  /// Stops waiting for one animation, as when its caller is cancelled.
  func abandon(_ id: String, with error: any Error) {
    cues.removeValue(forKey: id)
    waiting.removeValue(forKey: id)?.resume(throwing: error)
  }

  /// The renderer is replaced or destroyed; its animations end with it.
  func retire(_ error: TileflowMapError) {
    let pending = waiting.values
    waiting.removeAll()
    cues.removeAll()
    ended.removeAll()
    for continuation in pending { continuation.resume(throwing: error) }
  }
}

extension TileflowMapView {
  /// Changes between the flat map and its 3D scene. With a duration, the buildings rise from the
  /// ground or sink into it; ``TileflowMapOptions/viewMode`` changes at once.
  public func setViewMode(_ mode: TileflowViewMode, duration: TimeInterval = 0) async throws {
    guard !isDestroyed else { throw TileflowMapError.disposed }
    guard (0...5).contains(duration) else { throw TileflowMapError.invalidRequest }
    var next = options
    next.viewMode = mode
    // The view mode is kept with the options, so a new renderer starts in it.
    keepOptions(next)
    guard let bridge = readyBridge else { return }
    _ = try await bridge.call(
      .setViewMode,
      payload: .object([
        "viewMode": .string(mode.rawValue), "duration": .number((duration * 1000).rounded()),
      ]))
  }

  /// Places the sun by direction or by the real sun of a date and place; nil returns it to the
  /// themes' suns. The sun turns the short way round over `duration`.
  public func setSun(_ sun: TileflowSun?, duration: TimeInterval = 0) async throws {
    let value: JSONValue
    switch sun {
    case nil: value = .null
    case .direction(let azimuth, let altitude):
      guard (-360...360).contains(azimuth), (-90...90).contains(altitude) else {
        throw TileflowMapError.invalidRequest
      }
      value = .object(["azimuth": .number(azimuth), "altitude": .number(altitude)])
    case .date(let date, let location):
      var request: [String: JSONValue] = [
        "date": .number((date.timeIntervalSince1970 * 1000).rounded())
      ]
      if let location {
        guard (-180...180).contains(location.longitude), (-90...90).contains(location.latitude)
        else { throw TileflowMapError.invalidRequest }
        request["location"] = try .encoded(location)
      }
      value = .object(request)
    }
    try await sendScene(
      SceneCommand(.setSun, payload: .object(["sun": value, "duration": try milliseconds(duration)])),
      keep: { $0.sun = $1 })
  }

  /// Makes chosen modules of the map recede and its labels fade, so the application's content
  /// reads first; nil returns the map to its design.
  public func setEmphasis(_ emphasis: TileflowEmphasis?, duration: TimeInterval = 0) async throws {
    let transition = try milliseconds(duration)
    guard let emphasis else {
      try await sendScene(
        SceneCommand(.setEmphasis, payload: .object(["emphasis": .null, "duration": transition])),
        keep: { $0.emphasis = $1 })
      return
    }
    guard emphasis.recede.count <= 64,
      emphasis.recede.allSatisfy({
        HostedContract.matches($0.key.rawValue, #"^[a-z][a-z0-9-]{0,63}$"#)
          && (0...1).contains($0.value)
      }),
      emphasis.labels.map({ (0...1).contains($0) }) ?? true,
      emphasis.keepArea.map({ !$0.isEmpty && $0.count <= ProtocolContract.maximumDataBytes })
        ?? true
    else { throw TileflowMapError.invalidRequest }
    var request: [String: JSONValue] = [:]
    if !emphasis.recede.isEmpty {
      request["recede"] = .object(
        Dictionary(uniqueKeysWithValues: emphasis.recede.map { ($0.key.rawValue, .number($0.value)) }))
    }
    if let labels = emphasis.labels { request["labels"] = .number(labels) }
    let fixed = request
    let keep = emphasis.keepArea
    let digest = keep.map(DataChannel.digest)
    try await sendScene(
      SceneCommand(.setEmphasis) { channel, replaying in
        var value = fixed
        var references: [DataChannel.Reference] = []
        if let keep, let digest {
          let reference = try channel.register(
            keep, digest: digest, contentType: "application/geo+json")
          references.append(reference)
          value["keep"] = reference.wireValue
        }
        return (
          .object(["emphasis": .object(value), "duration": replaying ? .number(0) : transition]),
          references
        )
      },
      keep: { $0.emphasis = $1 })
  }

  /// Sets a style-wide state that the map's themes read with `globalState`. A number eases from
  /// the value it shows to the new one over `duration`; states stay through theme changes.
  public func setStyleState(
    _ name: String, to value: TileflowStyleValue, duration: TimeInterval = 0
  ) async throws {
    guard HostedContract.matches(name, #"^\S(.{0,126}\S)?$"#) else {
      throw TileflowMapError.invalidRequest
    }
    switch value {
    case .number(let number) where !number.isFinite: throw TileflowMapError.invalidRequest
    case .string(let text) where text.count > 1024: throw TileflowMapError.invalidRequest
    default: break
    }
    try await sendScene(
      SceneCommand(
        .setStyleState,
        payload: .object([
          "name": .string(name), "value": value.wireValue, "duration": try milliseconds(duration),
        ])),
      keep: { $0.setStyleState(name, $1) })
  }

  /// The route inks of the theme on screen, mixed during a blend. Layers drawn with a
  /// ``TileflowRouteInk`` follow them without this call.
  public func routeInks() async throws -> TileflowRouteInks {
    let value = try await requireRenderer().call(.getRouteInks)
    guard let inks = try? JSONDecoder().decode(
      TileflowRouteInks.self, from: JSONEncoder().encode(value))
    else { throw TileflowMapError.rendererFailed }
    return inks
  }

  /// Sets the application's values on the map's Boundaries areas, for a choropleth that reads
  /// them; nil removes them. Rows travel on the data channel.
  public func setBoundaryValues(_ values: TileflowBoundaryValues?) async throws {
    guard let values else {
      try await sendScene(
        SceneCommand(.setBoundaryValues, payload: .object(["values": .null])),
        keep: { $0.boundaries = $1 })
      return
    }
    let (joinBy, rows) = try values.rowsJSON()
    guard rows.count <= ProtocolContract.maximumDataBytes else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataBytes)
    }
    let digest = DataChannel.digest(rows)
    try await sendScene(
      SceneCommand(.setBoundaryValues) { channel, _ in
        let reference = try channel.register(rows, digest: digest, contentType: "application/json")
        return (
          .object([
            "values": .object(["joinBy": .string(joinBy), "rows": reference.wireValue]),
            "labels": .bool(values.labels), "state": .string(values.state),
          ]),
          [reference]
        )
      },
      keep: { $0.boundaries = $1 })
  }

  /// Replaces the application's images. Unchanged images are neither sent nor decoded again.
  public func setImages(_ images: [TileflowMapImage]) async throws {
    guard images.count <= 64, Set(images.map(\.name)).count == images.count else {
      throw TileflowMapError.invalidRequest
    }
    let payloads = images.flatMap { [$0.data] + $0.variants.values }
    let total = Dictionary(payloads.map { (DataChannel.digest($0), $0.count) }, uniquingKeysWith: { a, _ in a })
      .values.reduce(0, +)
    guard total <= ProtocolContract.maximumDataTotalBytes,
      Set(payloads.map(DataChannel.digest)).count <= ProtocolContract.maximumDataReferences
    else {
      throw TileflowMapError(
        .invalidRequest, reason: .dataTooLarge, limit: ProtocolContract.maximumDataTotalBytes)
    }
    let previousImages = self.images
    self.images = images
    do {
      try await sendScene(
        SceneCommand(.setImages) { channel, _ in
          var references: [DataChannel.Reference] = []
          do {
            let register = { (bytes: Data) throws -> JSONValue in
              let reference = try channel.register(
                bytes, digest: DataChannel.digest(bytes), contentType: "application/octet-stream")
              references.append(reference)
              return reference.wireValue
            }
            let value = try images.map { image -> JSONValue in
              var entry: [String: JSONValue] = [
                "name": .string(image.name), "data": try register(image.data),
                "pixelRatio": .number(image.pixelRatio),
              ]
              if image.sdf { entry["sdf"] = .bool(true) }
              if !image.variants.isEmpty {
                entry["variants"] = .object(
                  try image.variants.mapValues { try register($0) })
              }
              return .object(entry)
            }
            return (.object(["images": .array(value)]), references)
          } catch {
            channel.release(references)
            throw error
          }
        },
        keep: { $0.images = $1 })
    } catch let error as TileflowMapError where error == .invalidRequest {
      // A refused request is not kept, as the scene does not keep it.
      self.images = previousImages
      throw error
    }
  }

  /// Replaces the markers drawn in the map's 3D scene. Each names an image passed with
  /// ``setImages(_:)``.
  public func setDepthMarkers(_ markers: [TileflowDepthMarker]) async throws {
    guard markers.count <= 128, Set(markers.map(\.id)).count == markers.count else {
      throw TileflowMapError.invalidRequest
    }
    let value = JSONValue.object(["markers": .array(try markers.map { try $0.wireValue() })])
    try await sendScene(SceneCommand(.setDepthMarkers, payload: value), keep: { $0.depthMarkers = $1 })
  }

  /// Moves the drawn stretch of line layers drawn with progress, together, over `duration`
  /// (up to 60 seconds). Returns true when they get there and false when another change stops
  /// them first. Cancelling the calling task stops them where they are.
  @discardableResult
  public func animateLineProgress(
    layers: [String], to progress: TileflowLineProgress, duration: TimeInterval
  ) async throws -> Bool {
    try progress.validate()
    guard (1...16).contains(layers.count), Set(layers).count == layers.count,
      layers.allSatisfy({ HostedContract.matches($0, #"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"#) }),
      (0...60).contains(duration)
    else { throw TileflowMapError.invalidRequest }
    let bridge = try requireRenderer()
    let started = try await bridge.call(
      .animateLineProgress,
      payload: .object([
        "layers": .array(layers.map(JSONValue.string)), "to": progress.stateWireValue,
        "duration": .number((duration * 1000).rounded()),
      ]))
    // A new renderer draws the lines where the animation leads.
    keepLineProgress(progress, for: Set(layers))
    return try await awaitAnimation(started, on: bridge, onCue: nil)
  }

  /// Plays a camera shot and returns true when it reaches its last keyframe, or false when a
  /// gesture, another shot or a renderer replacement stops it. `onCue` is called with each cue's
  /// identifier as the shot reaches it. Cancelling the calling task stops the shot.
  @discardableResult
  public func play(_ shot: TileflowShot, onCue: (@MainActor (String) -> Void)? = nil)
    async throws -> Bool
  {
    let payload = try shot.wireValue()
    let bridge = try requireRenderer()
    endFollowing(.api)
    let started = try await bridge.call(.playShot, payload: payload)
    return try await awaitAnimation(started, on: bridge, onCue: onCue)
  }

  private func awaitAnimation(
    _ started: JSONValue, on bridge: MapBridge, onCue: ((String) -> Void)?
  ) async throws -> Bool {
    guard let id = started["animation"]?.string else { throw TileflowMapError.rendererFailed }
    let waiters = animations
    return try await withTaskCancellationHandler {
      try await waiters.wait(for: id, onCue: onCue)
    } onCancel: {
      Task { @MainActor [weak bridge] in
        waiters.abandon(id, with: CancellationError())
        _ = try? await bridge?.call(.stopAnimation, payload: .object(["animation": .string(id)]))
      }
    }
  }

  private func requireRenderer() throws -> MapBridge {
    guard !isDestroyed else { throw TileflowMapError.disposed }
    guard let bridge = readyBridge else { throw TileflowMapError.notReady }
    return bridge
  }

  private func milliseconds(_ duration: TimeInterval) throws -> JSONValue {
    guard (0...5).contains(duration) else { throw TileflowMapError.invalidRequest }
    return .number((duration * 1000).rounded())
  }

  /// Keeps a scene request for later renderers and sends it to the current one.
  private func sendScene(
    _ command: SceneCommand, keep: (inout SceneState, SceneCommand) -> Void
  ) async throws {
    guard !isDestroyed else { throw TileflowMapError.disposed }
    let previous = scene
    keep(&scene, command)
    guard let bridge = readyBridge else { return }
    do {
      try await send(command, through: bridge, replaying: false)
    } catch let error as TileflowMapError where error == .invalidRequest {
      // A request the renderer refuses is not given to the next one either.
      scene = previous
      throw error
    }
  }

  private func send(_ command: SceneCommand, through bridge: MapBridge, replaying: Bool)
    async throws
  {
    let (payload, references) = try command.build(bridge.data, replaying)
    _ = try await bridge.call(command.method, payload: payload, data: references)
  }

  /// Gives a new renderer the scene the application asked for, at once.
  func replayScene(through bridge: MapBridge) async throws {
    for command in scene.commands { try await send(command, through: bridge, replaying: true) }
  }
}
