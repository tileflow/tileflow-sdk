import MapLibre
import Metal
import XCTest

/// Draws a map whose style needs no network and checks the pixels the engine put on screen: a
/// background and a polygon in known colours. Runs without the fixture server.
@MainActor
final class RenderingTests: XCTestCase {
  static let background: UInt32 = 0x2040a0
  static let fill: UInt32 = 0xe03020

  static let style: [String: Any] = [
    "version": 8,
    "sources": [
      "shapes": [
        "type": "geojson",
        "data": [
          "type": "Feature", "properties": [:],
          "geometry": [
            "type": "Polygon",
            "coordinates": [[[-5, -5], [5, -5], [5, 5], [-5, 5], [-5, -5]]],
          ],
        ],
      ]
    ],
    "layers": [
      ["id": "background", "type": "background", "paint": ["background-color": "#2040a0"]],
      ["id": "square", "type": "fill", "source": "shapes", "paint": ["fill-color": "#e03020"]],
    ],
  ]

  func testTheEngineDrawsAStyleOnScreen() async throws {
    let harness = MapHarness()
    defer { harness.close() }
    harness.mapView.setCenter(CLLocationCoordinate2D(latitude: 0, longitude: 0), zoomLevel: 4, animated: false)
    let json = String(decoding: try JSONSerialization.data(withJSONObject: Self.style), as: UTF8.self)
    try await harness.load(styleJSON: json)
    let rendered = await harness.waitUntilRendered()
    let image = harness.snapshot()
    SpikeEnvironment.write(image, to: "rendering-basic.png")
    let pixels = PixelReader(image)
    let center = CGPoint(x: pixels.width / 2, y: pixels.height / 2)
    let corner = CGPoint(x: 10, y: 10)
    let metal = MTLCreateSystemDefaultDevice()
    let report: [String: Any] = [
      "device": SpikeEnvironment.device, "fullyRendered": rendered,
      "maplibre": Bundle(for: MLNMapView.self).infoDictionary?["CFBundleShortVersionString"] ?? "?",
      "date": ISO8601DateFormatter().string(from: Date()),
      "metalDevice": metal?.name ?? "none",
      "metalApple7": metal?.supportsFamily(.apple7) ?? false,
      "metalMac2": metal?.supportsFamily(.mac2) ?? false,
      "frames": harness.renderedFrames, "center": pixels.hex(center), "corner": pixels.hex(corner),
      "fillPixels": pixels.count(in: CGRect(x: 0, y: 0, width: pixels.width, height: pixels.height), Self.fill),
    ]
    SpikeEnvironment.write(SpikeEnvironment.json(report), to: "rendering-basic.json")
    print("Rendering evidence: \(SpikeEnvironment.json(report))")
    XCTAssertTrue(rendered, "The engine never reported a fully rendered frame")
    XCTAssertTrue(pixels.matches(center, Self.fill), "Center is \(pixels.hex(center))")
    XCTAssertTrue(pixels.matches(corner, Self.background), "Corner is \(pixels.hex(corner))")
  }
}
