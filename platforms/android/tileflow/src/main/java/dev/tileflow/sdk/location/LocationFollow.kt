package dev.tileflow.sdk.location

import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import org.json.JSONObject

/** How the camera follows the person's location. */
public enum class TileflowFollowMode {
    /** The camera does not follow. */
    NONE,
    /** The camera keeps the location at the centre of the content padding. */
    POSITION,
    /** The camera also turns with the device, so the map ahead is up. */
    HEADING,
    /** The camera also turns with the direction of travel, so the way ahead is up. */
    COURSE;

    internal val wireName: String
        get() = name.lowercase()
}

/** Why the follow mode changed without the application setting it. */
public enum class TileflowFollowModeChangeReason {
    /** A person moved the map, or tapped the compass or the recenter button. */
    GESTURE,
    /** The application moved the camera or turned the location off. */
    API;

    internal companion object {
        fun fromWire(value: String?): TileflowFollowModeChangeReason? =
            entries.firstOrNull { it.name.lowercase() == value }
    }
}

public data class TileflowFollowModeChange(
    val mode: TileflowFollowMode,
    val reason: TileflowFollowModeChangeReason,
)

/** What the puck's direction indicator shows. */
public enum class TileflowPuckBearing {
    /** No direction indicator. */
    NONE,
    /** The direction the device points. */
    HEADING,
    /** The direction of travel, once the device moves. */
    COURSE,
}

/**
 * How the map shows the person's location.
 *
 * The renderer draws the location as a puck with a circle of its accuracy, an optional direction
 * indicator, and a grey dot once the latest position is older than [staleAfterMillis]. Showing the
 * location starts the map's location provider while the map is visible; the provider measures only
 * when the application has access (see [TileflowLocationPermissions]).
 *
 * @property enabled Shows the location and follows it when a follow mode is set.
 * @property showsAccuracy Draws a circle of the position's accuracy around the puck.
 * @property staleAfterMillis How old the latest position may be before the puck turns grey, from 1
 *   second to 1 hour.
 * @property followZoom The camera zooms in to at least this level when it starts to follow; null
 *   keeps the zoom.
 */
public data class TileflowLocationOptions(
    val enabled: Boolean = false,
    val puckBearing: TileflowPuckBearing = TileflowPuckBearing.NONE,
    val showsAccuracy: Boolean = true,
    val staleAfterMillis: Long = 30_000,
    val followZoom: Double? = 15.0,
) {
    internal fun json(): JSONObject {
        if (
            staleAfterMillis !in 1_000..3_600_000 ||
                (followZoom != null && followZoom !in 0.0..24.0)
        )
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        return JSONObject()
            .put("enabled", enabled)
            .put("bearing", puckBearing.name.lowercase())
            .put("accuracy", showsAccuracy)
            .put("staleAfterMs", staleAfterMillis)
    }
}

/** The follow mode, and what each person's or application's action does to it. */
internal class FollowModeState {
    var mode: TileflowFollowMode = TileflowFollowMode.NONE
        private set

    /** The mode the recenter button returns to. */
    var lastFollowing: TileflowFollowMode = TileflowFollowMode.POSITION
        private set

    /** The application sets a mode. Returns whether it changed. */
    fun set(next: TileflowFollowMode): Boolean {
        if (next == mode) return false
        mode = next
        if (next != TileflowFollowMode.NONE) lastFollowing = next
        return true
    }

    /** A person moved the map, or the application moved the camera or turned the location off. */
    fun end(reason: TileflowFollowModeChangeReason): TileflowFollowModeChange? {
        if (mode == TileflowFollowMode.NONE) return null
        mode = TileflowFollowMode.NONE
        return TileflowFollowModeChange(TileflowFollowMode.NONE, reason)
    }

    /**
     * The recenter button: follows again, and turns between following the position and the
     * heading, as the platforms' own location buttons do.
     */
    fun recenter(): TileflowFollowModeChange {
        val next =
            when (mode) {
                TileflowFollowMode.NONE -> lastFollowing
                TileflowFollowMode.POSITION -> TileflowFollowMode.HEADING
                TileflowFollowMode.HEADING,
                TileflowFollowMode.COURSE -> TileflowFollowMode.POSITION
            }
        set(next)
        return TileflowFollowModeChange(next, TileflowFollowModeChangeReason.GESTURE)
    }

    /**
     * The compass turns the map to north: the heading and course modes become the position mode.
     */
    fun compass(): TileflowFollowModeChange? {
        if (mode != TileflowFollowMode.HEADING && mode != TileflowFollowMode.COURSE) return null
        set(TileflowFollowMode.POSITION)
        return TileflowFollowModeChange(
            TileflowFollowMode.POSITION,
            TileflowFollowModeChangeReason.GESTURE,
        )
    }
}
