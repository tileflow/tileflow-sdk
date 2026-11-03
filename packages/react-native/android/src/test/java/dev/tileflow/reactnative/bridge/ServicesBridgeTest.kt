package dev.tileflow.reactnative.bridge

import androidx.test.core.app.ApplicationProvider
import android.content.Context
import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.elevation.TileflowElevation
import dev.tileflow.geoip.TileflowGeoIP
import dev.tileflow.routing.TileflowRouting
import dev.tileflow.search.TileflowSearch
import java.net.URI
import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** JSON as plain Kotlin values, with every number a double, so that both sides compare. */
internal fun normalized(value: Any?): Any? =
    when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { normalized(value.opt(it)) }
        is JSONArray -> (0 until value.length()).map { normalized(value.opt(it)) }
        is Map<*, *> -> value.entries.associate { (key, item) -> key.toString() to normalized(item) }
        is List<*> -> value.map(::normalized)
        is Number -> value.toDouble()
        else -> value
    }

/** A JSON object or array as the bridge receives it from JavaScript. */
internal fun plain(value: Any?): Any? =
    when (value) {
        null, JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { plain(value.opt(it)) }
        is JSONArray -> (0 until value.length()).map { plain(value.opt(it)) }
        is Number -> value.toDouble()
        else -> value
    }

internal fun resource(name: String): String =
    requireNotNull(ServicesBridgeTest::class.java.classLoader!!.getResource(name)) { name }.readText()

@RunWith(RobolectricTestRunner::class)
class ServicesBridgeTest {
    private val server = MockWebServer()
    private val contract = JSONObject(resource("service-contract.json"))
    private lateinit var clients: ServiceClients

    @Before
    fun setUp() {
        server.start()
        val context = ApplicationProvider.getApplicationContext<Context>()
        val configuration =
            TileflowConfiguration(
                apiOrigin = URI("http://127.0.0.1:${server.port}"),
                servicesCredential = TileflowCredential(contract.getString("credential")),
                app =
                    contract.getJSONObject("apps").getJSONObject("android").let {
                        TileflowAppIdentity(it.getString("id"), it.getString("certificateSha256"))
                    },
            )
        clients =
            ServiceClients(
                TileflowSearch(context, configuration),
                TileflowRouting(context, configuration),
                TileflowElevation(context, configuration),
                TileflowGeoIP(context, configuration),
            )
    }

    @After fun tearDown() = server.shutdown()

    /**
     * Each bridge request sends the contract's request body, and its answer reaches JavaScript as
     * the shared fixture records it, exactly as on iOS.
     */
    @Test
    fun everyOperationMatchesTheSharedFixture() = runTest {
        val bridge = JSONObject(resource("bridge-contract.json")).getJSONObject("operations")
        val operations = contract.getJSONObject("operations")
        for (name in bridge.keys().asSequence().sorted()) {
            val entry = bridge.getJSONObject(name)
            val operation = operations.getJSONObject(name)
            server.enqueue(
                MockResponse()
                    .setResponseCode(operation.optInt("status", 200))
                    .setHeader("Content-Type", "application/json")
                    .setBody(operation.get("response").toString())
            )
            val answer =
                try {
                    ServicesBridge.call(
                        entry.getString("service"),
                        entry.getString("operation"),
                        plain(entry.getJSONObject("request")),
                        clients,
                    )
                } catch (failure: BridgeFailure) {
                    fail("$name: ${failure.code} ${failure.message}")
                    return@runTest
                }
            val sent = server.takeRequest()
            val expectedBody = operation.opt("request")
            if (expectedBody is JSONObject) {
                assertEquals(name, normalized(expectedBody), normalized(JSONObject(sent.body.readUtf8())))
            }
            assertEquals(name, normalized(entry.getJSONObject("answer")), normalized(answer))
        }
    }

    @Test
    fun serviceErrorsReachJavaScriptWithTheirFields() = runTest {
        val errors = contract.getJSONArray("errors")
        val route = (0 until errors.length()).map(errors::getJSONObject).first { it.getString("operation") == "routing.route" }
        server.enqueue(
            MockResponse()
                .setResponseCode(route.getInt("status"))
                .setHeader("Content-Type", "application/json")
                .setBody(route.getJSONObject("body").toString())
        )
        try {
            ServicesBridge.call(
                "routing",
                "route",
                mapOf("locations" to listOf(listOf(-80.2, 25.7), listOf(-80.1, 25.8)), "mode" to "driving"),
                clients,
            )
            fail("The route was refused.")
        } catch (failure: BridgeFailure) {
            assertEquals("ROUTING_NO_ROUTE", failure.code)
            assertEquals("No route connects these locations.", failure.message)
            assertEquals(
                mapOf("kind" to "rejected", "code" to "ROUTING_NO_ROUTE", "status" to 422.0, "requestId" to "req_01J9"),
                normalized(failure.info),
            )
        }
    }

    @Test
    fun malformedArgumentsNameTheFieldAndSendNothing() = runTest {
        try {
            ServicesBridge.call("search", "geocode", mapOf("query" to "Sol", "proximity" to listOf(1.0)), clients)
            fail("The request was malformed.")
        } catch (failure: BridgeFailure) {
            assertEquals("invalidRequest", failure.code)
            assertEquals("request.proximity must be [longitude, latitude]", failure.message)
            assertEquals("invalidRequest", failure.info["kind"])
        }
        try {
            ServicesBridge.call("routing", "teleport", emptyMap<String, Any?>(), clients)
            fail("The operation does not exist.")
        } catch (failure: BridgeFailure) {
            assertEquals("invalidRequest", failure.code)
        }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun configuredServicesReportPresenceOnly() {
        val configuration = TileflowConfiguration(searchCredential = TileflowCredential(contract.getString("credential")))
        assertEquals(
            mapOf("map" to false, "search" to true, "routing" to false, "elevation" to false, "geoip" to false),
            ServicesBridge.configuredServices { configuration },
        )
        assertTrue(ServicesBridge.configuredServices { error("unreadable") }.values.none { it })
    }

    @Test
    fun javaScriptNamesBecomeConstantsAndBack() {
        assertEquals("OPENING_HOURS", BridgeObject.constantName("openingHours"))
        assertEquals("EN_US", BridgeObject.constantName("en-US"))
        assertEquals("DISALLOW_EXPENSIVE", BridgeObject.constantName("disallowExpensive"))
        assertEquals("invalidRegion", BridgeObject.caseName("INVALID_REGION"))
    }
}
