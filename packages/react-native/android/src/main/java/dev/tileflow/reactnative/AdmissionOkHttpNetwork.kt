package dev.tileflow.reactnative

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

internal class AdmissionOkHttpNetwork : AdmissionNetwork {
	private class StartGuard(val allowed: () -> Boolean) {
		override fun toString() = "NativeAdmissionStartGuard"
	}
	private val dispatcher = Dispatcher().apply { maxRequests = 16; maxRequestsPerHost = 8 }
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
		call.enqueue(object : Callback {
			override fun onFailure(call: Call, e: IOException) { callback(null) }
			override fun onResponse(call: Call, response: Response) {
				val result = try {
					response.use {
						val body = it.body
						if (body != null && body.contentLength() > AdmissionLimits.RESPONSE_BYTES) throw IOException("Native resource exceeded its size limit")
						val bytes = ByteArrayOutputStream()
						body?.byteStream()?.use { stream ->
							val buffer = ByteArray(8192)
							while (true) {
								val count = stream.read(buffer)
								if (count < 0) break
								if (bytes.size().toLong() + count > AdmissionLimits.RESPONSE_BYTES) throw IOException("Native resource exceeded its size limit")
								bytes.write(buffer, 0, count)
							}
						}
						// Forward only response metadata consumed by MapLibre plus
						// Location for our own redirect validation, not raw headers.
						val headers = linkedMapOf<String, String>()
						for (name in listOf("etag", "last-modified", "cache-control", "expires", "retry-after", "x-rate-limit-reset", "location")) {
							it.header(name)?.let { value -> headers[name] = value }
						}
						AdmissionHttpResponse(it.code, headers, bytes.toByteArray())
					}
				} catch (_: Exception) { null }
				callback(result)
			}
		})
		return AdmissionCancellation { call.cancel() }
	}

	fun close() {
		dispatcher.cancelAll()
		client.connectionPool.evictAll()
		dispatcher.executorService.shutdown()
	}
}
