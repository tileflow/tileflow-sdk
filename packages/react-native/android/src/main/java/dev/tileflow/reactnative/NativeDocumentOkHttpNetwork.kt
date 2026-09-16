package dev.tileflow.reactnative

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Authenticator
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

internal fun readNativeDocumentBody(source: InputStream, maximumBytes: Int, declared: Long, active: () -> Boolean): ByteArray {
	if (maximumBytes !in 1..8388608 || declared > maximumBytes) throw IOException("Native document acquisition failed.")
	val output = ByteArrayOutputStream(minOf(maximumBytes, 8192))
	val buffer = ByteArray(8192)
	while (true) {
		if (!active()) throw IOException("Native document acquisition failed.")
		val count = source.read(buffer, 0, minOf(buffer.size, maximumBytes - output.size() + 1))
		if (count < 0) return output.toByteArray()
		if (count == 0 || output.size() + count > maximumBytes) throw IOException("Native document acquisition failed.")
		output.write(buffer, 0, count)
	}
}

/** Initial manifests and unprotected preparation never use the MapLibre session or application credential. */
internal class NativeDocumentOkHttpNetwork {
	private class Guard(val active: () -> Boolean)
	private val dispatcher = Dispatcher().apply { maxRequests = 4; maxRequestsPerHost = 4 }
	private val client = OkHttpClient.Builder()
		.dispatcher(dispatcher)
		.cookieJar(CookieJar.NO_COOKIES)
		.authenticator(Authenticator.NONE)
		.proxyAuthenticator(Authenticator.NONE)
		.cache(null)
		.followRedirects(false)
		.followSslRedirects(false)
		.callTimeout(30, TimeUnit.SECONDS)
		.addInterceptor { chain ->
			if (chain.request().tag(Guard::class.java)?.active?.invoke() != true) throw IOException("Native document acquisition failed.")
			chain.proceed(chain.request())
		}
		.build()

	fun start(url: String, maximumBytes: Int, active: () -> Boolean, completion: (AdmissionHttpResponse?) -> Unit): AdmissionCancellation {
		val live = AtomicBoolean(true)
		val completed = AtomicBoolean(false)
		var redirects = 0
		var call: Call? = null
		val guard = { live.get() && active() }
		fun finish(response: AdmissionHttpResponse?) {
			if (completed.compareAndSet(false, true)) completion(response)
		}
		fun issue(target: String) {
			if (!guard()) { finish(null); return }
			try {
				AdmissionUrl.clean(target)
				val next = client.newCall(Request.Builder().url(target).get().tag(Guard::class.java, Guard(guard)).build())
				call = next
				next.enqueue(object : Callback {
					override fun onFailure(call: Call, error: IOException) { finish(null) }
					override fun onResponse(call: Call, response: Response) {
						try {
							var redirect: String? = null
							val received = response.use { reply ->
								if (!guard()) throw IOException("Native document acquisition failed.")
								if (reply.code in listOf(301, 302, 303, 307, 308)) {
									if (++redirects > 3) throw IOException("Native document acquisition failed.")
									redirect = AdmissionUrl.redirect(target, reply.header("Location") ?: "", "")
									null
								} else {
									val body = reply.body ?: throw IOException("Native document acquisition failed.")
									val bytes = readNativeDocumentBody(body.byteStream(), maximumBytes, body.contentLength(), guard)
									AdmissionHttpResponse(reply.code, emptyMap(), bytes, target)
								}
							}
							if (redirect != null) issue(redirect!!) else finish(received)
						} catch (_: Exception) { finish(null) }
					}
				})
				if (!guard()) next.cancel()
			} catch (_: Exception) { finish(null) }
		}
		issue(url)
		return AdmissionCancellation {
			live.set(false)
			call?.cancel()
			// OkHttp's callback is the physical terminal acknowledgement.
		}
	}

	fun close() { dispatcher.cancelAll() }
}
