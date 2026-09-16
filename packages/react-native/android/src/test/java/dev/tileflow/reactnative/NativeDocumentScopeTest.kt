package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class NativeDocumentScopeTest {
	@Test fun contextRetirementInvalidatesEvenADeliveredBody() {
		val scheduler = ManualAdmissionScheduler()
		val callbacks = mutableListOf<(AdmissionHttpResponse?) -> Unit>()
		var sequence = 0
		val registry = NativeDocumentRegistry(scheduler, { _, _, _, _, done -> callbacks.add(done); AdmissionCancellation {} }, { "document-${++sequence}" })
		val url = "https://api.example.test/maps/map_0123456789abcdef/style.json"
		val one = NativeDocumentScope({ true }, { _, _ -> AdmissionCancellation {} }, "context-1")
		val two = NativeDocumentScope({ true }, { _, _ -> AdmissionCancellation {} }, "context-2")
		val first = registry.open(url, 1024, one)
		val second = registry.open(url, 1024, two)
		registry.response(first) { assertNotNull(it) }
		registry.response(second) { assertNotNull(it) }
		callbacks.forEach { it(AdmissionHttpResponse(200, emptyMap(), "{}".toByteArray(), url)) }
		scheduler.flush()
		registry.retireContext("context-1")
		try { registry.chunk(first, 10); fail("Expected retired body.") }
		catch (_: IllegalArgumentException) { }
		assertArrayEquals("{}".toByteArray(), registry.chunk(second, 10).bytes)
	}

	@Test fun aFailedPhysicalCancellationKeepsItsHandleForTheNextAcknowledgement() {
		val scheduler = ManualAdmissionScheduler()
		var cancellations = 0
		val registry = NativeDocumentRegistry(scheduler, { _, _, _, _, _ -> AdmissionCancellation {
			if (++cancellations == 1) throw IllegalStateException("Untrusted native details.")
		} }, { "document-1" })
		val id = registry.open("https://maps.example.test/manifest.json", 1024, null)
		try { registry.cancel(id); fail("Expected failed cancellation.") }
		catch (_: Exception) { }
		registry.cancel(id)
		assertEquals(2, cancellations)
	}
}
