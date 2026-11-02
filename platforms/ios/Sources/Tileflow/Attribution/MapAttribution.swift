import Foundation

/// One line of a map's attribution.
struct MapAttributionEntry: Equatable, Sendable {
  /// The exact text: a source's attribution as its style declares it, or a credit's text.
  let text: String
  /// The page a credit links to; source attributions carry their own links.
  let href: String?
}

/// A regional credit of a downloaded release: shown while one of its boxes is in view.
struct MapAttributionCredit: Equatable, Sendable {
  let id: String
  let text: String
  let href: String
  /// `[west, south, east, north]` boxes.
  let regions: [[Double]]

  /// A credit in the form the map view gives its engine: `{id, text, href, regions}`.
  init?(wire value: JSONValue) {
    guard let id = value["id"]?.string, let text = value["text"]?.string, !text.isEmpty,
      let href = value["href"]?.string, href.hasPrefix("https://"),
      let boxes = value["regions"]?.array
    else { return nil }
    var regions: [[Double]] = []
    for box in boxes {
      guard let items = box.array?.compactMap(\.number), items.count == 4,
        items.allSatisfy(\.isFinite)
      else { return nil }
      regions.append(items)
    }
    guard !regions.isEmpty else { return nil }
    self.init(id: id, text: text, href: href, regions: regions)
  }

  init(id: String, text: String, href: String, regions: [[Double]]) {
    self.id = id
    self.text = text
    self.href = href
    self.regions = regions
  }

  /// Whether a box intersects the view. The view's longitudes may run past ±180°, as a camera
  /// over the antimeridian sees world copies; a view wider than the world sees every box.
  func isVisible(in view: TileflowBounds) -> Bool {
    let wide = view.east - view.west >= 360
    return regions.contains { box in
      let (west, south, east, north) = (box[0], box[1], box[2], box[3])
      if south > view.north || north < view.south { return false }
      if wide { return true }
      return [-360.0, 0, 360].contains { shift in
        west + shift <= view.east && east + shift >= view.west
      }
    }
  }
}

/// What a map credits in a view: the attribution of each source of its style, then each regional
/// credit with a box in view whose text no source attribution already shows. This is the model of
/// the attribution the map shows; the view that draws it reads ``entries(in:)``.
struct MapAttribution: Equatable, Sendable {
  var sources: [String] = []
  var credits: [MapAttributionCredit] = []

  func entries(in view: TileflowBounds) -> [MapAttributionEntry] {
    var entries: [MapAttributionEntry] = []
    for text in sources where !text.isEmpty && !entries.contains(where: { $0.text == text }) {
      entries.append(MapAttributionEntry(text: text, href: nil))
    }
    let shown = sources.joined(separator: "\n")
    for credit in credits
    where credit.isVisible(in: view) && !shown.contains(credit.text)
      && !entries.contains(where: { $0.text == credit.text })
    {
      entries.append(MapAttributionEntry(text: credit.text, href: credit.href))
    }
    return entries
  }
}
