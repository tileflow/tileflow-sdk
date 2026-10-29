import Foundation

/// The zooms a region downloads, with the per-product limits Hosted packs apply.
///
/// World stops at its deepest zoom, 15, which has layers no other zoom has; deeper pack zooms
/// overzoom World and add only sources that go deeper, such as Team Tilesets. Terrain stops at
/// zoom 12 unless a region opts in to 13 or 14, which hold most of a pack's bytes.
struct OfflineZooms: Sendable, Hashable {
  static let maximum = 22
  static let worldMaximum = 15
  static let defaultTerrainMaximum = 12

  var range: ClosedRange<Int>
  var terrainMaximum: Int

  init(range: ClosedRange<Int> = 0...worldMaximum, terrainMaximum: Int = defaultTerrainMaximum)
    throws
  {
    guard range.lowerBound >= 0, range.upperBound <= Self.maximum else {
      throw TileflowOfflineError.options("invalidZoom")
    }
    guard (0...Self.maximum).contains(terrainMaximum) else {
      throw TileflowOfflineError.options("invalidTerrainZoom")
    }
    self.range = range
    self.terrainMaximum = terrainMaximum
  }

  /// A source's zooms in a pack: clamped to its own range, so deeper pack zooms overzoom its
  /// deepest tiles. Nil when every pack zoom is below its minimum, where it draws nothing.
  func zooms(sourceMinimum: Int, sourceMaximum: Int) -> ClosedRange<Int>? {
    guard range.upperBound >= sourceMinimum else { return nil }
    let low = min(max(range.lowerBound, sourceMinimum), sourceMaximum)
    return low...min(range.upperBound, sourceMaximum)
  }
}

/// What a Hosted region downloads, after Mapbox's tile region load options: the area, the Map's
/// themes and the zooms.
struct TileflowOfflineRegionLoadOptions: Sendable, Hashable {
  var geometry: TileflowOfflineGeometry
  /// 1 to 4 theme names of the Map; a single-style Map's theme is `default`.
  var themes: [String]
  var zooms: OfflineZooms
}

/// The renderer whose styles a pack holds.
enum OfflinePackProfile: String, Sendable {
  case webView = "webview-v1"
  case native = "native-v1"
}

/// One `POST /v1/offline/packs` body in the service's canonical form.
struct OfflinePackRequest: Sendable, Hashable {
  let mapID: String
  let profile: String
  /// Distinct and sorted, as the service returns them.
  let themes: [String]
  let region: OfflinePackRegion
  let minZoom: Int
  let maxZoom: Int
  let terrainMaxZoom: Int

  static let maximumBodyBytes = 65_536

  /// One request for each pack the options need: a corridor or a box across the antimeridian
  /// downloads as several packs.
  static func requests(
    mapID: String, options: TileflowOfflineRegionLoadOptions,
    profile: OfflinePackProfile = .webView
  ) throws -> [OfflinePackRequest] {
    guard HostedContract.matches(mapID, #"^map_[A-Za-z0-9_-]{16}$"#) else {
      throw TileflowOfflineError.options("invalidMapID")
    }
    let themes = Array(Set(options.themes)).sorted()
    guard (1...4).contains(options.themes.count), themes.count == options.themes.count,
      themes.allSatisfy({ HostedContract.matches($0, #"^[A-Za-z][A-Za-z0-9_-]{0,63}$"#) })
    else { throw TileflowOfflineError.options("invalidThemes") }
    return try options.geometry.packRegions().map { region in
      let request = OfflinePackRequest(
        mapID: mapID, profile: profile.rawValue, themes: themes, region: region,
        minZoom: options.zooms.range.lowerBound, maxZoom: options.zooms.range.upperBound,
        terrainMaxZoom: options.zooms.terrainMaximum)
      guard request.body.count <= maximumBodyBytes else {
        throw TileflowOfflineError.region("tooManyPositions")
      }
      return request
    }
  }

  var body: Data {
    let value: JSONValue = .object([
      "mapId": .string(mapID), "profile": .string(profile),
      "themes": .array(themes.map(JSONValue.string)), "region": region.json,
      "minZoom": .number(Double(minZoom)), "maxZoom": .number(Double(maxZoom)),
      "terrainMaxZoom": .number(Double(terrainMaxZoom)),
    ])
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return (try? encoder.encode(value)) ?? Data()
  }
}

/// Creates and revalidates Hosted offline packs.
///
/// Creation presents the map credential exactly as a Hosted map's session start does, in
/// `X-Tileflow-Mobile-Client`, and nothing else. Revalidation presents only the pack grant.
/// Requests are never retried: each refusal comes back as a typed error, with the wait the service
/// asked for, and cancelling the calling task cancels the request.
struct OfflinePackClient: Sendable {
  let apiOrigin: URL
  let allowsLoopbackHTTP: Bool
  private let credential: TileflowCredential?
  private let transport: any NativeHTTPTransporting
  private let now: @Sendable () -> Date

  /// The configuration's API origin and map credential. A configuration without a map
  /// credential can still revalidate packs.
  init(
    configuration: TileflowConfiguration,
    transport: any NativeHTTPTransporting = NativeHTTPTransport(maximumBytes: 16 * 1024 * 1024),
    now: @escaping @Sendable () -> Date = Date.init
  ) throws {
    guard
      let origin = TileflowConfiguration.normalizedOrigin(configuration.apiOrigin.absoluteString),
      origin.scheme == "http" || HostedContract.canonicalOrigin(origin.absoluteString) != nil
    else { throw TileflowOfflineError(.invalidConfiguration) }
    apiOrigin = origin
    allowsLoopbackHTTP = origin.scheme == "http"
    credential = configuration.mapCredential
    self.transport = transport
    self.now = now
  }

  func create(_ request: OfflinePackRequest) async throws -> OfflinePack {
    guard let credential else { throw TileflowOfflineError(.missingCredential) }
    var urlRequest = post("v1/offline/packs", body: request.body)
    urlRequest.setValue(credential.value, forHTTPHeaderField: "X-Tileflow-Mobile-Client")
    let response = try await send(urlRequest)
    guard response.status == 201 else {
      throw failure(response, operation: .create)
    }
    return try OfflinePackContract.pack(
      response.bytes, request: request, allowsLoopbackHTTP: allowsLoopbackHTTP)
  }

  func revalidate(_ grant: OfflinePackGrant) async throws -> OfflinePackRevalidation {
    let body = (try? JSONEncoder().encode(["grant": grant.value])) ?? Data()
    let response = try await send(post("v1/offline/packs/revalidate", body: body))
    guard response.status == 200 else { throw failure(response, operation: .revalidate) }
    return try OfflinePackContract.revalidation(response.bytes)
  }

  private func post(_ path: String, body: Data) -> URLRequest {
    var request = URLRequest(
      url: apiOrigin.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData,
      timeoutInterval: 30)
    request.httpMethod = "POST"
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    return request
  }

  private func send(_ request: URLRequest) async throws -> ResourcePayload {
    do {
      return try await transport.send(request)
    } catch is CancellationError {
      throw CancellationError()
    } catch is ResourceError {
      if Task.isCancelled { throw CancellationError() }
      throw OfflinePackContract.invalid
    } catch {
      if Task.isCancelled { throw CancellationError() }
      throw TileflowOfflineError(.network)
    }
  }

  private func failure(_ response: ResourcePayload, operation: OfflinePackContract.Operation)
    -> TileflowOfflineError
  {
    OfflinePackContract.failure(
      status: response.status, body: response.bytes, retryAfter: response.headers["Retry-After"],
      operation: operation, now: now())
  }
}
