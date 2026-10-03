package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class AdmissionContextGuardTest {
	@Test fun aContextGuardCannotReviveAfterRetirementOrMoveToAnotherContext() {
		val scheduler = ManualAdmissionScheduler()
		val engine = AdmissionEngine("installation", scheduler, AdmissionNetworkDouble(), { true }, {})
		val first = engine.register(null, emptyList())
		val second = engine.register(null, emptyList())
		val one = engine.contextGuard(first)
		val two = engine.contextGuard(second)
		assertTrue(one()); assertTrue(two())
		engine.lifecycle(false)
		assertFalse(one()); assertFalse(two())
		engine.lifecycle(true)
		assertTrue(one()); assertTrue(two())
		engine.retire(first)
		assertFalse(one()); assertTrue(two())
		try { engine.contextGuard(first); fail("Expected retired context rejection.") }
		catch (_: IllegalArgumentException) { }
		engine.close()
		assertFalse(one()); assertFalse(two())
	}
}
