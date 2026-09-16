package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

internal class BootstrapNetworkDouble : AdmissionBootstrapNetwork {
	class Pending(val request: AdmissionBootstrapRequest, val complete: (AdmissionBootstrapReply?) -> Unit) {
		var cancelled = false
	}
	val pending = mutableListOf<Pending>()
	override fun start(request: AdmissionBootstrapRequest, completion: (AdmissionBootstrapReply?) -> Unit): AdmissionCancellation {
		val item = Pending(request, completion)
		pending.add(item)
		return AdmissionCancellation { item.cancelled = true }
	}
}

class AdmissionBootstrapTest {
	private val credential = "tf_public_" + "a".repeat(48)
	private val mapId = "map_0123456789abcdef"
	private val endpoint = "https://api.tileflow.test/v1/sessions/start"
	private val body = "{\"mapId\":\"$mapId\",\"sessionId\":\"ses_fixture_1\",\"surfaceId\":\"default\"}"
	private val reply = AdmissionBootstrapReply(201, "no-store", byteArrayOf(123, 125))

	private inner class Fixture {
		val scheduler = ManualAdmissionScheduler()
		val network = BootstrapNetworkDouble()
		var owns = true
		val bootstrap = AdmissionBootstrap("installation_1", scheduler, network) { owns }
		val replies = mutableListOf<AdmissionBootstrapReply?>()
		init {
			bootstrap.register("installation_1.1", mapId)
			bootstrap.register("installation_1.2", mapId)
		}
		fun start(sequence: Int, context: String = "installation_1.1", url: String = endpoint, token: String = credential, payload: String = body) {
			bootstrap.start(context, "installation_1.$sequence", url, token, payload) { replies.add(it) }
		}
	}

	@Test fun independentBootstrapIsBoundToContextAndExactEndpoint() {
		val f = Fixture()
		f.start(1); f.start(2, "installation_1.2")
		assertEquals(2, f.network.pending.size)
		assertEquals(endpoint, f.network.pending[0].request.url)
		assertEquals(body, f.network.pending[0].request.body)
		assertEquals(credential, f.network.pending[0].request.credential)
		f.bootstrap.retire("installation_1.1")
		assertTrue(f.network.pending[0].cancelled)
		assertFalse(f.network.pending[0].request.mayStart())
		assertTrue(f.network.pending[1].request.mayStart())
		f.network.pending[0].complete(reply)
		f.network.pending[1].complete(reply)
		f.scheduler.flush()
		assertEquals(2, f.replies.size)
		assertNull(f.replies[0])
		assertSame(reply, f.replies[1])
		assertFalse(f.bootstrap.toString().contains(credential))
		assertFalse(f.network.pending[1].request.toString().contains(credential))
	}

	@Test fun cancelBeforeDispatchAndAfterStartCannotDeliverLateBytesOrReplayIds() {
		val f = Fixture()
		f.bootstrap.cancel("installation_1.1", "installation_1.1")
		assertThrows(IllegalArgumentException::class.java) { f.start(1) }
		assertTrue(f.network.pending.isEmpty())
		f.start(2)
		f.bootstrap.cancel("installation_1.1", "installation_1.2")
		f.bootstrap.cancel("installation_1.1", "installation_1.2")
		f.network.pending.single().complete(reply)
		f.scheduler.flush()
		assertEquals(1, f.replies.size)
		assertNull(f.replies.single())
		assertThrows(IllegalArgumentException::class.java) { f.start(2) }
		assertThrows(IllegalArgumentException::class.java) { f.start(3, "unknown.1") }
	}

	@Test fun exactMapBodyOriginPortCredentialAndPayloadBoundsAreEnforced() {
		val f = Fixture()
		f.start(1)
		for (url in listOf("http://api.tileflow.test/v1/sessions/start", "$endpoint?x=1", "$endpoint/", "https://api.tileflow.test:444/v1/sessions/start", "https://other.test/v1/sessions/start")) {
			assertThrows(IllegalArgumentException::class.java) { f.start(2, url = url) }
		}
		for (payload in listOf(body.replace(mapId, "map_fedcba9876543210"), " ".repeat(2049), body.replace("default", "tf_native_v1"), body.dropLast(1) + ",\"mapId\":\"$mapId\"}")) {
			assertThrows(IllegalArgumentException::class.java) { f.start(2, payload = payload) }
		}
		assertThrows(IllegalArgumentException::class.java) { f.start(2, token = "tf_public_" + "b".repeat(48)) }
		assertEquals(1, f.network.pending.size)
	}

	@Test fun queueDepthIsBoundedAndCancellationReleasesCapacity() {
		val f = Fixture()
		for (sequence in 1..32) f.start(sequence)
		assertThrows(IllegalArgumentException::class.java) { f.start(33) }
		f.bootstrap.cancel("installation_1.1", "installation_1.1")
		f.start(34)
		assertEquals(33, f.network.pending.size)
		f.bootstrap.close(); f.bootstrap.close()
		assertTrue(f.network.pending.all { it.cancelled && !it.request.mayStart() })
		assertEquals(33, f.replies.size)
		assertTrue(f.replies.all { it == null })
	}

	@Test fun expiryResumeOwnershipAndRetirementInvalidateNetworkStartWithoutTimers() {
		for (mode in 0..3) {
			val f = Fixture(); f.start(1)
			when (mode) {
				0 -> f.scheduler.time = 30000
				1 -> f.bootstrap.lifecycle(false)
				2 -> f.owns = false
				3 -> f.bootstrap.retire("installation_1.1")
			}
			assertFalse(f.network.pending.single().request.mayStart())
			f.network.pending.single().complete(reply)
			f.scheduler.flush()
			assertEquals(1, f.replies.size)
			assertNull(f.replies.single())
		}
		val f = Fixture(); f.start(1)
		f.bootstrap.lifecycle(false); f.bootstrap.lifecycle(true)
		assertFalse(f.network.pending[0].request.mayStart())
		f.start(2)
		assertTrue(f.network.pending[1].request.mayStart())
	}

	@Test fun oversizedResponsesAndCallbacksAfterTimeoutFailWithoutLeakingBody() {
		for (bad in listOf(AdmissionBootstrapReply(201, "x".repeat(1025), byteArrayOf()), AdmissionBootstrapReply(201, "no-store", ByteArray(65537)), AdmissionBootstrapReply(600, "no-store", byteArrayOf()))) {
			val f = Fixture(); f.start(1)
			f.network.pending.single().complete(bad); f.scheduler.flush()
			assertNull(f.replies.single())
		}
		val f = Fixture(); f.start(1); f.scheduler.advance(30000)
		f.network.pending.single().complete(reply); f.scheduler.flush()
		assertEquals(1, f.replies.size)
		assertNull(f.replies.single())
	}
}
