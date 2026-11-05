import Foundation
import QuartzCore
import UIKit

/// The renderer's positions for one set of tracked points, keyed by what each point belongs to.
struct TrackedPositions {
  enum Key: Hashable {
    case view(ObjectIdentifier)
    case annotation(String)
  }
  /// The points of each set the renderer may still report, by revision.
  private(set) var sets: [Int: [Key]] = [:]
  private(set) var positions: [Key: CGPoint] = [:]
  private(set) var revision = 0

  /// Starts a new set; its positions apply once the renderer reports them.
  mutating func begin(_ keys: [Key]) -> Int {
    revision += 1
    sets[revision] = keys
    return revision
  }

  /// Applies one frame to its tracked set. A nil position hides its view.
  mutating func apply(revision: Int, points: [CGPoint?]) -> Bool {
    guard let keys = sets[revision], keys.count == points.count else { return false }
    for (key, point) in zip(keys, points) { positions[key] = point }
    sets = sets.filter { $0.key >= revision }
    let live = Set(sets.values.joined())
    positions = positions.filter { live.contains($0.key) }
    return true
  }

  mutating func rendererReplaced() {
    sets = [:]
    positions = [:]
  }
}

/// An annotation drawn by the renderer, as VoiceOver reaches it.
final class AnnotationAccessibilityElement: UIAccessibilityElement {
  var activate: () -> Bool = { false }
  override func accessibilityActivate() -> Bool { activate() }
}

/// Native view annotations over the map, and the accessibility elements of annotations the
/// renderer draws. It places them at the positions the renderer reports for the frame it drew,
/// at the next display refresh.
@MainActor
final class AnnotationOverlay: UIView {
  weak var map: TileflowMapView?
  private(set) var tracked = TrackedPositions()
  /// Tracks annotations for assistive technologies even when none runs; tests set it.
  var forcesAccessibilityTracking = false { didSet { trackingChanged() } }

  private var displayLink: CADisplayLink?
  private var idleRefreshes = 0
  private var needsPlacement = false
  private var trackingScheduled = false
  private var sending = false
  private var sentPoints: [[Double]]?
  private var sentKeys: [TrackedPositions.Key] = []
  private var installed: [ObjectIdentifier: TileflowViewAnnotation] = [:]
  private var elements: [String: AnnotationAccessibilityElement] = [:]
  private var accessible: [String: AccessibleAnnotation] = [:]

  override init(frame: CGRect) {
    super.init(frame: frame)
    clipsToBounds = true
    backgroundColor = .clear
    autoresizingMask = [.flexibleWidth, .flexibleHeight]
    for name in [
      UIAccessibility.voiceOverStatusDidChangeNotification,
      UIAccessibility.switchControlStatusDidChangeNotification,
    ] {
      NotificationCenter.default.addObserver(
        self, selector: #selector(assistiveTechnologyChanged), name: name, object: nil)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Not used.") }

  /// Touches reach annotation views only; elsewhere they go to the map.
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
    subviews.contains { view in
      !view.isHidden && view.isUserInteractionEnabled
        && view.point(inside: convert(point, to: view), with: event)
    }
  }

  @objc private func assistiveTechnologyChanged() { trackingChanged() }

  var tracksAccessibility: Bool {
    forcesAccessibilityTracking || UIAccessibility.isVoiceOverRunning
      || UIAccessibility.isSwitchControlRunning
  }

  // MARK: Tracked points

  /// The tracked set changed: send it to the renderer once the current change settles.
  func trackingChanged() {
    setNeedsPlacement()
    guard !trackingScheduled else { return }
    trackingScheduled = true
    Task { @MainActor [weak self] in
      guard let self else { return }
      self.trackingScheduled = false
      await self.sendTracking()
    }
  }

  /// What the renderer should follow: visible view annotations in the order they were added, then
  /// accessible annotations while an assistive technology runs.
  private func desiredTracking() -> ([TrackedPositions.Key], [[Double]]) {
    guard let map else { return ([], []) }
    var keys: [TrackedPositions.Key] = []
    var points: [[Double]] = []
    for annotation in map.viewAnnotations.annotations where annotation.visible {
      keys.append(.view(ObjectIdentifier(annotation)))
      points.append([annotation.coordinate.longitude, annotation.coordinate.latitude])
    }
    let entries = tracksAccessibility ? map.annotations.accessibleAnnotations : []
    accessible = Dictionary(entries.map { ($0.key, $0) }, uniquingKeysWith: { $1 })
    for entry in entries {
      keys.append(.annotation(entry.key))
      points.append([entry.coordinate.longitude, entry.coordinate.latitude])
    }
    let limit = MapContract.maximumTrackedPoints
    return (Array(keys.prefix(limit)), Array(points.prefix(limit)))
  }

  /// One set in flight; the latest set follows when it settles.
  private func sendTracking() async {
    guard let map, !sending else { return }
    let (keys, points) = desiredTracking()
    guard let engine = map.readyEngine, points != sentPoints || keys != sentKeys else { return }
    sending = true
    let revision = tracked.begin(keys)
    sentPoints = points
    sentKeys = keys
    let payload: JSONValue = .object([
      "revision": .number(Double(revision)),
      "points": .array(points.map { .array($0.map(JSONValue.number)) }),
    ])
    _ = try? await engine.call(.setTrackedPoints, payload: payload)
    sending = false
    let (nextKeys, nextPoints) = desiredTracking()
    if nextPoints != sentPoints || nextKeys != sentKeys { await sendTracking() }
  }

  /// A new renderer follows nothing until it receives the set again.
  func rendererReplaced() {
    tracked.rendererReplaced()
    sentPoints = nil
    sentKeys = []
    setNeedsPlacement()
  }

  /// MapLibre and its UIKit overlays are committed together for the frame it just rendered.
  func receiveNativeFrame(revision: Int, points: [CGPoint?]) {
    guard tracked.apply(revision: revision, points: points) else { return }
    needsPlacement = false
    place()
  }

  func setNeedsPlacement() {
    needsPlacement = true
    startRefreshes()
  }

  private func startRefreshes() {
    idleRefreshes = 0
    if let displayLink {
      displayLink.isPaused = false
      return
    }
    let link = CADisplayLink(
      target: DisplayLinkTarget(self), selector: #selector(DisplayLinkTarget.refresh))
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  func stopRefreshes() {
    displayLink?.invalidate()
    displayLink = nil
  }

  /// Places installed views when their anchors or visibility change between map frames.
  func refresh() {
    guard needsPlacement else {
      idleRefreshes += 1
      if idleRefreshes > 2 { displayLink?.isPaused = true }
      return
    }
    idleRefreshes = 0
    needsPlacement = false
    place()
  }

  // MARK: Placement

  func uninstall(_ annotation: TileflowViewAnnotation) {
    let key = ObjectIdentifier(annotation)
    guard installed.removeValue(forKey: key) != nil else { return }
    if annotation.view.superview === self { annotation.view.removeFromSuperview() }
  }

  private func place() {
    guard let map else { return }
    let annotations = map.viewAnnotations.annotations
    for annotation in annotations where installed[ObjectIdentifier(annotation)] == nil {
      installed[ObjectIdentifier(annotation)] = annotation
      annotation.view.isHidden = true
      addSubview(annotation.view)
    }
    let placed = ViewAnnotationPlacement.place(
      annotations.map { annotation in
        ViewAnnotationPlacement.Item(
          point: annotation.visible
            ? tracked.positions[.view(ObjectIdentifier(annotation))] : nil,
          size: annotation.size, anchors: annotation.variableAnchors,
          allowOverlap: annotation.allowOverlap, priority: annotation.priority,
          selected: annotation.selected, sequence: annotation.sequence)
      })
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    for (annotation, placement) in zip(annotations, placed) {
      if let placement {
        annotation.view.frame = placement.frame
        annotation.view.isHidden = false
      } else {
        annotation.view.isHidden = true
      }
    }
    CATransaction.commit()
    for (annotation, placement) in zip(annotations, placed) { annotation.place(placement?.anchor) }
  }

  // MARK: Accessibility

  /// View annotations and accessible annotations on screen, top to bottom, then leading to
  /// trailing.
  func orderedAccessibilityElements() -> [Any] {
    var items: [(frame: CGRect, element: Any)] = []
    guard let map else { return [] }
    for annotation in map.viewAnnotations.annotations where !annotation.isHidden {
      items.append((annotation.view.frame, annotation.view))
    }
    let size: CGFloat = 44
    var live = Set<String>()
    for (key, entry) in accessible {
      guard let point = tracked.positions[.annotation(key)],
        bounds.contains(point)
      else { continue }
      live.insert(key)
      let element = elements[key] ?? AnnotationAccessibilityElement(accessibilityContainer: self)
      elements[key] = element
      element.accessibilityLabel = entry.label
      element.accessibilityTraits = .button
      element.accessibilityFrameInContainerSpace = CGRect(
        x: point.x - size / 2, y: point.y - size / 2, width: size, height: size)
      let context = TileflowAnnotationInteractionContext(point: point, coordinate: entry.coordinate)
      element.activate = { entry.activate(context) }
      element.accessibilityCustomActions =
        entry.longPress.map { longPress in
          [UIAccessibilityCustomAction(name: "Long press") { _ in longPress(context) }]
        } ?? []
      items.append((element.accessibilityFrameInContainerSpace, element))
    }
    elements = elements.filter { live.contains($0.key) }
    let rtl = effectiveUserInterfaceLayoutDirection == .rightToLeft
    return items.sorted { a, b in
      if abs(a.frame.midY - b.frame.midY) > 1 { return a.frame.midY < b.frame.midY }
      return rtl ? a.frame.midX > b.frame.midX : a.frame.midX < b.frame.midX
    }.map(\.element)
  }

  override var accessibilityElements: [Any]? {
    get { orderedAccessibilityElements() }
    set {}
  }
}

/// Keeps the display link from retaining the overlay.
private final class DisplayLinkTarget: NSObject {
  weak var overlay: AnnotationOverlay?
  init(_ overlay: AnnotationOverlay) { self.overlay = overlay }
  @MainActor @objc func refresh() { overlay?.refresh() }
}
