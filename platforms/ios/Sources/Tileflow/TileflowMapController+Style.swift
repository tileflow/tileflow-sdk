import CoreGraphics
import Foundation

extension TileflowMapController {
  /// See ``TileflowMapView/addSource(_:)``.
  public func addSource(_ source: any TileflowSource) async throws {
    try await attached().addSource(source)
  }

  /// See ``TileflowMapView/removeSource(_:)``.
  public func removeSource(_ id: String) async throws { try await attached().removeSource(id) }

  /// See ``TileflowMapView/sourceExists(_:)``.
  public func sourceExists(_ id: String) -> Bool { (try? attached())?.sourceExists(id) ?? false }

  /// See ``TileflowMapView/setGeoJSONSourceData(_:data:)``.
  public func setGeoJSONSourceData(_ sourceId: String, data: TileflowGeoJSONData) async throws {
    try await attached().setGeoJSONSourceData(sourceId, data: data)
  }

  /// See ``TileflowMapView/addGeoJSONSourceFeatures(sourceId:features:)``.
  public func addGeoJSONSourceFeatures(sourceId: String, features: [TileflowFeature])
    async throws
  {
    try await attached().addGeoJSONSourceFeatures(sourceId: sourceId, features: features)
  }

  /// See ``TileflowMapView/updateGeoJSONSourceFeatures(sourceId:features:)``.
  public func updateGeoJSONSourceFeatures(sourceId: String, features: [TileflowFeature])
    async throws
  {
    try await attached().updateGeoJSONSourceFeatures(sourceId: sourceId, features: features)
  }

  /// See ``TileflowMapView/removeGeoJSONSourceFeatures(sourceId:featureIds:)``.
  public func removeGeoJSONSourceFeatures(sourceId: String, featureIds: [String]) async throws {
    try await attached().removeGeoJSONSourceFeatures(sourceId: sourceId, featureIds: featureIds)
  }

  /// See ``TileflowMapView/addLayer(_:position:)``.
  public func addLayer(_ layer: any TileflowLayer, position: TileflowLayerPosition = .default)
    async throws
  {
    try await attached().addLayer(layer, position: position)
  }

  /// See ``TileflowMapView/updateLayer(_:)``.
  public func updateLayer(_ layer: any TileflowLayer) async throws {
    try await attached().updateLayer(layer)
  }

  /// See ``TileflowMapView/moveLayer(_:position:)``.
  public func moveLayer(_ id: String, position: TileflowLayerPosition) async throws {
    try await attached().moveLayer(id, position: position)
  }

  /// See ``TileflowMapView/removeLayer(_:)``.
  public func removeLayer(_ id: String) async throws { try await attached().removeLayer(id) }

  /// See ``TileflowMapView/layerExists(_:)``.
  public func layerExists(_ id: String) -> Bool { (try? attached())?.layerExists(id) ?? false }

  /// See ``TileflowMapView/setFeatureState(sourceId:sourceLayer:featureId:state:)``.
  public func setFeatureState(
    sourceId: String, sourceLayer: String? = nil, featureId: String,
    state: [String: TileflowStyleValue]
  ) async throws {
    try await attached().setFeatureState(
      sourceId: sourceId, sourceLayer: sourceLayer, featureId: featureId, state: state)
  }

  /// See ``TileflowMapView/featureState(sourceId:sourceLayer:featureId:)``.
  public func featureState(sourceId: String, sourceLayer: String? = nil, featureId: String)
    async throws -> [String: TileflowStyleValue]
  {
    try await attached().featureState(
      sourceId: sourceId, sourceLayer: sourceLayer, featureId: featureId)
  }

  /// See ``TileflowMapView/removeFeatureState(sourceId:sourceLayer:featureId:key:)``.
  public func removeFeatureState(
    sourceId: String, sourceLayer: String? = nil, featureId: String? = nil, key: String? = nil
  ) async throws {
    try await attached().removeFeatureState(
      sourceId: sourceId, sourceLayer: sourceLayer, featureId: featureId, key: key)
  }

  /// See ``TileflowMapView/queryRenderedFeatures(in:options:)``.
  public func queryRenderedFeatures(
    in geometry: TileflowQueryGeometry = .view,
    options: TileflowRenderedQueryOptions = .init()
  ) async throws -> [TileflowQueriedFeature] {
    try await attached().queryRenderedFeatures(in: geometry, options: options)
  }

  /// See ``TileflowMapView/querySourceFeatures(sourceId:options:)``.
  public func querySourceFeatures(
    sourceId: String, options: TileflowSourceQueryOptions = .init()
  ) async throws -> [TileflowQueriedFeature] {
    try await attached().querySourceFeatures(sourceId: sourceId, options: options)
  }

  /// See ``TileflowMapView/clusterChildren(sourceId:clusterId:)``.
  public func clusterChildren(sourceId: String, clusterId: Int) async throws
    -> [TileflowQueriedFeature]
  {
    try await attached().clusterChildren(sourceId: sourceId, clusterId: clusterId)
  }

  /// See ``TileflowMapView/clusterLeaves(sourceId:clusterId:limit:offset:)``.
  public func clusterLeaves(sourceId: String, clusterId: Int, limit: Int = 10, offset: Int = 0)
    async throws -> [TileflowQueriedFeature]
  {
    try await attached().clusterLeaves(
      sourceId: sourceId, clusterId: clusterId, limit: limit, offset: offset)
  }

  /// See ``TileflowMapView/clusterExpansionZoom(sourceId:clusterId:)``.
  public func clusterExpansionZoom(sourceId: String, clusterId: Int) async throws -> Double {
    try await attached().clusterExpansionZoom(sourceId: sourceId, clusterId: clusterId)
  }

  /// See ``TileflowMapView/addImage(_:)``.
  public func addImage(_ image: TileflowMapImage) async throws {
    try await attached().addImage(image)
  }

  /// See ``TileflowMapView/removeImage(_:)``.
  public func removeImage(_ name: String) async throws { try await attached().removeImage(name) }
}
