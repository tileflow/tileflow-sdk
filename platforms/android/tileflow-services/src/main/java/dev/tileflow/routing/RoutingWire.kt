package dev.tileflow.routing

import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.internal.TileflowGeo
import dev.tileflow.configuration.internal.TileflowJson
import dev.tileflow.configuration.internal.TileflowJsonArray
import dev.tileflow.configuration.internal.TileflowJsonObject
import dev.tileflow.configuration.internal.invalidResponse
import dev.tileflow.configuration.internal.requireRequest
import dev.tileflow.configuration.internal.requireResponse
import org.json.JSONArray
import org.json.JSONObject

/** Validates Routing requests and encodes them as the API expects. */
internal object RoutingWire {
    private fun maximumDistance(mode: TileflowRoutingMode): Double =
        when (mode) {
            TileflowRoutingMode.DRIVING,
            TileflowRoutingMode.TRUCK -> 1_000_000.0
            TileflowRoutingMode.WALKING -> 100_000.0
            TileflowRoutingMode.CYCLING -> 300_000.0
        }

    private fun maximumMatrixDistance(mode: TileflowRoutingMode): Double =
        when (mode) {
            TileflowRoutingMode.DRIVING,
            TileflowRoutingMode.TRUCK -> 200_000.0
            TileflowRoutingMode.WALKING,
            TileflowRoutingMode.CYCLING -> 10_000.0
        }

    fun route(request: TileflowRouteRequest): JSONObject {
        positions(request.locations, 2..5, "locations")
        travel(request.mode, request.vehicle, request.avoid)
        requireRequest(request.alternatives in 0..2) { "Ask for 0 to 2 alternatives." }
        requireRequest(request.alternatives == 0 || request.locations.size == 2) {
            "Alternatives are available only between two locations."
        }
        requireRequest(
            request.locations.zipWithNext(TileflowGeo::distanceMeters).sum() <=
                maximumDistance(request.mode)
        ) {
            "The locations are too far apart for ${request.mode.wireName}."
        }
        return JSONObject()
            .put("locations", TileflowJson.positions(request.locations))
            .put("mode", request.mode.wireName)
            .putOpt("vehicle", request.vehicle?.let(::vehicle))
            .putOpt("avoid", avoid(request.avoid))
            .putOpt("traffic", request.traffic?.wireName)
            .putOpt("alternatives", request.alternatives.takeIf { it > 0 })
            .putOpt("language", request.language?.wireName)
    }

    fun isochrone(request: TileflowIsochroneRequest): JSONObject {
        position(request.location)
        travel(request.mode, request.vehicle, request.avoid)
        requireRequest(
            request.minutes.size in 1..4 &&
                request.minutes.all { it in 1..60 } &&
                request.minutes.zipWithNext().all { (a, b) -> b > a }
        ) {
            "Give 1 to 4 times of 1 to 60 minutes, strictly rising."
        }
        return JSONObject()
            .put("location", TileflowJson.position(request.location))
            .put("mode", request.mode.wireName)
            .put("minutes", JSONArray().also { array -> request.minutes.forEach(array::put) })
            .putOpt("vehicle", request.vehicle?.let(::vehicle))
            .putOpt("avoid", avoid(request.avoid))
            .putOpt("traffic", request.traffic?.wireName)
    }

    fun matrix(request: TileflowMatrixRequest): JSONObject {
        positions(request.sources, 1..25, "sources")
        positions(request.targets, 1..25, "targets")
        travel(request.mode, request.vehicle, request.avoid)
        val limit = maximumMatrixDistance(request.mode)
        requireRequest(
            request.sources.all { source ->
                request.targets.all { TileflowGeo.distanceMeters(source, it) <= limit }
            }
        ) {
            "A source and a target are too far apart for ${request.mode.wireName}."
        }
        return JSONObject()
            .put("sources", TileflowJson.positions(request.sources))
            .put("targets", TileflowJson.positions(request.targets))
            .put("mode", request.mode.wireName)
            .putOpt("vehicle", request.vehicle?.let(::vehicle))
            .putOpt("avoid", avoid(request.avoid))
            .putOpt("traffic", request.traffic?.wireName)
    }

    fun match(request: TileflowMatchRequest): JSONObject {
        positions(request.trace, 2..100, "trace")
        travel(request.mode, request.vehicle, emptyList())
        request.timestamps?.let { timestamps ->
            requireRequest(timestamps.size == request.trace.size) {
                "Give one timestamp per trace position."
            }
            requireRequest(
                timestamps.all { it in 0..4_102_444_800 } &&
                    timestamps.zipWithNext().all { (a, b) -> b >= a }
            ) {
                "Timestamps are seconds since the Unix epoch and never go back."
            }
        }
        request.accuracy?.let {
            requireRequest(it.isFinite() && it in 1.0..100.0) {
                "The accuracy must be 1 to 100 metres."
            }
        }
        val gaps = request.trace.zipWithNext(TileflowGeo::distanceMeters)
        requireRequest(gaps.all { it <= 2_000 }) {
            "Consecutive trace positions are more than 2 km apart."
        }
        requireRequest(gaps.sum() <= 200_000) { "The trace is longer than 200 km." }
        return JSONObject()
            .put("trace", TileflowJson.positions(request.trace))
            .putOpt(
                "timestamps",
                request.timestamps?.let { JSONArray().also { array -> it.forEach(array::put) } },
            )
            .putOpt("accuracy", request.accuracy)
            .put("mode", request.mode.wireName)
            .putOpt("vehicle", request.vehicle?.let(::vehicle))
    }

    fun nearest(request: TileflowNearestRequest): JSONObject {
        position(request.location)
        return JSONObject()
            .put("location", TileflowJson.position(request.location))
            .put("mode", request.mode.wireName)
    }

    private fun position(position: TileflowPosition) {
        requireRequest(TileflowGeo.isValid(position)) {
            "Positions need a longitude within ±180 and a latitude within ±90."
        }
    }

    private fun positions(positions: List<TileflowPosition>, count: IntRange, name: String) {
        requireRequest(positions.size in count) {
            "Give ${count.first} to ${count.last} $name."
        }
        positions.forEach(::position)
    }

    private fun travel(
        mode: TileflowRoutingMode,
        vehicle: TileflowVehicle?,
        avoid: List<TileflowRoutingAvoidance>,
    ) {
        requireRequest(vehicle == null || mode == TileflowRoutingMode.TRUCK) {
            "Vehicle dimensions apply only to trucks."
        }
        requireRequest(avoid.toSet().size == avoid.size) { "Avoid each kind once." }
        if (vehicle == null) return
        fun within(value: Double?, range: ClosedFloatingPointRange<Double>) =
            value == null || (value.isFinite() && value in range)
        requireRequest(
            within(vehicle.heightMeters, 1.0..10.0) &&
                within(vehicle.widthMeters, 1.0..5.0) &&
                within(vehicle.lengthMeters, 1.0..40.0) &&
                within(vehicle.weightTonnes, 0.5..100.0) &&
                within(vehicle.axleLoadTonnes, 0.5..40.0) &&
                (vehicle.axleCount == null || vehicle.axleCount in 2..20)
        ) {
            "A vehicle dimension is outside its range."
        }
    }

    private fun vehicle(vehicle: TileflowVehicle): JSONObject =
        JSONObject()
            .putOpt("heightMeters", vehicle.heightMeters)
            .putOpt("widthMeters", vehicle.widthMeters)
            .putOpt("lengthMeters", vehicle.lengthMeters)
            .putOpt("weightTonnes", vehicle.weightTonnes)
            .putOpt("axleLoadTonnes", vehicle.axleLoadTonnes)
            .putOpt("axleCount", vehicle.axleCount)
            .putOpt("hazardousMaterials", vehicle.hazardousMaterials)

    private fun avoid(avoid: List<TileflowRoutingAvoidance>): JSONArray? =
        avoid.takeIf { it.isNotEmpty() }?.let { kinds ->
            TileflowJson.strings(kinds.map { it.wireName })
        }
}

/** Reads Routing answers and checks them against the request. */
internal object RoutingDecoding {
    private val RELEASE_ID = Regex("^[a-z0-9][a-z0-9._-]{0,126}[a-z0-9]$")

    private class Answer(
        val network: TileflowRoutingNetwork,
        val attribution: String,
        val traffic: TileflowRoutingTrafficKind,
        val units: Int,
    )

    private fun answer(root: TileflowJsonObject): Answer {
        root.requireSchemaVersion()
        val releaseId = root.obj("network").string("releaseId")
        requireResponse(RELEASE_ID.matches(releaseId))
        val units = root.obj("usage").long("units")
        requireResponse(units in 0..Int.MAX_VALUE)
        return Answer(
            TileflowRoutingNetwork(releaseId),
            root.boundedText("attribution", 512),
            TileflowRoutingTrafficKind(root.literalText("traffic", 64)),
            units.toInt(),
        )
    }

    fun route(root: TileflowJsonObject, request: TileflowRouteRequest): TileflowRouteResponse {
        val answer = answer(root)
        val routes = root.array("routes").sized(1..3).mapObjects(::route)
        requireResponse(
            routes.size <= request.alternatives + 1 &&
                routes.all { it.legs.size == request.locations.size - 1 }
        )
        return TileflowRouteResponse(
            routes,
            answer.network,
            answer.attribution,
            answer.traffic,
            answer.units,
        )
    }

    fun isochrone(
        root: TileflowJsonObject,
        request: TileflowIsochroneRequest,
    ): TileflowIsochroneResponse {
        val answer = answer(root)
        val collection = root.obj("isochrones")
        requireResponse(collection.string("type") == "FeatureCollection")
        val isochrones =
            collection.array("features").sized(1..4).mapObjects { feature ->
                requireResponse(feature.string("type") == "Feature")
                val geometry = feature.obj("geometry")
                val coordinates = geometry.array("coordinates")
                val polygons =
                    when (geometry.string("type")) {
                        "Polygon" -> listOf(polygon(coordinates))
                        "MultiPolygon" -> coordinates.sized(1..Int.MAX_VALUE).map {
                            polygon(coordinates.array(it))
                        }
                        else -> invalidResponse()
                    }
                TileflowIsochrone(feature.obj("properties").int("minutes", 1..60), polygons)
            }
        requireResponse(isochrones.map { it.minutes } == request.minutes)
        return TileflowIsochroneResponse(
            isochrones,
            answer.network,
            answer.attribution,
            answer.traffic,
            answer.units,
        )
    }

    fun matrix(root: TileflowJsonObject, request: TileflowMatrixRequest): TileflowMatrixResponse {
        val answer = answer(root)
        fun grid(key: String): List<List<Double?>> =
            root.array(key).sized(1..25).map { row ->
                val cells = root.array(key).array(row).sized(1..25)
                cells.map { column ->
                    cells.nullableDouble(column)?.also { requireResponse(it >= 0) }
                }
            }
        val durations = grid("durations")
        val distances = grid("distances")
        fun isGrid(value: List<List<Double?>>) =
            value.size == request.sources.size && value.all { it.size == request.targets.size }
        requireResponse(isGrid(durations) && isGrid(distances))
        return TileflowMatrixResponse(
            durations,
            distances,
            answer.network,
            answer.attribution,
            answer.traffic,
            answer.units,
        )
    }

    fun match(root: TileflowJsonObject, request: TileflowMatchRequest): TileflowMatchResponse {
        val answer = answer(root)
        val points = root.array("points").sized(2..100)
        val matched =
            points.map { index ->
                if (points.isNull(index)) null
                else
                    points.obj(index).let {
                        TileflowMatchedPoint(it.position("location"), meters(it, "distance"))
                    }
            }
        requireResponse(matched.size == request.trace.size)
        return TileflowMatchResponse(
            meters(root, "distance"),
            meters(root, "duration"),
            line(root.obj("geometry")),
            matched,
            root.array("roads").sized(1..2_000).mapObjects(::road),
            answer.network,
            answer.attribution,
            answer.traffic,
            answer.units,
        )
    }

    fun nearest(root: TileflowJsonObject): TileflowNearestResponse {
        val answer = answer(root)
        return TileflowNearestResponse(
            root.position("location"),
            meters(root, "distance"),
            road(root.obj("road")),
            answer.network,
            answer.attribution,
            answer.traffic,
            answer.units,
        )
    }

    private fun meters(value: TileflowJsonObject, key: String): Double =
        value.double(key).also { requireResponse(it >= 0) }

    private fun line(value: TileflowJsonObject): List<TileflowPosition> {
        requireResponse(value.string("type") == "LineString")
        return value.array("coordinates").sized(2..200_000).positions()
    }

    private fun polygon(value: TileflowJsonArray): List<List<TileflowPosition>> =
        value.sized(1..Int.MAX_VALUE).map { value.array(it).sized(4..Int.MAX_VALUE).positions() }

    private fun route(value: TileflowJsonObject): TileflowRoute =
        TileflowRoute(
            distance = meters(value, "distance"),
            duration = meters(value, "duration"),
            hasTolls = value.boolean("hasTolls"),
            hasHighways = value.boolean("hasHighways"),
            hasFerries = value.boolean("hasFerries"),
            geometry = line(value.obj("geometry")),
            legs =
                value.array("legs").sized(1..4).mapObjects { leg ->
                    TileflowRouteLeg(
                        meters(leg, "distance"),
                        meters(leg, "duration"),
                        leg.array("steps").sized(1..2_000).mapObjects(::step),
                    )
                },
        )

    private fun step(value: TileflowJsonObject): TileflowRouteStep =
        TileflowRouteStep(
            maneuver = TileflowManeuver(value.literalText("maneuver", 64)),
            instruction = text(value.string("instruction"), 500),
            names = value.optArray("names")?.sized(0..8)?.strings(200).orEmpty(),
            exit = value.optString("exit")?.let { text(it, 50) },
            toward = value.optArray("toward")?.sized(0..8)?.strings(200).orEmpty(),
            roundaboutExit = value.optInt("roundaboutExit", 1..32),
            distance = meters(value, "distance"),
            duration = meters(value, "duration"),
            location = value.position("location"),
        )

    private fun road(value: TileflowJsonObject): TileflowRoad {
        val speedLimit =
            value.nullableObj("speedLimit")?.let {
                val source = it.string("source")
                requireResponse(source == "tagged")
                TileflowSpeedLimit(it.int("kmh", 1..300), source)
            }
        return TileflowRoad(
            names = value.array("names").sized(0..8).strings(200),
            wayId = value.optLong("wayId")?.also { requireResponse(it > 0) },
            roadClass = TileflowRoadClass(value.literalText("class", 64)),
            surface = value.optLiteralText("surface", 64)?.let(::TileflowRoadSurface),
            lanes = value.optInt("lanes", 1..16),
            speedLimit = speedLimit,
            toll = value.boolean("toll"),
            bridge = value.boolean("bridge"),
            tunnel = value.boolean("tunnel"),
            roundabout = value.boolean("roundabout"),
            length = meters(value, "length"),
        )
    }

    private fun text(value: String, maximum: Int): String {
        requireResponse(value.length in 1..maximum)
        return value
    }
}
