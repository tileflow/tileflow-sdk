package dev.tileflow.reactnative

import android.view.View
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.uimanager.ThemedReactContext
import dev.tileflow.reactnative.map.MountedMapEndpoint
import dev.tileflow.reactnative.map.NativeMapRegistry
import dev.tileflow.sdk.TileflowMapView
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeMapMountTest {
    private class Endpoint(override val map: TileflowMapView, override val scope: CoroutineScope) :
        MountedMapEndpoint {
        var blocked: CompletableDeferred<Unit>? = null
        val properties = mutableListOf<Triple<String, String, String>>()
        var destroys = 0
        val operation = CompletableDeferred<Any>()

        override suspend fun applyProperties(
            sourceJson: String,
            appearanceJson: String,
            optionsJson: String,
        ) {
            properties += Triple(sourceJson, appearanceJson, optionsJson)
            blocked?.await()
        }

        override suspend fun call(method: String, payload: JSONObject): Any = operation.await()

        override fun destroy() {
            destroys++
            map.destroy()
        }
    }

    @Test
    fun anEmptySourceCreatesNothingAndRetirementCannotAttachAnOldMap() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        val application = BridgeReactContext(ApplicationProvider.getApplicationContext())
        val context = ThemedReactContext(application, application, "fixture", 1)
        val registry = NativeMapRegistry()
        val endpoints = mutableListOf<Endpoint>()
        val host =
            TileflowNativeMapView(context, registry) { sdk, _ ->
                Endpoint(sdk, CoroutineScope(SupervisorJob() + dispatcher)).also {
                    if (endpoints.isEmpty()) it.blocked = CompletableDeferred()
                    endpoints += it
                }
            }
        try {
            host.id = 42
            host.instanceId = "first"
            host.commitProperties()
            runCurrent()
            assertTrue(endpoints.isEmpty())
            host.sourceJson = "{\"mapId\":\"first-map\"}"
            host.commitProperties()
            runCurrent()
            val old = endpoints.single()
            assertNull(old.map.parent)

            val operation = async {
                runCatching { registry.call(42, "first", "getCamera", JSONObject()) }
            }
            runCurrent()
            host.instanceId = "second"
            host.sourceJson = "{\"mapId\":\"second-map\"}"
            host.commitProperties()
            runCurrent()
            assertEquals(1, old.destroys)
            assertTrue(operation.await().isFailure)
            assertEquals(1, host.childCount)
            assertSame(endpoints.last().map, host.getChildAt(0))
            old.blocked!!.complete(Unit)
            runCurrent()
            assertNull(old.map.parent)
            assertFalse(endpoints.last().destroys > 0)
        } finally {
            host.dispose()
            registry.clear()
            Dispatchers.resetMain()
        }
        assertTrue(endpoints.all { it.destroys == 1 })
    }

    @Test
    fun propUpdatesKeepTheSessionAndClearRemovesEveryPendingOperation() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        Dispatchers.setMain(dispatcher)
        val application = BridgeReactContext(ApplicationProvider.getApplicationContext())
        val context = ThemedReactContext(application, application, "fixture", 1)
        val registry = NativeMapRegistry()
        val endpoints = mutableListOf<Endpoint>()
        val host =
            TileflowNativeMapView(context, registry) { sdk, _ ->
                Endpoint(sdk, CoroutineScope(SupervisorJob() + dispatcher)).also(endpoints::add)
            }
        try {
            host.id = 42
            host.instanceId = "map"
            host.sourceJson = "{\"mapId\":\"fixture-map\"}"
            host.commitProperties()
            runCurrent()
            val endpoint = endpoints.single()
            host.optionsJson = "{\"zoomEnabled\":false}"
            host.commitProperties()
            runCurrent()
            assertEquals(1, endpoints.size)
            assertEquals(2, endpoint.properties.size)
            assertEquals(host.optionsJson, endpoint.properties.last().third)

            val marker =
                TileflowNativeMarkerView(context).apply {
                    instanceId = "map"
                    annotationId = "callout"
                    optionsJson = "{\"coordinate\":[-3.7,40.42]}"
                    measure(
                        View.MeasureSpec.makeMeasureSpec(40, View.MeasureSpec.EXACTLY),
                        View.MeasureSpec.makeMeasureSpec(20, View.MeasureSpec.EXACTLY),
                    )
                    layout(0, 0, 40, 20)
                }
            host.addReactChild(marker, 0)
            assertSame(marker, host.reactChild(0))
            val annotation = endpoint.map.viewAnnotationManager.annotations.getValue(marker)
            assertEquals(40f, annotation.width)
            assertEquals(20f, annotation.height)
            host.removeReactChild(0)
            assertTrue(endpoint.map.viewAnnotationManager.annotations.isEmpty())
            assertNull(marker.parent)

            val pending = async {
                runCatching { registry.call(42, "map", "getCamera", JSONObject()) }
            }
            runCurrent()
            registry.clear()
            runCurrent()
            assertTrue(pending.await().isFailure)
            assertEquals(1, endpoint.destroys)
        } finally {
            host.dispose()
            Dispatchers.resetMain()
        }
        assertEquals(1, endpoints.single().destroys)
    }
}
