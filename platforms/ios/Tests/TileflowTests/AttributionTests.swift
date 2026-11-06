import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// What a map credits in a view: its style's sources, the obligations and pages of its downloaded
/// sources always, their regional credits while one of their boxes is in view, the style's notices
/// and World's fair-use notice, in that order, each exact text once, with `https` links only.
@MainActor
final class AttributionTests: XCTestCase {
  private let spain = MapAttributionCredit(
    id: "es-ign", text: "© IGN España", href: "https://www.ign.es",
    regions: [[-9.4, 35.9, 4.4, 43.8], [-18.2, 27.6, -13.4, 29.5]])
  private let fiji = MapAttributionCredit(
    id: "fj", text: "Fiji", href: "https://example.com/fiji", regions: [[177, -19.2, 180, -16]])

  private func visible(_ credits: [MapAttributionCredit], _ view: TileflowBounds) -> [String] {
    credits.filter { $0.isVisible(in: view) }.map(\.id)
  }

  private func bounds(_ values: [Double]) -> TileflowBounds {
    TileflowBounds(west: values[0], south: values[1], east: values[2], north: values[3])
  }

  // MARK: Regional credits

  func testACreditIsVisibleWhileOneOfItsBoxesIntersectsTheView() {
    let madrid = TileflowBounds(west: -3.8, south: 40.3, east: -3.6, north: 40.5)
    XCTAssertEqual(visible([spain, fiji], madrid), ["es-ign"])
    let canaries = TileflowBounds(west: -16, south: 28, east: -15, north: 29)
    XCTAssertEqual(visible([spain], canaries), ["es-ign"])
    let paris = TileflowBounds(west: 2.2, south: 48.8, east: 2.5, north: 48.9)
    XCTAssertEqual(visible([spain], paris), [])
    // Touching edges count, as the service's own intersection does.
    XCTAssertEqual(
      visible([spain], TileflowBounds(west: 4.4, south: 43.8, east: 5, north: 44)), ["es-ign"])
  }

  func testViewsAcrossTheAntimeridianAndWiderThanTheWorld() {
    let across = TileflowBounds(west: 178, south: -18, east: 182, north: -17)
    XCTAssertEqual(visible([fiji, spain], across), ["fj"])
    let west = TileflowBounds(west: -183, south: -18, east: -179, north: -17)
    XCTAssertEqual(visible([fiji], west), ["fj"])
    let world = TileflowBounds(west: -200, south: -80, east: 200, north: 80)
    XCTAssertEqual(visible([spain, fiji], world), ["es-ign", "fj"])
  }

  /// The text of a credit is shown as it is, never read as HTML, and its link is its exact page.
  func testCreditTextAndLinksAreExact() throws {
    let credit = MapAttributionCredit(
      id: "a", text: "<b>A & B</b>", href: "https://a.test/?x=1&y=2", regions: [[0, 0, 1, 1]])
    let entries = MapAttribution(credits: [credit]).entries(in: bounds([0, 0, 1, 1]))
    XCTAssertEqual(entries.map(\.text), ["<b>A & B</b>"])
    XCTAssertEqual(entries.first?.links.first?.url.absoluteString, "https://a.test/?x=1&y=2")
    XCTAssertEqual(entries.first?.links.first?.range, 0..<12)
    let insecure = MapAttributionCredit(
      id: "b", text: "B", href: "http://b.test", regions: [[0, 0, 1, 1]])
    let plain = MapAttribution(credits: [insecure]).entries(in: bounds([0, 0, 1, 1]))
    XCTAssertEqual(plain.map(\.text), ["B"])
    XCTAssertEqual(plain.first?.links, [], "Links open only https")
  }

  // MARK: Composition

  func testEntriesFollowTheirOrderAndShowEachExactTextOnce() throws {
    var attribution = MapAttribution(
      sources: [
        #"<a href="https://tileflow.dev/copyright">© Tileflow</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>"#,
        "",
        #"<a href="https://tileflow.dev/copyright">© Tileflow</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> <a href="https://tileflow.dev/copyright#nautical">NOAA ENC 2026-10-20 — not official, not for navigation</a>"#,
        "Fiji",
      ],
      obligations: [
        .init(text: "Not for navigation. Read the notices."),
        .init(text: "Tileflow Nautical sources and notices", href: "https://tileflow.dev/copyright#nautical"),
        .init(text: "Not for navigation. Read the notices."),
      ],
      credits: [spain, fiji],
      notices: ["Not for navigation", "Not for navigation"])
    let madrid = TileflowBounds(west: -3.8, south: 40.3, east: -3.6, north: 40.5)
    let entries = attribution.entries(in: madrid)
    XCTAssertEqual(
      entries.map(\.text),
      [
        "© Tileflow", "© OpenStreetMap", "NOAA ENC 2026-10-20 — not official, not for navigation",
        "Fiji", "Not for navigation. Read the notices.", "Tileflow Nautical sources and notices",
        "© IGN España", "Not for navigation",
      ])
    XCTAssertEqual(
      entries.map(\.kind),
      [.source, .source, .source, .source, .obligation, .page, .regional, .notice])
    XCTAssertEqual(
      entries[1].links,
      [.init(range: 0..<15, url: URL(string: "https://www.openstreetmap.org/copyright")!)])
    // A regional credit a source already shows by its exact text is not repeated.
    let suva = TileflowBounds(west: 178.3, south: -18.2, east: 178.5, north: -18.0)
    XCTAssertEqual(attribution.entries(in: suva).filter { $0.kind == .regional }, [])
    // Without a view yet, no regional credit shows; everything else does.
    XCTAssertEqual(attribution.entries(in: nil).filter { $0.kind == .regional }, [])
    XCTAssertEqual(attribution.entries(in: nil).count, entries.count - 1)

    attribution.fairUse = MapFairUseNotice(.managedRequired)
    let notice = try XCTUnwrap(attribution.entries(in: madrid).last)
    XCTAssertEqual(notice.kind, .fairUse)
    XCTAssertEqual(
      notice.text, "Map usage is temporarily limited. Site owner: manage this map with Tileflow.")
    XCTAssertEqual(
      notice.links.map { notice.text(of: $0) }, ["Site owner: manage this map with Tileflow."])
    XCTAssertEqual(notice.links.first?.url, MapFairUseNotice.helpPage)
  }

  /// A source's attribution as a browser shows it: a list of links gives an item per link, other
  /// HTML stays one item with its text around its link, and only https addresses link.
  func testSourceAttributionReadsAsABrowserShowsIt() {
    func texts(_ html: String) -> [String] { MapAttributionText.items(html).map(\.text) }
    XCTAssertEqual(texts("Fixture World"), ["Fixture World"])
    XCTAssertEqual(texts("  "), [])
    XCTAssertEqual(
      texts(#"<a href='https://a.test'>A</a>  <a href=https://b.test>B</a>"#), ["A", "B"])
    let osm = MapAttributionText.items(
      #"&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors"#
    )
    XCTAssertEqual(osm.map(\.text), ["© OpenStreetMap contributors"])
    XCTAssertEqual(osm.first?.links.map(\.range), [2..<15])
    XCTAssertEqual(texts(#"<a href="https://a.test">A</a> | <a href="https://b.test">B</a>"#), ["A | B"])
    XCTAssertEqual(texts("A<br>B &amp; C&#160;D &#x41; &unknown; <b>bold</b>"), ["A B & C\u{00A0}D A &unknown; bold"])
    XCTAssertEqual(texts("A <b"), ["A <b"])
    let insecure = MapAttributionText.items(#"<a href="http://a.test">A</a> <a href="javascript:x">B</a>"#)
    XCTAssertEqual(insecure.map(\.text), ["A", "B"])
    XCTAssertEqual(insecure.flatMap(\.links), [])
    let entity = MapAttributionText.items(#"<a href="https://a.test/?x=1&amp;y=2">A</a>"#)
    XCTAssertEqual(entity.first?.links.first?.url.absoluteString, "https://a.test/?x=1&y=2")
  }

  func testTheStyleDeclaresItsNoticesAsCoreReadsThem() {
    let notice = { (id: Any, text: Any, sources: Any) -> [String: Any] in
      ["id": id, "text": text, "sources": sources]
    }
    let style: [String: Any] = [
      "metadata": [
        "tileflow:notices": [
          notice("nautical", "Not for navigation", ["nautical"]),
          notice("nautical", "Repeated identifier", ["nautical"]),
          notice("bad id", "Bad identifier", []),
          notice("padded", " Padded ", []),
          notice("long", String(repeating: "a", count: 121), []),
          notice("control", "Bell\u{07}", []),
          notice("sources", "Bad sources", ["bad source"]),
          notice("depth", "Depths in metres", []),
        ] + Array(repeating: notice("late", "Past the eighth", []), count: 3)
      ]
    ]
    XCTAssertEqual(MapAttribution.notices(style), ["Not for navigation", "Depths in metres"])
    XCTAssertEqual(MapAttribution.notices([:]), [])
    // Notices are the map author's choice: a Nautical source alone adds none.
    let control = MapAttributionControl()
    control.setStyle(
      ["sources": ["nautical": ["type": "vector", "url": "https://api.tileflow.dev/tiles/nautical/tiles.json"]]],
      attributions: ["© Tileflow"])
    XCTAssertEqual(control.entries.filter { $0.kind == .notice }, [])
  }

  // MARK: Fair use

  func testWorldFairUseFollowsWorldTileResponses() throws {
    let tile = URL(
      string:
        "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/14/8000/6000.pbf?session=s&worldDescriptorSha256=\(String(repeating: "a", count: 64))"
    )!
    XCTAssertNotNil(MapFairUseSignal(tile, status: 200, headers: ["Tileflow-Fair-Use": "open"]))
    for other in [
      "http://api.tileflow.dev/tiles/world/world-v1-2026-10-01/1/0/0.pbf?worldDescriptorSha256=\(String(repeating: "a", count: 64))",
      "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/1/0/0.pbf",
      "https://tileflow.test/tiles/world/world-v1-2026-10-01/1/0/0.pbf?worldDescriptorSha256=\(String(repeating: "a", count: 64))",
      "https://api.tileflow.dev/tiles/world/1/1/0/0.pbf?worldDescriptorSha256=\(String(repeating: "a", count: 64))",
      "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/01/0/0.pbf?worldDescriptorSha256=\(String(repeating: "a", count: 64))",
      "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/1/0/0.pbf?other=1&worldDescriptorSha256=\(String(repeating: "a", count: 64))",
    ] {
      XCTAssertNil(MapFairUseSignal(URL(string: other)!, status: 200, headers: [:]), other)
    }

    var state = MapFairUseState()
    let start = Date()
    XCTAssertFalse(state.receive(.init(status: 200, fairUse: "grace"), at: start))
    XCTAssertTrue(state.receive(.init(status: 200, fairUse: "grace", ownerNotice: true), at: start))
    XCTAssertEqual(state.notice?.state, .grace)
    XCTAssertTrue(state.receive(.init(status: 429, fairUse: "managed-required"), at: start))
    XCTAssertEqual(state.notice?.message, "Map usage is temporarily limited.")
    // Managed-required outranks grace and a degradation.
    XCTAssertFalse(state.receive(.init(status: 429, fairUse: "grace"), at: start))
    XCTAssertFalse(state.receive(.init(status: 503, fairUse: nil, protection: "protected"), at: start))
    XCTAssertTrue(state.receive(.init(status: 200, fairUse: "open"), at: start))
    XCTAssertNil(state.notice)
    // A degradation holds the limited notice for a minute against successes and grace.
    XCTAssertTrue(
      state.receive(.init(status: 503, fairUse: nil, protection: "cached-only"), at: start))
    XCTAssertEqual(state.notice?.message, "Some map areas are temporarily unavailable.")
    XCTAssertFalse(state.receive(.init(status: 200, fairUse: "open"), at: start + 30))
    XCTAssertFalse(state.receive(.init(status: 429, fairUse: "grace"), at: start + 30))
    XCTAssertTrue(state.receive(.init(status: 200, fairUse: "open"), at: start + 61))
    XCTAssertNil(state.notice)
  }

  // MARK: Downloaded credits

  /// The manifest's attribution of a download: each source's obligations and page, and its
  /// regional credits. The same credit of two sources or downloads keeps every box; credits that
  /// share an identifier but not their text both show.
  func testDownloadedCreditsReadEachSourcesObligationsPageAndRegionalCredits() async throws {
    let manifest = try JSONDecoder().decode(
      [JSONValue].self,
      from: Data(
        #"""
        [
          {"source": "nautical", "text": "N", "obligations": [{"id": "n", "exact": "Not for navigation."}],
           "regionalObligations": [{"id": "noaa-enc", "exact": "NOAA for Nautical", "href": "https://tileflow.dev/copyright#nautical", "regions": [[-131, 23, -64, 50]]}],
           "page": {"exact": "Nautical notices", "href": "https://tileflow.dev/copyright#nautical"}},
          {"source": "bathymetry", "text": "B", "obligations": [{"id": "b", "exact": "Depths mix references."}, {"id": "", "exact": "No identifier"}],
           "regionalObligations": [{"id": "noaa-enc", "exact": "NOAA for Bathymetry", "href": "https://tileflow.dev/copyright#bathymetry", "regions": [[-131, 23, -64, 50]]}],
           "page": {"exact": "Bathymetry notices", "href": "http://tileflow.dev/copyright#bathymetry"}},
          {"source": "bathymetry-dem", "text": "B", "obligations": [{"id": "b", "exact": "Depths mix references."}],
           "regionalObligations": [{"id": "noaa-enc", "exact": "NOAA for Bathymetry", "href": "https://tileflow.dev/copyright#bathymetry", "regions": [[-180, 50, -129, 75]]}]},
          {"source": "world", "text": "W"}
        ]
        """#.utf8))
    let obligations = OfflineObligation.obligations(manifest)
    XCTAssertEqual(
      obligations.map(\.text), ["Not for navigation.", "Nautical notices", "Depths mix references."])
    XCTAssertEqual(obligations.map(\.href), [nil, "https://tileflow.dev/copyright#nautical", nil])
    let credits = OfflineCredit.credits(manifest)
    XCTAssertEqual(credits.map(\.text), ["NOAA for Nautical", "NOAA for Bathymetry"])
    XCTAssertEqual(credits.last?.regions, [[-131, 23, -64, 50], [-180, 50, -129, 75]])

    // The index merges what every store publishes the same way.
    let index = OfflineServingIndex()
    let scope = ResourceCacheScope.grant(
      apiOrigin: URL(string: "https://api.tileflow.test")!, mapID: "map_0123456789abcdef")
    index.publish(
      OfflineServingSnapshot(
        credits: [scope.directory: [credits[0]]], obligations: [scope.directory: obligations]),
      from: self)
    let other = NSObject()
    index.publish(
      OfflineServingSnapshot(
        credits: [scope.directory: credits], obligations: [scope.directory: obligations.reversed()]),
      from: other)
    let merged = await index.credits(for: scope)
    XCTAssertEqual(merged.map(\.text).sorted(), ["NOAA for Bathymetry", "NOAA for Nautical"])
    let mergedObligations = await index.obligations(for: scope)
    XCTAssertEqual(Set(mergedObligations.map(\.text)), Set(obligations.map(\.text)))
    XCTAssertEqual(mergedObligations.count, 3)
  }

  /// The platform's marine fixture: Nautical, Bathymetry and its DEM over Miami, Oslo and Madrid,
  /// with and without the dated NOAA and USACE lines. In every case the obligations and the page
  /// show whatever the view, each regional credit shows over its place and not across the world
  /// from it, and a view wider than the world shows them all. Over Madrid only EMODnet is regional.
  func testEveryMarineCreditCombination() throws {
    let url = try XCTUnwrap(
      Bundle.module.url(
        forResource: "marine-credits", withExtension: "json", subdirectory: "Fixtures/Marine"))
    let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    let cases = try XCTUnwrap(fixture["cases"]?.array)
    XCTAssertEqual(cases.count, 12)
    var seen: Set<String> = []
    var places: [String: [JSONValue]] = [:]
    let always = [
      "Not for navigation. Tileflow Nautical is a derived visualization of OpenStreetMap seamarks and NGA publications; it is not an official chart.",
      "List of Lights (Pub. 110–116) and World Port Index (Pub. 150), courtesy of the U.S. National Geospatial-Intelligence Agency.",
      "Not for navigation. Tileflow Bathymetry is a visualization; its depths mix vertical references.",
      "GEBCO Grid, GEBCO Bathymetric Compilation Group:",
    ]
    for item in cases {
      let place = try XCTUnwrap(item["place"]?.string)
      let source = try XCTUnwrap(item["source"]?.string)
      let credit = try XCTUnwrap(item["credit"])
      places[place, default: []].append(credit)
      let view = bounds(try XCTUnwrap(item["bounds"]?.array?.compactMap(\.number)))
      let far = TileflowBounds(
        west: view.west + 180, south: -view.north, east: view.east + 180, north: -view.south)
      let world = TileflowBounds(west: -250, south: -85, east: 250, north: 85)
      let regional = OfflineCredit.credits([credit])
      let attribution = MapAttribution(
        sources: [try XCTUnwrap(item["attribution"]?.string)],
        obligations: OfflineObligation.obligations([credit]).map(MapAttributionObligation.init),
        credits: regional.map(MapAttributionCredit.init), notices: ["Not for navigation"])
      let here = attribution.entries(in: view)
      let expected = (credit["obligations"]?.array ?? []).compactMap { $0["exact"]?.string }
      XCTAssertEqual(
        here.filter { $0.kind == .obligation }.map(\.text), expected, "\(place) \(source)")
      XCTAssertEqual(
        here.filter { $0.kind == .page }.map(\.text), [credit["page"]?["exact"]?.string].compactMap { $0 })
      XCTAssertEqual(
        here.filter { $0.kind == .page }.first?.links.first?.url.absoluteString,
        credit["page"]?["href"]?.string)
      XCTAssertEqual(
        here.filter { $0.kind == .regional }.map(\.text), regional.map(\.text), "\(place) \(source)")
      for entry in here where entry.kind == .regional {
        let credit = try XCTUnwrap(regional.first { $0.text == entry.text })
        seen.insert(credit.id)
        // The credit opens its page; a licence written in it opens the licence.
        let licence = "https://creativecommons.org/licenses/by/4.0/"
        XCTAssertEqual(
          Set(entry.links.map(\.url.absoluteString)),
          Set([credit.href] + (credit.text.contains(licence) ? [licence] : [])))
      }
      XCTAssertEqual(attribution.entries(in: far).filter { $0.kind == .regional }, [])
      XCTAssertEqual(
        attribution.entries(in: far).filter { $0.kind != .regional }.map(\.text),
        here.filter { $0.kind != .regional }.map(\.text), "Everything else stays far away")
      XCTAssertEqual(
        attribution.entries(in: world).filter { $0.kind == .regional }.count, regional.count)
      // The sources' credits are each link of the release's map credit, exact and linked.
      let sourceItems = here.filter { $0.kind == .source }
      XCTAssertEqual(sourceItems.first?.text, "© Tileflow")
      XCTAssertTrue(sourceItems.allSatisfy { $0.links.count == 1 && $0.links[0].range == 0..<$0.text.utf16.count })
      XCTAssertEqual(here.last?.text, "Not for navigation")
    }
    XCTAssertEqual(seen, ["noaa-enc", "usace-ienc", "emodnet", "kartverket"])

    // A download over each place holds all three sources: Nautical's and Bathymetry's NOAA credits
    // both show over Miami, the DEM repeats nothing, and the obligations always show.
    func regional(_ place: String) throws -> [String] {
      let credits = try XCTUnwrap(places[place])
      let attribution = MapAttribution(
        obligations: OfflineObligation.obligations(credits).map(MapAttributionObligation.init),
        credits: OfflineCredit.credits(credits).map(MapAttributionCredit.init))
      let view = bounds(
        try XCTUnwrap(
          cases.first { $0["place"]?.string == place }?["bounds"]?.array?.compactMap(\.number)))
      let entries = attribution.entries(in: view)
      for text in always {
        XCTAssertTrue(entries.contains { $0.text.hasPrefix(text) }, "\(place): \(text)")
      }
      XCTAssertEqual(entries.filter { $0.kind == .page }.count, 2)
      return entries.filter { $0.kind == .regional }.map { String($0.text.prefix(10)) }
    }
    XCTAssertEqual(try regional("miami"), ["NOAA ENC 2", "USACE IENC", "NOAA ENC 2"])
    XCTAssertEqual(try regional("oslo"), ["EMODnet Di", "© Kartverk"])
    XCTAssertEqual(try regional("madrid"), ["EMODnet Di"])
  }

  // MARK: Control

  /// The control places itself in its corner inside the insets, compact enough for the space the
  /// map's other controls leave it; it reads every entry to VoiceOver and offers each link.
  func testTheControlStaysInItsCornerAndReadsEveryEntry() throws {
    let view = MapAttributionView(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
    var opened: [URL] = []
    view.onLink = { opened.append($0) }
    XCTAssertFalse(view.point(inside: CGPoint(x: 380, y: 830), with: nil), "Nothing to credit")
    let entries = MapAttribution(
      sources: [#"<a href="https://tileflow.dev/copyright">© Tileflow</a> Fixture"#],
      obligations: [.init(text: "A long obligation that only the full list and VoiceOver show.")],
      notices: ["Not for navigation"]
    ).entries(in: nil)
    view.show(entries)
    view.insets = UIEdgeInsets(top: 0, left: 0, bottom: 300, right: 20)
    view.layoutIfNeeded()
    XCTAssertEqual(view.control.frame.maxX, 390 - 20 - 8, accuracy: 0.5)
    XCTAssertEqual(view.control.frame.maxY, 844 - 300 - 8, accuracy: 0.5)
    XCTAssertLessThanOrEqual(
      view.control.frame.height + MapAttributionView.margin, MapControlsView.attributionSpace)
    XCTAssertEqual(pieces(view), ["© Tileflow Fixture", "Not for navigation"])
    XCTAssertEqual(
      view.control.accessibilityLabel,
      "© Tileflow Fixture\nA long obligation that only the full list and VoiceOver show.\nNot for navigation")
    let actions = try XCTUnwrap(view.control.accessibilityCustomActions)
    XCTAssertEqual(actions.map(\.name), ["Open © Tileflow"])
    _ = actions[0].actionHandler?(actions[0])
    XCTAssertEqual(opened, [URL(string: "https://tileflow.dev/copyright")!])
    XCTAssertTrue(view.point(inside: view.control.center, with: nil))
    XCTAssertFalse(view.point(inside: CGPoint(x: 10, y: 10), with: nil), "The map gets the rest")

    // Opened, the list shows every entry above the control, and its links reach the map view.
    view.control.sendActions(for: .primaryActionTriggered)
    view.layoutIfNeeded()
    XCTAssertTrue(view.isExpanded)
    XCTAssertFalse(view.list.isHidden)
    XCTAssertEqual(view.list.text, entries.map(\.text).joined(separator: "\n"))
    XCTAssertLessThanOrEqual(view.list.frame.maxY, view.control.frame.minY)
    XCTAssertGreaterThan(view.list.frame.height, 0)
    XCTAssertEqual(
      view.list.attributedText.attribute(.link, at: 0, effectiveRange: nil) as? URL,
      URL(string: "https://tileflow.dev/copyright"))
    view.control.sendActions(for: .primaryActionTriggered)
    XCTAssertFalse(view.isExpanded)

    view.corner = "top-left"
    view.layoutIfNeeded()
    XCTAssertEqual(view.control.frame.origin, CGPoint(x: 8, y: 8))
    // Right to left, the button leads from the right and the text aligns to it.
    view.semanticContentAttribute = .forceRightToLeft
    view.setNeedsLayout()
    view.layoutIfNeeded()
    XCTAssertEqual(view.label.textAlignment, .right)
    XCTAssertGreaterThan(view.label.frame.minX, -1)
    XCTAssertLessThan(view.label.frame.maxX, view.control.bounds.width - 10)
    view.show([])
    XCTAssertTrue(view.control.isHidden)
  }

  // MARK: Always on the map

  /// The pieces of the compact control's text, line by line.
  private func pieces(_ view: MapAttributionView) -> [String] {
    (view.label.text ?? "").components(separatedBy: "\n").flatMap {
      $0.components(separatedBy: MapAttributionStrip.separator)
    }
  }

  /// Whether a piece of the compact control shows `text`: whole, or its start and an ellipsis.
  private func shows(_ piece: String, _ text: String) -> Bool {
    piece == text
      || (piece.hasSuffix(MapAttributionStrip.ellipsis) && piece.count >= 2
        && text.hasPrefix(String(piece.dropLast())))
  }

  func testColonQualifiedChartCreditsKeepTheirQualificationWhenShortened() {
    let text = "NOAA ENC 2026-10-20: NOAA ENC® data, Office of Coast Survey. Tileflow Nautical is not an official or certified NOAA ENC."
    let shortened = MapAttributionStrip.shorten(text, to: 120, measure: { CGFloat($0.count * 6) })

    XCTAssertEqual(shortened, "NOAA…")
  }

  func testRegionalCreditsStayOnTheCompactStrip() {
    let entries = [
      MapAttributionEntry(.source, "© Tileflow"),
      MapAttributionEntry(.regional, "© IGN España"),
    ]
    XCTAssertEqual(MapAttributionStrip.items(entries).map(\.text), entries.map(\.text))
  }

  /// Every source credit stays on the map, shortened when needed and never left out, also with
  /// many sources on a narrow phone; the notice stays whole.
  func testEveryCreditStaysOnTheStripOfANarrowView() throws {
    let view = MapAttributionView(frame: CGRect(x: 0, y: 0, width: 320, height: 568))
    let credits = [
      #"<a href="https://tileflow.dev/copyright">© Tileflow</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>"#,
      #"© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors"#,
      #"<a href="https://tileflow.dev/copyright#nautical">NOAA ENC 2026-10-20 — not official, not for navigation</a> <a href="https://tileflow.dev/copyright#nautical">USACE IENC 2026-10-18 — not official, not for navigation</a>"#,
      "© Mapterhorn", "Fixture World", "© Kartverket",
    ]
    let attribution = MapAttribution(
      sources: credits, obligations: [.init(text: "A long obligation in the full list only.")],
      notices: ["Not for navigation"])
    let entries = attribution.entries(in: nil)
    view.show(entries)
    view.layoutIfNeeded()
    let sources = entries.filter { $0.kind == .source }.map(\.text)
    XCTAssertEqual(sources.count, 8)
    let pieces = pieces(view)
    for source in sources {
      XCTAssertTrue(pieces.contains { shows($0, source) }, "\(source) in \(pieces)")
    }
    XCTAssertTrue(pieces.contains("Not for navigation"), "\(pieces)")
    XCTAssertFalse(pieces.contains { $0.hasPrefix("A long obligation") })
    let lines = (view.label.text ?? "").components(separatedBy: "\n")
    XCTAssertGreaterThan(lines.count, 2)
    let font = try XCTUnwrap(view.label.font)
    for line in lines {
      XCTAssertLessThanOrEqual(
        (line as NSString).size(withAttributes: [.font: font]).width, view.label.bounds.width,
        line)
    }
    XCTAssertGreaterThanOrEqual(view.label.bounds.height, font.lineHeight * CGFloat(lines.count))

    // Use more lines before shortening individual credits.
    let many = (1...10).map {
      MapAttributionStrip.Item(text: "Credit number \($0)", keepsText: false)
    }
    let measure = { (text: String) in CGFloat(text.count * 6) }
    let narrow = MapAttributionStrip.lines(many, width: 162, measure: measure)
    XCTAssertTrue(narrow.allSatisfy { measure($0) <= 162 }, "\(narrow)")
    let narrowPieces = narrow.flatMap { $0.components(separatedBy: MapAttributionStrip.separator) }
    XCTAssertEqual(narrowPieces, many.map(\.text))
    let roomy = MapAttributionStrip.lines(Array(many.prefix(3)), width: 400, measure: measure)
    XCTAssertEqual(roomy, ["Credit number 1 · Credit number 2 · Credit number 3"])

    // A shortened credit never names a chart product without its qualification.
    let noaa = "NOAA ENC 2026-10-20 — not official, not for navigation"
    for cap in stride(from: CGFloat(0), through: measure(noaa), by: 6) {
      let short = MapAttributionStrip.shorten(noaa, to: cap, measure: measure)
      XCTAssertTrue(noaa.hasPrefix(String(short.dropLast(short == noaa ? 0 : 1))), short)
      if short.contains("ENC") { XCTAssertTrue(short.contains("not official"), short) }
    }
    XCTAssertEqual(MapAttributionStrip.shorten(noaa, to: 120, measure: measure), "NOAA…")
    XCTAssertEqual(
      MapAttributionStrip.shorten(noaa, to: 240, measure: measure),
      "NOAA ENC 2026-10-20 — not official, not…")
    XCTAssertEqual(
      MapAttributionStrip.shorten("© OpenStreetMap contributors", to: 90, measure: measure),
      "© OpenStreetMa…")
  }

  /// NOAA's dated line, NGA's non-endorsement, GEBCO and EMODnet's licence and modification note
  /// are one tap away in the full list and read in full by VoiceOver, with the licence a link.
  func testTheFullListHoldsEveryMarineNotice() throws {
    let url = try XCTUnwrap(
      Bundle.module.url(
        forResource: "marine-credits", withExtension: "json", subdirectory: "Fixtures/Marine"))
    let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    let credits = (fixture["cases"]?.array ?? []).compactMap { $0["credit"] }
    let control = MapAttributionControl()
    control.view.frame = CGRect(x: 0, y: 0, width: 390, height: 844)
    control.setStyle([:], attributions: [credits[0]["text"]?.string ?? ""])
    control.setDownloaded(
      obligations: OfflineObligation.obligations(credits), credits: OfflineCredit.credits(credits))
    control.update(in: TileflowBounds(west: -250, south: -85, east: 250, north: 85))
    let view = control.view
    view.control.sendActions(for: .primaryActionTriggered)
    view.layoutIfNeeded()
    XCTAssertFalse(view.list.isHidden)
    let list = view.list.text ?? ""
    let spoken = view.control.accessibilityLabel ?? ""
    for text in [
      "NOAA ENC 2026-10-20: NOAA ENC® data, Office of Coast Survey, National Oceanic and Atmospheric Administration. Tileflow Nautical is not an official or certified NOAA ENC",
      "This reproduction, partial or complete, of any National Geospatial-Intelligence Agency (NGA)",
      "GEBCO Grid, GEBCO Bathymetric Compilation Group: public domain under the GEBCO terms of use.",
      "EMODnet Digital Bathymetry (DTM 2024), EMODnet Bathymetry Consortium: created by EMODnet, owned by the EU and licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); modified. Not for navigation.",
    ] {
      XCTAssertTrue(list.contains(text), text)
      XCTAssertTrue(spoken.contains(text), text)
    }
    let licence = URL(string: "https://creativecommons.org/licenses/by/4.0/")!
    let range = (list as NSString).range(of: licence.absoluteString)
    XCTAssertEqual(
      view.list.attributedText.attribute(.link, at: range.location, effectiveRange: nil) as? URL,
      licence)
    XCTAssertTrue(
      view.control.accessibilityCustomActions?.contains { $0.name == "Open \(licence.absoluteString)" }
        == true)
    XCTAssertEqual(
      view.list.attributedText.attribute(.link, at: range.location - 3, effectiveRange: nil) as? URL,
      URL(string: "https://emodnet.ec.europa.eu/en/bathymetry"))
  }

  /// No public option hides the control or its button: the controls carry only its corner, and
  /// every corner, direction and inset keeps it on the map; the map view leaves its touches to it
  /// whatever the application filters.
  func testNoOptionHidesTheControl() throws {
    let controls = Mirror(reflecting: TileflowMapControls()).children.compactMap(\.label)
    XCTAssertEqual(controls.filter { $0.lowercased().contains("attribution") }, ["attributionPosition"])
    let options = Mirror(reflecting: TileflowMapOptions()).children.compactMap(\.label)
    XCTAssertEqual(
      options.filter { ["attribution", "logo", "credit", "notice"].contains(where: $0.lowercased().contains) },
      [])
    let size = CGRect(x: 0, y: 0, width: 390, height: 844)
    for position in TileflowControlPosition.allCases {
      for rightToLeft in [false, true] {
        for insets in [
          UIEdgeInsets.zero, UIEdgeInsets(top: 0, left: 0, bottom: 844, right: 0),
          UIEdgeInsets(top: 10_000, left: 10_000, bottom: 10_000, right: 10_000),
          UIEdgeInsets(top: 400, left: 0, bottom: 430, right: 300),
        ] {
          let control = MapAttributionControl()
          control.view.frame = size
          control.setStyle([:], attributions: ["© Tileflow © OpenStreetMap"])
          let options = TileflowMapOptions(controls: .init(compass: .hidden, attributionPosition: position))
          control.place(
            corner: try options.wireValue(rightToLeft: rightToLeft)["attribution"]?.string,
            insets: TileflowMapView.wire(insets))
          control.view.layoutIfNeeded()
          let frame = control.view.control.frame
          let name = "\(position) \(rightToLeft) \(insets)"
          XCTAssertFalse(control.view.control.isHidden, name)
          XCTAssertGreaterThan(frame.width, 40, name)
          XCTAssertGreaterThan(frame.height, 0, name)
          XCTAssertTrue(size.contains(frame), name)
        }
      }
    }

    let map = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: URL(string: "https://example.com/manifest.json")!))
    map.frame = size
    let attribution = MapAttributionView(frame: size)
    attribution.show(MapAttribution(sources: ["© Tileflow"]).entries(in: nil))
    map.addSubview(attribution)
    attribution.layoutIfNeeded()
    map.shouldReceiveTouch = { _ in false }
    let hit = map.hitTest(attribution.control.center, with: nil)
    XCTAssertTrue(hit === attribution.control || hit?.isDescendant(of: attribution.control) == true)
    XCTAssertNil(map.hitTest(CGPoint(x: 20, y: 20), with: nil), "The application's filter applies elsewhere")
    map.destroy()
  }
}
