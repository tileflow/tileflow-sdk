package dev.tileflow.reactnative.map

import dev.tileflow.sdk.TileflowCameraAnimation
import dev.tileflow.sdk.TileflowEasing
import dev.tileflow.sdk.TileflowEdgeInsets
import dev.tileflow.sdk.TileflowFlyOptions
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.TileflowMapView
import kotlin.math.roundToLong
import org.json.JSONObject

/** Camera commands keep the SDK's partial updates and independently cancellable movements. */
internal class MapCameraOperations(private val map: TileflowMapView) {
    private val density
        get() = map.resources.displayMetrics.density

    fun setSource(source: TileflowMapSource, initial: JSONObject?) {
        if (initial == null) {
            map.setSource(source)
            return
        }
        checkStop(initial)
        val bounds = MapValues.objectValue(initial, "bounds")?.let(MapValues::bounds)
        val padding = MapValues.padding(MapValues.objectValue(initial, "padding"), density)
        val update = MapValues.camera(initial)
        map.setSource(
            source,
            update,
            bounds,
            if (bounds == null) TileflowEdgeInsets.ZERO else padding,
        )
        if (bounds == null && initial.has("padding")) setPadding(padding)
    }

    suspend fun call(method: String, payload: JSONObject): Any {
        when (method) {
            "getCamera" -> {
                MapValues.only(payload)
                return MapValues.camera(map.camera())
            }
            "setCamera" -> {
                checkStop(payload)
                val animation = animation(payload)
                val padding = MapValues.padding(MapValues.objectValue(payload, "padding"), density)
                val bounds = MapValues.objectValue(payload, "bounds")?.let(MapValues::bounds)
                if (bounds != null) {
                    map.fit(
                        bounds,
                        padding,
                        MapValues.optionalNumber(payload, "heading"),
                        MapValues.optionalNumber(payload, "pitch"),
                        MapValues.optionalNumber(payload, "zoomLevel"),
                        animation,
                    )
                } else {
                    val update = MapValues.camera(payload)
                    if (payload.has("padding")) setPadding(padding)
                    map.move(update, animation)
                }
            }
            "stopCamera" -> {
                MapValues.only(payload)
                map.stopCamera()
            }
            "cameraForBounds" -> {
                MapValues.only(payload, "bounds", "padding", "heading", "pitch")
                val camera =
                    map.camera(
                        MapValues.bounds(payload.getJSONObject("bounds")),
                        MapValues.padding(MapValues.objectValue(payload, "padding"), density),
                        MapValues.optionalNumber(payload, "heading"),
                        MapValues.optionalNumber(payload, "pitch"),
                    )
                return camera?.let(MapValues::camera) ?: JSONObject.NULL
            }
            "getVisibleBounds" -> {
                MapValues.only(payload)
                return MapValues.bounds(map.visibleBounds())
            }
            "project" -> {
                MapValues.only(payload, "coordinate")
                return MapValues.point(
                    map.project(MapValues.coordinate(payload.getJSONArray("coordinate"))),
                    density,
                )
            }
            "unproject" -> {
                MapValues.only(payload, "point")
                return MapValues.coordinate(
                    map.unproject(MapValues.point(payload.getJSONArray("point"), density))
                )
            }
            else -> MapValues.invalid()
        }
        return JSONObject.NULL
    }

    private fun setPadding(padding: TileflowEdgeInsets) {
        map.setContentPadding(padding.left, padding.top, padding.right, padding.bottom)
    }

    internal companion object {
        fun checkStop(value: JSONObject) {
            MapValues.only(
                value,
                "centerCoordinate",
                "zoomLevel",
                "heading",
                "pitch",
                "bounds",
                "padding",
                "animationMode",
                "animationDuration",
            )
            if (
                MapValues.objectValue(value, "bounds") != null &&
                    MapValues.arrayValue(value, "centerCoordinate") != null
            )
                MapValues.invalid()
        }

        fun animation(value: JSONObject): TileflowCameraAnimation {
            val duration =
                MapValues.optionalNumber(value, "animationDuration")
                    ?.also {
                        if (it !in 0.0..TileflowCameraAnimation.MAXIMUM_DURATION_MILLIS.toDouble())
                            MapValues.invalid()
                    }
                    ?.roundToLong()
            return when (MapValues.optionalString(value, "animationMode") ?: "none") {
                "none",
                "moveTo" -> TileflowCameraAnimation.None
                "easeTo" -> TileflowCameraAnimation.Ease(duration ?: 500)
                "linearTo" -> TileflowCameraAnimation.Ease(duration ?: 500, TileflowEasing.LINEAR)
                "flyTo" ->
                    TileflowCameraAnimation.Fly(TileflowFlyOptions(durationMillis = duration))
                else -> MapValues.invalid()
            }
        }
    }
}
