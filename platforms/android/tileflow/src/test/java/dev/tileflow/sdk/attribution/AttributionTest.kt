package dev.tileflow.sdk.attribution

import android.app.Activity
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import dev.tileflow.sdk.TileflowCompassVisibility
import dev.tileflow.sdk.TileflowControlPosition
import dev.tileflow.sdk.TileflowMapControls
import dev.tileflow.sdk.TileflowMapOptions
import dev.tileflow.sdk.TileflowMapView
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
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

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
                // The credit opens its page; a licence written in it opens the licence.
                assertEquals(
                    setOf(match.href) + listOfNotNull(LICENCE.takeIf { it in match.text }),
                    entry.links.map { it.url }.toSet(),
                )
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
        assertTrue(view.control.height >= view.label.layout.height)
        assertEquals(listOf("© Tileflow Fixture", "Not for navigation"), pieces(view))
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

    // Always on the map

    /** The pieces of the compact control's text, line by line. */
    private fun pieces(view: MapAttributionView): List<String> =
        view.label.text.toString().split("\n").flatMap { it.split(MapAttributionStrip.SEPARATOR) }

    /** Whether a piece of the compact control shows [text]: whole, or its start and an ellipsis. */
    private fun shows(piece: String, text: String): Boolean =
        piece == text ||
            (piece.endsWith(MapAttributionStrip.ELLIPSIS) &&
                piece.length >= 2 &&
                text.startsWith(piece.dropLast(1)))

    private fun layOut(view: View, width: Int, height: Int) {
        view.measure(
            View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY),
        )
        view.layout(0, 0, width, height)
    }

    @Test
    fun colonQualifiedChartCreditsKeepTheirQualificationWhenShortened() {
        val text = "NOAA ENC 2026-10-20: NOAA ENC® data, Office of Coast Survey. Tileflow Nautical is not an official or certified NOAA ENC."
        val shortened = MapAttributionStrip.shorten(text, 120f) { it.length * 6f }

        assertEquals("NOAA…", shortened)
    }

    @Test
    fun regionalCreditsStayOnTheCompactStrip() {
        val entries = listOf(
            MapAttributionEntry(MapAttributionEntry.Kind.SOURCE, "© Tileflow"),
            MapAttributionEntry(MapAttributionEntry.Kind.REGIONAL, "© IGN España"),
        )

        assertEquals(entries.map { it.text }, MapAttributionStrip.items(entries).map { it.text })
    }

    /**
     * Every source credit stays on the map, shortened when needed and never left out, also with
     * many sources on a narrow phone; the notice stays whole.
     */
    @Test
    @GraphicsMode(GraphicsMode.Mode.NATIVE)
    fun everyCreditStaysOnTheStripOfANarrowView() {
        val context = RuntimeEnvironment.getApplication()
        val density = context.resources.displayMetrics.density
        val view = MapAttributionView(context)
        val credits =
            listOf(
                """<a href="https://tileflow.dev/copyright">© Tileflow</a> <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>""",
                """© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors""",
                """<a href="https://tileflow.dev/copyright#nautical">NOAA ENC 2026-10-20 — not official, not for navigation</a> <a href="https://tileflow.dev/copyright#nautical">USACE IENC 2026-10-18 — not official, not for navigation</a>""",
                "© Mapterhorn",
                "Fixture World",
                "© Kartverket",
            )
        val entries =
            MapAttribution(
                    sources = credits,
                    obligations = listOf(MapObligation("A long obligation in the full list only.")),
                    notices = listOf("Not for navigation"),
                )
                .entries(null)
        view.show(entries)
        layOut(view, (320 * density).toInt(), (568 * density).toInt())
        val sources = entries.filter { it.kind == MapAttributionEntry.Kind.SOURCE }.map { it.text }
        assertEquals(8, sources.size)
        val pieces = pieces(view)
        for (source in sources) assertTrue("$source in $pieces", pieces.any { shows(it, source) })
        assertTrue("$pieces", "Not for navigation" in pieces)
        assertFalse(pieces.any { it.startsWith("A long obligation") })
        for (piece in pieces.filter { "ENC" in it }) assertTrue(piece, "not official" in piece)
        val lines = view.label.text.toString().split("\n")
        assertTrue(lines.size > 2)
        assertEquals(lines.size, view.label.layout.lineCount)
        assertTrue(view.label.layout.height <= view.label.height)
        for (line in lines) assertTrue(line, view.label.paint.measureText(line) <= view.label.width + 1)

        // Use more lines before shortening individual credits.
        val many = (1..10).map { MapAttributionStrip.Item("Credit number $it", false) }
        val measure = { text: String -> text.length * 6f }
        val narrow = MapAttributionStrip.lines(many, 162f, measure)
        assertTrue("$narrow", narrow.all { measure(it) <= 162f })
        assertEquals(many.map { it.text }, narrow.flatMap { it.split(MapAttributionStrip.SEPARATOR) })
        assertEquals(
            listOf("Credit number 1 · Credit number 2 · Credit number 3"),
            MapAttributionStrip.lines(many.take(3), 400f, measure),
        )

        // A shortened credit never names a chart product without its qualification.
        val noaa = "NOAA ENC 2026-10-20 — not official, not for navigation"
        var cap = 0f
        while (cap <= measure(noaa)) {
            val short = MapAttributionStrip.shorten(noaa, cap, measure)
            assertTrue(short, noaa.startsWith(if (short == noaa) short else short.dropLast(1)))
            if ("ENC" in short) assertTrue(short, "not official" in short)
            cap += 6f
        }
        assertEquals("NOAA…", MapAttributionStrip.shorten(noaa, 120f, measure))
        assertEquals(
            "NOAA ENC 2026-10-20 — not official, not…",
            MapAttributionStrip.shorten(noaa, 240f, measure),
        )
        assertEquals(
            "© OpenStreetMa…",
            MapAttributionStrip.shorten("© OpenStreetMap contributors", 90f, measure),
        )
    }

    /**
     * NOAA's dated line, NGA's non-endorsement, GEBCO and EMODnet's licence and modification note
     * are one tap away in the full list and read in full by TalkBack, with the licence a link.
     */
    @Test
    fun theFullListHoldsEveryMarineNotice() {
        val text = javaClass.classLoader!!.getResource("marine-credits.json")!!.readText()
        val cases = JSONObject(text).getJSONArray("cases")
        val credits = (0 until cases.length()).map { cases.getJSONObject(it).getJSONObject("credit") }
        val control = MapAttributionControl(RuntimeEnvironment.getApplication())
        val opened = mutableListOf<String>()
        control.onLink = { opened += it }
        control.setStyle(JSONObject(), listOf(credits[0].getString("text")))
        control.setDownloaded(OfflineObligation.obligations(credits), OfflineCredit.credits(credits))
        control.update(doubleArrayOf(-250.0, -85.0, 250.0, 85.0))
        val view = control.view
        view.control.performClick()
        layOut(view, 400, 800)
        assertEquals(View.VISIBLE, view.list.visibility)
        val list = view.listText.text.toString()
        val spoken = view.control.contentDescription.toString()
        for (notice in
            listOf(
                "NOAA ENC 2026-10-20: NOAA ENC® data, Office of Coast Survey, National Oceanic and Atmospheric Administration. Tileflow Nautical is not an official or certified NOAA ENC",
                "This reproduction, partial or complete, of any National Geospatial-Intelligence Agency (NGA)",
                "GEBCO Grid, GEBCO Bathymetric Compilation Group: public domain under the GEBCO terms of use.",
                "EMODnet Digital Bathymetry (DTM 2024), EMODnet Bathymetry Consortium: created by EMODnet, owned by the EU and licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); modified. Not for navigation.",
            )) {
            assertTrue(notice, notice in list)
            assertTrue(notice, notice in spoken)
        }
        val spans = view.listText.text as android.text.Spanned
        val at = list.indexOf(LICENCE)
        val licence = spans.getSpans(at, at + 1, android.text.style.ClickableSpan::class.java).single()
        licence.onClick(view.listText)
        val page = spans.getSpans(at - 3, at - 2, android.text.style.ClickableSpan::class.java).single()
        page.onClick(view.listText)
        assertEquals(listOf(LICENCE, "https://emodnet.ec.europa.eu/en/bathymetry"), opened)
        val info = AccessibilityNodeInfoCompat.obtain()
        ViewCompat.onInitializeAccessibilityNodeInfo(view.control, info)
        assertTrue(info.actionList.any { it.label == "Open $LICENCE" })
    }

    /**
     * No public option hides the control or its button: the controls carry only its corner, and
     * every corner, direction and padding keeps it on the map; the map view leaves its touches to
     * it whatever the application filters.
     */
    @Test
    fun noOptionHidesTheControl() {
        val controls = TileflowMapControls::class.java.declaredFields.map { it.name }
        assertEquals(listOf("attributionPosition"), controls.filter { "attribution" in it.lowercase() })
        val options = TileflowMapOptions::class.java.declaredFields.map { it.name.lowercase() }
        assertEquals(
            emptyList<String>(),
            options.filter { name -> listOf("attribution", "logo", "credit", "notice").any { it in name } },
        )
        val context = RuntimeEnvironment.getApplication()
        val density = context.resources.displayMetrics.density
        val width = (390 * density).toInt()
        val height = (844 * density).toInt()
        for (position in TileflowControlPosition.entries)
            for (rightToLeft in listOf(false, true))
                for (padding in
                    listOf(
                        doubleArrayOf(0.0, 0.0, 0.0, 0.0),
                        doubleArrayOf(0.0, 0.0, 0.0, 844.0),
                        doubleArrayOf(8192.0, 8192.0, 8192.0, 8192.0),
                        doubleArrayOf(0.0, 400.0, 300.0, 430.0),
                    )) {
                    val control = MapAttributionControl(context)
                    control.setStyle(JSONObject(), listOf("© Tileflow © OpenStreetMap"))
                    val corner =
                        TileflowMapOptions(
                                controls =
                                    TileflowMapControls(
                                        compass = TileflowCompassVisibility.HIDDEN,
                                        attributionPosition = position,
                                    )
                            )
                            .json(rightToLeft)
                            .getString("attribution")
                    control.place(
                        corner,
                        JSONObject()
                            .put("left", padding[0])
                            .put("top", padding[1])
                            .put("right", padding[2])
                            .put("bottom", padding[3]),
                    )
                    layOut(control.view, width, height)
                    val placed = control.view.control
                    val name = "$position $rightToLeft ${padding.toList()}"
                    assertEquals(name, View.VISIBLE, placed.visibility)
                    assertTrue(name, placed.width > 0 && placed.height > 0)
                    assertTrue(
                        name,
                        placed.left >= 0 &&
                            placed.top >= 0 &&
                            placed.right <= width &&
                            placed.bottom <= height,
                    )
                }

        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val map = TileflowMapView(activity)
        val attribution = MapAttributionView(activity)
        attribution.show(MapAttribution(sources = listOf("© Tileflow")).entries(null))
        map.addView(attribution, FrameLayout.LayoutParams(width, height))
        layOut(map, width, height)
        map.touchFilter = { _, _ -> false }
        fun touch(x: Float, y: Float): Boolean {
            val time = SystemClock.uptimeMillis()
            val down = MotionEvent.obtain(time, time, MotionEvent.ACTION_DOWN, x, y, 0)
            return map.dispatchTouchEvent(down).also { down.recycle() }
        }
        val placed = attribution.control
        assertTrue(touch((placed.left + placed.right) / 2f, (placed.top + placed.bottom) / 2f))
        assertFalse("The application's filter applies elsewhere", touch(20f, 20f))
        map.destroy()
    }

    private companion object {
        const val LICENCE = "https://creativecommons.org/licenses/by/4.0/"
    }
}
