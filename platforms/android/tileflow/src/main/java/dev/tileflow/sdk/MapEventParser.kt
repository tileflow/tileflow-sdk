package dev.tileflow.sdk

import org.json.JSONObject

/**
 * Decode before calling application code. Invalid renderer messages cannot escape as JSON errors.
 */
internal fun parseMapEvent(event: String, result: JSONObject): TileflowMapEvent? {
    fun coordinate(): TileflowCoordinate {
        val point = result.getJSONObject("coordinate")
        val longitude = point.getDouble("longitude")
        val latitude = point.getDouble("latitude")
        require(longitude in -180.0..180.0 && latitude in -90.0..90.0)
        return TileflowCoordinate(longitude, latitude)
    }
    fun optionalString(key: String): String? =
        if (result.isNull(key)) null else result.getString(key)
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
            require(
                camera.longitude in -180.0..180.0 &&
                    camera.latitude in -90.0..90.0 &&
                    camera.zoom in 0.0..24.0 &&
                    camera.bearing in -360.0..360.0 &&
                    camera.pitch in 0.0..85.0
            )
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
        "tap" -> coordinate().let { TileflowMapEvent.Tap(it.longitude, it.latitude) }
        "themeChanged" -> optionalString("theme")?.let(TileflowMapEvent::ThemeChanged)
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
