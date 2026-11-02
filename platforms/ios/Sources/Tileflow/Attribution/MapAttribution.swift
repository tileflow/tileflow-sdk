import Foundation

/// One item of a map's attribution: its exact text, and the parts of it that open a page.
struct MapAttributionEntry: Equatable, Sendable {
  enum Kind: String, Sendable {
    /// A credit from a source's attribution, in the style the map shows.
    case source
    /// A notice a downloaded source requires wherever its data is shown.
    case obligation
    /// The page that holds a downloaded source's full notices.
    case page
    /// A downloaded source's credit for the places one of its boxes covers.
    case regional
    /// A notice the style declares, such as "Not for navigation".
    case notice
    /// World's fair-use notice.
    case fairUse
  }

  /// A part of ``text`` that opens an `https` page. The range counts UTF-16 code units.
  struct Link: Equatable, Sendable {
    let range: Range<Int>
    let url: URL
  }

  let kind: Kind
  let text: String
  let links: [Link]

  init(_ kind: Kind, _ text: String, links: [Link] = []) {
    self.kind = kind
    self.text = text
    self.links = links
  }

  /// An entry whose whole text opens `url`, when `url` is an `https` page.
  init(_ kind: Kind, _ text: String, link url: String?) {
    let page = url.flatMap(MapAttributionText.page)
    self.init(kind, text, links: page.map { [Link(range: 0..<text.utf16.count, url: $0)] } ?? [])
  }

  /// The text of the part a link covers.
  func text(of link: Link) -> String {
    let units = Array(text.utf16)
    guard link.range.lowerBound >= 0, link.range.upperBound <= units.count else { return text }
    return String(decoding: units[link.range], as: UTF16.self)
  }
}

/// A regional credit of a downloaded release: shown while one of its boxes is in view.
struct MapAttributionCredit: Equatable, Sendable {
  let id: String
  let text: String
  let href: String
  /// `[west, south, east, north]` boxes.
  let regions: [[Double]]

  init(id: String, text: String, href: String, regions: [[Double]]) {
    self.id = id
    self.text = text
    self.href = href
    self.regions = regions
  }

  init(_ credit: OfflineCredit) {
    self.init(id: credit.id, text: credit.text, href: credit.href, regions: credit.regions)
  }

  /// Whether a box intersects the view. The view's longitudes may run past ±180°, as a camera
  /// over the antimeridian sees world copies; a view wider than the world sees every box. Touching
  /// edges count, as the service's own intersection does.
  func isVisible(in view: TileflowBounds) -> Bool {
    let wide = view.east - view.west >= 360
    return regions.contains { box in
      guard box.count == 4 else { return false }
      let (west, south, east, north) = (box[0], box[1], box[2], box[3])
      if south > view.north || north < view.south { return false }
      if wide { return true }
      return [-360.0, 0, 360].contains { shift in
        west + shift <= view.east && east + shift >= view.west
      }
    }
  }
}

/// A notice of a downloaded source that is shown wherever its data is, or the page that holds the
/// source's full notices.
struct MapAttributionObligation: Equatable, Sendable {
  let text: String
  /// The page's address, for a source's page; nil for an obligation.
  let href: String?

  init(text: String, href: String? = nil) {
    self.text = text
    self.href = href
  }

  init(_ obligation: OfflineObligation) {
    self.init(text: obligation.text, href: obligation.href)
  }
}

/// What a map credits in a view. The control shows, in this order and each text once:
///
/// 1. the attribution of each source of the style the map shows, as its items
///    (``MapAttributionText``);
/// 2. the obligations and the page of each source its downloaded regions hold, always;
/// 3. each regional credit of those sources while one of its boxes is in view;
/// 4. the notices the style declares;
/// 5. World's fair-use notice while World asks for one.
///
/// Texts are exact: nothing here rewrites them, and an item whose exact text is already shown is
/// not repeated. Only `https` addresses become links.
struct MapAttribution: Equatable, Sendable {
  /// Each source's attribution, as the style declares it: plain text or HTML with links.
  var sources: [String] = []
  /// The obligations and pages of the downloaded sources, in the order their manifests list them.
  var obligations: [MapAttributionObligation] = []
  /// The regional credits of the downloaded sources.
  var credits: [MapAttributionCredit] = []
  /// The style's notices.
  var notices: [String] = []
  var fairUse: MapFairUseNotice?

  func entries(in view: TileflowBounds?) -> [MapAttributionEntry] {
    var entries: [MapAttributionEntry] = []
    var shown: Set<String> = []
    func add(_ entry: MapAttributionEntry) {
      guard !entry.text.isEmpty, shown.insert(entry.text).inserted else { return }
      entries.append(entry)
    }
    for source in sources {
      for item in MapAttributionText.items(source) {
        add(MapAttributionEntry(.source, item.text, links: item.links))
      }
    }
    for obligation in obligations {
      let kind: MapAttributionEntry.Kind = obligation.href == nil ? .obligation : .page
      add(MapAttributionEntry(kind, obligation.text, link: obligation.href))
    }
    if let view {
      for credit in credits where credit.isVisible(in: view) {
        add(MapAttributionEntry(.regional, credit.text, link: credit.href))
      }
    }
    for notice in notices { add(MapAttributionEntry(.notice, notice)) }
    if let fairUse {
      let text = "\(fairUse.message) \(fairUse.action)"
      let start = fairUse.message.utf16.count + 1
      add(
        MapAttributionEntry(
          .fairUse, text,
          links: [.init(range: start..<(start + fairUse.action.utf16.count), url: fairUse.help)]))
    }
    return entries
  }

  /// The notices a style declares in `tileflow:notices`, as Core reads them: at most 8, each with
  /// an identifier, the sources it names and a short trimmed text. Malformed entries are ignored.
  static func notices(_ style: [String: Any]) -> [String] {
    guard let metadata = style["metadata"] as? [String: Any],
      let values = metadata["tileflow:notices"] as? [Any]
    else { return [] }
    let identifier = #/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/#
    var ids: Set<String> = []
    var notices: [String] = []
    for value in values.prefix(8) {
      guard let notice = value as? [String: Any], let id = notice["id"] as? String,
        id.wholeMatch(of: identifier) != nil, let text = notice["text"] as? String, !text.isEmpty,
        text.utf16.count <= 120, text == text.trimmingCharacters(in: .whitespacesAndNewlines),
        !text.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }),
        let sources = notice["sources"] as? [Any], sources.count <= 16,
        sources.allSatisfy({ ($0 as? String)?.wholeMatch(of: identifier) != nil }),
        ids.insert(id).inserted
      else { continue }
      notices.append(text)
    }
    return notices
  }
}
