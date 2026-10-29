import Foundation

/// Turns Tileflow's network use off and on for the whole process, after Mapbox's offline switch.
///
/// Switched off, no map, session or download reaches the network. Maps use only downloaded
/// regions and the shared cache, whatever their freshness; a resource that neither holds answers
/// at once as a cache miss, with status 504 as an HTTP cache answers `only-if-cached`, and the map
/// reports it as a `resourceFailed` warning instead of waiting. Hosted maps open from their
/// downloaded regions without starting a session. Downloads wait, and continue when the network
/// is switched on again.
public final class TileflowOfflineSwitch: Sendable {
  public static let shared = TileflowOfflineSwitch()

  private init() {}

  /// True by default.
  public var isNetworkEnabled: Bool {
    get { TileflowHTTPClient.shared.isNetworkEnabled }
    set {
      let changed = TileflowHTTPClient.shared.isNetworkEnabled != newValue
      TileflowHTTPClient.shared.isNetworkEnabled = newValue
      if changed, newValue {
        Task { await TileflowOfflineStore.shared.core.networkDidConnect() }
      }
    }
  }
}
