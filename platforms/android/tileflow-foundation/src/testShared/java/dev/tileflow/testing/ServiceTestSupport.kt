package dev.tileflow.testing

import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import java.io.Closeable
import java.net.InetAddress
import java.net.URI
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.fail

/** The wire contract shared by the native service clients. */
object Contract {
    val root: JSONObject by lazy {
        val loader = checkNotNull(Contract::class.java.classLoader)
        val stream = loader.getResourceAsStream("service-contract.json")
        JSONObject(String(checkNotNull(stream).use { it.readBytes() }, Charsets.UTF_8))
    }

    val credential: String
        get() = root.getString("credential")

    val androidApp: TileflowAppIdentity
        get() =
            root.getJSONObject("apps").getJSONObject("android").let {
                TileflowAppIdentity(it.getString("id"), it.getString("certificateSha256"))
            }

    fun operation(name: String): JSONObject = root.getJSONObject("operations").getJSONObject(name)

    /** A copy of an operation's answer that a test may change. */
    fun response(name: String): JSONObject =
        JSONObject(operation(name).getJSONObject("response").toString())

    /** The request body of an operation, or null for a request without one. */
    fun request(name: String): Any? = operation(name).opt("request")

    fun errors(service: String): List<JSONObject> {
        val errors = root.getJSONArray("errors")
        return List(errors.length()) { errors.getJSONObject(it) }
            .filter { it.getString("operation").startsWith("$service.") }
    }
}

/** A local API for one test. */
class StubApi : Closeable {
    val server = MockWebServer().apply { start(InetAddress.getByName("127.0.0.1"), 0) }

    val origin: URI = URI("http://127.0.0.1:${server.port}")

    val requestCount: Int
        get() = server.requestCount

    fun configuration(
        servicesCredential: String? = Contract.credential,
        searchCredential: String? = null,
        routingCredential: String? = null,
        elevationCredential: String? = null,
        mapCredential: String? = null,
        app: TileflowAppIdentity? = null,
    ): TileflowConfiguration =
        TileflowConfiguration(
            apiOrigin = origin,
            servicesCredential = servicesCredential?.let(::TileflowCredential),
            searchCredential = searchCredential?.let(::TileflowCredential),
            routingCredential = routingCredential?.let(::TileflowCredential),
            elevationCredential = elevationCredential?.let(::TileflowCredential),
            mapCredential = mapCredential?.let(::TileflowCredential),
            app = app,
        )

    fun enqueue(
        body: String,
        status: Int = 200,
        headers: Map<String, String> = emptyMap(),
    ) {
        val response = MockResponse().setResponseCode(status).setBody(body)
        headers.forEach { (name, value) -> response.setHeader(name, value) }
        server.enqueue(response)
    }

    fun enqueue(body: JSONObject, status: Int = 200) = enqueue(body.toString(), status)

    /** Serves the contract answer of an operation. */
    fun enqueueOperation(name: String) = enqueue(Contract.operation(name).getJSONObject("response"))

    /** Serves a contract error case: its status, headers and body. */
    fun enqueueError(case: JSONObject) {
        val headers = case.optJSONObject("headers")
        enqueue(
            if (case.has("rawBody")) case.getString("rawBody")
            else case.getJSONObject("body").toString(),
            case.getInt("status"),
            headers?.keys()?.asSequence()?.associateWith { headers.getString(it) }.orEmpty(),
        )
    }

    fun take(): RecordedRequest =
        checkNotNull(server.takeRequest(10, TimeUnit.SECONDS)) { "No request arrived." }

    override fun close() = server.shutdown()
}

/** Asserts the method, path and JSON body of a contract operation. */
fun assertOperation(name: String, request: RecordedRequest) {
    val operation = Contract.operation(name)
    assertEquals(operation.getString("method"), request.method)
    assertEquals(operation.getString("path"), request.path)
    val expected = operation.opt("request")
    if (expected == null || expected == JSONObject.NULL) {
        assertEquals(0L, request.bodySize)
        assertEquals(null, request.getHeader("Content-Type"))
    } else {
        assertEquals("application/json", request.getHeader("Content-Type"))
        assertJsonEquals(expected, JSONObject(request.body.readUtf8()))
    }
}

/** Asserts the headers of an authenticated request. */
fun assertServiceHeaders(
    request: RecordedRequest,
    credential: String = Contract.credential,
    app: TileflowAppIdentity = Contract.androidApp,
) {
    assertEquals("application/json", request.getHeader("Accept"))
    assertEquals("Bearer $credential", request.getHeader("Authorization"))
    assertEquals(app.id, request.getHeader("X-Tileflow-App"))
    assertEquals(app.certificateSha256, request.getHeader("X-Tileflow-App-Certificate"))
}

/**
 * Asserts a contract error case: the kind, typed code, status, request ID, retry delay and, when
 * the case names one, the message.
 */
fun assertErrorCase(case: JSONObject, error: TileflowServiceException, code: String?) {
    val expect = case.getJSONObject("expect")
    fun text(key: String): String? = if (expect.has(key)) expect.getString(key) else null
    val kind = expect.getString("kind").replace(Regex("([A-Z])"), "_$1").uppercase()
    assertEquals(TileflowServiceErrorKind.valueOf(kind), error.kind)
    assertEquals(text("code"), code)
    assertEquals(expect.getInt("status"), error.status)
    assertEquals(text("requestId"), error.requestId)
    val retryAfter = "retryAfterSeconds"
    assertEquals(
        if (expect.has(retryAfter)) expect.getLong(retryAfter) else null,
        error.retryAfterSeconds,
    )
    text("message")?.let { assertEquals(it, error.message) }
}

/** Asserts that two JSON values are structurally equal, comparing numbers by value. */
fun assertJsonEquals(expected: Any?, actual: Any?) {
    assertEquals(normalize(expected), normalize(actual))
}

private fun normalize(value: Any?): Any? =
    when (value) {
        null,
        JSONObject.NULL -> null
        is JSONObject -> value.keys().asSequence().associateWith { normalize(value.opt(it)) }
        is JSONArray -> List(value.length()) { normalize(value.opt(it)) }
        is Number -> value.toDouble()
        else -> value
    }

/** Runs [block] and returns the exception it throws. */
inline fun <reified T : Throwable> failure(block: () -> Unit): T {
    try {
        block()
    } catch (error: Throwable) {
        if (error is T) return error
        throw AssertionError("Expected ${T::class.simpleName}, got $error", error)
    }
    fail("Expected ${T::class.simpleName}")
    throw AssertionError()
}

fun <T> assertPresent(value: T?): T {
    assertNotNull(value)
    return value!!
}
