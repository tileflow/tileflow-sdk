package dev.tileflow.sdk.transport

import dev.tileflow.sdk.hosted.HostedSession
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

internal data class ResourcePayload(
    val bytes: ByteArray,
    val status: Int,
    val headers: Map<String, String>,
)

/** A per-view owner; destroying the view retires authority before cancelling requests. */
internal class ResourceLoader(
    private val policy: ResourcePolicy,
    maximumBytes: Int = 16 * 1024 * 1024,
    private val hosted: HostedSession? = null,
    private val publicMetadataUrls: Set<URI> = emptySet(),
    private val transport: NativeHTTPTransporting = NativeHTTPTransport(maximumBytes),
) : Closeable {

    fun load(url: URI, method: String = "GET", range: String? = null): ResourcePayload {
        require(method == "GET" || method == "HEAD")
        val request = Request.Builder().url(url.toASCIIString()).method(method, null)
        if (range != null) {
            require(Regex("^bytes=[0-9]+-[0-9]*$").matches(range))
            request.header("Range", range)
        }
        val admission =
            if (hosted != null && url !in publicMetadataUrls) hosted.authorize(url, policy)
            else {
                policy.validate(url)
                null
            }
        admission?.grant?.let { request.header("X-Tileflow-Native-Grant", it) }
        val response = transport.send(request.build(), admission?.timeoutMillis ?: 30_000)
        if (admission?.grant != null && response.status in setOf(401, 403, 429)) {
            hosted?.reject(response.status)
            throw dev.tileflow.sdk.TileflowMapException(
                when (response.status) {
                    401 -> dev.tileflow.sdk.TileflowErrorCode.CREDENTIAL_REJECTED
                    429 -> dev.tileflow.sdk.TileflowErrorCode.QUOTA_EXCEEDED
                    else -> dev.tileflow.sdk.TileflowErrorCode.ACCESS_DENIED
                }
            )
        }
        return response
    }

    override fun close() = transport.close()
}

/**
 * Only native owners construct requests. Renderer input never reaches arbitrary methods/headers.
 */
internal interface NativeHTTPTransporting : Closeable {
    fun send(request: Request, timeoutMillis: Long = 30_000): ResourcePayload

    fun cancelActive()
}

internal class NativeHTTPTransport(private val maximumBytes: Int) : NativeHTTPTransporting {
    private val retired = AtomicBoolean()
    private val calls = ConcurrentHashMap.newKeySet<Call>()
    private val client =
        OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .callTimeout(30, TimeUnit.SECONDS)
            .cache(null)
            .build()

    override fun send(request: Request, timeoutMillis: Long): ResourcePayload {
        check(!retired.get()) { "The resource context is disposed." }
        val call = client.newCall(request)
        call.timeout().timeout(timeoutMillis.coerceIn(1, 30_000), TimeUnit.MILLISECONDS)
        calls.add(call)
        if (retired.get()) call.cancel()
        try {
            call.execute().use { response ->
                if (response.code in 300..399)
                    throw IOException("Resource redirects are not allowed.")
                val body = response.body
                if (body != null && body.contentLength() > maximumBytes)
                    throw IOException("Resource exceeds its byte limit.")
                val data = ByteArrayOutputStream()
                if (body != null) {
                    body.byteStream().use { stream ->
                        val buffer = ByteArray(16 * 1024)
                        while (true) {
                            val count = stream.read(buffer)
                            if (count == -1) break
                            if (retired.get() || call.isCanceled())
                                throw IOException("Resource request cancelled.")
                            if (data.size() + count > maximumBytes)
                                throw IOException("Resource exceeds its byte limit.")
                            data.write(buffer, 0, count)
                        }
                    }
                }
                val headers = buildMap {
                    for (name in
                        listOf(
                            "Content-Type",
                            "Content-Range",
                            "Accept-Ranges",
                            "ETag",
                            "Last-Modified",
                        )) {
                        response.header(name)?.let { put(name, it) }
                    }
                    put("Cache-Control", "no-store")
                    put(
                        "Content-Length",
                        if (request.method == "HEAD") response.header("Content-Length") ?: "0"
                        else data.size().toString(),
                    )
                }
                return ResourcePayload(data.toByteArray(), response.code, headers)
            }
        } finally {
            calls.remove(call)
        }
    }

    override fun close() {
        if (!retired.compareAndSet(false, true)) return
        calls.forEach { it.cancel() }
        calls.clear()
        client.connectionPool.evictAll()
        client.dispatcher.executorService.shutdown()
    }

    override fun cancelActive() {
        calls.forEach { it.cancel() }
    }
}
