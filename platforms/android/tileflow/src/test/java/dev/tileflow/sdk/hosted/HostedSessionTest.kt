package dev.tileflow.sdk.hosted

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowMapSource
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
        for ((key, expected) in
            listOf("publicResources" to true, "nonPublicResources" to false)) {
            val urls = fixture.getJSONArray(key)
            for (i in 0 until urls.length()) {
                val url = urls.getString(i)
                assertEquals(url, expected, HostedContract.isPublicApiResource(URI(url)))
            }
        }
        val redirects = fixture.getJSONArray("redirects")
        for (i in 0 until redirects.length()) {
            val redirect = redirects.getJSONObject(i)
            assertEquals(
                redirect.optString("location"),
                redirect.optString("target").ifEmpty { null },
                HostedContract.redirect(
                        URI(redirect.getString("from")),
                        redirect.getString("location"),
                        URI("https://api.tileflow.test"),
                    )
                    ?.toString(),
            )
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
        val endpoint = endpoint()
        assertFalse(endpoint.toString().contains(mapCredential.drop(10)))
        val session = HostedSession(endpoint, mapId, "mobile-map", transport = transport)
        val pool = Executors.newFixedThreadPool(8)
        try {
            val results =
                (0 until 24).map { pool.submit<String?> { session.authorize(style, policy).grant } }
            results.forEach { assertNotNull(it.get(5, TimeUnit.SECONDS)) }
            assertEquals(1, transport.requests.size)
            val request = transport.requests.single()
            assertEquals("POST", request.method)
            assertEquals("/v1/sessions/start", request.url.encodedPath)
            assertEquals(mapCredential, request.header("X-Tileflow-Mobile-Client"))
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
    fun waitersShareOneFailedBootstrapAndGiveUpAtTheirBudget() {
        val time = AtomicLong(0)
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val transport = FakeTransport { _, _ ->
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            ResourcePayload(byteArrayOf(), 503, emptyMap())
        }
        val session =
            HostedSession(endpoint(), mapId, "mobile-map", time::get, transport, waitMillis = 200)
        val pool = Executors.newFixedThreadPool(4)
        try {
            val first = pool.submit {
                assertCode(TileflowErrorCode.SESSION_UNAVAILABLE) {
                    session.authorize(style, policy)
                }
            }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            val waitStarted = System.nanoTime()
            assertCode(TileflowErrorCode.SESSION_UNAVAILABLE) { session.authorize(style, policy) }
            assertTrue(System.nanoTime() - waitStarted < 3_000_000_000)
            val waiters =
                (0 until 3).map {
                    pool.submit {
                        assertCode(TileflowErrorCode.SESSION_UNAVAILABLE) {
                            session.authorize(style, policy)
                        }
                    }
                }
            release.countDown()
            first.get(5, TimeUnit.SECONDS)
            waiters.forEach { it.get(5, TimeUnit.SECONDS) }
            assertEquals(1, transport.requests.size)
        } finally {
            release.countDown()
            session.close()
            pool.shutdownNow()
        }
    }

    @Test
    fun refreshRetainsIdentityAndAgeRotatesIt() {
        val time = AtomicLong(0)
        val transport = FakeTransport { request, _ -> response(request) }
        HostedSession(endpoint(), mapId, "mobile-map", time::get, transport).use { session ->
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
    fun invalidatedGrantRenewsOnceWithinThirtySeconds() {
        val time = AtomicLong(0)
        val transport = FakeTransport { request, _ -> response(request) }
        HostedSession(endpoint(), mapId, "mobile-map", time::get, transport).use { session ->
            val grant = session.authorize(style, policy).grant!!
            assertTrue(session.invalidate("tf_native_v1.b3RoZXI.Z3JhbnQ"))
            session.authorize(style, policy)
            assertEquals(1, transport.requests.size)
            assertTrue(session.invalidate(grant))
            session.authorize(style, policy)
            assertEquals(2, transport.requests.size)
            // The renewed grant is refused again within 30 s: keep it instead of looping bootstrap.
            assertFalse(session.invalidate(grant))
            session.authorize(style, policy)
            assertEquals(2, transport.requests.size)
            time.addAndGet(30_000)
            assertTrue(session.invalidate(grant))
            session.authorize(style, policy)
            assertEquals(3, transport.requests.size)
        }
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val gated = FakeTransport { request, _ ->
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            response(request)
        }
        val session = HostedSession(endpoint(), mapId, "mobile-map", time::get, gated)
        val pool = Executors.newFixedThreadPool(2)
        try {
            val pending = pool.submit<String?> { session.authorize(style, policy).grant }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            // Invalidation never waits for the bootstrap that holds the admission lock.
            assertTrue(pool.submit<Boolean> { session.invalidate("x") }.get(1, TimeUnit.SECONDS))
            release.countDown()
            assertNotNull(pending.get(5, TimeUnit.SECONDS))
        } finally {
            release.countDown()
            session.close()
            pool.shutdownNow()
        }
    }

    @Test
    fun hiddenSessionHoldsBootstrapsUntilVisibleAndKeepsAValidGrant() {
        val time = AtomicLong(0)
        val transport = FakeTransport { request, _ -> response(request) }
        val session = HostedSession(endpoint(), mapId, "mobile-map", time::get, transport)
        val pool = Executors.newSingleThreadExecutor()
        try {
            session.setBackgrounded(true)
            val pending = pool.submit<String?> { session.authorize(style, policy).grant }
            Thread.sleep(100)
            assertFalse(pending.isDone)
            assertEquals(0, transport.requests.size)
            session.setBackgrounded(false)
            assertNotNull(pending.get(5, TimeUnit.SECONDS))
            assertEquals(1, transport.requests.size)
            // While hidden, a still-valid grant keeps admitting even inside its renewal margin.
            session.setBackgrounded(true)
            time.addAndGet(880_000)
            assertNotNull(session.authorize(style, policy).grant)
            assertEquals(1, transport.requests.size)
        } finally {
            session.close()
            pool.shutdownNow()
        }
        HostedSession(endpoint(), mapId, "mobile-map", time::get, transport, waitMillis = 100).use {
            it.setBackgrounded(true)
            assertCode(TileflowErrorCode.NOT_READY) { it.authorize(style, policy) }
        }
        assertEquals(1, transport.requests.size)
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
        HostedSession(endpoint(), mapId, "mobile-map", transport = transport).use { session ->
            session.authorize(style, policy)
            assertEquals(2, transport.requests.size)
            assertNotEquals(
                body(transport.requests[0]).getString("sessionId"),
                body(transport.requests[1]).getString("sessionId"),
            )
        }
        val rejected = FakeTransport { _, _ -> ResourcePayload(byteArrayOf(), 401, emptyMap()) }
        HostedSession(endpoint(), mapId, "mobile-map", transport = rejected).use { session ->
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
        HostedSession(endpoint(), mapId, "mobile-map", time::get, slow).use { session ->
            assertCode(TileflowErrorCode.SESSION_UNAVAILABLE) { session.authorize(style, policy) }
        }
        val started = CountDownLatch(1)
        val release = CountDownLatch(1)
        val delayed = FakeTransport { request, _ ->
            started.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            response(request)
        }
        val session = HostedSession(endpoint(), mapId, "mobile-map", transport = delayed)
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
        val scenarios = sequences().getJSONArray("scenarios")
        for (index in 0 until scenarios.length()) {
            val scenario = scenarios.getJSONObject(index)
            val name = scenario.getString("name")
            val replies = scenario.getJSONArray("responses")
            val time = AtomicLong(0)
            val transport = FakeTransport { request, count ->
                // Each bootstrap takes the next reply; the last one repeats.
                val reply = replies.getJSONObject(minOf(count, replies.length() - 1))
                val status = reply.getInt("status")
                // A `"$request"` session ID stands for the ID of the request the reply answers.
                val body =
                    reply.optJSONObject("body")?.let { JSONObject(it.toString()) }?.apply {
                        if (optString("sessionId") == "\$request")
                            put("sessionId", body(request).getString("sessionId"))
                    }
                if (status == 201 && !reply.has("body")) response(request)
                else
                    ResourcePayload(
                        body?.toString()?.toByteArray() ?: byteArrayOf(),
                        status,
                        reply.optJSONObject("headers")?.let { headers ->
                            headers.keys().asSequence().associateWith { headers.getString(it) }
                        } ?: emptyMap(),
                    )
            }
            HostedSession(endpoint(), mapId, "mobile-map", time::get, transport).use { session ->
                val identities = mutableMapOf<String, String>()
                val steps = scenario.getJSONArray("steps")
                for (i in 0 until steps.length()) {
                    val step = steps.getJSONObject(i)
                    when (step.getString("op")) {
                        "advance" -> {
                            time.addAndGet(step.getLong("milliseconds"))
                            continue
                        }
                        "retry" -> {
                            session.retry()
                            continue
                        }
                    }
                    if (step.has("error"))
                        assertCode(
                            fixtureErrors.getValue(step.getString("error")),
                            name,
                            reason = step.optString("reason").ifEmpty { null },
                        ) {
                            session.authorize(style, policy)
                        }
                    else assertNotNull(name, session.authorize(style, policy).grant)
                    assertEquals(name, step.getInt("requests"), transport.requests.size)
                    if (step.has("identity")) {
                        val key = step.getString("identity")
                        val id = body(transport.requests.last()).getString("sessionId")
                        if (identities.containsKey(key)) assertEquals(name, identities[key], id)
                        else {
                            assertFalse(name, identities.containsValue(id))
                            identities[key] = id
                        }
                    }
                }
            }
        }
    }

    @Test
    fun loopbackHttpApiGrantsLoopbackResourcesAndNoOtherApiDoes() {
        val local =
            fixture()
                .getJSONObject("response")
                .put("resourceOrigins", JSONArray(listOf("http://127.0.0.1:8787")))
        val transport = FakeTransport { request, _ ->
            ResourcePayload(
                JSONObject(local.toString())
                    .put("sessionId", body(request).getString("sessionId"))
                    .toString()
                    .toByteArray(),
                201,
                emptyMap(),
            )
        }
        val endpoint =
            HostedEndpoint(
                TileflowConfiguration(
                    apiOrigin = URI("http://127.0.0.1:8787"),
                    mapCredential = TileflowCredential(mapCredential),
                )
            )
        assertTrue(endpoint.isLoopbackHttp)
        assertEquals(
            "http://127.0.0.1:8787/v1/sessions/start",
            endpoint.sessionRequest(mapId, "s", "mobile-map").url.toString(),
        )
        HostedSession(endpoint, mapId, "mobile-map", transport = transport).use { session ->
            val admission =
                session.authorize(
                    URI("http://127.0.0.1:8787/maps/$mapId/mobile/webview-v1/v1/day.json"),
                    ResourcePolicy(setOf("http://127.0.0.1:8787"), allowsLoopbackHttp = true),
                )
            assertNotNull(admission.grant)
        }
        // An HTTPS API never grants an HTTP origin.
        HostedSession(endpoint(), mapId, "mobile-map", transport = transport).use { session ->
            assertCode(TileflowErrorCode.INVALID_SESSION_RESPONSE) {
                session.authorize(style, policy)
            }
        }
        // A local API grants only loopback HTTP origins in the configuration's canonical form.
        val response = fixture().getJSONObject("response")
        for ((origin, accepted) in
            listOf(
                "http://localhost:8787" to true,
                "http://[::1]:8787" to true,
                "http://api.example.test" to false,
                "http://10.0.2.2:8787" to false,
                "http://127.0.0.1:8787/" to false,
                "http://127.0.0.1:80" to false,
                "HTTP://127.0.0.1:8787" to false,
            )) {
            response.put("resourceOrigins", JSONArray(listOf(origin)))
            val parsed = runCatching {
                HostedContract.parse(
                    response.toString().toByteArray(),
                    mapId,
                    "fixture-session",
                    "mobile-map",
                    allowsLoopbackHttp = true,
                )
            }
            assertEquals(origin, accepted, parsed.isSuccess)
        }
    }

    @Test
    fun resourceRejectionRetiresAnInFlightRefreshBeforeItCanReturnAuthority() {
        for (expected in HostedContract.terminalCodes) {
            val started = CountDownLatch(1)
            val release = CountDownLatch(1)
            val transport = FakeTransport { request, _ ->
                started.countDown()
                check(release.await(5, TimeUnit.SECONDS))
                response(request)
            }
            val session = HostedSession(endpoint(), mapId, "mobile-map", transport = transport)
            val pool = Executors.newFixedThreadPool(2)
            try {
                val result = pool.submit {
                    assertCode(expected) { session.authorize(style, policy) }
                }
                assertTrue(started.await(5, TimeUnit.SECONDS))
                pool.submit { session.reject(expected) }.get(1, TimeUnit.SECONDS)
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
    fun sharedResourceReactions() {
        val tile = URI("https://tiles.tileflow.test/tiles/world/release-1/1/0/0.pbf")
        val reactions = sequences().getJSONArray("resourceReactions")
        for (index in 0 until reactions.length()) {
            val reaction = reactions.getJSONObject(index)
            val body =
                JSONObject()
                    .apply { reaction.optString("code").ifEmpty { null }?.let { put("code", it) } }
                    .toString()
                    .toByteArray()
            assertEquals(
                reaction.toString(),
                ResourceReaction.valueOf(
                    reaction.getString("reaction").replace(Regex("([A-Z])"), "_$1").uppercase()
                ),
                HostedContract.reaction(
                    reaction.getInt("status"),
                    body,
                    if (reaction.getString("resource") == "style") style else tile,
                    reaction.optBoolean("refreshed"),
                ),
            )
        }
        assertEquals(
            "NATIVE_GRANT_STALE",
            HostedContract.errorCode("""{"code":"NATIVE_GRANT_STALE"}""".toByteArray()),
        )
        assertNull(HostedContract.errorCode("<html>".toByteArray()))
    }

    @Test
    fun resourceRejectionsRenewOnceAndNeverEndTheSession() {
        val sessions = FakeTransport { request, _ -> response(request) }
        val statuses = ArrayDeque(listOf(401, 200, 403, 200))
        val resources = FakeTransport { _, _ ->
            ResourcePayload(
                """{"code":"UNSPECIFIED"}""".toByteArray(),
                synchronized(statuses) { statuses.removeFirstOrNull() ?: 200 },
                emptyMap(),
            )
        }
        val tile = URI("https://tiles.tileflow.test/tiles/world/release-1/1/0/0.pbf")
        HostedSession(endpoint(), mapId, "mobile-map", transport = sessions).use { session ->
            ResourceLoader(
                    ResourcePolicy(
                        setOf("https://api.tileflow.test", "https://tiles.tileflow.test")
                    ),
                    hosted = session,
                    transport = resources,
                )
                .use { loader ->
                    // A stale grant is renewed once and the request retried with the new grant.
                    assertEquals(200, loader.load(tile).status)
                    assertEquals(2, sessions.requests.size)
                    // A rejection renewal cannot repair reaches the renderer; the session goes on.
                    assertEquals(403, loader.load(tile).status)
                    assertEquals("Renewal is not repeated in its window", 2, sessions.requests.size)
                    assertEquals(200, loader.load(tile).status)
                    assertEquals(4, resources.requests.size)
                    resources.requests.forEach {
                        assertNotNull(it.header("X-Tileflow-Native-Grant"))
                    }
                }
        }
    }

    @Test
    fun rateLimitedResourceWaitsForRetryAfterAndOnlyQuotaStopsTheSession() {
        val time = AtomicLong(0)
        val sessions = FakeTransport { request, _ -> response(request) }
        val statuses = ArrayDeque(listOf(429, 200))
        val resources = FakeTransport { _, _ ->
            ResourcePayload(
                """{"code":"RATE_LIMITED"}""".toByteArray(),
                synchronized(statuses) { statuses.removeFirstOrNull() ?: 200 },
                mapOf("Retry-After" to "4"),
            )
        }
        HostedSession(endpoint(), mapId, "mobile-map", transport = sessions).use { session ->
            ResourceLoader(
                    policy,
                    hosted = session,
                    transport = resources,
                    now = time::get,
                    pause = { time.addAndGet(it) },
                )
                .use { loader ->
                    assertEquals(200, loader.load(style).status)
                    assertEquals(4_000L, time.get())
                    assertEquals(2, resources.requests.size)
                }
            val quota = FakeTransport { _, count ->
                if (count == 0)
                    ResourcePayload(
                        """{"code":"COMMERCIAL_SPENDING_LIMIT_REACHED"}""".toByteArray(),
                        429,
                        emptyMap(),
                    )
                else ResourcePayload(byteArrayOf(1), 200, emptyMap())
            }
            ResourceLoader(policy, hosted = session, transport = quota).use { loader ->
                assertCode(TileflowErrorCode.QUOTA_EXCEEDED) { loader.load(style) }
                assertCode(TileflowErrorCode.QUOTA_EXCEEDED) { loader.load(style) }
                // An explicit retry bootstraps again instead of reusing the refused grant.
                session.retry()
                assertEquals(200, loader.load(style).status)
                assertEquals(2, sessions.requests.size)
            }
        }
    }

    @Test
    fun supersededStyleAsksForOneReloadAndOtherwiseReachesTheRenderer() {
        val sessions = FakeTransport { request, _ -> response(request) }
        val resources = FakeTransport { _, _ ->
            ResourcePayload(
                """{"code":"NATIVE_DEPLOYMENT_SUPERSEDED"}""".toByteArray(),
                409,
                emptyMap(),
            )
        }
        val reloads = AtomicLong(0)
        HostedSession(endpoint(), mapId, "mobile-map", transport = sessions).use { session ->
            ResourceLoader(
                    policy,
                    hosted = session,
                    transport = resources,
                    onDeploymentSuperseded = {
                        reloads.incrementAndGet()
                        false
                    },
                )
                .use { loader -> assertEquals(409, loader.load(style).status) }
            assertEquals(1L, reloads.get())
            assertEquals(1, sessions.requests.size)
        }
    }

    @Test
    fun teamModelRedirectIsFollowedOnceWithoutAGrant() {
        val sessions = FakeTransport { request, _ -> response(request) }
        val version = "/team-models/tmd_0123456789abcdef/versions/tmv_0123456789abcdef.glb"
        val resources = FakeTransport { request, _ ->
            if (request.url.encodedPath == version) ResourcePayload(byteArrayOf(1), 200, emptyMap())
            else ResourcePayload(byteArrayOf(), 302, mapOf("Location" to version))
        }
        val model = URI("https://api.tileflow.test/team-models/tmd_0123456789abcdef/current.glb")
        HostedSession(endpoint(), mapId, "mobile-map", transport = sessions).use { session ->
            ResourceLoader(
                    policy,
                    hosted = session,
                    apiOrigin = URI("https://api.tileflow.test"),
                    transport = resources,
                )
                .use { loader ->
                    assertArrayEquals(byteArrayOf(1), loader.load(model).bytes)
                    assertEquals(
                        listOf(model.path, version),
                        resources.requests.map { it.url.encodedPath },
                    )
                    resources.requests.forEach {
                        assertNull(it.header("X-Tileflow-Native-Grant"))
                    }
                    assertEquals("Public Hosted resources need no session", 0, sessions.requests.size)
                    assertThrows(java.io.IOException::class.java) {
                        loader.load(URI("https://api.tileflow.test/landmarks/tiles.json"))
                    }
                }
        }
    }

    @Test
    fun failureClassificationAndRetryAfter() {
        val quota = """{"code":"COMMERCIAL_MAP_LIMIT_REACHED","error":"Limit reached"}"""
        val limiter = """{"error":"Too many requests","requestId":"req_1"}"""
        val mode = """{"code":"MOBILE_SESSION_MODE_REQUIRED","error":"Session mode"}"""
        val large = """{"code":"MOBILE_SESSION_BODY_TOO_LARGE","error":"Too large"}"""
        for ((status, body, expected) in
            listOf(
                Triple(401, "", TileflowErrorCode.CREDENTIAL_REJECTED),
                Triple(403, "", TileflowErrorCode.ACCESS_DENIED),
                Triple(404, "", TileflowErrorCode.ACCESS_DENIED),
                Triple(429, quota, TileflowErrorCode.QUOTA_EXCEEDED),
                Triple(429, limiter, TileflowErrorCode.RATE_LIMITED),
                Triple(429, "<html>", TileflowErrorCode.RATE_LIMITED),
                Triple(408, "", TileflowErrorCode.SESSION_UNAVAILABLE),
                Triple(502, "", TileflowErrorCode.SESSION_UNAVAILABLE),
                Triple(400, mode, TileflowErrorCode.SESSION_REJECTED),
                Triple(413, large, TileflowErrorCode.SESSION_REJECTED),
                Triple(400, "", TileflowErrorCode.SESSION_REJECTED),
                Triple(409, "", TileflowErrorCode.SESSION_REJECTED),
                Triple(451, "<html>", TileflowErrorCode.SESSION_REJECTED),
                Triple(302, "", TileflowErrorCode.INVALID_SESSION_RESPONSE),
                Triple(200, "", TileflowErrorCode.INVALID_SESSION_RESPONSE),
            )) {
            assertEquals("$status", expected, HostedContract.failure(status, body.toByteArray()))
            val rejection = HostedContract.rejection(status, body.toByteArray())
            assertEquals("$status", expected, rejection.code)
            assertEquals(
                "$status",
                if (body == mode) "MOBILE_SESSION_MODE_REQUIRED"
                else if (body == large) "MOBILE_SESSION_BODY_TOO_LARGE" else null,
                rejection.context.reason,
            )
            assertEquals(
                "$status",
                status.takeIf { expected == TileflowErrorCode.SESSION_REJECTED },
                rejection.context.status,
            )
            assertEquals(
                "$status",
                !expected.isRecoverable,
                expected in HostedContract.terminalCodes,
            )
            assertEquals(
                "$status",
                status in setOf(401, 403, 404, 400, 409, 413, 451) ||
                    expected == TileflowErrorCode.QUOTA_EXCEEDED,
                expected in HostedContract.terminalCodes,
            )
        }
        // Wed, 21 Oct 2015 07:28:00 GMT
        val now = 1_445_412_480_000L
        assertEquals(60_000L, HostedContract.retryAfterMillis("60", now))
        assertEquals(5_000L, HostedContract.retryAfterMillis(" 5 ", now))
        assertEquals(
            120_000L,
            HostedContract.retryAfterMillis("Wed, 21 Oct 2015 07:30:00 GMT", now),
        )
        assertEquals(0L, HostedContract.retryAfterMillis("Wed, 21 Oct 2015 07:00:00 GMT", now))
        assertEquals(900_000L, HostedContract.retryAfterMillis("86400", now))
        for (invalid in listOf(null, "", "-1", "1.5", "soon", "1".repeat(65))) {
            assertNull("$invalid", HostedContract.retryAfterMillis(invalid, now))
        }
    }

    @Test
    fun publicMetadataAndThirdPartyBytesUseProviderWithoutGrantLeakage() {
        val source =
            TileflowMapSource.hosted(
                    mapId,
                    publicResourceOrigins = setOf(URI("https://public.example")),
                    configuration = configuration(),
                )
                .loadable { error("The process configuration is not read.") }
        val endpoint = requireNotNull(source.hosted)
        val sessionTransport = FakeTransport { request, _ -> response(request) }
        val resourceTransport = FakeTransport { _, _ ->
            ResourcePayload(byteArrayOf(1, 2), 200, emptyMap())
        }
        HostedSession(endpoint, mapId, "mobile-map", transport = sessionTransport).use { session ->
            ResourceLoader(
                    source.policy,
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

    private val mapCredential = "tf_public_" + "a".repeat(48)

    /** The map credential and a different services credential, which must never reach the map. */
    private fun configuration() =
        TileflowConfiguration(
            apiOrigin = URI("https://api.tileflow.test"),
            servicesCredential = TileflowCredential("tf_public_" + "b".repeat(48)),
            mapCredential = TileflowCredential(mapCredential),
        )

    private fun endpoint() = HostedEndpoint(configuration())

    private val fixtureErrors =
        mapOf(
            "credentialRejected" to TileflowErrorCode.CREDENTIAL_REJECTED,
            "accessDenied" to TileflowErrorCode.ACCESS_DENIED,
            "quotaExceeded" to TileflowErrorCode.QUOTA_EXCEEDED,
            "rateLimited" to TileflowErrorCode.RATE_LIMITED,
            "sessionUnavailable" to TileflowErrorCode.SESSION_UNAVAILABLE,
            "invalidSessionResponse" to TileflowErrorCode.INVALID_SESSION_RESPONSE,
            "sessionRejected" to TileflowErrorCode.SESSION_REJECTED,
        )

    private fun sequences() =
        JSONObject(
            javaClass.classLoader!!
                .getResourceAsStream("session-sequences.json")!!
                .bufferedReader()
                .use { it.readText() }
        )

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

    private fun assertCode(
        code: TileflowErrorCode,
        message: String? = null,
        reason: String? = null,
        block: () -> Unit,
    ) {
        try {
            block()
            fail("Expected $code ${message.orEmpty()}")
        } catch (error: TileflowMapException) {
            assertEquals(message, code, error.code)
            assertEquals(message, reason, error.context.reason)
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
