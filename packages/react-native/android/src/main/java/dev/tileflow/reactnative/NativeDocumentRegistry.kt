package dev.tileflow.reactnative

import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

internal class NativeDocumentScope(
	val isActive: () -> Boolean,
	val load: (String, (AdmissionHttpResponse?) -> Unit) -> AdmissionCancellation,
	val context: String? = null,
) {
	override fun toString() = "NativeDocumentScope(redacted)"
}
internal class NativeDocumentHeader(val url: String, val status: Int) {
	override fun toString() = "NativeDocumentHeader(redacted)"
}
internal class NativeDocumentChunk(val bytes: ByteArray, val last: Boolean) {
	override fun toString() = "NativeDocumentChunk(redacted)"
}

/** All registry mutations run on the native serial scheduler, independently of JavaScript. */
internal class NativeDocumentRegistry(
	private val scheduler: AdmissionScheduler,
	private val load: (String, Int, NativeDocumentScope?, () -> Boolean, (AdmissionHttpResponse?) -> Unit) -> AdmissionCancellation,
	private val identifier: () -> String = { UUID.randomUUID().toString() },
) {
	private class Work(val id: String, val url: String, val maximumBytes: Int, val scope: NativeDocumentScope?, val deadline: Long) {
		val live = AtomicBoolean(true)
		var nativeFinished = false
		var cancellation: AdmissionCancellation? = null
		var timer: AdmissionCancellation? = null
		var body: ByteArray? = null
		var offset = 0
		var header: NativeDocumentHeader? = null
		var requested = false
		var waiter: ((NativeDocumentHeader?) -> Unit)? = null
	}
	private val work = linkedMapOf<String, Work>()
	@Volatile private var foreground = true
	@Volatile private var closed = false

	fun open(url: String, maximumBytes: Int, scope: NativeDocumentScope?): String {
		AdmissionUrl.clean(url)
		if (closed || !foreground || work.size >= 16 || maximumBytes !in 1..8388608 || (scope != null && !scope.isActive())) invalid()
		val id = identifier()
		if (!AdmissionUrl.validToken(id) || work.containsKey(id)) invalid()
		val item = Work(id, url, maximumBytes, scope, scheduler.nowMs() + 30000)
		work[id] = item
		item.timer = scheduler.after(30000) { cancel(id) }
		try {
			val cancellation = load(url, maximumBytes, scope, { active(item) }) { response ->
				scheduler.dispatch { received(item, response) }
			}
			item.cancellation = cancellation
			if (!item.live.get()) cancellation.cancel()
		} catch (_: Exception) {
			item.nativeFinished = true
			cancel(id)
			invalid()
		}
		return id
	}

	fun response(id: String, callback: (NativeDocumentHeader?) -> Unit) {
		val item = work[id]
		if (item == null || !active(item) || item.requested) { callback(null); return }
		item.requested = true
		if (item.header != null) callback(item.header)
		else item.waiter = callback
	}

	fun chunk(id: String, maximumBytes: Int): NativeDocumentChunk {
		val item = work[id] ?: invalid()
		if (!active(item) || !item.requested || maximumBytes !in 1..65536) { cancel(id); invalid() }
		val bytes = item.body ?: invalid()
		val end = minOf(bytes.size, item.offset + maximumBytes)
		val value = bytes.copyOfRange(item.offset, end)
		item.offset = end
		val last = end == bytes.size
		if (last) cancel(id)
		return NativeDocumentChunk(value, last)
	}

	fun cancel(id: String) {
		if (!AdmissionUrl.validToken(id)) invalid()
		val item = work[id] ?: return
		item.live.set(false)
		item.timer?.cancel(); item.timer = null
		val waiter = item.waiter; item.waiter = null
		item.body?.fill(0); item.body = null; item.header = null
		try {
			if (!item.nativeFinished) item.cancellation?.cancel()
			item.cancellation = null
		} finally {
			if (item.nativeFinished) work.remove(id)
			waiter?.invoke(null)
		}
	}

	fun retireContext(context: String) {
		for (item in work.values.toList()) if (item.scope?.context == context) cancel(item.id)
	}
	fun lifecycle(active: Boolean) {
		foreground = active
		if (!active) for (id in work.keys.toList()) cancel(id)
	}
	fun close() {
		closed = true
		for (id in work.keys.toList()) cancel(id)
	}

	private fun active(item: Work): Boolean = try {
		item.live.get() && !closed && foreground && scheduler.nowMs() < item.deadline && (item.scope?.isActive() != false)
	} catch (_: Exception) { false }

	private fun received(item: Work, response: AdmissionHttpResponse?) {
		if (item.nativeFinished) return
		item.nativeFinished = true
		if (!active(item) || response == null || response.code !in 100..599 || response.body.size > item.maximumBytes) {
			response?.body?.fill(0); cancel(item.id); return
		}
		val finalUrl = response.url ?: item.url
		try {
			AdmissionUrl.clean(finalUrl)
			if (AdmissionUrl.origin(finalUrl) != AdmissionUrl.origin(item.url)) invalid()
		} catch (_: Exception) { response.body.fill(0); cancel(item.id); return }
		item.body = response.body
		item.header = NativeDocumentHeader(finalUrl, response.code)
		val waiter = item.waiter; item.waiter = null
		waiter?.invoke(item.header)
	}
	private fun invalid(): Nothing = throw IllegalArgumentException("Native document acquisition failed.")
}
