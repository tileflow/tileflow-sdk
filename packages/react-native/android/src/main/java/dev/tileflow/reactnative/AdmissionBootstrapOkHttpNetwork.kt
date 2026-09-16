package dev.tileflow.reactnative

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response

internal class AdmissionBootstrapOkHttpNetwork : AdmissionBootstrapNetwork {
	private class Guard(val mayStart: () -> Boolean) {
		override fun toString() = "NativeBootstrapGuard(redacted)"
	}
	private val lock = Any()
	private val calls = mutableSetOf<Call>()
	private var closed = false
	private val dispatcher = Dispatcher().apply { maxRequests = 4; maxRequestsPerHost = 4 }
	// Deliberately independent of both MapLibre and protected-resource HTTP.
	// Defaults use no cookie jar, cache, authenticator, or application logger.
	private val client = OkHttpClient.Builder()
		.dispatcher(dispatcher)
		.followRedirects(false).followSslRedirects(false)
		.retryOnConnectionFailure(false).cache(null)
		.connectTimeout(10, TimeUnit.SECONDS)
		.callTimeout(AdmissionBootstrapLimits.TIMEOUT_MS, TimeUnit.MILLISECONDS)
		.addNetworkInterceptor { chain ->
			if (chain.request().tag(Guard::class.java)?.mayStart?.invoke() != true) throw IOException("Native bootstrap is cancelled")
			chain.proceed(chain.request())
		}.build()

	override fun start(request: AdmissionBootstrapRequest, completion: (AdmissionBootstrapReply?) -> Unit): AdmissionCancellation {
		if (!request.mayStart()) { completion(null); return AdmissionCancellation {} }
		val call = client.newCall(Request.Builder().url(request.url)
			.post(request.body.toRequestBody("application/json".toMediaType()))
			.header("X-Tileflow-Mobile-Client", request.credential)
			.header("Cache-Control", "no-store")
			.tag(Guard::class.java, Guard(request.mayStart)).build())
		val accepted = synchronized(lock) {
			if (closed || calls.size >= AdmissionBootstrapLimits.QUEUE) false else { calls.add(call); true }
		}
		if (!accepted) { completion(null); return AdmissionCancellation {} }
		fun complete(reply: AdmissionBootstrapReply?) {
			synchronized(lock) { calls.remove(call) }
			completion(reply)
		}
		try {
			call.enqueue(object : Callback {
				override fun onFailure(call: Call, error: IOException) { complete(null) }
				override fun onResponse(call: Call, response: Response) {
					val reply = try {
						response.use {
							val cacheControl = it.header("cache-control") ?: ""
							val body = it.body
							if (cacheControl.length > 1024 || body == null || body.contentLength() > AdmissionBootstrapLimits.RESPONSE_BYTES) throw IOException("Invalid bootstrap response")
							val bytes = ByteArrayOutputStream()
							body.byteStream().use { stream ->
								val buffer = ByteArray(4096)
								while (true) {
									val count = stream.read(buffer)
									if (count < 0) break
									if (!request.mayStart() || count > AdmissionBootstrapLimits.RESPONSE_BYTES - bytes.size()) throw IOException("Invalid bootstrap response")
									bytes.write(buffer, 0, count)
								}
							}
							AdmissionBootstrapReply(it.code, cacheControl, bytes.toByteArray())
						}
					} catch (_: Exception) { null }
					complete(reply)
				}
			})
		} catch (_: Exception) { call.cancel(); complete(null) }
		// Retain the capacity reservation until OkHttp's terminal callback.
		// Repeated cancellation cannot grow its dispatcher queue without bound.
		return AdmissionCancellation { call.cancel() }
	}

	fun close() {
		val pending = synchronized(lock) { closed = true; calls.toList() }
		for (call in pending) call.cancel()
		client.connectionPool.evictAll()
		dispatcher.executorService.shutdown()
	}
	override fun toString() = "AdmissionBootstrapOkHttpNetwork(redacted)"
}
