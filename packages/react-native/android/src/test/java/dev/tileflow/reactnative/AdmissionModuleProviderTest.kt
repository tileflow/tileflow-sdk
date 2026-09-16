package dev.tileflow.reactnative

import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test
import org.maplibre.android.LibraryLoaderProvider
import org.maplibre.android.ModuleProvider
import org.maplibre.android.http.HttpRequest
import org.maplibre.android.http.HttpResponder

class AdmissionModuleProviderTest {
	private class Responder : HttpResponder {
		var responses = 0
		var failures = 0
		override fun onResponse(responseCode: Int, eTag: String?, lastModified: String?, cacheControl: String?, expires: String?, retryAfter: String?, xRateLimitReset: String?, body: ByteArray?) { responses++ }
		override fun handleFailure(type: Int, errorMessage: String?) { failures++ }
	}
	private class Previous : ModuleProvider {
		val requests = mutableListOf<List<Any>>()
		var cancellations = 0
		var loaders = 0
		val loader = Proxy.newProxyInstance(LibraryLoaderProvider::class.java.classLoader, arrayOf(LibraryLoaderProvider::class.java)) { _, _, _ -> null } as LibraryLoaderProvider
		override fun createLibraryLoaderProvider(): LibraryLoaderProvider { loaders++; return loader }
		override fun createHttpRequest(): HttpRequest = object : HttpRequest {
			override fun executeRequest(responder: HttpResponder, nativePtr: Long, resourceUrl: String, dataRange: String, etag: String, modified: String, offlineUsage: Boolean) {
				requests.add(listOf(responder, nativePtr, resourceUrl, dataRange, etag, modified, offlineUsage))
			}
			override fun cancelRequest() { cancellations++ }
		}
	}

	@Test fun unownedRequestsAndLibraryLoadingDelegateWithoutRewritingAnyArgument() {
		val scheduler = ManualAdmissionScheduler()
		val network = AdmissionNetworkDouble()
		val events = mutableListOf<Map<String, Any>>()
		val previous = Previous()
		val engine = AdmissionEngine("installation_1", scheduler, network, { true }, { events.add(it) })
		val provider = AdmissionModuleProvider(previous, engine)
		assertSame(previous.loader, provider.createLibraryLoaderProvider())
		assertEquals(1, previous.loaders)
		val responder = Responder()
		val request = provider.createHttpRequest()
		val url = "https://outside.test/image.png?x=%2F&x=2"
		request.executeRequest(responder, 42, url, "bytes=3-9", "etag-1", "modified-1", true)
		assertEquals(listOf(responder, 42L, url, "bytes=3-9", "etag-1", "modified-1", true), previous.requests.single())
		request.cancelRequest()
		assertEquals(1, previous.cancellations)
		scheduler.flush()
		assertTrue(events.isEmpty())
		assertTrue(network.started.isEmpty())
	}

	@Test fun twoOwnedContextsAndAThirdPartyRequestShareOnlyThePreviousProviderNotAuthority() {
		val scheduler = ManualAdmissionScheduler()
		val network = AdmissionNetworkDouble()
		val events = mutableListOf<Map<String, Any>>()
		val previous = Previous()
		val engine = AdmissionEngine("installation_1", scheduler, network, { true }, { events.add(it) })
		val provider = AdmissionModuleProvider(previous, engine)
		val url = "https://tiles.tileflow.test/world/0/0/0.pbf?x=1"
		val resources = listOf(AdmissionResource(url, "tile", "world"))
		val contexts = listOf(engine.register("map_0123456789abcdef", resources), engine.register("map_0123456789abcdef", resources))
		val responders = contexts.map { Responder() }
		for ((index, context) in contexts.withIndex()) {
			provider.createHttpRequest().executeRequest(responders[index], index.toLong(), "$url&__tf_native_context=$context", "bytes=1-8", "etag-1", "ignored-modified", false)
		}
		provider.createHttpRequest().executeRequest(Responder(), 3, "https://outside.test/image.png", "", "", "", false)
		scheduler.flush()
		assertEquals(1, previous.requests.size)
		assertEquals(2, events.count { it["kind"] == "batch" })
		for (event in events.filter { it["kind"] == "batch" }) {
			@Suppress("UNCHECKED_CAST") val tickets = event["tickets"] as List<Map<String, String>>
			engine.complete(event["context"] as String, 1, event["batch"] as String, tickets.map {
				AdmissionResult.Grant(it.getValue("ticket"), 900000, AdmissionAuthority("tf_native_v1.fixture.signature", "map_0123456789abcdef", listOf("https://tiles.tileflow.test"), listOf("tile"), listOf("world")))
			})
		}
		scheduler.flush()
		assertEquals(2, network.started.size)
		for (item in network.started) {
			assertEquals(url, item.request.url)
			assertEquals(setOf("Range", "If-None-Match", "X-Tileflow-Native-Grant"), item.request.headers.keys)
			assertFalse(item.request.toString().contains("tf_native_v1"))
		}
		engine.retire(contexts[0])
		for (item in network.started) item.callback(AdmissionHttpResponse(200, emptyMap(), byteArrayOf()))
		scheduler.flush()
		assertEquals(0, responders[0].responses)
		assertEquals(1, responders[1].responses)
	}
}
