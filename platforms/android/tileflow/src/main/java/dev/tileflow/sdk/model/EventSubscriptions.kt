package dev.tileflow.sdk.model

import dev.tileflow.sdk.TileflowEventOptions
import dev.tileflow.sdk.model.MapContract
import org.json.JSONObject

/**
 * The events the renderer sends: the union of what each owner asks for. An event shared by several
 * owners takes the shortest interval any of them asks for. Events nobody asks for never leave the
 * renderer.
 */
internal class EventSubscriptions(
    application: TileflowEventOptions = TileflowEventOptions(),
    followCamera: Boolean = false,
) {
    /** Parts of the SDK that ask for events. The application's choice is one owner among them. */
    enum class Owner {
        APPLICATION,
        /** The camera state follows every movement, so `isMoving` is current at any level. */
        CAMERA,
        /** The compass and scale bar follow the camera while it moves. */
        CONTROLS,
        /** Annotations follow taps, long presses and drags, and views follow tracked points. */
        ANNOTATIONS,
    }

    private val demands = mutableMapOf<Owner, Map<MapContract.Event, Long>>()

    init {
        set(Owner.APPLICATION, demand(application))
        set(
            Owner.CAMERA,
            mapOf(
                MapContract.Event.CAMERA_MOVE_STARTED to 0L,
                MapContract.Event.CAMERA_MOVE_ENDED to 0L,
                // The follow mode ends when a person moves the map, whatever the level.
                MapContract.Event.FOLLOW_MODE_CHANGED to 0L,
            ),
        )
        set(
            Owner.CONTROLS,
            if (followCamera) mapOf(MapContract.Event.CAMERA_MOVED to 0L) else emptyMap(),
        )
    }

    fun set(owner: Owner, demand: Map<MapContract.Event, Long>) {
        demands[owner] = demand.filterKeys { it.level != null }
    }

    val events: Map<MapContract.Event, Long>
        get() =
            demands.values.fold(mutableMapOf()) { union, demand ->
                demand.forEach { (event, throttle) ->
                    union[event] = minOf(union[event] ?: throttle, throttle)
                }
                union
            }

    override fun equals(other: Any?): Boolean =
        other is EventSubscriptions && other.events == events

    override fun hashCode(): Int = events.hashCode()

    fun json(): JSONObject =
        JSONObject().apply {
            events.forEach { (event, throttle) ->
                put(event.wireName, JSONObject().put("throttleMs", throttle))
            }
        }

    companion object {
        /** Every event up to the chosen level; camera updates take the chosen interval. */
        fun demand(options: TileflowEventOptions): Map<MapContract.Event, Long> =
            MapContract.Event.entries
                .filter { event -> event.level?.let(options.level::includes) == true }
                .associateWith { event ->
                    if (event == MapContract.Event.CAMERA_MOVED)
                        options.cameraUpdateIntervalMillis
                    else 0L
                }
    }
}
