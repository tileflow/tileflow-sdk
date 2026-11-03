import Foundation
import UIKit
import XCTest

@testable import Tileflow

/// The attribution the SDK's own control shows over MapLibre Native, read from the control: its
/// corner outside the covered edge, the style's notice through a theme change, and the marine
/// credits of downloaded regions over Miami, Oslo and Madrid as the camera moves in and out of
/// their boxes, online and with the network switched off.
@MainActor
final class NativeAttributionIntegrationTests: XCTestCase {
  private static let nativeManifest = URL(string: "\(FixtureServer.origin)/native/manifest.json")!
  private static let manifest = URL(string: "\(FixtureServer.origin)/manifest.json")!

  private func requireFixture(_ url: URL) async throws {
    var request = URLRequest(url: url)
    request.timeoutInterval = 180
    do {
      let (_, response) = try await URLSession.shared.data(for: request)
      guard (response as? HTTPURLResponse)?.statusCode == 200 else {
        throw URLError(.badServerResponse)
      }
    } catch {
      throw XCTSkip("Start scripts/mobile-fixture-server.mjs to run native map integration.")
    }
  }

  private func attribution(_ view: TileflowMapView) throws -> MapAttributionControl {
    try XCTUnwrap((view.engine as? NativeMapEngine)?.attribution)
  }

  private func waitUntil(
    _ description: String, seconds: Double = 15, _ condition: () throws -> Bool
  ) async throws {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
      if try condition() { return }
      try await Task.sleep(nanoseconds: 50_000_000)
    }
    XCTFail("Timed out waiting for \(description).")
  }

  /// Content insets keep the attribution in the uncovered view, below the controls that share its
  /// corner, as on the web.
  func testContentInsetsKeepTheAttributionOutOfTheCoveredEdge() async throws {
    try await requireFixture(Self.nativeManifest)
    let view = TileflowMapView(
      source: TileflowMapSource(map: "city", manifestURL: Self.nativeManifest, allowsLoopbackHTTP: true),
      options: .init(controls: .init(scaleBar: true, recenterButton: true)))
    view.engineKind = .native
    view.automaticallyAdjustsContentInsets = false
    let events = NativeMapEvents()
    let window = MountedMap.sceneWindow()
    view.onEvent = events.receive
    view.frame = window.bounds
    window.rootViewController?.view.addSubview(view)
    defer {
      view.destroy()
      window.isHidden = true
    }
    try await events.waitForLoads(1)
    let control = try attribution(view)
    control.view.layoutIfNeeded()
    XCTAssertFalse(control.view.control.isHidden)
    XCTAssertTrue(control.entries.contains { $0.text == "Fixture City" }, "\(control.entries)")
    XCTAssertEqual(control.view.control.frame.maxY, 844 - 8, accuracy: 0.5)

    view.contentInsets = UIEdgeInsets(top: 0, left: 0, bottom: 300, right: 0)
    try await waitUntil("the attribution above the inset") {
      control.view.layoutIfNeeded()
      return abs(control.view.control.frame.maxY - (844 - 300 - 8)) < 0.5
    }
    let frame = control.view.convert(control.view.control.frame, to: view)
    XCTAssertEqual(frame.maxX, 390 - 8, accuracy: 0.5)
    XCTAssertEqual(frame.maxY, 844 - 300 - 8, accuracy: 0.5)
    // Native controls stay above the inset, and the one in the attribution's corner above it.
    let controls = try XCTUnwrap(view.subviews.compactMap { $0 as? MapControlsView }.first)
    controls.layoutIfNeeded()
    let visible = controls.subviews.filter { !$0.isHidden }
    XCTAssertEqual(visible.count, 2, "The scale bar and the recenter button.")
    XCTAssertTrue(visible.allSatisfy { $0.frame.maxY <= 844 - 300 }, "\(visible.map(\.frame))")
    XCTAssertLessThanOrEqual(controls.recenter.frame.maxY, frame.minY)
    XCTAssertTrue(events.failures.isEmpty, "\(events.failures)")
  }

  /// The style's notice is always on the map, and stays through a theme change.
  func testTheStyleNoticeStaysThroughAThemeChange() async throws {
    try await requireFixture(Self.manifest)
    for (map, theme) in [("fixture", "dark"), ("nautical", "night")] {
      let view = TileflowMapView(
        source: TileflowMapSource(map: map, manifestURL: Self.manifest, allowsLoopbackHTTP: true))
      view.engineKind = .native
      let events = NativeMapEvents()
      let window = MountedMap.sceneWindow()
      view.onEvent = events.receive
      view.frame = window.bounds
      window.rootViewController?.view.addSubview(view)
      defer {
        view.destroy()
        window.isHidden = true
      }
      try await events.waitForLoads(1)
      let notices = { try self.attribution(view).entries.filter { $0.kind == .notice }.map(\.text) }
      XCTAssertEqual(try notices(), ["Not for navigation"], map)
      XCTAssertTrue(try attribution(view).view.label.text?.hasSuffix("Not for navigation") == true)
      try await view.setTheme(theme, duration: 0.3)
      XCTAssertEqual(events.themes, [theme])
      XCTAssertEqual(try notices(), ["Not for navigation"], "\(map) after the theme change")
      XCTAssertFalse(try attribution(view).view.control.isHidden)
      XCTAssertTrue(events.failures.isEmpty, "\(map): \(events.failures)")
    }
  }

  // MARK: Marine credits

  func testMiamiShowsNOAAAndUSACEOnlyWhileTheirBoxesAreInView() async throws {
    try await checkMarineCredits(
      place: "miami", at: TileflowCoordinate(longitude: -80.2, latitude: 25.8),
      stops: [
        // Inside NOAA's box, east of USACE's.
        (TileflowCoordinate(longitude: -64.5, latitude: 23.6), ["nautical noaa-enc", "bathymetry noaa-enc"]),
        (TileflowCoordinate(longitude: 0, latitude: 0), []),
      ],
      here: ["nautical noaa-enc", "nautical usace-ienc", "bathymetry noaa-enc"])
  }

  func testOsloShowsEMODnetAndKartverketOnlyWhileTheirBoxesAreInView() async throws {
    try await checkMarineCredits(
      place: "oslo", at: TileflowCoordinate(longitude: 10.7, latitude: 59.9),
      stops: [
        // Inside EMODnet's domain, west of Norway's waters.
        (TileflowCoordinate(longitude: -5, latitude: 50), ["bathymetry emodnet"]),
        (TileflowCoordinate(longitude: 60, latitude: 10), []),
      ],
      here: ["bathymetry emodnet", "bathymetry kartverket"])
  }

  func testMadridShowsOnlyEMODnetWhileItsBoxIsInView() async throws {
    try await checkMarineCredits(
      place: "madrid", at: TileflowCoordinate(longitude: -3.7, latitude: 40.415),
      stops: [(TileflowCoordinate(longitude: 60, latitude: 10), [])],
      here: ["bathymetry emodnet"])
  }

  /// Downloads the fixture's marine theme over a place, then shows it online and with the network
  /// switched off. Both times the obligations, pages, sources' credits and the notice show
  /// wherever the camera goes, and the regional credits only while one of their boxes is in view.
  private func checkMarineCredits(
    place: String, at center: TileflowCoordinate,
    stops: [(TileflowCoordinate, Set<String>)], here: Set<String>
  ) async throws {
    let discovery = URL(
      string: "\(FixtureServer.origin)/maps/\(Self.hostedFixtureMapID)/mobile/manifest.json")!
    try await requireMapFixture(discovery)
    await TileflowMapCache.clear()
    let fixture = try MarineCredits()
    let bounds = try XCTUnwrap(fixture.bounds[place])
    let configuration = try fixtureConfiguration()
    let store = offlineMapStore(client: { try OfflinePackClient(configuration: configuration) })
    try await downloadRegion(
      store, id: "marine-\(place)",
      options: TileflowOfflineRegionLoadOptions(
        geometry: .boundingBox(
          TileflowBoundingBox(
            west: bounds[0], south: bounds[1], east: bounds[2], north: bounds[3])),
        content: .hosted(mapID: Self.hostedFixtureMapID, themes: ["marine"]), minZoom: 12,
        maxZoom: 13))

    for online in [true, false] {
      _ = try await fixtureCounters(reset: true)
      TileflowOfflineSwitch.shared.isNetworkEnabled = online
      defer { TileflowOfflineSwitch.shared.isNetworkEnabled = true }
      let mode = online ? "\(place) online" : "\(place) offline"
      let map = try await mountMap(
        .hosted(mapID: Self.hostedFixtureMapID, configuration: configuration), theme: "marine",
        camera: TileflowCamera(longitude: center.longitude, latitude: center.latitude, zoom: 10),
        engine: .native)
      defer { map.close() }
      let control = try attribution(map.view)
      // Online the map reads its native representation in a session; offline, the WebView
      // profile its regions hold, without one.
      let engine = try XCTUnwrap(map.view.engine as? NativeMapEngine)
      XCTAssertEqual(engine.manifest?.representation, online ? .native : .webView, mode)
      let sessions = try await fixtureCounters()["sessions"]
      XCTAssertEqual(sessions, online ? 1 : 0, mode)
      func check(_ expected: Set<String>, _ stop: String) async throws {
        try await waitUntil("\(mode) \(stop): \(expected)") {
          fixture.regional(control.entries) == expected
        }
        let entries = control.entries
        XCTAssertEqual(fixture.regional(entries), expected, "\(mode) \(stop)")
        // Always: the obligations and pages of the downloaded sources, the sources' credits with
        // their dated chart lines, and the style's notice, in that order.
        XCTAssertEqual(
          entries.filter { $0.kind == .obligation }.map(\.text), fixture.obligations,
          "\(mode) \(stop)")
        XCTAssertEqual(entries.filter { $0.kind == .page }.map(\.text), fixture.pages)
        let sources = entries.filter { $0.kind == .source }.map(\.text)
        for text in [
          "Fixture World", "© Tileflow", "© OpenStreetMap",
          "NOAA ENC 2026-10-20 — not official, not for navigation",
          "USACE IENC 2026-10-18 — not official, not for navigation",
        ] {
          XCTAssertTrue(sources.contains(text), "\(mode) \(stop): \(text) in \(sources)")
        }
        XCTAssertEqual(Set(sources).count, sources.count)
        XCTAssertEqual(entries.last?.text, "Not for navigation")
        let groups = entries.map(\.kind.order)
        XCTAssertTrue(zip(groups, groups.dropFirst()).allSatisfy { $0 <= $1 }, "\(entries)")
        XCTAssertFalse(control.view.control.isHidden)
        // On the map itself, every source credit at least starts, and the notice is whole.
        control.view.layoutIfNeeded()
        let strip = (control.view.label.text ?? "").components(separatedBy: "\n").flatMap {
          $0.components(separatedBy: MapAttributionStrip.separator)
        }
        for text in sources {
          XCTAssertTrue(
            strip.contains { $0 == text || ($0.hasSuffix("…") && text.hasPrefix(String($0.dropLast()))) },
            "\(mode) \(stop): \(text) on the map, \(strip)")
        }
        XCTAssertTrue(strip.contains("Not for navigation"), "\(strip)")
        // A chart product shows with its qualification or not at all.
        for piece in strip where piece.contains("ENC") {
          XCTAssertTrue(piece.contains("not official"), "\(mode) \(stop): \(piece)")
        }
        print("Attribution strip, \(mode) \(stop): \(strip)")
      }
      try await check(here, "at \(place)")
      for (coordinate, expected) in stops {
        try await map.view.jump(
          to: TileflowCamera(longitude: coordinate.longitude, latitude: coordinate.latitude, zoom: 10))
        try await check(expected, "at \(coordinate)")
      }
      try await map.view.jump(
        to: TileflowCamera(longitude: center.longitude, latitude: center.latitude, zoom: 10))
      try await check(here, "back at \(place)")
      if online {
        // A theme without the marine sources keeps the downloaded regions' obligations, and shows
        // a notice only if its style declares one.
        try await map.view.setTheme("day")
        try await waitUntil("\(mode) day") {
          !control.entries.contains { $0.text.hasPrefix("NOAA ENC 2026-10-20 —") }
        }
        XCTAssertEqual(control.entries.filter { $0.kind == .notice }, [])
        XCTAssertEqual(
          control.entries.filter { $0.kind == .obligation }.map(\.text), fixture.obligations)
      }
      XCTAssertTrue(map.failures.isEmpty, "\(mode): \(map.failures)")
    }
  }

  /// The platform's marine credits: each regional credit's text by source and identifier, and
  /// the obligations and pages a download of all three sources shows, in manifest order.
  private struct MarineCredits {
    var bounds: [String: [Double]] = [:]
    var regionalNames: [String: String] = [:]
    var obligations: [String] = []
    var pages: [String] = []

    init() throws {
      let url = try XCTUnwrap(
        Bundle.module.url(
          forResource: "marine-credits", withExtension: "json", subdirectory: "Fixtures/Marine"))
      let fixture = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
      var credits: [JSONValue] = []
      for item in fixture["cases"]?.array ?? [] {
        guard let place = item["place"]?.string, let credit = item["credit"],
          let source = item["source"]?.string
        else { continue }
        bounds[place] = item["bounds"]?.array?.compactMap(\.number)
        credits.append(credit)
        for regional in credit["regionalObligations"]?.array ?? [] {
          guard let text = regional["exact"]?.string, let id = regional["id"]?.string else {
            continue
          }
          regionalNames[text] = "\(source == "bathymetry-dem" ? "bathymetry" : source) \(id)"
        }
      }
      for obligation in OfflineObligation.obligations(credits) {
        if obligation.href == nil { obligations.append(obligation.text) } else {
          pages.append(obligation.text)
        }
      }
    }

    func regional(_ entries: [MapAttributionEntry]) -> Set<String> {
      Set(entries.filter { $0.kind == .regional }.compactMap { regionalNames[$0.text] })
    }
  }
}

extension MapAttributionEntry.Kind {
  /// The position of the kind's group in the attribution.
  fileprivate var order: Int {
    switch self {
    case .source: 0
    case .obligation, .page: 1
    case .regional: 2
    case .notice: 3
    case .fairUse: 4
    }
  }
}
