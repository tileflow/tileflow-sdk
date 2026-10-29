package dev.tileflow.sdk

import org.json.JSONObject

/**
 * Decode before calling application code. Invalid renderer messages cannot escape as JSON errors.
 * Points arrive in CSS pixels and leave in physical pixels at [density].
 */
internal fun parseMapEvent(
    event: String,
    result: JSONObject,
    density: Float = 1f,
): TileflowMapEvent? {
    fun coordinate(): TileflowCoordinate {
        val point = result.getJSONObject("coordinate")
        val longitude = point.getDouble("longitude")
        val latitude = point.getDouble("latitude")
        require(longitude in -180.0..180.0 && latitude in -90.0..90.0)
        return TileflowCoordinate(longitude, latitude)
    }
    fun optionalString(key: String): String? =
        if (result.isNull(key)) null else result.getString(key)
    fun point(): TileflowPoint {
        val point = result.getJSONObject("point")
        val x = point.getDouble("x") * density
        val y = point.getDouble("y") * density
        require(x.isFinite() && y.isFinite())
        return TileflowPoint(x.toFloat(), y.toFloat())
    }
    return when (event) {
        "annotationActivated" ->
            TileflowMapEvent.AnnotationActivated(result.getString("id"), coordinate())
        "poiActivated" ->
            TileflowMapEvent.PoiActivated(
                TileflowPoiSelection(
                    optionalString("id"),
                    coordinate(),
                    optionalString("name"),
                    result.getString("category"),
                )
            )
        "loading" -> TileflowMapEvent.Loading
        "contentReady" -> TileflowMapEvent.ContentReady
        "cameraMoveStarted",
        "cameraMoved",
        "cameraMoveEnded" -> {
            val camera = TileflowCamera.from(result.getJSONObject("camera"))
            require(camera.isValid())
            val reason =
                requireNotNull(TileflowCameraChangeReason.fromWire(result.getString("reason")))
            val phase =
                when (event) {
                    "cameraMoveStarted" -> TileflowCameraChangePhase.STARTED
                    "cameraMoved" -> TileflowCameraChangePhase.MOVING
                    else -> TileflowCameraChangePhase.ENDED
                }
            TileflowMapEvent.CameraChanged(TileflowCameraChange(camera, reason, phase))
        }
        "tap" -> TileflowMapEvent.Tap(coordinate(), point())
        "longPress" -> TileflowMapEvent.LongPress(coordinate(), point())
        "gestureStarted" ->
            TileflowMapEvent.GestureStarted(
                requireNotNull(TileflowGesture.fromWire(result.getString("gesture")))
            )
        "gestureEnded" ->
            TileflowMapEvent.GestureEnded(
                requireNotNull(TileflowGesture.fromWire(result.getString("gesture")))
            )
        "themeChanged" -> optionalString("theme")?.let(TileflowMapEvent::ThemeChanged)
        "themeTransition" ->
            TileflowMapEvent.ThemeTransition(TileflowThemeTransition.from(result))
        "warning" -> {
            val error = TileflowMapException.fromWire(result)
            val count = result.getInt("count")
            require(count > 0)
            TileflowMapEvent.Warning(error.code, error.context, count)
        }
        "error" ->
            TileflowMapException.fromWire(result).let {
                TileflowMapEvent.Failed(it.code, it.context)
            }
        else -> null
    }
}
