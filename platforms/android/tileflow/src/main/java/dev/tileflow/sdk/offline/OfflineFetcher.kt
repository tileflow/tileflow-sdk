package dev.tileflow.sdk.offline

import dev.tileflow.sdk.transport.NetworkUnavailableException
import dev.tileflow.sdk.transport.TileflowHttpClient
import dev.tileflow.sdk.transport.sha256Hex
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.URI
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPInputStream
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

/** One resource request of a download. */
internal class OfflineFetchRequest(
    val id: String,
    val url: URI,
    val headers: Map<String, String>,
)

/**
 * A finished transfer. Header names are canonical (`ETag`, `Content-Encoding`, …).
 *
 * @property body The body after any content decoding.
 * @property wireBytes Body bytes as received on the wire, before decoding, when known.
 * @property wireSha256 SHA-256 of the body as received, before decoding, when known.
 */
internal class OfflineFetchResponse(
    val status: Int,
    val headers: Map<String, String>,
    val body: ByteArray,
    val wireBytes: Long?,
    val wireSha256: String?,
)

/**
 * Moves resource bodies for the downloader. Implementations never follow redirects, store cookies
 * or credentials, or cache responses.
 */
internal interface OfflineResourceFetching {
    suspend fun fetch(request: OfflineFetchRequest): OfflineFetchResponse
}

/**
 * Downloads with OkHttp, keeping the bytes as they arrive on the wire: it asks for gzip itself, so
 * OkHttp does not decode transparently, hashes and counts the raw body, then decodes it. Runs
 * inside the download worker, which WorkManager starts only on an allowed network.
 */
internal class OfflineHttpFetcher(
    private val client: OkHttpClient =
        TileflowHttpClient.resources
            .newBuilder()
            .callTimeout(5, TimeUnit.MINUTES)
            .retryOnConnectionFailure(true)
            .build()
) : OfflineResourceFetching {
    override suspend fun fetch(request: OfflineFetchRequest): OfflineFetchResponse {
        if (!TileflowHttpClient.networkEnabled) throw NetworkUnavailableException()
        val builder = Request.Builder().url(request.url.toASCIIString()).get()
        for ((name, value) in request.headers) builder.header(name, value)
        builder.header("Accept-Encoding", "gzip")
        val call = client.newCall(builder.build())
        return withContext(Dispatchers.IO) {
            suspendCancellableCoroutine { continuation ->
                continuation.invokeOnCancellation { call.cancel() }
                try {
                    continuation.resumeWith(Result.success(execute(call)))
                } catch (error: IOException) {
                    continuation.resumeWith(Result.failure(error))
                }
            }
        }
    }

    private fun execute(call: Call): OfflineFetchResponse =
        call.execute().use { response ->
            val headers = HashMap<String, String>()
            for (name in CANONICAL_HEADERS) response.header(name)?.let { headers[name] = it }
            val digest = MessageDigest.getInstance("SHA-256")
            val raw = bounded(response.body?.byteStream() ?: ByteArray(0).inputStream(), digest)
            val encoding = headers["Content-Encoding"]?.lowercase()
            val body =
                when (encoding) {
                    null,
                    "identity" -> raw
                    "gzip" -> bounded(GZIPInputStream(raw.inputStream()), null)
                    else -> throw IOException("Unsupported content encoding")
                }
            OfflineFetchResponse(
                response.code,
                headers,
                body,
                raw.size.toLong(),
                digest.digest().joinToString("") { "%02x".format(it) },
            )
        }

    private fun bounded(input: InputStream, digest: MessageDigest?): ByteArray {
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(64 * 1024)
        input.use {
            while (true) {
                val count = it.read(buffer)
                if (count < 0) break
                if (output.size() + count > MAXIMUM_BODY_BYTES)
                    throw OfflineTooLargeException()
                digest?.update(buffer, 0, count)
                output.write(buffer, 0, count)
            }
        }
        return output.toByteArray()
    }

    companion object {
        /** The pinned partition stores at most 16 MiB per resource. */
        const val MAXIMUM_BODY_BYTES = 16 * 1024 * 1024

        val CANONICAL_HEADERS =
            listOf(
                "Cache-Control",
                "Content-Encoding",
                "Content-Length",
                "Content-Type",
                "Date",
                "ETag",
                "Expires",
                "Last-Modified",
                "Age",
                "Retry-After",
                "Tileflow-Fair-Use",
                "Tileflow-Fair-Use-Notice",
                "Tileflow-Protection",
            )
    }
}

/** A body larger than the pinned partition stores. */
internal class OfflineTooLargeException : IOException("The resource is too large to store.")

/** SHA-256 in lowercase hexadecimal. */
internal fun offlineDigest(bytes: ByteArray): String = sha256Hex(bytes)
