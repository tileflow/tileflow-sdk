import Foundation

/// Where a Hosted map starts its sessions, and the map credential it presents there.
///
/// The credential stays in native memory. It is sent only in the session-start request, never to
/// the renderer, a resource request or a URL, and descriptions and reflection never include it.
struct HostedEndpoint: Sendable, CustomStringConvertible, CustomDebugStringConvertible {
  let apiOrigin: URL
  /// A local development API: HTTP on `localhost` or `127.0.0.1`. Only then may the session's
  /// resource origins be loopback HTTP origins too.
  let isLoopbackHTTP: Bool
  private let credential: TileflowCredential

  /// Reads the map credential and the API origin. Services credentials never authorize a map.
  /// The API origin follows the configuration's own rule, the one the service clients use: HTTPS,
  /// or HTTP on a loopback host.
  init(_ configuration: TileflowConfiguration) throws {
    guard let credential = configuration.mapCredential else {
      throw TileflowMapError.missingCredential
    }
    guard
      let origin = TileflowConfiguration.normalizedOrigin(configuration.apiOrigin.absoluteString),
      origin.scheme == "http" || HostedContract.canonicalOrigin(origin.absoluteString) != nil
    else { throw TileflowMapError.invalidConfiguration }
    apiOrigin = origin
    isLoopbackHTTP = origin.scheme == "http"
    self.credential = credential
  }

  var description: String { "HostedEndpoint(apiOrigin: \(apiOrigin.absoluteString))" }
  var debugDescription: String { description }

  func manifestURL(mapID: String) -> URL {
    apiOrigin.appendingPathComponent("maps/\(mapID)/mobile/manifest.json")
  }

  func discoveryURL(mapID: String) -> URL {
    apiOrigin.appendingPathComponent("maps/\(mapID)/mobile/webview-v1/manifest.json")
  }

  func sessionRequest(mapID: String, sessionID: String, surfaceID: String) throws -> URLRequest {
    var request = URLRequest(
      url: apiOrigin.appendingPathComponent("v1/sessions/start"),
      cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 30)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(credential.value, forHTTPHeaderField: "X-Tileflow-Mobile-Client")
    request.httpBody = try JSONEncoder().encode([
      "mapId": mapID, "sessionId": sessionID, "surfaceId": surfaceID,
    ])
    return request
  }
}
