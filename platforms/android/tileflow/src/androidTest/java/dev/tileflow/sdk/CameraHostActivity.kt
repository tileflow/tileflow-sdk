package dev.tileflow.sdk

import android.os.Bundle
import androidx.activity.ComponentActivity
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import kotlin.math.abs
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue

/** A map with a stable id for camera restoration across activity recreation. */
public class CameraHostActivity : ComponentActivity() {
    lateinit var map: TileflowMapView
    val loaded = CountDownLatch(1)
    val failures = CopyOnWriteArrayList<TileflowErrorCode>()
    val events = CopyOnWriteArrayList<TileflowMapEvent>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        map =
            TileflowMapView(this).apply {
                id = MAP_ID
                // The tests measure the view itself; system bars do not move the camera here.
                automaticallyAdjustsContentPadding = false
                onEvent = {
                    events.add(it)
                    when (it) {
                        TileflowMapEvent.ContentReady -> loaded.countDown()
                        is TileflowMapEvent.Failed -> failures.add(it.code)
                        else -> Unit
                    }
                }
                setSource(NativeViewHostActivity.CITY)
            }
        setContentView(map)
    }

    override fun onDestroy() {
        map.destroy()
        super.onDestroy()
    }

    internal companion object {
        const val MAP_ID = 4242
    }
}
