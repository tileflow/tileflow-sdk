import Foundation

/// Reads remote application images without the map's credentials or resource grants.
@_spi(TileflowReactNative)
public enum TileflowApplicationImageTransport {
  public static let maximumBytes = 32 * 1024 * 1024

  public static func load(_ url: URL) async throws -> Data {
    guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
      url.host?.isEmpty == false, url.user == nil, url.password == nil
    else { throw TileflowMapError.invalidRequest }

    let transport = NativeHTTPTransport(maximumBytes: maximumBytes, lane: .resources)
    defer { transport.close() }
    var request = URLRequest(url: url)
    request.httpShouldHandleCookies = false

    do {
      let response = try await transport.open(request)
      guard (200...299).contains(response.status) else { throw TileflowMapError.resourceFailed }
      let bytes = try await response.collect()
      try Task.checkCancellation()
      guard !bytes.isEmpty else { throw TileflowMapError.invalidRequest }
      return bytes
    } catch let error as TileflowMapError {
      throw error
    } catch ResourceError.responseTooLarge {
      throw TileflowMapError.invalidRequest
    } catch {
      try Task.checkCancellation()
      throw TileflowMapError.resourceFailed
    }
  }
}
