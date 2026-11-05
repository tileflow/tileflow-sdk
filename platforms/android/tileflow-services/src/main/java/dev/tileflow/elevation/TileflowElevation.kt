package dev.tileflow.elevation

import android.content.Context
import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.internal.TileflowGeo
import dev.tileflow.configuration.internal.TileflowServiceContext
import dev.tileflow.configuration.internal.TileflowServiceTransport
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient

/**
 * Tileflow Elevation: the heights of positions and the profiles of lines. Operations validate
 * requests locally, send them with the configured Elevation credential and the app identity, and
 * validate every answer.
 *
 * Every operation throws [TileflowElevationException] on failure and rethrows cancellation.
 */
public class TileflowElevation
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

    private val transport = TileflowServiceTransport(elevationErrors, configuration, app, client)

    /** The elevations of 1 to 100 positions, in order. One request, one API unit. */
    public suspend fun points(
        positions: List<TileflowPosition>,
        unit: TileflowElevationUnit = TileflowElevationUnit.METERS,
    ): TileflowElevationPointsResponse =
        transport.send(
            "/v1/elevation/points",
            REQUEST_BYTES,
            RESPONSE_BYTES,
            { ElevationWire.points(positions, unit) },
        ) {
            ElevationDecoding.points(it, positions.size, unit)
        }

    /** The elevation of one position, or null where there is no data. */
    public suspend fun elevation(
        at: TileflowPosition,
        unit: TileflowElevationUnit = TileflowElevationUnit.METERS,
    ): Double? = points(listOf(at), unit).positions.single().elevation

    /**
     * The elevations of any number of positions, in order: 100 per request and at most four
     * requests at a time. Every request consumes one API unit; an empty list sends none.
     */
    public suspend fun batch(
        positions: List<TileflowPosition>,
        unit: TileflowElevationUnit = TileflowElevationUnit.METERS,
    ): TileflowElevationBatch {
        if (!positions.all(TileflowGeo::isValid))
            throw elevationErrors.invalidRequest(
                "Positions need a longitude within ±180 and a latitude within ±90."
            )
        val chunks = positions.chunked(POINTS_PER_REQUEST)
        val answers = arrayOfNulls<TileflowElevationPointsResponse>(chunks.size)
        val next = AtomicInteger()
        coroutineScope {
            repeat(minOf(CONCURRENT_REQUESTS, chunks.size)) {
                launch {
                    while (true) {
                        val index = next.getAndIncrement()
                        if (index >= chunks.size) break
                        answers[index] = points(chunks[index], unit)
                    }
                }
            }
        }
        val responses = answers.map { checkNotNull(it) }
        return TileflowElevationBatch(
            responses.flatMap { it.positions },
            unit,
            responses.map { it.attribution }.distinct().joinToString(" "),
            responses.sumOf { it.units },
        )
    }

    /** Evenly spaced samples along a line, with a summary of its climbs, drops and grades. */
    public suspend fun profile(request: TileflowElevationProfileRequest): TileflowElevationProfile =
        transport.send(
            "/v1/elevation/profile",
            REQUEST_BYTES,
            RESPONSE_BYTES,
            { ElevationWire.profile(request) },
        ) {
            ElevationDecoding.profile(it, request)
        }

    private companion object {
        const val REQUEST_BYTES = 1024 * 1024
        const val RESPONSE_BYTES = 512 * 1024
        const val POINTS_PER_REQUEST = 100
        const val CONCURRENT_REQUESTS = 4
    }
}
