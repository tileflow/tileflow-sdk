package dev.tileflow.reactnative

import dev.tileflow.reactnative.map.NativeMapEndpoint
import dev.tileflow.reactnative.map.NativeMapRegistry
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeMapRegistryTest {
    private class Endpoint(override val scope: CoroutineScope) : NativeMapEndpoint {
        val calls = mutableListOf<String>()
        val waits = mutableMapOf<String, CompletableDeferred<Any>>()
        var destroyed = false
        override suspend fun call(method: String, payload: JSONObject): Any {
            calls += method
            return waits[method]?.await() ?: JSONObject.NULL
        }
        override fun destroy() { destroyed = true }
    }

    @Test
    fun recyclingCancelsPendingWorkAndRejectsCallsFromTheOldInstance() = runTest {
        val registry = NativeMapRegistry()
        val old = Endpoint(CoroutineScope(coroutineContext + SupervisorJob()))
        old.waits["project"] = CompletableDeferred()
        registry.bind(10, "before", old)
        val pending = async { runCatching { registry.call(10, "before", "project", JSONObject()) } }
        runCurrent()
        val next = Endpoint(CoroutineScope(coroutineContext + SupervisorJob()))
        registry.bind(10, "after", next)
        runCurrent()
        assertTrue(pending.await().isFailure)
        assertTrue(old.destroyed)
        val stale = runCatching { registry.call(10, "before", "project", JSONObject()) }.exceptionOrNull()
        assertEquals(TileflowErrorCode.DISPOSED, (stale as TileflowMapException).code)
        registry.unbind(10, "before", old)
        assertEquals(JSONObject.NULL, registry.call(10, "after", "project", JSONObject()))
        assertFalse(next.destroyed)
        registry.unbind(10, "after", next)
    }

    @Test
    fun aNewCameraCommandRunsWhileThePreviousAnimationIsAwaitingItsEnd() = runTest {
        val registry = NativeMapRegistry()
        val endpoint = Endpoint(CoroutineScope(coroutineContext + SupervisorJob()))
        val finished = CompletableDeferred<Any>()
        endpoint.waits["move"] = finished
        registry.bind(10, "map", endpoint)
        val move = async { registry.call(10, "map", "move", JSONObject()) }
        runCurrent()
        assertFalse(move.isCompleted)
        assertEquals(JSONObject.NULL, registry.call(10, "map", "stop", JSONObject()))
        assertEquals(listOf("move", "stop"), endpoint.calls)
        finished.complete(JSONObject.NULL)
        assertEquals(JSONObject.NULL, move.await())
        registry.unbind(10, "map", endpoint)
    }
}
