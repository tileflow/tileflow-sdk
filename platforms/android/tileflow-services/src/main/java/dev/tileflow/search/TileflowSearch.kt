package dev.tileflow.search

import android.content.Context
import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.internal.TileflowServiceContext
import dev.tileflow.configuration.internal.TileflowServiceTransport
import okhttp3.OkHttpClient

/**
 * Tileflow Search: geocoding, reverse geocoding, autocomplete, suggestion resolution, Nearby and
 * its categories. Operations validate requests locally, send them with the configured Search
 * credential and the app identity, and validate every answer.
 *
 * Every operation throws [TileflowSearchException] on failure and rethrows cancellation.
 */
public class TileflowSearch
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

    private val transport = TileflowServiceTransport(searchErrors, configuration, app, client)

    /** Places that match a text. */
    public suspend fun geocode(request: TileflowGeocodeRequest): TileflowGeocodeResponse =
        transport.send(
            "/v1/geocoding/forward",
            REQUEST_BYTES,
            RESPONSE_BYTES,
            { SearchWire.geocode(request) },
        ) {
            SearchDecoding.geocode(
                it,
                units = placeUnits(request.include),
                maximumResults = request.limit ?: DEFAULT_LIMIT,
                kinds = null,
            )
        }

    /** The places at a position. */
    public suspend fun reverseGeocode(
        request: TileflowReverseGeocodeRequest
    ): TileflowGeocodeResponse =
        transport.send(
            "/v1/geocoding/reverse",
            REQUEST_BYTES,
            RESPONSE_BYTES,
            { SearchWire.reverseGeocode(request) },
        ) {
            SearchDecoding.geocode(
                it,
                units = placeUnits(request.include),
                maximumResults = request.limit,
                kinds = request.kinds.takeIf { kinds -> kinds.isNotEmpty() }?.map { kind ->
                    kind.wireName
                },
            )
        }

    /** Suggestions for partial text. */
    public suspend fun autocomplete(
        request: TileflowAutocompleteRequest
    ): TileflowAutocompleteResponse =
        transport.send(
            "/v1/geocoding/autocomplete",
            REQUEST_BYTES,
            RESPONSE_BYTES,
            { SearchWire.autocomplete(request) },
        ) {
            SearchDecoding.autocomplete(it, request.limit, request.includesPlaces)
        }

    /** The place of a suggestion or a Nearby result. */
    public suspend fun resolveSuggestion(
        request: TileflowResolveSuggestionRequest
    ): TileflowResolveSuggestionResponse =
        transport.send(
            "/v1/geocoding/resolve",
            REQUEST_BYTES,
            RESPONSE_BYTES,
            { SearchWire.resolveSuggestion(request) },
        ) {
            SearchDecoding.resolveSuggestion(it, placeUnits(request.include))
        }

    /** Places near a position. */
    public suspend fun searchNearby(request: TileflowNearbyRequest): TileflowNearbyResponse =
        transport.send(
            "/v1/geocoding/nearby",
            NEARBY_REQUEST_BYTES,
            LARGE_RESPONSE_BYTES,
            { SearchWire.nearby(request) },
        ) {
            SearchDecoding.nearby(it, placeUnits(request.include), request.limit)
        }

    /** The categories Nearby can filter by. */
    public suspend fun listCategories(): TileflowSearchCategoriesResponse =
        transport.send("/v1/geocoding/categories", REQUEST_BYTES, LARGE_RESPONSE_BYTES, null) {
            SearchDecoding.categories(it)
        }

    private companion object {
        const val DEFAULT_LIMIT = 5
        const val REQUEST_BYTES = 8 * 1024
        const val NEARBY_REQUEST_BYTES = 32 * 1024
        const val RESPONSE_BYTES = 64 * 1024
        const val LARGE_RESPONSE_BYTES = 512 * 1024

        fun placeUnits(include: List<TileflowPlaceDetail>): Int = if (include.isEmpty()) 10 else 30
    }
}
