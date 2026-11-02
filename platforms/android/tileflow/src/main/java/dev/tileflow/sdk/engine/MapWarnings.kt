package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.transport.MapResourceOutcome
import org.json.JSONObject

/**
 * Aggregates repeated warnings, as the web runtime does, so a failing tile set cannot flood the
 * application. The first warning of a kind is reported at once with a count of 1; repeats within
 * the window are reported together when it closes. A kind is its code, resource, origin and
 * status. Used on the main thread.
 */
internal class MapWarnings(
    /** Receives the `warning` event value. */
    private val report: (JSONObject) -> Unit,
    /** Runs a block after a delay in milliseconds, on the main thread. */
    private val schedule: (Long, () -> Unit) -> Unit,
    private val windowMillis: Long = ProtocolContract.WARNING_WINDOW_MILLIS,
) {
    private class Window(var warning: JSONObject, var repeats: Int = 0)

    private val windows = HashMap<String, Window>()
    private var retired = false

    fun warn(
        code: String,
        message: String,
        resource: TileflowResourceKind?,
        origin: String?,
        status: Int?,
    ) {
        if (retired) return
        val context = JSONObject()
        resource?.let { context.put("resource", it.wireName) }
        origin?.takeIf { it.isNotEmpty() }?.let { context.put("origin", it) }
        status?.let { context.put("status", it) }
        val warning = JSONObject().put("code", code).put("message", message).put("context", context)
        val key = listOf(code, resource?.wireName, origin, status).toString()
        windows[key]?.let {
            it.warning = warning
            it.repeats += 1
            return
        }
        windows[key] = Window(warning)
        report(JSONObject(warning.toString()).put("count", 1))
        schedule(windowMillis) {
            val window = windows.remove(key) ?: return@schedule
            if (!retired && window.repeats > 0)
                report(JSONObject(window.warning.toString()).put("count", window.repeats))
        }
    }

    /**
     * Warns about a request the map could not complete: the transport failed, or answered an
     * error status. A missing tile (404) is not a failure, since the source has no tile there.
     */
    fun resource(outcome: MapResourceOutcome) {
        val status = outcome.status
        val failed =
            status == null ||
                (status >= 400 && !(status == 404 && outcome.resource == TileflowResourceKind.TILE))
        if (failed)
            warn(
                "resourceFailed",
                "A map resource failed to load.",
                outcome.resource,
                outcome.origin,
                status,
            )
    }

    fun retire() {
        retired = true
        windows.clear()
    }
}
