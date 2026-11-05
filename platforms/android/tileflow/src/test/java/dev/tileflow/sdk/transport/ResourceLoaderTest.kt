package dev.tileflow.sdk.transport

import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.Assert.*
import org.junit.Test

class ResourceLoaderTest {
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
