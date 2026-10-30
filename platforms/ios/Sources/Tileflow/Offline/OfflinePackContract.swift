import Foundation

/// The signed authority of one Hosted pack: `tf_offline_v1.<payload>.<signature>`. The SDK cannot
/// verify it and never reads it; it sends it only to download the pack's own resources and to
/// revalidate. Descriptions and reflection never include it.
struct OfflinePackGrant: Sendable, Hashable, CustomStringConvertible, CustomDebugStringConvertible,
  CustomReflectable
{
  let value: String

  init?(_ value: String) {
    guard value.utf8.count <= 16_384,
      HostedContract.matches(value, #"^tf_offline_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"#)
    else { return nil }
    self.value = value
  }

  var description: String { "OfflinePackGrant(tf_offline_v1…)" }
  var debugDescription: String { description }
  var customMirror: Mirror { Mirror(self, children: [:]) }
}

/// One non-tile resource of a pack.
struct OfflinePackDocument: Sendable, Hashable {
  /// `discovery`, `profile`, `style`, `tilejson`, `glyph`, `license`, `sprite`, `font` or
  /// `landmark` today; the service may add kinds.
  let kind: String
  let url: URL
  /// Exact bytes on the wire.
  let bytes: Int
  /// Lowercase hexadecimal SHA-256 of those bytes, when the service knows it before download.
  let sha256: String?
  /// Counted toward the pack's map views and limits.
  let billable: Bool
  /// Fetched from its public route without the grant, which never admits it.
  let isPublic: Bool
}

struct OfflinePackTile: Sendable, Hashable {
  let z: Int
  let x: Int
  let y: Int
  /// Exact bytes on the wire. The download's `ETag` carries the hash.
  let bytes: Int
}

/// The stored tiles of one source inside the region, at the source's zooms.
struct OfflinePackTileSet: Sendable {
  let source: String
  let template: String
  /// Nil when every pack zoom is below the source's minimum zoom.
  let zooms: ClosedRange<Int>?
  let entries: [OfflinePackTile]

  /// The URL the renderer requests for the tile.
  func url(_ tile: OfflinePackTile) -> URL? {
    URL(
      string:
        template
        .replacingOccurrences(of: "{z}", with: String(tile.z))
        .replacingOccurrences(of: "{x}", with: String(tile.x))
        .replacingOccurrences(of: "{y}", with: String(tile.y)))
  }
}

/// The pack's canonical definition and every resource a renderer needs, as the service signed it.
struct OfflinePackManifest: Sendable {
  let packID: String
  let mapID: String
  let profile: String
  let deploymentVersion: Int
  let themes: [String]
  let region: OfflinePackRegion
  let minZoom: Int
  let maxZoom: Int
  let terrainMaxZoom: Int
  let createdAt: Date
  let documents: [OfflinePackDocument]
  let tiles: [OfflinePackTileSet]
  /// Sources the styles use that the pack leaves out, with the service's reason, such as
  /// `legal_review`, `not_authorized`, `third_party` or `unavailable`.
  let excluded: [(source: String, reason: String)]
  let resourceCount: Int
  let billableResourceCount: Int
  let bytes: Int
  /// The attribution to show offline, one entry per source, as the service wrote it.
  let attribution: [JSONValue]
  /// The plan's billable resources per pack, which is also the device's total.
  let maximumPackResources: Int
  let dailyDownloads: Int
  let revalidationInterval: TimeInterval
  /// The end of the download window.
  let downloadExpiresAt: Date
}

struct OfflinePack: Sendable {
  let grant: OfflinePackGrant
  let manifest: OfflinePackManifest
  /// The service's answer as received, which the store keeps to read the pack again.
  let response: Data
}

/// Whether a downloaded pack can still be updated. Access ending never deletes it.
enum OfflinePackRevalidation: Sendable, Equatable {
  /// Access continues and nothing changed.
  case current(checkedAt: Date, interval: TimeInterval)
  /// Access continues but the Map changed: create the same pack again and download with
  /// `If-None-Match`, so only changed resources are counted.
  case updateAvailable(checkedAt: Date, interval: TimeInterval)
  /// Access ended. The pack stays usable as it is and is no longer updated.
  case notUpdatable(reason: Reason, checkedAt: Date)

  /// Why access ended. The service may add reasons.
  struct Reason: RawRepresentable, Hashable, Sendable {
    let rawValue: String
    init(rawValue: String) { self.rawValue = rawValue }
    static let credentialRevoked = Reason(rawValue: "credential_revoked")
    static let mapUnavailable = Reason(rawValue: "map_unavailable")
    static let planUnavailable = Reason(rawValue: "plan_unavailable")
    static let downloadsDisabled = Reason(rawValue: "downloads_disabled")
    static let productNotDownloadable = Reason(rawValue: "product_not_downloadable")
    static let themeUnavailable = Reason(rawValue: "theme_unavailable")
  }
}

/// Reads the Hosted offline pack wire contract. Answers ignore members the SDK does not read and
/// keep values the service may extend open; every member the SDK reads, and the invariants
/// between them, are checked.
enum OfflinePackContract {
  /// The largest creation answer the service sends; 50,000 resources measure about 1.4 MB.
  static let maximumResponseBytes = 8 * 1024 * 1024

  enum Operation: Sendable {
    case create
    case revalidate
    case download
  }

  /// A created pack. `request` is the canonical request the client sent; the manifest must
  /// describe exactly that pack.
  static func pack(
    _ data: Data, request: OfflinePackRequest, allowsLoopbackHTTP: Bool
  ) throws -> OfflinePack {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      value["version"]?.number == 1, value["kind"]?.string == "offline_pack",
      let grant = value["grant"]?.string.flatMap(OfflinePackGrant.init),
      let manifest = value["manifest"]
    else { throw invalid }
    return OfflinePack(
      grant: grant,
      manifest: try self.manifest(
        manifest, request: request, allowsLoopbackHTTP: allowsLoopbackHTTP),
      response: data)
  }

  static func manifest(
    _ value: JSONValue, request: OfflinePackRequest, allowsLoopbackHTTP: Bool
  ) throws -> OfflinePackManifest {
    guard value["version"] == nil || value["version"]?.number == 1,
      let packID = value["packId"]?.string,
      HostedContract.matches(packID, #"^opk_[A-Za-z0-9_-]{22}$"#),
      value["mapId"]?.string == request.mapID, value["profile"]?.string == request.profile,
      let deploymentVersion = integer(value["deploymentVersion"], 1...),
      case .array(let themeValues) = value["themes"],
      themeValues.compactMap(\.string) == request.themes,
      let region = OfflinePackRegion(json: value["region"]), region == request.region,
      integer(value["minZoom"], 0...) == request.minZoom,
      integer(value["maxZoom"], 0...) == request.maxZoom,
      integer(value["terrainMaxZoom"], 0...) == request.terrainMaxZoom,
      let createdAt = date(value["createdAt"]),
      let expiresAt = date(value["download"]?["expiresAt"]),
      expiresAt > createdAt, expiresAt.timeIntervalSince(createdAt) <= 86_400,
      let resourceCount = integer(value["totals"]?["resources"], 1...),
      let billableCount = integer(value["totals"]?["billableResources"], 0...),
      let bytes = integer(value["totals"]?["bytes"], 0...),
      let maximum = integer(value["limits"]?["maxPackResources"], 1...),
      let daily = integer(value["limits"]?["dailyDownloads"], 0...),
      let interval = integer(value["revalidation"]?["intervalSeconds"], 1...),
      // Always absolute on the service's origin; the SDK revalidates at its configured origin.
      resourceURL(value["revalidation"]?["url"]?.string, allowsLoopbackHTTP: allowsLoopbackHTTP)
        != nil,
      case .array(let attribution) = value["attribution"]?["sources"],
      attribution.allSatisfy({ if case .object = $0 { true } else { false } }),
      case .array(let documentValues) = value["documents"],
      case .array(let tileValues) = value["tiles"],
      case .array(let excludedValues) = value["excluded"]
    else { throw invalid }

    var urls = Set<URL>()
    var documents: [OfflinePackDocument] = []
    for item in documentValues {
      guard let kind = item["kind"]?.string,
        HostedContract.matches(kind, #"^[a-z][a-z0-9_-]{0,63}$"#),
        let url = resourceURL(item["url"]?.string, allowsLoopbackHTTP: allowsLoopbackHTTP),
        urls.insert(url).inserted,
        let size = integer(item["bytes"], 0...),
        let billable = item["billable"]?.bool,
        let access = item["access"]?.string, ["grant", "public"].contains(access),
        !(billable && access == "public")
      else { throw invalid }
      let sha256: String?
      switch item["sha256"] {
      case .null: sha256 = nil
      case .string(let digest) where HostedContract.matches(digest, #"^[0-9a-f]{64}$"#):
        sha256 = digest
      default: throw invalid
      }
      documents.append(
        OfflinePackDocument(
          kind: kind, url: url, bytes: size, sha256: sha256, billable: billable,
          isPublic: access == "public"))
    }

    var sources = Set<String>()
    var tiles: [OfflinePackTileSet] = []
    var covers: [Int: OfflineTileCover] = [:]
    var rows: [Int: [Int: [ClosedRange<Int>]]] = [:]
    for item in tileValues {
      guard let source = item["source"]?.string, sources.insert(source).inserted,
        let template = item["template"]?.string, isTemplate(template),
        resourceURL(template, allowsLoopbackHTTP: allowsLoopbackHTTP, template: true) != nil,
        case .array(let entryValues) = item["entries"]
      else { throw invalid }
      let zooms: ClosedRange<Int>?
      switch item["zooms"] {
      case .null: zooms = nil
      case .array(let pair) where pair.count == 2:
        guard let low = integer(pair[0], 0...30), let high = integer(pair[1], 0...30), low <= high
        else { throw invalid }
        zooms = low...high
      default: throw invalid
      }
      var seen = Set<OfflinePackTile>()
      var entries: [OfflinePackTile] = []
      entries.reserveCapacity(entryValues.count)
      for entry in entryValues {
        guard case .array(let parts) = entry, parts.count == 4,
          let z = integer(parts[0], 0...30), zooms?.contains(z) == true,
          let x = integer(parts[1], 0...((1 << z) - 1)),
          let y = integer(parts[2], 0...((1 << z) - 1)),
          let size = integer(parts[3], 0...),
          seen.insert(OfflinePackTile(z: z, x: x, y: y, bytes: 0)).inserted
        else { throw invalid }
        // Every listed tile lies in the region's cover, which is exactly what the grant admits.
        let cover = covers[z] ?? OfflineTileCover(region, zoom: z)
        covers[z] = cover
        let row = rows[z]?[y] ?? cover.row(y)
        rows[z, default: [:]][y] = row
        guard row.contains(where: { $0.contains(x) }) else { throw invalid }
        entries.append(OfflinePackTile(z: z, x: x, y: y, bytes: size))
      }
      tiles.append(
        OfflinePackTileSet(source: source, template: template, zooms: zooms, entries: entries))
    }

    var excluded: [(source: String, reason: String)] = []
    for item in excludedValues {
      guard let source = item["source"]?.string, !source.isEmpty,
        let reason = item["reason"]?.string, !reason.isEmpty
      else { throw invalid }
      excluded.append((source, reason))
    }

    // The service's totals must be the sum of what it lists.
    let tileCount = tiles.reduce(0) { $0 + $1.entries.count }
    guard resourceCount == documents.count + tileCount,
      billableCount == documents.filter(\.billable).count + tileCount,
      bytes
        == documents.reduce(0, { $0 + $1.bytes })
        + tiles.reduce(0, { total, set in set.entries.reduce(total) { $0 + $1.bytes } }),
      billableCount <= maximum
    else { throw invalid }

    return OfflinePackManifest(
      packID: packID, mapID: request.mapID, profile: request.profile,
      deploymentVersion: deploymentVersion, themes: request.themes, region: region,
      minZoom: request.minZoom, maxZoom: request.maxZoom, terrainMaxZoom: request.terrainMaxZoom,
      createdAt: createdAt, documents: documents, tiles: tiles, excluded: excluded,
      resourceCount: resourceCount, billableResourceCount: billableCount, bytes: bytes,
      attribution: attribution, maximumPackResources: maximum, dailyDownloads: daily,
      revalidationInterval: TimeInterval(interval), downloadExpiresAt: expiresAt)
  }

  static func revalidation(_ data: Data) throws -> OfflinePackRevalidation {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      let checkedAt = date(value["checkedAt"])
    else { throw invalid }
    switch value["state"]?.string {
    case "current", "update_available":
      guard value["reason"] == nil, let interval = integer(value["intervalSeconds"], 1...) else {
        throw invalid
      }
      return value["state"]?.string == "current"
        ? .current(checkedAt: checkedAt, interval: TimeInterval(interval))
        : .updateAvailable(checkedAt: checkedAt, interval: TimeInterval(interval))
    case "not_updatable":
      guard let reason = value["reason"]?.string,
        HostedContract.matches(reason, #"^[a-z][a-z0-9_]{0,63}$"#)
      else { throw invalid }
      return .notUpdatable(reason: .init(rawValue: reason), checkedAt: checkedAt)
    default:
      throw invalid
    }
  }

  /// Each documented code with the only status it is trusted with.
  static let codes: [String: (status: Int, code: TileflowOfflineError.Code)] = [
    "OFFLINE_PACK_INVALID_INPUT": (400, .rejected),
    "OFFLINE_PACK_AUTHORITY_CONFLICT": (400, .rejected),
    "MOBILE_CREDENTIAL_INVALID": (401, .credentialRejected),
    "OFFLINE_PACK_GRANT_INVALID": (401, .grantRejected),
    "OFFLINE_PACK_GRANT_EXPIRED": (401, .grantRejected),
    "OFFLINE_PACK_GRANT_STALE": (401, .grantRejected),
    "MOBILE_MAP_MISMATCH": (403, .accessDenied),
    "OFFLINE_PACK_RESOURCE_DENIED": (403, .accessDenied),
    "OFFLINE_PACKS_NOT_INCLUDED": (403, .notIncluded),
    "OFFLINE_DOWNLOADS_DISABLED": (403, .downloadsDisabled),
    "OFFLINE_PACK_MAP_NOT_FOUND": (404, .notFound),
    "OFFLINE_PACK_THEME_NOT_FOUND": (404, .notFound),
    "OFFLINE_PACK_SUPERSEDED": (409, .superseded),
    "OFFLINE_PACK_BODY_TOO_LARGE": (413, .rejected),
    "OFFLINE_PACK_TOO_LARGE": (422, .packTooLarge),
    "OFFLINE_PACK_NOT_DOWNLOADABLE": (422, .notDownloadable),
    "OFFLINE_DAILY_LIMIT_REACHED": (429, .dailyLimitReached),
    "COMMERCIAL_MAP_LIMIT_REACHED": (429, .quotaExceeded),
    "COMMERCIAL_SPENDING_LIMIT_REACHED": (429, .quotaExceeded),
    "RATE_LIMITED": (429, .rateLimited),
    "OFFLINE_PACKS_DISABLED": (503, .unavailable),
    "OFFLINE_PACKS_UNAVAILABLE": (503, .unavailable),
    "OFFLINE_PACK_GRANT_UNAVAILABLE": (503, .unavailable),
  ]

  /// Classifies a refused pack request. A code is trusted only with its documented status;
  /// otherwise the status alone decides.
  static func failure(
    status: Int, body: Data, retryAfter header: String?, operation: Operation, now: Date
  ) -> TileflowOfflineError {
    let serverCode = HostedContract.errorCode(body)
    let code: TileflowOfflineError.Code
    if let serverCode, let known = codes[serverCode], known.status == status {
      code = known.code
    } else {
      switch status {
      case 401: code = operation == .create ? .credentialRejected : .grantRejected
      case 403: code = .accessDenied
      case 404: code = .notFound
      case 409: code = .superseded
      case 429: code = .rateLimited
      case 408, 500...599: code = .unavailable
      case 400...499: code = .rejected
      default: code = .invalidResponse
      }
    }
    var limit: Int?
    if code == .packTooLarge, body.count <= 4096,
      let value = try? JSONDecoder().decode(JSONValue.self, from: body)
    {
      limit = integer(value["limit"], 1...)
    }
    let waits: Set<TileflowOfflineError.Code> = [.dailyLimitReached, .rateLimited, .unavailable]
    return TileflowOfflineError(
      code, context: .init(reason: serverCode, status: status, limit: limit),
      retryAfter: waits.contains(code) ? retryAfter(header, now: now) : nil)
  }

  /// Delta-seconds or an HTTP date, at most one day: a daily limit waits for the next UTC day.
  static func retryAfter(_ value: String?, now: Date) -> TimeInterval? {
    guard let value, value.utf8.count <= 64 else { return nil }
    let text = value.trimmingCharacters(in: .whitespaces)
    let delay: TimeInterval
    if HostedContract.matches(text, #"^[0-9]{1,10}$"#), let seconds = TimeInterval(text) {
      delay = seconds
    } else {
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.timeZone = TimeZone(identifier: "GMT")
      formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
      guard let date = formatter.date(from: text) else { return nil }
      delay = date.timeIntervalSince(now)
    }
    return min(max(0, delay), 86_400)
  }

  static let invalid = TileflowOfflineError(.invalidResponse)

  /// A resource address the grant may travel to: HTTPS, or loopback HTTP for a local
  /// development API, without credentials in it.
  static func resourceURL(_ text: String?, allowsLoopbackHTTP: Bool, template: Bool = false)
    -> URL?
  {
    guard var text, text.utf8.count <= 2048, !HostedContract.matches(text, #"(?i)tf_[a-z]+_"#)
    else { return nil }
    if template {
      text = text.replacingOccurrences(of: "{z}", with: "0")
        .replacingOccurrences(of: "{x}", with: "0").replacingOccurrences(of: "{y}", with: "0")
    }
    guard let url = URL(string: text), url.host != nil, url.user == nil, url.password == nil,
      url.fragment == nil,
      url.scheme == "https"
        || (allowsLoopbackHTTP && url.scheme == "http"
          && ["localhost", "127.0.0.1"].contains(url.host))
    else { return nil }
    return url
  }

  private static func isTemplate(_ text: String) -> Bool {
    ["{z}", "{x}", "{y}"].allSatisfy { text.components(separatedBy: $0).count == 2 }
  }

  static func integer(_ value: JSONValue?, _ range: PartialRangeFrom<Int>) -> Int? {
    guard let number = value?.number, number.rounded(.down) == number,
      number >= Double(range.lowerBound), number <= 9_007_199_254_740_991
    else { return nil }
    return Int(number)
  }

  static func integer(_ value: JSONValue?, _ range: ClosedRange<Int>) -> Int? {
    guard let number = integer(value, range.lowerBound...), range.contains(number) else {
      return nil
    }
    return number
  }

  static func date(_ value: JSONValue?) -> Date? {
    guard let text = value?.string,
      HostedContract.matches(text, #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#)
    else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: text)
  }
}
