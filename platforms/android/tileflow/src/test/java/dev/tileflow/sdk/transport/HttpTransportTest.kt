package dev.tileflow.sdk.transport

import java.io.IOException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class HttpTransportTest {
    private val server = MockWebServer()

    @After
    fun stop() {
        TileflowHttpClient.networkEnabled = true
        server.shutdown()
        assertEquals(
            "Every request released its slot",
            TileflowHttpClient.MAXIMUM_CONCURRENT_RESOURCES,
            TileflowHttpClient.resourceSlots.availablePermits(),
        )
    }

    private fun slow() =
        MockResponse()
            .setBody(Buffer().write(ByteArray(256 * 1024)))
            .throttleBody(1024, 1, TimeUnit.SECONDS)

    private fun request(path: String = "/tile") = Request.Builder().url(server.url(path)).build()

    private fun resources(maximumBytes: Int = 1 shl 20) =
        NativeHTTPTransport(maximumBytes, TileflowHttpClient.Lane.RESOURCES)

    @Test
    fun closingAStreamedBodyCancelsTheDownloadAndFreesItsSlot() {
        server.enqueue(slow().setHeader("ETag", "\"stub\""))
        server.start()
        val transport = resources()
        val stream = transport.open(request())
        assertEquals(200, stream.status)
        assertEquals("\"stub\"", stream.headers["ETag"])
        assertTrue(stream.body.read(ByteArray(16)) > 0)
        assertEquals(
            TileflowHttpClient.MAXIMUM_CONCURRENT_RESOURCES - 1,
            TileflowHttpClient.resourceSlots.availablePermits(),
        )
        stream.close()
        assertThrows(IOException::class.java) { stream.body.read(ByteArray(16)) }
        transport.close()
    }

    @Test
    fun closingATransportCancelsOnlyItsOwnRequests() {
        server.enqueue(slow())
        server.enqueue(slow())
        server.start()
        val closed = resources()
        val open = resources()
        val first = closed.open(request())
        val second = open.open(request())
        closed.close()
        assertThrows(IOException::class.java) { first.body.readBytes() }
        assertThrows(IllegalStateException::class.java) { closed.open(request()) }
        assertTrue("The other owner's request continues", second.body.read(ByteArray(16)) > 0)
        second.close()
        open.close()
    }

    @Test
    fun bodiesBeyondTheLimitFailWhileStreaming() {
        server.enqueue(MockResponse().setChunkedBody("x".repeat(100), 10))
        server.start()
        val stream = resources(8).open(request())
        assertThrows(IOException::class.java) { stream.body.readBytes() }
    }

    @Test
    fun disabledNetworkFailsLikeAnOfflineDevice() {
        server.start()
        TileflowHttpClient.networkEnabled = false
        assertThrows(NetworkUnavailableException::class.java) { resources().send(request()) }
        assertEquals(0, server.requestCount)
    }

    @Test
    fun resourceConcurrencyIsBounded() {
        repeat(TileflowHttpClient.MAXIMUM_CONCURRENT_RESOURCES + 1) { server.enqueue(slow()) }
        server.start()
        val transport = resources()
        val executor = Executors.newSingleThreadExecutor()
        val held = (0 until TileflowHttpClient.MAXIMUM_CONCURRENT_RESOURCES).map {
            transport.open(request())
        }
        try {
            val waiting = executor.submit<HttpStream> { transport.open(request()) }
            assertThrows(TimeoutException::class.java) { waiting.get(300, TimeUnit.MILLISECONDS) }
            held.first().close()
            waiting.get(10, TimeUnit.SECONDS).close()
        } finally {
            held.forEach { it.close() }
            transport.close()
            executor.shutdownNow()
        }
    }

    @Test
    fun sessionRequestsNeverWaitBehindResources() {
        repeat(TileflowHttpClient.MAXIMUM_CONCURRENT_RESOURCES) { server.enqueue(slow()) }
        server.enqueue(MockResponse().setBody("session"))
        server.start()
        val transport = resources()
        val held = (0 until TileflowHttpClient.MAXIMUM_CONCURRENT_RESOURCES).map {
            transport.open(request())
        }
        try {
            val session = NativeHTTPTransport(65_536).send(request("/session"), 10_000)
            assertEquals("session", session.bytes.decodeToString())
        } finally {
            held.forEach { it.close() }
            transport.close()
        }
    }
}
