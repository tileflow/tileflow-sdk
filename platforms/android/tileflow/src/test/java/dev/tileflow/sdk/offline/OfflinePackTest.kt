package dev.tileflow.sdk.offline

import java.io.File
import java.net.URI
import java.nio.file.Files
import java.security.MessageDigest
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * The pack format: what a verified pack must be, how its entries are read, how tile addresses map
 * to packs and back, and how a pack transfer that stops part-way resumes.
 */
class OfflinePackTest {
    private val directory: File = Files.createTempDirectory("offline-pack").toFile()

    @After
    fun tearDown() {
        directory.deleteRecursively()
    }

    @Test
    fun aVerifiedPackIsReadInPlace() {
        val tile = OfflinePackBuilder.gzip("tile 12/2005/1544".toByteArray())
        val pack =
            OfflinePackBuilder.build(
                OfflinePackKind.TILES,
                listOf(
                    OfflinePackBuilder.Entry("11/1002/772", "application/x-protobuf", "gzip", tile),
                    OfflinePackBuilder.Entry("12/2005/1544", "application/x-protobuf", "gzip", tile),
                ),
            )
        val file = write(pack)
        val (digest, index) = OfflinePackFormat.verify(file, pack.size.toLong(), OfflinePackKind.TILES)
        val expected =
            MessageDigest.getInstance("SHA-256").digest(pack.copyOf(pack.size - 32))
        assertEquals(expected.joinToString("") { "%02x".format(it) }, digest)
        assertEquals(2, index.entries.size)
        val entry = index.entries.getValue("12/2005/1544")
        assertEquals("gzip", entry.contentEncoding)
        assertArrayEquals(tile, OfflinePackFormat.body(entry, file))
        assertArrayEquals("tile 12/2005/1544".toByteArray(), OfflinePackFormat.gunzip(tile))
        assertEquals(index.entries, OfflinePackFormat.index(file).entries)
    }

    @Test
    fun damagedPacksAreRefused() {
        val pack =
            OfflinePackBuilder.build(
                OfflinePackKind.DOCUMENTS,
                listOf(
                    OfflinePackBuilder.Entry(
                        "https://api.tileflow.test/style.json",
                        "application/json",
                        null,
                        "{}".toByteArray(),
                    )
                ),
            )
        fun refused(
            data: ByteArray,
            bytes: Long = data.size.toLong(),
            kind: OfflinePackKind = OfflinePackKind.DOCUMENTS,
        ) = runCatching { OfflinePackFormat.verify(write(data), bytes, kind) }.isFailure
        assertFalse(refused(pack))
        assertTrue("Another kind", refused(pack, kind = OfflinePackKind.TILES))
        assertTrue("Not the manifest's size", refused(pack, pack.size + 1L))
        assertTrue("Cut short", refused(pack.copyOf(pack.size - 1)))
        assertTrue("A changed body", refused(pack.copyOf().also { it[it.size - 40] = 1 }))
        // Well signed but malformed: each is signed again after the change.
        fun resigned(change: (ByteArray) -> Unit): ByteArray {
            val content = pack.copyOf(pack.size - 32).also(change)
            return content + MessageDigest.getInstance("SHA-256").digest(content)
        }
        assertFalse(refused(resigned {}))
        assertTrue("Unknown version", refused(resigned { it[4] = 2 }))
        assertTrue("Unknown kind", refused(resigned { it[6] = 3 }))
        assertTrue("Reserved byte", refused(resigned { it[7] = 1 }))
        assertTrue("Reserved field", refused(resigned { it[24] = 1 }))
        assertTrue("Entry count", refused(resigned { it[8] = 2 }))
    }

    @Test
    fun entriesFillTheDataSectionInOrder() {
        val entries =
            listOf(
                OfflinePackBuilder.Entry("1/0/0", "application/x-protobuf", null, "a".toByteArray()),
                OfflinePackBuilder.Entry("1/1/0", "application/x-protobuf", null, "b".toByteArray()),
            )
        val valid = OfflinePackBuilder.build(OfflinePackKind.TILES, entries)
        OfflinePackFormat.verify(write(valid), valid.size.toLong(), OfflinePackKind.TILES)
        for (pack in
            listOf(
                OfflinePackBuilder.build(OfflinePackKind.TILES, entries, offsets = listOf(0, 0)),
                OfflinePackBuilder.build(OfflinePackKind.TILES, listOf(entries[0], entries[0])),
            )) {
            try {
                OfflinePackFormat.verify(write(pack), pack.size.toLong(), OfflinePackKind.TILES)
                fail("Refused")
            } catch (error: TileflowOfflineException) {
                assertEquals("verificationFailed", error.context.reason)
            }
        }
    }

    @Test
    fun tileAddressesAndBands() {
        assertEquals(OfflineTileId(12, 2005, 1544), OfflineTileId.ofName("12/2005/1544"))
        for (name in listOf("12/02005/1544", "1/2/0", "12/2005", "a/b/c", "23/0/0", "12/2005/1544/"))
            assertNull(name, OfflineTileId.ofName(name))
        assertEquals(OfflineTileId(16, 32_089, 24_706), OfflineTileId(17, 64_178, 49_413).ancestor(16))
        assertEquals(
            listOf(0, 0, 0, 0, 0, 0, 0, 7, 7, 7, 7, 11, 11, 11, 11, 11, 16, 16, 16, 16, 16, 21, 21),
            (0..22).map(OfflinePackBand::anchor),
        )
        assertEquals(11..15, OfflinePackBand.zooms(11))
        assertEquals(21..22, OfflinePackBand.zooms(21))
        assertNull(OfflinePackBand.zooms(12))

        val template =
            OfflineTileTemplate.of("https://api.tileflow.test/tiles/world/2026-10/{z}/{x}/{y}.pbf?map=m")!!
        val url = "https://api.tileflow.test/tiles/world/2026-10/12/2005/1544.pbf?map=m"
        assertEquals(url, template.url(OfflineTileId(12, 2005, 1544)).toString())
        assertEquals(OfflineTileId(12, 2005, 1544), template.tile(url))
        assertNull(template.tile("$url&x=1"))
        assertNull(template.tile("https://api.tileflow.test/tiles/world/2026-10/12/5000/1544.pbf?map=m"))
        assertNull("Adjacent placeholders", OfflineTileTemplate.of("https://a.test/{z}{x}/{y}"))
        assertNull("No {y}", OfflineTileTemplate.of("https://a.test/{z}/{x}"))
        assertEquals(
            OfflineTileId(4, 2, 3),
            OfflineTileTemplate.of("https://a.test/t?y={y}&x={x}&z={z}")!!.tile("https://a.test/t?y=3&x=2&z=4"),
        )
    }

    /** A transfer cut part-way, as when the worker stops, continues from where it stopped. */
    @Test
    fun anInterruptedTransferResumesFromWhereItStopped() = runBlocking<Unit> {
        val body = ByteArray(256 * 1024) { (it * 31 % 251).toByte() }
        val etag = "\"pack\""
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setHeader("ETag", etag)
                    .setHeader("Accept-Ranges", "bytes")
                    .setBody(Buffer().write(body))
                    .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY)
            )
            server.start(java.net.InetAddress.getByName("127.0.0.1"), 0)
            val fetcher = OfflineHttpFetcher(OkHttpClient.Builder().retryOnConnectionFailure(false).build())
            val destination = File(directory, "incoming/pack.tfpack")
            val request =
                OfflineFetchRequest(
                    "region/1/pack",
                    URI("http://127.0.0.1:${server.port}/pack.tfpack"),
                    mapOf("X-Tileflow-Offline-Grant" to "tf_offline_v2.a.b"),
                    destination,
                )
            try {
                fetcher.fetch(request)
                fail("The first transfer stops part-way")
            } catch (_: java.io.IOException) {}
            val partial = File(destination.path + ".part")
            assertTrue("A part was kept", partial.length() in 1 until body.size)
            val offset = partial.length().toInt()
            server.enqueue(
                MockResponse()
                    .setResponseCode(206)
                    .setHeader("ETag", etag)
                    .setHeader("Content-Range", "bytes $offset-${body.size - 1}/${body.size}")
                    .setBody(Buffer().write(body.copyOfRange(offset, body.size)))
            )
            val response = fetcher.fetch(request)
            assertEquals(200, response.status)
            assertArrayEquals(body, destination.readBytes())
            assertFalse(partial.exists())
            server.takeRequest()
            val resumed = server.takeRequest()
            assertEquals("bytes=$offset-", resumed.getHeader("Range"))
            assertEquals(etag, resumed.getHeader("If-Range"))
            assertEquals("identity", resumed.getHeader("Accept-Encoding"))
            assertEquals("tf_offline_v2.a.b", resumed.getHeader("X-Tileflow-Offline-Grant"))

            // A range the pack no longer has starts it again.
            partial.writeBytes(body)
            File(destination.path + ".part.etag").writeText(etag)
            server.enqueue(MockResponse().setResponseCode(416))
            assertEquals(416, fetcher.fetch(request).status)
            assertFalse(partial.exists())
        }
    }

    private fun write(data: ByteArray): File =
        File(directory, "${System.nanoTime()}.tfpack").also { it.writeBytes(data) }
}
