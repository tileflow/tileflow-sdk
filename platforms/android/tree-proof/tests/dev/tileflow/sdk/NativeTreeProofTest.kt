package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.engine.NativeMapEngine
import dev.tileflow.sdk.offline.*
import dev.tileflow.sdk.transport.ResourceLoader
import java.io.File
import java.net.URI
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.style.layers.CustomLayer
import org.maplibre.android.style.layers.Property
import org.maplibre.android.style.layers.PropertyFactory.visibility

internal object TreeProofBridge {
    init { System.loadLibrary("tileflow_tree_proof") }
    external fun create(bytes: ByteArray): Long
}

/** Opt-in fixed-placement proof. Compiled only with -PtileflowTreeProof. */
@RunWith(AndroidJUnit4::class)
public class NativeTreeProofTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val root = File(context.filesDir, "tree-proof")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val configuration = TileflowConfiguration(
        apiOrigin = URI(Fixture.ORIGIN),
        mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)),
    )

    private fun store(): TileflowOfflineStore {
        val subscribers = OfflineSubscribers()
        val core = OfflineStoreCore(
            OfflineLayout(File(root, "store")), TileflowMapCache.get(context).store,
            OfflineHttpFetcher(), { OfflinePackClient(configuration) }, { null }, subscribers,
            OfflineServingIndex.shared, { OfflineScopeRunner(it, scope) },
        )
        return TileflowOfflineStore(core, subscribers)
    }

    @After
    public fun stop() {
        TileflowOfflineSwitch.isNetworkEnabled = true
        scope.cancel()
        NativeMapHostActivity.requested = NativeMapHostActivity.SELF_HOSTED
        NativeMapHostActivity.theme = null
    }

    @Test
    public fun onlineDownloadAndRender() = runBlocking {
        Fixture.require("${Fixture.ORIGIN}/manifest.json")
        root.deleteRecursively()
        root.mkdirs()
        TileflowOfflineSwitch.isNetworkEnabled = true
        TileflowMapCache.get(context).clear()
        val store = store()
        store.loadRegion("trees", TileflowOfflineRegionLoadOptions(
            geometry = TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.701, 40.419, -3.699, 40.421)),
            content = TileflowOfflineContent.Hosted(Fixture.HOSTED_MAP_ID, themes = listOf("tree-proof")),
            minZoom = 15, maxZoom = 15,
        ))
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        while (store.region("trees")?.state != TileflowOfflineRegion.DownloadState.COMPLETE && System.nanoTime() < deadline) delay(25)
        assertEquals(store.region("trees").toString(), TileflowOfflineRegion.DownloadState.COMPLETE, store.region("trees")?.state)
        render(false)
    }

    /** Invoked by a second instrumentation process with the server stopped. */
    @Test
    public fun reopenOffline() = runBlocking {
        assumeTrue(File(root, "store").exists())
        TileflowMapCache.get(context).clear()
        TileflowOfflineSwitch.isNetworkEnabled = false
        val store = store()
        assertEquals(TileflowOfflineRegion.DownloadState.COMPLETE, store.region("trees")?.state)
        render(true)
        assertEquals(0, TileflowMapCache.get(context).usage().entries)
    }

    private suspend fun render(offline: Boolean) {
        NativeMapHostActivity.requested = TileflowMapSource.hosted(Fixture.HOSTED_MAP_ID, configuration = configuration)
        NativeMapHostActivity.theme = "tree-proof"
        NativeMapHostActivity.camera = TileflowCamera(-3.7, 40.42, 18.5, bearing = 0.0, pitch = 60.0)
        val activity = instrumentation.startActivitySync(
            Intent(instrumentation.context, NativeMapHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ) as NativeMapHostActivity
        try {
            assertTrue("${activity.failures} ${activity.warnings}", activity.loaded.await(30, TimeUnit.SECONDS))
            val engine = requireNotNull(activity.engine)
            // Test-only access to the map's real loader; no alternative HTTP/cache implementation.
            val field = NativeMapEngine::class.java.getDeclaredField("loader").apply { isAccessible = true }
            val loader = field.get(engine) as ResourceLoader
            val payload = withContext(Dispatchers.IO) {
                loader.load(URI("${Fixture.ORIGIN}/base/${"a".repeat(64)}/models/streets-tree-round-near"))
            }
            assertEquals(200, payload.status)
            File(root, if (offline) "offline.tftm" else "online.tftm").writeBytes(payload.bytes)
            withContext(Dispatchers.Main) {
                requireNotNull(engine.map?.style).addLayer(CustomLayer("proof-trees", TreeProofBridge.create(payload.bytes)))
            }
            val output = File(activity.getExternalFilesDir(null), "tree-proof/${if (offline) "offline" else "online"}")
            output.mkdirs()
            for (bearing in listOf(0.0, 45.0, 180.0)) {
                withContext(Dispatchers.Main) {
                    activity.map.setCamera(TileflowCamera(-3.7, 40.42, 18.5, bearing = bearing, pitch = 60.0))
                }
                delay(500)
                capture(output, "bearing-${bearing.toInt()}")
            }
            withContext(Dispatchers.Main) {
                engine.map?.style?.getLayer("proof-building")?.setProperties(visibility(Property.NONE))
            }
            delay(300)
            capture(output, "no-building")
            assertTrue(activity.failures.toString(), activity.failures.isEmpty())
            println("TREE_PROOF ${output.absolutePath} modelBytes=${payload.bytes.size}")
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.waitForIdleSync()
        }
    }

    private fun capture(output: File, name: String) {
        val bitmap = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
        File(output, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }
}
