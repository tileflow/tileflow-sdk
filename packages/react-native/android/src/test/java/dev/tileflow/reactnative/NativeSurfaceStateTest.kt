package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class NativeSurfaceStateTest {
	@Test fun requiresLoadedStyleCommittedLayoutAndMatchingFullyRenderedFrame() {
		val events = mutableListOf<Map<String, Any>>()
		val state = NativeSurfaceState("surface", events::add)
		val style = Any()
		state.expect("one")
		state.layout(true)
		state.loaded("one", style)
		state.frameStart(style)
		state.mapRendered(style, true)
		state.frameEnd(style, true)
		assertFalse(events.any { it["kind"] == "render" })
		state.acknowledge((events.last()["sequence"] as Number).toLong())
		val layout = state.commit("one")
		state.frameStart(style)
		state.mapRendered(style, true)
		state.frameEnd(style, true)
		state.acknowledge((events.last()["sequence"] as Number).toLong())
		assertTrue(events.any { it["kind"] == "render" && it["layout"] == layout })
	}

	@Test fun staleStylesFramesLayoutsAndBackgroundNeverBecomeReady() {
		val events = mutableListOf<Map<String, Any>>()
		val state = NativeSurfaceState("surface") { event -> events.add(event) }
		val old = Any(); val current = Any()
		state.expect("one"); state.layout(true); state.loaded("one", old)
		state.commit("one"); state.frameStart(old)
		state.expect("two"); state.loaded("two", current); state.commit("two")
		state.mapRendered(old, true); state.frameEnd(old, true)
		state.frameStart(current); state.mapRendered(current, true)
		state.layout(false); state.frameEnd(current, true)
		repeat(8) { events.lastOrNull()?.let { state.acknowledge((it["sequence"] as Number).toLong()) } }
		assertFalse(events.any { it["kind"] == "render" })
		assertThrows(IllegalStateException::class.java) { state.commit("two") }
		state.close()
		assertFalse(state.active)
	}

	@Test fun layoutChangeRequiresFreshFullyRenderedMapEvidenceAndClosesGesture() {
		val events = mutableListOf<Map<String, Any>>()
		val state = NativeSurfaceState("surface", events::add)
		val style = Any()
		val view = mapOf<String, Any>("center" to listOf(1.0, 2.0), "zoom" to 3.0, "bearing" to 4.0, "pitch" to 5.0)
		state.expect("one"); state.layout(true); state.loaded("one", style)
		while (state.awaitingSequence != null) state.acknowledge(state.awaitingSequence!!)
		state.commit("one"); state.mapRendered(style, true)
		state.gestureStart(view)
		while (state.awaitingSequence != null) state.acknowledge(state.awaitingSequence!!)
		state.layout(true)
		while (state.awaitingSequence != null) state.acknowledge(state.awaitingSequence!!)
		assertTrue(state.beginCommand(1))
		state.commit("one"); state.frameStart(style); state.frameEnd(style, true)
		while (state.awaitingSequence != null) state.acknowledge(state.awaitingSequence!!)
		assertFalse(events.any { it["kind"] == "render" })
		state.frameStart(style); state.mapRendered(style, true); state.frameEnd(style, true)
		while (state.awaitingSequence != null) state.acknowledge(state.awaitingSequence!!)
		assertTrue(events.any { it["kind"] == "render" })
	}

	@Test fun failedStyleCanBeRearmedForRollback() {
		val state = NativeSurfaceState("surface") {}
		state.expect("one")
		state.fail()
		assertFalse(state.active)
		state.expect("rollback")
		assertTrue(state.active)
	}

	@Test fun cameraTokensAreMonotonicAndGestureChangesCannotBeCommands() {
		val events = mutableListOf<Map<String, Any>>()
		val state = NativeSurfaceState("surface", events::add)
		state.expect("one"); state.layout(true); state.loaded("one", Any())
		assertTrue(state.beginCommand(1))
		state.cancelCommand(2)
		assertFalse(state.beginCommand(2))
		val view = mapOf<String, Any>("center" to listOf(1.0, 2.0), "zoom" to 3.0, "bearing" to 4.0, "pitch" to 5.0)
		state.gestureStart(view)
		assertFalse(state.beginCommand(3))
		state.gestureChange(view); state.gestureEnd(view)
		assertTrue(state.beginCommand(4))
		while (state.awaitingSequence != null) state.acknowledge(state.awaitingSequence!!)
		assertEquals(listOf("gesture-start", "gesture-change", "gesture-end"), events.map { it["kind"] }.filter { it.toString().startsWith("gesture") })
	}

	@Test fun suspendedConsumersKeepOnlyBoundedNativeEventsAndNoValuesInDescriptions() {
		val events = mutableListOf<Map<String, Any>>()
		val state = NativeSurfaceState("surface", events::add)
		state.expect("one"); state.layout(true); state.loaded("one", Any())
		val view = mapOf<String, Any>("center" to listOf(1.0, 2.0), "zoom" to 3.0, "bearing" to 4.0, "pitch" to 5.0)
		repeat(1000) { state.gestureStart(view); state.gestureChange(view); state.gestureEnd(view) }
		assertTrue(state.pendingCount <= 32)
		assertEquals(1, events.size)
		assertEquals("NativeSurfaceState", state.toString())
		state.close()
	}
}
