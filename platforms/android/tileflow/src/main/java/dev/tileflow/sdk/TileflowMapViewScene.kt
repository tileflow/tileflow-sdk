package dev.tileflow.sdk

import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONArray
import org.json.JSONObject

/**
 * A scene request the view keeps, so a new renderer receives it again. Its data is registered on
 * the renderer's data channel each time it is sent; `replaying` applies it at once, without a
 * transition.
 */
internal class SceneCommand(
    val method: ProtocolContract.Method,
    val build: (DataChannel, replaying: Boolean) -> Pair<JSONObject, List<DataChannel.Reference>>,
) {
    constructor(
        method: ProtocolContract.Method,
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
    var images: SceneCommand? = null
    var depthMarkers: SceneCommand? = null
    var sun: SceneCommand? = null
    var emphasis: SceneCommand? = null
    val styleStates: LinkedHashMap<String, SceneCommand> = LinkedHashMap()
    var boundaries: SceneCommand? = null

    val commands: List<SceneCommand>
        get() =
            listOfNotNull(images, depthMarkers, sun, emphasis) +
                styleStates.values +
                listOfNotNull(boundaries)

    fun setStyleState(name: String, command: SceneCommand) {
        styleStates.remove(name)
        styleStates[name] = command
    }

    fun copy(): SceneState =
        SceneState().also {
            it.images = images
            it.depthMarkers = depthMarkers
            it.sun = sun
            it.emphasis = emphasis
            it.styleStates.putAll(styleStates)
            it.boundaries = boundaries
        }

    fun restore(from: SceneState) {
        images = from.images
        depthMarkers = from.depthMarkers
        sun = from.sun
        emphasis = from.emphasis
        styleStates.clear()
        styleStates.putAll(from.styleStates)
        boundaries = from.boundaries
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
        pending.forEach { it.resumeWithException(TileflowMapException(code)) }
    }
}

private val LAYER_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

private fun invalid(): Nothing = throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

private fun transition(durationMillis: Long): Long =
    durationMillis.also { if (it !in 0..5000) invalid() }

private fun TileflowMapView.requireRenderer(): MapBridge {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    return readyBridge ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
}

/** Keeps a scene request for later renderers and sends it to the current one. */
private suspend fun TileflowMapView.sendScene(
    command: SceneCommand,
    keep: SceneState.(SceneCommand) -> Unit,
) {
    if (isDestroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
    val previous = scene.copy()
    scene.keep(command)
    val bridge = readyBridge ?: return
    try {
        bridge.send(command, replaying = false)
    } catch (error: TileflowMapException) {
        // A request the renderer refuses is not given to the next one either.
        if (error.code == TileflowErrorCode.INVALID_REQUEST) scene.restore(previous)
        throw error
    }
}

private suspend fun MapBridge.send(command: SceneCommand, replaying: Boolean) {
    val (payload, references) = command.build(data, replaying)
    call(command.method, payload, references)
}

/** Gives a new renderer the scene the application asked for, at once. */
internal suspend fun TileflowMapView.replayScene(bridge: MapBridge) {
    for (command in scene.commands) bridge.send(command, replaying = true)
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
    readyBridge?.call(
        ProtocolContract.Method.SET_VIEW_MODE,
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
    sendScene(SceneCommand(ProtocolContract.Method.SET_SUN, payload)) { this.sun = it }
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
                ProtocolContract.Method.SET_EMPHASIS,
                JSONObject().put("emphasis", JSONObject.NULL).put("duration", duration),
            )
        ) {
            this.emphasis = it
        }
        return
    }
    val keep = emphasis.keepArea?.toByteArray(Charsets.UTF_8)
    if (
        emphasis.recede.size > 64 ||
            emphasis.recede.any { (module, amount) ->
                !Regex("^[a-z][a-z0-9-]{0,63}$").matches(module.name) || amount !in 0.0..1.0
            } ||
            (emphasis.labels != null && emphasis.labels !in 0.0..1.0) ||
            (keep != null && (keep.isEmpty() || keep.size > ProtocolContract.MAXIMUM_DATA_BYTES))
    )
        invalid()
    val digest = keep?.let(DataChannel::digest)
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
        SceneCommand(ProtocolContract.Method.SET_EMPHASIS) { channel, replaying ->
            val value = JSONObject(fixed.toString())
            val references = mutableListOf<DataChannel.Reference>()
            if (keep != null && digest != null) {
                val reference = channel.register(keep, digest, "application/geo+json")
                references += reference
                value.put("keep", reference.json())
            }
            JSONObject().put("emphasis", value).put("duration", if (replaying) 0 else duration) to
                references
        }
    ) {
        this.emphasis = it
    }
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
    sendScene(SceneCommand(ProtocolContract.Method.SET_STYLE_STATE, payload)) {
        setStyleState(name, it)
    }
}

/**
 * The route inks of the theme on screen, mixed during a blend. Layers drawn with a
 * [TileflowRouteInk] follow them without this call.
 */
public suspend fun TileflowMapView.routeInks(): TileflowRouteInks {
    val result = requireRenderer().call(ProtocolContract.Method.GET_ROUTE_INKS) as? JSONObject
    return try {
        TileflowRouteInks.from(result ?: throw IllegalArgumentException())
    } catch (_: Exception) {
        throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    }
}

/**
 * Sets the application's values on the map's Boundaries areas, for a choropleth that reads them;
 * null removes them. Rows travel on the data channel.
 */
public suspend fun TileflowMapView.setBoundaryValues(values: TileflowBoundaryValues?) {
    if (values == null) {
        sendScene(
            SceneCommand(
                ProtocolContract.Method.SET_BOUNDARY_VALUES,
                JSONObject().put("values", JSONObject.NULL),
            )
        ) {
            boundaries = it
        }
        return
    }
    val (joinBy, rows) = values.rows()
    if (rows.size > ProtocolContract.MAXIMUM_DATA_BYTES)
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                ProtocolContract.ErrorReason.DATA_TOO_LARGE,
                ProtocolContract.MAXIMUM_DATA_BYTES,
            ),
        )
    val digest = DataChannel.digest(rows)
    sendScene(
        SceneCommand(ProtocolContract.Method.SET_BOUNDARY_VALUES) { channel, _ ->
            val reference = channel.register(rows, digest, "application/json")
            JSONObject()
                .put("values", JSONObject().put("joinBy", joinBy).put("rows", reference.json()))
                .put("labels", values.labels)
                .put("state", values.state) to listOf(reference)
        }
    ) {
        boundaries = it
    }
}

/** Replaces the application's images. Unchanged images are neither sent nor decoded again. */
public suspend fun TileflowMapView.setImages(images: List<TileflowMapImage>) {
    if (images.size > 32 || images.map { it.name }.toSet().size != images.size) invalid()
    val payloads = images.flatMap { listOf(it.data) + it.variants.values }
    val distinct = payloads.associateBy(DataChannel::digest)
    if (
        distinct.values.sumOf { it.size.toLong() } > ProtocolContract.MAXIMUM_DATA_TOTAL_BYTES ||
            distinct.size > ProtocolContract.MAXIMUM_DATA_REFERENCES
    )
        throw TileflowMapException(
            TileflowErrorCode.INVALID_REQUEST,
            TileflowErrorContext.of(
                ProtocolContract.ErrorReason.DATA_TOO_LARGE,
                ProtocolContract.MAXIMUM_DATA_TOTAL_BYTES,
            ),
        )
    val kept = images.toList()
    sendScene(
        SceneCommand(ProtocolContract.Method.SET_IMAGES) { channel, _ ->
            val references = mutableListOf<DataChannel.Reference>()
            try {
                fun register(bytes: ByteArray): JSONObject =
                    channel
                        .register(bytes, DataChannel.digest(bytes), "application/octet-stream")
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
        }
    ) {
        this.images = it
    }
}

/**
 * Replaces the markers drawn in the map's 3D scene. Each names an image passed with [setImages].
 */
public suspend fun TileflowMapView.setDepthMarkers(markers: List<TileflowDepthMarker>) {
    if (markers.size > 128 || markers.map { it.id }.toSet().size != markers.size) invalid()
    val payload = JSONObject().put("markers", JSONArray(markers.map { it.json() }))
    sendScene(SceneCommand(ProtocolContract.Method.SET_DEPTH_MARKERS, payload)) {
        depthMarkers = it
    }
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
    val bridge = requireRenderer()
    val started =
        bridge.call(
            ProtocolContract.Method.ANIMATE_LINE_PROGRESS,
            JSONObject()
                .put("layers", JSONArray(layers))
                .put("to", to.stateJson())
                .put("duration", durationMillis),
        )
    // A new renderer draws the lines where the animation leads.
    keepLineProgress(to, layers.toSet())
    return awaitAnimation(started, bridge, null)
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
    val bridge = requireRenderer()
    endFollowing(dev.tileflow.sdk.location.TileflowFollowModeChangeReason.API)
    val started = bridge.call(ProtocolContract.Method.PLAY_SHOT, payload)
    return awaitAnimation(started, bridge, onCue)
}

private suspend fun TileflowMapView.awaitAnimation(
    started: Any,
    bridge: MapBridge,
    onCue: ((String) -> Unit)?,
): Boolean {
    val id =
        (started as? JSONObject)?.optString("animation")?.takeIf { it.isNotEmpty() }
            ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    try {
        return animations.wait(id, onCue)
    } catch (cancellation: CancellationException) {
        // The caller is gone; the animation stops where it is.
        launchOnView {
            try {
                bridge.call(
                    ProtocolContract.Method.STOP_ANIMATION,
                    JSONObject().put("animation", id),
                )
            } catch (_: Exception) {
                // A renderer that is gone has stopped it already.
            }
        }
        throw cancellation
    }
}
