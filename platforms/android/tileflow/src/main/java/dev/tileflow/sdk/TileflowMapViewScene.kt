package dev.tileflow.sdk

import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.engine.MapEngine
import dev.tileflow.sdk.model.MapPayloadStore
import dev.tileflow.sdk.transport.ResourceDigest
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject

/**
 * A scene request the view keeps, so a new renderer receives it again. Its data is registered on
 * the renderer's data channel each time it is sent; `replaying` applies it at once, without a
 * transition.
 */
internal class SceneCommand(
    val method: MapContract.Method,
    val build: (MapPayloadStore, replaying: Boolean) -> Pair<JSONObject, List<MapPayloadStore.Reference>>,
) {
    constructor(
        method: MapContract.Method,
        payload: JSONObject,
    ) : this(
        method,
        { _, replaying -> (if (replaying) immediate(payload) else payload) to emptyList() },
    )

    companion object {
        fun immediate(payload: JSONObject): JSONObject =
            if (payload.has("duration")) JSONObject(payload.toString()).put("duration", 0)
            else payload
    }
}

/**
 * The scene beyond the theme that the application asked for, in the order a renderer needs it:
 * images before the markers that show them.
 */
internal class SceneState {
    class Edit(
        val command: SceneCommand,
        val stateName: String?,
        val images: List<TileflowMapImage>?,
    ) {
        enum class Status { SENDING, QUEUED, ACCEPTED }

        val destination = command.method to stateName
        var status = Status.SENDING
    }

    private val edits = mutableListOf<Edit>()

    /** Keep issue order while the renderer answers concurrent requests. */
    fun begin(
        command: SceneCommand,
        stateName: String? = null,
        images: List<TileflowMapImage>? = null,
    ): Edit = Edit(command, stateName, images).also(edits::add)

    /** Coalesce requests made before a renderer exists, keeping its last confirmed value as fallback. */
    fun queue(edit: Edit) {
        edits.removeAll { it.status == Edit.Status.QUEUED && it.destination == edit.destination }
        edit.status = Edit.Status.QUEUED
    }

    fun finish(edit: Edit, accepted: Boolean) {
        val index = edits.indexOf(edit)
        if (index < 0) return
        if (!accepted) {
            edits.removeAt(index)
            return
        }
        edit.status = Edit.Status.ACCEPTED
        // A newer acceptance replaces only earlier requests for this property or named state.
        edits.subList(0, index).removeAll {
            it.destination == edit.destination
        }
    }

    /** Incremental image edits build on the latest request even while its reply is pending. */
    val editableImages: List<TileflowMapImage>
        get() = edits.lastOrNull { it.images != null }?.images.orEmpty()

    val replay: List<Edit>
        get() {
            val latest = edits.asReversed().filter { it.status != Edit.Status.SENDING }
                .distinctBy { it.destination }.asReversed()
            return replayOrder.flatMap { method -> latest.filter { it.command.method == method } }
        }

    suspend fun restore(
        imagesChanged: (List<TileflowMapImage>) -> Unit = {},
        send: suspend (SceneCommand) -> Boolean,
    ) {
        var refusal: TileflowMapException? = null
        for (selected in replay) {
            val fallback = if (selected.status == Edit.Status.QUEUED) edits.lastOrNull {
                it.status == Edit.Status.ACCEPTED && it.destination == selected.destination
            } else null
            for (edit in listOfNotNull(selected, fallback)) {
                if (edit !in edits) break
                val queuedImages = edit.status == Edit.Status.QUEUED && edit.images != null
                try {
                    val applied = send(edit.command)
                    if (edit.status == Edit.Status.QUEUED) finish(edit, applied)
                    break
                } catch (error: TileflowMapException) {
                    if (error.code != TileflowErrorCode.INVALID_REQUEST) throw error
                    if (refusal == null) refusal = error
                    if (edit.status == Edit.Status.QUEUED) finish(edit, accepted = false)
                } finally {
                    if (queuedImages) imagesChanged(editableImages)
                }
            }
        }
        refusal?.let { throw it }
    }

    private companion object {
        val replayOrder = listOf(
            MapContract.Method.SET_IMAGES, MapContract.Method.SET_DEPTH_MARKERS,
            MapContract.Method.SET_SUN, MapContract.Method.SET_EMPHASIS,
            MapContract.Method.SET_STYLE_STATE, MapContract.Method.SET_BOUNDARY_VALUES,
        )
    }
}

/** Calls that wait for an animation of the current renderer to end. Used on the main thread. */
internal class AnimationWaiters {
    private val waiting = mutableMapOf<String, CancellableContinuation<Boolean>>()
    private val cues = mutableMapOf<String, (String) -> Unit>()
    /** Ends that arrived before their call learned the animation's identifier. */
    private val ended = mutableMapOf<String, Boolean>()

    suspend fun wait(id: String, onCue: ((String) -> Unit)?): Boolean {
        ended.remove(id)?.let {
            return it
        }
        onCue?.let { cues[id] = it }
        return suspendCancellableCoroutine { continuation ->
            waiting[id] = continuation
            continuation.invokeOnCancellation {
                waiting.remove(id)
                cues.remove(id)
            }
        }
    }

    fun receive(event: String, result: JSONObject) {
        val id = result.optString("animation").takeIf { it.isNotEmpty() } ?: return
        when (event) {
            "shotCue" ->
                result.optString("cue").takeIf { it.isNotEmpty() }?.let { cues[id]?.invoke(it) }
            "animationEnded" -> {
                val finished = result.optBoolean("finished", false)
                cues.remove(id)
                val continuation = waiting.remove(id)
                if (continuation != null) continuation.resume(finished)
                else if (ended.size < 64) ended[id] = finished
            }
        }
    }

    /** The renderer is replaced or destroyed; its animations end with it. */
    fun retire(code: TileflowErrorCode) {
        val pending = waiting.values.toList()
        waiting.clear()
        cues.clear()
        ended.clear()
        pending.forEach {
            if (code == TileflowErrorCode.CANCELLED) it.resume(false)
            else it.resumeWithException(TileflowMapException(code))
        }
    }
}

private val LAYER_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

private fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

private fun transition(durationMillis: Long): Long =
    durationMillis.also { if (it !in 0..5000) invalid() }

private fun TileflowMapView.requireRenderer(): MapEngine {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    return readyEngine ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
}

private suspend fun TileflowMapView.sendScene(
    command: SceneCommand,
    stateName: String? = null,
    images: List<TileflowMapImage>? = null,
) {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    currentCoroutineContext().ensureActive()
    val edit = scene.begin(command, stateName, images)
    if (images != null) this.images = images
    val engine = readyEngine
    if (engine == null) {
        scene.queue(edit)
        return
    }
    var accepted = false
    try {
        val applied = engine.send(command, replaying = false)
        currentCoroutineContext().ensureActive()
        accepted = applied
    } finally {
        scene.finish(edit, accepted)
        if (images != null) this.images = scene.editableImages
    }
}

private suspend fun MapEngine.send(command: SceneCommand, replaying: Boolean): Boolean {
    val (payload, references) = command.build(data, replaying)
    val result = call(command.method, payload, references)
    return (result as? JSONObject)?.optString("status") != "superseded"
}

/** Restores accepted values and checks requests queued before the renderer existed. */
internal suspend fun TileflowMapView.replayScene(engine: MapEngine) {
    scene.restore(imagesChanged = { images = it }) { command ->
        engine.send(command, replaying = true)
    }
}

/**
 * Changes between the flat map and its 3D scene. With a duration (up to 5000 ms), the buildings
 * rise from the ground or sink into it; [TileflowMapOptions.viewMode] changes at once.
 */
public suspend fun TileflowMapView.setViewMode(mode: TileflowViewMode, durationMillis: Long = 0) {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    transition(durationMillis)
    // The view mode is kept with the options, so a new renderer starts in it.
    keepOptions(options.copy(viewMode = mode))
    readyEngine?.call(
        MapContract.Method.SET_VIEW_MODE,
        JSONObject().put("viewMode", mode.wireName).put("duration", durationMillis),
    )
}

/**
 * Places the sun by direction or by the real sun of a date and place; null returns it to the
 * themes' suns. The sun turns the short way round over [durationMillis].
 */
public suspend fun TileflowMapView.setSun(sun: TileflowSun?, durationMillis: Long = 0) {
    val payload =
        JSONObject().put("sun", TileflowSun.json(sun)).put("duration", transition(durationMillis))
    sendScene(SceneCommand(MapContract.Method.SET_SUN, payload))
}

/**
 * Makes chosen modules of the map recede and its labels fade, so the application's content reads
 * first; null returns the map to its design.
 */
public suspend fun TileflowMapView.setEmphasis(
    emphasis: TileflowEmphasis?,
    durationMillis: Long = 0,
) {
    val duration = transition(durationMillis)
    if (emphasis == null) {
        sendScene(
            SceneCommand(
                MapContract.Method.SET_EMPHASIS,
                JSONObject().put("emphasis", JSONObject.NULL).put("duration", duration),
            )
        )
        return
    }
    val keep = emphasis.keepArea?.toByteArray(Charsets.UTF_8)
    if (
        emphasis.recede.size > 64 ||
            emphasis.recede.any { (module, amount) ->
                !Regex("^[a-z][a-z0-9-]{0,63}$").matches(module.name) || amount !in 0.0..1.0
            } ||
            (emphasis.labels != null && emphasis.labels !in 0.0..1.0) ||
            (keep != null && (keep.isEmpty() || keep.size > MapContract.MAXIMUM_DATA_BYTES))
    )
        invalid()
    val digest = keep?.let(ResourceDigest::sha256)
    val fixed = JSONObject()
    if (emphasis.recede.isNotEmpty())
        fixed.put(
            "recede",
            JSONObject().apply {
                emphasis.recede.forEach { (module, amount) -> put(module.name, amount) }
            },
        )
    emphasis.labels?.let { fixed.put("labels", it) }
    sendScene(
        SceneCommand(MapContract.Method.SET_EMPHASIS) { channel, replaying ->
            val value = JSONObject(fixed.toString())
            val references = mutableListOf<MapPayloadStore.Reference>()
            if (keep != null && digest != null) {
                val reference = channel.register(keep, digest, "application/geo+json")
                references += reference
                value.put("keep", reference.json())
            }
            JSONObject().put("emphasis", value).put("duration", if (replaying) 0 else duration) to
                references
        }
    )
}

/**
 * Sets a style-wide state that the map's themes read with `globalState`. A number eases from the
 * value it shows to the new one over [durationMillis]; states stay through theme changes.
 */
public suspend fun TileflowMapView.setStyleState(
    name: String,
    value: TileflowStyleValue,
    durationMillis: Long = 0,
) {
    if (!Regex("^\\S(.{0,126}\\S)?$").matches(name)) invalid()
    val payload =
        JSONObject()
            .put("name", name)
            .put("value", TileflowStyleValue.json(value))
            .put("duration", transition(durationMillis))
    sendScene(SceneCommand(MapContract.Method.SET_STYLE_STATE, payload), stateName = name)
}

/**
 * The route inks of the theme on screen, mixed during a blend. Layers drawn with a
 * [TileflowRouteInk] follow them without this call.
 */
public suspend fun TileflowMapView.routeInks(): TileflowRouteInks {
    val result = requireRenderer().call(MapContract.Method.GET_ROUTE_INKS) as? JSONObject
    return try {
        TileflowRouteInks.from(result ?: throw IllegalArgumentException())
    } catch (_: Exception) {
        throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    }
}

/**
 * Joins rows using the Boundaries release the ready map draws. A missing lookup class is downloaded
 * on demand and stored for later joins, including offline. Direct joins and a supplied [options]
 * lookup use no downloaded data.
 */
public suspend fun TileflowMapView.joinBoundaryRows(
    rows: List<TileflowBoundaryRow>,
    options: JoinBoundaryRowsOptions,
): TileflowBoundaryJoinResult = requireRenderer().joinBoundaryRows(rows, options)

/**
 * Sets the application's values on the map's Boundaries areas, for a choropleth that reads them;
 * null removes them. Rows travel on the data channel.
 */
public suspend fun TileflowMapView.setBoundaryValues(values: TileflowBoundaryValues?) {
    if (values == null) {
        sendScene(
            SceneCommand(
                MapContract.Method.SET_BOUNDARY_VALUES,
                JSONObject().put("values", JSONObject.NULL),
            )
        )
        return
    }
    val (joinBy, rows) = values.rows()
    if (rows.size > MapContract.MAXIMUM_DATA_BYTES)
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                MapContract.ErrorReason.DATA_TOO_LARGE,
                MapContract.MAXIMUM_DATA_BYTES,
            ),
        )
    val digest = ResourceDigest.sha256(rows)
    sendScene(
        SceneCommand(MapContract.Method.SET_BOUNDARY_VALUES) { channel, _ ->
            val reference = channel.register(rows, digest, "application/json")
            JSONObject()
                .put("values", JSONObject().put("joinBy", joinBy).put("rows", reference.json()))
                .put("labels", values.labels)
                .put("state", values.state) to listOf(reference)
        }
    )
}

/** Replaces the application's images. Unchanged images are neither sent nor decoded again. */
public suspend fun TileflowMapView.setImages(images: List<TileflowMapImage>) {
    if (images.size > 64 || images.map { it.name }.toSet().size != images.size) invalid()
    val payloads = images.flatMap { listOf(it.data) + it.variants.values }
    val distinct = payloads.associateBy(ResourceDigest::sha256)
    if (
        distinct.values.sumOf { it.size.toLong() } > MapContract.MAXIMUM_DATA_TOTAL_BYTES ||
            distinct.size > MapContract.MAXIMUM_DATA_REFERENCES
    )
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                MapContract.ErrorReason.DATA_TOO_LARGE,
                MapContract.MAXIMUM_DATA_TOTAL_BYTES,
            ),
        )
    val kept = images.toList()
    sendScene(
        SceneCommand(MapContract.Method.SET_IMAGES) { channel, _ ->
            val references = mutableListOf<MapPayloadStore.Reference>()
            try {
                fun register(bytes: ByteArray): JSONObject =
                    channel
                        .register(bytes, ResourceDigest.sha256(bytes), "application/octet-stream")
                        .also { references += it }
                        .json()
                val value =
                    JSONArray(
                        kept.map { image ->
                            JSONObject()
                                .put("name", image.name)
                                .put("data", register(image.data))
                                .put("pixelRatio", image.pixelRatio)
                                .apply {
                                    if (image.sdf) put("sdf", true)
                                    if (image.variants.isNotEmpty())
                                        put(
                                            "variants",
                                            JSONObject().apply {
                                                image.variants.forEach { (theme, bytes) ->
                                                    put(theme, register(bytes))
                                                }
                                            },
                                        )
                                }
                        }
                    )
                JSONObject().put("images", value) to references
            } catch (error: Exception) {
                channel.release(references)
                throw error
            }
        },
        images = kept,
    )
}

/**
 * Replaces the markers drawn in the map's 3D scene. Each names an image passed with [setImages].
 */
public suspend fun TileflowMapView.setDepthMarkers(markers: List<TileflowDepthMarker>) {
    if (markers.size > 128 || markers.map { it.id }.toSet().size != markers.size) invalid()
    val payload = JSONObject().put("markers", JSONArray(markers.map { it.json() }))
    sendScene(SceneCommand(MapContract.Method.SET_DEPTH_MARKERS, payload))
}

/**
 * Moves the drawn stretch of line layers drawn with progress, together, over [durationMillis] (up
 * to 60 000). Returns true when they get there and false when another change stops them first.
 * Cancelling the calling coroutine stops them where they are.
 */
public suspend fun TileflowMapView.animateLineProgress(
    layers: List<String>,
    to: TileflowLineProgress,
    durationMillis: Long,
): Boolean {
    to.validate()
    if (
        layers.size !in 1..16 ||
            layers.toSet().size != layers.size ||
            layers.any { !LAYER_ID.matches(it) } ||
            durationMillis !in 0..60_000
    )
        invalid()
    val engine = requireRenderer()
    return runAnimation(
        MapContract.Method.ANIMATE_LINE_PROGRESS,
        JSONObject()
            .put("layers", JSONArray(layers))
            .put("to", to.stateJson())
            .put("duration", durationMillis),
        engine,
        onCue = null,
    ) { keepLineProgress(to, layers.toSet()) }
}

/**
 * Plays a camera shot and returns true when it reaches its last keyframe, or false when a gesture,
 * another shot or a renderer replacement stops it. [onCue] is called on the main thread with each
 * cue's identifier as the shot reaches it. Cancelling the calling coroutine stops the shot.
 */
public suspend fun TileflowMapView.play(
    shot: TileflowShot,
    onCue: ((String) -> Unit)? = null,
): Boolean {
    val payload = shot.json()
    val engine = requireRenderer()
    endFollowing(dev.tileflow.sdk.location.TileflowFollowModeChangeReason.API)
    return runAnimation(MapContract.Method.PLAY_SHOT, payload, engine, onCue)
}

private suspend fun TileflowMapView.runAnimation(
    method: MapContract.Method,
    payload: JSONObject,
    engine: MapEngine,
    onCue: ((String) -> Unit)?,
    didStart: () -> Unit = {},
): Boolean {
    val started = try {
        engine.call(method, payload)
    } catch (error: TileflowMapException) {
        if (error.code != TileflowErrorCode.CANCELLED || readyEngine === engine) throw error
        currentCoroutineContext().ensureActive()
        if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        return false
    }
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    if (readyEngine !== engine) {
        currentCoroutineContext().ensureActive()
        return false
    }
    val id =
        (started as? JSONObject)?.optString("animation")?.takeIf { it.isNotEmpty() }
            ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    didStart()
    try {
        return animations.wait(id, onCue)
    } catch (cancellation: CancellationException) {
        // The caller is gone; the animation stops where it is.
        launchOnView {
            try {
                engine.call(
                    MapContract.Method.STOP_ANIMATION,
                    JSONObject().put("animation", id),
                )
            } catch (_: Exception) {
                // A renderer that is gone has stopped it already.
            }
        }
        throw cancellation
    }
}
