package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class AdmissionIngressTest {
	@Test fun ingressIsBoundedBeforeTheMainSchedulerCanDrainAndCancellationDoesNotBypassIt() {
		val scheduler = ManualAdmissionScheduler()
		val network = AdmissionNetworkDouble()
		val events = mutableListOf<Map<String, Any>>()
		val engine = AdmissionEngine("installation_1", scheduler, network, { true }, { events.add(it) })
		val url = "https://tiles.tileflow.test/world/0/0/0.pbf"
		val context = engine.register("map_0123456789abcdef", listOf(AdmissionResource(url, "tile", "world")))
		var failed = 0
		fun request() = engine.request("$url?__tf_native_context=$context", emptyMap(), {}, { failed++ }, { _, _ -> AdmissionCancellation {} })
		repeat(2048) {
			val token = request()
			token.cancel(); token.cancel()
		}
		request()
		assertEquals(1, failed)
		assertTrue(events.isEmpty())
		assertTrue(network.started.isEmpty())
		scheduler.flush()
		assertEquals(1, failed)
		request(); scheduler.flush()
		assertEquals(1, events.count { it["kind"] == "batch" })
		engine.retire(context); scheduler.flush()
	}
}
