import UIKit

/// Camera movements. Points are in the view's coordinate system, in points; the renderer shares
/// the view's points, so no conversion is needed.
extension TileflowMapView {
  /// The camera the renderer last reported, kept current from its events without a call: when it
  /// settles, and while it moves when the application or a control follows it. Before the map
  /// loads, the camera it starts at, or nil for the map's authored view.
  public var currentCamera: TileflowCamera? { initialCamera }

  /// Whether the camera is moving, for an animation or a gesture, as of the last event.
  public var isMoving: Bool { cameraEvents.isMoving }

  /// Moves the camera and waits until it settles. Cancelling the calling task stops the movement
  /// and throws `CancellationError`.
  ///
  /// Before the map loads, a complete camera becomes the one it starts at and the call returns
  /// ``TileflowCameraAnimationResult/finished``; a partial update fails with
  /// ``TileflowMapError/notReady``.
  @discardableResult
  public func move(
    to update: TileflowCameraUpdate, animation: TileflowCameraAnimation = .none
  ) async throws -> TileflowCameraAnimationResult {
    try await move(to: update, animation: animation, reason: "api")
  }

  @discardableResult
  public func move(
    to camera: TileflowCamera, animation: TileflowCameraAnimation = .none
  ) async throws -> TileflowCameraAnimationResult {
    try await move(to: TileflowCameraUpdate(camera), animation: animation)
  }

  @discardableResult
  public func jump(to update: TileflowCameraUpdate) async throws -> TileflowCameraAnimationResult {
    try await move(to: update, animation: .none)
  }

  @discardableResult
  public func jump(to camera: TileflowCamera) async throws -> TileflowCameraAnimationResult {
    try await move(to: TileflowCameraUpdate(camera), animation: .none)
  }

  @discardableResult
  public func ease(
    to update: TileflowCameraUpdate, duration: TimeInterval = 0.5,
    easing: TileflowEasing = .standard
  ) async throws -> TileflowCameraAnimationResult {
    try await move(to: update, animation: .ease(duration: duration, easing: easing))
  }

  @discardableResult
  public func ease(
    to camera: TileflowCamera, duration: TimeInterval = 0.5, easing: TileflowEasing = .standard
  ) async throws -> TileflowCameraAnimationResult {
    try await ease(to: TileflowCameraUpdate(camera), duration: duration, easing: easing)
  }

  @discardableResult
  public func fly(
    to update: TileflowCameraUpdate, options: TileflowFlyOptions = .init()
  ) async throws -> TileflowCameraAnimationResult {
    try await move(to: update, animation: .fly(options))
  }

  @discardableResult
  public func fly(
    to camera: TileflowCamera, options: TileflowFlyOptions = .init()
  ) async throws -> TileflowCameraAnimationResult {
    try await fly(to: TileflowCameraUpdate(camera), options: options)
  }

  /// Frames `bounds` with `padding` points around them, inside the content insets, and waits
  /// until the camera settles. Fails with ``TileflowMapError/invalidRequest`` when the padding
  /// leaves no room.
  @discardableResult
  public func fit(
    _ bounds: TileflowBounds, padding: UIEdgeInsets = .zero, bearing: Double? = nil,
    pitch: Double? = nil, maxZoom: Double? = nil, animation: TileflowCameraAnimation = .none
  ) async throws -> TileflowCameraAnimationResult {
    let fit = try Self.fitValue(bounds, padding: padding, bearing: bearing, pitch: pitch, maxZoom: maxZoom)
    return try await send(.object(["fit": fit, "animation": try animation.wireValue]))
  }

  /// Stops the camera, whether the application or a person moved it. A movement the application
  /// started ends as ``TileflowCameraAnimationResult/cancelled``.
  public func stopCamera() {
    guard !destroyed, initialized, let bridge else { return }
    Task { _ = try? await bridge.call(.stopCamera) }
  }

  /// The camera that frames `bounds` with `padding` points around them, inside the content
  /// insets, without moving. Nil when the padding leaves no room.
  public func camera(
    for bounds: TileflowBounds, padding: UIEdgeInsets = .zero, bearing: Double? = nil,
    pitch: Double? = nil, maxZoom: Double? = nil
  ) async throws -> TileflowCamera? {
    guard !destroyed else { throw TileflowMapError.disposed }
    let fit = try Self.fitValue(bounds, padding: padding, bearing: bearing, pitch: pitch, maxZoom: maxZoom)
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    let result = try await bridge.call(.cameraForBounds, payload: fit)
    if case .null = result { return nil }
    guard let camera = TileflowCamera(wire: result) else { throw TileflowMapError.rendererFailed }
    return camera
  }

  /// The camera that frames every coordinate, for example a route's or a shape's, without moving.
  /// Nil without coordinates or when the padding leaves no room.
  public func camera(
    fitting coordinates: [TileflowCoordinate], padding: UIEdgeInsets = .zero,
    bearing: Double? = nil, pitch: Double? = nil, maxZoom: Double? = nil
  ) async throws -> TileflowCamera? {
    guard let bounds = TileflowBounds(enclosing: coordinates) else { return nil }
    return try await camera(
      for: bounds, padding: padding, bearing: bearing, pitch: pitch, maxZoom: maxZoom)
  }

  /// The region the view shows. A view that shows the horizon ends at MapLibre's horizon line; one
  /// that crosses the antimeridian has an east edge west of its west edge.
  public func visibleBounds() async throws -> TileflowBounds {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    guard let bounds = TileflowBounds(wire: try await bridge.call(.visibleBounds)) else {
      throw TileflowMapError.rendererFailed
    }
    return bounds
  }

  func move(
    to update: TileflowCameraUpdate, animation: TileflowCameraAnimation, reason: String
  ) async throws -> TileflowCameraAnimationResult {
    guard !destroyed else { throw TileflowMapError.disposed }
    let target = try update.wireValue()
    let animation = try animation.wireValue
    guard initialized else {
      guard update.center != nil, update.zoom != nil else { throw TileflowMapError.notReady }
      let camera = update.applied(to: initialCamera ?? .init(longitude: 0, latitude: 0, zoom: 0))
      try camera.validate()
      observe(camera)
      requestedCamera = (camera, (requestedCamera?.count ?? 0) + 1)
      return .finished
    }
    return try await send(
      .object(["target": target, "animation": animation, "reason": .string(reason)]))
  }

  private func send(_ payload: JSONValue) async throws -> TileflowCameraAnimationResult {
    guard !destroyed else { throw TileflowMapError.disposed }
    guard initialized, let bridge else { throw TileflowMapError.notReady }
    let result = try await bridge.call(.moveCamera, payload: payload)
    guard
      let completion = result["completion"]?.string.flatMap(
        TileflowCameraAnimationResult.init(rawValue:)),
      let camera = TileflowCamera(wire: result["camera"])
    else { throw TileflowMapError.rendererFailed }
    if bridge === self.bridge { observe(camera) }
    return completion
  }

  private static func fitValue(
    _ bounds: TileflowBounds, padding: UIEdgeInsets, bearing: Double?, pitch: Double?,
    maxZoom: Double?
  ) throws -> JSONValue {
    for inset in [padding.top, padding.left, padding.bottom, padding.right] {
      guard inset.isFinite, (0...8192).contains(inset) else { throw TileflowMapError.invalidRequest }
    }
    var fit: [String: JSONValue] = ["bounds": try bounds.wireValue(), "padding": wire(padding)]
    for (key, value, range) in [
      ("bearing", bearing, -360.0...360), ("pitch", pitch, 0.0...TileflowCameraLimits.maximumPitch),
      ("maxZoom", maxZoom, 0.0...24),
    ] {
      guard let value else { continue }
      guard range.contains(value) else { throw TileflowMapError.invalidRequest }
      fit[key] = .number(value)
    }
    return .object(fit)
  }
}
