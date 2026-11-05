package dev.tileflow.routing

import android.content.Context
import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.internal.TileflowJsonObject
import dev.tileflow.configuration.internal.TileflowServiceContext
import dev.tileflow.configuration.internal.TileflowServiceTransport
import okhttp3.OkHttpClient
import org.json.JSONObject

/**
 * Tileflow Routing: routes, isochrones, matrices, map matching and nearest roads. Operations
 * validate requests locally, send them with the configured Routing credential and the app
 * identity, and validate every answer.
 *
 * Every operation throws [TileflowRoutingException] on failure and rethrows cancellation.
 */
public class TileflowRouting
internal constructor(
    configuration: () -> TileflowConfiguration,
    app: () -> TileflowAppIdentity?,
    client: OkHttpClient,
) {
    /** A client that uses [dev.tileflow.configuration.Tileflow.configuration]. */
    public constructor(
        context: Context
    ) : this(
        TileflowServiceContext.configuration(context),
        TileflowServiceContext.app(context),
        TileflowServiceContext.defaultClient,
    )

    /** A client that uses [configuration] instead of the process configuration. */
    public constructor(
        context: Context,
        configuration: TileflowConfiguration,
    ) : this(
        { configuration },
        TileflowServiceContext.app(context),
        TileflowServiceContext.defaultClient,
    )

    private val transport = TileflowServiceTransport(routingErrors, configuration, app, client)

    /** The fastest route through the locations, with its alternatives when requested. */
    public suspend fun route(request: TileflowRouteRequest): TileflowRouteResponse =
        send("route", { RoutingWire.route(request) }) { RoutingDecoding.route(it, request) }

    /** The areas reachable from a location within each time. */
    public suspend fun isochrone(request: TileflowIsochroneRequest): TileflowIsochroneResponse =
        send("isochrone", { RoutingWire.isochrone(request) }) {
            RoutingDecoding.isochrone(it, request)
        }

    /** Travel times and distances from every source to every target. */
    public suspend fun matrix(request: TileflowMatrixRequest): TileflowMatrixResponse =
        send("matrix", { RoutingWire.matrix(request) }) { RoutingDecoding.matrix(it, request) }

    /** The roads a GPS trace followed. */
    public suspend fun match(request: TileflowMatchRequest): TileflowMatchResponse =
        send("match", { RoutingWire.match(request) }) { RoutingDecoding.match(it, request) }

    /** The nearest point of a road the mode can use. */
    public suspend fun nearest(request: TileflowNearestRequest): TileflowNearestResponse =
        send("nearest", { RoutingWire.nearest(request) }) { RoutingDecoding.nearest(it) }

    private suspend fun <T> send(
        operation: String,
        body: () -> JSONObject,
        decode: (TileflowJsonObject) -> T,
    ): T = transport.send("/v1/routing/$operation", REQUEST_BYTES, RESPONSE_BYTES, body, decode)

    private companion object {
        const val REQUEST_BYTES = 8 * 1024
        const val RESPONSE_BYTES = 4 * 1024 * 1024
    }
}
