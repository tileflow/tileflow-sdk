import Foundation

struct HostedAuthority: Sendable {
  let grant: String
  let serverTime: Date
  let expiresAt: Date
  let origins: Set<String>
  let scopes: Set<String>
  let tilesets: Set<String>
  /// The session of a local development API, whose resource origins may be loopback HTTP.
  var allowsLoopbackHTTP = false
}

enum ResourceReaction: Equatable, Sendable {
  case none
  /// Discard the grant, bootstrap once and retry the request.
  case refresh
  /// The Map has a newer deployment; reload its discovery and styles.
  case superseded
  /// Wait for `Retry-After`, then retry; this is not quota exhaustion.
  case rateLimited
  /// The Map's quota is exhausted; the session ends.
  case quota
}

/// The native-delivery contract is deliberately independent of the browser bridge.
enum HostedContract {
  private static let successKeys: Set<String> = [
    "ok", "kind", "version", "usageMode", "counted", "grant", "mapId", "sessionId",
    "surfaceId", "credentialId", "credentialRevision", "deliveryPolicyRevision",
    "issuedAt", "serverTime", "expiresAt", "meterMode", "disposition",
    "resourceOrigins", "resourceScopes", "tilesetIds",
  ]
  private static let scopes: Set<String> = ["style", "tilejson", "tile", "sprite", "glyph", "font"]

  /// `allowsLoopbackHTTP` admits loopback HTTP resource origins, for a local development API.
  static func parse(
    _ data: Data, mapID: String, sessionID: String, surfaceID: String,
    allowsLoopbackHTTP: Bool = false
  ) throws -> HostedAuthority {
    guard data.count <= 65_536, String(data: data, encoding: .utf8) != nil,
      let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      case .object(let object) = value, Set(object.keys) == successKeys,
      value["ok"]?.bool == true, value["kind"]?.string == "native",
      value["version"]?.number == 1, value["usageMode"]?.string == "session",
      value["counted"]?.bool == false,
      value["mapId"]?.string == mapID, value["sessionId"]?.string == sessionID,
      value["surfaceId"]?.string == surfaceID,
      let credentialID = value["credentialId"]?.string,
      matches(credentialID, #"^key_[A-Za-z0-9_-]{8,80}$"#),
      revision(value["credentialRevision"]), revision(value["deliveryPolicyRevision"]),
      let grant = value["grant"]?.string, grant.utf8.count <= 24_576,
      matches(grant, #"^tf_native_v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$"#),
      let meter = value["meterMode"]?.string, ["disabled", "shadow", "enforced"].contains(meter),
      let disposition = value["disposition"]?.string,
      ["unmetered", "ordinary", "unbilled_fail_open"].contains(disposition),
      disposition != "unmetered" || meter == "disabled",
      let issued = date(value["issuedAt"]), let server = date(value["serverTime"]),
      let expires = date(value["expiresAt"]),
      issued.timeIntervalSince(server) <= 30, expires > server, expires > issued,
      expires.timeIntervalSince(issued) <= 900
    else { throw TileflowMapError.invalidSessionResponse }
    let origins = try strings(value["resourceOrigins"], count: 1...2)
    guard
      origins.allSatisfy({ canonicalOrigin($0, allowsLoopbackHTTP: allowsLoopbackHTTP) != nil })
    else {
      throw TileflowMapError.invalidSessionResponse
    }
    let resourceScopes = try strings(value["resourceScopes"], count: 1...6)
    guard resourceScopes.isSubset(of: scopes) else { throw TileflowMapError.invalidSessionResponse }
    let tilesets = try strings(value["tilesetIds"], count: 0...18)
    guard tilesets.allSatisfy({ matches($0, #"^[A-Za-z0-9._:-]{1,255}$"#) && !secretShaped($0) })
    else { throw TileflowMapError.invalidSessionResponse }
    return HostedAuthority(
      grant: grant, serverTime: server, expiresAt: expires,
      origins: origins, scopes: resourceScopes, tilesets: tilesets,
      allowsLoopbackHTTP: allowsLoopbackHTTP)
  }

  /// Only these 429 bodies mean the Map or Team is out of quota; any other 429 is rate limiting.
  private static let quotaCodes: Set<String> = [
    "COMMERCIAL_MAP_LIMIT_REACHED", "COMMERCIAL_SPENDING_LIMIT_REACHED",
  ]

  /// Classifies a failed bootstrap or granted resource response.
  static func failure(status: Int, body: Data) -> TileflowMapError {
    switch status {
    case 401: return .credentialRejected
    case 403, 404: return .accessDenied
    case 429:
      guard body.count <= 65_536,
        let code = (try? JSONDecoder().decode(JSONValue.self, from: body))?["code"]?.string,
        quotaCodes.contains(code)
      else { return .rateLimited }
      return .quotaExceeded
    case 408, 500...599: return .sessionUnavailable
    // Any other refusal, such as a Map without session delivery or a conflicting header, repeats
    // until something outside the device changes.
    case 400...499:
      return TileflowMapError(
        .sessionRejected, context: .init(reason: errorCode(body), status: status))
    default: return .invalidSessionResponse
    }
  }

  /// These will not succeed again without a change outside the device.
  static func isTerminal(_ error: TileflowMapError) -> Bool {
    [.credentialRejected, .accessDenied, .quotaExceeded, .sessionRejected].contains(error)
  }

  /// Delta-seconds or an HTTP date, bounded so a hostile value cannot park the session.
  static func retryAfter(_ value: String?, now: Date) -> TimeInterval? {
    guard let value, value.utf8.count <= 64 else { return nil }
    let text = value.trimmingCharacters(in: .whitespaces)
    let delay: TimeInterval
    if matches(text, #"^[0-9]{1,10}$"#), let seconds = TimeInterval(text) {
      delay = seconds
    } else {
      let formatter = DateFormatter()
      formatter.locale = Locale(identifier: "en_US_POSIX")
      formatter.timeZone = TimeZone(identifier: "GMT")
      formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
      guard let date = formatter.date(from: text) else { return nil }
      delay = date.timeIntervalSince(now)
    }
    return min(max(0, delay), 900)
  }

  static func isRestart(_ data: Data, sessionID: String) -> Bool {
    guard let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      case .object(let object) = value,
      Set(object.keys) == ["code", "error", "retryWithNewSession", "sessionId"],
      value["code"]?.string == "COMMERCIAL_SESSION_RESTART_REQUIRED",
      value["retryWithNewSession"]?.bool == true, value["sessionId"]?.string == sessionID,
      let message = value["error"]?.string, !message.isEmpty, message.count <= 500
    else { return false }
    return true
  }

  /// An HTTPS origin in canonical form. With `allowsLoopbackHTTP`, also an HTTP origin that the
  /// configuration accepts, which is one on `localhost` or `127.0.0.1`.
  static func canonicalOrigin(_ text: String, allowsLoopbackHTTP: Bool = false) -> URL? {
    guard text.utf8.count <= 2048, let url = URL(string: text),
      url.scheme == "https"
        || (allowsLoopbackHTTP && url.scheme == "http"
          && TileflowConfiguration.normalizedOrigin(text)?.absoluteString == text),
      url.host != nil, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, url.path.isEmpty,
      text == ResourcePolicy.origin(url),
      text.unicodeScalars.allSatisfy({ (33...126).contains($0.value) }),
      !text.contains("\\")
    else { return nil }
    return url
  }

  /// Limit the recipient and resource class before a grant leaves native memory. The service
  /// independently checks current ownership, deployment, credentials and referenced assets.
  static func permits(_ url: URL, mapID: String, authority: HostedAuthority) -> Bool {
    guard authority.origins.contains(ResourcePolicy.origin(url)),
      (try? ResourcePolicy(
        origins: authority.origins, allowsLoopbackHTTP: authority.allowsLoopbackHTTP
      ).validate(url)) != nil,
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      !secretShaped(url.absoluteString)
    else { return false }
    let allowedQueries = Set([
      "map", "mapId", "archiveVersion", "worldReleaseId", "worldDescriptorSha256",
    ]).union(releaseSelectors.keys)
    var keys: Set<String> = []
    for item in components.queryItems ?? [] {
      guard allowedQueries.contains(item.name), keys.insert(item.name).inserted,
        let value = item.value, !value.isEmpty, value.count <= 256,
        !value.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 }),
        !value.contains("\\")
      else { return false }
      if ["map", "mapId"].contains(item.name), value != mapID { return false }
    }
    // A pinned data product's release selector belongs only to that product's TileJSON.
    let pinned = keys.compactMap { releaseSelectors[$0] }
    let raw = components.percentEncodedPath
    guard let path = raw.removingPercentEncoding,
      !path.contains("\\"),
      !path.split(separator: "/").contains(where: { $0 == "." || $0 == ".." }),
      !matches(raw, #"(?i)%2f|%5c|%00"#),
      !path.unicodeScalars.contains(where: { $0.value < 32 || $0.value == 127 })
    else { return false }
    if let match = capture(
      path,
      #"^/maps/(map_[A-Za-z0-9_-]{16})/mobile/webview-v1/v([1-9][0-9]{0,15})/[A-Za-z][A-Za-z0-9_-]{0,63}\.json$"#
    ) {
      return raw == path && components.query == nil && match[1] == mapID
        && (Double(match[2]) ?? .infinity) <= 9_007_199_254_740_991
        && authority.scopes.contains("style")
    }
    let tileset: (scope: String, id: String)?
    if matches(path, #"^/(?:v1/)?tiles/bathymetry/dem/tiles\.json$"#) {
      tileset = ("tilejson", "bathymetry-dem")
    } else if matches(
      path,
      #"^/(?:v1/)?tiles/bathymetry/dem/[A-Za-z0-9._-]{1,128}/[0-9]{1,2}/[0-9]{1,10}/[0-9]{1,10}\.(?:pbf|mvt|png|jpg|jpeg|webp|avif)$"#
    ) {
      tileset = ("tile", "bathymetry-dem")
    } else if let match = capture(path, #"^/(?:v1/)?tiles/([A-Za-z0-9_-]{1,128})/tiles\.json$"#) {
      tileset = ("tilejson", match[1])
    } else if let match = capture(
      path,
      #"^/(?:v1/)?tiles/([A-Za-z0-9_-]{1,128})/(?:[A-Za-z0-9._-]{1,128}/)?[0-9]{1,2}/[0-9]{1,10}/[0-9]{1,10}\.(?:pbf|mvt|png|jpg|jpeg|webp|avif)$"#
    ) {
      tileset = ("tile", match[1])
    } else {
      tileset = nil
    }
    if let tileset {
      return authority.scopes.contains(tileset.scope) && authority.tilesets.contains(tileset.id)
        && pinned.allSatisfy { tileset.scope == "tilejson" && $0.contains(tileset.id) }
    }
    guard pinned.isEmpty else { return false }
    if matches(path, #"^/sprites/[A-Za-z0-9_-]{1,128}/sprite(?:@2x)?\.(?:json|png)$"#) {
      return authority.scopes.contains("sprite")
    }
    if matches(path, #"^/fonts/[\p{L}\p{N} _.,-]{1,256}/[0-9]{1,6}-[0-9]{1,6}\.pbf$"#)
      || matches(
        path,
        #"^/base/[0-9a-f]{64}/(?:manifest\.json|glyphs/[\p{L}\p{N} _.,-]{1,256}/(?:LICENSE\.md|[0-9]{1,6}-[0-9]{1,6}\.pbf))$"#
      )
    {
      return authority.scopes.contains("glyph")
    }
    return authority.scopes.contains("font")
      && matches(path, #"^/font-bundles/fnb_[A-Za-z0-9_-]{16,64}/[A-Za-z0-9_./-]{1,512}$"#)
  }

  /// Landmarks and Team models are public web resources on the API origin: a Map's view already
  /// counts its session, so they never carry a grant and are admitted by exact path only.
  static func isPublicAPIResource(_ url: URL) -> Bool {
    guard let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      components.query == nil, components.fragment == nil, url.user == nil, url.password == nil
    else { return false }
    let path = components.percentEncodedPath
    return publicAPIPaths.contains { matches(path, $0) }
  }

  /// A Team model's stable address redirects once to the immutable file of its current version.
  static func redirect(from url: URL, location: String?, apiOrigin: URL) -> URL? {
    guard ResourcePolicy.origin(url) == ResourcePolicy.origin(apiOrigin),
      let model = capture(
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? "",
        #"^/team-models/(tmd_[A-Za-z0-9_-]{16,76})/current\.glb$"#),
      let location, location.utf8.count <= 2048,
      let target = URL(string: location, relativeTo: url)?.absoluteURL,
      ResourcePolicy.origin(target) == ResourcePolicy.origin(apiOrigin),
      isPublicAPIResource(target),
      let version = capture(
        URLComponents(url: target, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? "",
        #"^/team-models/(tmd_[A-Za-z0-9_-]{16,76})/versions/tmv_[A-Za-z0-9_-]{16,76}\.glb$"#),
      version[1] == model[1]
    else { return nil }
    return target
  }

  /// A Map deployment's versioned WebView style, which a later deployment supersedes.
  static func isVersionedStyle(_ url: URL) -> Bool {
    matches(
      URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? "",
      #"^/maps/map_[A-Za-z0-9_-]{16}/mobile/webview-v1/v[1-9][0-9]{0,15}/[A-Za-z][A-Za-z0-9_-]{0,63}\.json$"#
    )
  }

  /// The `code` of a delivery failure body, when it has a well-formed one.
  static func errorCode(_ data: Data) -> String? {
    guard data.count <= 4096, let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      let code = value["code"]?.string, matches(code, #"^[A-Z][A-Z0-9_]{0,63}$"#)
    else { return nil }
    return code
  }

  /// How a protected resource's response changes the session. Only bootstrap is authoritative:
  /// a grant the service no longer accepts is renewed once, and a superseded deployment reloads.
  static func reaction(status: Int, body: Data, url: URL, refreshed: Bool) -> ResourceReaction {
    let code = errorCode(body)
    let style = isVersionedStyle(url)
    switch status {
    case 401:
      return refreshed ? .none : .refresh
    case 403 where code == "NATIVE_GRANT_RESOURCE_DENIED":
      // Before the service reported superseded deployments distinctly, it denied their styles.
      return style ? .superseded : .none
    case 403:
      // A binding mismatch can be a credential or policy revision that a new grant repairs.
      return !refreshed ? .refresh : style ? .superseded : .none
    case 409:
      return style ? .superseded : .none
    case 429:
      return failure(status: status, body: body) == .quotaExceeded ? .quota : .rateLimited
    default:
      return .none
    }
  }

  private static let publicAPIPaths = [
    #"^/landmarks/tiles\.json$"#,
    #"^/landmarks/releases/[0-9a-f]{64}/regions/6/(?:0|[1-9][0-9]{0,4})/(?:0|[1-9][0-9]{0,4})\.json$"#,
    #"^/landmarks/releases/[0-9a-f]{64}/NOTICE\.md$"#,
    #"^/landmarks/tiles/[0-9a-f]{64}\.glb$"#,
    #"^/team-models/tmd_[A-Za-z0-9_-]{16,76}/current\.glb$"#,
    #"^/team-models/tmd_[A-Za-z0-9_-]{16,76}/versions/tmv_[A-Za-z0-9_-]{16,76}\.glb$"#,
  ]
  private static let releaseSelectors: [String: Set<String>] = [
    "boundariesReleaseId": ["boundaries"],
    "bathymetryReleaseId": ["bathymetry", "bathymetry-dem"],
    "nauticalReleaseId": ["nautical"],
  ]

  static func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
  }
  static func secretShaped(_ value: String) -> Bool {
    matches(value, #"(?i)tf_native_|tf_public_"#)
  }

  private static func capture(_ value: String, _ pattern: String) -> [String]? {
    guard let regex = try? NSRegularExpression(pattern: pattern),
      let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value))
    else { return nil }
    return (0..<match.numberOfRanges).map { index in
      Range(match.range(at: index), in: value).map { String(value[$0]) } ?? ""
    }
  }
  private static func revision(_ value: JSONValue?) -> Bool {
    guard let value = value?.number else { return false }
    return value > 0 && value <= 9_007_199_254_740_991 && value.rounded(.down) == value
  }
  private static func strings(_ value: JSONValue?, count: ClosedRange<Int>) throws -> Set<String> {
    guard case .array(let values) = value, count.contains(values.count) else {
      throw TileflowMapError.invalidSessionResponse
    }
    let strings = values.compactMap(\.string)
    guard strings.count == values.count, Set(strings).count == values.count else {
      throw TileflowMapError.invalidSessionResponse
    }
    return Set(strings)
  }
  private static func date(_ value: JSONValue?) -> Date? {
    guard let text = value?.string, matches(text, #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#)
    else { return nil }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let date = formatter.date(from: text), formatter.string(from: date) == text else {
      return nil
    }
    return date
  }
}
