package dev.tileflow.sdk.transport

import android.os.SystemClock
import dev.tileflow.sdk.LoadableMapSource
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.hosted.HostedContract
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.hosted.ResourceReaction
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineServingRule
import java.io.ByteArrayInputStream
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.InterruptedIOException
import java.net.URI
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import okhttp3.Request

internal data class ResourcePayload(
    val bytes: ByteArray,
    val status: Int,
    val headers: Map<String, String>,
)

/** What the renderer receives. A successful body may still be downloading. */
internal class ResourceResponse(
    val status: Int,
    val headers: Map<String, String>,
    val body: InputStream,
)

/**
 * A generation's resource owner. Requests share the process's HTTP client; closing the loader
 * cancels only this generation's requests, and destroying the view retires authority before
 * cancelling them.
 *
 * With a cache, a fresh stored response answers without the network, a stale one is revalidated
 * and a successful `GET` is streamed to the renderer while it is written to disk, as
 * [ResourceCacheStore] and [ResourceCachePolicy] describe.
 *
 * Only a session bootstrap ends a Hosted map: protected resources the service refuses renew the
 * grant, reload a superseded deployment or wait for a rate limit, as [HostedContract.reaction]
 * describes.
 *
 * Downloaded regions answer without a session where [OfflineServingRule] says so: a Hosted map
 * without a usable network serves its protected resources from the regions' packs, and with the
 * network switched off every request is answered from stored entries alone, a miss with 504.
 */
internal class ResourceLoader(
    private val policy: ResourcePolicy,
    maximumBytes: Int = 16 * 1024 * 1024,
    private val hosted: HostedSession? = null,
    private val apiOrigin: URI? = null,
    private val publicMetadataUrls: Set<URI> = emptySet(),
    private val transport: NativeHTTPTransporting =
        NativeHTTPTransport(maximumBytes, TileflowHttpClient.Lane.RESOURCES),
    private val cache: ResourceCacheStore? = null,
    private val grantScope: ResourceCacheScope? = null,
    private val offline: OfflineServingIndex? = null,
    private val networkEnabled: () -> Boolean = { TileflowHttpClient.networkEnabled },
    private val reachable: () -> Boolean = { true },
    private val onDeploymentSuperseded: (() -> Boolean)? = null,
    private val now: () -> Long = SystemClock::elapsedRealtime,
    private val date: () -> Long = System::currentTimeMillis,
    private val pause: (Long) -> Unit = Thread::sleep,
) : Closeable {
    private val closed = CountDownLatch(1)
    // A delivery rate limit applies to every protected request of one renderer generation.
    private val rateLimitedUntil = AtomicLong(0)

    fun load(url: URI, method: String = "GET", range: String? = null): ResourcePayload {
        val response = open(url, method, range)
        val bytes = response.body.use { it.readBytes() }
        val headers =
            if (method == "HEAD") response.headers
            else response.headers + ("Content-Length" to bytes.size.toString())
        return ResourcePayload(bytes, response.status, headers)
    }

    fun open(url: URI, method: String = "GET", range: String? = null): ResourceResponse {
        require(method == "GET" || method == "HEAD")
        if (range != null) require(Regex("^bytes=[0-9]+-[0-9]*$").matches(range))
        val cacheable = cache != null && method == "GET" && range == null
        val protected = hosted != null && url !in publicMetadataUrls && !isPublicApiResource(url)
        if (!networkEnabled()) return storedOnly(url, protected, cacheable)
        // A fresh public entry needs neither the network nor a Hosted session.
        if (cacheable) freshPublicEntry(url)?.let { return response(it) }
        if (
            protected &&
                cacheable &&
                OfflineServingRule.hostedUsesPacks(networkEnabled = true, reachable = reachable())
        )
            packEntry(url)?.let { return response(it) }
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
                    try {
                        hosted.authorize(target, policy)
                    } catch (error: TileflowMapException) {
                        // The service cannot be reached: a downloaded region answers instead.
                        if (error.code == TileflowErrorCode.SESSION_UNAVAILABLE && cacheable)
                            packEntry(target)?.let { return response(it) }
                        throw error
                    }
                } else {
                    policy.validate(target)
                    null
                }
            val grant = admission?.grant
            grant?.let { request.header("X-Tileflow-Native-Grant", it) }
            // Protected entries are read only after the session admitted this request again.
            val key =
                when {
                    !cacheable -> null
                    grant == null -> ResourceCacheKey(target, ResourceCacheScope.Shared)
                    else -> grantScope?.let { ResourceCacheKey(target, it) }
                }
            val stored = key?.let(::storedEntries)
            stored?.fresh(date())?.let {
                return response(it.resource)
            }
            stored?.candidate?.let { candidate ->
                ResourceCachePolicy.validators(candidate.resource.metadata.headers).forEach {
                    (name, value) ->
                    request.header(name, value)
                }
            }
            // A downloaded region's pack entry is revalidated instead of downloaded again.
            val packed = if (stored == null && grant != null && cacheable) packEntry(target) else null
            packed?.metadata?.headers?.get("ETag")?.let { request.header("If-None-Match", it) }
            val stream =
                try {
                    transport.open(request.build(), admission?.timeoutMillis ?: 30_000)
                } catch (error: IOException) {
                    // A closed loader's cancelled requests never fall back to stored responses.
                    if (closed.count > 0 && isNetworkFailure(error))
                        (stored?.afterFailure(date())?.resource ?: packed)?.let {
                            return response(it)
                        }
                    throw error
                }
            val candidate = stored?.candidate
            if (stream.status == 304 && key != null && candidate != null) {
                stream.close()
                return response(revalidated(candidate, key, stream.headers))
            }
            if (stream.status == 304 && packed != null) {
                stream.close()
                return response(packed)
            }
            if (stream.status in 500..599)
                stored?.afterFailure(date())?.let {
                    stream.close()
                    return response(it.resource)
                }
            if (stream.status == 200 && method == "GET" && range == null) {
                // Success never needs a Hosted reaction; stream it while storing it.
                return stream(stream, target, key, grant != null)
            }
            val bytes = stream.body.use { it.readBytes() }
            if (stream.status in 300..399) {
                // Only a Team model's stable address may redirect, once, to its current version.
                val next =
                    apiOrigin
                        ?.takeIf { !redirected && grant == null }
                        ?.let { HostedContract.redirect(target, stream.headers["Location"], it) }
                        ?: throw IOException("Resource redirects are not allowed.")
                redirected = true
                target = next
                continue
            }
            val complete =
                ResourceResponse(
                    stream.status,
                    rendererHeaders(stream.headers, method, bytes.size.toLong()),
                    ByteArrayInputStream(bytes),
                )
            if (grant == null || hosted == null || deadline == null) return complete
            var reaction = HostedContract.reaction(stream.status, bytes, target, retried)
            if (reaction == ResourceReaction.REFRESH) {
                if (!retried && hosted.invalidate(grant)) {
                    retried = true
                    continue
                }
                reaction = HostedContract.reaction(stream.status, bytes, target, true)
            }
            when (reaction) {
                ResourceReaction.NONE,
                ResourceReaction.REFRESH -> return complete
                ResourceReaction.SUPERSEDED -> {
                    if (onDeploymentSuperseded?.invoke() == true) {
                        // The reload retires this generation; its renderer never sees the failure.
                        closed.await(10, TimeUnit.SECONDS)
                        throw TileflowMapException(TileflowErrorCode.DISPOSED)
                    }
                    return complete
                }
                ResourceReaction.RATE_LIMITED -> {
                    val delay =
                        HostedContract.retryAfterMillis(
                            stream.headers["Retry-After"],
                            System.currentTimeMillis(),
                        ) ?: 1_000
                    val until = now() + minOf(delay, 60_000)
                    rateLimitedUntil.accumulateAndGet(until, ::maxOf)
                    if (retried || until >= deadline) return complete
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
    /**
     * Answers from stored entries alone, never the network: a downloaded region's pack for a
     * protected resource, else a pinned or ambient entry of the shared scope whatever its
     * freshness. A miss answers 504, as an HTTP cache answers `only-if-cached`.
     */
    private fun storedOnly(url: URI, protected: Boolean, cacheable: Boolean): ResourceResponse {
        if (cacheable) {
            if (protected) {
                packEntry(url)?.let {
                    return response(it)
                }
            } else {
                policy.validate(url)
                storedEntries(ResourceCacheKey(url, ResourceCacheScope.Shared))?.let { stored ->
                    (stored.pinned ?: stored.ambient)?.let {
                        return response(it)
                    }
                }
            }
        }
        return ResourceResponse(
            504,
            mapOf("Cache-Control" to "no-store", "Content-Length" to "0"),
            ByteArray(0).inputStream(),
        )
    }

    /**
     * A downloaded region's answer for a protected resource, when an available region holds it or
     * covers it.
     */
    private fun packEntry(url: URI): StoredResource? {
        val offline = offline ?: return null
        val cache = cache ?: return null
        return offline.resource(ResourceCacheKey(url, grantScope ?: return null), cache)
    }

    private fun isPublicApiResource(url: URI): Boolean =
        apiOrigin != null &&
            ResourcePolicy.origin(url) == ResourcePolicy.origin(apiOrigin) &&
            HostedContract.isPublicApiResource(url)

    /** A fresh entry in the shared scope for an origin this map may use without a grant. */
    private fun freshPublicEntry(url: URI): StoredResource? {
        if (runCatching { policy.validate(url) }.isFailure || url in publicMetadataUrls) return null
        if (
            apiOrigin != null &&
                ResourcePolicy.origin(url) == ResourcePolicy.origin(apiOrigin) &&
                !HostedContract.isPublicApiResource(url)
        )
            return null
        return storedEntries(ResourceCacheKey(url, ResourceCacheScope.Shared))
            ?.fresh(date())
            ?.resource
    }

    private fun storedEntries(key: ResourceCacheKey): StoredEntries? {
        val cache = cache ?: return null
        val pinned = cache.read(key, ResourceCacheRetention.PINNED)
        val ambient = cache.read(key, ResourceCacheRetention.AMBIENT)
        if (pinned == null && ambient == null) return null
        return StoredEntries(pinned, ambient)
    }

    /** A `304` refreshed the stored headers; the stored body answers. */
    private fun revalidated(
        entry: StoredEntries.Entry,
        key: ResourceCacheKey,
        headers: Map<String, String>,
    ): StoredResource {
        val old = entry.resource.metadata
        val merged = ResourceCachePolicy.merging(old.headers, headers)
        val metadata =
            ResourceCacheMetadata.of(
                key.url,
                old.status,
                merged,
                date(),
                key.scope != ResourceCacheScope.Shared,
                old.bodyLength,
                old.bodySha256,
            )
        if (CacheDirectives.parse(merged["Cache-Control"]).noStore)
            cache?.remove(key, entry.retention)
        else cache?.write(key, entry.retention, metadata, entry.resource.body)
        return StoredResource(metadata, entry.resource.body)
    }

    private fun stream(
        stream: HttpStream,
        url: URI,
        key: ResourceCacheKey?,
        protected: Boolean,
    ): ResourceResponse {
        val headers = rendererHeaders(stream.headers, "GET", null)
        val writer =
            key?.takeIf { ResourceCachePolicy.isStorable(200, stream.headers, protected) }
                ?.let { cache?.writer(it, ResourceCacheRetention.AMBIENT) }
                ?: return ResourceResponse(200, headers, stream.body)
        val responseTime = date()
        return ResourceResponse(
            200,
            headers,
            CachingStream(stream.body, writer) { length, sha ->
                ResourceCacheMetadata.of(
                    url,
                    200,
                    stream.headers,
                    responseTime,
                    protected,
                    length,
                    sha,
                )
            },
        )
    }

    override fun close() {
        closed.countDown()
        transport.close()
    }

    companion object {
        fun response(stored: StoredResource) =
            ResourceResponse(
                stored.metadata.status,
                rendererHeaders(stored.metadata.headers, "GET", stored.body.size.toLong()),
                ByteArrayInputStream(stored.body),
            )

        /**
         * The headers the renderer sees. The WebView must never cache: the native cache is the
         * only one.
         */
        fun rendererHeaders(
            headers: Map<String, String>,
            method: String,
            length: Long?,
        ): Map<String, String> = buildMap {
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
                headers[name]?.let { put(name, it) }
            }
            put("Cache-Control", "no-store")
            if (method == "HEAD") put("Content-Length", headers["Content-Length"] ?: "0")
            else if (length != null) put("Content-Length", length.toString())
        }

        /**
         * Failures that a stored response may answer: no connection, not a cancellation, a
         * disposed owner or an error response from the server.
         */
        fun isNetworkFailure(error: IOException): Boolean =
            error !is InterruptedIOException || error is java.net.SocketTimeoutException
    }
}

/** The pinned and ambient entries for one key, read once per request. */
private class StoredEntries(val pinned: StoredResource?, val ambient: StoredResource?) {
    class Entry(val resource: StoredResource, val retention: ResourceCacheRetention)

    fun fresh(now: Long): Entry? {
        if (pinned != null && pinned.metadata.isFresh(now))
            return Entry(pinned, ResourceCacheRetention.PINNED)
        if (ambient != null && ambient.metadata.isFresh(now))
            return Entry(ambient, ResourceCacheRetention.AMBIENT)
        return null
    }

    /** The entry to revalidate: ambient is written only once a pinned entry went stale. */
    val candidate: Entry?
        get() =
            ambient?.let { Entry(it, ResourceCacheRetention.AMBIENT) }
                ?: pinned?.let { Entry(it, ResourceCacheRetention.PINNED) }

    /** A pinned entry always answers when the network fails; its owner retires expired content. */
    fun afterFailure(now: Long): Entry? {
        if (ambient != null && ambient.metadata.isUsableAfterNetworkFailure(now))
            return Entry(ambient, ResourceCacheRetention.AMBIENT)
        return pinned?.let { Entry(it, ResourceCacheRetention.PINNED) }
    }
}

/**
 * Passes a downloading body through while writing it to the cache. The entry is committed only
 * when the whole body arrived; failures and a body closed early discard it.
 */
private class CachingStream(
    private val source: InputStream,
    private val writer: ResourceCacheWriter,
    private val metadata: (Int, String) -> ResourceCacheMetadata,
) : InputStream() {
    private var done = false

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) == -1) -1 else one[0].toInt() and 0xff
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        val read =
            try {
                source.read(buffer, offset, length)
            } catch (error: IOException) {
                abandon()
                throw error
            }
        if (read == -1) {
            if (!done) {
                done = true
                val (count, sha) = writer.body
                writer.commit(metadata(count, sha))
            }
        } else if (!done) writer.append(buffer, offset, read)
        return read
    }

    override fun available(): Int = source.available()

    override fun close() {
        abandon()
        source.close()
    }

    private fun abandon() {
        if (done) return
        done = true
        writer.abort()
    }
}

/** The cache scope of resources this map receives with a grant. */
internal val LoadableMapSource.grantScope: ResourceCacheScope?
    get() {
        val endpoint = hosted ?: return null
        val mapId = mapId ?: return null
        return ResourceCacheScope.grant(endpoint.apiOrigin, mapId)
    }
