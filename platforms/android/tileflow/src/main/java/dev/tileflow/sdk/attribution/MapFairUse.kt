package dev.tileflow.sdk.attribution

import java.net.URI

/** World's fair-use notice, as the web adapters show it. */
internal data class MapFairUseNotice(val state: State) {
    enum class State {
        /** The site approaches its temporary limit. */
        GRACE,
        /** The site reached it; its owner should manage the map with Tileflow. */
        MANAGED_REQUIRED,
        /** Tileflow temporarily limits anonymous World delivery for everyone. */
        LIMITED,
    }

    val message: String =
        when (state) {
            State.LIMITED -> "Some map areas are temporarily unavailable."
            State.MANAGED_REQUIRED -> "Map usage is temporarily limited."
            State.GRACE -> "Map usage is approaching its temporary limit."
        }
    val action: String = "Site owner: manage this map with Tileflow."
    val help: String = HELP_PAGE

    companion object {
        /**
         * The page World's responses name with `Link: <…>; rel="help"`, which the SDK's transport
         * does not keep; the notice links to the same page the web adapters fall back to.
         */
        const val HELP_PAGE: String = "https://tileflow.dev/world/connect"
    }
}

/** What one World tile response says about fair use. It holds no address. */
internal data class MapFairUseSignal(
    val status: Int,
    /** `Tileflow-Fair-Use`: `open`, `grace` or `managed-required`. */
    val fairUse: String?,
    /** `Tileflow-Fair-Use-Notice: owner`. */
    val ownerNotice: Boolean = false,
    /** `Tileflow-Protection`. */
    val protection: String? = null,
) {
    companion object {
        private val path =
            Regex(
                "^/tiles/world/(world-v1-[a-z0-9][a-z0-9._-]*[a-z0-9])/" +
                    "(?:0|[1-9][0-9]*)/(?:0|[1-9][0-9]*)/(?:0|[1-9][0-9]*)\\.pbf$"
            )
        private val digest = Regex("^[0-9a-f]{64}$")
        private val allowed =
            setOf(
                "grant",
                "map",
                "renderExpires",
                "renderSignature",
                "session",
                "styleId",
                "worldDescriptorSha256",
            )

        /** The signal of a response to a canonical World tile address, or null for any other. */
        fun of(remote: URI, status: Int, headers: Map<String, String>): MapFairUseSignal? {
            if (!isWorldTile(remote)) return null
            fun header(name: String) =
                headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }?.value
            return MapFairUseSignal(
                status,
                header("Tileflow-Fair-Use"),
                header("Tileflow-Fair-Use-Notice") == "owner",
                header("Tileflow-Protection"),
            )
        }

        /**
         * A World tile at Tileflow, as the web adapters recognise one: `https`, a `tileflow.dev`
         * host, `/tiles/world/<release>/<z>/<x>/<y>.pbf` and only the query keys World tiles carry,
         * with one descriptor digest.
         */
        fun isWorldTile(url: URI): Boolean {
            val host = url.host?.lowercase() ?: return false
            if (
                url.scheme != "https" ||
                    !(host == "tileflow.dev" || host.endsWith(".tileflow.dev")) ||
                    url.port != -1 ||
                    url.rawUserInfo != null ||
                    url.rawFragment != null
            )
                return false
            val release = path.matchEntire(url.rawPath ?: "")?.groupValues?.get(1) ?: return false
            if (release.length !in 12..128) return false
            val items =
                url.rawQuery?.split('&')?.filter { it.isNotEmpty() }?.map {
                    val equals = it.indexOf('=')
                    if (equals < 0) it to "" else it.substring(0, equals) to it.substring(equals + 1)
                } ?: emptyList()
            if (items.any { it.first !in allowed }) return false
            val digests = items.filter { it.first == "worldDescriptorSha256" }
            return digests.size == 1 && digest.matches(digests[0].second)
        }
    }
}

/**
 * The fair-use notice of one map, from its World tile responses in the order they arrive, with the
 * rules the web adapters follow: a degradation (503 with `Tileflow-Protection`) holds the limited
 * notice for a minute so cached tiles do not make it flicker; `managed-required` outranks `grace`;
 * an `open` success clears the notice.
 */
internal class MapFairUseState {
    var notice: MapFairUseNotice? = null
        private set

    private var limitedUntil = Long.MIN_VALUE

    /** Reads a response at [now], in milliseconds; true when the notice changed. */
    fun receive(signal: MapFairUseSignal, now: Long = System.currentTimeMillis()): Boolean {
        val before = notice
        val ok = signal.status in 200..299
        val state = notice?.state
        if (
            signal.status == 503 &&
                (signal.protection == "protected" || signal.protection == "cached-only")
        ) {
            limitedUntil = now + LIMITED_HOLD_MS
            if (
                state != MapFairUseNotice.State.MANAGED_REQUIRED &&
                    state != MapFairUseNotice.State.LIMITED
            )
                notice = MapFairUseNotice(MapFairUseNotice.State.LIMITED)
        }
        val current = notice?.state
        val limitedHeld = current == MapFairUseNotice.State.LIMITED && now < limitedUntil
        val managed = current == MapFairUseNotice.State.MANAGED_REQUIRED
        when {
            signal.fairUse == "open" -> if (ok && !limitedHeld) notice = null
            signal.fairUse == "managed-required" ->
                notice = MapFairUseNotice(MapFairUseNotice.State.MANAGED_REQUIRED)
            signal.fairUse == "grace" && (signal.ownerNotice || signal.status == 429) ->
                if (!managed && !limitedHeld)
                    notice = MapFairUseNotice(MapFairUseNotice.State.GRACE)
            signal.fairUse == "grace" && ok -> if (!managed && !limitedHeld) notice = null
        }
        return notice != before
    }

    companion object {
        const val LIMITED_HOLD_MS: Long = 60_000
    }
}
