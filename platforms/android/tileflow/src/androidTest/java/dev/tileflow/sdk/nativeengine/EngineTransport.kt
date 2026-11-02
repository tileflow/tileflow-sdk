package dev.tileflow.sdk.nativeengine

import android.content.Context
import android.os.Handler
import android.os.Looper
import dev.tileflow.sdk.transport.ResourceLoader
import java.net.URI
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.maplibre.android.LibraryLoaderProvider
import org.maplibre.android.MapLibre
import org.maplibre.android.ModuleProvider
import org.maplibre.android.http.HttpRequest
import org.maplibre.android.http.HttpResponder
import org.maplibre.android.offline.OfflineManager

/**
 * Engine addresses: `https://tileflow.invalid/<context>/<origin>/<path>?<query>`.
 *
 * The origin is base64url without padding. The path and query are the remote resource's, so the
 * engine's `{z}/{x}/{y}` and `{fontstack}/{range}` placeholders and the suffixes it appends to a
 * sprite stay where it puts them. Android's engine completes only `http` and `https` requests.
 */
internal object EngineAddress {
    const val HOST = "tileflow.invalid"
    private const val PREFIX = "https://$HOST/"
    private val absolute = Regex("^(https?://[^/?#]+)(/[^?#]*)?(\\?[^#]*)?$")

    fun encode(remote: String, context: String): String {
        val match = requireNotNull(absolute.matchEntire(remote)) { "Not an absolute URL: $remote" }
        val origin = match.groupValues[1]
        val path = match.groupValues[2].ifEmpty { "/" }
        val token =
            Base64.getUrlEncoder().withoutPadding().encodeToString(origin.toByteArray(Charsets.UTF_8))
        return "$PREFIX$context/$token$path${match.groupValues[3]}"
    }

    /** The context and remote URL of an engine address, or null for any other URL. */
    fun decode(address: String): Pair<String, URI>? {
        if (!address.startsWith(PREFIX)) return null
        val rest = address.removePrefix(PREFIX)
        val first = rest.indexOf('/')
        if (first <= 0) return null
        val context = rest.substring(0, first)
        val afterContext = rest.substring(first + 1)
        val second = afterContext.indexOf('/')
        if (second <= 0) return null
        val origin =
            String(Base64.getUrlDecoder().decode(afterContext.substring(0, second)), Charsets.UTF_8)
        return context to URI(origin + afterContext.substring(second))
    }

    /** Resolves [reference] against [base], keeping `{…}` placeholders. */
    fun resolve(base: String, reference: String): String {
        fun escape(value: String) = value.replace("{", "%7B").replace("}", "%7D")
        fun unescape(value: String) = value.replace("%7B", "{").replace("%7D", "}")
        return unescape(URI(escape(base)).resolve(URI(escape(reference))).toString())
    }
}

/** One request the engine made, as the interception saw it. */
internal data class EngineRequestRecord(
    val address: String,
    val remote: String?,
    val status: Int?,
    val delegated: Boolean,
    val range: String,
    val error: String? = null,
    val elapsedMillis: Long = 0,
)

/**
 * Process-wide interception of MapLibre Native's network requests. The engine's module provider is
 * wrapped once; requests for [EngineAddress.HOST] are answered from the [ResourceLoader] registered
 * for their context, on a worker, and every other request goes to the previous provider (MapLibre's
 * own OkHttp client).
 */
internal object EngineTransport {
    private val routes = ConcurrentHashMap<String, ResourceLoader>()
    val records = CopyOnWriteArrayList<EngineRequestRecord>()
    val executor: ExecutorService = Executors.newFixedThreadPool(8)
    @Volatile private var installed = false

    /** Leaves MapLibre's ambient cache at its default size, to compare with the SDK's setting. */
    var keepAmbientCache = false

    fun install(context: Context) {
        if (installed) return
        onMain { MapLibre.getInstance(context.applicationContext) }
        synchronized(this) {
            if (installed) return
            val previous = MapLibre.getModuleProvider()
            MapLibre.setModuleProvider(EngineModuleProvider(previous))
            installed = true
        }
        if (keepAmbientCache) return
        // The SDK's cache is the only cache: MapLibre keeps no ambient copies.
        val done = CountDownLatch(1)
        var failure: String? = null
        onMain {
            OfflineManager.getInstance(context.applicationContext)
                .setMaximumAmbientCacheSize(
                    0,
                    object : OfflineManager.FileSourceCallback {
                        override fun onSuccess() = done.countDown()

                        override fun onError(message: String) {
                            failure = message
                            done.countDown()
                        }
                    },
                )
        }
        check(done.await(10, TimeUnit.SECONDS)) { "The ambient cache size was not set" }
        failure?.let { error("Setting the ambient cache size failed: $it") }
    }

    fun register(loader: ResourceLoader): String =
        UUID.randomUUID().toString().replace("-", "").take(16).also { routes[it] = loader }

    fun retire(context: String) {
        routes.remove(context)
    }

    fun loader(context: String): ResourceLoader? = routes[context]

    fun onMain(action: () -> Unit) {
        if (Looper.myLooper() == Looper.getMainLooper()) return action()
        val done = CountDownLatch(1)
        var error: Throwable? = null
        Handler(Looper.getMainLooper()).post {
            try {
                action()
            } catch (failure: Throwable) {
                error = failure
            } finally {
                done.countDown()
            }
        }
        check(done.await(10, TimeUnit.SECONDS))
        error?.let { throw it }
    }
}

internal class EngineModuleProvider(private val previous: ModuleProvider) : ModuleProvider {
    override fun createHttpRequest(): HttpRequest = EngineHttpRequest(previous.createHttpRequest())

    override fun createLibraryLoaderProvider(): LibraryLoaderProvider =
        previous.createLibraryLoaderProvider()
}

/** One engine request. It never blocks the engine's thread: the loader runs on a worker. */
internal class EngineHttpRequest(private val previous: HttpRequest) : HttpRequest {
    private val cancelled = AtomicBoolean()
    @Volatile private var delegated = false
    @Volatile private var task: Future<*>? = null

    override fun executeRequest(
        responder: HttpResponder,
        nativePtr: Long,
        resourceUrl: String,
        dataRange: String,
        etag: String,
        modified: String,
        offlineUsage: Boolean,
    ) {
        val decoded = runCatching { EngineAddress.decode(resourceUrl) }.getOrNull()
        if (decoded == null) {
            delegated = true
            EngineTransport.records.add(
                EngineRequestRecord(resourceUrl, null, null, delegated = true, range = dataRange)
            )
            previous.executeRequest(responder, nativePtr, resourceUrl, dataRange, etag, modified, offlineUsage)
            return
        }
        val (context, remote) = decoded
        val loader = EngineTransport.loader(context)
        if (loader == null) {
            EngineTransport.records.add(
                EngineRequestRecord(resourceUrl, remote.toString(), null, false, dataRange, "no route")
            )
            responder.handleFailure(HttpRequest.PERMANENT_ERROR, "No map owns this request")
            return
        }
        val started = System.nanoTime()
        task =
            EngineTransport.executor.submit {
                try {
                    val response =
                        loader.open(remote, "GET", dataRange.takeIf { it.isNotEmpty() })
                    val body = response.body.use { it.readBytes() }
                    EngineTransport.records.add(
                        EngineRequestRecord(
                            resourceUrl,
                            remote.toString(),
                            response.status,
                            false,
                            dataRange,
                            elapsedMillis = (System.nanoTime() - started) / 1_000_000,
                        )
                    )
                    if (!cancelled.get())
                        responder.onResponse(
                            response.status,
                            response.headers["ETag"],
                            response.headers["Last-Modified"],
                            // The engine never stores what the SDK answers.
                            "no-store",
                            null,
                            response.headers["Retry-After"],
                            null,
                            body,
                        )
                } catch (error: Throwable) {
                    EngineTransport.records.add(
                        EngineRequestRecord(
                            resourceUrl,
                            remote.toString(),
                            null,
                            false,
                            dataRange,
                            error.toString(),
                        )
                    )
                    if (!cancelled.get())
                        responder.handleFailure(HttpRequest.CONNECTION_ERROR, "Tileflow transport failed")
                }
            }
        if (cancelled.get()) task?.cancel(true)
    }

    override fun cancelRequest() {
        cancelled.set(true)
        task?.cancel(true)
        if (delegated) previous.cancelRequest()
    }
}
