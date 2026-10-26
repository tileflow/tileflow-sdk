package dev.tileflow.sdk.hosted

import dev.tileflow.sdk.TileflowClient
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.transport.NativeHTTPTransporting
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourcePayload
import dev.tileflow.sdk.transport.ResourcePolicy
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import okhttp3.Request
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class HostedSessionTest {
    private val mapId = "map_0123456789abcdef"
    private val style = URI("https://api.tileflow.test/maps/$mapId/mobile/webview-v1/v1/day.json")
    private val policy =
        ResourcePolicy(setOf("https://api.tileflow.test", "https://public.example"))

    @Test
    fun sharedAuthorityAndResourceCases() {
        val fixture = fixture()
        val response = fixture.getJSONObject("response")
        val authority =
            HostedContract.parse(
                response.toString().toByteArray(),
                mapId,
                "fixture-session",
                "mobile-map",
            )
        for ((key, expected) in listOf("allowedResources" to true, "deniedResources" to false)) {
            val urls = fixture.getJSONArray(key)
            for (i in 0 until urls.length()) {
                val url = urls.getString(i)
                assertEquals(url, expected, HostedContract.permits(URI(url), mapId, authority))
            }
        }
        for ((key, value) in
            listOf(
                "extra" to true,
                "ok" to 1,
                "version" to true,
                "credentialRevision" to 0,
                "deliveryPolicyRevision" to 1.5,
                "mapId" to "map_1111111111111111",
                "sessionId" to "foreign",
                "surfaceId" to "foreign",
                "issuedAt" to "2026-10-20T13:00:00.000Z",
                "expiresAt" to "2026-10-20T12:15:01.000Z",
                "resourceOrigins" to JSONArray(listOf("https://api.tileflow.test/")),
                "resourceScopes" to JSONArray(listOf("style", "style")),
                "grant" to "bad",
            )) {
            val changed = JSONObject(response.toString()).put(key, value)
            assertCode(TileflowErrorCode.INVALID_SESSION_RESPONSE) {
                HostedContract.parse(
                    changed.toString().toByteArray(),
                    mapId,
                    "fixture-session",
                    "mobile-map",
                )
            }
        }
        assertCode(TileflowErrorCode.INVALID_SESSION_RESPONSE) {
            HostedContract.parse(byteArrayOf(0xff.toByte()), mapId, "fixture-session", "mobile-map")
        }
    }

    @Test
    fun concurrentAdmissionsShareOneSessionAndPublicResourcesReceiveNoAuthority() {
        val transport = FakeTransport { request, _ ->
            Thread.sleep(25)
            response(request)
        }
        val client = client()
        assertFalse(client.toString().contains("tf_public_"))
        val session = HostedSession(client, mapId, "mobile-map", transport = transport)
        val pool = Executors.newFixedThreadPool(8)
        try {
            val results =
                (0 until 24).map { pool.submit<String?> { session.authorize(style, policy).grant } }
            results.forEach { assertNotNull(it.get(5, TimeUnit.SECONDS)) }
            assertEquals(1, transport.requests.size)
            val request = transport.requests.single()
            assertEquals("POST", request.method)
            assertEquals("/v1/sessions/start", request.url.encodedPath)
            assertNotNull(request.header("X-Tileflow-Mobile-Client"))
            listOf("Origin", "Referer", "Cookie", "Authorization", "X-Tileflow-Native-Grant")
                .forEach {
                    assertNull(request.header(it))
                }
            assertNull(session.authorize(URI("https://public.example/model.glb"), policy).grant)
            session.close()
            assertCode(TileflowErrorCode.DISPOSED) { session.authorize(style, policy) }
        } finally {
            session.close()
            pool.shutdownNow()
        }
    }

    @Test
    fun refreshRetainsIdentityAndAgeRotatesIt() {
        val time = AtomicLong(0)
        val transport = FakeTransport { request, _ -> response(request) }
        HostedSession(client(), mapId, "mobile-map", time::get, transport).use { session ->
            session.authorize(style, policy)
            time.addAndGet(880_000)
            session.authorize(style, policy)
            time.addAndGet(21_600_000)
            session.authorize(style, policy)
            val ids = transport.requests.map { body(it).getString("sessionId") }
            assertEquals(3, ids.size)
            assertEquals(ids[0], ids[1])
            assertNotEquals(ids[1], ids[2])
        }
    }

    @Test
    fun onlyExactRestartRotatesOnceAndTerminalFailureDoesNotRetry() {
        val transport = FakeTransport { request, index ->
            if (index == 0)
                ResourcePayload(
                    JSONObject()
                        .put("code", "COMMERCIAL_SESSION_RESTART_REQUIRED")
                        .put("error", "Restart required.")
                        .put("retryWithNewSession", true)
                        .put("sessionId", body(request).getString("sessionId"))
                        .toString()
                        .toByteArray(),
                    409,
                    emptyMap(),
                )
            else response(request)
        }
        HostedSession(client(), mapId, "mobile-map", transport = transport).use { session ->
            session.authorize(style, policy)
            assertEquals(2, transport.requests.size)
            assertNotEquals(
                body(transport.requests[0]).getString("sessionId"),
                body(transport.requests[1]).getString("sessionId"),
            )
        }
        val rejected = FakeTransport { _, _ -> ResourcePayload(byteArrayOf(), 401, emptyMap()) }
        HostedSession(client(), mapId, "mobile-map", transport = rejected).use { session ->
            repeat(2) {
                assertCode(TileflowErrorCode.CREDENTIAL_REJECTED) {
                    session.authorize(style, policy)
                }
            }
            assertEquals(1, rejected.requests.size)
        }
    }

    @Test
    fun networkTimeConsumesGrantLifetimeAndLateResponseCannotReviveClosedSession() {
        val time = AtomicLong(0)
        val slow = FakeTransport { request, _ ->
            time.addAndGet(880_000)
            response(request)
        }
        HostedSession(client(), mapId, "mobile-map", time::get, slow).use { session ->
            assertCode(TileflowErrorCode.SESSION_UNAVAILABLE) { session.authorize(style, policy) }
        }
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val delayed = FakeTransport { request, _ ->
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            response(request)
        }
        val session = HostedSession(client(), mapId, "mobile-map", transport = delayed)
        val pool = Executors.newSingleThreadExecutor()
        try {
            val result = pool.submit {
                assertCode(TileflowErrorCode.DISPOSED) { session.authorize(style, policy) }
            }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            session.close()
            release.countDown()
            result.get(5, TimeUnit.SECONDS)
        } finally {
            release.countDown()
            session.close()
            pool.shutdownNow()
        }
    }

    @Test
    fun sharedSessionSequences() {
        val sequences =
            JSONObject(
                    javaClass.classLoader!!
                        .getResourceAsStream("session-sequences.json")!!
                        .bufferedReader()
                        .use { it.readText() }
                )
                .getJSONArray("scenarios")
        for (index in 0 until sequences.length()) {
            val scenario = sequences.getJSONObject(index)
            val time = AtomicLong(0)
            val transport = FakeTransport { request, _ ->
                if (scenario.getInt("status") == 201) response(request)
                else ResourcePayload(byteArrayOf(), scenario.getInt("status"), emptyMap())
            }
            HostedSession(client(), mapId, "mobile-map", time::get, transport).use { session ->
                val identities = mutableMapOf<String, String>()
                val steps = scenario.getJSONArray("steps")
                for (i in 0 until steps.length()) {
                    val step = steps.getJSONObject(i)
                    if (step.getString("op") == "advance") {
                        time.addAndGet(step.getLong("milliseconds"))
                        continue
                    }
                    if (step.has("error"))
                        assertCode(
                            mapOf(
                                    "credentialRejected" to TileflowErrorCode.CREDENTIAL_REJECTED,
                                    "accessDenied" to TileflowErrorCode.ACCESS_DENIED,
                                    "quotaExceeded" to TileflowErrorCode.QUOTA_EXCEEDED,
                                )
                                .getValue(step.getString("error"))
                        ) {
                            session.authorize(style, policy)
                        }
                    else assertNotNull(session.authorize(style, policy).grant)
                    assertEquals(
                        scenario.getString("name"),
                        step.getInt("requests"),
                        transport.requests.size,
                    )
                    if (step.has("identity")) {
                        val key = step.getString("identity")
                        val id = body(transport.requests.last()).getString("sessionId")
                        if (identities.containsKey(key)) assertEquals(identities[key], id)
                        else {
                            assertFalse(identities.containsValue(id))
                            identities[key] = id
                        }
                    }
                }
            }
        }
    }

    @Test
    fun resourceRejectionRetiresAnInFlightRefreshBeforeItCanReturnAuthority() {
        val rejections =
            JSONObject(
                    javaClass.classLoader!!
                        .getResourceAsStream("session-sequences.json")!!
                        .bufferedReader()
                        .use { it.readText() }
                )
                .getJSONArray("resourceRejections")
        for (index in 0 until rejections.length()) {
            val rejection = rejections.getJSONObject(index)
            val status = rejection.getInt("status")
            val expected =
                mapOf(
                        "credentialRejected" to TileflowErrorCode.CREDENTIAL_REJECTED,
                        "accessDenied" to TileflowErrorCode.ACCESS_DENIED,
                        "quotaExceeded" to TileflowErrorCode.QUOTA_EXCEEDED,
                    )
                    .getValue(rejection.getString("error"))
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            val transport = FakeTransport { request, _ ->
                started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                response(request)
            }
            val session = HostedSession(client(), mapId, "mobile-map", transport = transport)
            val pool = Executors.newFixedThreadPool(2)
            try {
                val result = pool.submit {
                    assertCode(expected) { session.authorize(style, policy) }
                }
                assertTrue(started.await(5, TimeUnit.SECONDS))
                pool.submit { session.reject(status) }.get(1, TimeUnit.SECONDS)
                release.countDown()
                result.get(5, TimeUnit.SECONDS)
                assertCode(expected) { session.authorize(style, policy) }
                assertEquals(1, transport.requests.size)
            } finally {
                release.countDown()
                session.close()
                pool.shutdownNow()
            }
        }
    }

    @Test
    fun publicMetadataAndThirdPartyBytesUseProviderWithoutGrantLeakage() {
        val client = client()
        val source =
            client.map(
                mapId,
                surfaceId = "mobile-map",
                publicResourceOrigins = setOf(URI("https://public.example")),
            )
        val sessionTransport = FakeTransport { request, _ -> response(request) }
        val resourceTransport = FakeTransport { _, _ ->
            ResourcePayload(byteArrayOf(1, 2), 200, emptyMap())
        }
        HostedSession(client, mapId, "mobile-map", transport = sessionTransport).use { session ->
            ResourceLoader(
                    source.policy(),
                    hosted = session,
                    publicMetadataUrls = source.publicMetadataUrls,
                    transport = resourceTransport,
                )
                .use { loader ->
                    source.publicMetadataUrls.forEach { loader.load(it) }
                    assertEquals(0, sessionTransport.requests.size)
                    loader.load(style)
                    loader.load(URI("https://public.example/tile.pbf"))
                    assertEquals(1, sessionTransport.requests.size)
                    assertEquals(4, resourceTransport.requests.size)
                    for (request in resourceTransport.requests) {
                        assertNull(request.header("Authorization"))
                        assertNull(request.header("X-Tileflow-Mobile-Client"))
                        assertEquals(
                            request.url.toUri() == style,
                            request.header("X-Tileflow-Native-Grant") != null,
                        )
                    }
                    for (url in
                        listOf(
                            URI(source.manifestUrl.toString() + "?key=x"),
                            URI("https://foreign.example/tile.pbf"),
                        )) {
                        assertThrows(Exception::class.java) { loader.load(url) }
                    }
                    assertEquals(4, resourceTransport.requests.size)
                }
        }
    }

    private fun client() =
        TileflowClient(URI("https://api.tileflow.test"), "tf_public_" + "a".repeat(48))

    private fun fixture() =
        JSONObject(
            javaClass.classLoader!!
                .getResourceAsStream("native-session.json")!!
                .bufferedReader()
                .use { it.readText() }
        )

    private fun body(request: Request): JSONObject =
        JSONObject(Buffer().also { request.body!!.writeTo(it) }.readUtf8())

    private fun response(request: Request): ResourcePayload =
        ResourcePayload(
            fixture()
                .getJSONObject("response")
                .put("sessionId", body(request).getString("sessionId"))
                .toString()
                .toByteArray(),
            201,
            emptyMap(),
        )

    private fun assertCode(code: TileflowErrorCode, block: () -> Unit) {
        try {
            block()
            fail("Expected $code")
        } catch (error: TileflowMapException) {
            assertEquals(code, error.code)
        }
    }

    private class FakeTransport(private val respond: (Request, Int) -> ResourcePayload) :
        NativeHTTPTransporting {
        private val lock = Any()
        private val captured = mutableListOf<Request>()
        val requests: List<Request>
            get() = synchronized(lock) { captured.toList() }

        override fun send(request: Request, timeoutMillis: Long): ResourcePayload {
            val index = synchronized(lock) { captured.size.also { captured.add(request) } }
            return respond(request, index)
        }

        override fun cancelActive() {}

        override fun close() {}
    }
}
