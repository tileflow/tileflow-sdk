import CoreGraphics
import Foundation
import Tileflow

/// The calls the clustered points example makes, which a UIKit map view and a SwiftUI map
/// controller both offer.
@MainActor
protocol ClusterMap {
  func addSource(_ source: any TileflowSource) async throws
  func addLayer(_ layer: any TileflowLayer, position: TileflowLayerPosition) async throws
  func sourceExists(_ id: String) -> Bool
  func queryRenderedFeatures(
    in geometry: TileflowQueryGeometry, options: TileflowRenderedQueryOptions
  ) async throws -> [TileflowQueriedFeature]
  func clusterExpansionZoom(sourceId: String, clusterId: Int) async throws -> Double
  func setFeatureState(
    sourceId: String, sourceLayer: String?, featureId: String, state: [String: TileflowStyleValue]
  ) async throws
  func ease(to update: TileflowCameraUpdate, duration: TimeInterval, easing: TileflowEasing)
    async throws -> TileflowCameraAnimationResult
}

extension TileflowMapView: ClusterMap {}
extension TileflowMapController: ClusterMap {}

@MainActor
enum ClusterExample {
  static let source = "places"

  /// 100,000 points around `center`, sent once over the SDK's data channel and clustered by the
  /// renderer. Each point carries a `rank` that clusters add up.
  static func points(around center: TileflowCoordinate, count: Int = 100_000) -> Data {
    var text = #"{"type":"FeatureCollection","features":["#
    text.reserveCapacity(count * 120)
    let side = Int(Double(count).squareRoot().rounded(.up))
    for index in 0..<count {
      if index > 0 { text += "," }
      let longitude = center.longitude - 0.2 + 0.4 * Double(index % side) / Double(side)
      let latitude = center.latitude - 0.15 + 0.3 * Double(index / side) / Double(side)
      text +=
        #"{"type":"Feature","id":\#(index),"properties":{"rank":\#(index % 10)},"geometry":{"type":"Point","coordinates":[\#(longitude),\#(latitude)]}}"#
    }
    return Data((text + "]}").utf8)
  }

  /// Adds the points with a layer for clusters, sized and coloured by how many points they hold,
  /// and one for single points, which turn red once selected.
  static func show(on map: some ClusterMap, around center: TileflowCoordinate) async throws {
    guard !map.sourceExists(source) else { return }
    try await map.addSource(
      TileflowGeoJSONSource(
        id: source, data: .geoJSON(points(around: center)), cluster: true, clusterRadius: 50,
        clusterProperties: ["rankSum": .sum(.get("rank"))]))
    var clusters = TileflowCircleLayer(id: "clusters", source: source)
    clusters.filter = .has("point_count")
    clusters.circleColor = .expression(
      .step(.get("point_count"), "#51bbd6", 100, "#f1f075", 750, "#f28cb1"))
    clusters.circleRadius = .expression(.step(.get("point_count"), 16, 100, 22, 750, 30))
    clusters.circleStrokeWidth = 2
    clusters.circleStrokeColor = "#ffffff"
    try await map.addLayer(clusters, position: .default)
    var points = TileflowCircleLayer(id: "points", source: source)
    points.filter = .not(.has("point_count"))
    points.circleRadius = 6
    points.circleColor = .expression(
      .switchCase(.boolean(.featureState("selected"), false), "#e63946", "#11b4da"))
    // Single points lie under the map's labels; clusters stay above everything.
    points.slot = .belowLabels
    try await map.addLayer(points, position: .default)
  }

  /// A tap on a cluster zooms to where it splits; a tap on a point selects it. Returns a status.
  static func tap(at point: CGPoint, on map: some ClusterMap) async throws -> String? {
    let hits = try await map.queryRenderedFeatures(
      in: .point(point), options: .init(layerIds: ["clusters", "points"]))
    guard let hit = hits.first else { return nil }
    if let cluster = hit.feature.clusterID, case .point(let center) = hit.feature.geometry {
      let zoom = try await map.clusterExpansionZoom(sourceId: source, clusterId: cluster)
      _ = try await map.ease(
        to: TileflowCameraUpdate(center: center, zoom: zoom), duration: 0.5, easing: .standard)
      let count = Int(hit.feature.properties["point_count"]?.number ?? 0)
      return "Cluster of \(count) places"
    }
    guard let id = hit.feature.id else { return nil }
    try await map.setFeatureState(
      sourceId: source, sourceLayer: nil, featureId: id, state: ["selected": true])
    return "Place \(id) selected"
  }
}
