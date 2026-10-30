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
 * session, with a network it starts its session and revalidates pack entries instead of downloading
 * them, and with the network switched off every request is answered from stored entries alone.
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
        val (loader, sessions, resources) = loader(storedPacks(), reachable = false)
        val response = loader.load(style)
        assertEquals(200, response.status)
        assertArrayEquals(styleBody, response.bytes)
        assertEquals("application/json", response.headers["Content-Type"])
        assertEquals("no-store", response.headers["Cache-Control"])
        assertTrue("No session starts", sessions.requests.isEmpty())
        assertTrue(resources.requests.isEmpty())
    }

    @Test
    fun withANetworkAHostedMapStartsItsSessionAndRevalidatesItsPack() {
        val (loader, sessions, resources) = loader(storedPacks(), reachable = true)
        val response = loader.load(tile)
        assertEquals(200, response.status)
        assertArrayEquals("The unchanged stored copy answers, decoded", tileBody, response.bytes)
        assertEquals(listOf("/v1/sessions/start"), sessions.requests.map { it.url.encodedPath })
        val request = resources.requests.single()
        assertNotNull(request.header("X-Tileflow-Native-Grant"))
        // The tag names the body as the route serves it, compressed.
        assertEquals("\"${sha256Hex(tileGzip)}\"", request.header("If-None-Match"))
    }

    @Test
    fun anUnreachableServiceFallsBackToThePack() {
        val (loader, sessions, _) = loader(storedPacks(), reachable = true, sessionsFail = true)
        assertArrayEquals(styleBody, loader.load(style).bytes)
        assertFalse(sessions.requests.isEmpty())
    }

    @Test
    fun withTheNetworkOffOnlyStoredEntriesAnswerAndMissesAnswerAtOnce() {
        val packs = storedPacks()
        val landmarkBody = pin(landmarks, ResourceCacheScope.Shared)
        // Stored, but no available region holds it, as after access to its region ended.
        val (loader, sessions, resources) =
            loader(packs.copy(tiles = emptyMap()), reachable = true, networkEnabled = false)
        val started = System.nanoTime()
        assertArrayEquals(styleBody, loader.load(style).bytes)
        assertArrayEquals(landmarkBody, loader.load(landmarks).bytes)
        assertEquals(504, loader.load(tile).status)
        assertEquals(504, loader.load(landmarks, range = "bytes=0-10").status)
        assertTrue("Nothing waits for the network", System.nanoTime() - started < 2_000_000_000)
        assertTrue(sessions.requests.isEmpty())
        assertTrue(resources.requests.isEmpty())

        // With the region's tiles: a stored tile answers decoded, a covered tile the archive does
        // not store answers as the source does online, and a tile outside the cover is a miss.
        val (tiles, _, _) = loader(packs, reachable = true, networkEnabled = false)
        val stored = tiles.load(tile)
        assertEquals(200, stored.status)
        assertArrayEquals(tileBody, stored.bytes)
        val absent = tiles.load(template.url(OfflineTileId(2, 1, 1)))
        assertEquals(404, absent.status)
        assertEquals(0, absent.bytes.size)
        assertEquals(504, tiles.load(template.url(OfflineTileId(2, 3, 3))).status)
        // Above the downloaded zooms inside the region, the renderer overzooms the deepest tile.
        assertEquals(404, tiles.load(template.url(OfflineTileId(4, 4, 4))).status)
        assertEquals(504, tiles.load(template.url(OfflineTileId(4, 15, 15))).status)
    }

    private val template =
        OfflineTileTemplate.of("https://tiles.tileflow.test/tiles/world/release-1/{z}/{x}/{y}.pbf")!!
    private val styleBody = """{"version":8}""".toByteArray()
    private val tileBody = "tile 1/0/0".toByteArray()
    private val tileGzip = OfflinePackBuilder.gzip(tileBody)

    /**
     * A style in a document pack and tile 1/0/0 in a tile pack of a region over the north-western
     * quarter.
     */
    private fun storedPacks(): OfflineServedPacks {
        fun write(kind: OfflinePackKind, entries: List<OfflinePackBuilder.Entry>): File {
            val data = OfflinePackBuilder.build(kind, entries)
            return File(directory, "${data.size}-${kind.code}.tfpack").also {
                it.writeBytes(data)
                OfflinePackFormat.verify(it, data.size.toLong(), kind)
            }
        }
        val documents =
            write(
                OfflinePackKind.DOCUMENTS,
                listOf(OfflinePackBuilder.Entry(style.toString(), "application/json", null, styleBody)),
            )
        val tiles =
            write(
                OfflinePackKind.TILES,
                listOf(OfflinePackBuilder.Entry("1/0/0", "application/x-protobuf", "gzip", tileGzip)),
            )
        val entry = OfflinePackFormat.index(documents).entries.getValue(style.toString())
        return OfflineServedPacks(
            mapOf(style.toString() to (documents to entry)),
            mapOf(
                template.text to
                    OfflineServedTiles(
                        template,
                        0..2,
                        404,
                        listOf(OfflinePackRegion.canonical(-170.0, 1.0, -10.0, 80.0)!!),
                        mapOf(OfflineTileId(0, 0, 0) to listOf(tiles)),
                    )
            ),
        )
    }

    private fun pin(url: URI, scope: ResourceCacheScope): ByteArray {
        val body = "$url body".toByteArray()
        val metadata =
            ResourceCacheMetadata.of(
                url,
                200,
                mapOf(
                    "ETag" to "\"${sha256Hex(body)}\"",
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

    private fun loader(
        packs: OfflineServedPacks,
        reachable: Boolean,
        networkEnabled: Boolean = true,
        sessionsFail: Boolean = false,
    ): Triple<ResourceLoader, RecordingTransport, RecordingTransport> {
        val index = OfflineServingIndex()
        index.publish(OfflineServingSnapshot(packs = mapOf(scope.directory to packs)), this)
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
