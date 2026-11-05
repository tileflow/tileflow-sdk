package dev.tileflow.search

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.internal.TileflowGeo
import dev.tileflow.configuration.internal.TileflowJson
import dev.tileflow.configuration.internal.TileflowJsonArray
import dev.tileflow.configuration.internal.TileflowJsonObject
import dev.tileflow.configuration.internal.TileflowText
import dev.tileflow.configuration.internal.invalidResponse
import dev.tileflow.configuration.internal.requireRequest
import dev.tileflow.configuration.internal.requireResponse
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject

/** Validates Search requests and encodes them as the API expects. */
internal object SearchWire {
    private val LANGUAGE = Regex("^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$")
    private val COUNTRY = Regex("^(?:[A-Z]{2}|[A-Z]{3})$")
    private val CONTACT_DETAILS =
        setOf(TileflowPlaceDetail.CONTACTS, TileflowPlaceDetail.OPENING_HOURS)

    fun geocode(request: TileflowGeocodeRequest): JSONObject {
        val query = query(request.query)
        language(request.language)
        request.limit?.let { requireRequest(it in 1..10) { "The limit must be 1 to 10." } }
        area(request.bounds, request.proximity)
        details(request.include)
        // Contacts and opening hours come from a text search inside bounds, not from geocoding.
        if (request.bounds == null) rejectContactDetails(request.include)
        return JSONObject()
            .put("query", query)
            .putOpt("language", request.language)
            .putOpt("limit", request.limit)
            .putOpt("bounds", request.bounds?.let(TileflowJson::bounds))
            .putOpt("proximity", request.proximity?.let(TileflowJson::position))
            .putOpt("include", details(request.include))
            .put("retention", "temporary")
    }

    fun reverseGeocode(request: TileflowReverseGeocodeRequest): JSONObject {
        position(request.position)
        requireRequest(request.kinds.size <= 4) { "Give at most 4 kinds." }
        language(request.language)
        requireRequest(request.limit in 1..10) { "The limit must be 1 to 10." }
        details(request.include)
        rejectContactDetails(request.include)
        return JSONObject()
            .put("position", TileflowJson.position(request.position))
            .putOpt(
                "kinds",
                request.kinds
                    .takeIf { it.isNotEmpty() }
                    ?.let { kinds -> TileflowJson.strings(kinds.map { it.wireName }) },
            )
            .putOpt("language", request.language)
            .put("limit", request.limit)
            .putOpt("include", details(request.include))
            .put("retention", "temporary")
    }

    fun autocomplete(request: TileflowAutocompleteRequest): JSONObject {
        val query = query(request.query)
        language(request.language)
        requireRequest(request.limit in 1..10) { "The limit must be 1 to 10." }
        area(request.bounds, request.proximity)
        return JSONObject()
            .put("query", query)
            .putOpt("language", request.language)
            .put("limit", request.limit)
            .putOpt("bounds", request.bounds?.let(TileflowJson::bounds))
            .putOpt("proximity", request.proximity?.let(TileflowJson::position))
            .putOpt("include", if (request.includesPlaces) JSONArray().put("place") else null)
    }

    fun resolveSuggestion(request: TileflowResolveSuggestionRequest): JSONObject {
        requireRequest(TileflowText.isPrintableAscii(request.token, 2_048)) {
            "The token must be 1 to 2048 printable ASCII characters."
        }
        return JSONObject()
            .put("token", request.token)
            .putOpt("include", details(request.include))
            .put("retention", "temporary")
    }

    fun nearby(request: TileflowNearbyRequest): JSONObject {
        position(request.position)
        request.radiusMeters?.let {
            requireRequest(it in 1..21_000_000) { "The radius must be 1 to 21,000,000 metres." }
        }
        request.bounds?.let { bounds(it) }
        categories(request.includeCategories)
        categories(request.excludeCategories)
        requireRequest(
            request.countries.size <= 100 && request.countries.all { COUNTRY.matches(it) }
        ) {
            "Give at most 100 ISO 3166-1 alpha-2 or alpha-3 country codes."
        }
        language(request.language)
        details(request.include)
        requireRequest(request.limit in 1..100) { "The limit must be 1 to 100." }
        request.cursor?.let {
            requireRequest(TileflowText.isPrintableAscii(it, 8_192)) {
                "The cursor must be 1 to 8192 printable ASCII characters."
            }
        }
        if (
            (request.radiusMeters != null && request.bounds != null) ||
                request.includeCategories.any { it in request.excludeCategories }
        )
            throw searchErrors.invalidRequest(
                "Nearby cannot combine a radius with bounds or include and exclude one category.",
                TileflowSearchErrorCode.FILTER_UNSUPPORTED,
            )
        return JSONObject()
            .put("position", TileflowJson.position(request.position))
            .putOpt("radiusMeters", request.radiusMeters)
            .putOpt("bounds", request.bounds?.let(TileflowJson::bounds))
            .putOpt("includeCategories", strings(request.includeCategories))
            .putOpt("excludeCategories", strings(request.excludeCategories))
            .putOpt("countries", strings(request.countries))
            .putOpt("language", request.language)
            .putOpt("include", details(request.include))
            .put("limit", request.limit)
            .putOpt("cursor", request.cursor)
    }

    private fun query(value: String): String {
        val query = TileflowText.trim(value)
        requireRequest(query.length in 1..200 && !TileflowText.hasControlCharacter(query)) {
            "The query must have 1 to 200 characters without control characters."
        }
        return query
    }

    private fun language(value: String?) {
        if (value == null) return
        requireRequest(value.length <= 35 && LANGUAGE.matches(value)) {
            "The language must be a language tag such as es or pt-BR."
        }
    }

    private fun position(value: TileflowPosition) {
        requireRequest(TileflowGeo.isValid(value)) {
            "Positions need a longitude within ±180 and a latitude within ±90."
        }
    }

    private fun bounds(value: TileflowBoundingBox) {
        requireRequest(TileflowGeo.isValid(value)) {
            "Bounds need valid corners, west less than east and south less than north."
        }
    }

    private fun area(bounds: TileflowBoundingBox?, proximity: TileflowPosition?) {
        bounds?.let(::bounds)
        proximity?.let(::position)
        requireRequest(bounds == null || proximity == null) {
            "Give bounds or proximity, not both."
        }
    }

    private fun details(include: List<TileflowPlaceDetail>): JSONArray? {
        requireRequest(include.toSet().size == include.size) { "Include each detail once." }
        return include.takeIf { it.isNotEmpty() }?.let { details ->
            TileflowJson.strings(details.map { it.wireName })
        }
    }

    private fun categories(values: List<String>) {
        requireRequest(
            values.size <= 10 && values.all { TileflowText.literal(it, 100) != null }
        ) {
            "Give at most 10 categories of 1 to 100 characters without control characters."
        }
    }

    private fun strings(values: List<String>): JSONArray? =
        values.takeIf { it.isNotEmpty() }?.let(TileflowJson::strings)

    private fun rejectContactDetails(include: List<TileflowPlaceDetail>) {
        if (include.any { it in CONTACT_DETAILS })
            throw searchErrors.invalidRequest(
                "Contacts and opening hours need a text search inside bounds, Nearby or a " +
                    "resolved suggestion.",
                TileflowSearchErrorCode.FILTER_UNSUPPORTED,
            )
    }
}

/** Reads Search answers and checks them against the request. */
internal object SearchDecoding {
    private val QUERY_ID =
        Regex("^gq_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
    private val SOURCE_REFERENCE = Regex("^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
    private val COUNTRY_CODE = Regex("^[A-Z]{2}$")

    fun geocode(
        root: TileflowJsonObject,
        units: Int,
        maximumResults: Int,
        kinds: List<String>?,
    ): TileflowGeocodeResponse {
        root.requireSchemaVersion()
        val queryId = root.string("queryId")
        requireResponse(QUERY_ID.matches(queryId))
        val results = root.array("results").sized(0..10).mapObjects { place(it, nearby = false) }
        val response =
            TileflowGeocodeResponse(
                queryId,
                results,
                source(root),
                attribution(root),
                units(root, setOf(10, 30)),
            )
        requireResponse(response.units == units && results.size <= maximumResults)
        if (kinds != null) requireResponse(results.all { it.kind.value in kinds })
        return response
    }

    fun autocomplete(
        root: TileflowJsonObject,
        limit: Int,
        includesPlaces: Boolean,
    ): TileflowAutocompleteResponse {
        root.requireSchemaVersion()
        val suggestions =
            root.array("suggestions").sized(0..10).mapObjects {
                TileflowSuggestion(
                    kind = kind(it),
                    label = it.boundedText("label", 512),
                    addressLabel = it.optBoundedText("addressLabel", 512),
                    place = it.optObj("place")?.let { place -> place(place, nearby = false) },
                    token = token(it.string("token")),
                )
            }
        val response =
            TileflowAutocompleteResponse(
                suggestions,
                source(root),
                attribution(root),
                units(root, setOf(4, 10)),
            )
        requireResponse(
            response.units == (if (includesPlaces) 10 else 4) &&
                suggestions.size <= limit &&
                suggestions.all { (it.place != null) == includesPlaces }
        )
        return response
    }

    fun resolveSuggestion(root: TileflowJsonObject, units: Int): TileflowResolveSuggestionResponse {
        root.requireSchemaVersion()
        val response =
            TileflowResolveSuggestionResponse(
                place(root.obj("result"), nearby = false),
                source(root),
                attribution(root),
                units(root, setOf(10, 30)),
            )
        requireResponse(response.units == units)
        return response
    }

    fun nearby(root: TileflowJsonObject, units: Int, limit: Int): TileflowNearbyResponse {
        root.requireSchemaVersion()
        val results = root.array("results").sized(0..100).mapObjects { place(it, nearby = true) }
        val nextCursor =
            root.optString("nextCursor")?.also {
                requireResponse(TileflowText.isPrintableAscii(it, 8_192))
            }
        val response =
            TileflowNearbyResponse(
                results,
                nextCursor,
                source(root),
                attribution(root),
                units(root, setOf(10, 30)),
            )
        requireResponse(
            response.units == units &&
                results.size <= limit &&
                results.all { it.kind == TileflowPlaceKind.PLACE }
        )
        return response
    }

    fun categories(root: TileflowJsonObject): TileflowSearchCategoriesResponse {
        root.requireSchemaVersion()
        val categories = root.array("categories").sized(1..2_000).mapObjects(::category)
        val response = TileflowSearchCategoriesResponse(categories, source(root), attribution(root))
        requireResponse(units(root, setOf(0)) == 0)
        return response
    }

    private fun units(root: TileflowJsonObject, allowed: Set<Int>): Int {
        val units = root.obj("usage").long("units")
        requireResponse(units.toInt().toLong() == units && units.toInt() in allowed)
        return units.toInt()
    }

    private fun source(root: TileflowJsonObject): TileflowSearchSource {
        val source = root.obj("source")
        // The revision is required and may be null.
        val revision = if (source.isNull("revision")) null else source.boundedText("revision", 128)
        return TileflowSearchSource(source.boundedText("id", 128), revision)
    }

    private fun attribution(root: TileflowJsonObject): List<TileflowSearchAttribution> =
        root.array("attribution").sized(1..8).mapObjects {
            TileflowSearchAttribution(it.boundedText("text", 512), it.optString("url")?.let(::link))
        }

    private fun link(value: String): URI {
        requireResponse(value.length <= 2_048 && !TileflowText.hasControlCharacter(value))
        val url =
            try {
                URI(value)
            } catch (_: Exception) {
                invalidResponse()
            }
        requireResponse(
            url.scheme.equals("https", ignoreCase = true) &&
                !url.host.isNullOrEmpty() &&
                url.rawUserInfo == null
        )
        return url
    }

    private fun kind(value: TileflowJsonObject): TileflowPlaceKind =
        TileflowPlaceKind(value.literalText("kind", 64))

    private fun token(value: String): String {
        requireResponse(TileflowText.isPrintableAscii(value, 2_048))
        return value
    }

    private fun place(value: TileflowJsonObject, nearby: Boolean): TileflowPlace =
        TileflowPlace(
            kind = kind(value),
            label = value.boundedText("label", 512),
            position = value.position("position"),
            address = address(value.obj("address")),
            bounds = value.optBounds("bounds"),
            sourceRef =
                if (nearby) null
                else
                    value.optString("sourceRef")?.also {
                        requireResponse(SOURCE_REFERENCE.matches(it))
                    },
            name = value.optLiteralText("name", 200),
            categories = value.optArray("categories")?.let(::categoryList).orEmpty(),
            foodTypes = value.optArray("foodTypes")?.let(::categoryList).orEmpty(),
            businessChains =
                value.optArray("businessChains")?.sized(1..100)?.mapObjects {
                    TileflowBusinessChain(it.literalText("id", 100), it.literalText("name", 100))
                }
                    .orEmpty(),
            distanceMeters =
                value.optDouble("distanceMeters")?.also { requireResponse(it >= 0) },
            contacts = value.optObj("contacts")?.let(::contacts),
            openingHours =
                value.optArray("openingHours")?.sized(1..20)?.mapObjects {
                    TileflowOpeningHours(
                        it.optArray("display")?.sized(1..50)?.literalStrings(256).orEmpty(),
                        it.optBoolean("openNow"),
                    )
                }
                    .orEmpty(),
            timeZone =
                value.optObj("timeZone")?.let {
                    TileflowTimeZone(
                        it.literalText("name", 64),
                        it.optInt("utcOffsetSeconds", -86_400..86_400),
                    )
                },
            accessPoints =
                value.optArray("accessPoints")?.sized(1..100)?.mapObjects {
                    it.position("position")
                }
                    .orEmpty(),
            token = if (nearby) value.optString("token")?.let(::token) else null,
        )

    private fun address(value: TileflowJsonObject): TileflowAddress {
        fun part(key: String) = value.optBoundedText(key, 256)
        return TileflowAddress(
            name = part("name"),
            houseNumber = part("houseNumber"),
            street = part("street"),
            locality = part("locality"),
            district = part("district"),
            city = part("city"),
            county = part("county"),
            region = part("region"),
            postalCode = part("postalCode"),
            country = part("country"),
            countryCode =
                value.optString("countryCode")?.also { requireResponse(COUNTRY_CODE.matches(it)) },
        )
    }

    private fun categoryList(value: TileflowJsonArray): List<TileflowSearchCategory> =
        value.sized(1..100).mapObjects(::category)

    private fun category(value: TileflowJsonObject): TileflowSearchCategory =
        TileflowSearchCategory(
            value.literalText("id", 100),
            value.literalText("name", 100),
            value.optLiteralText("localizedName", 100),
            value.optBoolean("primary"),
        )

    private fun contacts(value: TileflowJsonObject): TileflowContacts {
        fun list(key: String) =
            value.optArray(key)?.sized(1..100)?.mapObjects {
                TileflowContact(it.literalText("value", 2_048), it.optLiteralText("label", 256))
            }
                .orEmpty()
        return TileflowContacts(list("phones"), list("websites"), list("emails"))
    }
}
