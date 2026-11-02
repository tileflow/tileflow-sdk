package dev.tileflow.reactnative.bridge

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowGeometry
import dev.tileflow.sdk.offline.TileflowOfflineContent
import dev.tileflow.sdk.offline.TileflowOfflineException
import dev.tileflow.sdk.offline.TileflowOfflineGeometry
import dev.tileflow.sdk.offline.TileflowOfflineNetworkRestriction
import dev.tileflow.sdk.offline.TileflowOfflineRegion
import dev.tileflow.sdk.offline.TileflowOfflineRegionEstimate
import dev.tileflow.sdk.offline.TileflowOfflineRegionEvent
import dev.tileflow.sdk.offline.TileflowOfflineRegionLoadOptions
import dev.tileflow.sdk.offline.TileflowOfflineTileSource
import org.json.JSONArray
import org.json.JSONObject

/** Converts offline store arguments and answers between JavaScript objects and the SDK's types. */
object OfflineBridge {
    // MARK: Options

    fun options(value: Any?): TileflowOfflineRegionLoadOptions {
        val options = BridgeObject(value, "options")
        return TileflowOfflineRegionLoadOptions(
            geometry = geometry(options.obj("geometry")),
            content = content(options.obj("content")),
            minZoom = options.optionalInt("minZoom") ?: 0,
            maxZoom = options.optionalInt("maxZoom") ?: 15,
            terrainMaxZoom = options.optionalInt("terrainMaxZoom") ?: 12,
            networkRestriction =
                options.choice<TileflowOfflineNetworkRestriction>("networkRestriction")
                    ?: TileflowOfflineNetworkRestriction.NONE,
            metadata = options.optionalStringMap("metadata") ?: emptyMap(),
        )
    }

    fun geometry(geometry: BridgeObject): TileflowOfflineGeometry =
        when (geometry.string("type")) {
            "boundingBox" ->
                TileflowOfflineGeometry.BoundingBox(
                    TileflowBoundingBox(
                        geometry.double("west"),
                        geometry.double("south"),
                        geometry.double("east"),
                        geometry.double("north"),
                    )
                )
            "corridor" -> TileflowOfflineGeometry.Corridor(geometry.positions("line"), geometry.double("width"))
            // Any other type is a GeoJSON geometry, which the SDK reads and validates.
            else -> TileflowOfflineGeometry.fromGeoJson(json(geometry.values).toString())
        }

    fun content(content: BridgeObject): TileflowOfflineContent =
        when (content.string("type")) {
            "hosted" -> TileflowOfflineContent.Hosted(content.string("mapId"), content.strings("themes"))
            "manifest" ->
                TileflowOfflineContent.Manifest(
                    content.string("url"),
                    content.string("map"),
                    content.array("sources").mapIndexed { index, value ->
                        val source = BridgeObject(value, "${content.path}.sources[$index]")
                        TileflowOfflineTileSource(
                            source.string("id"),
                            source.string("template"),
                            source.optionalInt("minZoom") ?: 0,
                            source.int("maxZoom"),
                        )
                    },
                )
            else -> throw BridgeArgumentException("${content.path}.type", "hosted or manifest")
        }

    fun encode(options: TileflowOfflineRegionLoadOptions): Map<String, Any?> {
        val geometry: Map<String, Any?> =
            when (val value = options.geometry) {
                is TileflowOfflineGeometry.BoundingBox ->
                    mapOf(
                        "type" to "boundingBox",
                        "west" to value.box.west,
                        "south" to value.box.south,
                        "east" to value.box.east,
                        "north" to value.box.north,
                    )
                is TileflowOfflineGeometry.Geometry -> encode(value.geometry)
                is TileflowOfflineGeometry.GeometryCollection ->
                    mapOf("type" to "GeometryCollection", "geometries" to value.geometries.map(::encode))
                is TileflowOfflineGeometry.Corridor ->
                    mapOf("type" to "corridor", "line" to value.line.bridgePositions(), "width" to value.width)
            }
        val content: Map<String, Any?> =
            when (val value = options.content) {
                is TileflowOfflineContent.Hosted ->
                    mapOf("type" to "hosted", "mapId" to value.mapId, "themes" to value.themes)
                is TileflowOfflineContent.Manifest ->
                    mapOf(
                        "type" to "manifest",
                        "url" to value.url,
                        "map" to value.map,
                        "sources" to
                            value.sources.map {
                                mapOf(
                                    "id" to it.id,
                                    "template" to it.template,
                                    "minZoom" to it.minZoom,
                                    "maxZoom" to it.maxZoom,
                                )
                            },
                    )
            }
        return mapOf(
            "geometry" to geometry,
            "content" to content,
            "minZoom" to options.minZoom,
            "maxZoom" to options.maxZoom,
            "terrainMaxZoom" to options.terrainMaxZoom,
            "networkRestriction" to BridgeObject.caseName(options.networkRestriction.name),
            "metadata" to options.metadata,
        )
    }

    fun encode(geometry: TileflowGeometry): Map<String, Any?> {
        fun position(coordinate: TileflowCoordinate) = listOf(coordinate.longitude, coordinate.latitude)
        return when (geometry) {
            is TileflowGeometry.Point -> mapOf("type" to "Point", "coordinates" to position(geometry.coordinate))
            is TileflowGeometry.MultiPoint ->
                mapOf("type" to "MultiPoint", "coordinates" to geometry.coordinates.map(::position))
            is TileflowGeometry.LineString ->
                mapOf("type" to "LineString", "coordinates" to geometry.coordinates.map(::position))
            is TileflowGeometry.MultiLineString ->
                mapOf("type" to "MultiLineString", "coordinates" to geometry.lines.map { it.map(::position) })
            is TileflowGeometry.Polygon ->
                mapOf("type" to "Polygon", "coordinates" to geometry.rings.map { it.map(::position) })
            is TileflowGeometry.MultiPolygon ->
                mapOf(
                    "type" to "MultiPolygon",
                    "coordinates" to geometry.polygons.map { polygon -> polygon.map { it.map(::position) } },
                )
        }
    }

    // MARK: Answers

    fun encode(region: TileflowOfflineRegion): Map<String, Any?> =
        bridgeObject {
            put("id", region.id)
            put("options", encode(region.options))
            put("state", BridgeObject.caseName(region.state.name))
            put("isAvailable", region.isAvailable)
            put("requiredPackCount", region.requiredPackCount)
            put("completedPackCount", region.completedPackCount)
            put("requiredResourceCount", region.requiredResourceCount)
            put("completedResourceCount", region.completedResourceCount)
            put("requiredResourceBytes", region.requiredResourceBytes)
            put("completedResourceBytes", region.completedResourceBytes)
            put("loadedResourceCount", region.loadedResourceCount)
            put("loadedResourceBytes", region.loadedResourceBytes)
            put("billableResourceCount", region.billableResourceCount)
            put("error", region.error?.let(::info))
            put("retryDate", region.retryAtMillis)
            put("completedAt", region.completedAtMillis)
            put("checkedAt", region.checkedAtMillis)
            put("expiresAt", region.expiresAtMillis)
            put(
                "updateState",
                when (val state = region.updateState) {
                    TileflowOfflineRegion.UpdateState.Current -> mapOf("type" to "current")
                    TileflowOfflineRegion.UpdateState.UpdateAvailable -> mapOf("type" to "updateAvailable")
                    is TileflowOfflineRegion.UpdateState.NotUpdatable ->
                        mapOf("type" to "notUpdatable", "reason" to state.reason)
                    null -> null
                },
            )
            put(
                "expiryState",
                when (val state = region.expiryState) {
                    TileflowOfflineRegion.ExpiryState.Valid -> mapOf("type" to "valid")
                    is TileflowOfflineRegion.ExpiryState.GracePeriod ->
                        mapOf("type" to "gracePeriod", "endsAt" to state.endsAtMillis)
                    TileflowOfflineRegion.ExpiryState.Expired -> mapOf("type" to "expired")
                    null -> null
                },
            )
        }

    fun encode(estimate: TileflowOfflineRegionEstimate): Map<String, Any?> =
        bridgeObject {
            put("packCount", estimate.packCount)
            put("resourceCount", estimate.resourceCount)
            put("billableResourceCount", estimate.billableResourceCount)
            put("publicResourceCount", estimate.publicResourceCount)
            put("bytes", estimate.bytes)
            put("tileCounts", estimate.tileCounts)
            put("mapViews", estimate.mapViews)
        }

    fun encode(event: TileflowOfflineRegionEvent): Map<String, Any?> =
        when (event) {
            is TileflowOfflineRegionEvent.Changed -> mapOf("type" to "changed", "region" to encode(event.region))
            is TileflowOfflineRegionEvent.Removed -> mapOf("type" to "removed", "id" to event.id)
        }

    // MARK: Errors

    fun info(error: TileflowOfflineException): Map<String, Any?> =
        bridgeObject {
            put("code", BridgeObject.caseName(error.code.name))
            put("recoverable", error.isRecoverable)
            put("reason", error.context.reason)
            put("status", error.context.status)
            put("limit", error.context.limit)
            put("retryAfter", error.retryAfterMillis)
        }

    fun failure(error: Throwable): BridgeFailure =
        when (error) {
            is BridgeArgumentException ->
                BridgeFailure(
                    "invalidOptions",
                    error.message ?: "Invalid options",
                    mapOf("code" to "invalidOptions", "recoverable" to false, "reason" to error.message),
                )
            is TileflowOfflineException -> {
                val info = info(error)
                BridgeFailure(info["code"] as String, error.message ?: "Tileflow offline error", info)
            }
            else ->
                BridgeFailure(
                    "unavailable",
                    "Tileflow offline store failed",
                    mapOf("code" to "unavailable", "recoverable" to true),
                )
        }

    /** A JavaScript value as org.json, for the SDK's GeoJSON reader. */
    private fun json(value: Any?): Any =
        when (value) {
            null -> JSONObject.NULL
            is Map<*, *> -> JSONObject().also { result -> value.forEach { (key, item) -> result.put(key.toString(), json(item)) } }
            is List<*> -> JSONArray().also { result -> value.forEach { result.put(json(it)) } }
            else -> value
        }
}
