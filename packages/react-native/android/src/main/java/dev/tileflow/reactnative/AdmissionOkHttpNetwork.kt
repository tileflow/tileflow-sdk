package dev.tileflow.reactnative

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

internal class AdmissionOkHttpNetwork(private val dispatcher: Dispatcher = Dispatcher()) : AdmissionNetwork {
	private class StartGuard(val allowed: () -> Boolean) {
		override fun toString() = "NativeAdmissionStartGuard"
	}
	private val lock = Any()
	private val calls = mutableSetOf<Call>()
	private var closed = false
	init { dispatcher.maxRequests = 16; dispatcher.maxRequestsPerHost = 8 }
	// This client is independent of MapLibre's global HTTP client and of the
	// bootstrap channel. Never add a logging interceptor or shared cookie jar.
	private val client = OkHttpClient.Builder()
		.dispatcher(dispatcher)
		.followRedirects(false)
		.followSslRedirects(false)
		.retryOnConnectionFailure(false)
		.cache(null)
		.connectTimeout(10, TimeUnit.SECONDS)
		.callTimeout(30, TimeUnit.SECONDS)
		.addNetworkInterceptor { chain ->
			val guard = chain.request().tag(StartGuard::class.java)
			if (guard == null || !guard.allowed()) throw IOException("Native admission is no longer valid")
			// This is a nonblocking liveness/expiry check, never a JavaScript wait.
			chain.proceed(chain.request())
		}
		.build()

	override fun start(request: AdmissionHttpRequest, callback: (AdmissionHttpResponse?) -> Unit): AdmissionCancellation {
		if (!request.mayStart()) { callback(null); return AdmissionCancellation {} }
		val builder = Request.Builder().url(request.url).get().tag(StartGuard::class.java, StartGuard(request.mayStart))
		for ((name, value) in request.headers) builder.header(name, value)
		val call = client.newCall(builder.build())
		val accepted = synchronized(lock) {
			if (closed || calls.size >= AdmissionLimits.CONTEXTS * AdmissionLimits.QUEUE) false
			else { calls.add(call); true }
		}
		if (!accepted) { callback(null); return AdmissionCancellation {} }
		fun complete(response: AdmissionHttpResponse?) {
			synchronized(lock) { calls.remove(call) }
			callback(response)
		}
		try {
			call.enqueue(object : Callback {
				override fun onFailure(call: Call, e: IOException) { complete(null) }
				override fun onResponse(call: Call, response: Response) {
					val result = try {
						response.use {
							val body = it.body
							val bytes = body?.byteStream()?.use { stream ->
								readNativeDocumentBody(stream, request.maximumBytes, body.contentLength(), request.mayStart)
							} ?: byteArrayOf()
							// Forward only metadata consumed by MapLibre and Location
							// for our own redirect validation, never raw headers.
							val headers = linkedMapOf<String, String>()
							for (name in listOf("etag", "last-modified", "cache-control", "expires", "retry-after", "x-rate-limit-reset", "location")) {
								it.header(name)?.let { value -> headers[name] = value }
							}
							AdmissionHttpResponse(it.code, headers, bytes)
						}
					} catch (_: Exception) { null }
					complete(result)
				}
			})
		} catch (_: Exception) { call.cancel(); complete(null) }
		// Logical cancellation does not release the physical dispatcher slot.
		// Its terminal callback does, so rapid retire/register cannot grow it.
		return AdmissionCancellation { call.cancel() }
	}

	fun close() {
		val pending = synchronized(lock) { closed = true; calls.toList() }
		for (call in pending) call.cancel()
		client.connectionPool.evictAll()
		dispatcher.executorService.shutdown()
	}
}
