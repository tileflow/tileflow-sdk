package dev.tileflow.sdk

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheRetention
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.TileflowHttpClient
import java.net.URI
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** Shows the fixture's cacheable map, whose resources allow storing and revalidation. */
public class CachedMapHostActivity : ComponentActivity() {
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
                setSource(
                    TileflowMapSource(
                        map = "fixture",
                        manifestUrl = URI("$ORIGIN/cached/manifest.json"),
                        allowsLoopbackHttp = true,
                    )
                )
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }

    internal companion object {
        const val ORIGIN = "http://127.0.0.1:18645"
    }
}

/** Run with the online fixture server and `adb reverse tcp:18645 tcp:18645`. */
@RunWith(AndroidJUnit4::class)
public class MapCacheIntegrationTest {
    @Test
    public fun secondMountShowsCachedPublicResourcesWithoutTheNetwork() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val cache = TileflowMapCache.get(context)
        runBlocking { cache.clear() }
        val online = launch()
        try {
            assertTrue(
                "Map did not load. Errors: ${online.failures}",
                online.loaded.await(30, TimeUnit.SECONDS),
            )
            assertTrue("Map errors: ${online.failures}", online.failures.isEmpty())
        } finally {
            instrumentation.runOnMainSync { online.finish() }
        }
        val usage = runBlocking { cache.usage() }
        assertTrue("Manifest, style, data and font: $usage", usage.entries >= 4)
        assertTrue((usage.bytesByClass[TileflowResourceClass.STYLE] ?: 0) > 0)
        assertTrue((usage.bytesByClass[TileflowResourceClass.GLYPHS] ?: 0) > 0)
        // The fixture's other routes are no-store and never reach the disk.
        val uncached =
            ResourceCacheKey(
                URI("${CachedMapHostActivity.ORIGIN}/manifest.json"),
                ResourceCacheScope.Shared,
            )
        assertFalse(cache.store.file(uncached, ResourceCacheRetention.AMBIENT).exists())

        TileflowHttpClient.networkEnabled = false
        val offline = launch()
        try {
            assertTrue(
                "Cached map did not load. Errors: ${offline.failures}",
                offline.loaded.await(30, TimeUnit.SECONDS),
            )
            assertTrue("Map errors: ${offline.failures}", offline.failures.isEmpty())
            runBlocking {
                withContext(Dispatchers.Main) {
                    val point = offline.map.project(TileflowCoordinate(-3.70, 40.42))
                    val features = offline.map.query(point.x, point.y)
                    assertTrue(
                        "Cached data did not render: $features",
                        features.any { it.layer == "poi" },
                    )
                }
            }
        } finally {
            TileflowHttpClient.networkEnabled = true
            instrumentation.runOnMainSync { offline.finish() }
        }
    }

    private fun launch(): CachedMapHostActivity {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val intent =
            Intent(instrumentation.context, CachedMapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return instrumentation.startActivitySync(intent) as CachedMapHostActivity
    }
}
