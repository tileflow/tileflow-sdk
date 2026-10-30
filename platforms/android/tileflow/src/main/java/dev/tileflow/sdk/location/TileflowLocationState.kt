package dev.tileflow.sdk.location

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue

/**
 * The location of a Compose map, hoisted so the application can read the latest position and read
 * and write the follow mode.
 *
 * The map writes [followMode] when it changes without the application: a person moves the map or
 * taps the compass or the recenter button, or the application moves the camera. Writing a different
 * mode changes how the map follows; the map's own writes never change it again. Remember it with
 * [rememberTileflowLocationState] to keep the mode across configuration changes and process
 * recreation.
 */
@Stable
public class TileflowLocationState(
    initialFollowMode: TileflowFollowMode = TileflowFollowMode.NONE
) {
    /** How the camera follows the location. */
    public var followMode: TileflowFollowMode by mutableStateOf(initialFollowMode)

    /** The latest position the map received, or null before the first. */
    public var location: TileflowLocation? by mutableStateOf(null)
        private set

    /** The mode the map and this state last agreed on. */
    internal var synced: TileflowFollowMode = initialFollowMode

    /** A change the map made, which must not change the map again. */
    internal fun record(change: TileflowFollowModeChange) {
        synced = change.mode
        followMode = change.mode
    }

    internal fun received(next: TileflowLocation) {
        location = next
    }

    public companion object {
        /** Saves the follow mode, so it survives configuration changes and process recreation. */
        public val Saver: Saver<TileflowLocationState, String> =
            Saver(
                save = { it.followMode.name },
                restore = { saved ->
                    TileflowLocationState(
                        TileflowFollowMode.entries.firstOrNull { it.name == saved }
                            ?: TileflowFollowMode.NONE
                    )
                },
            )
    }
}

/**
 * A [TileflowLocationState] that keeps its follow mode across configuration changes and process
 * recreation.
 */
@Composable
public fun rememberTileflowLocationState(
    initialFollowMode: TileflowFollowMode = TileflowFollowMode.NONE
): TileflowLocationState =
    rememberSaveable(saver = TileflowLocationState.Saver) {
        TileflowLocationState(initialFollowMode)
    }
