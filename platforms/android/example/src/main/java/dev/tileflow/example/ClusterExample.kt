package dev.tileflow.example

import dev.tileflow.sdk.TileflowCameraUpdate
import dev.tileflow.sdk.TileflowCircleLayer
import dev.tileflow.sdk.TileflowColor
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowExpression
import dev.tileflow.sdk.TileflowExpression.Companion.get
import dev.tileflow.sdk.TileflowExpression.Companion.literal
import dev.tileflow.sdk.TileflowGeoJSONData
import dev.tileflow.sdk.TileflowGeoJSONSource
import dev.tileflow.sdk.TileflowGeometry
import dev.tileflow.sdk.TileflowJSON
import dev.tileflow.sdk.TileflowLayer
import dev.tileflow.sdk.TileflowLayerSlot
import dev.tileflow.sdk.TileflowMapController
import dev.tileflow.sdk.TileflowMapView
import dev.tileflow.sdk.TileflowPoint
import dev.tileflow.sdk.TileflowQueriedFeature
import dev.tileflow.sdk.TileflowQueryGeometry
import dev.tileflow.sdk.TileflowRenderedQueryOptions
import dev.tileflow.sdk.TileflowSource
import dev.tileflow.sdk.TileflowStyleValue
import dev.tileflow.sdk.addLayer
import dev.tileflow.sdk.addSource
import dev.tileflow.sdk.clusterExpansionZoom
import dev.tileflow.sdk.queryRenderedFeatures
import dev.tileflow.sdk.setFeatureState
import dev.tileflow.sdk.sourceExists

/** The calls the clustered points example makes, which a map view and a controller both offer. */
internal interface ClusterMap {
    fun sourceExists(id: String): Boolean

    suspend fun addSource(source: TileflowSource)

    suspend fun addLayer(layer: TileflowLayer)

    /** [point] is in the unit of the map's queries: pixels for a view, dp for a controller. */
    suspend fun query(point: TileflowPoint, layers: List<String>): List<TileflowQueriedFeature>

    suspend fun expansionZoom(source: String, cluster: Int): Double

    suspend fun select(source: String, id: String)

    suspend fun ease(update: TileflowCameraUpdate)
}

internal class ViewClusterMap(private val map: TileflowMapView) : ClusterMap {
    override fun sourceExists(id: String) = map.sourceExists(id)

    override suspend fun addSource(source: TileflowSource) = map.addSource(source)

    override suspend fun addLayer(layer: TileflowLayer) = map.addLayer(layer)

    override suspend fun query(point: TileflowPoint, layers: List<String>) =
        map.queryRenderedFeatures(TileflowQueryGeometry.Point(point), TileflowRenderedQueryOptions(layers))

    override suspend fun expansionZoom(source: String, cluster: Int) =
        map.clusterExpansionZoom(source, cluster)

    override suspend fun select(source: String, id: String) =
        map.setFeatureState(source, featureId = id, state = mapOf("selected" to TileflowStyleValue.Bool(true)))

    override suspend fun ease(update: TileflowCameraUpdate) {
        map.ease(update, 500)
    }
}

internal class ControllerClusterMap(private val map: TileflowMapController) : ClusterMap {
    override fun sourceExists(id: String) = map.sourceExists(id)

    override suspend fun addSource(source: TileflowSource) = map.addSource(source)

    override suspend fun addLayer(layer: TileflowLayer) = map.addLayer(layer)

    override suspend fun query(point: TileflowPoint, layers: List<String>) =
        map.queryRenderedFeatures(TileflowQueryGeometry.Point(point), TileflowRenderedQueryOptions(layers))

    override suspend fun expansionZoom(source: String, cluster: Int) =
        map.clusterExpansionZoom(source, cluster)

    override suspend fun select(source: String, id: String) =
        map.setFeatureState(source, featureId = id, state = mapOf("selected" to TileflowStyleValue.Bool(true)))

    override suspend fun ease(update: TileflowCameraUpdate) {
        map.ease(update, 500)
    }
}

internal object ClusterExample {
    const val SOURCE = "places"

    /**
     * 100 000 points around [center], sent once over the SDK's data channel and clustered by the
     * renderer. Each point carries a `rank` that clusters add up.
     */
    fun points(center: TileflowCoordinate, count: Int = 100_000): String {
        val side = Math.ceil(Math.sqrt(count.toDouble())).toInt()
        val text = StringBuilder(count * 120).append("""{"type":"FeatureCollection","features":[""")
        for (index in 0 until count) {
            if (index > 0) text.append(',')
            val longitude = center.longitude - 0.2 + 0.4 * (index % side) / side
            val latitude = center.latitude - 0.15 + 0.3 * (index / side) / side
            text.append(
                """{"type":"Feature","id":$index,"properties":{"rank":${index % 10}},"geometry":{"type":"Point","coordinates":[$longitude,$latitude]}}"""
            )
        }
        return text.append("]}").toString()
    }

    /**
     * Adds the points with a layer for clusters, sized and coloured by how many points they hold,
     * and one for single points, which turn red once selected.
     */
    suspend fun show(map: ClusterMap, center: TileflowCoordinate) {
        if (map.sourceExists(SOURCE)) return
        map.addSource(
            TileflowGeoJSONSource(
                SOURCE,
                TileflowGeoJSONData.GeoJSON(points(center)),
                cluster = true,
                clusterRadius = 50.0,
                clusterProperties = mapOf("rankSum" to TileflowExpression.sum(get("rank"))),
            )
        )
        val count = get("point_count")
        map.addLayer(
            TileflowCircleLayer("clusters", SOURCE)
                .filter(TileflowExpression.has("point_count"))
                .circleColor(
                    TileflowExpression.step(
                        count,
                        literal("#51bbd6"),
                        literal(100.0),
                        literal("#f1f075"),
                        literal(750.0),
                        literal("#f28cb1"),
                    )
                )
                .circleRadius(
                    TileflowExpression.step(
                        count,
                        literal(16.0),
                        literal(100.0),
                        literal(22.0),
                        literal(750.0),
                        literal(30.0),
                    )
                )
                .circleStrokeWidth(2.0)
                .circleStrokeColor(TileflowColor(255, 255, 255))
        )
        map.addLayer(
            TileflowCircleLayer("points", SOURCE)
                .filter(TileflowExpression.not(TileflowExpression.has("point_count")))
                .circleRadius(6.0)
                .circleColor(
                    TileflowExpression.switchCase(
                        TileflowExpression.boolean(
                            TileflowExpression.featureState("selected"),
                            literal(false),
                        ),
                        literal("#e63946"),
                        literal("#11b4da"),
                    )
                )
                // Single points lie under the map's labels; clusters stay above everything.
                .slot(TileflowLayerSlot.BELOW_LABELS)
        )
    }

    /** A tap on a cluster zooms to where it splits; a tap on a point selects it. */
    suspend fun tap(map: ClusterMap, point: TileflowPoint): String? {
        val hit = map.query(point, listOf("clusters", "points")).firstOrNull() ?: return null
        val cluster = hit.feature.clusterId
        val center = (hit.feature.geometry as? TileflowGeometry.Point)?.coordinate
        if (cluster != null && center != null) {
            val zoom = map.expansionZoom(SOURCE, cluster)
            map.ease(TileflowCameraUpdate(center = center, zoom = zoom))
            val points = (hit.feature.properties["point_count"] as? TileflowJSON.Number)?.value
            return "Cluster of ${points?.toInt()} places"
        }
        val id = hit.feature.id ?: return null
        map.select(SOURCE, id)
        return "Place $id selected"
    }
}
