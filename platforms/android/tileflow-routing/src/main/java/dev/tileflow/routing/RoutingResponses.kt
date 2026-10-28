package dev.tileflow.routing

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition

/** What a step asks the traveller to do. Maneuvers added later decode as their own values. */
@JvmInline
public value class TileflowManeuver(public val value: String) {
    override fun toString(): String = value

    public companion object {
        public val DEPART: TileflowManeuver = TileflowManeuver("depart")
        public val ARRIVE: TileflowManeuver = TileflowManeuver("arrive")
        public val CONTINUE: TileflowManeuver = TileflowManeuver("continue")
        public val SLIGHT_RIGHT: TileflowManeuver = TileflowManeuver("slight-right")
        public val RIGHT: TileflowManeuver = TileflowManeuver("right")
        public val SHARP_RIGHT: TileflowManeuver = TileflowManeuver("sharp-right")
        public val U_TURN: TileflowManeuver = TileflowManeuver("u-turn")
        public val SHARP_LEFT: TileflowManeuver = TileflowManeuver("sharp-left")
        public val LEFT: TileflowManeuver = TileflowManeuver("left")
        public val SLIGHT_LEFT: TileflowManeuver = TileflowManeuver("slight-left")
        public val RAMP_STRAIGHT: TileflowManeuver = TileflowManeuver("ramp-straight")
        public val RAMP_RIGHT: TileflowManeuver = TileflowManeuver("ramp-right")
        public val RAMP_LEFT: TileflowManeuver = TileflowManeuver("ramp-left")
        public val EXIT_RIGHT: TileflowManeuver = TileflowManeuver("exit-right")
        public val EXIT_LEFT: TileflowManeuver = TileflowManeuver("exit-left")
        public val KEEP_STRAIGHT: TileflowManeuver = TileflowManeuver("keep-straight")
        public val KEEP_RIGHT: TileflowManeuver = TileflowManeuver("keep-right")
        public val KEEP_LEFT: TileflowManeuver = TileflowManeuver("keep-left")
        public val MERGE: TileflowManeuver = TileflowManeuver("merge")
        public val MERGE_RIGHT: TileflowManeuver = TileflowManeuver("merge-right")
        public val MERGE_LEFT: TileflowManeuver = TileflowManeuver("merge-left")
        public val ROUNDABOUT_ENTER: TileflowManeuver = TileflowManeuver("roundabout-enter")
        public val ROUNDABOUT_EXIT: TileflowManeuver = TileflowManeuver("roundabout-exit")
        public val FERRY_ENTER: TileflowManeuver = TileflowManeuver("ferry-enter")
        public val FERRY_EXIT: TileflowManeuver = TileflowManeuver("ferry-exit")
        public val ELEVATOR: TileflowManeuver = TileflowManeuver("elevator")
        public val STAIRS: TileflowManeuver = TileflowManeuver("stairs")
        public val ESCALATOR: TileflowManeuver = TileflowManeuver("escalator")
        public val BUILDING_ENTER: TileflowManeuver = TileflowManeuver("building-enter")
        public val BUILDING_EXIT: TileflowManeuver = TileflowManeuver("building-exit")
    }
}

/** A road class, from the most to the least important. Classes added later decode as values. */
@JvmInline
public value class TileflowRoadClass(public val value: String) {
    override fun toString(): String = value

    public companion object {
        public val MOTORWAY: TileflowRoadClass = TileflowRoadClass("motorway")
        public val TRUNK: TileflowRoadClass = TileflowRoadClass("trunk")
        public val PRIMARY: TileflowRoadClass = TileflowRoadClass("primary")
        public val SECONDARY: TileflowRoadClass = TileflowRoadClass("secondary")
        public val TERTIARY: TileflowRoadClass = TileflowRoadClass("tertiary")
        public val UNCLASSIFIED: TileflowRoadClass = TileflowRoadClass("unclassified")
        public val RESIDENTIAL: TileflowRoadClass = TileflowRoadClass("residential")
        public val SERVICE: TileflowRoadClass = TileflowRoadClass("service")
    }
}

/** A road surface. Surfaces added later decode as their own values. */
@JvmInline
public value class TileflowRoadSurface(public val value: String) {
    override fun toString(): String = value

    public companion object {
        public val PAVED_SMOOTH: TileflowRoadSurface = TileflowRoadSurface("paved-smooth")
        public val PAVED: TileflowRoadSurface = TileflowRoadSurface("paved")
        public val PAVED_ROUGH: TileflowRoadSurface = TileflowRoadSurface("paved-rough")
        public val COMPACTED: TileflowRoadSurface = TileflowRoadSurface("compacted")
        public val DIRT: TileflowRoadSurface = TileflowRoadSurface("dirt")
        public val GRAVEL: TileflowRoadSurface = TileflowRoadSurface("gravel")
        public val PATH: TileflowRoadSurface = TileflowRoadSurface("path")
        public val IMPASSABLE: TileflowRoadSurface = TileflowRoadSurface("impassable")
    }
}

/** The traffic an answer used. Kinds added later decode as their own values. */
@JvmInline
public value class TileflowRoutingTrafficKind(public val value: String) {
    override fun toString(): String = value

    public companion object {
        /** Durations estimated without traffic. */
        public val NONE: TileflowRoutingTrafficKind = TileflowRoutingTrafficKind("none")
    }
}

/** The road network release that answered. */
public data class TileflowRoutingNetwork(public val releaseId: String)

/**
 * One step of a leg. Distances are metres and durations seconds.
 *
 * @property names Street names and road numbers the step follows.
 * @property exit The number of a highway exit.
 * @property toward Destinations signed at a highway exit or ramp.
 * @property roundaboutExit The exit to take at a roundabout, counted from the entry.
 */
public data class TileflowRouteStep(
    public val maneuver: TileflowManeuver,
    public val instruction: String,
    public val names: List<String> = emptyList(),
    public val exit: String? = null,
    public val toward: List<String> = emptyList(),
    public val roundaboutExit: Int? = null,
    public val distance: Double,
    public val duration: Double,
    public val location: TileflowPosition,
)

/** The part of a route between two consecutive locations. */
public data class TileflowRouteLeg(
    public val distance: Double,
    public val duration: Double,
    public val steps: List<TileflowRouteStep>,
)

/**
 * A route: its line, length in metres, duration in seconds and one leg between each pair of
 * consecutive locations.
 */
public data class TileflowRoute(
    public val distance: Double,
    public val duration: Double,
    public val hasTolls: Boolean,
    public val hasHighways: Boolean,
    public val hasFerries: Boolean,
    public val geometry: List<TileflowPosition>,
    public val legs: List<TileflowRouteLeg>,
) {
    /** The box around [geometry]. */
    public val bounds: TileflowBoundingBox
        get() =
            TileflowBoundingBox(
                geometry.minOf { it.longitude },
                geometry.minOf { it.latitude },
                geometry.maxOf { it.longitude },
                geometry.maxOf { it.latitude },
            )
}

/**
 * A route answer: the fastest route first, then its alternatives.
 *
 * @property attribution The credit to show with the routes.
 * @property units The API units the operation consumed.
 */
public data class TileflowRouteResponse(
    public val routes: List<TileflowRoute>,
    public val network: TileflowRoutingNetwork,
    public val attribution: String,
    public val traffic: TileflowRoutingTrafficKind,
    public val units: Int,
)

/** The area reachable within [minutes]: one or more polygons, each a list of closed rings. */
public data class TileflowIsochrone(
    public val minutes: Int,
    public val polygons: List<List<List<TileflowPosition>>>,
)

/** One isochrone per requested time, in request order. */
public data class TileflowIsochroneResponse(
    public val isochrones: List<TileflowIsochrone>,
    public val network: TileflowRoutingNetwork,
    public val attribution: String,
    public val traffic: TileflowRoutingTrafficKind,
    public val units: Int,
)

/**
 * Seconds and metres from each source (rows) to each target (columns), in request order, null
 * where no route was found.
 */
public data class TileflowMatrixResponse(
    public val durations: List<List<Double?>>,
    public val distances: List<List<Double?>>,
    public val network: TileflowRoutingNetwork,
    public val attribution: String,
    public val traffic: TileflowRoutingTrafficKind,
    public val units: Int,
)

/** Where a trace position was matched and how far it was from there, in metres. */
public data class TileflowMatchedPoint(
    public val location: TileflowPosition,
    public val distance: Double,
)

/** A tagged speed limit. */
public data class TileflowSpeedLimit(public val kmh: Int, public val source: String)

/**
 * A road and what OpenStreetMap records about it.
 *
 * @property wayId The OpenStreetMap way the road belongs to.
 * @property speedLimit The speed limit as tagged, or null where none is recorded.
 * @property length Metres.
 */
public data class TileflowRoad(
    public val names: List<String>,
    public val wayId: Long? = null,
    public val roadClass: TileflowRoadClass,
    public val surface: TileflowRoadSurface? = null,
    public val lanes: Int? = null,
    public val speedLimit: TileflowSpeedLimit? = null,
    public val toll: Boolean,
    public val bridge: Boolean,
    public val tunnel: Boolean,
    public val roundabout: Boolean,
    public val length: Double,
)

/**
 * The roads a trace followed.
 *
 * @property points One entry per trace position: where it was matched, or null.
 * @property roads The roads of the matched line, in order.
 */
public data class TileflowMatchResponse(
    public val distance: Double,
    public val duration: Double,
    public val geometry: List<TileflowPosition>,
    public val points: List<TileflowMatchedPoint?>,
    public val roads: List<TileflowRoad>,
    public val network: TileflowRoutingNetwork,
    public val attribution: String,
    public val traffic: TileflowRoutingTrafficKind,
    public val units: Int,
)

/** The point of the nearest road and its distance from the request, in metres. */
public data class TileflowNearestResponse(
    public val location: TileflowPosition,
    public val distance: Double,
    public val road: TileflowRoad,
    public val network: TileflowRoutingNetwork,
    public val attribution: String,
    public val traffic: TileflowRoutingTrafficKind,
    public val units: Int,
)
