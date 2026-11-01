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
  /// The tile packs the download needs, computed here from the region.
  let cover: OfflineCover
  let minZoom: Int
  let maxZoom: Int
  let terrainMaxZoom: Int

  static let maximumBodyBytes = 262_144

  /// The request of a region's download: one for any region, its cover the union of its parts.
  ///
  /// - Throws: `regionTooComplex` before anything is sent when the cover lists more packs, or the
  ///   body holds more bytes, than the service accepts.
  static func requests(
    mapID: String, themes requested: [String], geometry: TileflowOfflineGeometry,
    zooms: OfflineZooms, profile: OfflinePackProfile = .webView
  ) throws -> [OfflinePackRequest] {
    guard HostedContract.matches(mapID, #"^map_[A-Za-z0-9_-]{16}$"#) else {
      throw TileflowOfflineError.options("invalidMapID")
    }
    let themes = Array(Set(requested)).sorted()
    guard (1...4).contains(requested.count), themes.count == requested.count,
      themes.allSatisfy({ HostedContract.matches($0, #"^[A-Za-z][A-Za-z0-9_-]{0,63}$"#) })
    else { throw TileflowOfflineError.options("invalidThemes") }
    let cover = try OfflineCover.of(
      geometry.packRegions(), minZoom: zooms.range.lowerBound, maxZoom: zooms.range.upperBound)
    let request = OfflinePackRequest(
      mapID: mapID, profile: profile.rawValue, themes: themes, cover: cover,
      minZoom: zooms.range.lowerBound, maxZoom: zooms.range.upperBound,
      terrainMaxZoom: zooms.terrainMaximum)
    let bytes = request.body.count
    guard bytes <= maximumBodyBytes else {
      throw TileflowOfflineError(
        .regionTooComplex,
        context: .init(reason: "bodyTooLarge", limit: maximumBodyBytes, count: bytes))
    }
    return [request]
  }

  init(
    mapID: String, profile: String, themes: [String], cover: OfflineCover, minZoom: Int,
    maxZoom: Int, terrainMaxZoom: Int
  ) {
    self.mapID = mapID
    self.profile = profile
    self.themes = themes
    self.cover = cover
    self.minZoom = minZoom
    self.maxZoom = maxZoom
    self.terrainMaxZoom = terrainMaxZoom
  }

  /// A body as the service reads one; nil when it would refuse it.
  init?(json value: JSONValue) {
    guard let mapID = value["mapId"]?.string, let profile = value["profile"]?.string,
      case .array(let themes) = value["themes"],
      let minZoom = value["minZoom"]?.number.flatMap({ Int(exactly: $0) }),
      let maxZoom = value["maxZoom"]?.number.flatMap({ Int(exactly: $0) }),
      let terrainMaxZoom = value["terrainMaxZoom"]?.number.flatMap({ Int(exactly: $0) }),
      let cover = OfflineCover(json: value["cover"], minZoom: minZoom, maxZoom: maxZoom)
    else { return nil }
    self.init(
      mapID: mapID, profile: profile, themes: themes.compactMap(\.string), cover: cover,
      minZoom: minZoom, maxZoom: maxZoom, terrainMaxZoom: terrainMaxZoom)
  }

  var json: JSONValue {
    .object([
      "mapId": .string(mapID), "profile": .string(profile),
      "themes": .array(themes.map(JSONValue.string)), "cover": cover.json,
      "minZoom": .number(Double(minZoom)), "maxZoom": .number(Double(maxZoom)),
      "terrainMaxZoom": .number(Double(terrainMaxZoom)),
    ])
  }

  var body: Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return (try? encoder.encode(json)) ?? Data()
  }
}

/// Creates and revalidates Hosted offline downloads.
///
/// Creation presents the map credential exactly as a Hosted map's session start does, in
/// `X-Tileflow-Mobile-Client`, and nothing else. Revalidation presents only the download's grant.
/// Requests are never retried: each refusal comes back as a typed error, with the wait the service
/// asked for, and cancelling the calling task cancels the request.
struct OfflinePackClient: Sendable {
  let apiOrigin: URL
  let allowsLoopbackHTTP: Bool
  private let credential: TileflowCredential?
  private let transport: any NativeHTTPTransporting
  private let now: @Sendable () -> Date

  /// The configuration's API origin and map credential. A configuration without a map
  /// credential can still revalidate downloads.
  init(
    configuration: TileflowConfiguration,
    transport: any NativeHTTPTransporting = NativeHTTPTransport(
      maximumBytes: OfflinePackContract.maximumResponseBytes),
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

  func create(_ request: OfflinePackRequest) async throws -> OfflineDownload {
    guard let credential else { throw TileflowOfflineError(.missingCredential) }
    var urlRequest = post("v1/offline/packs", body: request.body)
    urlRequest.setValue(credential.value, forHTTPHeaderField: "X-Tileflow-Mobile-Client")
    let response = try await send(urlRequest)
    guard response.status == 201 else {
      throw failure(response, operation: .create)
    }
    return try OfflinePackContract.download(
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
