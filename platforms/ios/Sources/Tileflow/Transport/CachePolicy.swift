import Foundation

/// The `Cache-Control` directives a private client cache acts on (RFC 9111). Shared-cache
/// directives such as `s-maxage` and `proxy-revalidate` do not apply to the SDK's cache.
struct CacheDirectives: Equatable, Sendable {
  var noStore = false
  var noCache = false
  var mustRevalidate = false
  var immutable = false
  var maxAge: Int?
  var staleIfError: Int?

  init(_ header: String?) {
    guard let header else { return }
    for part in header.split(separator: ",") {
      let pair = part.split(separator: "=", maxSplits: 1).map {
        $0.trimmingCharacters(in: .whitespaces)
      }
      guard let name = pair.first?.lowercased(), !name.isEmpty else { continue }
      let value = pair.count > 1 ? pair[1].trimmingCharacters(in: ["\""]) : nil
      // An unreadable delta counts as zero, which makes the response stale (RFC 9111 1.2.2).
      let seconds = value.map { Int($0).map { max(0, $0) } ?? 0 }
      switch name {
      case "no-store": noStore = true
      case "no-cache": noCache = true
      case "must-revalidate": mustRevalidate = true
      case "immutable": immutable = true
      case "max-age": maxAge = seconds ?? 0
      case "stale-if-error": staleIfError = seconds ?? 0
      default: continue
      }
    }
  }
}

/// How the transport may store and reuse responses. Every decision is made natively from the
/// response headers; the renderer cannot influence what is stored.
enum ResourceCachePolicy {
  /// Headers kept with a stored response and replayed when it is served.
  static let storedHeaders = [
    "Content-Type", "ETag", "Last-Modified", "Cache-Control", "Expires", "Date", "Age",
    "Tileflow-Fair-Use", "Tileflow-Fair-Use-Notice", "Tileflow-Protection",
  ]
  /// The longest heuristic lifetime for a public response with only `Last-Modified`.
  static let maximumHeuristicLifetime: TimeInterval = 24 * 60 * 60
  /// How long past its lifetime a public response may still answer when the network fails, unless
  /// it says otherwise with `stale-if-error`, `must-revalidate` or `no-cache`.
  static let defaultStaleIfError: TimeInterval = 30 * 24 * 60 * 60

  /// Whether a complete response may be stored. Only GET 200 responses to requests without a
  /// `Range` are stored, and `no-store` always wins.
  ///
  /// A public response without a lifetime or validator is still kept: it is refetched on every
  /// use, but can answer when the network fails. A protected (granted) response needs an explicit
  /// lifetime or a validator, and a `no-cache` response needs a validator to be useful.
  static func isStorable(status: Int, headers: [String: String], protected: Bool) -> Bool {
    guard status == 200 else { return false }
    let directives = CacheDirectives(headers["Cache-Control"])
    guard !directives.noStore else { return false }
    if let vary = headers["Vary"],
      vary.split(separator: ",").contains(where: { $0.trimmingCharacters(in: .whitespaces) == "*" })
    {
      return false
    }
    let explicit = directives.maxAge != nil || headers["Expires"] != nil
    let validator = headers["ETag"] != nil || headers["Last-Modified"] != nil
    if directives.noCache { return validator }
    return protected ? explicit || validator : true
  }

  /// When a response stored at `responseTime` stops being fresh.
  static func expiry(
    headers: [String: String], responseTime: Date, protected: Bool
  ) -> Date {
    let directives = CacheDirectives(headers["Cache-Control"])
    let age = TimeInterval(headers["Age"].flatMap { Int($0) }.map { max(0, $0) } ?? 0)
    let date = headers["Date"].flatMap(HTTPDate.parse) ?? responseTime
    let lifetime: TimeInterval
    if directives.noCache {
      lifetime = 0
    } else if let maxAge = directives.maxAge {
      lifetime = TimeInterval(maxAge)
    } else if let expires = headers["Expires"] {
      lifetime = HTTPDate.parse(expires).map { max(0, $0.timeIntervalSince(date)) } ?? 0
    } else if !protected, let modified = headers["Last-Modified"].flatMap(HTTPDate.parse) {
      lifetime = min(maximumHeuristicLifetime, max(0, date.timeIntervalSince(modified)) / 10)
    } else {
      lifetime = 0
    }
    return responseTime.addingTimeInterval(lifetime - age)
  }

  /// The latest time a stored response may answer a request whose network attempt failed.
  /// Protected responses are never served past their lifetime.
  static func staleLimit(headers: [String: String], expiry: Date, protected: Bool) -> Date {
    let directives = CacheDirectives(headers["Cache-Control"])
    guard !protected, !directives.noCache, !directives.mustRevalidate else { return expiry }
    let allowance = directives.staleIfError.map(TimeInterval.init) ?? defaultStaleIfError
    return expiry.addingTimeInterval(allowance)
  }

  /// Conditional request headers for revalidating a stored response.
  static func validators(_ headers: [String: String]) -> [String: String] {
    var result: [String: String] = [:]
    if let etag = headers["ETag"] { result["If-None-Match"] = etag }
    if let modified = headers["Last-Modified"] { result["If-Modified-Since"] = modified }
    return result
  }

  /// The stored headers after a `304 Not Modified` refreshed them (RFC 9111 4.3.4).
  static func merging(_ stored: [String: String], notModified: [String: String]) -> [String: String]
  {
    var merged = stored
    for name in storedHeaders where name != "Content-Type" {
      if let value = notModified[name] { merged[name] = value }
    }
    return merged
  }

  /// The subset of response headers kept with a stored response.
  static func storable(_ headers: [String: String]) -> [String: String] {
    headers.filter { storedHeaders.contains($0.key) }
  }
}

/// IMF-fixdate parsing for `Date`, `Expires` and `Last-Modified`.
enum HTTPDate {
  private static let formatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(identifier: "GMT")
    formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
    return formatter
  }()
  private static let lock = NSLock()

  static func parse(_ value: String) -> Date? {
    lock.withLock { formatter.date(from: value) }
  }

  static func format(_ date: Date) -> String {
    lock.withLock { formatter.string(from: date) }
  }
}
