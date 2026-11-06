package dev.tileflow.reactnative

import androidx.test.core.app.ApplicationProvider
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.offline.TileflowOfflineSwitch
import java.io.InputStream
import java.net.InetAddress
import java.net.ServerSocket
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeMapMediaTest {
    @Test
    fun cancellationClosesAnImageRequestWaitingForItsResponse() = runBlocking {
        ServerSocket(0, 1, InetAddress.getByName("127.0.0.1")).use { server ->
            val accepted = CompletableDeferred<Unit>()
            val disconnected =
                async(Dispatchers.IO) {
                    server.accept().use { socket ->
                        socket.soTimeout = 5_000
                        val request = socket.getInputStream().bufferedReader()
                        while (!request.readLine().isNullOrEmpty()) Unit
                        accepted.complete(Unit)
                        request.read()
                    }
                }
            val load = async {
                TileflowMapMedia.load(
                    ApplicationProvider.getApplicationContext(),
                    "http://127.0.0.1:${server.localPort}/blocked.png",
                )
            }
            withTimeout(5_000) { accepted.await() }
            load.cancelAndJoin()
            assertEquals(-1, withTimeout(5_000) { disconnected.await() })
        }
    }

    @Test
    fun aRemoteApplicationImageDoesNotBorrowMapCredentials() = runBlocking {
        MockWebServer().use { server ->
            server.enqueue(MockResponse().setBody("image-bytes"))
            val bytes =
                TileflowMapMedia.load(
                    ApplicationProvider.getApplicationContext(),
                    server.url("/image.png").toString(),
                )
            assertArrayEquals("image-bytes".toByteArray(), bytes)
            val request = server.takeRequest()
            assertNull(request.getHeader("Authorization"))
            assertNull(request.getHeader("X-Tileflow-Credential"))
            assertNull(request.getHeader("X-Tileflow-Mobile-Client"))
            assertNull(request.getHeader("X-Tileflow-Native-Grant"))
            assertNull(request.getHeader("Cookie"))
        }
    }

    @Test
    fun remoteApplicationImagesRespectTheNetworkSwitch() = runBlocking {
        val previouslyEnabled = TileflowOfflineSwitch.isNetworkEnabled
        TileflowOfflineSwitch.isNetworkEnabled = false
        try {
            MockWebServer().use { server ->
                server.enqueue(MockResponse().setBody("image-bytes"))
                val error = runCatching {
                    TileflowMapMedia.load(
                        ApplicationProvider.getApplicationContext(),
                        server.url("/image.png").toString(),
                    )
                }.exceptionOrNull()

                assertEquals(0, server.requestCount)
                assertEquals(TileflowErrorCode.RESOURCE_FAILED, (error as? TileflowMapException)?.code)
            }
        } finally {
            TileflowOfflineSwitch.isNetworkEnabled = previouslyEnabled
        }
    }

    @Test
    fun remoteApplicationImagesDoNotFollowRedirects() = runBlocking {
        MockWebServer().use { origin ->
            MockWebServer().use { target ->
                target.enqueue(MockResponse().setBody("redirected-image"))
                origin.enqueue(
                    MockResponse().setResponseCode(302).setHeader("Location", target.url("/image.png"))
                )
                val error = runCatching {
                    TileflowMapMedia.load(
                        ApplicationProvider.getApplicationContext(),
                        origin.url("/image.png").toString(),
                    )
                }.exceptionOrNull()

                assertEquals(1, origin.requestCount)
                assertEquals(0, target.requestCount)
                assertEquals(TileflowErrorCode.RESOURCE_FAILED, (error as? TileflowMapException)?.code)
            }
        }
    }

    @Test
    fun base64AndPercentEncodedApplicationImagesUseTheirOriginalBytes() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val expected = byteArrayOf(1, 2, 3, 127, -1)
        assertArrayEquals(
            expected,
            TileflowMapMedia.load(context, "data:image/png;base64,AQIDf/8="),
        )
        assertArrayEquals(
            expected,
            TileflowMapMedia.load(context, "data:image/png,%01%02%03%7f%ff"),
        )
    }

    @Test
    fun oversizedStreamingBodiesAreRejectedBeforeTheExtraChunkIsCopied() {
        val source =
            object : InputStream() {
                var returned = 0

                override fun read(): Int = 0

                override fun read(bytes: ByteArray, offset: Int, length: Int): Int {
                    returned += length
                    return length
                }
            }
        val error =
            runCatching { TileflowMapMedia.bounded(source) }.exceptionOrNull()
                as TileflowMapException
        assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
        assertEquals(TileflowMapMedia.MAXIMUM_BYTES + 16 * 1024, source.returned)
    }
}
