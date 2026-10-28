package dev.tileflow.sdk

import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.webkit.WebViewCompat
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Run with the online fixture server. CI passes `tileflowWebView=supported|rejected` so that a
 * system image whose WebView moved across the minimum fails instead of passing vacuously.
 */
@RunWith(AndroidJUnit4::class)
public class WebViewRequirementIntegrationTest {
    @Test
    public fun installedWebViewEitherRendersOrFailsWithATypedError() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val provider = WebViewCompat.getCurrentWebViewPackage(instrumentation.targetContext)
        val supported = WebViewRequirement.isSupported(provider?.versionName)
        println("Android System WebView: ${provider?.packageName} ${provider?.versionName}")
        InstrumentationRegistry.getArguments().getString("tileflowWebView")?.let {
            assertEquals("WebView ${provider?.versionName}", it == "supported", supported)
        }
        val intent =
            Intent(instrumentation.context, MapHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val activity = instrumentation.startActivitySync(intent) as MapHostActivity
        try {
            if (supported) {
                assertTrue(
                    "Map did not load. Errors: ${activity.failures}",
                    activity.loaded.await(30, TimeUnit.SECONDS),
                )
                assertTrue("Map errors: ${activity.failures}", activity.failures.isEmpty())
            } else {
                val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
                while (activity.failures.isEmpty() && System.nanoTime() < deadline)
                    Thread.sleep(50)
                assertEquals(listOf(TileflowErrorCode.INCOMPATIBLE_RUNTIME), activity.failures)
                assertEquals(1L, activity.loaded.count)
            }
        } finally {
            instrumentation.runOnMainSync { activity.finish() }
        }
    }
}
