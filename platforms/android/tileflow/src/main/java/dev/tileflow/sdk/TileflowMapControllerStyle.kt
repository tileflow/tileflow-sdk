package dev.tileflow.sdk

import androidx.compose.ui.unit.DpOffset

/** See [TileflowMapView.addSource]. */
public suspend fun TileflowMapController.addSource(source: TileflowSource): Unit =
    attached().addSource(source)

/** See [TileflowMapView.removeSource]. */
public suspend fun TileflowMapController.removeSource(id: String): Unit =
    attached().removeSource(id)

/** See [TileflowMapView.sourceExists]. */
public fun TileflowMapController.sourceExists(id: String): Boolean =
    runCatching { attached() }.getOrNull()?.sourceExists(id) ?: false

/** See [TileflowMapView.setGeoJSONSourceData]. */
public suspend fun TileflowMapController.setGeoJSONSourceData(
    sourceId: String,
    data: TileflowGeoJSONData,
): Unit = attached().setGeoJSONSourceData(sourceId, data)

/** See [TileflowMapView.addGeoJSONSourceFeatures]. */
public suspend fun TileflowMapController.addGeoJSONSourceFeatures(
    sourceId: String,
    features: List<TileflowFeature>,
): Unit = attached().addGeoJSONSourceFeatures(sourceId, features)

/** See [TileflowMapView.updateGeoJSONSourceFeatures]. */
public suspend fun TileflowMapController.updateGeoJSONSourceFeatures(
    sourceId: String,
    features: List<TileflowFeature>,
): Unit = attached().updateGeoJSONSourceFeatures(sourceId, features)

/** See [TileflowMapView.removeGeoJSONSourceFeatures]. */
public suspend fun TileflowMapController.removeGeoJSONSourceFeatures(
    sourceId: String,
    featureIds: List<String>,
): Unit = attached().removeGeoJSONSourceFeatures(sourceId, featureIds)

/** See [TileflowMapView.addLayer]. */
public suspend fun TileflowMapController.addLayer(
    layer: TileflowLayer,
    position: TileflowLayerPosition = TileflowLayerPosition.Default,
): Unit = attached().addLayer(layer, position)

/** See [TileflowMapView.updateLayer]. */
public suspend fun TileflowMapController.updateLayer(layer: TileflowLayer): Unit =
    attached().updateLayer(layer)

/** See [TileflowMapView.moveLayer]. */
public suspend fun TileflowMapController.moveLayer(id: String, position: TileflowLayerPosition): Unit =
    attached().moveLayer(id, position)

/** See [TileflowMapView.removeLayer]. */
public suspend fun TileflowMapController.removeLayer(id: String): Unit = attached().removeLayer(id)

/** See [TileflowMapView.layerExists]. */
public fun TileflowMapController.layerExists(id: String): Boolean =
    runCatching { attached() }.getOrNull()?.layerExists(id) ?: false

/** See [TileflowMapView.setFeatureState]. */
public suspend fun TileflowMapController.setFeatureState(
    sourceId: String,
    sourceLayer: String? = null,
    featureId: String,
    state: Map<String, TileflowStyleValue>,
): Unit = attached().setFeatureState(sourceId, sourceLayer, featureId, state)

/** See [TileflowMapView.featureState]. */
public fun TileflowMapController.featureState(
    sourceId: String,
    sourceLayer: String? = null,
    featureId: String,
): Map<String, TileflowStyleValue> = attached().featureState(sourceId, sourceLayer, featureId)

/** See [TileflowMapView.removeFeatureState]. */
public suspend fun TileflowMapController.removeFeatureState(
    sourceId: String,
    sourceLayer: String? = null,
    featureId: String? = null,
    key: String? = null,
): Unit = attached().removeFeatureState(sourceId, sourceLayer, featureId, key)

/**
 * Features the application's layers draw in part of the map, with [geometry]'s points in dp
 * relative to the map. See [TileflowMapView.queryRenderedFeatures].
 */
public suspend fun TileflowMapController.queryRenderedFeatures(
    geometry: TileflowQueryGeometry = TileflowQueryGeometry.View,
    options: TileflowRenderedQueryOptions = TileflowRenderedQueryOptions(),
): List<TileflowQueriedFeature> = attached().queryRendered(geometry, options, 1f)

/** Features drawn at a point in dp relative to the map. */
public suspend fun TileflowMapController.queryRenderedFeatures(
    point: DpOffset,
    options: TileflowRenderedQueryOptions = TileflowRenderedQueryOptions(),
): List<TileflowQueriedFeature> =
    queryRenderedFeatures(
        TileflowQueryGeometry.Point(TileflowPoint(point.x.value, point.y.value)),
        options,
    )

/** See [TileflowMapView.querySourceFeatures]. */
public suspend fun TileflowMapController.querySourceFeatures(
    sourceId: String,
    options: TileflowSourceQueryOptions = TileflowSourceQueryOptions(),
): List<TileflowQueriedFeature> = attached().querySourceFeatures(sourceId, options)

/** See [TileflowMapView.clusterChildren]. */
public suspend fun TileflowMapController.clusterChildren(
    sourceId: String,
    clusterId: Int,
): List<TileflowQueriedFeature> = attached().clusterChildren(sourceId, clusterId)

/** See [TileflowMapView.clusterLeaves]. */
public suspend fun TileflowMapController.clusterLeaves(
    sourceId: String,
    clusterId: Int,
    limit: Int = 10,
    offset: Int = 0,
): List<TileflowQueriedFeature> = attached().clusterLeaves(sourceId, clusterId, limit, offset)

/** See [TileflowMapView.clusterExpansionZoom]. */
public suspend fun TileflowMapController.clusterExpansionZoom(sourceId: String, clusterId: Int): Double =
    attached().clusterExpansionZoom(sourceId, clusterId)

/** See [TileflowMapView.addImage]. */
public suspend fun TileflowMapController.addImage(image: TileflowMapImage): Unit =
    attached().addImage(image)

/** See [TileflowMapView.removeImage]. */
public suspend fun TileflowMapController.removeImage(name: String): Unit =
    attached().removeImage(name)
