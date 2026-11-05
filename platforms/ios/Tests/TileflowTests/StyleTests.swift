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

  private func positionFixtures() throws -> JSONValue {
    let url = try XCTUnwrap(Bundle.module.url(
      forResource: "style-position-fixtures", withExtension: "json", subdirectory: "Fixtures/Native"))
    return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
  }

  func testRelativePositionsRejectOtherSlotsWithoutChangingTheStyle() async throws {
    let fixture = try positionFixtures()
    for item in try XCTUnwrap(fixture["rejections"]?.array) {
      let view = TileflowMapView(source: .init(map: "fixture",
        manifestURL: URL(string: "https://maps.example/manifest.json")!))
      defer { view.destroy() }
      try await view.addSource(TileflowGeoJSONSource(id: "points", data: .empty))
      var reference = TileflowCircleLayer(id: item["reference"]?["id"]?.string ?? "", source: "points")
      reference.slot = item["reference"]?["slot"]?.string.flatMap(TileflowLayerSlot.init(rawValue:))
      try await view.addLayer(reference)
      var layer = TileflowCircleLayer(id: item["layer"]?["id"]?.string ?? "", source: "points")
      layer.slot = item["layer"]?["slot"]?.string.flatMap(TileflowLayerSlot.init(rawValue:))
      let operation = item["operation"]?.string ?? ""
      if operation == "moveLayer" { try await view.addLayer(layer) }
      let original = view.runtimeStyle.layers.map { ($0.id, $0.slot) }
      let position: TileflowLayerPosition = item["position"]?["aboveLayerId"] != nil
        ? .above(reference.id) : .below(reference.id)
      do {
        if operation == "moveLayer" { try await view.moveLayer(layer.id, position: position) }
        else { try await view.addLayer(layer, position: position) }
        XCTFail("Accepted cross-slot position: \(item["name"]?.string ?? "")")
      } catch let error as TileflowMapError {
        XCTAssertEqual(error.code.rawValue, item["error"]?["code"]?.string)
        XCTAssertEqual(error.context.reason, item["error"]?["reason"]?.string)
        XCTAssertEqual(error.context.path, item["error"]?["path"]?.string)
        XCTAssertEqual(error.context.operation, operation)
        XCTAssertEqual(error.context.layerId, layer.id)
        XCTAssertEqual(error.context.referenceLayerId, reference.id)
        XCTAssertEqual(error.context.slot, layer.slot?.rawValue)
        XCTAssertEqual(error.context.referenceSlot, reference.slot?.rawValue)
        XCTAssertEqual(error.context.rule, fixture["rule"]?.string)
        XCTAssertEqual(error.context.corrections.map(\.code), fixture["correctionCodes"]?.array?.compactMap(\.string))
        XCTAssertTrue(error.context.corrections.allSatisfy { !$0.message.isEmpty })
      }
      XCTAssertEqual(view.runtimeStyle.layers.map(\.id), original.map(\.0))
      XCTAssertEqual(view.runtimeStyle.layers.map(\.slot), original.map(\.1))
    }
  }

  func testPositionErrorsIdentifyTheInvalidFieldAndCorrection() async throws {
    let view = TileflowMapView(source: .init(map: "fixture",
      manifestURL: URL(string: "https://maps.example/manifest.json")!))
    defer { view.destroy() }
    try await view.addSource(TileflowGeoJSONSource(id: "points", data: .empty))
    try await view.addLayer(TileflowCircleLayer(id: "first", source: "points"))
    for (position, reason, path, rule, correction) in [
      (TileflowLayerPosition.above("missing"), "unknownLayer", "position.aboveLayerId", "knownReference", "referenceExistingLayer"),
      (.atSlotIndex(2), "invalidLayerPosition", "position.slotIndex", "indexRange", "chooseSlotIndex"),
    ] {
      do {
        try await view.addLayer(TileflowCircleLayer(id: "next", source: "points"), position: position)
        XCTFail("Invalid position was accepted")
      } catch let error as TileflowMapError {
        XCTAssertEqual(error.context.reason, reason)
        XCTAssertEqual(error.context.operation, "addLayer")
        XCTAssertEqual(error.context.path, path)
        XCTAssertEqual(error.context.layerId, "next")
        XCTAssertEqual(error.context.rule, rule)
        XCTAssertEqual(error.context.corrections.map(\.code), [correction])
        if path == "position.slotIndex" {
          XCTAssertEqual(error.context.limit, 1)
          XCTAssertEqual(error.context.count, 2)
        }
      }
      XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["first"])
    }
  }

  func testSlotIndexesMatchSharedCasesAndPreserveOtherSlots() async throws {
    let fixture = try positionFixtures()
    for item in try XCTUnwrap(fixture["slotIndices"]?.array) {
      let view = TileflowMapView(source: .init(map: "fixture",
        manifestURL: URL(string: "https://maps.example/manifest.json")!))
      defer { view.destroy() }
      try await view.addSource(TileflowGeoJSONSource(id: "points", data: .empty))
      func layer(_ value: JSONValue) throws -> TileflowCircleLayer {
        var layer = TileflowCircleLayer(id: try XCTUnwrap(value["id"]?.string), source: "points")
        layer.slot = value["slot"]?.string.flatMap(TileflowLayerSlot.init(rawValue:))
        return layer
      }
      for value in try XCTUnwrap(item["layers"]?.array) { try await view.addLayer(layer(value)) }
      let next = try layer(XCTUnwrap(item["layer"]))
      let otherSlots = view.runtimeStyle.layers.filter { $0.slot != next.slot && $0.id != next.id }.map(\.id)
      let position = TileflowLayerPosition.atSlotIndex(try XCTUnwrap(item["position"]?["slotIndex"]?.number.flatMap(Int.init(exactly:))))
      do {
        if item["operation"]?.string == "moveLayer" {
          try await view.moveLayer(next.id, position: position, slot: next.slot)
        } else { try await view.addLayer(next, position: position) }
        XCTAssertNil(item["error"], "Accepted invalid index")
      } catch let error as TileflowMapError {
        XCTAssertEqual(error.code.rawValue, item["error"]?["code"]?.string)
      }
      XCTAssertEqual(view.runtimeStyle.layers.filter { $0.slot == next.slot }.map(\.id),
        item["expectedOrder"]?.array?.compactMap(\.string))
      XCTAssertEqual(view.runtimeStyle.layers.filter { $0.slot != next.slot && $0.id != next.id }.map(\.id), otherSlots)
    }
  }

  func testClusteredSourcesRejectNonPointsAfterFilteringWithoutKeepingRejectedEdits() async throws {
    let view = TileflowMapView(source: .init(map: "fixture",
      manifestURL: URL(string: "https://maps.example/manifest.json")!))
    defer { view.destroy() }
    let point = TileflowFeature(id: "p", geometry: .point(.init(longitude: 1, latitude: 2)))
    let line = TileflowFeature(id: "l", geometry: .lineString([
      .init(longitude: 1, latitude: 2), .init(longitude: 2, latitude: 3),
    ]))
    func rejects(_ work: () async throws -> Void) async {
      do { try await work(); XCTFail("Clustered non-point data was accepted") }
      catch let error as TileflowMapError {
        XCTAssertEqual(error, .invalidRequest)
        XCTAssertEqual(error.context.reason, "invalidGeoJSON")
        XCTAssertFalse(error.context.message?.isEmpty ?? true)
      } catch { XCTFail("Unexpected error: \(error)") }
    }
    await rejects {
      try await view.addSource(TileflowGeoJSONSource(id: "invalid", data: .features([point, line]), cluster: true))
    }
    XCTAssertFalse(view.sourceExists("invalid"))
    try await view.addSource(TileflowGeoJSONSource(id: "points", data: .features([point]), cluster: true))
    let original = view.runtimeStyle.sources.first { $0.id == "points" }?.geoJSON?.base
    await rejects { try await view.setGeoJSONSourceData("points", data: .features([point, line])) }
    XCTAssertEqual(view.runtimeStyle.sources.first { $0.id == "points" }?.geoJSON?.base, original)
    try await view.setGeoJSONSourceData("points", data: .features([point]))
    await rejects {
      try await view.updateGeoJSONSourceFeatures(sourceId: "points", features: [line], removeFeatureIds: ["p"])
    }
    XCTAssertEqual(view.runtimeStyle.sources.first { $0.id == "points" }?.geoJSON?.updates.count, 0)

    try await view.addSource(TileflowGeoJSONSource(id: "mixed", data: .features([point, line])))
    await rejects { try await view.updateSource(id: "mixed", properties: ["cluster": true]) }
    XCTAssertNotEqual(view.runtimeStyle.sources.first { $0.id == "mixed" }?.spec["cluster"], .bool(true))
    try await view.updateSource(id: "mixed", properties: [
      "cluster": true, "filter": ["==", ["geometry-type"], "Point"],
    ])
    try await view.setGeoJSONSourceData("mixed", data: .features([point, line]))
    try await view.updateGeoJSONSourceFeatures(sourceId: "mixed", features: [line])
    await rejects { try await view.updateSource(id: "mixed", properties: ["filter": NSNull()]) }
    XCTAssertNotNil(view.runtimeStyle.sources.first { $0.id == "mixed" }?.spec["filter"])
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
      TileflowTextAnchorOffsets([
        .init(anchor: .top, offset: [0, 1]), .init(anchor: .left, offset: [1, 0]),
      ]))
    symbol.iconImage = "pin"
    symbol.iconColor = "#ffffff"
    let encoded = try JSONValue.encoded(symbol)
    XCTAssertEqual(
      text(encoded["layout"]?["text-variable-anchor-offset"] ?? .null),
      #"["top",[0,1],"left",[1,0]]"#)
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
      text(
        TileflowExpression.switchCase(.boolean(.featureState("selected"), false), "#f00", "#00f")
          .json),
      ##"["case",["boolean",["feature-state","selected"],false],"#f00","#00f"]"##)
    XCTAssertEqual(
      text(TileflowExpression.inExpression("a", .literal(["a", "b"])).json),
      #"["in","a",["literal",["a","b"]]]"#)
    XCTAssertEqual(text(TileflowExpression.literal([1, 2]).json), #"["literal",[1,2]]"#)
    XCTAssertEqual(
      text(TileflowExpression(TileflowColor(hex: "#11223380")!).json), #""rgba(17, 34, 51, 0.502)""#
    )
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
      id: "points",
      data: .features([TileflowFeature(id: "7", geometry: .point(.init(longitude: 1, latitude: 2)))]
      ),
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
    XCTAssertEqual(
      collection["features"].flatMap {
        if case .array(let items) = $0 { items.first?["id"] } else { nil }
      }?.number, 7)
    var vector = TileflowVectorSource(
      id: "roads", tiles: .templates(["https://tiles.example/{z}/{x}/{y}.pbf"]))
    vector.maxZoom = 14
    vector.promoteId = "osm_id"
    XCTAssertEqual(
      text(.object(try TileflowMapView.sourceWire(vector).0)),
      text(
        try json(
          #"{"type":"vector","tiles":["https://tiles.example/{z}/{x}/{y}.pbf"],"maxzoom":14,"promoteId":"osm_id"}"#
        )))
    let dem = TileflowRasterDEMSource(
      id: "dem", tiles: .tileJSON(URL(string: "https://dem.example/tiles.json")!),
      encoding: .terrarium)
    XCTAssertEqual(try TileflowMapView.sourceWire(dem).0["encoding"]?.string, "terrarium")
    let image = TileflowImageSource(
      id: "plan", url: URL(string: "https://img.example/plan.png")!, coordinates: [])
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
    let base = Data(
      #"{"type":"FeatureCollection","features":[{"type":"Feature","id":1,"properties":{},"geometry":null},{"type":"Feature","id":2,"properties":{},"geometry":null}]}"#
        .utf8)
    let updates = [
      GeoJSONLog.Update(
        add: Data(#"[{"type":"Feature","id":3,"properties":{},"geometry":null}]"#.utf8),
        remove: ["1"]),
      GeoJSONLog.Update(
        add: Data(#"[{"type":"Feature","id":2,"properties":{"v":2},"geometry":null}]"#.utf8),
        remove: []),
    ]
    let compacted = try XCTUnwrap(GeoJSONLog.compact(base: base, updates: updates, promoteId: nil))
    let value = try json(String(decoding: compacted, as: UTF8.self))
    guard case .array(let features) = value["features"] else { return XCTFail("Features") }
    XCTAssertEqual(features.compactMap { $0["id"]?.number }, [2, 3])
    XCTAssertEqual(features[0]["properties"]?["v"]?.number, 2)
    // Promoted identifiers key the features instead.
    let promoted = Data(
      #"{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"ref":"a"},"geometry":null}]}"#
        .utf8)
    XCTAssertNotNil(
      GeoJSONLog.compact(
        base: promoted, updates: [.init(add: nil, remove: ["a"])], promoteId: "ref"))
    XCTAssertNil(GeoJSONLog.compact(base: promoted, updates: [], promoteId: nil))
  }

  func testInvalidUpdateBeforeMountKeepsLastAcceptedLayer() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: URL(string: "https://maps.example/manifest.json")!))
    defer { view.destroy() }
    try await view.addSource(TileflowGeoJSONSource(id: "places", data: .empty))
    var layer = TileflowCircleLayer(id: "points", source: "places")
    layer.circleRadius = 6
    try await view.addLayer(layer)

    try await view.updateLayer(properties: [
      "id": "points", "type": "circle", "source": "places", "paint": ["circle-radius": 12],
    ])
    layer.circleRadius = -1
    do {
      try await view.updateLayer(layer)
      XCTFail("Invalid circle radius was kept for the next renderer")
    } catch let error as TileflowMapError {
      XCTAssertEqual(error, .invalidRequest)
    }
    XCTAssertEqual(view.runtimeStyle.layers.first?.json["paint"]?["circle-radius"]?.number, 12)
  }

  func testLayerIndexesStayWithinTheirSlotAndSurviveReload() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: URL(string: "https://maps.example/manifest.json")!))
    defer { view.destroy() }
    try await view.addSource(TileflowGeoJSONSource(id: "points", data: .empty))
    var a = TileflowCircleLayer(id: "a", source: "points")
    a.slot = .belowLabels
    var road = TileflowCircleLayer(id: "road", source: "points")
    road.slot = .aboveRoads
    var b = TileflowCircleLayer(id: "b", source: "points")
    b.slot = .belowLabels
    try await view.addLayer(a)
    try await view.addLayer(road)
    try await view.addLayer(b, position: .atSlotIndex(0))
    XCTAssertEqual(
      view.runtimeStyle.layers.filter { $0.slot == .belowLabels }.map(\.id), ["b", "a"])
    try await view.moveLayer("b", position: .atSlotIndex(1))
    XCTAssertEqual(
      view.runtimeStyle.layers.filter { $0.slot == .belowLabels }.map(\.id), ["a", "b"])
    do {
      try await view.moveLayer("b", position: .atSlotIndex(2))
      XCTFail("An index outside the slot was accepted")
    } catch let error as TileflowMapError { XCTAssertEqual(error, .invalidRequest) }
    try view.reload()
    XCTAssertEqual(
      view.runtimeStyle.layers.filter { $0.slot == .belowLabels }.map(\.id), ["a", "b"])
    XCTAssertEqual(view.runtimeStyle.layers.first { $0.id == "road" }?.slot, .aboveRoads)
  }

  func testGeoJSONUpdatesAddAndRemoveAtomically() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: URL(string: "https://maps.example/manifest.json")!))
    defer { view.destroy() }
    try await view.addSource(
      TileflowGeoJSONSource(
        id: "points",
        data: .features([
          TileflowFeature(id: "1", geometry: .point(.init(longitude: 1, latitude: 2)))
        ])))
    do {
      try await view.updateGeoJSONSourceFeatures(
        sourceId: "points", features: [TileflowFeature(geometry: nil)], removeFeatureIds: ["1"])
      XCTFail("The invalid replacement removed existing data")
    } catch let error as TileflowMapError { XCTAssertEqual(error, .invalidRequest) }
    XCTAssertEqual(view.runtimeStyle.sources.first?.geoJSON?.updates.count, 0)
    try await view.updateGeoJSONSourceFeatures(
      sourceId: "points",
      features: [
        TileflowFeature(id: "2", geometry: .point(.init(longitude: 3, latitude: 4)))
      ], removeFeatureIds: ["1"])
    let log = try XCTUnwrap(view.runtimeStyle.sources.first?.geoJSON)
    XCTAssertEqual(log.updates.count, 1)
    XCTAssertEqual(log.updates.first?.remove, ["1"])
    guard case .bytes(let base, _) = log.base else { return XCTFail("Missing base") }
    let compacted = try XCTUnwrap(
      GeoJSONLog.compact(base: base, updates: log.updates, promoteId: nil))
    let features = try json(String(decoding: compacted, as: UTF8.self))["features"]?.array
    XCTAssertEqual(features?.compactMap { $0["id"]?.number }, [2])
  }

  func testSourcePatchesPreserveFeatureEditsLayersAndStateAndRejectInvalidChanges() async throws {
    let view = TileflowMapView(source: .init(
      map: "fixture", manifestURL: URL(string: "https://maps.example/manifest.json")!))
    defer { view.destroy() }
    func feature(_ id: String, _ name: String) -> TileflowFeature {
      TileflowFeature(id: id, geometry: .point(.init(longitude: 1, latitude: 2)),
        properties: ["name": .string(name)])
    }
    try await view.addSource(TileflowGeoJSONSource(
      id: "points", data: .features([feature("a", "Original"), feature("b", "Removed")]),
      cluster: true, clusterRadius: 40))
    try await view.addLayer(TileflowCircleLayer(id: "circles", source: "points"))
    try await view.setFeatureState(sourceId: "points", featureId: "a", state: ["selected": true])
    try await view.updateGeoJSONSourceFeatures(
      sourceId: "points", features: [feature("a", "Updated"), feature("c", "Added")],
      removeFeatureIds: ["b"])
    try await view.updateSource(id: "points", properties: ["clusterRadius": 80])
    let updated = try XCTUnwrap(view.runtimeStyle.sources.first)
    XCTAssertEqual(updated.spec["clusterRadius"], .number(80))
    guard case .bytes(let bytes, _) = updated.geoJSON?.base else { return XCTFail("Missing data") }
    let features = try json(String(decoding: bytes, as: UTF8.self))["features"]?.array ?? []
    XCTAssertEqual(features.compactMap { $0["id"]?.string }, ["a", "c"])
    XCTAssertEqual(features.compactMap { $0["properties"]?["name"]?.string }, ["Updated", "Added"])
    XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["circles"])
    let state = try await view.featureState(sourceId: "points", featureId: "a")
    XCTAssertEqual(state, ["selected": true])

    do {
      try await view.updateSource(id: "points", properties: ["clusterRadius": -1])
      XCTFail("Invalid patch replaced the source")
    } catch let error as TileflowMapError { XCTAssertEqual(error, .invalidRequest) }
    XCTAssertEqual(view.runtimeStyle.sources.first?.spec, updated.spec)
    XCTAssertEqual(view.runtimeStyle.sources.first?.geoJSON?.base, updated.geoJSON?.base)
    try await view.updateSource(id: "points", properties: ["clusterRadius": NSNull()])
    XCTAssertNil(view.runtimeStyle.sources.first?.spec["clusterRadius"])
    try view.reload()
    XCTAssertEqual(view.runtimeStyle.sources.first?.geoJSON?.base, updated.geoJSON?.base)
  }

  func testTheViewKeepsLayersInOrderAndRefusesUnknownNames() async throws {
    let view = TileflowMapView(
      source: TileflowMapSource(
        map: "fixture", manifestURL: URL(string: "https://maps.example/manifest.json")!))
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
    var heat = TileflowHeatmapLayer(id: "heat", source: "points")
    heat.slot = .belowLabels
    try await view.addLayer(heat, position: .below("top"))
    var over = TileflowCircleLayer(id: "over", source: "points")
    over.slot = .belowLabels
    try await view.addLayer(over, position: .above("heat"))
    XCTAssertEqual(view.runtimeStyle.layers.map(\.id), ["heat", "over", "top"])
    // Relative positions keep the explicitly selected slot.
    XCTAssertEqual(
      view.runtimeStyle.layers.map(\.slot), [.belowLabels, .belowLabels, .belowLabels])
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
