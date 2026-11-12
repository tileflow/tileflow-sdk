package dev.tileflow.reactnative.map

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.view.View
import dev.tileflow.sdk.*
import dev.tileflow.sdk.location.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject

internal class NativeMapSession(
    override val map: TileflowMapView,
    private val loadImage: suspend (String) -> ByteArray,
    private val requestPermission: suspend () -> JSONObject,
    private val emit: (String, JSONObject) -> Unit,
) : MountedMapEndpoint {
    override val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val camera = MapCameraOperations(map)
    private val gestures = mutableSetOf<TileflowGesture>()
    private val animations = mutableSetOf<Job>()
    private val relay = LocationRelay(TileflowDefaultLocationProvider(map.context)) { location ->
        if (locationInput?.let { MapValues.boolean(it, "emitsUpdates", false) } == true)
            emit("locationUpdated", MapValues.location(location))
    }
    private var locationInput: JSONObject? = null
    private var initialized = false
    private var disposed = false
    private var insetJson: String? = null
    private var basePadding = TileflowEdgeInsets.ZERO
    private var points: TileflowPointAnnotationManager? = null
    private val pointIds = mutableMapOf<String, String>()
    private val defaultPointImage by lazy {
        Bitmap.createBitmap(16, 16, Bitmap.Config.ARGB_8888).also { bitmap ->
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(233, 87, 63) }
            canvas.drawCircle(8f, 8f, 6f, paint)
            paint.color = Color.WHITE
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 2f
            canvas.drawCircle(8f, 8f, 6f, paint)
        }
    }

    init {
        map.locationProvider = relay
        map.onEvent = ::receive
    }

    override suspend fun applyProperties(sourceJson: String, appearanceJson: String, optionsJson: String) {
        checkActive()
        val input = JSONObject(optionsJson)
        val appearance = JSONObject(appearanceJson)
        val source = MapValues.source(JSONObject(sourceJson), MapValues.optionalString(input, "surfaceId"))
        val mode = when (MapValues.optionalString(appearance, "viewMode")) {
            null, "2d" -> TileflowViewMode.FLAT
            "3d" -> TileflowViewMode.THREE_DIMENSIONAL
            else -> MapValues.invalid()
        }
        val options = MapValues.options(input, map.options, map.layoutDirection == View.LAYOUT_DIRECTION_RTL).copy(viewMode = mode)
        val inset = MapValues.objectValue(input, "contentInset")
        if (insetJson != (inset?.toString() ?: "{}")) {
            insetJson = inset?.toString() ?: "{}"
            basePadding = MapValues.padding(inset, density)
            padding(basePadding)
        }
        map.setOptions(options)
        if (!initialized) {
            val initial = MapValues.objectValue(input, "initialCamera")
            camera.setSource(source, initial)
            if (initial?.has("padding") == true && !initial.has("bounds"))
                basePadding = MapValues.padding(MapValues.objectValue(initial, "padding"), density)
            initialized = true
        }
        val duration = SceneValues.themeDuration(appearance)
        val blend = MapValues.objectValue(appearance, "themeBlend")
        if (blend != null) {
            val value = SceneValues.blend(blend)
            map.setBlend(value.themes, value.position, value.hold, duration)
        } else {
            val time = MapValues.optionalString(appearance, "timeOfDay")?.let { value ->
                TileflowTimeOfDay.entries.firstOrNull { it.name.lowercase() == value } ?: MapValues.invalid()
            }
            map.setTheme(MapValues.optionalString(appearance, "theme"), time, duration)
        }
        locationInput?.let { setUserLocation(it) }
    }

    private val density get() = map.resources.displayMetrics.density
    private fun checkActive() { if (disposed) throw TileflowMapException(TileflowErrorCode.DISPOSED) }
    private fun strings(value: JSONArray) = MapValues.list(value, MapValues::string)
    private fun filter(value: JSONObject) = MapValues.arrayValue(value, "filter")?.let { TileflowExpression.fromJson(it.toString()) }

    override suspend fun call(method: String, payload: JSONObject): Any {
        checkActive()
        when (method) {
            "getCamera", "setCamera", "stopCamera", "cameraForBounds", "getVisibleBounds", "project", "unproject" -> return camera.call(method, payload)
            "addSource" -> map.addStyleSource(payload.getString("id"), payload.getJSONObject("properties"))
            "updateSource" -> map.updateSource(payload.getString("id"), payload.getJSONObject("properties"))
            "removeSource" -> map.removeSource(payload.getString("id"))
            "setGeoJSONSourceData" -> {
                val data = payload.get("data")
                map.setGeoJSONSourceData(payload.getString("id"), when (data) {
                    is String -> TileflowGeoJSONData.Url(data)
                    is JSONObject -> TileflowGeoJSONData.GeoJSON(data.toString())
                    else -> MapValues.invalid()
                })
            }
            "updateGeoJSONSource" -> {
                val update = payload.getJSONObject("update")
                val features = listOf("add", "update").flatMap { key ->
                    MapValues.arrayValue(update, key)?.let { MapValues.list(it) { feature -> MapGeoJSON.feature(feature as? JSONObject ?: MapValues.invalid()) } } ?: emptyList()
                }
                map.updateGeoJSONSourceFeatures(payload.getString("id"), features,
                    MapValues.arrayValue(update, "remove")?.let(::strings) ?: emptyList())
            }
            "addLayer" -> {
                val properties = JSONObject(payload.getJSONObject("properties").toString())
                val position = MapValues.objectValue(payload, "position")
                if (position?.has("slot") == true) properties.put("slot", position.get("slot"))
                map.addStyleLayer(properties, MapValues.layerPosition(position, properties.getString("id")))
            }
            "updateLayer" -> map.updateStyleLayer(payload.getJSONObject("properties"))
            "moveLayer" -> {
                val position = payload.getJSONObject("position")
                if (position.has("slot")) map.moveLayer(payload.getString("id"), MapValues.layerPosition(position, payload.getString("id"), "moveLayer"), MapValues.slot(MapValues.optionalString(position, "slot")))
                else map.moveLayer(payload.getString("id"), MapValues.layerPosition(position, payload.getString("id"), "moveLayer"))
            }
            "removeLayer" -> map.removeLayer(payload.getString("id"))
            "setFeatureState" -> map.setFeatureState(payload.getString("sourceId"), MapValues.optionalString(payload, "sourceLayer"), payload.getString("featureId"), MapValues.styleState(payload.getJSONObject("state")))
            "getFeatureState" -> return MapValues.styleState(map.featureState(payload.getString("sourceId"), MapValues.optionalString(payload, "sourceLayer"), payload.getString("featureId")))
            "removeFeatureState" -> map.removeFeatureState(payload.getString("sourceId"), MapValues.optionalString(payload, "sourceLayer"), payload.getString("featureId"), MapValues.optionalString(payload, "key"))
            "queryRenderedFeatures" -> return MapGeoJSON.features(map.queryRenderedFeatures(MapValues.queryGeometry(payload.getJSONObject("geometry"), density), TileflowRenderedQueryOptions(MapValues.arrayValue(payload, "layerIds")?.let(::strings), filter(payload))))
            "querySourceFeatures" -> return MapGeoJSON.features(map.querySourceFeatures(payload.getString("sourceId"), TileflowSourceQueryOptions(MapValues.optionalString(payload, "sourceLayer")?.let(::listOf), filter(payload))))
            "getClusterChildren" -> return MapGeoJSON.features(map.clusterChildren(payload.getString("sourceId"), MapValues.integer(payload.get("clusterId"))))
            "getClusterLeaves" -> return MapGeoJSON.features(map.clusterLeaves(payload.getString("sourceId"), MapValues.integer(payload.get("clusterId")), MapValues.optionalNumber(payload, "limit")?.let(MapValues::integer) ?: 10, MapValues.optionalNumber(payload, "offset")?.let(MapValues::integer) ?: 0))
            "getClusterExpansionZoom" -> return map.clusterExpansionZoom(payload.getString("sourceId"), MapValues.integer(payload.get("clusterId")))
            "setImages" -> {
                val images = SceneValues.images(payload.getJSONArray("images"), loadImage)
                currentCoroutineContext().ensureActive()
                checkActive()
                map.setImages(images)
            }
            "joinBoundaryRows" -> {
                val (rows, options) = SceneValues.boundaryJoin(payload)
                return SceneValues.boundaryJoin(map.joinBoundaryRows(rows, options))
            }
            "setBoundaryValues" -> map.setBoundaryValues(SceneValues.boundaries(MapValues.objectValue(payload, "values")))
            "setDataLayers" -> map.setDataLayers(payload.getJSONObject("dataSources"), payload.getJSONObject("dataOverlays"))
            "setStyleState" -> MapValues.styleState(payload.getJSONObject("state")).forEach { (name, value) -> map.setStyleState(name, value) }
            "setEmphasis" -> map.setEmphasis(SceneValues.emphasis(MapValues.objectValue(payload, "emphasis")), SceneValues.duration(payload))
            "setSun" -> map.setSun(SceneValues.sun(MapValues.objectValue(payload, "sun")), SceneValues.duration(payload))
            "setDepthMarkers" -> map.setDepthMarkers(MapValues.list(payload.getJSONArray("markers")) { SceneValues.depthMarker(it as? JSONObject ?: MapValues.invalid()) })
            "getRouteInks" -> return SceneValues.routeInks(map.routeInks())
            "animateLineProgress", "playShot" -> {
                val job = currentCoroutineContext().job
                animations += job
                try {
                    return if (method == "playShot") map.play(SceneValues.shot(payload.getJSONObject("shot"))) { emit("shotCue", JSONObject().put("id", it)) }
                    else map.animateLineProgress(strings(payload.getJSONArray("layers")), SceneValues.progress(payload.getJSONObject("to")), SceneValues.duration(payload))
                } finally { animations -= job }
            }
            "stopAnimation" -> { MapValues.only(payload); animations.toList().forEach { it.cancel() } }
            "setPointAnnotations" -> setPointAnnotations(payload.getJSONArray("annotations"))
            "setUserLocation" -> setUserLocation(payload)
            "requestLocationPermission" -> return requestPermission()
            "reload" -> map.reload()
            else -> MapValues.invalid()
        }
        return JSONObject.NULL
    }

    private fun padding(value: TileflowEdgeInsets) = map.setContentPadding(value.left, value.top, value.right, value.bottom)

    private suspend fun setUserLocation(input: JSONObject) {
        val visible = MapValues.boolean(input, "visible", false)
        val follows = MapValues.boolean(input, "followUserLocation", false)
        val consumes = visible || MapValues.boolean(input, "emitsUpdates", false) || follows
        val mode = when (MapValues.optionalString(input, "followUserMode") ?: "normal") {
            "normal" -> TileflowFollowMode.POSITION
            "compass" -> TileflowFollowMode.HEADING
            "course" -> TileflowFollowMode.COURSE
            else -> MapValues.invalid()
        }
        val location = map.options.location.copy(enabled = consumes, showsPuck = visible,
            puckBearing = when {
                MapValues.boolean(input, "followsCourse", false) -> TileflowPuckBearing.COURSE
                MapValues.boolean(input, "showsUserHeadingIndicator", false) -> TileflowPuckBearing.HEADING
                else -> TileflowPuckBearing.NONE
            }, followZoom = MapValues.optionalNumber(input, "followZoomLevel"))
        map.setOptions(map.options.copy(location = location))
        locationInput = JSONObject(input.toString())
        padding(if (follows) MapValues.objectValue(input, "followPadding")?.let { MapValues.padding(it, density) } ?: basePadding else basePadding)
        if (follows && map.currentCamera != null) MapValues.optionalNumber(input, "followPitch")?.let { map.move(TileflowCameraUpdate(pitch = it)) }
        map.followMode = if (follows) mode else TileflowFollowMode.NONE
    }

    private fun setPointAnnotations(values: JSONArray) {
        val ids = mutableListOf<String>()
        val options = MapValues.list(values) { raw ->
            val value = raw as? JSONObject ?: MapValues.invalid()
            ids += value.getString("id")
            TileflowPointAnnotationOptions().withPoint(MapValues.coordinate(value.getJSONArray("coordinate"))).apply {
                val image = MapValues.optionalString(value, "iconImage")
                if (image == null) withIconImage(defaultPointImage) else withIconImage(image)
                MapValues.optionalNumber(value, "iconSize")?.let(::withIconSize)
                MapValues.optionalNumber(value, "iconRotate")?.let(::withIconRotate)
                MapValues.optionalString(value, "iconColor")?.let { withIconColor(TileflowColor.fromHex(it)) }
                withDraggable(MapValues.boolean(value, "draggable", false))
                withAccessibilityLabel(MapValues.optionalString(value, "accessibilityLabel"))
            }
        }
        if (ids.toSet().size != ids.size) MapValues.invalid()
        options.forEachIndexed { index, value -> value.build(ids[index]) }
        val manager = points ?: map.annotations.createPointAnnotationManager().also { manager ->
            points = manager
            manager.addClickListener { annotation -> annotationEvent(annotation, null); true }
            manager.addDragListener(object : TileflowAnnotationDragListener<TileflowPointAnnotation> {
                override fun onAnnotationDragStarted(annotation: TileflowPointAnnotation) = annotationEvent(annotation, "started")
                override fun onAnnotationDrag(annotation: TileflowPointAnnotation) = annotationEvent(annotation, "moving")
                override fun onAnnotationDragFinished(annotation: TileflowPointAnnotation) = annotationEvent(annotation, "ended")
            })
        }
        manager.deleteAll()
        pointIds.clear()
        manager.create(options).forEachIndexed { index, annotation -> pointIds[annotation.id] = ids[index] }
    }

    private fun annotationEvent(annotation: TileflowPointAnnotation, phase: String?) {
        val id = pointIds[annotation.id] ?: return
        emit(if (phase == null) "annotationActivated" else "annotationDragged", JSONObject().put("id", id).put("coordinate", MapValues.coordinate(annotation.point)).apply { if (phase != null) put("phase", phase) })
    }

    private fun receive(event: TileflowMapEvent) {
        if (disposed) return
        val payload = JSONObject()
        val type = when (event) {
            TileflowMapEvent.Loading -> "loading"
            TileflowMapEvent.ContentReady -> {
                locationInput?.let { input -> scope.launch { runCatching { setUserLocation(input) }.onFailure { emit("failed", MapValues.failure(it)) } } }
                "contentReady"
            }
            is TileflowMapEvent.CameraChanged -> { MapValues.cameraEvent(event.change, System.currentTimeMillis(), gestures.isNotEmpty())?.let { emit("cameraChanged", it) }; return }
            is TileflowMapEvent.GestureStarted -> { gestures += event.gesture; return }
            is TileflowMapEvent.GestureEnded -> { gestures -= event.gesture; return }
            is TileflowMapEvent.Tap -> { emit("tap", MapValues.tap(event.coordinate, event.point, density)); return }
            is TileflowMapEvent.LongPress -> { emit("longPress", MapValues.tap(event.coordinate, event.point, density)); return }
            is TileflowMapEvent.PoiActivated -> { payload.put("coordinate", MapValues.coordinate(event.selection.coordinate)).put("id", event.selection.id).put("name", event.selection.name).put("category", event.selection.category); "poiActivated" }
            is TileflowMapEvent.AnnotationActivated -> { payload.put("id", event.id).put("coordinate", MapValues.coordinate(event.coordinate)); "annotationActivated" }
            is TileflowMapEvent.ThemeChanged -> { payload.put("theme", event.theme); "themeChanged" }
            is TileflowMapEvent.ThemeTransition -> {
                val transition = event.transition
                payload.put("phase", if (transition.phase == TileflowThemeTransition.Phase.FAILED) "error" else transition.phase.name.lowercase()).put("currentTheme", transition.currentTheme).put("targetTheme", transition.targetTheme)
                transition.routeInks?.let { payload.put("routeInks", SceneValues.routeInks(it)) }
                "themeTransition"
            }
            is TileflowMapEvent.Warning -> { emit("warning", MapValues.failure(TileflowMapException(event.code, event.context)).put("occurrences", event.occurrences)); return }
            is TileflowMapEvent.Failed -> { emit("failed", MapValues.failure(TileflowMapException(event.code, event.context))); return }
            is TileflowMapEvent.FollowModeChanged -> { payload.put("mode", event.change.mode.name.lowercase()).put("reason", event.change.reason.name.lowercase()); "followModeChanged" }
            is TileflowMapEvent.ExternalLinkRequested -> { payload.put("url", event.url.toString()); "externalLinkRequested" }
            TileflowMapEvent.RecenterRequested -> "recenterRequested"
        }
        emit(type, payload)
    }

    override fun destroy() {
        if (disposed) return
        disposed = true
        scope.cancel()
        map.onEvent = {}
        map.destroy()
        relay.destroy()
        points = null
        pointIds.clear()
    }
}

private class LocationRelay(
    private val provider: TileflowDefaultLocationProvider,
    private val onLocation: (TileflowLocation) -> Unit,
) : TileflowLocationProvider, TileflowLocationConsumer {
    private val consumers = mutableSetOf<TileflowLocationConsumer>()

    override fun addConsumer(consumer: TileflowLocationConsumer) {
        if (!consumers.add(consumer)) return
        provider.addConsumer(this)
        provider.latestLocation?.let(consumer::locationUpdated)
        provider.latestHeading?.let(consumer::headingUpdated)
    }

    override fun removeConsumer(consumer: TileflowLocationConsumer) {
        consumers -= consumer
        if (consumers.isEmpty()) provider.removeConsumer(this)
    }

    override fun locationUpdated(location: TileflowLocation) {
        consumers.toList().forEach { it.locationUpdated(location) }
        onLocation(location)
    }

    override fun headingUpdated(heading: TileflowHeading) = consumers.toList().forEach { it.headingUpdated(heading) }

    fun destroy() { consumers.clear(); provider.removeConsumer(this) }
}
