package dev.tileflow.sdk.transport

import java.net.URI
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test

class ResourceLoaderTest {
    @Test
    fun templateExpansionIsBoundedAndCannotChangeAuthority() {
        val template = URI("https://terrain.example.com/%7Bz%7D/%7Bx%7D/%7By%7D.png")
        val base = ResourceAddress.encode(template).toASCIIString()
        assertEquals(
            URI("https://terrain.example.com/3/4/5.png"),
            ResourceAddress.decode(URI("$base/3/4/5")),
        )
        for (suffix in listOf("/3/8/0", "/25/0/0", "/01/0/0", "/3/4/5/extra", "/3/-1/2")) {
            assertThrows(IllegalArgumentException::class.java) {
                ResourceAddress.decode(URI(base + suffix))
            }
        }
    }

    @Test
    fun addressingRejectsForeignAndNonCanonicalHandles() {
        val url = URI("https://maps.example.com/tile/0/0/0.pbf")
        assertEquals(url, ResourceAddress.decode(ResourceAddress.encode(url)))
        for (value in
            listOf(
                "https://evil.test/resource/abc",
                "https://tileflow.invalid/resource/abc?key=secret",
            )) {
            assertThrows(IllegalArgumentException::class.java) {
                ResourceAddress.decode(URI(value))
            }
        }
    }

    @Test
    fun networkRequestsHaveNoBrowserAuthorityAndRespectRanges() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse()
                    .setResponseCode(206)
                    .setBody("fixture")
                    .setHeader("Content-Range", "bytes 0-6/7")
            )
            server.start()
            val url = server.url("/tile").toUri()
            ResourceLoader(ResourcePolicy(setOf(ResourcePolicy.origin(url)), true)).use { loader ->
                val result = loader.load(url, range = "bytes=0-6")
                assertEquals(206, result.status)
                assertEquals("fixture", result.bytes.toString(Charsets.UTF_8))
                val request = server.takeRequest()
                assertEquals("bytes=0-6", request.getHeader("Range"))
                for (header in
                    listOf(
                        "Origin",
                        "Referer",
                        "Cookie",
                        "Authorization",
                        "X-Tileflow-Native-Grant",
                    )) {
                    assertNull(request.getHeader(header))
                }
            }
        }
    }

    @Test
    fun redirectsCannotEscapeTheResourceOrigin() {
        MockWebServer().use { server ->
            server.enqueue(
                MockResponse().setResponseCode(302).setHeader("Location", "https://example.com")
            )
            server.start()
            val url = server.url("/tile").toUri()
            ResourceLoader(ResourcePolicy(setOf(ResourcePolicy.origin(url)), true)).use { loader ->
                assertThrows(java.io.IOException::class.java) { loader.load(url) }
                assertEquals(1, server.requestCount)
            }
        }
    }

    @Test
    fun headPreservesRepresentationLengthWithoutBufferingABody() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setHeader("Content-Length", "9000000"))
            server.start()
            val url = server.url("/archive").toUri()
            ResourceLoader(ResourcePolicy(setOf(ResourcePolicy.origin(url)), true)).use { loader ->
                val result = loader.load(url, method = "HEAD")
                assertEquals(0, result.bytes.size)
                assertEquals("9000000", result.headers["Content-Length"])
            }
        }
    }

    @Test
    fun disposalCancelsHeldNetworkRequests() {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            server.start()
            val url = server.url("/tile").toUri()
            val loader = ResourceLoader(ResourcePolicy(setOf(ResourcePolicy.origin(url)), true))
            val executor = Executors.newSingleThreadExecutor()
            try {
                val pending = executor.submit<ResourcePayload> { loader.load(url) }
                assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
                loader.close()
                assertThrows(java.util.concurrent.ExecutionException::class.java) {
                    pending.get(5, TimeUnit.SECONDS)
                }
                assertThrows(IllegalStateException::class.java) { loader.load(url) }
            } finally {
                loader.close()
                executor.shutdownNow()
            }
        }
    }
}
