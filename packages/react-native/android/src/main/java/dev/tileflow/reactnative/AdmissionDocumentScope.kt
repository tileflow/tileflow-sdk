package dev.tileflow.reactnative

import java.util.concurrent.atomic.AtomicBoolean

internal fun createAdmissionDocumentScope(admission: AdmissionEngine, context: String, maximumBytes: Int): NativeDocumentScope {
	if (maximumBytes !in 1..8388608) throw IllegalArgumentException("Native document acquisition failed.")
	val active = admission.contextGuard(context)
	return NativeDocumentScope(active, { url, completion ->
		AdmissionUrl.clean(url)
		val completed = AtomicBoolean(false)
		val finish: (AdmissionHttpResponse?) -> Unit = { response ->
			if (completed.compareAndSet(false, true)) completion(response)
		}
		val tagged = "$url${if (url.contains('?')) '&' else '?'}__tf_native_context=$context"
		val request = admission.requestDocument(tagged, maximumBytes, { finish(it) }, { finish(null) })
		AdmissionCancellation {
			request.cancel()
			// The admission transport independently retains its physical network slot.
			finish(null)
		}
	}, context)
}
