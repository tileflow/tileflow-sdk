import Foundation

/// The camera as the SDK last saw it, and the camera events the application receives.
///
/// The SDK subscribes to more camera events than an application may ask for: it follows every
/// movement to keep ``TileflowMapView/isMoving`` current, and every frame while a compass or scale
/// bar is shown. Events reach the application only at its chosen level and interval; the latest
/// camera of a throttled run is always delivered, and the settled camera always is.
@MainActor
final class CameraEventGate {
  private(set) var isMoving = false
  private var lastMoving: ContinuousClock.Instant?
  private var pending: Task<Void, Never>?

  /// Delivers `change` to the application if its options ask for it.
  func receive(
    _ change: TileflowCameraChange, options: TileflowEventOptions,
    deliver: @escaping @MainActor (TileflowCameraChange) -> Void
  ) {
    switch change.phase {
    case .started:
      isMoving = true
      if options.level.includes(.camera) { deliver(change) }
    case .moving:
      guard options.level.includes(.continuous) else { return }
      let interval = Duration.milliseconds(Int((options.cameraUpdateInterval * 1000).rounded()))
      let now = ContinuousClock.now
      if pending == nil, lastMoving.map({ now - $0 >= interval }) ?? true {
        lastMoving = now
        deliver(change)
        return
      }
      pending?.cancel()
      let due = (lastMoving ?? now) + interval
      pending = Task { @MainActor [weak self] in
        try? await Task.sleep(until: due, clock: .continuous)
        guard let self, !Task.isCancelled else { return }
        self.pending = nil
        self.lastMoving = ContinuousClock.now
        deliver(change)
      }
    case .ended:
      isMoving = false
      reset()
      deliver(change)
    }
  }

  /// A new renderer starts still; nothing pending from the previous one is delivered.
  func reset() {
    pending?.cancel()
    pending = nil
    lastMoving = nil
  }

  func rendererReplaced() {
    reset()
    isMoving = false
  }
}
