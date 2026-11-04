package dev.tileflow.sdk.engine

import android.os.SystemClock
import android.view.Choreographer
import dev.tileflow.sdk.TileflowCamera
import kotlin.coroutines.resume
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import org.json.JSONObject

/** One camera shot and independent application lines. The view waits on their animation ids. */
internal class NativeScenePlayer(
    private val content: NativeSceneContent,
    private val clock: NativeSceneClock,
    private val camera: (TileflowCamera) -> Unit,
    private val blend: suspend (JSONObject) -> Unit,
    private val event: (String, JSONObject) -> Unit,
) {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private var sequence = 0L
    private var shotId: String? = null
    private var shot: Job? = null
    private var shotRevision = 0L
    private val lines = mutableMapOf<String, MutableSet<String>>()
    private val lineOwners = mutableMapOf<String, String>()

    fun animate(request: JSONObject): JSONObject {
        val names = request.getJSONArray("layers").items().map { it as String }
        val updates =
            names.associateWith { name ->
                content.progress(listOf(name), request.getJSONObject("to"))
            }
        val id = "line-" + ++sequence
        val pending = names.toMutableSet()
        lines[id] = pending
        var done = true
        for ((name, change) in updates) {
            lineOwners[name] = id
            clock.start(
                "progress:$name",
                request.getLong("duration"),
                { t -> change(NativeSceneMath.smooth(t)) },
            ) { finished ->
                if (!finished) done = false
                if (lineOwners[name] == id) lineOwners.remove(name)
                pending.remove(name)
                if (pending.isEmpty() && lines.remove(id) != null) ended(id, done)
            }
        }
        return JSONObject().put("animation", id)
    }

    fun stopLines(names: Set<String>? = null) {
        (names ?: lineOwners.keys.toSet()).forEach { clock.stop("progress:$it") }
    }

    suspend fun play(request: JSONObject): JSONObject {
        val frames =
            request.getJSONArray("keyframes").objects().map { frame ->
                val c = frame.getJSONObject("camera")
                NativeSceneMath.ShotFrame(
                    frame.getLong("at"),
                    TileflowCamera(
                        c.getDouble("longitude"),
                        c.getDouble("latitude"),
                        c.getDouble("zoom"),
                        c.optDouble("bearing", 0.0),
                        c.optDouble("pitch", 0.0),
                    ),
                    (frame.opt("blendPosition") as? Number)?.toDouble(),
                )
            }
        val themes = request.optJSONArray("themes")
        val id = "shot-" + ++sequence
        stopShot()
        val generation = ++shotRevision
        val cues = request.getJSONArray("cues").objects().sortedBy { it.getLong("at") }
        suspend fun setBlend(at: Double) {
            if (themes != null) blend(JSONObject().put("themes", themes).put("position", at))
        }
        frames.first().blend?.let { setBlend(it) }
        if (generation != shotRevision)
            return JSONObject().put("animation", id).also { ended(id, false) }
        shotId = id
        shot =
            scope.launch {
                val start = SystemClock.uptimeMillis()
                var nextCue = 0
                var success = false
                try {
                    var elapsed =
                        if (android.animation.ValueAnimator.areAnimatorsEnabled()) 0L
                        else frames.last().at
                    while (isActive && shotId == id) {
                        val state =
                            NativeSceneMath.shot(
                                frames,
                                elapsed,
                                request.optString("easing") == "linear",
                            )
                        state.blend?.let { setBlend(it) }
                        if (!isActive || shotId != id) return@launch
                        camera(state.camera)
                        while (nextCue < cues.size && cues[nextCue].getLong("at") <= elapsed) {
                            event(
                                "shotCue",
                                JSONObject()
                                    .put("animation", id)
                                    .put("cue", cues[nextCue++].getString("id")),
                            )
                        }
                        if (elapsed >= frames.last().at) {
                            // MapLibre refreshes its reported CameraPosition on the following
                            // render.
                            frame()
                            success = true
                            break
                        }
                        frame()
                        elapsed = SystemClock.uptimeMillis() - start
                    }
                } catch (error: kotlinx.coroutines.CancellationException) {
                    throw error
                } catch (_: dev.tileflow.sdk.TileflowMapException) {
                    success = false
                } finally {
                    if (shotId == id) {
                        shotId = null
                        shot = null
                        ended(id, success)
                    }
                }
            }
        return JSONObject().put("animation", id)
    }

    private suspend fun frame() =
        suspendCancellableCoroutine<Unit> { waiting ->
            val choreographer = Choreographer.getInstance()
            val callback =
                Choreographer.FrameCallback { if (waiting.isActive) waiting.resume(Unit) }
            choreographer.postFrameCallback(callback)
            waiting.invokeOnCancellation { choreographer.removeFrameCallback(callback) }
        }

    fun stop(id: String) {
        if (id == shotId) stopShot()
        else lines[id]?.toList()?.forEach { if (lineOwners[it] == id) clock.stop("progress:$it") }
    }

    fun stopShot() {
        ++shotRevision
        val id = shotId ?: return
        shotId = null
        shot?.cancel()
        shot = null
        ended(id, false)
    }

    fun retire() {
        stopShot()
        stopLines()
        scope.cancel()
    }

    private fun ended(id: String, finished: Boolean) =
        event("animationEnded", JSONObject().put("animation", id).put("finished", finished))
}
