import Foundation

/// The signed authority of one Hosted download: `tf_offline_v2.<payload>.<signature>`. The SDK
/// cannot verify it and never reads it; it sends it only to download the download's own packs and to
/// revalidate. Descriptions and reflection never include it.
struct OfflinePackGrant: Sendable, Hashable, CustomStringConvertible, CustomDebugStringConvertible,
  CustomReflectable
{
  let value: String

  init?(_ value: String) {
    guard value.utf8.count <= 16_384,
      HostedContract.matches(value, #"^tf_offline_v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"#)
    else { return nil }
    self.value = value
  }

  /// A short, stable name for the grant that reveals nothing of it.
  var tag: String { String(DataChannel.digest(Data(value.utf8)).prefix(12)) }

  var description: String { "OfflinePackGrant(tf_offline_v2…)" }
  var debugDescription: String { description }
  var customMirror: Mirror { Mirror(self, children: [:]) }
}

/// A free public file a download needs, fetched from its public route without the grant.
struct OfflinePublicResource: Sendable, Hashable {
  /// `discovery`, `profile`, `landmark` or `model` today; the service may add kinds.
  let kind: String
  let url: URL
  let bytes: Int
  /// Lowercase hexadecimal SHA-256 of those bytes.
  let sha256: String
}

/// A source whose tiles a download holds.
struct OfflineDownloadSource: Sendable, Hashable {
  let source: String
  /// The source's pinned release.
  let version: String
  /// Byte-identical to the tile URL template of the source's TileJSON in the `style` pack.
  let template: OfflineTileTemplate
  /// The zooms the download holds; nil when every download zoom is below the source's minimum,
  /// and the download holds none of its tiles.
  let zooms: ClosedRange<Int>?
  let contentType: String
  let contentEncoding: String?
  /// What the source answers online for a covered tile its archive does not store.
  let absentStatus: Int
}

/// One pack of a download, as its manifest lists it.
struct OfflineDownloadPack: Sendable, Hashable {
  /// `style`, `assets`, `glyphs/<fontstack>/<n>` or `tiles/<source>/<z>/<x>/<y>`: the same pack
  /// keeps its id in every release.
  let id: String
  let kind: OfflinePackKind
  let url: URL
  /// Exact bytes of the pack.
  let bytes: Int
  let resources: Int
  let billableResources: Int
  /// A tile pack's source, anchor tile and zooms.
  let source: String?
  let anchor: OfflineTileID?
  let zooms: ClosedRange<Int>?
}

/// The download's canonical definition and everything a renderer needs, as the service signed it.
struct OfflineDownloadManifest: Sendable {
  let downloadID: String
  let mapID: String
  let profile: String
  let deploymentVersion: Int
  let themes: [String]
  let region: OfflinePackRegion
  let minZoom: Int
  let maxZoom: Int
  let terrainMaxZoom: Int
  let createdAt: Date
  let sources: [OfflineDownloadSource]
  let packs: [OfflineDownloadPack]
  let publicResources: [OfflinePublicResource]
  /// The origins document entries and tile templates may use.
  let origins: Set<String>
  /// Sources the styles use that the download leaves out, with the service's reason, such as
  /// `legal_review`, `not_authorized`, `third_party` or `unavailable`.
  let excluded: [(source: String, reason: String)]
  let resourceCount: Int
  let billableResourceCount: Int
  let bytes: Int
  /// The attribution to show offline, one entry per source, as the service wrote it.
  let attribution: [JSONValue]
  /// The plan's billable resources per download, which is also the device's total.
  let maximumPackResources: Int
  let dailyDownloads: Int
  let revalidationInterval: TimeInterval
  /// The end of the download window.
  let downloadExpiresAt: Date

  func source(_ name: String) -> OfflineDownloadSource? { sources.first { $0.source == name } }
}

/// A created download: its grant and manifest.
struct OfflineDownload: Sendable {
  let grant: OfflinePackGrant
  let manifest: OfflineDownloadManifest
  /// The service's answer as received, which the store keeps to read the download again.
  let response: Data
}

/// Whether a stored download can still be updated. Access ending never deletes it.
enum OfflinePackRevalidation: Sendable, Equatable {
  /// Access continues and nothing changed.
  case current(checkedAt: Date, interval: TimeInterval)
  /// Access continues but the Map changed: create the same download again and request each pack
  /// of a changed source or document with `If-None-Match`, so only changed packs are counted.
  case updateAvailable(checkedAt: Date, interval: TimeInterval)
  /// Access ended. The download stays usable as it is and is no longer updated.
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

/// Reads the Hosted offline download wire contract, format 2. Answers ignore members the SDK does
/// not read and keep values the service may extend open; every member the SDK reads, and the
/// invariants between them, are checked.
enum OfflinePackContract {
  /// The largest creation answer the service sends.
  static let maximumResponseBytes = 8 * 1024 * 1024

  enum Operation: Sendable {
    case create
    case revalidate
    case download
  }

  /// A created download. `request` is the canonical request the client sent; the manifest must
  /// describe exactly that download.
  static func download(
    _ data: Data, request: OfflinePackRequest, allowsLoopbackHTTP: Bool
  ) throws -> OfflineDownload {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      value["version"]?.number == 2, value["kind"]?.string == "offline_download",
      let grant = value["grant"]?.string.flatMap(OfflinePackGrant.init),
      let manifest = value["manifest"]
    else { throw invalid }
    return OfflineDownload(
      grant: grant,
      manifest: try self.manifest(
        manifest, request: request, allowsLoopbackHTTP: allowsLoopbackHTTP),
      response: data)
  }

  static func manifest(
    _ value: JSONValue, request: OfflinePackRequest, allowsLoopbackHTTP: Bool
  ) throws -> OfflineDownloadManifest {
    guard value["version"]?.number == 2,
      let downloadID = value["downloadId"]?.string,
      HostedContract.matches(downloadID, #"^[A-Za-z0-9_-]{8,64}$"#),
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
      let packCount = integer(value["totals"]?["packs"], 0...),
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
      case .array(let originValues) = value["origins"], !originValues.isEmpty,
      case .array(let sourceValues) = value["sources"],
      case .array(let packValues) = value["packs"],
      case .array(let publicValues) = value["publicResources"],
      case .array(let excludedValues) = value["excluded"]
    else { throw invalid }

    var origins = Set<String>()
    for item in originValues {
      guard let text = item.string,
        HostedContract.canonicalOrigin(text, allowsLoopbackHTTP: allowsLoopbackHTTP) != nil
      else { throw invalid }
      origins.insert(text)
    }
    func onOrigins(_ url: URL) -> Bool { origins.contains(ResourcePolicy.origin(url)) }

    var sources: [OfflineDownloadSource] = []
    for item in sourceValues {
      guard let source = item["source"]?.string, isName(source),
        !sources.contains(where: { $0.source == source }),
        let version = item["version"]?.string, isName(version),
        let text = item["template"]?.string, let template = OfflineTileTemplate(text),
        let sample = resourceURL(text, allowsLoopbackHTTP: allowsLoopbackHTTP, template: true),
        onOrigins(sample), item["zooms"] == .null || zoomRange(item["zooms"]) != nil,
        let contentType = item["contentType"]?.string,
        HostedContract.matches(contentType, #"^[a-z0-9.+-]+/[a-z0-9.+-]+$"#)
      else { throw invalid }
      let encoding: String?
      switch item["contentEncoding"] {
      case .null, nil: encoding = nil
      case .string("gzip"): encoding = "gzip"
      default: throw invalid
      }
      let absent: Int
      switch item["absentStatus"] {
      case nil: absent = 404
      case .number(204): absent = 204
      case .number(404): absent = 404
      default: throw invalid
      }
      sources.append(
        OfflineDownloadSource(
          source: source, version: version, template: template, zooms: zoomRange(item["zooms"]),
          contentType: contentType, contentEncoding: encoding, absentStatus: absent))
    }

    var packs: [OfflineDownloadPack] = []
    var ids = Set<String>()
    var covers: [Int: OfflineTileCover] = [:]
    for item in packValues {
      guard let id = item["id"]?.string, id.utf8.count <= 512, ids.insert(id).inserted,
        let kind = OfflinePackKind(manifest: item["kind"]?.string),
        let url = resourceURL(item["url"]?.string, allowsLoopbackHTTP: allowsLoopbackHTTP),
        onOrigins(url), url.query == nil, url.path.hasSuffix(".tfpack"),
        let size = integer(
          item["bytes"],
          (OfflinePackFormat.headerLength + OfflinePackFormat.trailerLength)...OfflinePackFormat
            .maximumBytes),
        let resources = integer(item["resources"], 1...OfflinePackFormat.maximumEntries),
        let billable = integer(item["billableResources"], 0...resources)
      else { throw invalid }
      var source: String?
      var anchor: OfflineTileID?
      var zooms: ClosedRange<Int>?
      switch kind {
      case .tiles:
        guard case .array(let parts) = item["anchor"], parts.count == 3,
          let z = integer(parts[0], 0...OfflineZooms.maximum), OfflinePackBand.anchors.contains(z),
          let x = integer(parts[1], 0...((1 << z) - 1)),
          let y = integer(parts[2], 0...((1 << z) - 1)),
          let name = item["source"]?.string, let declared = sources.first(where: {
            $0.source == name
          }),
          id == "tiles/\(name)/\(z)/\(x)/\(y)", let range = zoomRange(item["zooms"]),
          let band = OfflinePackBand.zooms(anchor: z), band.contains(range.lowerBound),
          band.contains(range.upperBound), let held = declared.zooms,
          held.contains(range.lowerBound), held.contains(range.upperBound)
        else { throw invalid }
        // The anchor is covered at its zoom, which is exactly what the grant admits.
        let cover = covers[z] ?? OfflineTileCover(region, zoom: z)
        covers[z] = cover
        guard cover.contains(x: x, y: y) else { throw invalid }
        source = name
        anchor = OfflineTileID(z: z, x: x, y: y)
        zooms = range
      case .documents:
        guard item["anchor"] == nil, item["source"] == nil,
          id == "style" || id == "assets"
            || HostedContract.matches(id, #"^glyphs/[^/]{1,256}/(0|[1-9][0-9]{0,4})$"#)
        else { throw invalid }
      }
      packs.append(
        OfflineDownloadPack(
          id: id, kind: kind, url: url, bytes: size, resources: resources,
          billableResources: billable, source: source, anchor: anchor, zooms: zooms))
    }

    var publicResources: [OfflinePublicResource] = []
    var urls = Set<URL>()
    for item in publicValues {
      guard let kind = item["kind"]?.string,
        HostedContract.matches(kind, #"^[a-z][a-z0-9_-]{0,63}$"#),
        let url = resourceURL(item["url"]?.string, allowsLoopbackHTTP: allowsLoopbackHTTP),
        urls.insert(url).inserted, let size = integer(item["bytes"], 0...),
        let sha256 = item["sha256"]?.string, HostedContract.matches(sha256, #"^[0-9a-f]{64}$"#)
      else { throw invalid }
      publicResources.append(
        OfflinePublicResource(kind: kind, url: url, bytes: size, sha256: sha256))
    }

    var excluded: [(source: String, reason: String)] = []
    for item in excludedValues {
      guard let source = item["source"]?.string, !source.isEmpty,
        let reason = item["reason"]?.string, !reason.isEmpty
      else { throw invalid }
      excluded.append((source, reason))
    }

    // The service's totals must be the sum of what it lists.
    guard packCount == packs.count,
      resourceCount == packs.reduce(0, { $0 + $1.resources }) + publicResources.count,
      billableCount == packs.reduce(0, { $0 + $1.billableResources }),
      bytes
        == packs.reduce(0, { $0 + $1.bytes }) + publicResources.reduce(0, { $0 + $1.bytes }),
      billableCount <= maximum
    else { throw invalid }

    return OfflineDownloadManifest(
      downloadID: downloadID, mapID: request.mapID, profile: request.profile,
      deploymentVersion: deploymentVersion, themes: request.themes, region: region,
      minZoom: request.minZoom, maxZoom: request.maxZoom, terrainMaxZoom: request.terrainMaxZoom,
      createdAt: createdAt, sources: sources, packs: packs, publicResources: publicResources,
      origins: origins, excluded: excluded, resourceCount: resourceCount,
      billableResourceCount: billableCount, bytes: bytes, attribution: attribution,
      maximumPackResources: maximum, dailyDownloads: daily,
      revalidationInterval: TimeInterval(interval), downloadExpiresAt: expiresAt)
  }

  /// `[min, max]` zooms.
  private static func zoomRange(_ value: JSONValue?) -> ClosedRange<Int>? {
    guard case .array(let pair) = value, pair.count == 2,
      let low = integer(pair[0], 0...OfflineZooms.maximum),
      let high = integer(pair[1], 0...OfflineZooms.maximum), low <= high
    else { return nil }
    return low...high
  }

  /// A source or release name: printable, without separators a path or log would split on.
  private static func isName(_ text: String) -> Bool {
    HostedContract.matches(text, #"^[A-Za-z0-9._-]{1,128}$"#)
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
    "OFFLINE_TEAM_DAILY_LIMIT_REACHED": (429, .dailyLimitReached),
    "OFFLINE_PACK_REPEAT_LIMIT_REACHED": (429, .rateLimited),
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
