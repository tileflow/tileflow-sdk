package dev.tileflow.sdk.transport

import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.attribution.MapFairUseSignal
import java.io.IOException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.Future
import java.util.concurrent.ThreadFactory
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.maplibre.android.http.HttpRequest
import org.maplibre.android.http.HttpResponder

/**
 * One MapLibre request. A Tileflow address is answered by the [ResourceLoader] of the map that
 * owns its context, on a worker of the SDK, never on MapLibre's thread; every other request goes
 * to [previous] unchanged.
 *
 * The answer carries the status, `ETag`, `Last-Modified` and `Retry-After` the transport returned
 * and always `Cache-Control: no-store`: the SDK's cache is the only cache.
 */
internal class MapLibreHttpRequest(private val previous: HttpRequest) : HttpRequest {
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
        if (!resourceUrl.startsWith(MapResourceAddress.PREFIX)) {
            delegated = true
            MapResourceContexts.onDelegated?.invoke(resourceUrl)
            previous.executeRequest(
                responder,
                nativePtr,
                resourceUrl,
                dataRange,
                etag,
                modified,
                offlineUsage,
            )
            return
        }
        val decoded = MapResourceAddress.decode(resourceUrl)
        val route = decoded?.let { MapResourceContexts.route(it.first) }
        if (decoded == null || route == null) {
            // A retired map's requests, or an address no map made: never answered from elsewhere.
            responder.handleFailure(
                HttpRequest.PERMANENT_ERROR,
                "No Tileflow map owns this request.",
            )
            return
        }
        val remote = decoded.second
        task =
            workers.submit {
                if (cancelled.get()) return@submit
                val kind =
                    runCatching { route.classify(remote) }.getOrDefault(TileflowResourceKind.OTHER)
                val origin = runCatching { ResourcePolicy.origin(remote) }.getOrDefault("")
                try {
                    val response =
                        route.loader.open(remote, "GET", dataRange.takeIf { it.isNotEmpty() })
                    val body = response.body.use { it.readBytes() }
                    route.report(
                        MapResourceOutcome(
                            kind,
                            origin,
                            response.status,
                            fairUse =
                                MapFairUseSignal.of(remote, response.status, response.headers),
                        )
                    )
                    MapResourceContexts.onRequest?.invoke(remote, response.status)
                    if (!cancelled.get())
                        responder.onResponse(
                            response.status,
                            response.headers["ETag"],
                            response.headers["Last-Modified"],
                            "no-store",
                            null,
                            response.headers["Retry-After"],
                            null,
                            body,
                        )
                } catch (error: Exception) {
                    if (cancelled.get()) return@submit
                    route.report(MapResourceOutcome(kind, origin, null, error))
                    MapResourceContexts.onRequest?.invoke(remote, null)
                    // A connection failure is retried when connectivity returns; a refusal is not.
                    val reason =
                        if (error is IOException) HttpRequest.CONNECTION_ERROR
                        else HttpRequest.PERMANENT_ERROR
                    responder.handleFailure(
                        reason,
                        if (error is TileflowMapException) error.code.name
                        else "The Tileflow transport could not answer.",
                    )
                }
            }
        if (cancelled.get()) task?.cancel(true)
    }

    override fun cancelRequest() {
        cancelled.set(true)
        task?.cancel(true)
        if (delegated) previous.cancelRequest()
    }

    private companion object {
        /** Bounded, so a burst of tile requests cannot start unbounded threads. */
        val workers: ExecutorService =
            Executors.newFixedThreadPool(
                8,
                object : ThreadFactory {
                    private val count = AtomicInteger()

                    override fun newThread(runnable: Runnable): Thread {
                        val name = "tileflow-map-resources-${count.incrementAndGet()}"
                        return Thread(runnable, name).apply { isDaemon = true }
                    }
                },
            )
    }
}
