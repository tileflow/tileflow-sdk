import Foundation

extension TileflowMapView {
  /// Prepares the renderer, device profile, HTTP client and resource cache before the first map.
  /// Optional and idempotent. No map or location provider is created.
  public static func prewarm() {
    MapPrewarmer.start()
  }
}

@MainActor
private enum MapPrewarmer {
  private static let resources = Task.detached(priority: .utility) {
    _ = TileflowDeviceProfile.current
    _ = TileflowHTTPClient.shared
    _ = ResourceCacheStore.shared
  }
  private static let native = Task { _ = try? await MapLibreRuntime.prepare() }

  static func start() {
    _ = resources
    _ = native
  }
}
