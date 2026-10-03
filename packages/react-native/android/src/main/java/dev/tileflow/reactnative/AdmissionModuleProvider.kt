package dev.tileflow.reactnative

import java.util.concurrent.atomic.AtomicBoolean
import org.maplibre.android.LibraryLoaderProvider
import org.maplibre.android.ModuleProvider
import org.maplibre.android.http.HttpRequest
import org.maplibre.android.http.HttpResponder

internal class AdmissionModuleProvider(
	private val previous: ModuleProvider,
	private val engine: AdmissionEngine,
) : ModuleProvider {
	override fun createLibraryLoaderProvider(): LibraryLoaderProvider = previous.createLibraryLoaderProvider()
	override fun createHttpRequest(): HttpRequest = Request(previous.createHttpRequest(), engine)

	private class Request(private val previous: HttpRequest, private val engine: AdmissionEngine) : HttpRequest {
		private val cancelled = AtomicBoolean(false)
		private val used = AtomicBoolean(false)
		@Volatile private var delegated = false
		@Volatile private var cancellation: AdmissionCancellation? = null

		override fun executeRequest(responder: HttpResponder, nativePtr: Long, resourceUrl: String, dataRange: String, etag: String, modified: String, offlineUsage: Boolean) {
			if (cancelled.get()) return
			if (!used.compareAndSet(false, true)) {
				responder.handleFailure(HttpRequest.PERMANENT_ERROR, "Native request was already started")
				return
			}
			if (!AdmissionUrl.reserved(resourceUrl)) {
				// Unowned traffic does not pass through our queue or header code.
				delegated = true
				previous.executeRequest(responder, nativePtr, resourceUrl, dataRange, etag, modified, offlineUsage)
				if (cancelled.get()) previous.cancelRequest()
				return
			}
			val headers = linkedMapOf<String, String>()
			if (dataRange.isNotEmpty()) headers["Range"] = dataRange
			if (etag.isNotEmpty()) headers["If-None-Match"] = etag
			else if (modified.isNotEmpty()) headers["If-Modified-Since"] = modified
			cancellation = engine.request(resourceUrl, headers,
				{ response ->
					if (!cancelled.get()) responder.onResponse(response.code,
						response.headers["etag"], response.headers["last-modified"], response.headers["cache-control"],
						response.headers["expires"], response.headers["retry-after"], response.headers["x-rate-limit-reset"], response.body)
				},
				{ if (!cancelled.get()) responder.handleFailure(HttpRequest.TEMPORARY_ERROR, "Native resource admission failed") },
				{ clean, done ->
					previous.executeRequest(object : HttpResponder {
						override fun onResponse(responseCode: Int, eTag: String?, lastModified: String?, cacheControl: String?, expires: String?, retryAfter: String?, xRateLimitReset: String?, body: ByteArray?) {
							val metadata = linkedMapOf<String, String>()
							for ((name, value) in listOf("etag" to eTag, "last-modified" to lastModified, "cache-control" to cacheControl, "expires" to expires, "retry-after" to retryAfter, "x-rate-limit-reset" to xRateLimitReset)) {
								if (value != null) metadata[name] = value
							}
							done(AdmissionHttpResponse(responseCode, metadata, body ?: byteArrayOf()))
						}
						override fun handleFailure(type: Int, errorMessage: String?) { done(null) }
					}, nativePtr, clean, dataRange, etag, modified, offlineUsage)
					AdmissionCancellation { previous.cancelRequest() }
				})
			if (cancelled.get()) cancellation?.cancel()
		}

		override fun cancelRequest() {
			cancelled.set(true)
			cancellation?.cancel()
			if (delegated) previous.cancelRequest()
		}
	}
}
