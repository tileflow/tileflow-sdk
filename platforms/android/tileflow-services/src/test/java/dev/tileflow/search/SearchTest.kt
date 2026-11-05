package dev.tileflow.search

import dev.tileflow.configuration.TileflowAppIdentity
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowConfigurationException
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.testing.Contract
import dev.tileflow.testing.StubApi
import dev.tileflow.testing.assertErrorCase
import dev.tileflow.testing.assertOperation
import dev.tileflow.testing.assertServiceHeaders
import dev.tileflow.testing.failure
import java.net.URI
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SearchTest {
    private val madrid = TileflowPosition(-3.7038, 40.4168)
    private val other = "tf_public_" + "c".repeat(48)

    private val geocode =
        TileflowGeocodeRequest("Puerta del Sol", language = "es", limit = 3, proximity = madrid)
    private val reverse =
        TileflowReverseGeocodeRequest(madrid, kinds = listOf(TileflowReverseGeocodingKind.ADDRESS))
    private val autocomplete = TileflowAutocompleteRequest("Puerta", proximity = madrid)
    private val autocompletePlaces =
        TileflowAutocompleteRequest("Puerta", limit = 2, includesPlaces = true)
    private val resolve =
        TileflowResolveSuggestionRequest(
            "sg_7b1e4f2a9c0d3e5f6a7b8c9d0e1f2a3b",
            include = listOf(TileflowPlaceDetail.TIME_ZONE),
        )
    private val nearby =
        TileflowNearbyRequest(
            madrid,
            radiusMeters = 500,
            includeCategories = listOf("restaurant"),
            include = listOf(TileflowPlaceDetail.OPENING_HOURS),
            limit = 2,
        )

    private val operations: Map<String, suspend TileflowSearch.() -> Any> =
        mapOf(
            "search.geocode" to { geocode(geocode) },
            "search.reverse" to { reverseGeocode(reverse) },
            "search.autocomplete" to { autocomplete(autocomplete) },
            "search.autocompletePlaces" to { autocomplete(autocompletePlaces) },
            "search.resolve" to { resolveSuggestion(resolve) },
            "search.nearby" to { searchNearby(nearby) },
            "search.categories" to { listCategories() },
        )

    private fun StubApi.search(
        configuration: TileflowConfiguration = configuration(),
        app: () -> TileflowAppIdentity? = { Contract.androidApp },
    ) = TileflowSearch({ configuration }, app, OkHttpClient())

    private fun <T> StubApi.call(block: suspend TileflowSearch.() -> T): T =
        runBlocking { search().block() }

    private fun StubApi.fails(
        search: TileflowSearch = search(),
        block: suspend TileflowSearch.() -> Any,
    ): TileflowSearchException = failure { runBlocking { search.block() } }

    /** Serves an operation's answer and checks its request against the contract. */
    @Suppress("UNCHECKED_CAST")
    private fun <T> contract(name: String): T =
        StubApi().use { api ->
            api.enqueueOperation(name)
            val response = api.call(operations.getValue(name))
            val request = api.take()
            assertOperation(name, request)
            assertServiceHeaders(request)
            response as T
        }

    @Test
    fun geocodeMatchesTheContract() {
        val response = contract<TileflowGeocodeResponse>("search.geocode")
        assertEquals("gq_1b4e28ba-2fa1-41d2-883f-0016d3cca427", response.queryId)
        assertEquals(10, response.units)
        val place = response.results[0]
        assertEquals(TileflowPlaceKind.PLACE, place.kind)
        assertEquals("Puerta del Sol", place.name)
        assertEquals(TileflowPosition(-3.703582, 40.416705), place.position)
        assertEquals(TileflowBoundingBox(-3.705, 40.4157, -3.7021, 40.4176), place.bounds)
        assertEquals("ES", place.address.countryCode)
        assertEquals(true, place.categories.single().primary)
        assertEquals("osm:way/4352376", place.sourceRef)
        assertEquals(TileflowPlaceKind.STREET, response.results[1].kind)
        assertEquals("28014", response.results[1].address.postalCode)
        assertEquals(TileflowSearchSource("tileflow-search", "2026-10-01"), response.source)
        assertEquals(URI("https://www.openstreetmap.org/copyright"), response.attribution[0].url)
    }

    @Test
    fun reverseGeocodeMatchesTheContract() {
        val response = contract<TileflowGeocodeResponse>("search.reverse")
        val place = response.results.single()
        assertEquals(TileflowPlaceKind.ADDRESS, place.kind)
        assertEquals("7", place.address.houseNumber)
        assertEquals(12.4, place.distanceMeters!!, 0.0)
    }

    @Test
    fun autocompleteMatchesTheContract() {
        val response = contract<TileflowAutocompleteResponse>("search.autocomplete")
        assertEquals(4, response.units)
        assertEquals(
            listOf("sg_7b1e4f2a9c0d3e5f6a7b8c9d0e1f2a3b", "sg_c3d4e5f6"),
            response.suggestions.map { it.token },
        )
        assertEquals("Madrid, Spain", response.suggestions[0].addressLabel)
        assertNull(response.suggestions[0].place)
        val places = contract<TileflowAutocompleteResponse>("search.autocompletePlaces")
        assertEquals(10, places.units)
        assertEquals(
            TileflowPosition(-3.703582, 40.416705),
            places.suggestions.single().place?.position,
        )
    }

    @Test
    fun resolveSuggestionMatchesTheContract() {
        val response = contract<TileflowResolveSuggestionResponse>("search.resolve")
        assertEquals(30, response.units)
        assertEquals(TileflowTimeZone("Europe/Madrid", 3600), response.result.timeZone)
    }

    @Test
    fun nearbyMatchesTheContract() {
        val response = contract<TileflowNearbyResponse>("search.nearby")
        assertEquals("nc_2a7f", response.nextCursor)
        val place = response.results.single()
        assertEquals("np_0f6c2a9d1b7e4c3a", place.token)
        assertEquals("Restaurante", place.categories.single().localizedName)
        assertEquals(true, place.openingHours.single().openNow)
        assertEquals(64.0, place.distanceMeters!!, 0.0)
        assertNull(place.sourceRef)
    }

    @Test
    fun categoriesMatchTheContract() {
        val response = contract<TileflowSearchCategoriesResponse>("search.categories")
        assertEquals(listOf("restaurant", "cafe", "pharmacy"), response.categories.map { it.id })
    }

    @Test
    fun errorAnswersMatchTheContract() {
        val cases = Contract.errors("search")
        assertEquals(5, cases.size)
        for (case in cases) {
            StubApi().use { api ->
                api.enqueueError(case)
                val error = api.fails(block = operations.getValue(case.getString("operation")))
                assertErrorCase(case, error, error.code?.wireName)
            }
        }
    }

    @Test
    fun answersOutsideTheContractAreInvalid() {
        fun JSONObject.firstResult(key: String = "results") = getJSONArray(key).getJSONObject(0)
        val cases: List<Pair<String, (JSONObject) -> Unit>> =
            listOf(
                "search.geocode" to { it.getJSONObject("usage").put("units", 30) },
                "search.geocode" to { it.put("schemaVersion", 2) },
                "search.geocode" to {
                    it.firstResult().put("position", JSONArray(listOf(200, 40)))
                },
                "search.geocode" to { it.firstResult().put("label", 12) },
                "search.geocode" to { it.firstResult().put("categories", JSONArray()) },
                "search.geocode" to { it.getJSONObject("source").remove("revision") },
                "search.geocode" to {
                    it.getJSONArray("attribution").getJSONObject(0).put("url", "http://example.com")
                },
                "search.geocode" to {
                    val results = it.getJSONArray("results")
                    repeat(2) { results.put(JSONObject(results.getJSONObject(0).toString())) }
                },
                "search.reverse" to { it.firstResult().put("kind", "street") },
                "search.autocompletePlaces" to {
                    it.getJSONArray("suggestions").getJSONObject(0).remove("place")
                },
                "search.nearby" to { it.firstResult().put("kind", "address") },
                "search.categories" to { it.getJSONObject("usage").put("units", 10) },
            )
        for ((name, change) in cases) {
            StubApi().use { api ->
                api.enqueue(Contract.response(name).also(change))
                val error = api.fails(block = operations.getValue(name))
                assertEquals(TileflowServiceErrorKind.INVALID_RESPONSE, error.kind)
                assertEquals(200, error.status)
            }
        }
    }

    @Test
    fun oversizeAnswersAreInvalid() {
        StubApi().use { api ->
            api.enqueue(Contract.response("search.geocode").put("padding", "x".repeat(64 * 1024)))
            val error = api.fails { geocode(geocode) }
            assertEquals(TileflowServiceErrorKind.INVALID_RESPONSE, error.kind)
        }
    }

    @Test
    fun unknownKeysAndKindsDecode() {
        StubApi().use { api ->
            val answer =
                Contract.response("search.geocode").put("ranking", JSONObject().put("v", 2))
            answer.getJSONArray("results").getJSONObject(0).put("kind", "postcode").put("extra", 1)
            api.enqueue(answer)
            val response = api.call { geocode(geocode) }
            assertEquals(TileflowPlaceKind("postcode"), response.results[0].kind)
        }
    }

    @Test
    fun invalidRequestsAreRejectedLocally() {
        val bounds = TileflowBoundingBox(-3.8, 40.3, -3.6, 40.5)
        val collapsed = TileflowBoundingBox(1.0, 0.0, 1.0, 1.0)
        val unknown = TileflowPosition(Double.NaN, 0.0)
        val twice = listOf(TileflowPlaceDetail.TIME_ZONE, TileflowPlaceDetail.TIME_ZONE)
        val requests: List<suspend TileflowSearch.() -> Any> =
            listOf(
                { geocode(TileflowGeocodeRequest("   ")) },
                { geocode(TileflowGeocodeRequest("Sol\u0000")) },
                { geocode(TileflowGeocodeRequest("x".repeat(201))) },
                { geocode(TileflowGeocodeRequest("Sol", language = "ES")) },
                { geocode(TileflowGeocodeRequest("Sol", limit = 0)) },
                { geocode(TileflowGeocodeRequest("Sol", limit = 11)) },
                { geocode(TileflowGeocodeRequest("Sol", bounds = bounds, proximity = madrid)) },
                { geocode(TileflowGeocodeRequest("Sol", bounds = collapsed)) },
                { geocode(TileflowGeocodeRequest("Sol", proximity = TileflowPosition(0.0, 91.0))) },
                { geocode(TileflowGeocodeRequest("Sol", proximity = unknown)) },
                { geocode(TileflowGeocodeRequest("Sol", include = twice)) },
                {
                    reverseGeocode(
                        TileflowReverseGeocodeRequest(
                            madrid,
                            kinds = List(5) { TileflowReverseGeocodingKind.PLACE },
                        )
                    )
                },
                { reverseGeocode(TileflowReverseGeocodeRequest(madrid, limit = 0)) },
                { autocomplete(TileflowAutocompleteRequest("Sol", limit = 11)) },
                { resolveSuggestion(TileflowResolveSuggestionRequest("sg 1")) },
                { resolveSuggestion(TileflowResolveSuggestionRequest("")) },
                { searchNearby(TileflowNearbyRequest(madrid, radiusMeters = 0)) },
                { searchNearby(TileflowNearbyRequest(madrid, countries = listOf("es"))) },
                { searchNearby(TileflowNearbyRequest(madrid, cursor = "next page")) },
                {
                    searchNearby(
                        TileflowNearbyRequest(madrid, includeCategories = List(11) { "c$it" })
                    )
                },
                { searchNearby(TileflowNearbyRequest(madrid, limit = 101)) },
                { searchNearby(TileflowNearbyRequest(madrid, excludeCategories = listOf(""))) },
            )
        StubApi().use { api ->
            for (request in requests) {
                val error = api.fails(block = request)
                assertEquals(TileflowServiceErrorKind.INVALID_REQUEST, error.kind)
                assertNull(error.code)
                assertNull(error.status)
            }
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun unsupportedFiltersAreRejectedLocally() {
        val bounds = TileflowBoundingBox(-3.8, 40.3, -3.6, 40.5)
        val contacts = listOf(TileflowPlaceDetail.CONTACTS)
        val requests: List<suspend TileflowSearch.() -> Any> =
            listOf(
                { geocode(TileflowGeocodeRequest("Sol", include = contacts)) },
                {
                    reverseGeocode(
                        TileflowReverseGeocodeRequest(
                            madrid,
                            include = listOf(TileflowPlaceDetail.OPENING_HOURS),
                        )
                    )
                },
                {
                    searchNearby(TileflowNearbyRequest(madrid, radiusMeters = 500, bounds = bounds))
                },
                {
                    searchNearby(
                        TileflowNearbyRequest(
                            madrid,
                            includeCategories = listOf("cafe", "bar"),
                            excludeCategories = listOf("bar"),
                        )
                    )
                },
            )
        StubApi().use { api ->
            for (request in requests) {
                val error = api.fails(block = request)
                assertEquals(TileflowServiceErrorKind.INVALID_REQUEST, error.kind)
                assertEquals(TileflowSearchErrorCode.FILTER_UNSUPPORTED, error.code)
                assertNull(error.status)
            }
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun contactDetailsAreAvailableInsideBounds() {
        StubApi().use { api ->
            api.enqueue(
                Contract.response("search.geocode").also {
                    it.getJSONObject("usage").put("units", 30)
                }
            )
            val bounds = TileflowBoundingBox(-3.8, 40.3, -3.6, 40.5)
            api.call {
                geocode(
                    TileflowGeocodeRequest(
                        "Sol",
                        bounds = bounds,
                        include = listOf(TileflowPlaceDetail.CONTACTS),
                    )
                )
            }
            val body = JSONObject(api.take().body.readUtf8())
            assertEquals("contacts", body.getJSONArray("include").getString(0))
            assertEquals(4, body.getJSONArray("bounds").length())
        }
    }

    @Test
    fun theSearchCredentialOverridesTheServicesCredential() {
        StubApi().use { api ->
            api.enqueueOperation("search.categories")
            runBlocking { api.search(api.configuration(searchCredential = other)).listCategories() }
            assertServiceHeaders(api.take(), credential = other)
        }
    }

    @Test
    fun anExplicitAppIdentityReplacesTheDetectedOne() {
        StubApi().use { api ->
            api.enqueueOperation("search.categories")
            val app = TileflowAppIdentity("com.example.maps")
            runBlocking {
                api.search(api.configuration(app = app)) { error("Not detected.") }.listCategories()
            }
            val request = api.take()
            assertEquals("com.example.maps", request.getHeader("X-Tileflow-App"))
            assertNull(request.getHeader("X-Tileflow-App-Certificate"))
        }
    }

    @Test
    fun missingConfigurationSendsNothing() {
        StubApi().use { api ->
            val searches =
                listOf(
                    api.search(
                        api.configuration(
                            servicesCredential = null,
                            mapCredential = Contract.credential,
                        )
                    ),
                    api.search(
                        api.configuration(
                            servicesCredential = null,
                            routingCredential = Contract.credential,
                        )
                    ),
                    api.search { throw TileflowConfigurationException("No signing certificate.") },
                    api.search { null },
                    TileflowSearch(
                        { throw TileflowConfigurationException("Invalid manifest value.") },
                        { Contract.androidApp },
                        OkHttpClient(),
                    ),
                )
            for (search in searches) {
                val error = api.fails(search) { geocode(geocode) }
                assertEquals(TileflowServiceErrorKind.CONFIGURATION, error.kind)
                assertNull(error.status)
            }
            assertEquals(0, api.requestCount)
        }
    }

    @Test
    fun redirectsAreNotFollowed() {
        StubApi().use { api ->
            val location = "${api.origin}/v1/geocoding/forward"
            api.server.enqueue(MockResponse().setResponseCode(307).setHeader("Location", location))
            api.enqueueOperation("search.geocode")
            val error = api.fails { geocode(geocode) }
            assertEquals(TileflowServiceErrorKind.NETWORK, error.kind)
            assertEquals(1, api.requestCount)
        }
    }
}
