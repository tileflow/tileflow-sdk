import Foundation

/// Application-owned Hosted configuration. Keep this object outside view construction and reuse it.
/// Credentials stay in native memory and are never included in renderer configuration or URLs.
public final class TileflowClient: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
  public let apiOrigin: URL
  private let mobileCredential: String

  public init(apiOrigin: URL, mobileCredential: String) throws {
    guard HostedContract.matches(mobileCredential, #"^tf_public_[0-9a-f]{48}$"#),
      HostedContract.canonicalOrigin(apiOrigin.absoluteString) != nil
    else { throw TileflowMapError.invalidSource }
    self.apiOrigin = apiOrigin
    self.mobileCredential = mobileCredential
  }

  /// Select a Hosted map. Additional origins are public resources and never receive a grant.
  public func map(
    _ mapID: String, surfaceID: String = "mobile-map",
    publicResourceOrigins: Set<URL> = []
  ) throws -> TileflowMapSource {
    guard HostedContract.matches(mapID, #"^map_[A-Za-z0-9_-]{16}$"#),
      HostedContract.matches(surfaceID, #"^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$"#),
      !HostedContract.secretShaped(surfaceID)
    else { throw TileflowMapError.invalidSource }
    return TileflowMapSource(
      client: self, mapID: mapID, surfaceID: surfaceID,
      resourceOrigins: publicResourceOrigins)
  }

  public var description: String { "TileflowClient" }
  public var debugDescription: String { description }

  func sessionRequest(mapID: String, sessionID: String, surfaceID: String) throws -> URLRequest {
    var request = URLRequest(
      url: apiOrigin.appendingPathComponent("v1/sessions/start"),
      cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(mobileCredential, forHTTPHeaderField: "X-Tileflow-Mobile-Client")
    request.httpBody = try JSONEncoder().encode([
      "mapId": mapID, "sessionId": sessionID, "surfaceId": surfaceID,
    ])
    return request
  }
}
