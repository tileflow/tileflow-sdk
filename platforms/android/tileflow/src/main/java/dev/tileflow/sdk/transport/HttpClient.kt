package dev.tileflow.sdk.transport

import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.OkHttpClient
import okhttp3.Request

/** The device has no usable network, or the SDK was told to act as if it had none. */
internal class NetworkUnavailableException : IOException("The network is unavailable.")

/**
 * A response whose body arrives as it downloads. Headers are the server's, filtered to those the
 * SDK reads; [ResourceLoader] decides what the renderer sees. Closing the body before its end
 * cancels the download.
 */
internal class HttpStream(
    val status: Int,
    val headers: Map<String, String>,
    val body: InputStream,
    private val cancel: () -> Unit = {},
) : Closeable {
    /** Stops the download. Safe to call at any time, also after it finished. */
    fun cancel() = cancel.invoke()

    override fun close() {
        runCatching { body.close() }
    }

    companion object {
        fun complete(payload: ResourcePayload) =
            HttpStream(payload.status, payload.headers, ByteArrayInputStream(payload.bytes))
    }
}

/**
 * Only native owners construct requests. Renderer input never reaches arbitrary methods/headers.
 */
internal interface NativeHTTPTransporting : Closeable {
    fun send(request: Request, timeoutMillis: Long = 30_000): ResourcePayload

    /** Returns once the response head arrives; the body follows as it downloads. */
    fun open(request: Request, timeoutMillis: Long = 30_000): HttpStream =
        HttpStream.complete(send(request, timeoutMillis))

    fun cancelActive()
}

/**
 * The process's HTTP client. One OkHttp client per lane is shared by every map: resource requests
 * share connections across mounts and maps, and session requests never wait behind resources.
 * Neither lane stores cookies or responses; the resource cache is the only cache.
 */
internal object TileflowHttpClient {
    enum class Lane {
        /** Map resources: at most [MAXIMUM_CONCURRENT_RESOURCES] in flight in the process. */
        RESOURCES,

        /** Session bootstraps and other small control requests. */
        SESSIONS,
    }

    const val MAXIMUM_CONCURRENT_RESOURCES = 16

    val resourceSlots = Semaphore(MAXIMUM_CONCURRENT_RESOURCES, true)

    /**
     * When false, every request fails as if the device were offline. Lets tests and a strict
     * offline mode prove that only stored resources are used.
     */
    @Volatile var networkEnabled = true

    private fun builder() =
        OkHttpClient.Builder()
            .followRedirects(false)
            .followSslRedirects(false)
            .cache(null)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(120, TimeUnit.SECONDS)

    val resources: OkHttpClient by lazy {
        builder().connectionPool(ConnectionPool(6, 5, TimeUnit.MINUTES)).build()
    }

    val sessions: OkHttpClient by lazy {
        builder().connectionPool(ConnectionPool(2, 5, TimeUnit.MINUTES)).build()
    }

    fun client(lane: Lane, idleTimeoutMillis: Long): OkHttpClient {
        val base = if (lane == Lane.RESOURCES) resources else sessions
        if (idleTimeoutMillis >= 30_000) return base
        // A grant close to expiry shortens how long the request may wait; the pool is shared.
        val timeout = idleTimeoutMillis.coerceAtLeast(1)
        return base
            .newBuilder()
            .connectTimeout(timeout, TimeUnit.MILLISECONDS)
            .readTimeout(timeout, TimeUnit.MILLISECONDS)
            .build()
    }
}

/**
 * A handle on the shared client for one owner, such as a renderer generation or a Hosted session.
 * Closing it cancels only that owner's requests.
 */
internal class NativeHTTPTransport(
    private val maximumBytes: Int,
    private val lane: TileflowHttpClient.Lane = TileflowHttpClient.Lane.SESSIONS,
) : NativeHTTPTransporting {
    private val retired = AtomicBoolean()
    private val calls = ConcurrentHashMap.newKeySet<Call>()

    override fun send(request: Request, timeoutMillis: Long): ResourcePayload =
        open(request, timeoutMillis).use { stream ->
            val bytes = stream.body.readBytes()
            val headers =
                stream.headers +
                    ("Content-Length" to
                        if (request.method == "HEAD") stream.headers["Content-Length"] ?: "0"
                        else bytes.size.toString())
            ResourcePayload(bytes, stream.status, headers)
        }

    override fun open(request: Request, timeoutMillis: Long): HttpStream {
        check(!retired.get()) { "The resource context is disposed." }
        if (!TileflowHttpClient.networkEnabled) throw NetworkUnavailableException()
        val slots =
            if (lane == TileflowHttpClient.Lane.RESOURCES) TileflowHttpClient.resourceSlots
            else null
        try {
            slots?.acquire()
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            throw InterruptedIOException("Resource request cancelled.")
        }
        val released = AtomicBoolean()
        val release = { if (released.compareAndSet(false, true)) slots?.release() }
        val call = TileflowHttpClient.client(lane, timeoutMillis).newCall(request)
        // Session requests keep a total deadline; resource bodies may stream for longer.
        if (lane == TileflowHttpClient.Lane.SESSIONS)
            call.timeout().timeout(timeoutMillis.coerceIn(1, 30_000), TimeUnit.MILLISECONDS)
        calls.add(call)
        if (retired.get()) call.cancel()
        val finish = {
            calls.remove(call)
            release()
        }
        try {
            val response = call.execute()
            val body = response.body
            // Redirects are returned, never followed; the resource owner decides on each.
            if (request.method != "HEAD" && body != null && body.contentLength() > maximumBytes) {
                response.close()
                throw IOException("Resource exceeds its byte limit.")
            }
            val headers = buildMap {
                for (name in FORWARDED_HEADERS) response.header(name)?.let { put(name, it) }
            }
            val source = body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))
            return HttpStream(
                response.code,
                headers,
                BoundedStream(source, maximumBytes.toLong(), call) {
                    response.close()
                    finish()
                },
                cancel = { call.cancel() },
            )
        } catch (error: Exception) {
            finish()
            throw error
        }
    }

    override fun close() {
        if (!retired.compareAndSet(false, true)) return
        cancelActive()
    }

    override fun cancelActive() {
        calls.forEach { it.cancel() }
    }

    private companion object {
        val FORWARDED_HEADERS =
            listOf(
                "Content-Type",
                "Content-Range",
                "Accept-Ranges",
                "Content-Length",
                "ETag",
                "Last-Modified",
                "Cache-Control",
                "Expires",
                "Date",
                "Age",
                "Vary",
                "Location",
                "Retry-After",
                "Tileflow-Fair-Use",
                "Tileflow-Fair-Use-Notice",
                "Tileflow-Protection",
            )
    }
}

/**
 * Enforces the byte limit while a body streams. Reaching its end or closing it releases the
 * request; closing it early cancels the download.
 */
private class BoundedStream(
    private val source: InputStream,
    private val limit: Long,
    private val call: Call,
    private val onFinish: () -> Unit,
) : InputStream() {
    private var count = 0L
    private var ended = false
    private val finished = AtomicBoolean()

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) == -1) -1 else one[0].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (ended) return -1
        if (finished.get()) throw IOException("Resource request cancelled.")
        val read =
            try {
                source.read(buffer, offset, length)
            } catch (error: IOException) {
                finish()
                throw error
            }
        if (read == -1) {
            ended = true
            finish()
            return -1
        }
        count += read
        if (count > limit) {
            call.cancel()
            finish()
            throw IOException("Resource exceeds its byte limit.")
        }
        return read
    }

    override fun available(): Int = if (finished.get()) 0 else source.available()

    override fun close() {
        if (!finished.get()) call.cancel()
        finish()
    }

    private fun finish() {
        if (finished.compareAndSet(false, true)) {
            runCatching { source.close() }
            onFinish()
        }
    }
}
