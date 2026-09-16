package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class NativeDocumentRegistryTest {
	private val url = "https://maps.example.test/manifest.json"
	private class Load(val guard: () -> Boolean, val callback: (AdmissionHttpResponse?) -> Unit) { var cancelled = false }
	private inner class Fixture {
		val scheduler = ManualAdmissionScheduler()
		val loads = mutableListOf<Load>()
		var sequence = 0
		val registry = NativeDocumentRegistry(scheduler, { _, _, _, guard, callback ->
			val load = Load(guard, callback); loads.add(load)
			AdmissionCancellation { load.cancelled = true }
		}, { "document-${++sequence}" })
		fun response(index: Int, bytes: ByteArray = "{}".toByteArray(), finalUrl: String = url) {
			loads[index].callback(AdmissionHttpResponse(200, emptyMap(), bytes, finalUrl)); scheduler.flush()
		}
	}

	@Test fun allocationAndChunkingHaveIndependentAcknowledgements() {
		val f = Fixture()
		val id = f.registry.open(url, 1024, null)
		assertEquals("document-1", id)
		var header: NativeDocumentHeader? = null
		f.registry.response(id) { header = it }
		assertNull(header)
		f.response(0)
		assertEquals(url, header?.url)
		assertEquals(200, header?.status)
		val first = f.registry.chunk(id, 1)
		assertFalse(first.last)
		assertArrayEquals(byteArrayOf(123), first.bytes)
		val second = f.registry.chunk(id, 1)
		assertTrue(second.last)
		assertArrayEquals(byteArrayOf(125), second.bytes)
		f.registry.cancel(id); f.registry.cancel(id)
		assertFalse(first.toString().contains("123"))
		assertFalse(header.toString().contains("example.test"))
	}

	@Test fun cancellationRetainsCapacityUntilNativeTerminalCompletion() {
		val f = Fixture()
		val ids = (0 until 16).map { f.registry.open(url, 1024, null) }
		ids.forEach { f.registry.cancel(it) }
		assertTrue(f.loads.all { it.cancelled && !it.guard() })
		try { f.registry.open(url, 1024, null); fail("Expected bounded pending cleanup.") }
		catch (_: IllegalArgumentException) { }
		f.loads[0].callback(null); f.scheduler.flush()
		f.registry.open(url, 1024, null)
		assertEquals(17, f.loads.size)
	}

	@Test fun retirementInvalidatesPendingHeadersAndDeliveredBodiesWithoutAJavaScriptTimer() {
		for (phase in 0..1) {
			val f = Fixture()
			val id = f.registry.open(url, 1024, null)
			var failed = false
			f.registry.response(id) { if (it == null) failed = true }
			if (phase == 1) f.response(0)
			f.scheduler.advance(30000)
			assertFalse(f.loads[0].guard())
			if (phase == 0) assertTrue(failed)
			try { f.registry.chunk(id, 2); fail("Expected expired reader.") }
			catch (_: IllegalArgumentException) { }
			f.response(0)
		}
	}

	@Test fun oversizedAndForeignBodiesFailBeforeBridgeDelivery() {
		for (foreign in listOf(false, true)) {
			val f = Fixture()
			val id = f.registry.open(url, 2, null)
			var called = false
			f.registry.response(id) { called = true; assertNull(it) }
			f.response(0, if (foreign) "{}".toByteArray() else ByteArray(3), if (foreign) "https://other.example.test/x" else url)
			assertTrue(called)
		}
	}

	@Test fun malformedLimitsAndPartialScopeNeverAllocateNativeWork() {
		val f = Fixture()
		for (limit in listOf(0, -1, 8388609)) {
			try { f.registry.open(url, limit, null); fail("Expected document limit rejection.") }
			catch (_: IllegalArgumentException) { }
		}
		for (candidate in listOf("http://maps.example.test/a", "$url?__tf_native_context=other")) {
			try { f.registry.open(candidate, 1024, null); fail("Expected URL rejection.") }
			catch (_: IllegalArgumentException) { }
		}
		assertTrue(f.loads.isEmpty())
	}
}
