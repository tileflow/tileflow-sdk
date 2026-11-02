package dev.tileflow.sdk.attribution

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * A map's attribution: its sources' attribution always, and each regional credit of a downloaded
 * release while one of its boxes is in view, with exact texts.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class MapAttributionTest {
    private val spain =
        MapCredit(
            "es-ign",
            "© IGN España",
            "https://www.ign.es",
            listOf(doubleArrayOf(-9.4, 35.9, 4.4, 43.8), doubleArrayOf(-18.2, 27.6, -13.4, 29.5)),
        )
    private val fiji =
        MapCredit(
            "fj",
            "Fiji",
            "https://example.com/fiji",
            listOf(doubleArrayOf(177.0, -19.2, 180.0, -16.0)),
        )

    private fun visible(
        credits: List<MapCredit>,
        west: Double,
        south: Double,
        east: Double,
        north: Double,
    ) = MapAttribution.visibleCredits(credits, west, south, east, north).map { it.id }

    @Test
    fun aCreditIsVisibleWhileOneOfItsBoxesIntersectsTheView() {
        assertEquals(listOf("es-ign"), visible(listOf(spain, fiji), -3.8, 40.3, -3.6, 40.5))
        assertEquals(listOf("es-ign"), visible(listOf(spain), -16.0, 28.0, -15.0, 29.0))
        assertEquals(emptyList<String>(), visible(listOf(spain), 2.2, 48.8, 2.5, 48.9))
        // Touching edges count, as the service's own intersection does.
        assertEquals(listOf("es-ign"), visible(listOf(spain), 4.4, 43.8, 5.0, 44.0))
    }

    @Test
    fun viewsAcrossTheAntimeridianAndWiderThanTheWorld() {
        assertEquals(listOf("fj"), visible(listOf(fiji, spain), 178.0, -18.0, 182.0, -17.0))
        assertEquals(listOf("fj"), visible(listOf(fiji), -183.0, -18.0, -179.0, -17.0))
        assertEquals(
            listOf("es-ign", "fj"),
            visible(listOf(spain, fiji), -200.0, -80.0, 200.0, 80.0),
        )
    }

    @Test
    fun sourcesComeFirstDistinctAndCreditsTheyAlreadyNameAreNotRepeated() {
        val attribution =
            MapAttribution(
                listOf("© OpenStreetMap", "", "© OpenStreetMap", "Data © IGN España"),
                listOf(spain, fiji),
            )
        assertEquals(
            listOf(
                MapAttributionEntry("© OpenStreetMap"),
                MapAttributionEntry("Data © IGN España"),
            ),
            attribution.entries(-3.8, 40.3, -3.6, 40.5),
        )
        val other = MapAttribution(listOf("© OpenStreetMap"), listOf(spain))
        assertEquals(
            listOf(
                MapAttributionEntry("© OpenStreetMap"),
                MapAttributionEntry("© IGN España", "https://www.ign.es"),
            ),
            other.entries(-3.8, 40.3, -3.6, 40.5),
        )
    }

    @Test
    fun creditsArriveAsTheViewSendsThem() {
        val credits =
            MapCredit.list(
                JSONArray(
                    """[{"id":"a","text":"A","href":"https://a.test","regions":[[0,0,1,1]]},
                        {"id":"b","text":"B","href":"http://b.test","regions":[[0,0,1,1]]},
                        {"id":"c","text":"C","href":"https://c.test","regions":[]}]"""
                )
            )
        assertEquals(listOf("a"), credits.map { it.id })
        assertEquals(emptyList<MapCredit>(), MapCredit.list(null))
    }

    /** Every case of the marine fixture: Nautical and Bathymetry at Miami, Oslo and Madrid. */
    @Test
    fun marineRegionalCreditsShowOnlyWhileTheirRegionsAreInView() {
        val text = javaClass.classLoader!!.getResource("marine-credits.json")!!.readText()
        val cases = JSONObject(text).getJSONArray("cases")
        assertEquals(12, cases.length())
        val everyCredit = mutableListOf<MapCredit>()
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val credit = case.getJSONObject("credit")
            val bounds = case.getJSONArray("bounds")
            val regional = credit.getJSONArray("regionalObligations")
            val credits =
                MapCredit.list(
                    JSONArray(
                        (0 until regional.length()).map {
                            val item = regional.getJSONObject(it)
                            JSONObject()
                                .put("id", item.getString("id"))
                                .put("text", item.getString("exact"))
                                .put("href", item.getString("href"))
                                .put("regions", item.getJSONArray("regions"))
                        }
                    )
                )
            assertEquals(regional.length(), credits.size)
            everyCredit += credits
            val attribution = MapAttribution(listOf(case.getString("attribution")), credits)
            val here =
                attribution.entries(
                    bounds.getDouble(0),
                    bounds.getDouble(1),
                    bounds.getDouble(2),
                    bounds.getDouble(3),
                )
            assertEquals(
                "${case.getString("place")} ${case.getString("source")}",
                listOf(MapAttributionEntry(case.getString("attribution"))) +
                    credits.map { MapAttributionEntry(it.text, it.href) },
                here,
            )
            // Over the South Pacific, only the source's own attribution remains.
            assertEquals(
                listOf(MapAttributionEntry(case.getString("attribution"))),
                attribution.entries(160.0, -50.0, 170.0, -40.0),
            )
            // A view wider than the world, across the antimeridian, sees every credit.
            assertEquals(credits.size + 1, attribution.entries(-250.0, -85.0, 250.0, 85.0).size)
        }
        // In Madrid only EMODnet is regional.
        fun regional(west: Double, south: Double, east: Double, north: Double): Set<String> {
            val visible = MapAttribution.visibleCredits(everyCredit, west, south, east, north)
            return visible.map { it.id }.toSet()
        }
        assertEquals(setOf("emodnet"), regional(-3.72, 40.4, -3.68, 40.43))
        assertEquals(setOf("noaa-enc", "usace-ienc"), regional(-80.3, 25.7, -80.1, 25.9))
        assertEquals(setOf("emodnet", "kartverket"), regional(10.5, 59.8, 10.9, 60.0))
        assertTrue(everyCredit.all { it.href.startsWith("https://") })
    }
}
