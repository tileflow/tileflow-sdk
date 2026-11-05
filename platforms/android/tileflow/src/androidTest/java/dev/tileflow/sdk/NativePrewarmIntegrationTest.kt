package dev.tileflow.sdk

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.sdk.engine.MapEngineKind
import dev.tileflow.sdk.transport.MapLibreModuleProvider
import dev.tileflow.sdk.transport.MapResourceContexts
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.MapLibre

@RunWith(AndroidJUnit4::class)
public class NativePrewarmIntegrationTest {
    @Test
    public fun prewarmInstallsTheNativeTransportWithoutOpeningAMap() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val routes = MapResourceContexts.activeCount
        instrumentation.runOnMainSync {
            val old = TileflowMapView.defaultEngineKind
            try {
                TileflowMapView.defaultEngineKind = MapEngineKind.NATIVE
                TileflowMapView.prewarm(context)
                val provider = MapLibre.getModuleProvider()
                assertTrue(
                    "Prewarm installed the native resource adapter",
                    provider is MapLibreModuleProvider,
                )
                TileflowMapView.prewarm(context)
                assertSame(provider, MapLibre.getModuleProvider())
            } finally {
                TileflowMapView.defaultEngineKind = old
            }
        }
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (
            (TileflowDeviceProfile.known() == null || TileflowMapCache.existing() == null) &&
                System.nanoTime() < deadline
        ) Thread.sleep(10)
        assertTrue(TileflowDeviceProfile.known() != null && TileflowMapCache.existing() != null)
        assertEquals(routes, MapResourceContexts.activeCount)
    }
}
