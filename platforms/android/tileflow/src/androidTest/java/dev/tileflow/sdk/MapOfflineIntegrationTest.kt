package dev.tileflow.sdk

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.offline.OfflineHttpFetcher
import dev.tileflow.sdk.offline.OfflineLayout
import dev.tileflow.sdk.offline.OfflinePackClient
import dev.tileflow.sdk.offline.OfflineScopeRunner
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineStoreCore
import dev.tileflow.sdk.offline.OfflineSubscribers
import dev.tileflow.sdk.offline.TileflowOfflineContent
import dev.tileflow.sdk.offline.TileflowOfflineException
import dev.tileflow.sdk.offline.TileflowOfflineErrorCode
import dev.tileflow.sdk.offline.TileflowOfflineGeometry
import dev.tileflow.sdk.offline.TileflowOfflineRegion
import dev.tileflow.sdk.offline.TileflowOfflineRegionLoadOptions
import dev.tileflow.sdk.offline.TileflowOfflineStore
import dev.tileflow.sdk.offline.TileflowOfflineSwitch
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Shows the map [OfflineMapHostActivity.requested] names. */
public class OfflineMapHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loaded = CountDownLatch(1)
    val failures = CopyOnWriteArrayList<TileflowErrorCode>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        map =
            TileflowMapView(this).apply {
                onEvent = {
                    when (it) {
                        TileflowMapEvent.ContentReady -> loaded.countDown()
                        is TileflowMapEvent.Failed -> failures.add(it.code)
                        else -> Unit
                    }
                }
                setSource(requested!!)
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }

    internal companion object {
        @Volatile var requested: TileflowMapSource? = null
    }
}

/**
 * Downloads regions from the fixture server, then shows them with the network switched off, as in
 * airplane mode. Run with the online fixture server and `adb reverse tcp:18645 tcp:18645`.
 */
@RunWith(AndroidJUnit4::class)
public class MapOfflineIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val root = File(context.cacheDir, "offline-map-test-${System.nanoTime()}")
    private val stores = mutableListOf<TileflowOfflineStore>()

    @After
    public fun tearDown() {
        TileflowOfflineSwitch.isNetworkEnabled = true
        runBlocking {
            for (store in stores) for (region in store.allRegions()) store.removeRegion(region.id)
        }
        scope.cancel()
        root.deleteRecursively()
    }

    @Test
    public fun aDownloadedRegionShowsTheMapWithoutTheNetwork() {
        val manifest = "$ORIGIN/cached/manifest.json"
        requireFixture(manifest)
        val cache = TileflowMapCache.get(context)
        runBlocking { cache.clear() }
        val store = store {
            throw TileflowOfflineException(TileflowOfflineErrorCode.INVALID_CONFIGURATION)
        }
        download(
            store,
            "fixture",
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.75, 40.4, -3.65, 40.44)),
                TileflowOfflineContent.Manifest(manifest, "fixture", emptyList()),
                maxZoom = 14,
            ),
        )

        TileflowOfflineSwitch.isNetworkEnabled = false
        val map = show(TileflowMapSource("fixture", URI(manifest), allowsLoopbackHttp = true))
        try {
            assertTrue("Downloaded data did not render", rendered(map, "poi"))
        } finally {
            instrumentation.runOnMainSync { map.finish() }
        }
        assertEquals("Nothing came from the network", 0, runBlocking { cache.usage() }.entries)
    }

    @Test
    public fun aHostedMapOpensFromItsPackOfflineAndRevalidatesItOnline() {
        requireFixture("$ORIGIN/maps/$HOSTED_MAP_ID/mobile/manifest.json")
        val cache = TileflowMapCache.get(context)
        runBlocking { cache.clear() }
        val configuration =
            TileflowConfiguration(
                apiOrigin = URI(ORIGIN),
                mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)),
            )
        val store = store { OfflinePackClient(configuration) }
        counters(reset = true)
        download(
            store,
            "hosted",
            TileflowOfflineRegionLoadOptions(
                TileflowOfflineGeometry.BoundingBox(
                    TileflowBoundingBox(-3.705, 40.416, -3.695, 40.424)
                ),
                TileflowOfflineContent.Hosted(HOSTED_MAP_ID, listOf("day")),
                minZoom = 13,
                maxZoom = 15,
            ),
        )
        val downloaded = counters()
        assertEquals(1, downloaded.getInt("packs"))
        assertTrue(downloaded.getInt("packResources") > 0)
        assertEquals(0, downloaded.getInt("sessions"))

        val source = TileflowMapSource.hosted(HOSTED_MAP_ID, configuration = configuration)
        counters(reset = true)
        TileflowOfflineSwitch.isNetworkEnabled = false
        val offline = show(source)
        try {
            assertTrue("The pack did not render", rendered(offline, "buildings"))
        } finally {
            instrumentation.runOnMainSync { offline.finish() }
            TileflowOfflineSwitch.isNetworkEnabled = true
        }
        val withoutNetwork = counters()
        assertEquals("No session starts without a network", 0, withoutNetwork.getInt("sessions"))
        assertEquals(0, withoutNetwork.getInt("downloads"))
        assertEquals(0, withoutNetwork.getInt("notModified"))
        assertEquals("Nothing came from the network", 0, runBlocking { cache.usage() }.entries)

        counters(reset = true)
        val online = show(source)
        instrumentation.runOnMainSync { online.finish() }
        val withNetwork = counters()
        assertEquals("Online, the map starts its session", 1, withNetwork.getInt("sessions"))
        assertTrue(
            "Stored resources revalidate unchanged: $withNetwork",
            withNetwork.getInt("notModified") > 0,
        )
        assertTrue(withNetwork.getInt("sessionResources") > 0)
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

    private fun download(
        store: TileflowOfflineStore,
        id: String,
        options: TileflowOfflineRegionLoadOptions,
    ) = runBlocking {
        store.loadRegion(id, options)
        val deadline = System.currentTimeMillis() + 30_000
        var region = store.region(id)
        while (
            region?.state != TileflowOfflineRegion.DownloadState.COMPLETE &&
                System.currentTimeMillis() < deadline
        ) {
            delay(20)
            region = store.region(id)
        }
        assertEquals("$region", TileflowOfflineRegion.DownloadState.COMPLETE, region?.state)
    }

    private fun show(source: TileflowMapSource): OfflineMapHostActivity {
        OfflineMapHostActivity.requested = source
        val intent =
            Intent(instrumentation.context, OfflineMapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as OfflineMapHostActivity
        assertTrue(
            "Map did not load. Errors: ${activity.failures}",
            activity.loaded.await(30, TimeUnit.SECONDS),
        )
        assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
        return activity
    }

    private fun rendered(activity: OfflineMapHostActivity, layer: String): Boolean = runBlocking {
        withContext(Dispatchers.Main) {
            activity.map.query(activity.map.width / 2f, activity.map.height / 2f).any {
                it.layer == layer
            }
        }
    }

    /** The fixture's Hosted counters, read directly, never through the switched-off client. */
    private fun counters(reset: Boolean = false): JSONObject {
        val connection = URL("$ORIGIN/__fixture/hosted").openConnection() as HttpURLConnection
        connection.requestMethod = if (reset) "POST" else "GET"
        return connection.inputStream.bufferedReader().use { JSONObject(it.readText()) }
    }

    private fun requireFixture(url: String) {
        val reachable = runCatching {
                (URL(url).openConnection() as HttpURLConnection).responseCode == 200
            }
            .getOrDefault(false)
        assumeTrue("Start scripts/mobile-fixture-server.mjs and adb reverse tcp:18645", reachable)
    }

    private companion object {
        const val ORIGIN = "http://127.0.0.1:18645"
        const val HOSTED_MAP_ID = "map_offlinefixture01"
    }
}
