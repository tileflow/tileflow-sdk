package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class AdmissionDocumentBoundsTest {
	@Suppress("UNCHECKED_CAST")
	@Test fun aDocumentBudgetReachesEveryNativeStartWithoutBecomingAHeader() {
		val scheduler = ManualAdmissionScheduler()
		val network = AdmissionNetworkDouble()
		val events = mutableListOf<Map<String, Any>>()
		val engine = AdmissionEngine("installation", scheduler, network, { true }, { events.add(it) })
		val mapId = "map_0123456789abcdef"
		val url = "https://api.example.test/maps/$mapId/style.json"
		val redirected = "https://api.example.test/maps/$mapId/light.json"
		val context = engine.register(mapId, listOf(AdmissionResource(url, "style", null), AdmissionResource(redirected, "style", null)))
		var failures = 0
		engine.requestDocument("$url?__tf_native_context=$context", 1024, {}, { failures++ })
		scheduler.flush()
		val batch = events.single { it["kind"] == "batch" }
		val ticket = (batch["tickets"] as List<Map<String, String>>).single().getValue("ticket")
		engine.complete(context, 1, batch["batch"] as String, listOf(AdmissionResult.Grant(ticket, 900000,
			AdmissionAuthority("tf_native_v1." + "fixture.signature", mapId, listOf("https://api.example.test"), listOf("style"), emptyList()))))
		assertEquals(1024, network.started.single().request.maximumBytes)
		assertEquals(setOf(AdmissionLimits.GRANT_HEADER), network.started.single().request.headers.keys)
		network.started[0].callback(AdmissionHttpResponse(302, mapOf("location" to redirected), byteArrayOf()))
		scheduler.flush()
		assertEquals(1024, network.started[1].request.maximumBytes)
		network.started[1].callback(AdmissionHttpResponse(200, emptyMap(), ByteArray(1025)))
		scheduler.flush()
		assertEquals(1, failures)
	}
}
