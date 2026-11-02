import MapLibre
import XCTest

/// How far MapLibre Native iOS tilts the camera: the default limit, `maximumPitch` raised to 85,
/// and the limit with an asymmetric content inset.
@MainActor
final class PitchTests: XCTestCase {
  override func setUp() async throws {
    try await EngineNetwork.install()
  }

  /// A street grid around the centre, so the frames show the perspective.
  private static var style: String {
    var features: [[String: Any]] = []
    for step in -40...40 {
      let offset = Double(step) * 0.0025
      features.append(line([[-0.1, offset], [0.1, offset]]))
      features.append(line([[offset, -0.1], [offset, 0.1]]))
    }
    let style: [String: Any] = [
      "version": 8,
      "sources": ["grid": ["type": "geojson", "data": ["type": "FeatureCollection", "features": features]]],
      "layers": [
        ["id": "background", "type": "background", "paint": ["background-color": "#2040a0"]],
        [
          "id": "grid", "type": "line", "source": "grid",
          "paint": ["line-color": "#f0f0f0", "line-width": 2],
        ],
      ],
    ]
    return String(decoding: try! JSONSerialization.data(withJSONObject: style), as: UTF8.self)
  }

  private static func line(_ coordinates: [[Double]]) -> [String: Any] {
    [
      "type": "Feature", "properties": [:],
      "geometry": ["type": "LineString", "coordinates": coordinates],
    ]
  }

  func testPitch85() async throws {
    let harness = MapHarness()
    defer { harness.close() }
    let center = CLLocationCoordinate2D(latitude: 0, longitude: 0)
    harness.mapView.setCenter(center, zoomLevel: 15, animated: false)
    try await harness.load(styleJSON: Self.style)
    await harness.waitUntilRendered()
    var report: [String: Any] = [
      "device": SpikeEnvironment.device,
      "maplibre": Bundle(for: MLNMapView.self).infoDictionary?["CFBundleShortVersionString"] ?? "?",
      "date": ISO8601DateFormatter().string(from: Date()),
      "defaultMaximumPitch": harness.mapView.maximumPitch,
    ]

    func tilt(_ pitch: CGFloat, name: String) async -> [String: Any] {
      let baseline = harness.fullyRenderedFrames
      let camera = MLNMapCamera(
        lookingAtCenter: center, acrossDistance: 600, pitch: pitch, heading: 30)
      harness.mapView.setCamera(camera, animated: false)
      let rendered = await harness.waitUntilRendered(timeout: 10, after: baseline)
      let image = harness.snapshot()
      SpikeEnvironment.write(image, to: "pitch-\(name).png")
      let pixels = PixelReader(image)
      return [
        "requested": pitch, "camera": harness.mapView.camera.pitch,
        "maximumPitch": harness.mapView.maximumPitch, "fullyRendered": rendered,
        "topRow": pixels.hex(CGPoint(x: pixels.width / 2, y: 5)),
        "centre": pixels.hex(CGPoint(x: pixels.width / 2, y: pixels.height / 2)),
      ]
    }

    report["defaultLimit"] = await tilt(85, name: "default-limit")
    XCTAssertEqual(harness.mapView.camera.pitch, 60, accuracy: 0.01, "The default limit is 60")

    harness.mapView.maximumPitch = 85
    report["raised"] = await tilt(85, name: "85")
    XCTAssertEqual(harness.mapView.maximumPitch, 85, accuracy: 0.01)
    XCTAssertEqual(harness.mapView.camera.pitch, 85, accuracy: 0.01, "Pitch 85 is not reached")

    // An inset that moves the centre down limits the pitch the engine allows.
    harness.mapView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 300, right: 0)
    report["bottomInset300"] = await tilt(85, name: "85-bottom-inset")
    harness.mapView.contentInset = .zero

    // The core's absolute limit is 180°; record what larger values do.
    harness.mapView.maximumPitch = 89
    report["raised89"] = await tilt(89, name: "89")
    SpikeEnvironment.write(SpikeEnvironment.json(report), to: "pitch.json")
  }
}
