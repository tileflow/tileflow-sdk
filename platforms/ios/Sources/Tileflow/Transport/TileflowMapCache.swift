import Foundation

/// How much of the shared resource cache is in use.
public struct TileflowMapCacheUsage: Equatable, Sendable {
  /// Bytes on disk, including each entry's stored headers.
  public let bytes: Int64
  public let entries: Int
  /// The budget beyond which least recently used resources are removed.
  public let maximumBytes: Int64
  public let bytesByClass: [TileflowResourceClass: Int64]
}

/// The disk cache every map in the process shares.
///
/// Public resources such as styles, tiles, glyphs, sprites and 3D models are stored as their
/// `Cache-Control`, `ETag` and `Last-Modified` headers allow, revalidated when stale and reused by
/// every map and mount, also when the network is unavailable. A response marked `no-store` is
/// never written; Hosted maps' protected resources are served that way today. The budget comes
/// from ``TileflowDeviceProfile/current`` unless ``maximumBytes`` is set.
public enum TileflowMapCache {
  /// The bytes the cache may keep before it removes least recently used resources.
  public static var maximumBytes: Int64 {
    get { ResourceCacheStore.shared.maximumBytes }
    set { ResourceCacheStore.shared.maximumBytes = newValue }
  }

  /// Current usage. Waits for the cache to index what earlier launches stored.
  public static func usage() async -> TileflowMapCacheUsage {
    await Task.detached(priority: .utility) {
      let store = ResourceCacheStore.shared
      let usage = store.usage()
      return TileflowMapCacheUsage(
        bytes: usage.bytes, entries: usage.entries, maximumBytes: store.maximumBytes,
        bytesByClass: usage.bytesByClass)
    }.value
  }

  /// Removes every cached resource. Maps already showing keep what they have loaded and fetch
  /// anything else again.
  public static func clear() async {
    await Task.detached(priority: .utility) { ResourceCacheStore.shared.clear() }.value
  }
}
