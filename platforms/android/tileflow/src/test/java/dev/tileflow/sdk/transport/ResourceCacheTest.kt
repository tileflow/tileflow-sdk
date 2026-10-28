package dev.tileflow.sdk.transport

import dev.tileflow.sdk.TileflowDeviceProfile
import dev.tileflow.sdk.TileflowGpuClass
import dev.tileflow.sdk.TileflowMapOptions
import dev.tileflow.sdk.TileflowQuality
import dev.tileflow.sdk.TileflowResourceClass
import java.io.File
import java.net.URI
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import okhttp3.Request
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class ResourceCacheTest {
    private val root: File = Files.createTempDirectory("tileflow-cache").toFile()
    private val clock = AtomicLong(1_800_000_000_000)
    private val origin = "https://maps.example.com"

    @After
    fun cleanUp() {
        root.deleteRecursively()
    }

    private fun store(budget: Long = 1L shl 20) =
        ResourceCacheStore(File(root, "ambient"), File(root, "durable"), budget) { clock.get() }

    private fun loader(cache: ResourceCacheStore, transport: RecordingTransport) =
        ResourceLoader(
            ResourcePolicy(setOf(origin)),
            transport = transport,
            cache = cache,
            date = { clock.get() },
        )

    private fun url(path: String) = URI(origin + path)

    private fun payload(body: String, status: Int = 200, headers: Map<String, String> = emptyMap()) =
        ResourcePayload(body.toByteArray(), status, headers)

    @Test
    fun noStoreResponsesAreNeverWritten() {
        val cache = store()
        for (header in listOf("no-store", "private, no-store", "public, max-age=60, no-store")) {
            val transport = RecordingTransport { payload("tile", headers = mapOf("Cache-Control" to header)) }
            val resources = loader(cache, transport)
            repeat(2) {
                val result = resources.load(url("/tiles/1/0/0.pbf"))
                assertEquals("tile", result.bytes.decodeToString())
                assertEquals("no-store", result.headers["Cache-Control"])
            }
            assertEquals(header, 2, transport.requests.size)
        }
        cache.settle()
        assertEquals(0, cache.usage().entries)
        assertFalse(File(root, "ambient/shared").exists())
    }

    @Test
    fun freshResponsesAnswerLaterMountsWithoutTheNetwork() {
        val cache = store()
        val transport = RecordingTransport {
            payload(
                "style",
                headers =
                    mapOf(
                        "Cache-Control" to "public, max-age=60",
                        "ETag" to "\"a\"",
                        "Content-Type" to "application/json",
                    ),
            )
        }
        loader(cache, transport).use { it.load(url("/style.json")) }
        val offline = loader(cache, RecordingTransport { throw NetworkUnavailableException() })
        val result = offline.load(url("/style.json"))
        assertEquals("style", result.bytes.decodeToString())
        assertEquals("application/json", result.headers["Content-Type"])
        assertEquals("no-store", result.headers["Cache-Control"])
        assertEquals("5", result.headers["Content-Length"])
        assertEquals(1, transport.requests.size)
        val usage = cache.usage()
        assertEquals(1, usage.entries)
        assertTrue((usage.bytesByClass[TileflowResourceClass.STYLE] ?: 0) > 5)
    }

    @Test
    fun staleResponsesAreRevalidatedWithTheirValidators() {
        val cache = store()
        val modified = "Wed, 21 Oct 2026 07:28:00 GMT"
        val transport = RecordingTransport { request ->
            if (request.header("If-None-Match") == "\"v1\"")
                payload("", 304, mapOf("Cache-Control" to "max-age=100", "ETag" to "\"v1\""))
            else
                payload(
                    "v1",
                    headers =
                        mapOf(
                            "Cache-Control" to "max-age=10",
                            "ETag" to "\"v1\"",
                            "Last-Modified" to modified,
                        ),
                )
        }
        val resources = loader(cache, transport)
        val address = url("/sprite.json")
        resources.load(address)
        clock.addAndGet(20_000)
        val revalidated = resources.load(address)
        assertEquals(200, revalidated.status)
        assertEquals("v1", revalidated.bytes.decodeToString())
        assertEquals(2, transport.requests.size)
        assertEquals(modified, transport.requests[1].header("If-Modified-Since"))
        clock.addAndGet(50_000)
        resources.load(address)
        assertEquals(2, transport.requests.size)
        clock.addAndGet(60_000)
        resources.load(address)
        assertEquals(3, transport.requests.size)
    }

    @Test
    fun storedPublicResponsesAnswerWhenTheNetworkFails() {
        val cache = store()
        val headers =
            mapOf(
                "/tiles/2/1/1.pbf" to mapOf("Cache-Control" to "max-age=0", "ETag" to "\"t\""),
                "/plain.json" to emptyMap(),
                "/strict.json" to
                    mapOf("Cache-Control" to "max-age=0, must-revalidate", "ETag" to "\"s\""),
                "/validate.json" to mapOf("Cache-Control" to "no-cache", "ETag" to "\"n\""),
                "/short.json" to
                    mapOf("Cache-Control" to "max-age=0, stale-if-error=5", "ETag" to "\"x\""),
            )
        val online = loader(cache, RecordingTransport { payload(it.url.encodedPath, headers = headers.getValue(it.url.encodedPath)) })
        for (path in headers.keys) online.load(url(path))
        clock.addAndGet(10_000)
        val failing = loader(cache, RecordingTransport { throw NetworkUnavailableException() })
        val unavailable = loader(cache, RecordingTransport { payload("", 503) })
        for (path in listOf("/tiles/2/1/1.pbf", "/plain.json")) {
            assertEquals(path, failing.load(url(path)).bytes.decodeToString())
            assertEquals(path, unavailable.load(url(path)).bytes.decodeToString())
        }
        for (path in listOf("/strict.json", "/validate.json", "/short.json")) {
            assertThrows(NetworkUnavailableException::class.java) { failing.load(url(path)) }
            assertEquals(503, unavailable.load(url(path)).status)
        }
    }

    @Test
    fun rangeHeadAndFailedRequestsBypassTheCache() {
        val cache = store()
        val transport = RecordingTransport { request ->
            val status =
                when {
                    request.header("Range") != null -> 206
                    request.url.encodedPath == "/missing.json" -> 404
                    else -> 200
                }
            payload("x", status, mapOf("Cache-Control" to "max-age=60"))
        }
        val resources = loader(cache, transport)
        repeat(2) {
            resources.load(url("/archive.pmtiles"), range = "bytes=0-1")
            resources.load(url("/archive.pmtiles"), method = "HEAD")
            resources.load(url("/missing.json"))
        }
        assertEquals(6, transport.requests.size)
        cache.settle()
        assertEquals(0, cache.usage().entries)
    }

    @Test
    fun leastRecentlyUsedEntriesAreEvictedWithinTheBudget() {
        val cache = store()
        val keys = (0 until 7).map { ResourceCacheKey(url("/tiles/3/$it/0.pbf"), ResourceCacheScope.Shared) }
        clock.addAndGet(1_000)
        assertTrue(write(cache, keys[0], 400))
        cache.settle()
        val size = cache.usage().bytes
        cache.maximumBytes = size * 6 + size / 2
        for (key in keys.subList(1, 6)) {
            clock.addAndGet(1_000)
            assertTrue(write(cache, key, 400))
        }
        clock.addAndGet(1_000)
        assertNotNull("Reading refreshes last use", cache.read(keys[0], ResourceCacheRetention.AMBIENT))
        clock.addAndGet(1_000)
        assertTrue(write(cache, keys[6], 400))
        cache.settle()
        assertTrue(cache.usage().bytes <= cache.maximumBytes / 10 * 9)
        assertNull(cache.read(keys[1], ResourceCacheRetention.AMBIENT))
        assertNull(cache.read(keys[2], ResourceCacheRetention.AMBIENT))
        for (key in listOf(keys[0], keys[3], keys[6]))
            assertNotNull(cache.read(key, ResourceCacheRetention.AMBIENT))
        // One entry may use at most an eighth of the budget.
        assertFalse(write(cache, ResourceCacheKey(url("/big.glb"), ResourceCacheScope.Shared), 600))
    }

    @Test
    fun pinnedEntriesAreNeitherEvictedNorClearedAndAnswerOffline() {
        val cache = store(2_000)
        val pinned = ResourceCacheKey(url("/tiles/4/0/0.pbf"), ResourceCacheScope.Shared)
        assertTrue(write(cache, pinned, 5_000, ResourceCacheRetention.PINNED, mapOf("ETag" to "\"p\"")))
        repeat(10) {
            write(cache, ResourceCacheKey(url("/tiles/5/$it/0.pbf"), ResourceCacheScope.Shared), 200)
        }
        cache.clear()
        cache.settle()
        assertEquals(0, cache.usage().entries)
        assertNotNull(cache.read(pinned, ResourceCacheRetention.PINNED))
        clock.addAndGet(365L * 24 * 60 * 60 * 1000)
        val offline = loader(cache, RecordingTransport { throw NetworkUnavailableException() })
        assertEquals(5_000, offline.load(pinned.url).bytes.size)
        val online = RecordingTransport { payload("", 304, mapOf("Cache-Control" to "max-age=60")) }
        loader(cache, online).load(pinned.url)
        assertEquals("\"p\"", online.requests.first().header("If-None-Match"))
        cache.removePinned(listOf(pinned))
        assertNull(cache.read(pinned, ResourceCacheRetention.PINNED))
    }

    @Test
    fun corruptedAndMisplacedEntriesAreDropped() {
        val cache = store()
        val keys = (0 until 3).map { ResourceCacheKey(url("/glyphs/Noto/$it.pbf"), ResourceCacheScope.Shared) }
        for (key in keys) assertTrue(write(cache, key, 64))
        val flipped = cache.file(keys[0], ResourceCacheRetention.AMBIENT)
        val bytes = flipped.readBytes()
        bytes[3] = (bytes[3].toInt() xor 0xff).toByte()
        flipped.writeBytes(bytes)
        val truncated = cache.file(keys[1], ResourceCacheRetention.AMBIENT)
        truncated.writeBytes(truncated.readBytes().copyOf(truncated.length().toInt() - 5))
        val misplaced = ResourceCacheKey(url("/glyphs/Noto/9.pbf"), ResourceCacheScope.Shared)
        val target = cache.file(misplaced, ResourceCacheRetention.AMBIENT)
        target.parentFile!!.mkdirs()
        cache.file(keys[2], ResourceCacheRetention.AMBIENT).copyTo(target)
        for (key in listOf(keys[0], keys[1], misplaced)) {
            assertNull(cache.read(key, ResourceCacheRetention.AMBIENT))
            assertFalse(cache.file(key, ResourceCacheRetention.AMBIENT).exists())
        }
        assertEquals(3, cache.droppedEntries)
        assertNotNull(cache.read(keys[2], ResourceCacheRetention.AMBIENT))
    }

    @Test
    fun partitionsSeparateScopesAndResourceClasses() {
        val classes =
            mapOf(
                "/maps/m/native/v3/light.json" to TileflowResourceClass.STYLE,
                "/tiles/world/tiles.json" to TileflowResourceClass.STYLE,
                "/tiles/world/release/12/2048/1361.pbf" to TileflowResourceClass.TILES,
                "/terrain/9/1/2.webp" to TileflowResourceClass.TILES,
                "/fonts/Noto%20Sans/0-255.pbf" to TileflowResourceClass.GLYPHS,
                "/fonts/noto.woff2" to TileflowResourceClass.GLYPHS,
                "/sprites/streets/sprite@2x.png" to TileflowResourceClass.SPRITES,
                "/sprites/streets/sprite.json" to TileflowResourceClass.SPRITES,
                "/landmarks/tiles/abc.glb" to TileflowResourceClass.MODELS,
                "/team-models/tmd_x/current.glb" to TileflowResourceClass.MODELS,
                "/notice.txt" to TileflowResourceClass.OTHER,
            )
        for ((path, expected) in classes)
            assertEquals(path, expected, TileflowResourceClass.classify(url(path)))
        val scope = ResourceCacheScope.grant(URI("https://api.tileflow.dev"), "map_0123456789abcdef")
        assertEquals(32, (scope as ResourceCacheScope.Grant).id.length)
        assertFalse(scope.directory.contains("map_"))
        val protected = ResourceCacheKey(url("/tiles/6/1/1.pbf"), scope)
        assertTrue(protected.relativePath.startsWith("grant-${scope.id}/tiles/"))
        val cache = store()
        assertTrue(write(cache, protected, 10))
        assertNull(cache.read(ResourceCacheKey(protected.url, ResourceCacheScope.Shared), ResourceCacheRetention.AMBIENT))
        cache.clear(scope)
        assertNull(cache.read(protected, ResourceCacheRetention.AMBIENT))
    }

    @Test
    fun protectedResponsesNeedExplicitFreshnessAndAreNeverServedStale() {
        assertFalse(ResourceCachePolicy.isStorable(200, emptyMap(), protected = true))
        assertTrue(ResourceCachePolicy.isStorable(200, emptyMap(), protected = false))
        assertTrue(ResourceCachePolicy.isStorable(200, mapOf("Cache-Control" to "private, max-age=60"), true))
        assertFalse(ResourceCachePolicy.isStorable(200, mapOf("Cache-Control" to "private, no-store"), true))
        assertFalse(ResourceCachePolicy.isStorable(200, mapOf("Vary" to "Origin, *"), false))
        val now = 1_800_000_000_000
        val modified = mapOf("Last-Modified" to HttpDate.format(now - 100_000_000))
        assertEquals(now, ResourceCachePolicy.expiry(modified, now, true))
        assertEquals(now + 10_000_000, ResourceCachePolicy.expiry(modified, now, false))
        assertEquals(now + 60_000, ResourceCachePolicy.staleLimit(emptyMap(), now + 60_000, true))
        assertEquals(
            now + 60_000 + ResourceCachePolicy.DEFAULT_STALE_IF_ERROR_MILLIS,
            ResourceCachePolicy.staleLimit(emptyMap(), now + 60_000, false),
        )
    }

    @Test
    fun freshnessFollowsCacheControlExpiresAndAge() {
        val now = 1_800_000_000_000
        fun lifetime(headers: Map<String, String>) =
            ResourceCachePolicy.expiry(headers, now, protected = false) - now
        assertEquals(300_000, lifetime(mapOf("Cache-Control" to "public, max-age=300")))
        assertEquals(200_000, lifetime(mapOf("Cache-Control" to "max-age=300", "Age" to "100")))
        assertEquals(0, lifetime(mapOf("Cache-Control" to "max-age=300, no-cache")))
        assertEquals(0, lifetime(mapOf("Cache-Control" to "max-age=abc")))
        assertEquals(
            90_000,
            lifetime(mapOf("Date" to HttpDate.format(now), "Expires" to HttpDate.format(now + 90_000))),
        )
        assertEquals(
            ResourceCachePolicy.MAXIMUM_HEURISTIC_LIFETIME_MILLIS,
            lifetime(mapOf("Last-Modified" to HttpDate.format(now - 10_000_000_000))),
        )
        assertEquals(
            mapOf("Content-Type" to "a", "ETag" to "2"),
            ResourceCachePolicy.merging(
                mapOf("Content-Type" to "a", "ETag" to "1"),
                mapOf("Content-Type" to "b", "ETag" to "2"),
            ),
        )
    }

    @Test
    fun clearRemovesEntriesAndDiscardsWritesInFlight() {
        val cache = store()
        val key = ResourceCacheKey(url("/models/a.glb"), ResourceCacheScope.Shared)
        assertTrue(write(cache, key, 32))
        val pendingUrl = url("/models/b.glb")
        val pending = cache.writer(ResourceCacheKey(pendingUrl, ResourceCacheScope.Shared), ResourceCacheRetention.AMBIENT)!!
        pending.append(ByteArray(32) { 1 }, 0, 32)
        cache.clear()
        val (length, sha) = pending.body
        assertFalse(pending.commit(metadata(pendingUrl, length, sha)))
        cache.settle()
        assertEquals(ResourceCacheStore.Usage(), cache.usage())
        assertNull(cache.read(key, ResourceCacheRetention.AMBIENT))
        assertTrue("The store accepts writes after clearing", write(cache, key, 32))
    }

    @Test
    fun usageIsRebuiltFromDiskAndStagingIsEmptied() {
        val first = store()
        repeat(4) {
            assertTrue(write(first, ResourceCacheKey(url("/tiles/7/$it/1.pbf"), ResourceCacheScope.Shared), 100))
        }
        val leftover = File(root, "ambient/staging/earlier/partial")
        leftover.parentFile!!.mkdirs()
        leftover.writeBytes(byteArrayOf(1, 2, 3))
        first.settle()
        val expected = first.usage()
        val second = store()
        second.settle()
        assertEquals(expected, second.usage())
        assertEquals(expected.bytes, second.usage().bytesByClass[TileflowResourceClass.TILES])
        assertFalse(leftover.exists())
    }

    @Test
    fun streamedBodiesAreStoredOnlyWhenComplete() {
        val cache = store()
        val transport = RecordingTransport { payload("streamed body", headers = mapOf("Cache-Control" to "max-age=60")) }
        val resources = loader(cache, transport)
        resources.open(url("/tiles/8/0/0.pbf")).body.use { it.read(ByteArray(4)) }
        cache.settle()
        assertEquals("A body closed early is not stored", 0, cache.usage().entries)
        resources.open(url("/tiles/8/0/0.pbf")).body.use { it.readBytes() }
        cache.settle()
        assertEquals(1, cache.usage().entries)
    }

    @Test
    fun deviceProfilesScaleQualityAndCache() {
        val gigabyte = 1L shl 30
        val low = TileflowDeviceProfile.recommended(2 * gigabyte, false, 0)
        assertTrue(low.isLowRamDevice)
        assertEquals(TileflowGpuClass.LOW, low.gpuClass)
        assertEquals(TileflowQuality.LOW, low.quality)
        assertEquals(64L shl 20, low.cacheBytes)
        val flagged = TileflowDeviceProfile.recommended(6 * gigabyte, true, 0)
        assertEquals(TileflowQuality.LOW, flagged.quality)
        val standard = TileflowDeviceProfile.recommended(4 * gigabyte, false, 0)
        assertEquals(TileflowGpuClass.STANDARD, standard.gpuClass)
        assertEquals(TileflowQuality.BALANCED, standard.quality)
        assertEquals(256L shl 20, standard.cacheBytes)
        val performance = TileflowDeviceProfile.recommended(6 * gigabyte, false, 33)
        assertEquals(TileflowGpuClass.HIGH, performance.gpuClass)
        assertEquals(TileflowQuality.BALANCED, performance.quality)
        assertEquals(512L shl 20, performance.cacheBytes)
        val high = TileflowDeviceProfile.recommended(8 * gigabyte, false, 0)
        assertEquals(TileflowQuality.HIGH, high.quality)
        // An explicit quality wins over the profile; null follows it.
        val context = org.robolectric.RuntimeEnvironment.getApplication()
        TileflowDeviceProfile.override(context, low)
        try {
            assertEquals("low", TileflowMapOptions().json().getString("quality"))
            assertEquals("high", TileflowMapOptions(quality = TileflowQuality.HIGH).json().getString("quality"))
        } finally {
            TileflowDeviceProfile.override(context, null)
        }
    }

    private fun metadata(
        url: URI,
        length: Int,
        sha: String,
        headers: Map<String, String> = mapOf("Cache-Control" to "max-age=60"),
    ) = ResourceCacheMetadata.of(url, 200, headers, clock.get(), false, length, sha)

    private fun write(
        cache: ResourceCacheStore,
        key: ResourceCacheKey,
        count: Int,
        retention: ResourceCacheRetention = ResourceCacheRetention.AMBIENT,
        headers: Map<String, String> = mapOf("Cache-Control" to "max-age=60"),
    ): Boolean {
        val body = ByteArray(count) { (it % 251).toByte() }
        return cache.write(key, retention, metadata(key.url, body.size, sha256Hex(body), headers), body)
    }
}

internal class RecordingTransport(private val respond: (Request) -> ResourcePayload) :
    NativeHTTPTransporting {
    val requests = CopyOnWriteArrayList<Request>()
    val closed = AtomicInteger()

    override fun send(request: Request, timeoutMillis: Long): ResourcePayload {
        requests.add(request)
        return respond(request)
    }

    override fun cancelActive() {}

    override fun close() {
        closed.incrementAndGet()
    }
}
