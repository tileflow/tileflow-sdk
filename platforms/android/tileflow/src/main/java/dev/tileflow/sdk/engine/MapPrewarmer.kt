package dev.tileflow.sdk.engine

import android.content.Context
import android.os.Looper
import androidx.annotation.MainThread
import dev.tileflow.sdk.TileflowDeviceProfile
import dev.tileflow.sdk.TileflowMapCache
import dev.tileflow.sdk.transport.MapResourceContexts
import dev.tileflow.sdk.transport.TileflowHttpClient
import java.util.concurrent.atomic.AtomicBoolean

/** Prepares shared resources and MapLibre without mounting a map. */
internal object MapPrewarmer {
    private val sharedStarted = AtomicBoolean()

    @MainThread
    fun start(context: Context) {
        check(Looper.myLooper() == Looper.getMainLooper()) { "Call prewarm on the main thread." }
        val application = context.applicationContext ?: context
        if (sharedStarted.compareAndSet(false, true)) {
            Thread(
                    {
                        try {
                            TileflowDeviceProfile.current(application)
                            TileflowMapCache.get(application)
                            TileflowHttpClient.resources
                            TileflowHttpClient.sessions
                        } catch (_: Exception) {
                            // A later prewarm can retry; opening the map also runs normal setup.
                            sharedStarted.set(false)
                        }
                    },
                    "tileflow-prewarm",
                )
                .apply { isDaemon = true }
                .start()
        }
        MapResourceContexts.prewarm(application)
    }
}
