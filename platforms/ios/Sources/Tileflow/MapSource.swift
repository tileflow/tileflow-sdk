import Foundation

public struct TileflowRenderedFeature: Decodable, Equatable, Sendable {
  public let id: String?
  public let source: String
  public let layer: String
}

/// A logical Tileflow map in a versioned manifest.
public struct TileflowMapSource: Equatable, Sendable {
  public let map: String
  public let manifestURL: URL
  public let resourceOrigins: Set<URL>
  public let allowsLoopbackHTTP: Bool
  let client: TileflowClient?
  let mapID: String?
  let surfaceID: String?

  public init(
    map: String,
    manifestURL: URL,
    resourceOrigins: Set<URL> = [],
    allowsLoopbackHTTP: Bool = false
  ) {
    self.map = map
    self.manifestURL = manifestURL
    self.resourceOrigins = resourceOrigins
    self.allowsLoopbackHTTP = allowsLoopbackHTTP
    client = nil
    mapID = nil
    surfaceID = nil
  }

  init(client: TileflowClient, mapID: String, surfaceID: String, resourceOrigins: Set<URL>) {
    self.client = client
    self.mapID = mapID
    self.surfaceID = surfaceID
    map = "map"
    manifestURL = client.apiOrigin.appendingPathComponent("maps/\(mapID)/mobile/manifest.json")
    self.resourceOrigins = resourceOrigins
    allowsLoopbackHTTP = false
  }

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.map == rhs.map && lhs.manifestURL == rhs.manifestURL
      && lhs.resourceOrigins == rhs.resourceOrigins
      && lhs.allowsLoopbackHTTP == rhs.allowsLoopbackHTTP && lhs.client === rhs.client
      && lhs.mapID == rhs.mapID && lhs.surfaceID == rhs.surfaceID
  }

  var publicMetadataURLs: Set<URL> {
    guard let client, let mapID else { return [manifestURL] }
    return [
      manifestURL,
      client.apiOrigin.appendingPathComponent("maps/\(mapID)/mobile/webview-v1/manifest.json"),
    ]
  }

  func policy() throws -> ResourcePolicy {
    guard !map.isEmpty, map.count <= 128 else { throw TileflowMapError.invalidSource }
    let origins = Set(([manifestURL] + Array(resourceOrigins)).map(ResourcePolicy.origin))
    let policy = ResourcePolicy(origins: origins, allowsLoopbackHTTP: allowsLoopbackHTTP)
    try policy.validate(manifestURL)
    for origin in resourceOrigins { try policy.validate(origin) }
    return policy
  }
}

public struct TileflowCamera: Codable, Equatable, Sendable {
  public var longitude: Double
  public var latitude: Double
  public var zoom: Double
  public var bearing: Double
  public var pitch: Double

  public init(
    longitude: Double, latitude: Double, zoom: Double, bearing: Double = 0, pitch: Double = 0
  ) {
    self.longitude = longitude
    self.latitude = latitude
    self.zoom = zoom
    self.bearing = bearing
    self.pitch = pitch
  }
}
