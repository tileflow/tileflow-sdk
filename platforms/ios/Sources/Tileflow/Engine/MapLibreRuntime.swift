import MapLibre
import Metal

/// Requirements shared by views and standalone snapshots.
@MainActor
enum MapLibreRuntime {
  struct Capabilities {
    let metalAvailable: Bool
    let version: String?

    static let current = Capabilities(
      metalAvailable: MTLCreateSystemDefaultDevice()?.makeCommandQueue() != nil,
      version: Bundle(for: MLNMapView.self).object(
        forInfoDictionaryKey: "CFBundleShortVersionString") as? String)
  }

  static func prepare(_ capabilities: Capabilities = .current) async throws {
    guard capabilities.metalAvailable else {
      throw TileflowMapError(
        .unsupportedDevice, context: .init(message: "Metal could not create a command queue."))
    }
    guard capabilities.version == NativeStyleSpecification.rendererVersion else {
      throw TileflowMapError(
        .unsupportedDevice,
        context: .init(message: "The loaded MapLibre framework does not match the SDK version."))
    }

    try await MapLibreNetwork.prepare()
  }
}
