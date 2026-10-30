package dev.tileflow.sdk

import android.os.SystemClock
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * The camera events the application receives.
 *
 * The SDK subscribes to more camera events than an application may ask for: it follows every
 * movement to keep [TileflowMapView.isMoving] current, and every frame while a compass or scale bar
 * is shown. Events reach the application only at its chosen level and interval; the latest camera
 * of a throttled run is always delivered, and the settled camera always is.
 */
internal class CameraEventGate(
    private val scope: CoroutineScope,
    private val now: () -> Long = SystemClock::uptimeMillis,
) {
    var isMoving: Boolean = false
        private set

    private var lastMoving: Long? = null
    private var pending: Job? = null

    /** Delivers [change] to the application if its [options] ask for it. */
    fun receive(
        change: TileflowCameraChange,
        options: TileflowEventOptions,
        deliver: (TileflowCameraChange) -> Unit,
    ) {
        when (change.phase) {
            TileflowCameraChangePhase.STARTED -> {
                isMoving = true
                if (options.level.includes(TileflowEventLevel.CAMERA)) deliver(change)
            }
            TileflowCameraChangePhase.MOVING -> {
                if (!options.level.includes(TileflowEventLevel.CONTINUOUS)) return
                val interval = options.cameraUpdateIntervalMillis
                val time = now()
                val last = lastMoving
                if (pending == null && (last == null || time - last >= interval)) {
                    lastMoving = time
                    deliver(change)
                    return
                }
                pending?.cancel()
                val wait = ((last ?: time) + interval - time).coerceAtLeast(0)
                pending =
                    scope.launch {
                        delay(wait)
                        pending = null
                        lastMoving = now()
                        deliver(change)
                    }
            }
            TileflowCameraChangePhase.ENDED -> {
                isMoving = false
                reset()
                deliver(change)
            }
        }
    }

    /** Nothing pending from a previous movement or renderer is delivered. */
    fun reset() {
        pending?.cancel()
        pending = null
        lastMoving = null
    }

    fun rendererReplaced() {
        reset()
        isMoving = false
    }
}
