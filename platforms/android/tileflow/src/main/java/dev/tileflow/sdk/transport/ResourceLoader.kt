package dev.tileflow.sdk.transport

import android.os.SystemClock
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.hosted.HostedContract
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.hosted.ResourceReaction
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.IOException
import java.net.URI
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request

internal data class ResourcePayload(
    val bytes: ByteArray,
    val status: Int,
    val headers: Map<String, String>,
)

/**
 * A per-view owner; destroying the view retires authority before cancelling requests. Only a
 * session bootstrap ends a Hosted map: protected resources the service refuses renew the grant,
 * reload a superseded deployment or wait for a rate limit, as [HostedContract.reaction] describes.
 */
internal class ResourceLoader(
    private val policy: ResourcePolicy,
    maximumBytes: Int = 16 * 1024 * 1024,
    private val hosted: HostedSession? = null,
    private val apiOrigin: URI? = null,
    private val publicMetadataUrls: Set<URI> = emptySet(),
    private val transport: NativeHTTPTransporting = NativeHTTPTransport(maximumBytes),
    private val onDeploymentSuperseded: (() -> Boolean)? = null,
    private val now: () -> Long = SystemClock::elapsedRealtime,
    private val pause: (Long) -> Unit = Thread::sleep,
) : Closeable {
    private val closed = CountDownLatch(1)
    // A delivery rate limit applies to every protected request of one renderer generation.
    private val rateLimitedUntil = AtomicLong(0)

    fun load(url: URI, method: String = "GET", range: String? = null): ResourcePayload {
        require(method == "GET" || method == "HEAD")
        if (range != null) require(Regex("^bytes=[0-9]+-[0-9]*$").matches(range))
        // Only Hosted requests wait or retry, so only they read the clock.
        val deadline = hosted?.let { now() + 30_000 }
        var target = url
        var redirected = false
        var retried = false
        while (true) {
            val request = Request.Builder().url(target.toASCIIString()).method(method, null)
            range?.let { request.header("Range", it) }
            val admission =
                if (
                    hosted != null &&
                        deadline != null &&
                        target !in publicMetadataUrls &&
                        !isPublicApiResource(target)
                ) {
                    val gate = rateLimitedUntil.get()
                    if (gate in (now() + 1) until deadline) pause(gate - now())
                    hosted.authorize(target, policy)
                } else {
                    policy.validate(target)
                    null
                }
            val grant = admission?.grant
            grant?.let { request.header("X-Tileflow-Native-Grant", it) }
            val response = transport.send(request.build(), admission?.timeoutMillis ?: 30_000)
            if (response.status in 300..399) {
                // Only a Team model's stable address may redirect, once, to its current version.
                val next =
                    apiOrigin
                        ?.takeIf { !redirected && grant == null }
                        ?.let { HostedContract.redirect(target, response.headers["Location"], it) }
                        ?: throw IOException("Resource redirects are not allowed.")
                redirected = true
                target = next
                continue
            }
            if (grant == null || hosted == null || deadline == null) return response
            var reaction = HostedContract.reaction(response.status, response.bytes, target, retried)
            if (reaction == ResourceReaction.REFRESH) {
                if (!retried && hosted.invalidate(grant)) {
                    retried = true
                    continue
                }
                reaction = HostedContract.reaction(response.status, response.bytes, target, true)
            }
            when (reaction) {
                ResourceReaction.NONE,
                ResourceReaction.REFRESH -> return response
                ResourceReaction.SUPERSEDED -> {
                    if (onDeploymentSuperseded?.invoke() == true) {
                        // The reload retires this generation; its renderer never sees the failure.
                        closed.await(10, TimeUnit.SECONDS)
                        throw TileflowMapException(TileflowErrorCode.DISPOSED)
                    }
                    return response
                }
                ResourceReaction.RATE_LIMITED -> {
                    val delay =
                        HostedContract.retryAfterMillis(
                            response.headers["Retry-After"],
                            System.currentTimeMillis(),
                        ) ?: 1_000
                    val until = now() + minOf(delay, 60_000)
                    rateLimitedUntil.accumulateAndGet(until, ::maxOf)
                    if (retried || until >= deadline) return response
                    retried = true
                }
                ResourceReaction.QUOTA -> {
                    hosted.reject(TileflowErrorCode.QUOTA_EXCEEDED)
                    throw TileflowMapException(TileflowErrorCode.QUOTA_EXCEEDED)
                }
            }
        }
    }

    /** Landmarks and Team models are public on the API origin and never carry a grant. */
    private fun isPublicApiResource(url: URI): Boolean =
        apiOrigin != null &&
            ResourcePolicy.origin(url) == ResourcePolicy.origin(apiOrigin) &&
            HostedContract.isPublicApiResource(url)

    override fun close() {
        closed.countDown()
        transport.close()
    }
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
                // Redirects are returned, never followed; the resource owner decides on each.
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
                            "Location",
                            "Retry-After",
                            "Tileflow-Fair-Use",
                            "Tileflow-Fair-Use-Notice",
                            "Tileflow-Protection",
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
