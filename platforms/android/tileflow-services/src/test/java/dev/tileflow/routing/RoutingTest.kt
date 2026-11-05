package dev.tileflow.routing

import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.testing.Contract
import dev.tileflow.testing.StubApi
import dev.tileflow.testing.assertErrorCase
import dev.tileflow.testing.assertOperation
import dev.tileflow.testing.assertServiceHeaders
import dev.tileflow.testing.failure
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutingTest {
    private val start = TileflowPosition(-80.2195, 25.7655)
    private val end = TileflowPosition(-80.1312, 25.7795)
    private val other = "tf_public_" + "d".repeat(48)

    private val route =
        TileflowRouteRequest(listOf(start, end), TileflowRoutingMode.DRIVING, alternatives = 1)
    private val isochrone =
        TileflowIsochroneRequest(end, TileflowRoutingMode.WALKING, minutes = listOf(5, 10))
    private val matrix =
        TileflowMatrixRequest(
            sources = listOf(start, TileflowPosition(-80.1918, 25.7743)),
            targets =
                listOf(end, TileflowPosition(-79.0, 25.0), TileflowPosition(-80.3553, 25.8195)),
            mode = TileflowRoutingMode.DRIVING,
        )
    private val match =
        TileflowMatchRequest(
            listOf(
                TileflowPosition(-80.1327, 25.7808),
                TileflowPosition(-80.1324, 25.784),
                TileflowPosition(-80.1321, 25.787),
                TileflowPosition(-80.1318, 25.7922),
            ),
            TileflowRoutingMode.DRIVING,
        )
    private val nearest =
        TileflowNearestRequest(TileflowPosition(-80.1322, 25.784), TileflowRoutingMode.DRIVING)

    private val operations: Map<String, suspend TileflowRouting.() -> Any> =
        mapOf(
            "routing.route" to { route(route) },
            "routing.isochrone" to { isochrone(isochrone) },
            "routing.matrix" to { matrix(matrix) },
            "routing.match" to { match(match) },
            "routing.nearest" to { nearest(nearest) },
        )

    private fun StubApi.routing(
        configuration: TileflowConfiguration = configuration(),
        app: () -> TileflowAppIdentity? = { Contract.androidApp },
    ) = TileflowRouting({ configuration }, app, OkHttpClient())

    private fun StubApi.fails(
        routing: TileflowRouting = routing(),
        block: suspend TileflowRouting.() -> Any,
    ): TileflowRoutingException = failure { runBlocking { routing.block() } }

    @Suppress("UNCHECKED_CAST")
    private fun <T> contract(name: String): T =
        StubApi().use { api ->
            api.enqueueOperation(name)
            val response = runBlocking { api.routing().(operations.getValue(name))() }
            val request = api.take()
            assertOperation(name, request)
            assertServiceHeaders(request)
            response as T
        }

    @Test
    fun routeMatchesTheContract() {
        val response = contract<TileflowRouteResponse>("routing.route")
        assertEquals(2, response.routes.size)
        assertEquals("routing-v1-local-florida-260801-v391", response.network.releaseId)
        assertEquals(TileflowRoutingTrafficKind.NONE, response.traffic)
        assertEquals(5, response.units)
        val fastest = response.routes[0]
        assertEquals(13023.0, fastest.distance, 0.0)
        assertEquals(744.6, fastest.duration, 0.0)
        assertTrue(fastest.hasTolls)
        assertEquals(531, fastest.geometry.size)
        val steps = fastest.legs.single().steps
        assertEquals(TileflowManeuver.DEPART, steps[0].maneuver)
        assertEquals(TileflowManeuver.EXIT_RIGHT, steps[2].maneuver)
        assertEquals("2D", steps[2].exit)
        assertEquals(listOf("Miami Beach", "Port Miami"), steps[2].toward)
        assertEquals(TileflowManeuver.ARRIVE, steps.last().maneuver)
        val bounds = fastest.bounds
        assertEquals(fastest.geometry.minOf { it.longitude }, bounds.west, 0.0)
        assertEquals(fastest.geometry.maxOf { it.latitude }, bounds.north, 0.0)
        assertTrue(bounds.west < bounds.east && bounds.south < bounds.north)
    }

    @Test
    fun isochroneMatchesTheContract() {
        val response = contract<TileflowIsochroneResponse>("routing.isochrone")
        assertEquals(listOf(5, 10), response.isochrones.map { it.minutes })
        val ring = response.isochrones[0].polygons.single().single()
        assertEquals(14, ring.size)
        assertEquals(ring.first(), ring.last())
    }

    @Test
    fun matrixMatchesTheContract() {
        val response = contract<TileflowMatrixResponse>("routing.matrix")
        assertEquals(listOf(744.0, null, 1338.0), response.durations[0])
        assertEquals(listOf(8656.0, null, 23489.0), response.distances[1])
        assertEquals(6, response.units)
    }

    @Test
    fun matchMatchesTheContract() {
        val response = contract<TileflowMatchResponse>("routing.match")
        assertEquals(4, response.points.size)
        assertEquals(TileflowPosition(-80.132745, 25.780808), response.points[0]?.location)
        val roads = response.roads
        assertEquals(9, roads.size)
        assertEquals(TileflowRoadClass.SECONDARY, roads[0].roadClass)
        assertEquals(TileflowRoadSurface.PAVED_SMOOTH, roads[0].surface)
        assertEquals(TileflowSpeedLimit(56, "tagged"), roads[0].speedLimit)
        assertEquals(1024451499L, roads[0].wayId)
        assertNull(roads[6].speedLimit)
    }

    @Test
    fun nearestMatchesTheContract() {
        val response = contract<TileflowNearestResponse>("routing.nearest")
        assertEquals(TileflowPosition(-80.132215, 25.784002), response.location)
        assertEquals(1.5, response.distance, 0.0)
        assertEquals(listOf("Washington Avenue"), response.road.names)
        assertEquals(2, response.road.lanes)
    }

    @Test
    fun errorAnswersMatchTheContract() {
        val cases = Contract.errors("routing")
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            StubApi().use { api ->
                api.enqueueError(case)
                val error = api.fails(block = operations.getValue(case.getString("operation")))
                assertErrorCase(case, error, error.code?.wireName)
            }
        }
    }

    @Test
    fun answersOutsideTheContractAreInvalid() {
        fun JSONObject.route() = getJSONArray("routes").getJSONObject(0)
        val cases: List<Pair<String, (JSONObject) -> Unit>> =
            listOf(
                "routing.route" to {
                    val legs = it.route().getJSONArray("legs")
                    legs.put(legs.get(0))
                },
                "routing.route" to {
                    val routes = it.getJSONArray("routes")
                    routes.put(routes.get(0))
                },
                "routing.route" to { it.put("schemaVersion", 2) },
                "routing.route" to { it.getJSONObject("usage").remove("units") },
                "routing.route" to { it.getJSONObject("network").put("releaseId", "Release") },
                "routing.route" to {
                    it.route().getJSONObject("geometry").getJSONArray("coordinates")
                        .put(0, JSONArray(listOf(-80.2, 95.0)))
                },
                "routing.route" to { it.route().put("distance", -1) },
                "routing.isochrone" to {
                    it.getJSONObject("isochrones").getJSONArray("features").getJSONObject(1)
                        .getJSONObject("properties").put("minutes", 15)
                },
                "routing.isochrone" to {
                    it.getJSONObject("isochrones").getJSONArray("features").remove(1)
                },
                "routing.matrix" to { it.getJSONArray("durations").getJSONArray(0).remove(2) },
                "routing.matrix" to { it.getJSONArray("distances").remove(1) },
                "routing.match" to { it.getJSONArray("points").remove(3) },
                "routing.nearest" to { it.getJSONObject("road").put("class", 3) },
                "routing.nearest" to { it.getJSONObject("road").remove("speedLimit") },
            )
        for ((name, change) in cases) {
            StubApi().use { api ->
                api.enqueue(Contract.response(name).also(change))
                val error = api.fails(block = operations.getValue(name))
                assertEquals(TileflowServiceErrorKind.INVALID_RESPONSE, error.kind)
                assertEquals(200, error.status)
            }
        }
    }

    @Test
    fun unknownOpenValuesDecode() {
        StubApi().use { api ->
            val answer = Contract.response("routing.nearest").put("traffic", "typical")
            answer.getJSONObject("road").put("class", "track").put("surface", "sand")
            api.enqueue(answer)
            val response = runBlocking { api.routing().nearest(nearest) }
            assertEquals(TileflowRoutingTrafficKind("typical"), response.traffic)
            assertEquals(TileflowRoadClass("track"), response.road.roadClass)
            assertEquals(TileflowRoadSurface("sand"), response.road.surface)
        }
    }

    @Test
    fun invalidRequestsAreRejectedLocally() {
        val far = TileflowPosition(-75.0, 25.0)
        val endless = TileflowPosition(0.0, Double.POSITIVE_INFINITY)
        val walking = route.copy(mode = TileflowRoutingMode.WALKING, locations = listOf(start, far))
        val requests: List<suspend TileflowRouting.() -> Any> =
            listOf(
                { route(TileflowRouteRequest(listOf(start), TileflowRoutingMode.DRIVING)) },
                { route(TileflowRouteRequest(List(6) { start }, TileflowRoutingMode.DRIVING)) },
                { route(route.copy(alternatives = 3)) },
                { route(route.copy(locations = listOf(start, end, start))) },
                { route(route.copy(locations = listOf(start, TileflowPosition(-181.0, 0.0)))) },
                { route(walking) },
                { route(route.copy(vehicle = TileflowVehicle(heightMeters = 4.0))) },
                {
                    route(
                        route.copy(
                            mode = TileflowRoutingMode.TRUCK,
                            vehicle = TileflowVehicle(heightMeters = 11.0),
                        )
                    )
                },
                {
                    route(
                        route.copy(
                            mode = TileflowRoutingMode.TRUCK,
                            vehicle = TileflowVehicle(axleCount = 1),
                        )
                    )
                },
                { route(route.copy(avoid = List(2) { TileflowRoutingAvoidance.TOLLS })) },
                { isochrone(isochrone.copy(minutes = emptyList())) },
                { isochrone(isochrone.copy(minutes = listOf(10, 5))) },
                { isochrone(isochrone.copy(minutes = listOf(5, 61))) },
                { isochrone(isochrone.copy(minutes = listOf(1, 2, 3, 4, 5))) },
                { matrix(matrix.copy(targets = listOf(far))) },
                { matrix(matrix.copy(sources = emptyList())) },
                { matrix(matrix.copy(mode = TileflowRoutingMode.CYCLING)) },
                { match(match.copy(timestamps = listOf(1, 2, 3))) },
                { match(match.copy(timestamps = listOf(1, 3, 2, 4))) },
                { match(match.copy(timestamps = listOf(-1, 2, 3, 4))) },
                { match(match.copy(accuracy = 0.5)) },
                { match(match.copy(trace = listOf(start, end))) },
                { match(match.copy(trace = listOf(start))) },
                { nearest(nearest.copy(location = endless)) },
            )
        StubApi().use { api ->
            for (request in requests) {
                val error = api.fails(block = request)
                assertEquals(TileflowServiceErrorKind.INVALID_REQUEST, error.kind)
                assertNull(error.status)
            }
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun optionalRequestValuesAreEncoded() {
        StubApi().use { api ->
            // The contract answer has one leg, so a route through three locations is invalid.
            api.enqueueOperation("routing.route")
            val error = api.fails {
                route(
                    TileflowRouteRequest(
                        listOf(start, end, start),
                        TileflowRoutingMode.TRUCK,
                        vehicle = TileflowVehicle(heightMeters = 4.1, axleCount = 3),
                        avoid = listOf(TileflowRoutingAvoidance.TOLLS),
                        traffic = TileflowRoutingTraffic.NONE,
                        language = TileflowRoutingLanguage.PT_BR,
                    )
                )
            }
            assertEquals(TileflowServiceErrorKind.INVALID_RESPONSE, error.kind)
            val body = JSONObject(api.take().body.readUtf8())
            assertEquals("truck", body.getString("mode"))
            val vehicle = body.getJSONObject("vehicle")
            assertEquals(2, vehicle.length())
            assertEquals(4.1, vehicle.getDouble("heightMeters"), 0.0)
            assertEquals(3, vehicle.getInt("axleCount"))
            assertEquals("tolls", body.getJSONArray("avoid").getString(0))
            assertEquals("none", body.getString("traffic"))
            assertEquals("pt-BR", body.getString("language"))
            assertTrue(!body.has("alternatives"))

            api.enqueueOperation("routing.match")
            runBlocking {
                val latest = 4_102_444_800L
                val timed =
                    match.copy(timestamps = listOf(0, latest, latest, latest), accuracy = 12.5)
                api.routing().match(timed)
            }
            val trace = JSONObject(api.take().body.readUtf8())
            assertEquals(4_102_444_800L, trace.getJSONArray("timestamps").getLong(1))
            assertEquals(12.5, trace.getDouble("accuracy"), 0.0)
        }
    }

    @Test
    fun theRoutingCredentialOverridesAndTheMapCredentialNeverAuthorizes() {
        StubApi().use { api ->
            api.enqueueOperation("routing.nearest")
            runBlocking {
                api.routing(api.configuration(routingCredential = other)).nearest(nearest)
            }
            assertServiceHeaders(api.take(), credential = other)
            val mapOnly =
                api.routing(api.configuration(servicesCredential = null, mapCredential = other))
            assertEquals(
                TileflowServiceErrorKind.CONFIGURATION,
                api.fails(mapOnly) { nearest(nearest) }.kind,
            )
            assertEquals(1, api.requestCount)
        }
    }
}
