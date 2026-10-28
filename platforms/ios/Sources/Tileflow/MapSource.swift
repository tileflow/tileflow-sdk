import Foundation

public struct TileflowRenderedFeature: Decodable, Equatable, Sendable {
  public let id: String?
  public let source: String
  public let layer: String
}

/// The map a view shows: a Hosted map selected by its ID, or a versioned manifest you serve.
public struct TileflowMapSource: Equatable, Sendable {
  public let map: String
  /// The manifest of a map you serve. Nil for a Hosted map, whose manifest the configured API
  /// origin serves.
  public let manifestURL: URL?
  public let resourceOrigins: Set<URL>
  public let allowsLoopbackHTTP: Bool
  /// The ID of a Hosted map. Nil for a manifest you serve.
  public let mapID: String?
  let surfaceID: String?
  let configuration: TileflowConfiguration?

  /// A map in a versioned manifest you serve. It needs no credential.
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
    mapID = nil
    surfaceID = nil
    configuration = nil
  }

  private init(
    mapID: String, surfaceID: String, resourceOrigins: Set<URL>,
    configuration: TileflowConfiguration?
  ) {
    map = "map"
    manifestURL = nil
    self.resourceOrigins = resourceOrigins
    allowsLoopbackHTTP = false
    self.mapID = mapID
    self.surfaceID = surfaceID
    self.configuration = configuration
  }

  /// A Hosted map, selected by its ID.
  ///
  /// When the map loads, it reads its credential and API origin from `configuration`, or else
  /// from ``Tileflow/configuration()``: the configuration set with ``Tileflow/configure(_:)``, or
  /// else the `TileflowMapCredential` and `TileflowAPIOrigin` keys of the application's
  /// Info.plist. Only the map credential authorizes a map; a services credential never does.
  /// Without a map credential the map fails with ``TileflowMapError/missingCredential``, and with
  /// an unreadable configuration with ``TileflowMapError/invalidConfiguration``.
  ///
  /// - Parameters:
  ///   - mapID: The map's ID, such as `map_0123456789abcdef`.
  ///   - surfaceID: A stable name for where the application shows the map, which divides the
  ///     map's session analytics when it appears in several places.
  ///   - publicResourceOrigins: Origins of public resources the map's styles use. They never
  ///     receive a Hosted grant.
  ///   - configuration: Overrides ``Tileflow/configuration()`` for this map.
  public static func hosted(
    mapID: String, surfaceID: String = "mobile-map", publicResourceOrigins: Set<URL> = [],
    configuration: TileflowConfiguration? = nil
  ) -> TileflowMapSource {
    TileflowMapSource(
      mapID: mapID, surfaceID: surfaceID, resourceOrigins: publicResourceOrigins,
      configuration: configuration)
  }

  /// Checks what does not depend on the configuration.
  func validate() throws {
    guard !map.isEmpty, map.count <= 128 else { throw TileflowMapError.invalidSource }
    if let mapID {
      guard HostedContract.matches(mapID, #"^map_[A-Za-z0-9_-]{16}$"#),
        let surfaceID,
        HostedContract.matches(surfaceID, #"^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$"#),
        !HostedContract.secretShaped(surfaceID)
      else { throw TileflowMapError.invalidSource }
    }
    _ = try policy(for: manifestURL)
  }

  private func policy(for manifestURL: URL?) throws -> ResourcePolicy {
    let urls = (manifestURL.map { [$0] } ?? []) + Array(resourceOrigins)
    let policy = ResourcePolicy(
      origins: Set(urls.map(ResourcePolicy.origin)), allowsLoopbackHTTP: allowsLoopbackHTTP)
    do { for url in urls { try policy.validate(url) } } catch {
      throw TileflowMapError.invalidSource
    }
    return policy
  }

  /// What the view loads. A Hosted map reads its endpoint from `configuration`, or else from
  /// `fallback`, which is the process configuration outside tests.
  func loadable(
    fallback: () throws -> TileflowConfiguration = { try Tileflow.configuration() }
  ) throws -> LoadableMapSource {
    try validate()
    var hosted: HostedEndpoint?
    var manifestURL = manifestURL
    var publicMetadataURLs: Set<URL> = []
    if let mapID {
      let configuration: TileflowConfiguration
      do { configuration = try self.configuration ?? fallback() } catch {
        throw TileflowMapError.invalidConfiguration
      }
      let endpoint = try HostedEndpoint(configuration)
      hosted = endpoint
      manifestURL = endpoint.manifestURL(mapID: mapID)
      publicMetadataURLs.insert(endpoint.discoveryURL(mapID: mapID))
    }
    guard let manifestURL else { throw TileflowMapError.invalidSource }
    publicMetadataURLs.insert(manifestURL)
    return LoadableMapSource(
      map: map, manifestURL: manifestURL, mapID: mapID, surfaceID: surfaceID,
      policy: try policy(for: manifestURL), publicMetadataURLs: publicMetadataURLs, hosted: hosted)
  }
}

/// A source with its configuration read: the manifest, resource policy and Hosted endpoint a view
/// loads. A view keeps it, and its Hosted session, until its source changes.
struct LoadableMapSource: Sendable {
  let map: String
  let manifestURL: URL
  let mapID: String?
  let surfaceID: String?
  let policy: ResourcePolicy
  let publicMetadataURLs: Set<URL>
  let hosted: HostedEndpoint?
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

public enum TileflowMapError: Error, Equatable, Sendable {
  case invalidSource
  case missingRuntime
  case incompatibleRuntime
  case notReady
  case disposed
  case timeout
  case resourceFailed
  case rendererFailed
  case invalidRequest
  case credentialRejected
  case accessDenied
  case quotaExceeded
  case rateLimited
  case sessionUnavailable
  case invalidSessionResponse
  /// A Hosted map has no map credential: set `TileflowMapCredential` in the Info.plist, or pass
  /// one to ``Tileflow/configure(_:)`` or in the configuration of the map's source. A services
  /// credential never authorizes a map.
  case missingCredential
  /// A Hosted map's configuration cannot be read: an Info.plist value is invalid, or the API
  /// origin is not HTTPS. ``Tileflow/configuration()`` throws the detailed error.
  case invalidConfiguration
}

public enum TileflowMapEvent: Sendable {
  /// A user activated an attribution link. The application decides how to present it.
  case externalLinkRequested(URL)
  case annotationActivated(id: String, coordinate: TileflowCoordinate)
  case poiActivated(TileflowPoiSelection)
  case loading
  /// The renderer emitted its initial load event; this is not a native compositor frame receipt.
  case contentReady
  case cameraChanged(TileflowCamera, isFinal: Bool)
  case tap(longitude: Double, latitude: Double)
  case themeChanged(String)
  case failed(TileflowMapError)
}
