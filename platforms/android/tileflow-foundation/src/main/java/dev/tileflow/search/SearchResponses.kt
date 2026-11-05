package dev.tileflow.search

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import java.net.URI

/** The kind of a place. Kinds added to the API later decode as their own values. */
@JvmInline
public value class TileflowPlaceKind(public val value: String) {
    override fun toString(): String = value

    public companion object {
        public val ADDRESS: TileflowPlaceKind = TileflowPlaceKind("address")
        public val STREET: TileflowPlaceKind = TileflowPlaceKind("street")
        public val LOCALITY: TileflowPlaceKind = TileflowPlaceKind("locality")
        public val DISTRICT: TileflowPlaceKind = TileflowPlaceKind("district")
        public val COUNTY: TileflowPlaceKind = TileflowPlaceKind("county")
        public val REGION: TileflowPlaceKind = TileflowPlaceKind("region")
        public val COUNTRY: TileflowPlaceKind = TileflowPlaceKind("country")
        public val PLACE: TileflowPlaceKind = TileflowPlaceKind("place")
        public val UNKNOWN: TileflowPlaceKind = TileflowPlaceKind("unknown")
    }
}

/** The parts of an address the provider knows. [countryCode] is ISO 3166-1 alpha-2. */
public data class TileflowAddress(
    public val name: String? = null,
    public val houseNumber: String? = null,
    public val street: String? = null,
    public val locality: String? = null,
    public val district: String? = null,
    public val city: String? = null,
    public val county: String? = null,
    public val region: String? = null,
    public val postalCode: String? = null,
    public val country: String? = null,
    public val countryCode: String? = null,
)

public data class TileflowSearchCategory(
    public val id: String,
    public val name: String,
    public val localizedName: String? = null,
    public val primary: Boolean? = null,
)

public data class TileflowBusinessChain(public val id: String, public val name: String)

/** A phone, website or email as provider text, not a validated link: check it before linking. */
public data class TileflowContact(public val value: String, public val label: String? = null)

public data class TileflowContacts(
    public val phones: List<TileflowContact> = emptyList(),
    public val websites: List<TileflowContact> = emptyList(),
    public val emails: List<TileflowContact> = emptyList(),
)

public data class TileflowOpeningHours(
    public val display: List<String> = emptyList(),
    public val openNow: Boolean? = null,
)

/** An IANA time zone and its current offset from UTC. */
public data class TileflowTimeZone(
    public val name: String,
    public val utcOffsetSeconds: Int? = null,
)

/**
 * A place. Details are present only when the request included them.
 *
 * @property accessPoints Where the place is entered.
 * @property token The token to resolve a Nearby result with.
 */
public data class TileflowPlace(
    public val kind: TileflowPlaceKind,
    public val label: String,
    public val position: TileflowPosition,
    public val address: TileflowAddress,
    public val bounds: TileflowBoundingBox? = null,
    public val sourceRef: String? = null,
    public val name: String? = null,
    public val categories: List<TileflowSearchCategory> = emptyList(),
    public val foodTypes: List<TileflowSearchCategory> = emptyList(),
    public val businessChains: List<TileflowBusinessChain> = emptyList(),
    public val distanceMeters: Double? = null,
    public val contacts: TileflowContacts? = null,
    public val openingHours: List<TileflowOpeningHours> = emptyList(),
    public val timeZone: TileflowTimeZone? = null,
    public val accessPoints: List<TileflowPosition> = emptyList(),
    public val token: String? = null,
)

/** The data source that answered. */
public data class TileflowSearchSource(public val id: String, public val revision: String?)

/** A credit to show with the results. [url] is an `https` link, when the source has one. */
public data class TileflowSearchAttribution(public val text: String, public val url: URI? = null)

/** @property units The API units the operation consumed. */
public data class TileflowGeocodeResponse(
    public val queryId: String,
    public val results: List<TileflowPlace>,
    public val source: TileflowSearchSource,
    public val attribution: List<TileflowSearchAttribution>,
    public val units: Int,
)

/** @property token Resolves the suggestion to its place. */
public data class TileflowSuggestion(
    public val kind: TileflowPlaceKind,
    public val label: String,
    public val addressLabel: String? = null,
    public val place: TileflowPlace? = null,
    public val token: String,
)

public data class TileflowAutocompleteResponse(
    public val suggestions: List<TileflowSuggestion>,
    public val source: TileflowSearchSource,
    public val attribution: List<TileflowSearchAttribution>,
    public val units: Int,
)

public data class TileflowResolveSuggestionResponse(
    public val result: TileflowPlace,
    public val source: TileflowSearchSource,
    public val attribution: List<TileflowSearchAttribution>,
    public val units: Int,
)

/** @property nextCursor Requests the next page when more results exist. */
public data class TileflowNearbyResponse(
    public val results: List<TileflowPlace>,
    public val nextCursor: String? = null,
    public val source: TileflowSearchSource,
    public val attribution: List<TileflowSearchAttribution>,
    public val units: Int,
)

/** The categories Nearby can filter by. Listing them consumes no units. */
public data class TileflowSearchCategoriesResponse(
    public val categories: List<TileflowSearchCategory>,
    public val source: TileflowSearchSource,
    public val attribution: List<TileflowSearchAttribution>,
)
