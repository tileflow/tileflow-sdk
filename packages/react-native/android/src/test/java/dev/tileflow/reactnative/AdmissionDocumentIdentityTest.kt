package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class AdmissionDocumentIdentityTest {
	@Suppress("UNCHECKED_CAST")
	@Test fun redirectedDocumentReportsItsOwnResolutionBase() {
		val scheduler = ManualAdmissionScheduler()
		val network = AdmissionNetworkDouble()
		val events = mutableListOf<Map<String, Any>>()
		val engine = AdmissionEngine("installation", scheduler, network, { true }, { events.add(it) })
		val first = "https://api.example.test/maps/map_0123456789abcdef/style.json"
		val second = "https://api.example.test/maps/map_0123456789abcdef/light.json"
		val context = engine.register("map_0123456789abcdef", listOf(
			AdmissionResource(first, "style", null), AdmissionResource(second, "style", null)))
		var received: AdmissionHttpResponse? = null
		engine.request("$first?__tf_native_context=$context", emptyMap(), { received = it }, { fail("Unexpected document failure.") }, { _, _ -> error("Unexpected delegation.") })
		scheduler.flush()
		val batch = events.single { it["kind"] == "batch" }
		val ticket = (batch["tickets"] as List<Map<String, String>>).single().getValue("ticket")
		engine.complete(context, 1, batch["batch"] as String, listOf(AdmissionResult.Grant(ticket, 900000,
			AdmissionAuthority("tf_native_v1." + "fixture.signature", "map_0123456789abcdef", listOf("https://api.example.test"), listOf("style"), emptyList()))))
		network.started[0].callback(AdmissionHttpResponse(302, mapOf("Location" to second), byteArrayOf()))
		scheduler.flush()
		network.started[1].callback(AdmissionHttpResponse(200, emptyMap(), "{}".toByteArray()))
		scheduler.flush()
		assertEquals(second, received?.url)
		assertFalse(received.toString().contains("example.test"))
		assertFalse(events.toString().contains("fixture.signature"))
	}
}
