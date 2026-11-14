import Foundation
import MapLibre
import MetalKit
import simd
import UIKit
import XCTest

@testable import Tileflow

/// Opt-in renderer proof. Fixed placement; model enumeration belongs to the fixture.
@MainActor
final class NativeTreeProofTests: XCTestCase {
  private func requireOptIn() throws {
    guard ProcessInfo.processInfo.environment["TILEFLOW_TREE_PROOF"] == "1" else {
      throw XCTSkip("Set TEST_RUNNER_TILEFLOW_TREE_PROOF=1 for this persistent two-process proof")
    }
  }

  private var root: URL {
    FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("tree-proof", isDirectory: true)
  }

  private func store() throws -> TileflowOfflineStore {
    let configuration = try fixtureConfiguration()
    return TileflowOfflineStore(dependencies: OfflineStoreCore.Dependencies(
      layout: OfflineLayout(root: root.appendingPathComponent("store")), cache: .shared,
      fetcher: OfflineURLSessionFetcher(configuration: .ephemeral,
        directory: root.appendingPathComponent("transfers")),
      client: { try OfflinePackClient(configuration: configuration) },
      availableBytes: { nil }, index: .shared, profile: .native))
  }

  func testTreeProofOnline() async throws {
    try requireOptIn()
    let manifest = URL(string: "\(FixtureServer.origin)/maps/\(Self.hostedFixtureMapID)/native/manifest.json")!
    try await requireMapFixture(manifest)
    let (data, _) = try await URLSession.shared.data(from: manifest)
    guard String(decoding: data, as: UTF8.self).contains("tree-proof") else {
      throw XCTSkip("Start the fixture with TILEFLOW_TREE_PROOF=1")
    }
    try? FileManager.default.removeItem(at: root)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    TileflowOfflineSwitch.shared.isNetworkEnabled = true
    await TileflowMapCache.clear()
    let store = try store()
    try await downloadRegion(store, id: "trees", options: .init(
      geometry: .boundingBox(.init(west: -3.701, south: 40.419, east: -3.699, north: 40.421)),
      content: .hosted(mapID: Self.hostedFixtureMapID, themes: ["tree-proof"]),
      minZoom: 15, maxZoom: 15))
    try await render(offline: false)
  }

  /// Run in a second test process after download. No fixture request is needed to reopen.
  func testTreeProofReopenOffline() async throws {
    try requireOptIn()
    guard FileManager.default.fileExists(atPath: root.appendingPathComponent("store").path) else {
      throw XCTSkip("Run testTreeProofOnline first")
    }
    await TileflowMapCache.clear()
    TileflowOfflineSwitch.shared.isNetworkEnabled = false
    defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
    let store = try store()
    let region = await store.region(id: "trees")
    XCTAssertEqual(region?.state, .complete)
    try await render(offline: true)
    let usage = await TileflowMapCache.usage()
    XCTAssertEqual(usage.entries, 0)
  }

  private func render(offline: Bool) async throws {
    let mounted = try await mountMap(.hosted(mapID: Self.hostedFixtureMapID,
      configuration: try fixtureConfiguration()), theme: "tree-proof",
      camera: .init(longitude: -3.7, latitude: 40.42, zoom: 18.5, bearing: 0, pitch: 60))
    defer { mounted.close() }
    let engine = try XCTUnwrap(mounted.view.engine as? NativeMapEngine)
    let map = try XCTUnwrap(engine.mapView)
    let url = URL(string: "\(FixtureServer.origin)/base/\(String(repeating: "a", count: 64))/models/streets-tree-round-near")!
    let payload = try await engine.loader.load(URLRequest(url: url))
    XCTAssertEqual(payload.status, 200)
    let resource = map.backendResource()
    let layer = try TreeProofLayer(model: payload.bytes, device: XCTUnwrap(resource.device),
      format: resource.mtkView.colorPixelFormat)
    try payload.bytes.write(to: root.appendingPathComponent(offline ? "offline.tftm" : "online.tftm"))
    map.style?.addLayer(layer)

    let output = root.appendingPathComponent(offline ? "offline" : "online")
    try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
    for bearing in [0.0, 45.0, 180.0] {
      try await mounted.view.setCamera(.init(longitude: -3.7, latitude: 40.42,
        zoom: 18.5, bearing: bearing, pitch: 60))
      try await Task.sleep(for: .milliseconds(450))
      let image = UIGraphicsImageRenderer(bounds: mounted.view.bounds).image { _ in
        _ = mounted.view.drawHierarchy(in: mounted.view.bounds, afterScreenUpdates: false)
      }
      try XCTUnwrap(image.pngData()).write(to: output.appendingPathComponent("bearing-\(Int(bearing)).png"))
    }
    // A control image shows the hidden parts of the back trees when the building is removed.
    map.style?.layer(withIdentifier: "proof-building")?.isVisible = false
    try await Task.sleep(for: .milliseconds(300))
    let control = UIGraphicsImageRenderer(bounds: mounted.view.bounds).image { _ in
      _ = mounted.view.drawHierarchy(in: mounted.view.bounds, afterScreenUpdates: false)
    }
    try XCTUnwrap(control.pngData()).write(to: output.appendingPathComponent("no-building.png"))
    XCTAssertNil(layer.failure)
    XCTAssertGreaterThan(layer.frames, 2)
    print("TREE_PROOF \(output.path) modelBytes=\(payload.bytes.count) frames=\(layer.frames)")
  }
}

/// Test-only Metal layer. Local metre coordinates avoid loss of precision at street zooms.
private final class TreeProofLayer: MLNCustomStyleLayer {
  struct Vertex { var position: SIMD4<Float>; var color: SIMD4<Float> }
  private var vertices: [Vertex] = []
  private var buffer: MTLBuffer?
  private var pipeline: MTLRenderPipelineState?
  private var depth: MTLDepthStencilState?
  private let device: any MTLDevice
  private let format: MTLPixelFormat
  private(set) var failure: String?
  private let renderedFrames = LockedValue(0)
  var frames: Int { renderedFrames.withLock { $0 } }

  init(model: Data, device: any MTLDevice, format: MTLPixelFormat) throws {
    self.device = device
    self.format = format
    super.init(identifier: "proof-trees")
    let bytes = [UInt8](model)
    func u16(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
    func s16(_ at: Int) -> Float { Float(Int16(bitPattern: UInt16(u16(at)))) / 32767 * 2 }
    guard bytes.count >= 16, Array(bytes.prefix(4)) == [84, 70, 84, 77], u16(4) == 1 else {
      throw NSError(domain: "TFTM", code: 1)
    }
    let count = u16(6), indices = u16(8) | u16(10) << 16
    guard count <= 4096, indices <= 3000, bytes.count == 16 + count * 12 + indices * 2 else {
      throw NSError(domain: "TFTM", code: 2)
    }
    let proportion = Float(u16(12)) / 1000
    let placements: [(Float, Float, Float)] = [(-10, -22, 14), (10, -22, 16), (-10, 22, 22), (10, 22, 20)]
    for (east, north, height) in placements {
      for index in 0..<indices {
        let vertex = u16(16 + count * 12 + index * 2)
        guard vertex < count else { throw NSError(domain: "TFTM", code: 3) }
        let at = 16 + vertex * 12
        let normal = SIMD3<Float>(Float(Int8(bitPattern: bytes[at + 6])),
          Float(Int8(bitPattern: bytes[at + 7])), Float(Int8(bitPattern: bytes[at + 8]))) / 127
        let light = (0.55 + 0.45 * max(0, simd_dot(normal, simd_normalize(SIMD3<Float>(-1, -1, 2)))))
          * (0.65 + 0.35 * Float(bytes[at + 11]) / 255)
        let color: SIMD3<Float> = bytes[at + 9] == 0 ? .init(0.35, 0.20, 0.10) : .init(0.18, 0.50, 0.16)
        vertices.append(.init(position: .init(east + s16(at) * height * proportion,
          north + s16(at + 2) * height * proportion, s16(at + 4) * height, 1),
          color: .init(color.x * light, color.y * light, color.z * light, 1)))
      }
    }
  }

  required init?(coder: NSCoder) { fatalError("Not a storyboard layer") }

  override func didMove(to mapView: MLNMapView) {
    do {
      let library = try device.makeLibrary(source: """
        #include <metal_stdlib>
        using namespace metal;
        struct Vertex { float4 position; float4 color; };
        struct Out { float4 position [[position]]; float4 color; };
        vertex Out vertexMain(uint i [[vertex_id]], constant Vertex *v [[buffer(0)]],
          constant float4x4 &matrix [[buffer(1)]]) {
          return {matrix * v[i].position, v[i].color};
        }
        fragment float4 fragmentMain(Out v [[stage_in]]) { return v.color; }
        """, options: nil)
      let descriptor = MTLRenderPipelineDescriptor()
      descriptor.vertexFunction = library.makeFunction(name: "vertexMain")
      descriptor.fragmentFunction = library.makeFunction(name: "fragmentMain")
      descriptor.colorAttachments[0].pixelFormat = format
      descriptor.depthAttachmentPixelFormat = .depth32Float_stencil8
      descriptor.stencilAttachmentPixelFormat = .depth32Float_stencil8
      pipeline = try device.makeRenderPipelineState(descriptor: descriptor)
      let state = MTLDepthStencilDescriptor()
      state.depthCompareFunction = .lessEqual
      state.isDepthWriteEnabled = true
      depth = device.makeDepthStencilState(descriptor: state)
      buffer = device.makeBuffer(bytes: vertices, length: vertices.count * MemoryLayout<Vertex>.stride)
    } catch { failure = String(describing: error) }
  }

  override func draw(in mapView: MLNMapView, with context: MLNStyleLayerDrawingContext) {
    guard let renderEncoder, let pipeline, let buffer, let depth else { return }
    let m = context.nearClippedProjectionMatrix
    let projection = simd_double4x4(columns: (
      .init(m.m00, m.m01, m.m02, m.m03), .init(m.m10, m.m11, m.m12, m.m13),
      .init(m.m20, m.m21, m.m22, m.m23), .init(m.m30, m.m31, m.m32, m.m33)))
    let world = 512 * exp2(context.zoomLevel)
    let latitude = 40.42 * Double.pi / 180
    let scale = world / (40075016.68557849 * cos(latitude))
    let x = (180 - 3.7) / 360 * world
    let y = (1 - asinh(tan(latitude)) / Double.pi) / 2 * world
    let local = simd_double4x4(columns: (
      .init(scale, 0, 0, 0), .init(0, -scale, 0, 0), .init(0, 0, 1, 0), .init(x, y, 0, 1)))
    let combined = projection * local
    var matrix = simd_float4x4(columns: (SIMD4<Float>(combined.columns.0),
      SIMD4<Float>(combined.columns.1), SIMD4<Float>(combined.columns.2), SIMD4<Float>(combined.columns.3)))
    renderEncoder.setRenderPipelineState(pipeline)
    renderEncoder.setDepthStencilState(depth)
    renderEncoder.setCullMode(.none)
    renderEncoder.setVertexBuffer(buffer, offset: 0, index: 0)
    renderEncoder.setVertexBytes(&matrix, length: MemoryLayout<simd_float4x4>.size, index: 1)
    renderEncoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: vertices.count)
    renderedFrames.withLock { $0 += 1 }
  }

  override func willMove(from mapView: MLNMapView) { buffer = nil; pipeline = nil; depth = nil }
}
