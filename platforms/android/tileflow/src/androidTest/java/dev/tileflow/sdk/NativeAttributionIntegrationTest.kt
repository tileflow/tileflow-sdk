package dev.tileflow.sdk

import android.content.Intent
import android.view.View
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.attribution.MapAttributionControl
import dev.tileflow.sdk.attribution.MapAttributionEntry
import dev.tileflow.sdk.attribution.MapAttributionStrip
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.engine.NativeRepresentation
import dev.tileflow.sdk.offline.OfflineHttpFetcher
import dev.tileflow.sdk.offline.OfflineLayout
import dev.tileflow.sdk.offline.OfflineObligation
import dev.tileflow.sdk.offline.OfflinePackClient
import dev.tileflow.sdk.offline.OfflineScopeRunner
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineStoreCore
import dev.tileflow.sdk.offline.OfflineSubscribers
import dev.tileflow.sdk.offline.TileflowOfflineContent
import dev.tileflow.sdk.offline.TileflowOfflineGeometry
import dev.tileflow.sdk.offline.TileflowOfflineRegion
import dev.tileflow.sdk.offline.TileflowOfflineRegionLoadOptions
import dev.tileflow.sdk.offline.TileflowOfflineStore
import dev.tileflow.sdk.offline.TileflowOfflineSwitch
import java.io.File
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The attribution the SDK's own control shows over MapLibre Native, read from the control: its
 * corner outside the covered edge, the style's notice through a theme change, and the marine
 * credits of downloaded regions over Miami, Oslo and Madrid as the camera moves in and out of their
 * boxes, online and with the network switched off. Run with the online fixture server and
 * `adb reverse tcp:18645 tcp:<port>`.
 */
@RunWith(AndroidJUnit4::class)
public class NativeAttributionIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val root = File(context.cacheDir, "attribution-test-${System.nanoTime()}")
    private val stores = mutableListOf<TileflowOfflineStore>()

    @After
    public fun tearDown() {
        OfflineMapHostActivity.theme = null
        OfflineMapHostActivity.camera = null
        TileflowOfflineSwitch.isNetworkEnabled = true
        runBlocking {
            for (store in stores) for (region in store.allRegions()) store.removeRegion(region.id)
        }
        scope.cancel()
        root.deleteRecursively()
    }

    private fun show(source: TileflowMapSource, theme: String? = null): OfflineMapHostActivity {
        OfflineMapHostActivity.requested = source
        OfflineMapHostActivity.theme = theme
        val intent =
            Intent(instrumentation.context, OfflineMapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as OfflineMapHostActivity
        assertTrue(
            "Map did not load. Errors: ${activity.failures}",
            activity.loaded.await(60, TimeUnit.SECONDS),
        )
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
        return activity
    }

    private fun attribution(activity: OfflineMapHostActivity): MapAttributionControl =
        requireNotNull(activity.map.readyEngine as? NativeMapEngine).attribution

    private suspend fun waitFor(description: String, condition: () -> Boolean) {
        val met = withTimeoutOrNull(15_000) {
            while (!condition()) delay(50)
            true
        }
        assertTrue("Timed out waiting for $description", met == true)
    }

    /**
     * Content padding keeps the attribution in the uncovered view, below the controls that share
     * its corner, as on the web.
     */
    @Test
    public fun contentPaddingKeepsTheAttributionOutOfTheCoveredEdge() {
        Fixture.require("${Fixture.ORIGIN}/native/manifest.json")
        val activity = show(NativeViewHostActivity.CITY)
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    map.setOptions(
                        TileflowMapOptions(
                            controls = TileflowMapControls(scaleBar = true, recenterButton = true)
                        )
                    )
                    val control = attribution(activity)
                    assertTrue(
                        "${control.entries}",
                        control.entries.any {
                            it.text.startsWith("Fixture City") && it.text.endsWith("Climate")
                        },
                    )
                    val density = map.resources.displayMetrics.density
                    val margin = (8 * density).toInt()
                    waitFor("the attribution in its corner") {
                        control.view.control.bottom == map.height - margin
                    }
                    val padding = 300 * density
                    map.setContentPadding(0f, 0f, 0f, padding)
                    // The padding reaches the engine in density-independent pixels.
                    waitFor("the attribution above the padding") {
                        abs(control.view.control.bottom - (map.height - padding - margin)) <= 1
                    }
                    assertEquals(View.VISIBLE, control.view.control.visibility)
                    assertEquals(map.width - margin, control.view.control.right)
                    // Native controls stay above the padding, and the one in the attribution's
                    // corner above it.
                    val controls = map.controlsView
                    val visible =
                        (0 until controls.childCount)
                            .map(controls::getChildAt)
                            .filter { it.visibility == View.VISIBLE }
                    assertEquals("The scale bar and the recenter button.", 2, visible.size)
                    assertTrue(visible.all { it.bottom <= map.height - padding })
                    assertTrue(controls.recenter.bottom <= control.view.control.top)
                    assertTrue("${activity.failures}", activity.failures.isEmpty())
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    /** The style's notice is always on the map, and stays through a theme change. */
    @Test
    public fun theStyleNoticeStaysThroughAThemeChange() {
        Fixture.require("${Fixture.ORIGIN}/manifest.json")
        for ((name, theme) in listOf("fixture" to "dark", "nautical" to "night")) {
            val activity =
                show(
                    TileflowMapSource(
                        map = name,
                        manifestUrl = URI("${Fixture.ORIGIN}/manifest.json"),
                        allowsLoopbackHttp = true,
                    )
                )
            try {
                runBlocking {
                    withContext(Dispatchers.Main) {
                        val control = attribution(activity)
                        fun notices() =
                            control.entries
                                .filter { it.kind == MapAttributionEntry.Kind.NOTICE }
                                .map { it.text }
                        assertEquals(name, listOf("Not for navigation"), notices())
                        assertTrue(control.view.label.text.endsWith("Not for navigation"))
                        activity.map.setTheme(theme, durationMillis = 300)
                        assertEquals("$name after the theme change", listOf("Not for navigation"), notices())
                        assertEquals(View.VISIBLE, control.view.control.visibility)
                        assertTrue("$name: ${activity.failures}", activity.failures.isEmpty())
                    }
                }
            } finally {
                instrumentation.runOnMainSync { activity.finish() }
            }
        }
    }

    @Test
    public fun updatingASourceRefreshesItsAttribution() {
        Fixture.require("${Fixture.ORIGIN}/manifest.json")
        val activity = show(
            TileflowMapSource(
                map = "fixture",
                manifestUrl = URI("${Fixture.ORIGIN}/manifest.json"),
                allowsLoopbackHttp = true,
            )
        )
        try {
            runBlocking {
                withContext(Dispatchers.Main) {
                    val map = activity.map
                    val control = attribution(activity)
                    map.addSource(
                        TileflowGeoJSONSource("credited", TileflowGeoJSONData.Empty, attribution = "Original provider")
                    )
                    assertTrue(control.entries.any { it.text == "Original provider" })

                    map.updateSource("credited", JSONObject().put("attribution", "Replacement provider"))

                    assertTrue(control.entries.any { it.text == "Replacement provider" })
                    assertFalse(control.entries.any { it.text == "Original provider" })

                    map.updateSource("credited", JSONObject().put("attribution", JSONObject.NULL))
                    assertFalse(control.entries.any { it.text == "Replacement provider" })
                }
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    // Marine credits

    @Test
    public fun miamiShowsNoaaAndUsaceOnlyWhileTheirBoxesAreInView() =
        marineCredits(
            "miami",
            TileflowCoordinate(-80.2, 25.8),
            setOf("nautical noaa-enc", "nautical usace-ienc", "bathymetry noaa-enc"),
            // Inside NOAA's box, east of USACE's.
            TileflowCoordinate(-64.5, 23.6) to setOf("nautical noaa-enc", "bathymetry noaa-enc"),
            TileflowCoordinate(0.0, 0.0) to emptySet(),
        )

    @Test
    public fun osloShowsEmodnetAndKartverketOnlyWhileTheirBoxesAreInView() =
        marineCredits(
            "oslo",
            TileflowCoordinate(10.7, 59.9),
            setOf("bathymetry emodnet", "bathymetry kartverket"),
            // Inside EMODnet's domain, west of Norway's waters.
            TileflowCoordinate(-5.0, 50.0) to setOf("bathymetry emodnet"),
            TileflowCoordinate(60.0, 10.0) to emptySet(),
        )

    @Test
    public fun madridShowsOnlyEmodnetWhileItsBoxIsInView() =
        marineCredits(
            "madrid",
            TileflowCoordinate(-3.7, 40.415),
            setOf("bathymetry emodnet"),
            TileflowCoordinate(60.0, 10.0) to emptySet(),
        )

    /**
     * Downloads the fixture's marine theme over a place, then shows it online and with the network
     * switched off. Both times the obligations, pages, sources' credits and the notice show
     * wherever the camera goes, and the regional credits only while one of their boxes is in view.
     */
    private fun marineCredits(
        place: String,
        center: TileflowCoordinate,
        here: Set<String>,
        vararg stops: Pair<TileflowCoordinate, Set<String>>,
    ) {
        Fixture.require()
        val fixture = MarineCredits()
        val bounds = fixture.bounds.getValue(place)
        runBlocking { TileflowMapCache.get(context).clear() }
        val configuration =
            TileflowConfiguration(
                apiOrigin = URI(Fixture.ORIGIN),
                mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)),
            )
        val store = store { OfflinePackClient(configuration) }
        runBlocking {
            store.loadRegion(
                "marine-$place",
                TileflowOfflineRegionLoadOptions(
                    TileflowOfflineGeometry.BoundingBox(
                        TileflowBoundingBox(bounds[0], bounds[1], bounds[2], bounds[3])
                    ),
                    TileflowOfflineContent.Hosted(Fixture.HOSTED_MAP_ID, listOf("marine")),
                    minZoom = 12,
                    maxZoom = 13,
                ),
            )
            val complete =
                withTimeoutOrNull(30_000) {
                    while (
                        store.region("marine-$place")?.state !=
                            TileflowOfflineRegion.DownloadState.COMPLETE
                    )
                        delay(20)
                    true
                }
            assertTrue("${store.region("marine-$place")}", complete == true)
        }
        val source = TileflowMapSource.hosted(Fixture.HOSTED_MAP_ID, configuration = configuration)
        for (online in listOf(true, false)) {
            Fixture.counters(reset = true)
            TileflowOfflineSwitch.isNetworkEnabled = online
            val mode = if (online) "$place online" else "$place offline"
            OfflineMapHostActivity.camera = TileflowCamera(center.longitude, center.latitude, 10.0)
            val activity = show(source, "marine")
            try {
                runBlocking {
                    withContext(Dispatchers.Main) {
                        val engine = requireNotNull(activity.map.readyEngine as? NativeMapEngine)
                        assertEquals(
                            mode,
                            NativeRepresentation.NATIVE,
                            engine.manifest?.representation,
                        )
                        val control = engine.attribution
                        suspend fun check(expected: Set<String>, stop: String) {
                            waitFor("$mode $stop: $expected") {
                                fixture.regional(control.entries) == expected
                            }
                            val entries = control.entries
                            fun of(kind: MapAttributionEntry.Kind) =
                                entries.filter { it.kind == kind }.map { it.text }
                            assertEquals(
                                "$mode $stop",
                                fixture.obligations,
                                of(MapAttributionEntry.Kind.OBLIGATION),
                            )
                            assertEquals(fixture.pages, of(MapAttributionEntry.Kind.PAGE))
                            val sources = of(MapAttributionEntry.Kind.SOURCE)
                            for (text in
                                listOf(
                                    "Fixture World",
                                    "© Tileflow",
                                    "© OpenStreetMap",
                                    "NOAA ENC 2026-10-20 — not official, not for navigation",
                                    "USACE IENC 2026-10-18 — not official, not for navigation",
                                ))
                                assertTrue("$mode $stop: $text in $sources", text in sources)
                            assertEquals(sources.toSet().size, sources.size)
                            assertEquals("Not for navigation", entries.last().text)
                            val groups = entries.map { it.kind.group }
                            assertEquals("$entries", groups.sorted(), groups)
                            assertEquals(View.VISIBLE, control.view.control.visibility)
                            // On the map itself, every source credit at least starts, the notice
                            // is whole and a chart product shows with its qualification or not.
                            waitFor("$mode $stop: the strip laid out") {
                                !control.view.isLayoutRequested &&
                                    control.view.label.text.isNotEmpty()
                            }
                            val strip =
                                control.view.label.text.toString().split("\n").flatMap {
                                    it.split(MapAttributionStrip.SEPARATOR)
                                }
                            for (text in sources)
                                assertTrue(
                                    "$mode $stop: $text on the map, $strip",
                                    strip.any {
                                        it == text ||
                                            (it.endsWith("…") && text.startsWith(it.dropLast(1)))
                                    },
                                )
                            assertTrue("$strip", "Not for navigation" in strip)
                            for (piece in strip.filter { "ENC" in it })
                                assertTrue("$mode $stop: $piece", "not official" in piece)
                            android.util.Log.i("TileflowTest", "Attribution strip, $mode $stop: $strip")
                        }
                        check(here, "at $place")
                        for ((coordinate, expected) in stops) {
                            activity.map.jump(
                                TileflowCamera(coordinate.longitude, coordinate.latitude, 10.0)
                            )
                            check(expected, "at $coordinate")
                        }
                        activity.map.jump(TileflowCamera(center.longitude, center.latitude, 10.0))
                        check(here, "back at $place")
                        if (online) {
                            // A theme without the marine sources keeps the downloaded regions'
                            // obligations, and shows a notice only if its style declares one.
                            activity.map.setTheme("day")
                            waitFor("$mode day") {
                                control.entries.none {
                                    it.text.startsWith("NOAA ENC 2026-10-20 —")
                                }
                            }
                            assertEquals(
                                emptyList<MapAttributionEntry>(),
                                control.entries.filter {
                                    it.kind == MapAttributionEntry.Kind.NOTICE
                                },
                            )
                            assertEquals(
                                fixture.obligations,
                                control.entries
                                    .filter { it.kind == MapAttributionEntry.Kind.OBLIGATION }
                                    .map { it.text },
                            )
                        }
                        assertTrue("$mode: ${activity.failures}", activity.failures.isEmpty())
                    }
                }
            } finally {
                instrumentation.runOnMainSync { activity.finish() }
                TileflowOfflineSwitch.isNetworkEnabled = true
            }
            assertEquals(mode, if (online) 1 else 0, Fixture.counters().getInt("sessions"))
        }
    }

    /** A store of its own, downloading in the process, whose regions every map may use. */
    private fun store(client: () -> OfflinePackClient): TileflowOfflineStore {
        val subscribers = OfflineSubscribers()
        val core =
            OfflineStoreCore(
                OfflineLayout(File(root, "store-${stores.size}")),
                TileflowMapCache.get(context).store,
                OfflineHttpFetcher(),
                client,
                { null },
                subscribers,
                OfflineServingIndex.shared,
                { OfflineScopeRunner(it, scope) },
            )
        return TileflowOfflineStore(core, subscribers).also(stores::add)
    }

    /**
     * The platform's marine credits: each regional credit's text by source and identifier, and the
     * obligations and pages a download of all three sources shows, in manifest order.
     */
    private inner class MarineCredits {
        val bounds = HashMap<String, DoubleArray>()
        val names = HashMap<String, String>()
        val obligations: List<String>
        val pages: List<String>

        init {
            val text =
                instrumentation.context.assets.open("marine-credits.json").bufferedReader().use {
                    it.readText()
                }
            val cases = JSONObject(text).getJSONArray("cases")
            val credits = mutableListOf<JSONObject>()
            for (index in 0 until cases.length()) {
                val case = cases.getJSONObject(index)
                val values = case.getJSONArray("bounds")
                bounds[case.getString("place")] = DoubleArray(4) { values.getDouble(it) }
                val credit = case.getJSONObject("credit")
                credits += credit
                val source = case.getString("source").removeSuffix("-dem")
                val regional = credit.getJSONArray("regionalObligations")
                for (item in 0 until regional.length()) {
                    val obligation = regional.getJSONObject(item)
                    names[obligation.getString("exact")] = "$source ${obligation.getString("id")}"
                }
            }
            val all = OfflineObligation.obligations(credits)
            obligations = all.filter { it.href == null }.map { it.text }
            pages = all.filter { it.href != null }.map { it.text }
        }

        fun regional(entries: List<MapAttributionEntry>): Set<String> =
            entries
                .filter { it.kind == MapAttributionEntry.Kind.REGIONAL }
                .mapNotNull { names[it.text] }
                .toSet()
    }
}
