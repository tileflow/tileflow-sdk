package dev.tileflow.sdk

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.ImageView
import kotlin.math.cos
import kotlin.math.sin

/** A separate focus stop leaves the controls, attribution and annotations accessible. */
@SuppressLint("ViewConstructor")
internal class MapAccessibilitySummary(private val map: TileflowMapView) : View(map.context) {
    private enum class Action(val id: Int, val label: Int) {
        ZOOM_IN(R.id.tileflow_zoom_in, R.string.tileflow_zoom_in),
        ZOOM_OUT(R.id.tileflow_zoom_out, R.string.tileflow_zoom_out),
        NORTH(R.id.tileflow_pan_north, R.string.tileflow_pan_north),
        SOUTH(R.id.tileflow_pan_south, R.string.tileflow_pan_south),
        EAST(R.id.tileflow_pan_east, R.string.tileflow_pan_east),
        WEST(R.id.tileflow_pan_west, R.string.tileflow_pan_west),
    }

    init {
        isFocusable = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    override fun getAccessibilityClassName(): CharSequence = ImageView::class.java.name

    override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
        super.onInitializeAccessibilityNodeInfo(info)
        val label = map.contentDescription ?: resources.getString(R.string.tileflow_interactive_map)
        val name = map.source?.map
        val camera = map.currentCamera
        val details =
            when {
                name == null -> null
                camera == null -> name
                else ->
                    resources.getString(
                        R.string.tileflow_map_camera,
                        name,
                        camera.latitude,
                        camera.longitude,
                        camera.zoom,
                    )
            }
        info.contentDescription = listOfNotNull(label, details).joinToString(", ")
        for (action in Action.entries) info.addAction(
            AccessibilityNodeInfo.AccessibilityAction(action.id, resources.getString(action.label))
        )
    }

    override fun performAccessibilityAction(action: Int, arguments: Bundle?): Boolean {
        val command =
            Action.entries.find { it.id == action }
                ?: return super.performAccessibilityAction(action, arguments)
        val camera = map.currentCamera ?: return false
        if (map.readyEngine == null) return false
        map.launchOnView {
            try {
                val target =
                    when (command) {
                        Action.ZOOM_IN,
                        Action.ZOOM_OUT -> {
                            val limits = map.options.cameraLimits
                            val change = if (command == Action.ZOOM_IN) 1 else -1
                            TileflowCameraUpdate(
                                zoom =
                                    (camera.zoom + change).coerceIn(limits.minZoom, limits.maxZoom)
                            )
                        }
                        else -> TileflowCameraUpdate(center = pan(camera, command))
                    }
                map.move(target, TileflowCameraAnimation.Ease(200), "gesture")
            } catch (error: TileflowMapException) {
                if (error.code !in setOf(TileflowErrorCode.CANCELLED, TileflowErrorCode.DISPOSED))
                    map.onEvent(TileflowMapEvent.Failed(error.code, error.context))
            }
        }
        return true
    }

    private suspend fun pan(camera: TileflowCamera, command: Action): TileflowCoordinate {
        val center = map.project(TileflowCoordinate(camera.longitude, camera.latitude))
        val step = minOf(map.width, map.height) / 3.0
        val bearing = Math.toRadians(camera.bearing)
        val east =
            when (command) {
                Action.EAST -> 1
                Action.WEST -> -1
                else -> 0
            }
        val north =
            when (command) {
                Action.NORTH -> 1
                Action.SOUTH -> -1
                else -> 0
            }
        val next =
            map.unproject(
                TileflowPoint(
                    (center.x + step * (east * cos(bearing) - north * sin(bearing))).toFloat(),
                    (center.y - step * (east * sin(bearing) + north * cos(bearing))).toFloat(),
                )
            )
        return if (east == 0) TileflowCoordinate(camera.longitude, next.latitude)
        else TileflowCoordinate(next.longitude, camera.latitude)
    }
}
