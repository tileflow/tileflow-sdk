import MapLibre
import UIKit
import XCTest

/// An `MLNMapView` on screen in the host application's window scene, with what it reported.
@MainActor
final class MapHarness: NSObject, MLNMapViewDelegate {
  let window: UIWindow
  let mapView: MLNMapView
  private(set) var styleLoaded = false
  private(set) var loadFailure: Error?
  private(set) var fullyRenderedFrames = 0
  private(set) var renderedFrames = 0
  /// Fully rendered frames counted when the last style load started.
  private var loadBaseline = 0
  private(set) var missingImages: [String] = []
  private var styleWaiters: [CheckedContinuation<Void, Error>] = []
  private var renderWaiters: [CheckedContinuation<Void, Never>] = []

  init(size: CGSize = CGSize(width: 390, height: 844)) {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
    window.frame = CGRect(origin: .zero, size: size)
    let controller = UIViewController()
    window.rootViewController = controller
    // `MLNMapView(frame:)` loads MapLibre's demo style from demotiles.maplibre.org; an empty
    // style document keeps the engine off the network until the real style arrives.
    mapView = MLNMapView(frame: window.bounds, styleJSON: #"{"version":8,"sources":{},"layers":[]}"#)
    super.init()
    mapView.delegate = self
    mapView.logoView.isHidden = true
    mapView.attributionButton.isHidden = true
    mapView.automaticallyAdjustsContentInset = false
    mapView.contentInset = .zero
    controller.view.addSubview(mapView)
    window.makeKeyAndVisible()
  }

  func close() {
    mapView.delegate = nil
    mapView.removeFromSuperview()
    window.isHidden = true
  }

  /// Gives the engine a style document and waits until it loaded it.
  func load(styleJSON: String, timeout: TimeInterval = 30) async throws {
    styleLoaded = false
    loadFailure = nil
    loadBaseline = fullyRenderedFrames
    mapView.styleJSON = styleJSON
    try await waitForStyle(timeout: timeout)
  }

  func waitForStyle(timeout: TimeInterval) async throws {
    if styleLoaded { return }
    if let loadFailure { throw loadFailure }
    try await withThrowingTaskGroup(of: Void.self) { group in
      group.addTask { @MainActor in
        try await withCheckedThrowingContinuation { self.styleWaiters.append($0) }
      }
      group.addTask {
        try await Task.sleep(nanoseconds: UInt64(timeout * 1_000_000_000))
        throw NSError(
          domain: "MapHarness", code: 1, userInfo: [NSLocalizedDescriptionKey: "style timeout"])
      }
      try await group.next()
      group.cancelAll()
    }
  }

  /// Waits until the engine reports a fully rendered map after `baseline` (by default, since the
  /// last style load started), then lets one more frame reach the screen. Returns false when the
  /// deadline passes first.
  @discardableResult
  func waitUntilRendered(timeout: TimeInterval = 30, after baseline: Int? = nil) async -> Bool {
    let before = baseline ?? loadBaseline
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if fullyRenderedFrames > before { break }
      try? await Task.sleep(nanoseconds: 50_000_000)
    }
    try? await Task.sleep(nanoseconds: 300_000_000)
    return fullyRenderedFrames > before
  }

  /// The window as the screen shows it, including the engine's Metal layer.
  func snapshot() -> UIImage {
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(bounds: window.bounds, format: format).image { _ in
      window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
    }
  }

  // MARK: MLNMapViewDelegate

  nonisolated func mapView(_ mapView: MLNMapView, didFinishLoading style: MLNStyle) {
    MainActor.assumeIsolated {
      styleLoaded = true
      let waiters = styleWaiters
      styleWaiters = []
      for waiter in waiters { waiter.resume() }
    }
  }

  nonisolated func mapViewDidFailLoadingMap(_ mapView: MLNMapView, withError error: Error) {
    MainActor.assumeIsolated {
      loadFailure = error
      let waiters = styleWaiters
      styleWaiters = []
      for waiter in waiters { waiter.resume(throwing: error) }
    }
  }

  nonisolated func mapViewDidFinishRenderingFrame(
    _ mapView: MLNMapView, fullyRendered: Bool
  ) {
    MainActor.assumeIsolated {
      renderedFrames += 1
      if fullyRendered { fullyRenderedFrames += 1 }
    }
  }

  nonisolated func mapView(_ mapView: MLNMapView, didFailToLoadImage imageName: String) -> UIImage? {
    MainActor.assumeIsolated { missingImages.append(imageName) }
    return nil
  }
}

/// Reads pixels of a rendered image.
struct PixelReader {
  let width: Int
  let height: Int
  private let bytes: [UInt8]

  init(_ image: UIImage) {
    let cgImage = image.cgImage!
    width = cgImage.width
    height = cgImage.height
    var bytes = [UInt8](repeating: 0, count: width * height * 4)
    let context = CGContext(
      data: &bytes, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
    self.bytes = bytes
  }

  /// RGB at `point` in the image's coordinates, top-left origin.
  func rgb(_ point: CGPoint) -> (r: Int, g: Int, b: Int) {
    let x = min(max(Int(point.x), 0), width - 1)
    let y = min(max(Int(point.y), 0), height - 1)
    let offset = (y * width + x) * 4
    return (Int(bytes[offset]), Int(bytes[offset + 1]), Int(bytes[offset + 2]))
  }

  /// Whether `point` is within `tolerance` of `hex` on every channel.
  func matches(_ point: CGPoint, _ hex: UInt32, tolerance: Int = 12) -> Bool {
    let pixel = rgb(point)
    let expected = (Int(hex >> 16 & 0xff), Int(hex >> 8 & 0xff), Int(hex & 0xff))
    return abs(pixel.r - expected.0) <= tolerance && abs(pixel.g - expected.1) <= tolerance
      && abs(pixel.b - expected.2) <= tolerance
  }

  func hex(_ point: CGPoint) -> String {
    let pixel = rgb(point)
    return String(format: "#%02x%02x%02x", pixel.r, pixel.g, pixel.b)
  }

  /// How many of the sampled points in `rect` are within `tolerance` of `hex`.
  func count(in rect: CGRect, step: Int = 4, _ hex: UInt32, tolerance: Int = 12) -> Int {
    var total = 0
    for y in stride(from: Int(rect.minY), to: Int(rect.maxY), by: step) {
      for x in stride(from: Int(rect.minX), to: Int(rect.maxX), by: step)
      where matches(CGPoint(x: x, y: y), hex, tolerance: tolerance) {
        total += 1
      }
    }
    return total
  }
}
