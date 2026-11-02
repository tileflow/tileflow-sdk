import Foundation
import XCTest

@testable import Tileflow

/// What a map credits in a view: its sources' attribution and each regional credit while one of
/// its boxes is in view.
final class MapAttributionTests: XCTestCase {
  private let spain = MapAttributionCredit(
    id: "es-ign", text: "© IGN España", href: "https://www.ign.es",
    regions: [[-9.4, 35.9, 4.4, 43.8], [-18.2, 27.6, -13.4, 29.5]])
  private let fiji = MapAttributionCredit(
    id: "fj", text: "Fiji", href: "https://example.com/fiji", regions: [[177, -19.2, 180, -16]])

  private func visible(_ credits: [MapAttributionCredit], _ view: TileflowBounds) -> [String] {
    credits.filter { $0.isVisible(in: view) }.map(\.id)
  }

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

  func testEntriesShowSourcesOnceThenVisibleCreditsWithTheirExactText() {
    let attribution = MapAttribution(
      sources: ["© Tileflow © OpenStreetMap", "© Tileflow © OpenStreetMap", "", "© IGN España"],
      credits: [spain, fiji])
    let madrid = TileflowBounds(west: -3.8, south: 40.3, east: -3.6, north: 40.5)
    // A credit a source already shows is not repeated.
    XCTAssertEqual(
      attribution.entries(in: madrid).map(\.text), ["© Tileflow © OpenStreetMap", "© IGN España"])
    let suva = TileflowBounds(west: 178.3, south: -18.2, east: 178.5, north: -18.0)
    XCTAssertEqual(
      attribution.entries(in: suva),
      [
        MapAttributionEntry(text: "© Tileflow © OpenStreetMap", href: nil),
        MapAttributionEntry(text: "© IGN España", href: nil),
        MapAttributionEntry(text: "Fiji", href: "https://example.com/fiji"),
      ])
  }

  func testCreditsArriveInTheFormTheMapViewSends() {
    let wire: JSONValue = .object([
      "id": .string("emodnet"), "text": .string("EMODnet"),
      "href": .string("https://emodnet.ec.europa.eu/en/bathymetry"),
      "regions": .array([.array([-36, 15, 43, 90].map(JSONValue.number))]),
    ])
    XCTAssertEqual(MapAttributionCredit(wire: wire)?.regions, [[-36, 15, 43, 90]])
    guard case .object(var insecure) = wire else { return XCTFail() }
    insecure["href"] = .string("http://emodnet.ec.europa.eu")
    XCTAssertNil(MapAttributionCredit(wire: .object(insecure)), "Links open only https")
  }

  /// The platform's marine fixture: each release's regional credits for Miami, Oslo and Madrid,
  /// with only the boxes that touch the download. Each is visible over its place and not across
  /// the world from it; the obligations are not regional and never come through here.
  func testTheMarineCreditsShowOverTheirPlacesOnly() throws {
    let url = try XCTUnwrap(
      Bundle.module.url(
        forResource: "marine-credits", withExtension: "json", subdirectory: "Fixtures/Marine"))
    let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    let cases = try XCTUnwrap(fixture["cases"]?.array)
    XCTAssertEqual(cases.count, 12)
    var seen: Set<String> = []
    for item in cases {
      let place = try XCTUnwrap(item["place"]?.string)
      let bounds = try XCTUnwrap(item["bounds"]?.array?.compactMap(\.number))
      let view = TileflowBounds(
        west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3])
      let antipode = TileflowBounds(
        west: bounds[0] + 180, south: -bounds[3], east: bounds[2] + 180, north: -bounds[1])
      let obligations = item["credit"]?["regionalObligations"]?.array ?? []
      let credits = obligations.map { obligation -> MapAttributionCredit? in
        // The manifest names the text `exact`; the map view passes it as `text`.
        guard case .object(var value) = obligation else { return nil }
        value["text"] = value["exact"]
        return MapAttributionCredit(wire: .object(value))
      }
      XCTAssertFalse(credits.contains(nil), "\(place): \(obligations)")
      let sourceText = try XCTUnwrap(item["attribution"]?.string)
      let attribution = MapAttribution(sources: [sourceText], credits: credits.compactMap { $0 })
      let shown = attribution.entries(in: view)
      for credit in credits.compactMap({ $0 }) {
        seen.insert(credit.id)
        XCTAssertTrue(credit.isVisible(in: view), "\(place) \(credit.id)")
        XCTAssertFalse(credit.isVisible(in: antipode), "\(place) \(credit.id) far away")
        XCTAssertTrue(
          shown.contains(MapAttributionEntry(text: credit.text, href: credit.href)),
          "\(place) \(credit.id)")
      }
      XCTAssertEqual(
        attribution.entries(in: antipode).map(\.text), [sourceText],
        "\(place): only the source attribution far away")
      if place == "madrid" {
        XCTAssertEqual(credits.compactMap { $0?.id }.filter { $0 != "emodnet" }, [])
      }
    }
    XCTAssertEqual(seen, ["noaa-enc", "usace-ienc", "emodnet", "kartverket"])
  }
}
