import CoreGraphics
import Foundation
import XCTest

@testable import Tileflow

/// The typed runtime style: generated layers and expressions encode to MapLibre JSON, sources to
/// their wire form, and the view keeps what a new renderer needs.
@MainActor
final class StyleTests: XCTestCase {
  private func text(_ value: JSONValue) -> String { value.text }
  private func json(_ text: String) throws -> JSONValue {
    try JSONDecoder().decode(JSONValue.self, from: Data(text.utf8))
  }

  func testGeneratedLayersEncodeMapLibreJSON() throws {
    var layer = TileflowCircleLayer(id: "points", source: "places")
    layer.sourceLayer = "poi"
    layer.filter = .eq(.get("kind"), "cafe")
    layer.minZoom = 10
    layer.circleRadius = .expression(.interpolate(.linear(), .zoom(), 10, 2, 16, 8))
    layer.circleRadiusTransition = TileflowTransition(duration: 0.3)
    layer.circleColor = "#e9573f"
    layer.circleStrokeColor = .constant(TileflowColor(red: 0, green: 0, blue: 0, alpha: 0.5))
    layer.circlePitchAlignment = .constant(.map)
    layer.visibility = .constant(.visible)
    layer.slot = .belowLabels
    XCTAssertEqual(
      text(try JSONValue.encoded(layer)),
      text(
        try json(
          """
          {"id":"points","type":"circle","source":"places","source-layer":"poi",
           "filter":["==",["get","kind"],"cafe"],"minzoom":10,
           "layout":{"visibility":"visible"},
           "paint":{"circle-radius":["interpolate",["linear"],["zoom"],10,2,16,8],
            "circle-radius-transition":{"duration":300,"delay":0},
            "circle-color":"rgba(233, 87, 63, 1.0)",
            "circle-stroke-color":"rgba(0, 0, 0, 0.5)",
            "circle-pitch-alignment":"map"}}
          """)))
    // The slot is where the layer goes, not part of MapLibre's layer.
    XCTAssertNil(try JSONValue.encoded(layer)["slot"])
    var symbol = TileflowSymbolLayer(id: "labels", source: "places")
    symbol.textField = .expression(.get("name"))
    symbol.textFont = .constant(["Noto Sans Regular"])
    symbol.textVariableAnchorOffset = .constant(
      TileflowTextAnchorOffsets([.init(anchor: .top, offset: [0, 1]), .init(anchor: .left, offset: [1, 0])]))
    symbol.iconImage = "pin"
    symbol.iconColor = "#ffffff"
    let encoded = try JSONValue.encoded(symbol)
    XCTAssertEqual(text(encoded["layout"]?["text-variable-anchor-offset"] ?? .null), #"["top",[0,1],"left",[1,0]]"#)
    XCTAssertEqual(encoded["layout"]?["icon-image"]?.string, "pin")
    XCTAssertEqual(encoded["paint"]?["icon-color"]?.string, "rgba(255, 255, 255, 1.0)")
    let background = TileflowBackgroundLayer(id: "tint")
    XCTAssertNil(try JSONValue.encoded(background)["source"])
    XCTAssertEqual(TileflowHeatmapLayer.type, "heatmap")
    XCTAssertEqual(TileflowColorReliefLayer.type, "color-relief")
  }

  func testExpressionsUseMapLibreOperatorsAndLiterals() throws {
    XCTAssertEqual(text(TileflowExpression.sum(1, .get("count")).json), #"["+",1,["get","count"]]"#)
    XCTAssertEqual(text(TileflowExpression.not(.has("name")).json), #"["!",["has","name"]]"#)
    XCTAssertEqual(
      text(TileflowExpression.switchCase(.boolean(.featureState("selected"), false), "#f00", "#00f").json),
      ##"["case",["boolean",["feature-state","selected"],false],"#f00","#00f"]"##)
    XCTAssertEqual(
      text(TileflowExpression.inExpression("a", .literal(["a", "b"])).json),
      #"["in","a",["literal",["a","b"]]]"#)
    XCTAssertEqual(text(TileflowExpression.literal([1, 2]).json), #"["literal",[1,2]]"#)
    XCTAssertEqual(text(TileflowExpression(TileflowColor(hex: "#11223380")!).json), #""rgba(17, 34, 51, 0.502)""#)
    let parsed = try TileflowExpression(json: #"["step",["get","point_count"],20,100,30]"#)
    XCTAssertEqual(parsed, .step(.get("point_count"), 20, 100, 30))
    XCTAssertThrowsError(try TileflowExpression(json: "not json"))
  }

  func testColoursParseHexAndClampChannels() {
    XCTAssertNil(TileflowColor(hex: "red"))
    XCTAssertEqual(TileflowColor(hex: "#ff000080")?.alpha ?? 0, 128.0 / 255, accuracy: 0.001)
    XCTAssertEqual(TileflowColor(red: 300, green: -1, blue: 10).css, "rgba(255, 0, 10, 1.0)")
  }

  func testSourcesTravelInMapLibreForm() throws {
    var points = TileflowGeoJSONSource(
      id: "points", data: .features([TileflowFeature(id: "7", geometry: .point(.init(longitude: 1, latitude: 2)))]),
      cluster: true, clusterRadius: 40, clusterProperties: ["total": .sum(.get("count"))])
    points.generateId = true
    let (spec, log) = try TileflowMapView.sourceWire(points)
    XCTAssertEqual(
      text(.object(spec)),
      text(
        try json(
          #"{"type":"geojson","cluster":true,"clusterRadius":40,"clusterProperties":{"total":["+",["get","count"]]},"generateId":true}"#
        )))
    guard case .bytes(let data, _) = log?.base else { return XCTFail("Inline data") }
    let collection = try json(String(decoding: data, as: UTF8.self))
    // A whole-number identifier travels as a number, which feature state needs.
    XCTAssertEqual(collection["features"].flatMap { if case .array(let items) = $0 { items.first?["id"] } else { nil } }?.number, 7)
    var vector = TileflowVectorSource(id: "roads", tiles: .templates(["https://tiles.example/{z}/{x}/{y}.pbf"]))
    vector.maxZoom = 14
    vector.promoteId = "osm_id"
    XCTAssertEqual(
      text(.object(try TileflowMapView.sourceWire(vector).0)),
      text(try json(#"{"type":"vector","tiles":["https://tiles.example/{z}/{x}/{y}.pbf"],"maxzoom":14,"promoteId":"osm_id"}"#)))
    let dem = TileflowRasterDEMSource(id: "dem", tiles: .tileJSON(URL(string: "https://dem.example/tiles.json")!), encoding: .terrarium)
    XCTAssertEqual(try TileflowMapView.sourceWire(dem).0["encoding"]?.string, "terrarium")
    let image = TileflowImageSource(id: "plan", url: URL(string: "https://img.example/plan.png")!, coordinates: [])
    XCTAssertThrowsError(try TileflowMapView.sourceWire(image))
  }

  func testQueriedFeaturesDecodeTypedValues() throws {
    let feature = TileflowQueriedFeature(
      wire: try json(
        #"{"id":12,"source":"points","layer":"clusters","geometry":{"type":"Polygon","coordinates":[[[0,0],[1,0],[1,1],[0,0]]]},"properties":{"cluster_id":4,"name":"A","tags":["x"],"nested":{"a":null}},"state":{"selected":true}}"#
      ))
    XCTAssertEqual(feature.feature.id, "12")
    XCTAssertEqual(feature.feature.clusterId, 4)
    XCTAssertEqual(feature.source, "points")
    XCTAssertEqual(feature.layer, "clusters")
    XCTAssertNil(feature.sourceLayer)
    XCTAssertEqual(feature.feature.properties["tags"], .array(["x"]))
    XCTAssertEqual(feature.feature.properties["nested"], .object(["a": .null]))
    XCTAssertEqual(feature.state, ["selected": true])
    guard case .polygon(let rings) = feature.feature.geometry else { return XCTFail("Polygon") }
    XCTAssertEqual(rings[0][1], TileflowCoordinate(longitude: 1, latitude: 0))
    XCTAssertEqual(TileflowGeometry(feature.feature.geometry!.wireValue), feature.feature.geometry)
  }

  func testFeatureUpdatesCompactIntoData() throws {
    let base = Data(#"{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"properties":{},"geometry":null},{"type":"Feature","id":2,"properties":{},"geometry":null}]}"#.utf8)
    let updates = [
      GeoJSONLog.Update(add: Data(#"[{"type":"Feature","id":3,"properties":{},"geometry":null}]"#.utf8), remove: ["1"]),
      GeoJSONLog.Update(add: Data(#"[{"type":"Feature","id":2,"properties":{"v":2},"geometry":null}]"#.utf8), remove: []),
    ]
    let compacted = try XCTUnwrap(GeoJSONLog.compact(base: base, updates: updates, promoteId: nil))
    let value = try json(String(decoding: compacted, as: UTF8.self))
    guard case .array(let features) = value["features"] else { return XCTFail("Features") }
    XCTAssertEqual(features.compactMap { $0["id"]?.number }, [2, 3])
    XCTAssertEqual(features[0]["properties"]?["v"]?.number, 2)
    // Promoted identifiers key the features instead.
    let promoted = Data(#"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"ref":"a"},"geometry":null}]}"#.utf8)
    XCTAssertNotNil(GeoJSONLog.compact(base: promoted, updates: [.init(add: nil, remove: ["a"])], promoteId: "ref"))
    XCTAssertNil(GeoJSONLog.compact(base: promoted, updates: [], promoteId: nil))
  }

  func testTheViewKeepsLayersInOrderAndRefusesUnknownNames() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(map: "fixture", manifestURL: URL(string: "https://maps.example/manifest.json")!))
    defer { view.destroy() }
    try await view.addSource(TileflowGeoJSONSource(id: "points", data: .empty))
    do {
      try await view.addLayer(TileflowCircleLayer(id: "a", source: "missing"))
      XCTFail("A layer of an unknown source was kept.")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error.context.reason, "unknownSource")
    }
    var top = TileflowCircleLayer(id: "top", source: "points")
    top.slot = .belowLabels
    try await view.addLayer(top)
    try await view.addLayer(TileflowHeatmapLayer(id: "heat", source: "points"), position: .below("top"))
    try await view.addLayer(TileflowCircleLayer(id: "over", source: "points"), position: .above("heat"))
    XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["heat", "over", "top"])
    // A layer placed relative to another takes its slot.
    XCTAssertEqual(view.runtimeStyle.layers.map(\.slot), [.belowLabels, .belowLabels, .belowLabels])
    try await view.moveLayer("heat", position: .above("top"))
    XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["over", "top", "heat"])
    try await view.setFeatureState(sourceId: "points", featureId: "4", state: ["selected": true])
    try await view.setFeatureState(sourceId: "points", featureId: "4", state: ["hover": 1])
    let state = try await view.featureState(sourceId: "points", featureId: "4")
    XCTAssertEqual(state, ["selected": true, "hover": 1])
    try await view.removeFeatureState(sourceId: "points", featureId: "4", key: "hover")
    let removed = try await view.featureState(sourceId: "points", featureId: "4")
    XCTAssertEqual(removed, ["selected": true])
    do {
      try await view.removeSource("points")
      XCTFail("A source in use was removed.")
    } catch {}
    do {
      try await view.addGeoJSONSourceFeatures(
        sourceId: "points", features: [TileflowFeature(geometry: nil)])
      XCTFail("A feature without an identifier was accepted.")
    } catch {}
    try await view.addGeoJSONSourceFeatures(
      sourceId: "points", features: [TileflowFeature(id: "1", geometry: nil)])
    XCTAssertEqual(view.runtimeStyle.sources.first?.geoJSON?.updates.count, 1)
    for id in ["over", "top", "heat"] { try await view.removeLayer(id) }
    try await view.removeSource("points")
    XCTAssertFalse(view.sourceExists("points"))
  }
}
