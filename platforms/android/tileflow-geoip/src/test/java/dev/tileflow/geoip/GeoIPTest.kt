package dev.tileflow.geoip

import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.configuration.TileflowServiceErrorKind
import dev.tileflow.testing.Contract
import dev.tileflow.testing.StubApi
import dev.tileflow.testing.assertErrorCase
import dev.tileflow.testing.assertOperation
import dev.tileflow.testing.failure
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GeoIPTest {
    private fun StubApi.geoIp(configuration: TileflowConfiguration = configuration()) =
        TileflowGeoIP({ configuration }, { Contract.androidApp }, OkHttpClient())

    private fun StubApi.fails(): TileflowGeoIPException =
        failure { runBlocking { geoIp().locate() } }

    private fun contract(name: String): TileflowGeoIPResponse =
        StubApi().use { api ->
            api.enqueueOperation(name)
            // GeoIP is anonymous: it needs no credential.
            val anonymous = api.configuration(servicesCredential = null)
            val response = runBlocking { api.geoIp(anonymous).locate() }
            val request = api.take()
            assertOperation(name, request)
            assertEquals("application/json", request.getHeader("Accept"))
            for (header in listOf("Authorization", "X-Tileflow-App", "X-Tileflow-App-Certificate"))
                assertNull(request.getHeader(header))
            response
        }

    @Test
    fun locateMatchesTheContract() {
        val response = contract("geoip.locate")
        val location = response.location!!
        assertEquals("Madrid", location.city)
        assertEquals(TileflowGeoIPContinent.EUROPE, location.continentCode)
        assertEquals("ES", location.countryCode)
        assertEquals(true, location.isEuCountry)
        assertEquals(TileflowPosition(-3.7026, 40.4165), location.position)
        assertEquals("MD", location.regionCode)
        assertEquals("Europe/Madrid", location.timezone)
        assertNull(location.postalCode)
        assertEquals(0, response.units)
    }

    @Test
    fun anUnavailableLocationMatchesTheContract() {
        assertEquals(TileflowGeoIPResponse(null, 0), contract("geoip.unavailable"))
    }

    @Test
    fun aCredentialIsNeverSent() {
        StubApi().use { api ->
            api.enqueueOperation("geoip.locate")
            val configuration = api.configuration(mapCredential = Contract.credential)
            runBlocking { api.geoIp(configuration).locate() }
            assertNull(api.take().getHeader("Authorization"))
        }
    }

    @Test
    fun errorAnswersMatchTheContract() {
        val cases = Contract.errors("geoip")
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            StubApi().use { api ->
                api.enqueueError(case)
                val error = api.fails()
                assertErrorCase(case, error, error.code?.wireName)
            }
        }
    }

    @Test
    fun answersOutsideTheContractAreInvalid() {
        val cases: List<Pair<String, (JSONObject) -> Unit>> =
            listOf(
                "geoip.locate" to { it.getJSONObject("usage").put("units", 1) },
                "geoip.unavailable" to { it.getJSONObject("usage").put("units", 1) },
                "geoip.locate" to { it.put("schemaVersion", 2) },
                "geoip.locate" to { it.put("status", "partial") },
                "geoip.locate" to { it.put("location", JSONObject.NULL) },
                "geoip.locate" to { it.put("location", JSONObject().put("asn", 3352)) },
                "geoip.locate" to { it.getJSONObject("location").put("countryCode", "XX") },
                "geoip.locate" to { it.getJSONObject("location").put("countryCode", "es") },
                "geoip.locate" to { it.getJSONObject("location").put("continentCode", "ZZ") },
                "geoip.locate" to { it.getJSONObject("location").put("city", "  ") },
                "geoip.locate" to { it.getJSONObject("location").put("city", "Madrid\n") },
                "geoip.locate" to {
                    it.getJSONObject("location").put("position", JSONArray(listOf(-3.7, 91)))
                },
                "geoip.unavailable" to { it.put("location", JSONObject().put("city", "Madrid")) },
                "geoip.unavailable" to { it.remove("location") },
            )
        for ((name, change) in cases) {
            StubApi().use { api ->
                api.enqueue(Contract.response(name).also(change))
                val error = api.fails()
                assertEquals(TileflowServiceErrorKind.INVALID_RESPONSE, error.kind)
                assertEquals(200, error.status)
            }
        }
    }

    @Test
    fun locationTextIsTrimmedAndUnknownFieldsAreIgnored() {
        StubApi().use { api ->
            val answer = Contract.response("geoip.locate").put("network", JSONObject())
            answer.getJSONObject("location").put("city", " Madrid ").put("metro", 1)
            api.enqueue(answer)
            assertEquals("Madrid", runBlocking { api.geoIp().locate() }.location?.city)
        }
    }
}
