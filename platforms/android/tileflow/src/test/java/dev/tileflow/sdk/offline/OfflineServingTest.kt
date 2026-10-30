package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.hosted.HostedEndpoint
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.transport.NativeHTTPTransporting
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheMetadata
import dev.tileflow.sdk.transport.ResourceCacheRetention
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceCacheStore
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourcePayload
import dev.tileflow.sdk.transport.ResourcePolicy
import dev.tileflow.sdk.transport.sha256Hex
import java.io.File
import java.io.IOException
import java.net.URI
import java.nio.file.Files
import okhttp3.Request
import okio.Buffer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * How maps use downloaded regions: a Hosted map without a network opens from its packs without a
 * session, with a network it starts its session, and with the network switched off every request is
 * answered from stored entries alone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class OfflineServingTest {
    private val mapId = "map_0123456789abcdef"
    private val api = URI("https://api.tileflow.test")
    private val style =
        URI("https://api.tileflow.test/maps/map_0123456789abcdef/mobile/webview-v1/v1/day.json")
    private val tile = URI("https://tiles.tileflow.test/tiles/world/release-1/1/0/0.pbf")
    private val landmarks = URI("https://api.tileflow.test/landmarks/tiles.json")
    private val policy =
        ResourcePolicy(setOf("https://api.tileflow.test", "https://tiles.tileflow.test"))
    private val directory: File = Files.createTempDirectory("offline-serving").toFile()
    private val cache =
        ResourceCacheStore(File(directory, "ambient"), File(directory, "durable"), 1L shl 24)
    private val scope = ResourceCacheScope.grant(api, mapId)
    private val closeables = mutableListOf<AutoCloseable>()

    @After
    fun tearDown() {
        closeables.forEach { it.close() }
        directory.deleteRecursively()
    }

    @Test
    fun withoutANetworkAHostedMapOpensFromItsPackWithoutASession() {
        val body = pin(style, scope)
        val (loader, sessions, resources) = loader(served = listOf(style), reachable = false)
        val response = loader.load(style)
        assertEquals(200, response.status)
        assertArrayEquals(body, response.bytes)
        assertEquals("no-store", response.headers["Cache-Control"])
        assertTrue("No session starts", sessions.requests.isEmpty())
        assertTrue(resources.requests.isEmpty())
    }

    @Test
    fun withANetworkAHostedMapStartsItsSessionAndRevalidatesItsPack() {
        val body = pin(style, scope)
        val (loader, sessions, resources) = loader(served = listOf(style), reachable = true)
        val response = loader.load(style)
        assertEquals(200, response.status)
        assertArrayEquals("The unchanged stored copy answers", body, response.bytes)
        assertEquals(listOf("/v1/sessions/start"), sessions.requests.map { it.url.encodedPath })
        val request = resources.requests.single()
        assertNotNull(request.header("X-Tileflow-Native-Grant"))
        assertEquals(etag(body), request.header("If-None-Match"))
    }

    @Test
    fun anUnreachableServiceFallsBackToThePack() {
        val body = pin(style, scope)
        val (loader, sessions, _) =
            loader(served = listOf(style), reachable = true, sessionsFail = true)
        assertArrayEquals(body, loader.load(style).bytes)
        assertFalse(sessions.requests.isEmpty())
    }

    @Test
    fun withTheNetworkOffOnlyStoredEntriesAnswerAndMissesAnswerAtOnce() {
        val styleBody = pin(style, scope)
        // Stored, but no available region holds it, as after access to its region ended.
        pin(tile, scope)
        val landmarkBody = pin(landmarks, ResourceCacheScope.Shared)
        val (loader, sessions, resources) =
            loader(served = listOf(style), reachable = true, networkEnabled = false)
        val started = System.nanoTime()
        assertArrayEquals(styleBody, loader.load(style).bytes)
        assertArrayEquals(landmarkBody, loader.load(landmarks).bytes)
        assertEquals(504, loader.load(tile).status)
        assertEquals(
            504,
            loader.load(URI("https://tiles.tileflow.test/tiles/world/release-1/2/1/1.pbf")).status,
        )
        assertEquals(504, loader.load(landmarks, range = "bytes=0-10").status)
        assertTrue("Nothing waits for the network", System.nanoTime() - started < 2_000_000_000)
        assertTrue(sessions.requests.isEmpty())
        assertTrue(resources.requests.isEmpty())
    }

    private fun pin(url: URI, scope: ResourceCacheScope): ByteArray {
        val body = "$url body".toByteArray()
        val metadata =
            ResourceCacheMetadata.of(
                url,
                200,
                mapOf(
                    "ETag" to etag(body),
                    "Cache-Control" to "private, no-cache",
                    "Content-Type" to "application/octet-stream",
                ),
                System.currentTimeMillis(),
                scope != ResourceCacheScope.Shared,
                body.size,
                sha256Hex(body),
            )
        assertTrue(
            cache.write(ResourceCacheKey(url, scope), ResourceCacheRetention.PINNED, metadata, body)
        )
        return body
    }

    private fun etag(body: ByteArray) = "\"${sha256Hex(body)}\""

    private fun loader(
        served: List<URI>,
        reachable: Boolean,
        networkEnabled: Boolean = true,
        sessionsFail: Boolean = false,
    ): Triple<ResourceLoader, RecordingTransport, RecordingTransport> {
        val index = OfflineServingIndex()
        index.publish(
            OfflineServingSnapshot(served.map { ResourceCacheKey(it, scope).relativePath }.toSet()),
            this,
        )
        val fixture =
            JSONObject(
                javaClass.classLoader!!
                    .getResourceAsStream("native-session.json")!!
                    .bufferedReader()
                    .use { it.readText() }
            )
        val sessions = RecordingTransport { request ->
            if (sessionsFail) throw IOException("offline")
            val body = JSONObject(Buffer().also { request.body!!.writeTo(it) }.readUtf8())
            ResourcePayload(
                fixture
                    .getJSONObject("response")
                    .put("sessionId", body.getString("sessionId"))
                    .toString()
                    .toByteArray(),
                201,
                emptyMap(),
            )
        }
        val resources = RecordingTransport { request ->
            val tag = request.header("If-None-Match")
            if (tag == null) ResourcePayload("network".toByteArray(), 200, emptyMap())
            else ResourcePayload(ByteArray(0), 304, mapOf("ETag" to tag))
        }
        val session =
            HostedSession(
                HostedEndpoint(
                    TileflowConfiguration(
                        apiOrigin = api,
                        mapCredential = TileflowCredential("tf_public_" + "a".repeat(48)),
                    )
                ),
                mapId,
                "mobile-map",
                transport = sessions,
                waitMillis = 300,
            )
        val loader =
            ResourceLoader(
                policy,
                hosted = session,
                apiOrigin = api,
                transport = resources,
                cache = cache,
                grantScope = scope,
                offline = index,
                networkEnabled = { networkEnabled },
                reachable = { reachable },
            )
        closeables.add(loader)
        closeables.add(session)
        return Triple(loader, sessions, resources)
    }

    private class RecordingTransport(private val respond: (Request) -> ResourcePayload) :
        NativeHTTPTransporting {
        private val captured = mutableListOf<Request>()
        val requests: List<Request>
            get() = synchronized(captured) { captured.toList() }

        override fun send(request: Request, timeoutMillis: Long): ResourcePayload {
            synchronized(captured) { captured.add(request) }
            return respond(request)
        }

        override fun cancelActive() {}

        override fun close() {}
    }
}
