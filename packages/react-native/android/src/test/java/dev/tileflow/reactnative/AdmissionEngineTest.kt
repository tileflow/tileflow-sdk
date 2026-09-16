package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

internal class ManualAdmissionScheduler : AdmissionScheduler {
	private class Timer(val at: Long, val action: () -> Unit) { var active = true }
	private val work = ArrayDeque<() -> Unit>()
	private val timers = mutableListOf<Timer>()
	var time = 0L
	override fun nowMs() = time
	override fun dispatch(action: () -> Unit) { work.addLast(action) }
	override fun after(delayMs: Long, action: () -> Unit): AdmissionCancellation {
		val timer = Timer(time + delayMs, action)
		timers.add(timer)
		return AdmissionCancellation { timer.active = false }
	}
	fun flush() { while (work.isNotEmpty()) work.removeFirst().invoke() }
	fun advance(ms: Long) {
		time += ms
		val due = timers.filter { it.active && it.at <= time }
		for (timer in due) { timer.active = false; work.addLast(timer.action) }
		flush()
	}
}

internal class AdmissionNetworkDouble : AdmissionNetwork {
	class Started(val request: AdmissionHttpRequest, val callback: (AdmissionHttpResponse?) -> Unit) { var cancelled = false }
	val started = mutableListOf<Started>()
	override fun start(request: AdmissionHttpRequest, callback: (AdmissionHttpResponse?) -> Unit): AdmissionCancellation {
		val item = Started(request, callback)
		started.add(item)
		return AdmissionCancellation { item.cancelled = true }
	}
}

class AdmissionEngineTest {
	private val original = "https://tiles.tileflow.test/world/0/0/0.pbf?variant=a%2Fb&x=1"
	private val redirected = "https://tiles.tileflow.test/world/0/0/1.pbf?x=1"
	private val grant = "tf_native_v1.fixture.signature"
	private val mapId = "map_0123456789abcdef"
	private fun tagged(url: String, context: String) = "$url${if (url.contains('?')) '&' else '?'}__tf_native_context=$context"

	private inner class Fixture {
		val scheduler = ManualAdmissionScheduler()
		val network = AdmissionNetworkDouble()
		val events = mutableListOf<Map<String, Any>>()
		val responses = mutableListOf<AdmissionHttpResponse>()
		val delegated = mutableListOf<String>()
		var failures = 0
		var owns = true
		val engine = AdmissionEngine("installation_1", scheduler, network, { owns }, { events.add(it) })
		fun register(direct: Boolean = false) = engine.register(if (direct) null else mapId, listOf(
			AdmissionResource(original, "tile", "world"), AdmissionResource(redirected, "tile", "world")))
		fun request(context: String, url: String = original) = engine.request(tagged(url, context), mapOf("Range" to "bytes=1-8", "If-None-Match" to "version-1"),
			{ responses.add(it) }, { failures++ }, { clean, done ->
				delegated.add(clean)
				done(AdmissionHttpResponse(200, emptyMap(), byteArrayOf()))
				AdmissionCancellation {}
			})
		@Suppress("UNCHECKED_CAST")
		fun tickets(event: Map<String, Any>) = (event["tickets"] as List<Map<String, String>>).map { it.getValue("ticket") }
		fun batch(context: String) = events.last { it["kind"] == "batch" && it["context"] == context }
		fun admit(context: String, budget: Long = 900000, tilesets: List<String> = listOf("world")) {
			val event = batch(context)
			engine.complete(context, 1, event.getValue("batch") as String, tickets(event).map {
				AdmissionResult.Grant(it, budget, AdmissionAuthority(grant, mapId, listOf("https://tiles.tileflow.test"), listOf("tile"), tilesets))
			})
			scheduler.flush()
		}
	}

	@Test fun identicalUrlsAreIsolatedByContextAndEveryTicketHasAnIndependentVerdict() {
		val f = Fixture()
		val first = f.register()
		val second = f.register()
		f.request(first); f.request(second); f.scheduler.flush()
		assertNotEquals(first, second)
		assertEquals(2, f.events.count { it["kind"] == "batch" })
		f.admit(first)
		assertEquals(1, f.network.started.size)
		f.admit(second)
		assertEquals(2, f.network.started.size)
		assertTrue(f.network.started.all { it.request.url == original })
		assertTrue(f.network.started.all { it.request.headers["X-Tileflow-Native-Grant"] == grant })
		assertTrue(f.network.started.all { it.request.headers["Range"] == "bytes=1-8" })
		assertTrue(f.network.started.all { it.request.headers["If-None-Match"] == "version-1" })
		assertFalse(f.events.toString().contains(grant))
	}

	@Test fun batchesAndQueueAreBoundedEvenWhenJavaScriptNeverReplies() {
		val f = Fixture(); val context = f.register()
		repeat(129) { f.request(context) }
		f.scheduler.flush()
		assertEquals(1, f.failures)
		assertEquals(8, f.tickets(f.batch(context)).size)
		assertEquals(1, f.events.count { it["kind"] == "batch" })
		assertEquals(0, f.network.started.size)
		f.scheduler.advance(30000)
		assertTrue(f.events.any { it["kind"] == "retired" })
		f.admit(context)
		assertEquals(0, f.network.started.size)
	}

	@Test fun cancellationAtQueueJsWaitAndPostAdmissionInvalidatesLateCompletion() {
		for (phase in 0..2) {
			val f = Fixture(); val context = f.register()
			val cancellation = f.request(context)
			if (phase == 0) cancellation.cancel()
			f.scheduler.flush()
			if (phase == 1) cancellation.cancel()
			f.scheduler.flush()
			if (phase != 0) f.admit(context)
			if (phase == 2) cancellation.cancel()
			f.scheduler.flush()
			for (request in f.network.started) request.callback(AdmissionHttpResponse(200, emptyMap(), byteArrayOf(1)))
			f.scheduler.flush()
			assertTrue(f.responses.isEmpty())
			assertTrue(f.network.started.all { it.cancelled && !it.request.mayStart() })
		}
	}

	@Test fun directAdmissionUsesThePreviousTransportWithoutAddingAuthority() {
		val f = Fixture(); val context = f.register(true)
		f.request(context); f.scheduler.flush()
		val batch = f.batch(context)
		f.engine.complete(context, 1, batch["batch"] as String, f.tickets(batch).map { AdmissionResult.Delegate(it) })
		f.scheduler.flush()
		assertEquals(listOf(original), f.delegated)
		assertTrue(f.network.started.isEmpty())
	}

	@Test fun expiryIsCheckedAtNetworkStartUsingTheEarlierNativeAnchor() {
		val f = Fixture(); val context = f.register()
		f.request(context); f.scheduler.flush()
		f.scheduler.time = 5000
		f.admit(context, 7000)
		val request = f.network.started.single().request
		assertTrue(request.mayStart())
		f.scheduler.time = 6000
		assertFalse(request.mayStart())
	}

	@Test fun retiredOrReplacedOwnershipNeverStartsOrCompletesProtectedWork() {
		val f = Fixture(); val context = f.register()
		f.request(context); f.scheduler.flush(); f.admit(context)
		f.owns = false
		assertFalse(f.network.started.single().request.mayStart())
		f.network.started.single().callback(AdmissionHttpResponse(200, emptyMap(), byteArrayOf()))
		f.scheduler.flush()
		assertTrue(f.responses.isEmpty())
		assertTrue(f.events.any { it["kind"] == "ownershipLost" })
		f.engine.retire(context); f.engine.retire(context)
		assertFalse(f.network.started.single().request.mayStart())
	}

	@Test fun redirectsRevalidateExactScopeContextOriginAndExpiryWithoutAnotherTicket() {
		for (location in listOf(redirected, "https://outside.test/world/0/0/1.pbf", "https://tiles.tileflow.test/unapproved", tagged(redirected, "retired.9"))) {
			val f = Fixture(); val context = f.register()
			f.request(context); f.scheduler.flush(); f.admit(context)
			f.network.started.single().callback(AdmissionHttpResponse(302, mapOf("location" to location), byteArrayOf()))
			f.scheduler.flush()
			assertEquals(if (location == redirected) 2 else 1, f.network.started.size)
			assertEquals(1, f.events.count { it["kind"] == "batch" })
			assertTrue(f.events.any { it["kind"] == "response" && it["status"] == 302 })
		}
	}

	@Test fun unknownMalformedAndDuplicateDiscriminatorsFailClosed() {
		val f = Fixture(); val context = f.register()
		for (url in listOf(tagged(original, "unknown.1"), "$original&__tf_native_context=", "$original&__tf_native_context=$context&__tf_native_context=$context", "$original&%5f%5ftf_native_context=$context")) {
			f.engine.request(url, emptyMap(), { fail("Unexpected response") }, { f.failures++ }, { _, _ -> fail("Reserved traffic must not delegate"); AdmissionCancellation {} })
		}
		f.scheduler.flush()
		assertEquals(4, f.failures)
		assertTrue(f.network.started.isEmpty())
		assertTrue(f.events.isEmpty())
	}

	@Test fun tilesetMismatchAndLateAdmissionAfterRetirementCannotSend() {
		val f = Fixture(); val context = f.register()
		f.request(context); f.scheduler.flush(); f.admit(context, tilesets = listOf("other"))
		assertTrue(f.network.started.isEmpty())
		f.engine.retire(context)
		f.admit(context)
		assertTrue(f.network.started.isEmpty())
	}

	@Test fun suspensionCancelsAllPhasesAndResumeUsesFreshTickets() {
		val f = Fixture(); val context = f.register()
		f.request(context); f.scheduler.flush(); f.admit(context)
		f.engine.lifecycle(false); f.scheduler.flush()
		assertTrue(f.network.started.single().cancelled)
		assertFalse(f.network.started.single().request.mayStart())
		f.scheduler.time += 900000
		f.engine.lifecycle(true)
		f.request(context); f.scheduler.flush(); f.admit(context)
		assertEquals(2, f.network.started.size)
		assertTrue(f.network.started.last().request.mayStart())
	}
}
