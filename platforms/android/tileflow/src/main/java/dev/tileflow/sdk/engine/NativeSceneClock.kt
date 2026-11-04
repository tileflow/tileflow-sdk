package dev.tileflow.sdk.engine

import android.os.SystemClock
import android.view.Choreographer
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine

/** Independent scene motions on the map's display clock. A new motion replaces its own channel. */
internal class NativeSceneClock {
    private val clock = Choreographer.getInstance()
    private val active = mutableMapOf<String, Motion>()

    private inner class Motion(
        val key: String,
        val duration: Long,
        val step: (Double) -> Unit,
        val end: (Boolean) -> Unit,
    ) : Choreographer.FrameCallback {
        val start = SystemClock.uptimeMillis()

        override fun doFrame(frameTimeNanos: Long) {
            if (active[key] !== this) return
            val t = ((frameTimeNanos / 1_000_000L - start).toDouble() / duration).coerceIn(0.0, 1.0)
            step(t)
            if (active[key] !== this) return
            if (t < 1) clock.postFrameCallback(this)
            else {
                active.remove(key)
                end(true)
            }
        }
    }

    fun start(key: String, duration: Long, step: (Double) -> Unit, end: (Boolean) -> Unit = {}) {
        stop(key)
        if (duration == 0L || !android.animation.ValueAnimator.areAnimatorsEnabled()) {
            step(1.0)
            end(true)
            return
        }
        val motion = Motion(key, duration, step, end)
        active[key] = motion
        step(0.0)
        if (active[key] === motion) clock.postFrameCallback(motion)
    }

    suspend fun animate(key: String, duration: Long, step: (Double) -> Unit): Boolean =
        suspendCancellableCoroutine { continuation ->
            start(key, duration, step) { finished ->
                if (continuation.isActive) continuation.resume(finished)
            }
            val motion = active[key]
            continuation.invokeOnCancellation {
                android.os.Handler(android.os.Looper.getMainLooper()).post {
                    if (motion != null && active[key] === motion) stop(key)
                }
            }
        }

    fun stop(key: String) {
        val motion = active.remove(key) ?: return
        clock.removeFrameCallback(motion)
        motion.end(false)
    }

    fun retire() {
        active.keys.toList().forEach(::stop)
    }
}
