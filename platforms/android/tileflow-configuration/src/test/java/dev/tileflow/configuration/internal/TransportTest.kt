package dev.tileflow.configuration.internal

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowConfigurationException
import dev.tileflow.configuration.TileflowService
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.configuration.TileflowServiceException
import dev.tileflow.testing.Contract
import dev.tileflow.testing.StubApi
import dev.tileflow.testing.assertServiceHeaders
import dev.tileflow.testing.failure
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TransportTest {
    private enum class Code(val wire: String, val status: Int) {
        DENIED("TEST_DENIED", 403),
        LIMITED("TEST_LIMITED", 429),
    }

    private class TestException(val failure: TileflowServiceFailure<Code>) :
        TileflowServiceException(
            failure.kind,
            failure.status,
            failure.requestId,
            failure.retryAfterSeconds,
            failure.message,
            failure.cause,
        )

    private fun errors(
        service: TileflowService = TileflowService.SEARCH,
        codeless: Set<Int> = emptySet(),
    ) =
        TileflowServiceErrors(
            service,
            "Test",
            Code.entries,
            { it.wire },
            { it.status },
            ::TestException,
            unauthorizedCode = Code.DENIED,
            codelessStatuses = codeless,
        )

    private fun StubApi.transport(
        configuration: TileflowConfiguration = configuration(),
        service: TileflowService = TileflowService.SEARCH,
        client: OkHttpClient = OkHttpClient(),
    ) =
        TileflowServiceTransport(
            errors(service),
            { configuration },
            { Contract.androidApp },
            client,
        )

    private suspend fun TileflowServiceTransport<Code>.post(
        maximumResponseBytes: Int = 1024,
        body: () -> JSONObject = { JSONObject().put("value", 1) },
    ): Long =
        send("/v1/test", 1024, maximumResponseBytes, body) { it.long("value") }

    private fun failureOf(block: suspend () -> Unit): TestException =
        failure<TestException> { runBlocking { block() } }

    @Test
    fun requestsCarryTheCredentialAndAppIdentityWithoutCaching() = runBlocking {
        StubApi().use { api ->
            api.enqueue("""{"value": 7}""")
            assertEquals(7L, api.transport().post())
            val request = api.take()
            assertServiceHeaders(request)
            assertEquals("application/json", request.getHeader("Content-Type"))
            assertEquals("no-cache", request.getHeader("Cache-Control"))
        }
    }

    @Test
    fun anonymousServicesSendNoCredentialOrAppIdentity() = runBlocking {
        StubApi().use { api ->
            api.enqueue("""{"value": 1}""")
            val anonymous = api.configuration(servicesCredential = null)
            api.transport(anonymous, TileflowService.GEOIP).post()
            val request = api.take()
            assertNull(request.getHeader("Authorization"))
            assertNull(request.getHeader("X-Tileflow-App"))
            assertNull(request.getHeader("X-Tileflow-App-Certificate"))
            assertEquals("application/json", request.getHeader("Accept"))
        }
    }

    @Test
    fun configurationFailuresSendNothing() {
        StubApi().use { api ->
            val unconfigured = api.configuration(servicesCredential = null)
            assertEquals(
                TileflowServiceErrorKind.CONFIGURATION,
                failureOf { api.transport(unconfigured).post() }.kind,
            )
            val broken =
                TileflowServiceTransport(
                    errors(),
                    { throw TileflowConfigurationException("Invalid manifest value.") },
                    { Contract.androidApp },
                    OkHttpClient(),
                )
            assertEquals(TileflowServiceErrorKind.CONFIGURATION, failureOf { broken.post() }.kind)
            val unidentified =
                TileflowServiceTransport(
                    errors(),
                    { api.configuration() },
                    { null },
                    OkHttpClient(),
                )
            assertEquals(
                TileflowServiceErrorKind.CONFIGURATION,
                failureOf { unidentified.post() }.kind,
            )
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun invalidRequestsAndOversizeBodiesSendNothing() {
        StubApi().use { api ->
            val invalid = failureOf {
                api.transport().post { throw TileflowInvalidRequestException("Invalid value.") }
            }
            assertEquals(TileflowServiceErrorKind.INVALID_REQUEST, invalid.kind)
            assertNull(invalid.status)
            val large = failureOf {
                api.transport().post { JSONObject().put("value", "x".repeat(1024)) }
            }
            assertEquals(TileflowServiceErrorKind.INVALID_REQUEST, large.kind)
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun redirectsAreNeverFollowed() {
        StubApi().use { api ->
            api.server.enqueue(
                MockResponse().setResponseCode(302).setHeader("Location", "${api.origin}/other")
            )
            api.enqueue("""{"value": 1}""")
            val client = OkHttpClient.Builder().followRedirects(true).build()
            val error = failureOf { api.transport(client = client).post() }
            assertEquals(TileflowServiceErrorKind.NETWORK, error.kind)
            assertNull(error.status)
            assertEquals(1, api.requestCount)
        }
    }

    @Test
    fun connectionFailuresAreNetworkFailures() {
        StubApi().use { api ->
            api.server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
            val error = failureOf { api.transport().post() }
            assertEquals(TileflowServiceErrorKind.NETWORK, error.kind)
            assertNull(error.status)
        }
    }

    @Test
    fun answersBeyondTheirLimitOrOutsideJsonAreInvalid() {
        StubApi().use { api ->
            val large = """{"value": 1, "padding": "${"x".repeat(2048)}"}"""
            api.enqueue(large)
            api.server.enqueue(MockResponse().setChunkedBody(large, 256))
            api.server.enqueue(
                MockResponse().setBody(okio.Buffer().write(byteArrayOf(0x7b, 0xff.toByte(), 0x7d)))
            )
            api.enqueue("""{"value": 1} trailing""")
            api.enqueue("""[1]""")
            api.enqueue("""{"value": "1"}""")
            api.enqueue("")
            repeat(7) {
                val error = failureOf { api.transport().post() }
                assertEquals(TileflowServiceErrorKind.INVALID_RESPONSE, error.kind)
                assertEquals(200, error.status)
            }
        }
    }

    @Test
    fun errorAnswersAreTrustedOnlyWithTheirStatus() {
        val errors = errors(codeless = setOf(429))
        fun read(status: Int, body: String?, retryAfter: Long? = null) =
            errors.rejection(status, body?.let { JSONObject(it) }, retryAfter)

        val trusted =
            read(403, """{"code":"TEST_DENIED","error":" Denied. ","requestId":"r-1"}""", 5)
        assertEquals(Code.DENIED, trusted.code)
        assertEquals("Denied.", trusted.message)
        assertEquals("r-1", trusted.requestId)
        assertEquals(5L, trusted.retryAfterSeconds)
        assertEquals(TileflowServiceErrorKind.REJECTED, trusted.kind)
        assertEquals(Code.DENIED, read(401, """{"code":"TEST_DENIED","error":"Denied."}""").code)
        for (generic in
            listOf(
                read(400, """{"code":"TEST_DENIED","error":"Denied."}"""),
                read(401, """{"code":"TEST_LIMITED","error":"Limited."}"""),
                read(403, """{"code":"OTHER","error":"Other."}"""),
                read(403, """{"code":null,"error":"Denied."}"""),
                read(403, """{"code":"TEST_DENIED","error":"   "}"""),
                read(403, """{"code":"TEST_DENIED","error":"Line\u0007"}"""),
                read(403, """{"code":"TEST_DENIED","error":"Denied.","requestId":"-r"}"""),
                read(403, """{"code":"TEST_DENIED","error":"Denied.","requestId":null}"""),
                read(403, """{"code":"TEST_DENIED","error":"${"x".repeat(513)}"}"""),
                read(403, """{"error":"Denied."}"""),
                read(429, """{"code":"TEST_DENIED","error":"Denied."}"""),
                read(500, null),
            )) {
            assertNull(generic.code)
            assertNull(generic.requestId)
            assertEquals(errors.failedMessage, generic.message)
        }
        val codeless = read(429, """{"error":"Slow down.","requestId":"r2"}""")
        assertNull(codeless.code)
        assertEquals("Slow down.", codeless.message)
        assertEquals("r2", codeless.requestId)
    }

    @Test
    fun retryAfterIsADelayInSeconds() {
        assertEquals(60L, TileflowServiceErrors.retryAfterSeconds("60"))
        assertEquals(0L, TileflowServiceErrors.retryAfterSeconds("0"))
        assertEquals(31_536_000L, TileflowServiceErrors.retryAfterSeconds("31536000"))
        for (value in
            listOf(null, "", "31536001", "123456789", "-1", "1.5", " 5", "Wed, 28 Oct 2026"))
            assertNull(TileflowServiceErrors.retryAfterSeconds(value))
    }

    @Test
    fun cancellationCancelsTheCall() = runBlocking {
        StubApi().use { api ->
            api.server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val client = OkHttpClient()
            val call =
                async(Dispatchers.Default, CoroutineStart.UNDISPATCHED) {
                    api.transport(client = client).post()
                }
            api.take()
            call.cancel()
            val error = failure<CancellationException> {
                runBlocking { withTimeout(5_000) { call.await() } }
            }
            assertTrue(error !is TimeoutCancellationException)
            assertTrue(call.isCancelled)
            withTimeout(5_000) {
                while (client.dispatcher.runningCallsCount() > 0) delay(10)
            }
        }
    }
}
