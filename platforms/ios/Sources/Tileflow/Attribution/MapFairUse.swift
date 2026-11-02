import Foundation

/// World's fair-use notice, as the web adapters show it.
struct MapFairUseNotice: Equatable, Sendable {
  enum State: String, Sendable {
    /// The site approaches its temporary limit.
    case grace
    /// The site reached it; its owner should manage the map with Tileflow.
    case managedRequired
    /// Tileflow temporarily limits anonymous World delivery for everyone.
    case limited
  }

  let state: State
  let message: String
  let action: String
  let help: URL

  /// The page World's responses name with `Link: <…>; rel="help"`, which the SDK's transport does
  /// not keep; the notice links to the same page the web adapters fall back to.
  static let helpPage = URL(string: "https://tileflow.dev/world/connect")!

  init(_ state: State) {
    self.state = state
    switch state {
    case .limited: message = "Some map areas are temporarily unavailable."
    case .managedRequired: message = "Map usage is temporarily limited."
    case .grace: message = "Map usage is approaching its temporary limit."
    }
    action = "Site owner: manage this map with Tileflow."
    help = Self.helpPage
  }
}

/// What one World tile response says about fair use. It holds no address.
struct MapFairUseSignal: Equatable, Sendable {
  let status: Int
  /// `Tileflow-Fair-Use`: `open`, `grace` or `managed-required`.
  let fairUse: String?
  /// `Tileflow-Fair-Use-Notice: owner`.
  let ownerNotice: Bool
  /// `Tileflow-Protection`.
  let protection: String?

  /// The signal of a response to a canonical World tile address, or nil for any other resource.
  init?(_ remote: URL, status: Int, headers: [String: String]) {
    guard Self.isWorldTile(remote) else { return nil }
    func header(_ name: String) -> String? {
      headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
    }
    self.init(
      status: status, fairUse: header("Tileflow-Fair-Use"),
      ownerNotice: header("Tileflow-Fair-Use-Notice") == "owner",
      protection: header("Tileflow-Protection"))
  }

  init(status: Int, fairUse: String?, ownerNotice: Bool = false, protection: String? = nil) {
    self.status = status
    self.fairUse = fairUse
    self.ownerNotice = ownerNotice
    self.protection = protection
  }

  /// A World tile at Tileflow, as the web adapters recognise one: `https`, a `tileflow.dev` host,
  /// `/tiles/world/<release>/<z>/<x>/<y>.pbf` and only the query keys World tiles carry, with one
  /// descriptor digest.
  static func isWorldTile(_ url: URL) -> Bool {
    guard url.scheme == "https", let host = url.host?.lowercased(),
      host == "tileflow.dev" || host.hasSuffix(".tileflow.dev"), url.port == nil, url.user == nil,
      url.password == nil, url.fragment == nil,
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return false }
    let path = #/^/tiles/world/(world-v1-[a-z0-9][a-z0-9._-]*[a-z0-9])/(?:0|[1-9][0-9]*)/(?:0|[1-9][0-9]*)/(?:0|[1-9][0-9]*)\.pbf$/#
    guard let match = components.path.wholeMatch(of: path), (12...128).contains(match.1.count)
    else { return false }
    let allowed: Set<String> = [
      "grant", "map", "renderExpires", "renderSignature", "session", "styleId",
      "worldDescriptorSha256",
    ]
    let items = components.queryItems ?? []
    guard items.allSatisfy({ allowed.contains($0.name) }) else { return false }
    let digests = items.filter { $0.name == "worldDescriptorSha256" }
    return digests.count == 1
      && digests[0].value?.wholeMatch(of: #/[0-9a-f]{64}/#) != nil
  }
}

/// The fair-use notice of one map, from its World tile responses in the order they arrive, with
/// the rules the web adapters follow: a degradation (503 with `Tileflow-Protection`) holds the
/// limited notice for a minute so cached tiles do not make it flicker; `managed-required` outranks
/// `grace`; an `open` success clears the notice.
struct MapFairUseState: Sendable {
  private(set) var notice: MapFairUseNotice?
  private var limitedUntil = Date.distantPast
  static let limitedHold: TimeInterval = 60

  /// Reads a response; true when the notice changed.
  mutating func receive(_ signal: MapFairUseSignal, at now: Date = Date()) -> Bool {
    let before = notice
    let ok = (200..<300).contains(signal.status)
    let state = notice?.state
    if signal.status == 503, signal.protection == "protected" || signal.protection == "cached-only"
    {
      limitedUntil = now.addingTimeInterval(Self.limitedHold)
      if state != .managedRequired, state != .limited { notice = MapFairUseNotice(.limited) }
    }
    let current = notice?.state
    let limitedHeld = current == .limited && now < limitedUntil
    switch signal.fairUse {
    case "open":
      if ok, !limitedHeld { notice = nil }
    case "managed-required":
      notice = MapFairUseNotice(.managedRequired)
    case "grace" where signal.ownerNotice || signal.status == 429:
      if current != .managedRequired, !limitedHeld { notice = MapFairUseNotice(.grace) }
    case "grace" where ok:
      if current != .managedRequired, !limitedHeld { notice = nil }
    default:
      break
    }
    return notice != before
  }
}
