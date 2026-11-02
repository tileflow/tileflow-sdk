package dev.tileflow.sdk.attribution

import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import dev.tileflow.sdk.offline.OfflineCredit
import dev.tileflow.sdk.offline.OfflineObligation
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineServingSnapshot
import dev.tileflow.sdk.transport.ResourceCacheScope
import java.net.URI
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * What a map credits in a view: its style's sources, the obligations and pages of its downloaded
 * sources always, their regional credits while one of their boxes is in view, the style's notices
 * and World's fair-use notice, in that order, each exact text once, with `https` links only.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class AttributionTest {
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

    private fun bounds(values: JSONArray) = DoubleArray(4) { values.getDouble(it) }

    // Regional credits

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

    /** The text of a credit is shown as it is, never read as HTML, and its link is its page. */
    @Test
    fun creditTextAndLinksAreExact() {
        val credit =
            MapCredit("a", "<b>A & B</b>", "https://a.test/?x=1&y=2", listOf(doubleArrayOf(0.0, 0.0, 1.0, 1.0)))
        val entries = MapAttribution(credits = listOf(credit)).entries(doubleArrayOf(0.0, 0.0, 1.0, 1.0))
        assertEquals(listOf("<b>A & B</b>"), entries.map { it.text })
        assertEquals(
            listOf(MapAttributionEntry.Link(0, 12, "https://a.test/?x=1&y=2")),
            entries.single().links,
        )
        val credits =
            MapCredit.list(
                JSONArray(
                    """[{"id":"a","text":"A","href":"https://a.test","regions":[[0,0,1,1]]},
                        {"id":"b","text":"B","href":"http://b.test","regions":[[0,0,1,1]]},
                        {"id":"c","text":"C","href":"https://c.test","regions":[]}]"""
                )
            )
        assertEquals("Links open only https", listOf("a"), credits.map { it.id })
        assertEquals(emptyList<MapCredit>(), MapCredit.list(null))
    }

    // Composition

    @Test
    fun entriesFollowTheirOrderAndShowEachExactTextOnce() {
        val tileflow = """<a href="https://tileflow.dev/copyright">© Tileflow</a>"""
        val osm = """<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>"""
        val noaa =
            """<a href="https://tileflow.dev/copyright#nautical">NOAA ENC 2026-10-20 — not official, not for navigation</a>"""
        val attribution =
            MapAttribution(
                sources = listOf("$tileflow $osm", "", "$tileflow $osm $noaa", "Fiji"),
                obligations =
                    listOf(
                        MapObligation("Not for navigation. Read the notices."),
                        MapObligation(
                            "Tileflow Nautical sources and notices",
                            "https://tileflow.dev/copyright#nautical",
                        ),
                        MapObligation("Not for navigation. Read the notices."),
                    ),
                credits = listOf(spain, fiji),
                notices = listOf("Not for navigation", "Not for navigation"),
            )
        val madrid = doubleArrayOf(-3.8, 40.3, -3.6, 40.5)
        val entries = attribution.entries(madrid)
        assertEquals(
            listOf(
                "© Tileflow",
                "© OpenStreetMap",
                "NOAA ENC 2026-10-20 — not official, not for navigation",
                "Fiji",
                "Not for navigation. Read the notices.",
                "Tileflow Nautical sources and notices",
                "© IGN España",
                "Not for navigation",
            ),
            entries.map { it.text },
        )
        val kinds = MapAttributionEntry.Kind.entries
        assertEquals(
            listOf(0, 0, 0, 0, 1, 2, 3, 4).map { kinds[it] },
            entries.map { it.kind },
        )
        assertEquals(
            listOf(MapAttributionEntry.Link(0, 15, "https://www.openstreetmap.org/copyright")),
            entries[1].links,
        )
        // A regional credit a source already shows by its exact text is not repeated.
        val suva = doubleArrayOf(178.3, -18.2, 178.5, -18.0)
        assertEquals(
            emptyList<MapAttributionEntry>(),
            attribution.entries(suva).filter { it.kind == MapAttributionEntry.Kind.REGIONAL },
        )
        // Without a view yet, no regional credit shows; everything else does.
        assertEquals(entries.size - 1, attribution.entries(null).size)

        val notice =
            attribution
                .copy(fairUse = MapFairUseNotice(MapFairUseNotice.State.MANAGED_REQUIRED))
                .entries(madrid)
                .last()
        assertEquals(MapAttributionEntry.Kind.FAIR_USE, notice.kind)
        assertEquals(
            "Map usage is temporarily limited. Site owner: manage this map with Tileflow.",
            notice.text,
        )
        assertEquals(
            listOf("Site owner: manage this map with Tileflow."),
            notice.links.map(notice::text),
        )
        assertEquals(MapFairUseNotice.HELP_PAGE, notice.links.single().url)
    }

    /**
     * A source's attribution as a browser shows it: a list of links gives an item per link, other
     * HTML stays one item with its text around its link, and only https addresses link.
     */
    @Test
    fun sourceAttributionReadsAsABrowserShowsIt() {
        fun texts(html: String) = MapAttributionText.items(html).map { it.text }
        assertEquals(listOf("Fixture World"), texts("Fixture World"))
        assertEquals(emptyList<String>(), texts("  "))
        assertEquals(
            listOf("A", "B"),
            texts("<a href='https://a.test'>A</a>  <a href=https://b.test>B</a>"),
        )
        val osm =
            MapAttributionText.items(
                """&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors"""
            )
        assertEquals(listOf("© OpenStreetMap contributors"), osm.map { it.text })
        assertEquals(listOf(2 to 15), osm.single().links.map { it.start to it.end })
        assertEquals(
            listOf("A | B"),
            texts("""<a href="https://a.test">A</a> | <a href="https://b.test">B</a>"""),
        )
        assertEquals(
            listOf("A B & C D A &unknown; bold"),
            texts("A<br>B &amp; C&#160;D &#x41; &unknown; <b>bold</b>"),
        )
        assertEquals(listOf("A <b"), texts("A <b"))
        val insecure =
            MapAttributionText.items(
                """<a href="http://a.test">A</a> <a href="javascript:x">B</a>"""
            )
        assertEquals(listOf("A", "B"), insecure.map { it.text })
        assertEquals(emptyList<MapAttributionEntry.Link>(), insecure.flatMap { it.links })
        val entity = MapAttributionText.items("""<a href="https://a.test/?x=1&amp;y=2">A</a>""")
        assertEquals("https://a.test/?x=1&y=2", entity.single().links.single().url)
    }

    @Test
    fun theStyleDeclaresItsNoticesAsCoreReadsThem() {
        fun notice(id: Any, text: Any, sources: List<String>) =
            JSONObject().put("id", id).put("text", text).put("sources", JSONArray(sources))
        val notices =
            JSONArray(
                listOf(
                    notice("nautical", "Not for navigation", listOf("nautical")),
                    notice("nautical", "Repeated identifier", listOf("nautical")),
                    notice("bad id", "Bad identifier", emptyList()),
                    notice("padded", " Padded ", emptyList()),
                    notice("long", "a".repeat(121), emptyList()),
                    notice("control", "Bell\u0007", emptyList()),
                    notice("sources", "Bad sources", listOf("bad source")),
                    notice("depth", "Depths in metres", emptyList()),
                ) + List(3) { notice("late", "Past the eighth", emptyList()) }
            )
        val style = JSONObject().put("metadata", JSONObject().put("tileflow:notices", notices))
        assertEquals(
            listOf("Not for navigation", "Depths in metres"),
            MapAttribution.notices(style),
        )
        assertEquals(emptyList<String>(), MapAttribution.notices(JSONObject()))
    }

    // Fair use

    @Test
    fun worldFairUseFollowsWorldTileResponses() {
        val digest = "a".repeat(64)
        val tile =
            URI(
                "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/14/8000/6000.pbf" +
                    "?session=s&worldDescriptorSha256=$digest"
            )
        assertNotNull(MapFairUseSignal.of(tile, 200, mapOf("tileflow-fair-use" to "open")))
        for (other in
            listOf(
                "http://api.tileflow.dev/tiles/world/world-v1-2026-10-01/1/0/0.pbf?worldDescriptorSha256=$digest",
                "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/1/0/0.pbf",
                "https://tileflow.test/tiles/world/world-v1-2026-10-01/1/0/0.pbf?worldDescriptorSha256=$digest",
                "https://api.tileflow.dev/tiles/world/1/1/0/0.pbf?worldDescriptorSha256=$digest",
                "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/01/0/0.pbf?worldDescriptorSha256=$digest",
                "https://api.tileflow.dev/tiles/world/world-v1-2026-10-01/1/0/0.pbf?other=1&worldDescriptorSha256=$digest",
            ))
            assertNull(other, MapFairUseSignal.of(URI(other), 200, emptyMap()))

        val state = MapFairUseState()
        val start = 1_000_000L
        assertFalse(state.receive(MapFairUseSignal(200, "grace"), start))
        assertTrue(state.receive(MapFairUseSignal(200, "grace", ownerNotice = true), start))
        assertEquals(MapFairUseNotice.State.GRACE, state.notice?.state)
        assertTrue(state.receive(MapFairUseSignal(429, "managed-required"), start))
        assertEquals("Map usage is temporarily limited.", state.notice?.message)
        // Managed-required outranks grace and a degradation.
        assertFalse(state.receive(MapFairUseSignal(429, "grace"), start))
        assertFalse(state.receive(MapFairUseSignal(503, null, protection = "protected"), start))
        assertTrue(state.receive(MapFairUseSignal(200, "open"), start))
        assertNull(state.notice)
        // A degradation holds the limited notice for a minute against successes and grace.
        assertTrue(state.receive(MapFairUseSignal(503, null, protection = "cached-only"), start))
        assertEquals("Some map areas are temporarily unavailable.", state.notice?.message)
        assertFalse(state.receive(MapFairUseSignal(200, "open"), start + 30_000))
        assertFalse(state.receive(MapFairUseSignal(429, "grace"), start + 30_000))
        assertTrue(state.receive(MapFairUseSignal(200, "open"), start + 61_000))
        assertNull(state.notice)
    }

    // Downloaded credits

    /**
     * The manifest's attribution of a download: each source's obligations and page, and its
     * regional credits. The same credit of two sources or downloads keeps every box; credits that
     * share an identifier but not their text both show.
     */
    @Test
    fun downloadedCreditsReadEachSourcesObligationsPageAndRegionalCredits() {
        val manifest =
            JSONArray(
                    """[
              {"source": "nautical", "text": "N", "obligations": [{"id": "n", "exact": "Not for navigation."}],
               "regionalObligations": [{"id": "noaa-enc", "exact": "NOAA for Nautical", "href": "https://tileflow.dev/copyright#nautical", "regions": [[-131, 23, -64, 50]]}],
               "page": {"exact": "Nautical notices", "href": "https://tileflow.dev/copyright#nautical"}},
              {"source": "bathymetry", "text": "B", "obligations": [{"id": "b", "exact": "Depths mix references."}, {"id": "", "exact": "No identifier"}],
               "regionalObligations": [{"id": "noaa-enc", "exact": "NOAA for Bathymetry", "href": "https://tileflow.dev/copyright#bathymetry", "regions": [[-131, 23, -64, 50]]}],
               "page": {"exact": "Bathymetry notices", "href": "http://tileflow.dev/copyright#bathymetry"}},
              {"source": "bathymetry-dem", "text": "B", "obligations": [{"id": "b", "exact": "Depths mix references."}],
               "regionalObligations": [{"id": "noaa-enc", "exact": "NOAA for Bathymetry", "href": "https://tileflow.dev/copyright#bathymetry", "regions": [[-180, 50, -129, 75]]}]},
              {"source": "world", "text": "W"}
            ]"""
                )
                .let { array -> (0 until array.length()).map { array.getJSONObject(it) } }
        val obligations = OfflineObligation.obligations(manifest)
        assertEquals(
            listOf("Not for navigation.", "Nautical notices", "Depths mix references."),
            obligations.map { it.text },
        )
        assertEquals(
            listOf(null, "https://tileflow.dev/copyright#nautical", null),
            obligations.map { it.href },
        )
        val credits = OfflineCredit.credits(manifest)
        assertEquals(listOf("NOAA for Nautical", "NOAA for Bathymetry"), credits.map { it.text })
        assertEquals(
            listOf(listOf(-131.0, 23.0, -64.0, 50.0), listOf(-180.0, 50.0, -129.0, 75.0)),
            credits.last().regions,
        )

        // The index merges what every store publishes the same way.
        val index = OfflineServingIndex()
        val scope = ResourceCacheScope.grant(URI("https://api.tileflow.test"), "map_0123456789abcdef")
        index.publish(
            OfflineServingSnapshot(
                credits = mapOf(scope.directory to listOf(credits[0])),
                obligations = mapOf(scope.directory to obligations),
            ),
            this,
        )
        index.publish(
            OfflineServingSnapshot(
                credits = mapOf(scope.directory to credits),
                obligations = mapOf(scope.directory to obligations.reversed()),
            ),
            Any(),
        )
        assertEquals(
            listOf("NOAA for Bathymetry", "NOAA for Nautical"),
            index.credits(scope).map { it.text }.sorted(),
        )
        assertEquals(obligations.map { it.text }.toSet(), index.obligations(scope).map { it.text }.toSet())
        assertEquals(3, index.obligations(scope).size)
    }

    /**
     * The platform's marine fixture: Nautical, Bathymetry and its DEM over Miami, Oslo and Madrid,
     * with and without the dated NOAA and USACE lines. In every case the obligations and the page
     * show whatever the view, each regional credit shows over its place and not across the world
     * from it, and a view wider than the world shows them all. Over Madrid only EMODnet is
     * regional.
     */
    @Test
    fun everyMarineCreditCombination() {
        val text = javaClass.classLoader!!.getResource("marine-credits.json")!!.readText()
        val cases = JSONObject(text).getJSONArray("cases")
        assertEquals(12, cases.length())
        val seen = HashSet<String>()
        val places = LinkedHashMap<String, MutableList<JSONObject>>()
        val placeBounds = HashMap<String, DoubleArray>()
        val always =
            listOf(
                "Not for navigation. Tileflow Nautical is a derived visualization of OpenStreetMap seamarks and NGA publications; it is not an official chart.",
                "List of Lights (Pub. 110–116) and World Port Index (Pub. 150), courtesy of the U.S. National Geospatial-Intelligence Agency.",
                "Not for navigation. Tileflow Bathymetry is a visualization; its depths mix vertical references.",
                "GEBCO Grid, GEBCO Bathymetric Compilation Group:",
            )
        for (index in 0 until cases.length()) {
            val case = cases.getJSONObject(index)
            val place = case.getString("place")
            val source = case.getString("source")
            val credit = case.getJSONObject("credit")
            places.getOrPut(place) { mutableListOf() } += credit
            val view = bounds(case.getJSONArray("bounds"))
            placeBounds[place] = view
            val far = doubleArrayOf(view[0] + 180, -view[3], view[2] + 180, -view[1])
            val world = doubleArrayOf(-250.0, -85.0, 250.0, 85.0)
            val regional = OfflineCredit.credits(listOf(credit))
            val attribution =
                MapAttribution(
                    sources = listOf(case.getString("attribution")),
                    obligations = OfflineObligation.obligations(listOf(credit)).map(::MapObligation),
                    credits = regional.map(::MapCredit),
                    notices = listOf("Not for navigation"),
                )
            val here = attribution.entries(view)
            fun of(kind: MapAttributionEntry.Kind, entries: List<MapAttributionEntry> = here) =
                entries.filter { it.kind == kind }
            val obligations = credit.getJSONArray("obligations")
            assertEquals(
                "$place $source",
                (0 until obligations.length()).map { obligations.getJSONObject(it).getString("exact") },
                of(MapAttributionEntry.Kind.OBLIGATION).map { it.text },
            )
            val page = credit.getJSONObject("page")
            assertEquals(listOf(page.getString("exact")), of(MapAttributionEntry.Kind.PAGE).map { it.text })
            assertEquals(
                page.getString("href"),
                of(MapAttributionEntry.Kind.PAGE).single().links.single().url,
            )
            assertEquals(
                "$place $source",
                regional.map { it.text },
                of(MapAttributionEntry.Kind.REGIONAL).map { it.text },
            )
            for (entry in of(MapAttributionEntry.Kind.REGIONAL)) {
                val match = regional.first { it.text == entry.text }
                seen += match.id
                assertEquals(listOf(match.href), entry.links.map { it.url })
            }
            assertEquals(
                emptyList<MapAttributionEntry>(),
                of(MapAttributionEntry.Kind.REGIONAL, attribution.entries(far)),
            )
            assertEquals(
                "Everything else stays far away",
                here.filter { it.kind != MapAttributionEntry.Kind.REGIONAL }.map { it.text },
                attribution.entries(far).map { it.text },
            )
            assertEquals(
                regional.size,
                of(MapAttributionEntry.Kind.REGIONAL, attribution.entries(world)).size,
            )
            // The sources' credits are each link of the release's map credit, exact and linked.
            val sources = of(MapAttributionEntry.Kind.SOURCE)
            assertEquals("© Tileflow", sources.first().text)
            assertTrue(sources.all { it.links.size == 1 && it.links[0] == MapAttributionEntry.Link(0, it.text.length, it.links[0].url) })
            assertEquals("Not for navigation", here.last().text)
        }
        assertEquals(setOf("noaa-enc", "usace-ienc", "emodnet", "kartverket"), seen)

        // A download over each place holds all three sources: Nautical's and Bathymetry's NOAA
        // credits both show over Miami, the DEM repeats nothing, and the obligations always show.
        fun regional(place: String): List<String> {
            val credits = places.getValue(place)
            val entries =
                MapAttribution(
                        obligations = OfflineObligation.obligations(credits).map(::MapObligation),
                        credits = OfflineCredit.credits(credits).map(::MapCredit),
                    )
                    .entries(placeBounds.getValue(place))
            for (text in always)
                assertTrue("$place: $text", entries.any { it.text.startsWith(text) })
            assertEquals(2, entries.count { it.kind == MapAttributionEntry.Kind.PAGE })
            return entries
                .filter { it.kind == MapAttributionEntry.Kind.REGIONAL }
                .map { it.text.take(10) }
        }
        assertEquals(listOf("NOAA ENC 2", "USACE IENC", "NOAA ENC 2"), regional("miami"))
        assertEquals(listOf("EMODnet Di", "© Kartverk"), regional("oslo"))
        assertEquals(listOf("EMODnet Di"), regional("madrid"))
    }

    // Control

    /**
     * The control places itself in its corner inside the padding, compact enough for the space the
     * map's other controls leave it; it reads every entry to TalkBack and offers each link.
     */
    @Test
    fun theControlStaysInItsCornerAndReadsEveryEntry() {
        val context = RuntimeEnvironment.getApplication()
        val density = context.resources.displayMetrics.density
        val control = MapAttributionControl(context)
        val view = control.view
        val opened = mutableListOf<String>()
        control.onLink = { opened += it }
        fun layOut(width: Int = 400, height: Int = 800) {
            view.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
            )
            view.layout(0, 0, width, height)
        }
        control.setStyle(
            JSONObject(),
            listOf("""<a href="https://tileflow.dev/copyright">© Tileflow</a> Fixture"""),
        )
        control.setDownloaded(
            listOf(OfflineObligation("a", "A long obligation that only the full list and TalkBack show.")),
            emptyList(),
        )
        control.setStyle(
            JSONObject()
                .put(
                    "metadata",
                    JSONObject()
                        .put(
                            "tileflow:notices",
                            JSONArray().put(
                                JSONObject()
                                    .put("id", "nautical")
                                    .put("text", "Not for navigation")
                                    .put("sources", JSONArray())
                            ),
                        ),
                ),
            listOf("""<a href="https://tileflow.dev/copyright">© Tileflow</a> Fixture"""),
        )
        control.place("bottom-right", JSONObject().put("bottom", 300).put("right", 20))
        layOut()
        val margin = (MapAttributionView.MARGIN_DP * density).toInt()
        assertEquals(View.VISIBLE, view.control.visibility)
        assertEquals(400 - (20 * density).toInt() - margin, view.control.right)
        assertEquals(800 - (300 * density).toInt() - margin, view.control.bottom)
        assertTrue(
            view.control.height + margin <= 36 * density + 0.5,
        )
        assertEquals("© Tileflow Fixture · Not for navigation", view.label.text.toString())
        assertEquals(
            "© Tileflow Fixture\nA long obligation that only the full list and TalkBack show.\nNot for navigation",
            view.control.contentDescription,
        )
        val info = AccessibilityNodeInfoCompat.obtain()
        ViewCompat.onInitializeAccessibilityNodeInfo(view.control, info)
        val action = info.actionList.single { it.label == "Open © Tileflow" }
        assertTrue(ViewCompat.performAccessibilityAction(view.control, action.id, null))
        assertEquals(listOf("https://tileflow.dev/copyright"), opened)

        // Opened, the list shows every entry above the control, and its links reach the map view.
        view.control.performClick()
        layOut()
        assertTrue(view.expanded)
        assertEquals(View.VISIBLE, view.list.visibility)
        assertEquals(control.entries.joinToString("\n") { it.text }, view.listText.text.toString())
        assertTrue(view.list.bottom <= view.control.top)
        assertTrue(view.list.height > 0)
        view.control.performClick()
        assertFalse(view.expanded)

        control.place("top-left", null)
        layOut()
        assertEquals(margin, view.control.left)
        assertEquals(margin, view.control.top)
        control.setStyle(JSONObject(), emptyList())
        control.setDownloaded(emptyList(), emptyList())
        assertEquals(View.GONE, view.control.visibility)
    }
}
