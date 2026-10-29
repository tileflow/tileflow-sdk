import UIKit

/// Claims the touches that move the map from scroll views, page views and sheets around it.
///
/// Their pan gestures wait until this recognizer fails, and it never fails while the map is being
/// moved, so a drag on the map moves the map rather than what contains it. With cooperative
/// gestures one finger fails it at once, so the container scrolls, and two fingers move the map.
/// It never cancels the renderer's own touches.
@MainActor
final class MapTouchClaim: UIGestureRecognizer, UIGestureRecognizerDelegate {
  var gestures = TileflowGestures()

  init() {
    super.init(target: nil, action: nil)
    cancelsTouchesInView = false
    delaysTouchesBegan = false
    delaysTouchesEnded = false
    delegate = self
  }

  override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesBegan(touches, with: event)
    guard gestures.movesMap else {
      state = .failed
      return
    }
    if state == .possible, !gestures.cooperative || numberOfTouches >= 2 { state = .began }
  }

  override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesMoved(touches, with: event)
    switch state {
    case .possible: if gestures.cooperative, numberOfTouches < 2 { state = .failed }
    case .began, .changed: state = .changed
    default: break
    }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesEnded(touches, with: event)
    finish(touches, with: event)
  }

  override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
    super.touchesCancelled(touches, with: event)
    finish(touches, with: event)
  }

  private func finish(_ touches: Set<UITouch>, with event: UIEvent) {
    let remaining = (event.touches(for: self) ?? []).subtracting(touches).filter {
      $0.phase != .ended && $0.phase != .cancelled
    }
    guard remaining.isEmpty else { return }
    state = state == .possible ? .failed : .ended
  }

  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool { true }

  /// Pans of the views that contain the map wait for this recognizer to fail.
  func gestureRecognizer(
    _ gestureRecognizer: UIGestureRecognizer,
    shouldBeRequiredToFailBy otherGestureRecognizer: UIGestureRecognizer
  ) -> Bool {
    guard otherGestureRecognizer is UIPanGestureRecognizer, let map = view,
      let container = otherGestureRecognizer.view
    else { return false }
    return container !== map && map.isDescendant(of: container)
  }
}
