package dev.tileflow.sdk

import androidx.annotation.MainThread
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.location.FollowModeState
import dev.tileflow.sdk.location.TileflowDefaultLocationProvider
import dev.tileflow.sdk.location.TileflowFollowMode
import dev.tileflow.sdk.location.TileflowFollowModeChangeReason
import dev.tileflow.sdk.location.TileflowHeading
import dev.tileflow.sdk.location.TileflowLocation
import dev.tileflow.sdk.location.TileflowLocationConsumer
import dev.tileflow.sdk.location.TileflowLocationProvider
import org.json.JSONObject

/**
 * The map's side of its location: the provider it takes positions from, the latest of them, the
 * follow mode, and one update in flight to the renderer at a time with the latest values.
 */
@MainThread
internal class MapLocation(private val view: TileflowMapView) : TileflowLocationConsumer {
    var custom: TileflowLocationProvider? = null
    /** Receives each position, for a hoisted Compose state. */
    var observer: ((TileflowLocation) -> Unit)? = null
    private var fallback: TileflowDefaultLocationProvider? = null
    private var consumed: TileflowLocationProvider? = null
    var latest: TileflowLocation? = null
        private set

    var heading: TileflowHeading? = null
        private set

    val follow = FollowModeState()
    /** The view's count of its follow requests; see `followModeChanged`. */
    var revision = 0
    /** Whether the renderer has yet to start following a mode set before it could. */
    var pendingEntry = false
    private var locationChanged = false
    private var headingChanged = false
    private var sending = false

    val provider: TileflowLocationProvider
        get() =
            custom
                ?: fallback
                ?: TileflowDefaultLocationProvider(view.context).also { fallback = it }

    fun consume(next: TileflowLocationProvider?) {
        if (consumed === next) {
            (next as? TileflowDefaultLocationProvider)?.refresh()
            return
        }
        consumed?.removeConsumer(this)
        consumed = next
        next?.addConsumer(this)
    }

    override fun locationUpdated(location: TileflowLocation) {
        if (!location.isValid) return
        latest = location
        observer?.invoke(location)
        locationChanged = true
        flush()
    }

    override fun headingUpdated(heading: TileflowHeading) {
        if (!heading.direction.isFinite()) return
        this.heading = heading
        headingChanged = true
        flush()
    }

    /** Sends what changed once the previous update is answered, so updates never queue up. */
    fun flush() {
        if (sending || !(locationChanged || headingChanged)) return
        val bridge = view.readyBridge ?: return
        val payload = payload(locationChanged, headingChanged) ?: return
        locationChanged = false
        headingChanged = false
        sending = true
        view.launchOnView {
            try {
                bridge.call(ProtocolContract.Method.UPDATE_LOCATION, payload)
            } catch (_: TileflowMapException) {
                // A new renderer receives the latest values when it starts.
            } finally {
                sending = false
            }
            flush()
        }
    }

    fun payload(includeLocation: Boolean, includeHeading: Boolean): JSONObject? {
        val payload = JSONObject()
        if (includeLocation) latest?.let { payload.put("location", wire(it)) }
        if (includeHeading)
            heading?.let {
                payload.put("heading", JSONObject().put("direction", normalized(it.direction)))
            }
        return if (payload.length() == 0) null else payload
    }

    companion object {
        fun normalized(degrees: Double): Double = ((degrees % 360) + 360) % 360

        /**
         * A position as the renderer takes it: its age is measured now, so a replay ages correctly.
         */
        fun wire(location: TileflowLocation, now: Long = System.currentTimeMillis()): JSONObject {
            val fix =
                JSONObject()
                    .put("longitude", location.coordinate.longitude)
                    .put("latitude", location.coordinate.latitude)
                    .put("age", (now - location.timestamp).coerceIn(0, 86_400_000))
            location.horizontalAccuracy?.let { fix.put("accuracy", it.coerceAtMost(1_000_000.0)) }
            location.course?.takeIf { it.isFinite() }?.let { fix.put("course", normalized(it)) }
            return fix
        }
    }
}

/**
 * Starts or stops taking positions from the provider: only while the location is shown and the map
 * is visible, so a hidden map never keeps the location measured.
 */
internal fun TileflowMapView.refreshLocation() {
    location.consume(
        if (!isDestroyed && options.location.enabled && isVisibleOnScreen) location.provider else null
    )
}

/** The location options changed: turning the location off ends following. */
internal fun TileflowMapView.locationOptionsChanged(previous: TileflowMapOptions) {
    if (previous.location.enabled && !options.location.enabled)
        endFollowing(TileflowFollowModeChangeReason.API)
    refreshLocation()
}

/** Ends following because a person or the application moved the camera, reporting the change. */
internal fun TileflowMapView.endFollowing(reason: TileflowFollowModeChangeReason) {
    val change = location.follow.end(reason) ?: return
    // The renderer may not know yet, for example when the location was turned off.
    sendFollowMode(entering = false, durationMillis = 0)
    onEvent(TileflowMapEvent.FollowModeChanged(change))
}

internal fun TileflowMapView.setFollowModeFromApplication(mode: TileflowFollowMode) {
    if (isDestroyed) return
    val entering = location.follow.mode == TileflowFollowMode.NONE
    if (location.follow.set(mode)) sendFollowMode(entering, 1000)
}

/** The recenter button follows the location while the map shows it. */
internal fun TileflowMapView.recenterTapped() {
    if (!options.location.enabled) {
        onEvent(TileflowMapEvent.RecenterRequested)
        return
    }
    val entering = location.follow.mode == TileflowFollowMode.NONE
    val change = location.follow.recenter()
    sendFollowMode(entering, if (entering) 1000 else 500)
    onEvent(TileflowMapEvent.FollowModeChanged(change))
}

/** The compass turns the map to north. While following, it keeps following the position. */
internal fun TileflowMapView.compassTapped(): Boolean {
    if (!options.location.enabled || location.follow.mode == TileflowFollowMode.NONE) return false
    val change = location.follow.compass()
    sendFollowMode(entering = false, durationMillis = 300, bearing = 0.0)
    change?.let { onEvent(TileflowMapEvent.FollowModeChanged(it)) }
    return true
}

internal fun TileflowMapView.receiveFollowModeChanged(value: JSONObject) {
    val reason = TileflowFollowModeChangeReason.fromWire(value.optString("reason")) ?: return
    // The renderer ended the request the view sent last; a later request is still in force.
    if (!value.has("revision") || value.optInt("revision", -1) != location.revision) return
    endFollowing(reason)
}

/** Gives a new renderer the latest position, heading and follow mode. */
internal suspend fun TileflowMapView.replayLocation(bridge: MapBridge) {
    location.payload(includeLocation = true, includeHeading = true)?.let {
        bridge.call(ProtocolContract.Method.UPDATE_LOCATION, it)
    }
    if (location.follow.mode != TileflowFollowMode.NONE) {
        // A mode set before the first renderer still zooms in as it starts to follow.
        val entering = location.pendingEntry
        location.pendingEntry = false
        bridge.call(
            ProtocolContract.Method.SET_FOLLOW_MODE,
            followPayload(entering, if (entering) 1000 else 0),
        )
    }
}

private fun TileflowMapView.sendFollowMode(
    entering: Boolean,
    durationMillis: Long,
    bearing: Double? = null,
) {
    location.revision += 1
    controlsView.followMode = location.follow.mode
    val bridge = readyBridge
    if (bridge == null) {
        location.pendingEntry =
            location.follow.mode != TileflowFollowMode.NONE && (entering || location.pendingEntry)
        return
    }
    val payload = followPayload(entering, durationMillis, bearing)
    launchOnView {
        try {
            bridge.call(ProtocolContract.Method.SET_FOLLOW_MODE, payload)
        } catch (_: TileflowMapException) {
            // A new renderer receives the follow mode when it starts.
        }
    }
}

private fun TileflowMapView.followPayload(
    entering: Boolean,
    durationMillis: Long,
    bearing: Double? = null,
): JSONObject {
    val payload =
        JSONObject()
            .put("mode", location.follow.mode.wireName)
            .put("duration", durationMillis)
            .put("revision", location.revision)
    if (entering) options.location.followZoom?.let { payload.put("minimumZoom", it) }
    bearing?.let { payload.put("bearing", it) }
    return payload
}
