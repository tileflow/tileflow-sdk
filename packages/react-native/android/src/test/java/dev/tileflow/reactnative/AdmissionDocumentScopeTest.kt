package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class AdmissionDocumentScopeTest {
	@Test fun scopesDoNotOutliveTheirContextsAndCancellationSettlesOnlyTheirDocument() {
		val scheduler = ManualAdmissionScheduler()
		val engine = AdmissionEngine("installation", scheduler, AdmissionNetworkDouble(), { true }, {})
		val url = "https://api.example.test/maps/map_0123456789abcdef/style.json"
		val first = engine.register("map_0123456789abcdef", listOf(AdmissionResource(url, "style", null)))
		val second = engine.register("map_0123456789abcdef", listOf(AdmissionResource(url, "style", null)))
		val one = createAdmissionDocumentScope(engine, first, 1024)
		val two = createAdmissionDocumentScope(engine, second, 1024)
		var completions = 0
		val operation = one.load(url) { assertNull(it); completions++ }
		operation.cancel(); operation.cancel()
		scheduler.flush()
		assertEquals(1, completions)
		engine.retire(first)
		assertFalse(one.isActive())
		assertTrue(two.isActive())
	}
}
