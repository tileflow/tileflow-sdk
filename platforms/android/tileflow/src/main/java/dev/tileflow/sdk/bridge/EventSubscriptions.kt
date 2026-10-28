package dev.tileflow.sdk.bridge

import dev.tileflow.sdk.TileflowEventOptions
import org.json.JSONObject

/**
 * The events the renderer sends: the union of what each owner asks for. An event shared by several
 * owners takes the shortest interval any of them asks for. Events nobody asks for never leave the
 * renderer.
 */
internal class EventSubscriptions(application: TileflowEventOptions = TileflowEventOptions()) {
    /** Parts of the SDK that ask for events. The application's choice is one owner among them. */
    enum class Owner {
        APPLICATION
    }

    private val demands = mutableMapOf<Owner, Map<ProtocolContract.Event, Long>>()

    init {
        set(Owner.APPLICATION, demand(application))
    }

    fun set(owner: Owner, demand: Map<ProtocolContract.Event, Long>) {
        demands[owner] = demand.filterKeys { it.level != null }
    }

    val events: Map<ProtocolContract.Event, Long>
        get() =
            demands.values.fold(mutableMapOf()) { union, demand ->
                demand.forEach { (event, throttle) ->
                    union[event] = minOf(union[event] ?: throttle, throttle)
                }
                union
            }

    fun json(): JSONObject =
        JSONObject().apply {
            events.forEach { (event, throttle) ->
                put(event.wireName, JSONObject().put("throttleMs", throttle))
            }
        }

    companion object {
        /** Every event up to the chosen level; camera updates take the chosen interval. */
        fun demand(options: TileflowEventOptions): Map<ProtocolContract.Event, Long> =
            ProtocolContract.Event.entries
                .filter { event -> event.level?.let(options.level::includes) == true }
                .associateWith { event ->
                    if (event == ProtocolContract.Event.CAMERA_MOVED)
                        options.cameraUpdateIntervalMillis
                    else 0L
                }
    }
}
