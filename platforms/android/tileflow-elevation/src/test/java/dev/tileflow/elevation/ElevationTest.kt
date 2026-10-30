package dev.tileflow.elevation

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
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ElevationTest {
    private val points =
        listOf(
            TileflowPosition(-3.7038, 40.4168),
            TileflowPosition(-16.6423, 28.2724),
            TileflowPosition(-30.0, 40.0),
        )
    private val profile =
        TileflowElevationProfileRequest(
            TileflowElevationLine.MultiLineString(
                listOf(
                    listOf(TileflowPosition(-3.7038, 40.4168), TileflowPosition(-3.7008, 40.4168)),
                    listOf(TileflowPosition(-3.7, 40.42), TileflowPosition(-3.7, 40.4209)),
                )
            ),
            maxSamples = 6,
        )

    private val operations: Map<String, suspend TileflowElevation.() -> Any> =
        mapOf(
            "elevation.points" to { points(points) },
            "elevation.profile" to { profile(profile) },
        )

    private fun StubApi.elevation(
        configuration: TileflowConfiguration = configuration(),
        app: () -> TileflowAppIdentity? = { Contract.androidApp },
    ) = TileflowElevation({ configuration }, app, OkHttpClient())

    private fun StubApi.fails(
        block: suspend TileflowElevation.() -> Any
    ): TileflowElevationException = failure { runBlocking { elevation().block() } }

    @Suppress("UNCHECKED_CAST")
    private fun <T> contract(name: String): T =
        StubApi().use { api ->
            api.enqueueOperation(name)
            val response = runBlocking { api.elevation().(operations.getValue(name))() }
            val request = api.take()
            assertOperation(name, request)
            assertServiceHeaders(request)
            response as T
        }

    /** The contract profile, decoded. */
    private fun profileAnswer(): TileflowElevationProfile = contract("elevation.profile")

    @Test
    fun pointsMatchTheContract() {
        val response = contract<TileflowElevationPointsResponse>("elevation.points")
        assertEquals(listOf(657.3, 3715.2, null), response.positions.map { it.elevation })
        assertEquals(points, response.positions.map { it.position })
        assertEquals(TileflowElevationDataset("terrain-v1-2026-09", 12), response.dataset)
        assertEquals(TileflowElevationUnit.METERS, response.unit)
        assertEquals(1, response.units)
    }

    @Test
    fun profileMatchesTheContract() {
        val response = profileAnswer()
        assertEquals(6, response.samples.size)
        assertEquals(listOf(0..2, 3..5), response.lines)
        assertNull(response.samples[3].elevation)
        assertEquals(100.0, response.interval, 0.0)
        assertEquals(353.6, response.summary.distance, 0.0)
        assertEquals(20.0, response.summary.ascent!!, 0.0)
        assertEquals(6.4, response.summary.maxGrade!!, 0.0)
        assertNull(response.summary.minGrade)
    }

    @Test
    fun profilePointsInterpolateWithinOneLine() {
        val profile = profileAnswer()
        val middle = profile.point(atDistance = 50.7)!!
        assertEquals(-3.7032, middle.position.longitude, 1e-9)
        assertEquals(40.4168, middle.position.latitude, 1e-9)
        assertEquals(652.0, middle.elevation!!, 1e-9)
        assertEquals(0, middle.index)
        assertEquals(0, middle.line)
        // Where two lines meet, the point is the start of the later line.
        val join = profile.point(atDistance = 253.5)!!
        assertEquals(1, join.line)
        assertEquals(3, join.index)
        assertEquals(TileflowPosition(-3.7, 40.42), join.position)
        assertEquals(662.0, join.elevation!!, 1e-9)
        val before = profile.point(atDistance = -10.0)!!
        assertEquals(0.0, before.distance, 0.0)
        assertEquals(650.0, before.elevation!!, 0.0)
        val after = profile.point(atDistance = 1_000.0)!!
        assertEquals(353.6, after.distance, 0.0)
        assertEquals(670.0, after.elevation!!, 1e-9)
        assertEquals(TileflowPosition(-3.7, 40.4209), after.position)
        assertNull(profile.point(atDistance = Double.NaN))
        assertNull(profile.copy(samples = emptyList(), lines = emptyList()).point(atDistance = 1.0))
        assertEquals(4, profile.nearestSampleIndex(to = TileflowPosition(-3.7001, 40.4205)))
        assertEquals(0, profile.nearestSampleIndex(to = TileflowPosition(-3.71, 40.41)))
        assertNull(profile.copy(samples = emptyList()).nearestSampleIndex(to = points[0]))
    }

    @Test
    fun errorAnswersMatchTheContract() {
        val cases = Contract.errors("elevation")
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            StubApi().use { api ->
                api.enqueueError(case)
                val error = api.fails(operations.getValue(case.getString("operation")))
                assertErrorCase(case, error, error.code?.wireName)
            }
        }
    }

    @Test
    fun answersOutsideTheContractAreInvalid() {
        val cases: List<Pair<String, (JSONObject) -> Unit>> =
            listOf(
                "elevation.points" to { it.put("unit", "feet") },
                "elevation.points" to { it.getJSONArray("positions").remove(2) },
                "elevation.points" to { it.put("schemaVersion", 2) },
                "elevation.points" to { it.getJSONObject("usage").put("units", 0) },
                "elevation.points" to {
                    it.getJSONArray("positions").put(0, JSONArray(listOf(-3.7038, 140.0, 657.3)))
                },
                "elevation.profile" to { it.put("unit", "feet") },
                "elevation.profile" to {
                    it.put("lines", JSONArray("[[0, 2], [4, 5]]"))
                },
                "elevation.profile" to { it.put("lines", JSONArray("[[0, 2], [3, 4]]")) },
                "elevation.profile" to { it.put("lines", JSONArray("[[1, 2], [3, 5]]")) },
                "elevation.profile" to { it.put("lines", JSONArray("[]")) },
                "elevation.profile" to { it.put("lines", JSONArray("[[0, 5], [3, 5]]")) },
                "elevation.profile" to { it.put("interval", 0) },
                "elevation.profile" to { it.getJSONObject("summary").remove("minGrade") },
                "elevation.profile" to {
                    val samples = it.getJSONArray("samples")
                    samples.put(samples.get(5))
                    it.put("lines", JSONArray("[[0, 2], [3, 6]]"))
                },
            )
        for ((name, change) in cases) {
            StubApi().use { api ->
                api.enqueue(Contract.response(name).also(change))
                val error = api.fails(operations.getValue(name))
                assertEquals(TileflowServiceErrorKind.INVALID_RESPONSE, error.kind)
                assertEquals(200, error.status)
            }
        }
    }

    @Test
    fun invalidRequestsAreRejectedLocally() {
        val line = listOf(TileflowPosition(0.0, 0.0), TileflowPosition(0.0, 1.0))
        fun request(
            line: TileflowElevationLine,
            interval: Double? = null,
            maxSamples: Int? = null,
            climbThreshold: Double? = null,
        ) = TileflowElevationProfileRequest(line, interval, maxSamples, climbThreshold)
        val requests: List<suspend TileflowElevation.() -> Any> =
            listOf(
                { points(emptyList()) },
                { points(List(101) { TileflowPosition(0.0, 0.0) }) },
                { points(listOf(TileflowPosition(0.0, -90.5))) },
                { batch(listOf(TileflowPosition(0.0, 0.0), TileflowPosition(Double.NaN, 0.0))) },
                { profile(request(TileflowElevationLine.LineString(line.take(1)))) },
                { profile(request(TileflowElevationLine.MultiLineString(List(101) { line }))) },
                { profile(request(TileflowElevationLine.MultiLineString(emptyList()))) },
                { profile(request(TileflowElevationLine.Polyline("a"))) },
                { profile(request(TileflowElevationLine.Polyline("_p~iF~ps|U", 7))) },
                { profile(request(TileflowElevationLine.LineString(line), interval = 0.0)) },
                { profile(request(TileflowElevationLine.LineString(line), maxSamples = 1)) },
                { profile(request(TileflowElevationLine.LineString(line), climbThreshold = -1.0)) },
            )
        StubApi().use { api ->
            for (request in requests) {
                val error = api.fails(request)
                assertEquals(TileflowServiceErrorKind.INVALID_REQUEST, error.kind)
                assertNull(error.status)
            }
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun profileLinesAreEncodedWithTheirUnit() {
        StubApi().use { api ->
            api.enqueue(Contract.response("elevation.profile").put("unit", "feet"))
            runBlocking {
                api.elevation()
                    .profile(
                        TileflowElevationProfileRequest(
                            TileflowElevationLine.Polyline("_p~iF~ps|U_ulLnnqC"),
                            interval = 25.0,
                            climbThreshold = 0.0,
                            unit = TileflowElevationUnit.FEET,
                        )
                    )
            }
            val body = JSONObject(api.take().body.readUtf8())
            assertEquals("_p~iF~ps|U_ulLnnqC", body.getJSONObject("polyline").getString("encoded"))
            assertEquals(5, body.getJSONObject("polyline").getInt("precision"))
            assertEquals(25.0, body.getDouble("interval"), 0.0)
            assertEquals(0.0, body.getDouble("climbThreshold"), 0.0)
            assertEquals("feet", body.getString("unit"))
            assertTrue(!body.has("line") && !body.has("maxSamples"))
        }
    }

    @Test
    fun aSinglePositionUsesOnePointsRequest() {
        StubApi().use { api ->
            api.enqueue(
                Contract.response("elevation.points")
                    .put("positions", JSONArray("[[-3.7038, 40.4168, 657.3]]"))
            )
            assertEquals(657.3, runBlocking { api.elevation().elevation(at = points[0]) }!!, 0.0)
        }
    }

    @Test
    fun batchesKeepOrderAndRunAtMostFourRequestsAtOnce() {
        StubApi().use { api ->
            val running = AtomicInteger()
            val most = AtomicInteger()
            api.server.dispatcher =
                object : Dispatcher() {
                    override fun dispatch(request: RecordedRequest): MockResponse {
                        most.accumulateAndGet(running.incrementAndGet(), ::maxOf)
                        try {
                            Thread.sleep(100)
                            val positions =
                                JSONObject(request.body.readUtf8()).getJSONArray("positions")
                            val elevated = JSONArray()
                            for (index in 0 until positions.length()) {
                                val position = positions.getJSONArray(index)
                                // The elevation encodes the position, so order is checkable.
                                elevated.put(
                                    JSONArray(
                                        listOf(
                                            position.getDouble(0),
                                            position.getDouble(1),
                                            position.getDouble(0) * 1_000,
                                        )
                                    )
                                )
                            }
                            val first = positions.getJSONArray(0).getDouble(0)
                            val answer =
                                Contract.response("elevation.points")
                                    .put("positions", elevated)
                                    .put("attribution", if (first < 0.5) "© A" else "© B")
                            return MockResponse().setBody(answer.toString())
                        } finally {
                            running.decrementAndGet()
                        }
                    }
                }
            val positions = List(950) { TileflowPosition(it / 1_000.0, 1.0) }
            val batch = runBlocking { api.elevation().batch(positions) }
            assertEquals(10, api.requestCount)
            assertTrue(most.get() in 2..4)
            assertEquals(positions, batch.positions.map { it.position })
            assertEquals(
                positions.map { it.longitude * 1_000 },
                batch.positions.map { it.elevation },
            )
            assertEquals("© A © B", batch.attribution)
            assertEquals(10, batch.units)
            assertEquals(TileflowElevationUnit.METERS, batch.unit)
        }
    }

    @Test
    fun anEmptyBatchSendsNothing() {
        StubApi().use { api ->
            val feet = TileflowElevationUnit.FEET
            val batch = runBlocking { api.elevation().batch(emptyList(), feet) }
            assertEquals(TileflowElevationBatch(emptyList(), feet, "", 0), batch)
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun aGpxTrackBecomesAProfileRequest() {
        val track =
            TileflowGpxTrack(
                "Ride",
                listOf(
                    listOf(
                        TileflowGpxPoint(TileflowPosition(1.0, 2.0), 10.0),
                        TileflowGpxPoint(TileflowPosition(1.1, 2.1), null),
                    )
                ),
            )
        assertEquals(
            TileflowElevationLine.MultiLineString(
                listOf(listOf(TileflowPosition(1.0, 2.0), TileflowPosition(1.1, 2.1)))
            ),
            TileflowElevationProfileRequest(track, maxSamples = 50).line,
        )
    }
}
