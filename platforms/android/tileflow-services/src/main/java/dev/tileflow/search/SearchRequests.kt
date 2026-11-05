package dev.tileflow.search

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition

/**
 * Optional place details. Any of them makes an operation an extended one that consumes more API
 * units. Contacts and opening hours need a text search inside bounds, Nearby or a resolved
 * suggestion; time zones and access points are available to every place operation.
 */
public enum class TileflowPlaceDetail(internal val wireName: String) {
    CONTACTS("contacts"),
    OPENING_HOURS("openingHours"),
    TIME_ZONE("timeZone"),
    ACCESS_POINTS("accessPoints"),
}

/** The kinds of place a reverse geocode can answer with. */
public enum class TileflowReverseGeocodingKind(internal val wireName: String) {
    ADDRESS("address"),
    STREET("street"),
    LOCALITY("locality"),
    PLACE("place"),
}

/**
 * A text search. Give [bounds] or [proximity], not both; send the map centre as [proximity] at
 * city scale or closer.
 *
 * @property query 1 to 200 characters once trimmed, without control characters.
 * @property language A language tag such as `es` or `pt-BR`.
 * @property limit 1 to 10 results; the API answers at most 5 when it is null.
 */
public data class TileflowGeocodeRequest(
    public val query: String,
    public val language: String? = null,
    public val limit: Int? = null,
    public val bounds: TileflowBoundingBox? = null,
    public val proximity: TileflowPosition? = null,
    public val include: List<TileflowPlaceDetail> = emptyList(),
)

/**
 * The places at a position.
 *
 * @property kinds 1 to 4 kinds to answer with, or every kind when empty.
 * @property limit 1 to 10 results.
 */
public data class TileflowReverseGeocodeRequest(
    public val position: TileflowPosition,
    public val kinds: List<TileflowReverseGeocodingKind> = emptyList(),
    public val language: String? = null,
    public val limit: Int = 1,
    public val include: List<TileflowPlaceDetail> = emptyList(),
)

/**
 * Suggestions for partial text, for example while a person types.
 *
 * @property limit 1 to 10 suggestions.
 * @property includesPlaces Whether each suggestion carries its place, which consumes more units.
 */
public data class TileflowAutocompleteRequest(
    public val query: String,
    public val language: String? = null,
    public val limit: Int = 5,
    public val bounds: TileflowBoundingBox? = null,
    public val proximity: TileflowPosition? = null,
    public val includesPlaces: Boolean = false,
)

/** The place of a suggestion, or of a Nearby result, by its token. */
public data class TileflowResolveSuggestionRequest(
    public val token: String,
    public val include: List<TileflowPlaceDetail> = emptyList(),
)

/**
 * Places near a position, optionally filtered by category and country. Give [radiusMeters] or
 * [bounds], not both, and never the same category in [includeCategories] and
 * [excludeCategories].
 *
 * @property countries ISO 3166-1 alpha-2 or alpha-3 codes.
 * @property limit 1 to 100 results.
 * @property cursor The [TileflowNearbyResponse.nextCursor] of the previous page.
 */
public data class TileflowNearbyRequest(
    public val position: TileflowPosition,
    public val radiusMeters: Int? = null,
    public val bounds: TileflowBoundingBox? = null,
    public val includeCategories: List<String> = emptyList(),
    public val excludeCategories: List<String> = emptyList(),
    public val countries: List<String> = emptyList(),
    public val language: String? = null,
    public val include: List<TileflowPlaceDetail> = emptyList(),
    public val limit: Int = 20,
    public val cursor: String? = null,
)
