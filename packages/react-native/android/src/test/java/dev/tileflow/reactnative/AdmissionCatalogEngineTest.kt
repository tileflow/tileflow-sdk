package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class AdmissionCatalogEngineTest {
	private val mapId = "map_0123456789abcdef"
	private val origin = "https://tiles.example.test"
	private val template = AdmissionResource("$origin/world/{z}/{x}/{y}.pbf", "tile", "world", "tile")

	@Suppress("UNCHECKED_CAST")
	@Test fun extensionsAreAtomicIdempotentAndDoNotReplaceTheContext() {
		val scheduler = ManualAdmissionScheduler()
		val network = AdmissionNetworkDouble()
		val events = mutableListOf<Map<String, Any>>()
		val engine = AdmissionEngine("installation", scheduler, network, { true }, { events.add(it) })
		val context = engine.register(mapId, emptyList())
		assertEquals(1, engine.extend(context, listOf(template)))
		assertEquals(1, engine.extend(context, listOf(template)))
		try { engine.extend(context, listOf(AdmissionResource(template.url, "tile", "other", "tile"))); fail("Expected identity conflict.") }
		catch (_: IllegalArgumentException) { }
		val url = "$origin/world/2/3/1.pbf"
		var failures = 0
		engine.request("$url?__tf_native_context=$context", emptyMap(), {}, { failures++ }, { _, _ -> error("Protected request delegated.") })
		scheduler.flush()
		val batch = events.single { it["kind"] == "batch" }
		val tickets = batch["tickets"] as List<Map<String, String>>
		assertEquals(listOf(url), tickets.map { it["url"] })
		val authority = AdmissionAuthority("tf_native_v1." + "fixture.signature", mapId, listOf(origin), listOf("tile"), listOf("world"))
		assertEquals(1, engine.complete(context, 1, batch["batch"] as String, tickets.map { AdmissionResult.Grant(it.getValue("ticket"), 900000, authority) }))
		assertEquals(url, network.started.single().request.url)
		assertEquals(0, failures)
		assertTrue(network.started.single().request.mayStart())
		engine.retire(context)
		assertFalse(network.started.single().request.mayStart())
		try { engine.extend(context, listOf(template)); fail("Expected retired context rejection.") }
		catch (_: IllegalArgumentException) { }
	}

	@Test fun unknownAndOutOfRangeExpansionsNeverBecomeThirdPartyTraffic() {
		val scheduler = ManualAdmissionScheduler()
		val engine = AdmissionEngine("installation", scheduler, AdmissionNetworkDouble(), { true }, {})
		val context = engine.register(mapId, listOf(template))
		var failures = 0
		var delegated = 0
		for (url in listOf("$origin/world/1/2/0.pbf", "$origin/other/1/1/0.pbf")) {
			engine.request("$url?__tf_native_context=$context", emptyMap(), {}, { failures++ }, { _, _ -> delegated++; AdmissionCancellation {} })
		}
		scheduler.flush()
		assertEquals(2, failures)
		assertEquals(0, delegated)
	}
}
