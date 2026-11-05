import Foundation
import TileflowServices
import XCTest

@testable import Tileflow

final class ServiceContentTests: XCTestCase {
  let contract = ServiceContract.shared
  let session = ServiceStub.session()
  let madrid = TileflowPosition(longitude: -3.7038, latitude: 40.4168)

  // MARK: Map content

  func testRouteLayersKeepTheFullGeometryAndShareTheirData() async throws {
    ServiceStub.serve(json: contract.response("routing.route"))
    let answer = try await TileflowRouting(
      configuration: contract.configuration(), session: session
    )
    .route(
      TileflowRouteRequest(
        locations: [
          TileflowPosition(longitude: -80.2195, latitude: 25.7655),
          TileflowPosition(longitude: -80.1312, latitude: 25.7795),
        ], mode: .driving, alternatives: 1))
    // By default the map draws the layers in the route inks of the theme on screen.
    let light = try TileflowGeoJSONLayer.route(answer)
    XCTAssertEqual(
      light.map(\.id),
      ["route-alternatives", "route-glow", "route-casing", "route-line", "route-core"])
    XCTAssertEqual(light.map(\.ink), [.alternative, .glow, .casing, .line, .core])
    XCTAssertTrue(light.allSatisfy { $0.placement == .ground && $0.progress == nil })
    XCTAssertEqual(light.map(\.occludedOpacity), [0, 0, 0, 0.35, 0])
    // Every position reaches the map; the route's layers share one payload.
    func positions(_ layer: TileflowGeoJSONLayer) throws -> [Int] {
      let value = try JSONSerialization.jsonObject(with: layer.geoJSON) as? [String: Any]
      let features = value?["features"] as? [[String: Any]] ?? []
      return features.map {
        (($0["geometry"] as? [String: Any])?["coordinates"] as? [Any])?.count ?? 0
      }
    }
    XCTAssertEqual(try positions(light[3]), [answer.routes[0].geometry.count])
    XCTAssertEqual(try positions(light[0]), [answer.routes[1].geometry.count])
    XCTAssertEqual(Set(light.dropFirst().map(\.digest)).count, 1)
    // Fixed inks draw fixed colours; a theme's zero opacity keeps the layer, invisible.
    let fixed = try TileflowGeoJSONLayer.route(
      answer, selected: 1, inks: .light, progress: TileflowLineProgress(end: 0), idPrefix: "trip")
    XCTAssertEqual(
      fixed.map(\.id),
      ["trip-alternatives", "trip-glow", "trip-casing", "trip-line", "trip-core"])
    XCTAssertEqual(fixed.map(\.color), ["#94a3b8", "#2563eb", "#1e3a8a", "#2563eb", "#dbeafe"])
    XCTAssertEqual(fixed.map(\.opacity), [1, 0.16, 1, 1, 0])
    XCTAssertTrue(fixed.allSatisfy { $0.ink == nil })
    XCTAssertEqual(
      fixed.compactMap(\.progress?.highlight), Array(repeating: "#ffffff", count: 4),
      "every layer but the alternatives draws progress")
    XCTAssertEqual(
      TileflowGeoJSONLayer.routeProgressLayers(idPrefix: "trip"),
      Array(fixed.map(\.id).dropFirst()))
    XCTAssertThrowsError(try TileflowGeoJSONLayer.route(answer, selected: 2))
    XCTAssertTrue(
      GeoJSONText.lines([(2, answer.routes[0].geometry)]).hasPrefix(
        #"{"type":"FeatureCollection","features":[{"type":"Feature","id":2,"#))
    XCTAssertEqual(GeoJSONText.number(-80.2195004), "-80.2195")
    XCTAssertEqual(GeoJSONText.number(25), "25")
    XCTAssertEqual(GeoJSONText.number(-0.0000004), "0")
    XCTAssertEqual(GeoJSONText.number(0.000001), "0.000001")
  }

  func testIsochroneLayersDrawTheLongestTimeFirst() async throws {
    ServiceStub.serve(json: contract.response("routing.isochrone"))
    let answer = try await TileflowRouting(
      configuration: contract.configuration(), session: session
    )
    .isochrone(
      TileflowIsochroneRequest(
        location: TileflowPosition(longitude: -80.1312, latitude: 25.7795), mode: .walking,
        minutes: [5, 10]))
    let layers = try TileflowGeoJSONLayer.isochrones(answer)
    XCTAssertEqual(layers.map(\.id), ["isochrone-10", "isochrone-5"])
    XCTAssertTrue(layers.allSatisfy { $0.kind == .fill && $0.ink == .line })
    let fixed = try TileflowGeoJSONLayer.isochrones(answer, inks: .dark)
    XCTAssertTrue(fixed.allSatisfy { $0.color == "#60a5fa" && $0.ink == nil })
  }

  func testMapHelpers() throws {
    let camera = TileflowCamera(longitude: -3.7, latitude: 40.4, zoom: 12)
    XCTAssertEqual(camera.searchProximity, TileflowPosition(longitude: -3.7, latitude: 40.4))
    XCTAssertNil(TileflowCamera(longitude: -3.7, latitude: 40.4, zoom: 5).searchProximity)
    XCTAssertEqual(
      TileflowCamera(longitude: 190, latitude: 40.4, zoom: 12).searchProximity?.longitude ?? 0,
      -170, accuracy: 1e-9)

    let city = TileflowGeoIPLocation(city: "Madrid", position: madrid)
    XCTAssertEqual(TileflowCamera(approximateLocation: city)?.zoom, 10)
    XCTAssertEqual(
      TileflowCamera(
        approximateLocation: TileflowGeoIPLocation(countryCode: "ES", position: madrid))?.zoom, 4)
    XCTAssertNil(TileflowCamera(approximateLocation: TileflowGeoIPLocation(countryCode: "ES")))

    XCTAssertEqual(
      TileflowCoordinate(madrid), TileflowCoordinate(longitude: -3.7038, latitude: 40.4168))
    XCTAssertEqual(
      TileflowBounds(TileflowBoundingBox(west: 1, south: 2, east: 3, north: 4)),
      TileflowBounds(west: 1, south: 2, east: 3, north: 4))
  }

}
