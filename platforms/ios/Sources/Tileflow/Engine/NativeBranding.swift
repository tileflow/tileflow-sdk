import Foundation
import UIKit

struct NativeBrandingSource: Hashable, Sendable {
  let origin: String
  let mapID: String?

  static func read(_ style: [String: Any], apiOrigin: String, hostedMapID: String? = nil) -> Set<
    Self
  > {
    let sources = style["sources"] as? [String: [String: Any]] ?? [:]
    let layers = style["layers"] as? [[String: Any]] ?? []
    var used = Set(
      layers.filter { ($0["layout"] as? [String: Any])?["visibility"] as? String != "none" }
        .compactMap { $0["source"] as? String })
    if let terrain = (style["terrain"] as? [String: Any])?["source"] as? String {
      used.insert(terrain)
    }
    let saved =
      (style["metadata"] as? [String: Any])?["tileflow:brandingSources"] as? [String: [String: Any]]
      ?? [:]
    let products: Set<String> = [
      "world", "world-detail", "world,world-detail", "terrain", "boundaries", "bathymetry",
      "bathymetry-dem", "nautical",
    ]
    var result = Set<Self>()
    for id in used {
      guard let source = sources[id] else { continue }
      let urls =
        [source["url"] as? String].compactMap { $0 }
        + (source["tiles"] as? [String] ?? [])
      if let entry = saved[id], let binding = entry["binding"] as? String,
        let bytes = binding.data(using: .utf8),
        (try? JSONSerialization.jsonObject(with: bytes)) as? [String] == urls,
        let deliveries = entry["deliveries"] as? [[String: Any]]
      {
        for value in deliveries where value["apiUrl"] as? String == apiOrigin {
          let mapID = value["mapId"] as? String
          if mapID == nil || HostedContract.matches(mapID!, #"^map_[A-Za-z0-9_-]{16}$"#) {
            result.insert(Self(origin: apiOrigin, mapID: mapID))
          }
        }
        continue
      }
      for text in urls {
        guard var url = URLComponents(string: text) else { continue }
        if url.scheme == "tileflow-contour", url.host == "tiles",
          let dem = url.queryItems?.first(where: { ["demTileJson", "demUrl"].contains($0.name) })?
            .value,
          let decoded = URLComponents(string: dem)
        {
          url = decoded
        }
        guard let address = url.url, ["http", "https"].contains(url.scheme),
          ResourcePolicy.origin(address) == apiOrigin
            || (apiOrigin == "https://api.tileflow.dev"
              && ["https://tiles.tileflow.dev", "https://world.tileflow.dev"].contains(ResourcePolicy.origin(address)))
        else { continue }
        let parts = url.path.split(separator: "/").map(String.init).filter { $0 != "v1" }
        guard parts.count >= 2, parts[0] == "tiles", products.contains(parts[1]) else { continue }
        let mapID = url.queryItems?.first { $0.name == "map" }?.value
        if mapID == nil || HostedContract.matches(mapID!, #"^map_[A-Za-z0-9_-]{16}$"#) {
          result.insert(Self(origin: apiOrigin, mapID: mapID))
        }
      }
    }
    return Set(result.map { Self(origin: $0.origin, mapID: hostedMapID ?? $0.mapID) })
  }
}

/// Per-map leases; failure conceals the map instead of showing a provisional paid logo.
@MainActor
final class NativeBranding {
  enum State: Equatable { case pending, required, none }
  private var task: Task<Void, Never>?
  private var expiryTask: Task<Void, Never>?
  private var sources: Set<NativeBrandingSource>?
  private var leases:
    [NativeBrandingSource: (required: Bool, revision: Decimal, expires: TimeInterval)] = [:]
  private let load: @MainActor (URL) async throws -> [String: Any]
  private let offline: @MainActor () async -> (Bool, Bool?)
  private let present: @MainActor (State) -> Void

  init(
    load: @escaping @MainActor (URL) async throws -> [String: Any],
    offline: @escaping @MainActor () async -> (Bool, Bool?),
    present: @escaping @MainActor (State) -> Void
  ) {
    self.load = load
    self.offline = offline
    self.present = present
  }

  func update(_ sources: Set<NativeBrandingSource>) {
    guard sources != self.sources else { return }
    self.sources = sources
    task?.cancel()
    expiryTask?.cancel()
    leases = leases.filter { sources.contains($0.key) }
    present(sources.contains { $0.mapID != nil } ? .pending : sources.isEmpty ? .none : .required)
    guard sources.contains(where: { $0.mapID != nil }) else { return }
    task = Task { [weak self] in
      while !Task.isCancelled {
        guard let self else { return }
        await self.refresh(sources)
        let remaining =
          self.leases.values.map { $0.expires - ProcessInfo.processInfo.systemUptime }.filter {
            $0 > 0
          }.min() ?? 5
        do { try await Task.sleep(for: .seconds(min(5, max(0.001, remaining)))) } catch { return }
      }
    }
  }

  private func refresh(_ sources: Set<NativeBrandingSource>) async {
    if sources.isEmpty {
      present(.none)
      return
    }
    let (fromPacks, receipt) = await offline()
    if fromPacks {
      expiryTask?.cancel()
      if !Task.isCancelled { present(receipt.map { $0 ? .required : .none } ?? .pending) }
      return
    }
    var ready = true
    var required = sources.contains { $0.mapID == nil }
    for source in sources {
      guard let mapID = source.mapID else { continue }
      let now = ProcessInfo.processInfo.systemUptime
      if leases[source].map({ $0.expires <= now }) ?? true { present(.pending) }
      if leases[source].map({ $0.expires - now < 30 }) ?? true {
        do {
          let value = try await load(URL(string: "\(source.origin)/maps/\(mapID)/mobile/branding")!)
          try Task.checkCancellation()
          let policy = JSONValue(foundation: value)
          guard policy["mapId"]?.string == mapID,
            let required = policy["catalogLogoRequired"]?.bool,
            let revisionText = value["revision"] as? String,
            HostedContract.matches(revisionText, #"^[0-9]{1,32}$"#),
            let revision = Decimal(string: revisionText),
            let validity = policy["validForMs"]?.number, validity > 0, validity <= 900_000,
            now + validity / 1000 > ProcessInfo.processInfo.systemUptime,
            leases[source].map({ revision >= $0.revision }) ?? true
          else { throw TileflowMapError.resourceFailed }
          leases[source] = (required, revision, now + validity / 1000)
          watchExpiry()
        } catch {}
      }
      if let lease = leases[source], lease.expires > ProcessInfo.processInfo.systemUptime {
        required = required || lease.required
      } else {
        ready = false
      }
    }
    if !Task.isCancelled { present(ready ? required ? .required : .none : .pending) }
  }

  private func watchExpiry() {
    expiryTask?.cancel()
    guard let expires = leases.values.map(\.expires).min() else { return }
    expiryTask = Task { [weak self] in
      do {
        try await Task.sleep(for: .seconds(max(0, expires - ProcessInfo.processInfo.systemUptime)))
      } catch { return }
      guard !Task.isCancelled else { return }
      self?.present(.pending)
    }
  }

  func retire() {
    expiryTask?.cancel()
    expiryTask = nil
    task?.cancel()
    task = nil
    sources = nil
    leases.removeAll()
  }
}

@MainActor
final class NativeBrandingButton: UIButton {
  override init(frame: CGRect) {
    super.init(frame: frame)
    accessibilityLabel = "Visit Tileflow"
    accessibilityTraits = .link
    backgroundColor = .clear
    layer.cornerRadius = 4
    isHidden = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("Created by the map engine.") }

  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    context.saveGState()
    defer { context.restoreGState() }
    context.setShadow(offset: .zero, blur: 2, color: UIColor.black.withAlphaComponent(0.3).cgColor)
    let ink = UIColor.white.withAlphaComponent(0.9)
    let attributes: [NSAttributedString.Key: Any] = [
      .font: UIFont.boldSystemFont(ofSize: 17), .foregroundColor: ink, .kern: -0.6,
    ]
    let word = "Tileflow" as NSString
    word.draw(at: CGPoint(x: 10, y: 15), withAttributes: attributes)
    let left = 11 + word.size(withAttributes: attributes).width
    ink.setFill()
    for (x, y) in [(0, 0), (6, 0), (3, 6), (9, 6), (6, 12), (12, 12)] {
      UIRectFill(CGRect(x: left + Double(x) * 0.77, y: 12 + Double(y) * 0.77, width: 3.08, height: 3.08))
    }
  }
}
