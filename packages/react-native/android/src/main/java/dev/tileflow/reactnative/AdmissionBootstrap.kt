package dev.tileflow.reactnative

import java.util.concurrent.atomic.AtomicBoolean

internal object AdmissionBootstrapLimits {
	const val QUEUE = 32
	const val REQUEST_BYTES = 2048
	const val RESPONSE_BYTES = 65536
	const val TIMEOUT_MS = 30000L
}

internal class AdmissionBootstrapRequest(
	val url: String,
	val credential: String,
	val body: String,
	val mayStart: () -> Boolean,
) {
	override fun toString() = "AdmissionBootstrapRequest(redacted)"
}

internal class AdmissionBootstrapReply(val status: Int, val cacheControl: String, val body: ByteArray) {
	override fun toString() = "AdmissionBootstrapReply(redacted)"
}

internal interface AdmissionBootstrapNetwork {
	fun start(request: AdmissionBootstrapRequest, completion: (AdmissionBootstrapReply?) -> Unit): AdmissionCancellation
}

// The serial owner only bounds transport work. It never parses a grant,
// admits resources, counts commercial requests, or creates session IDs.
internal class AdmissionBootstrap(
	private val installation: String,
	private val scheduler: AdmissionScheduler,
	private val network: AdmissionBootstrapNetwork,
	private val owns: () -> Boolean,
) {
	private class Context(val mapId: String?) {
		val live = AtomicBoolean(true)
		var endpoint: String? = null
		var credential: String? = null
		var lastRequest = 0L
		val pending = linkedMapOf<String, Work>()
	}
	private class Work(
		val id: String,
		val context: Context,
		val deadline: Long,
		val completion: (AdmissionBootstrapReply?) -> Unit,
	) {
		val live = AtomicBoolean(true)
		var network: AdmissionCancellation? = null
		var timer: AdmissionCancellation? = null
	}
	private val contexts = linkedMapOf<String, Context>()
	private val active = AtomicBoolean(true)
	@Volatile private var foreground = true
	private var pendingCount = 0
	private val mobileCredential = Regex("tf_public_[0-9a-f]{48}")
	private val bodyPattern = Regex("\\{\"mapId\":\"(map_[A-Za-z0-9_-]{16})\",\"sessionId\":\"([A-Za-z0-9._:-]{1,255})\",\"surfaceId\":\"([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)\"\\}")

	override fun toString() = "AdmissionBootstrap(redacted)"

	fun register(context: String, mapId: String?) {
		if (!active.get() || !owned() || !validContext(context) || contexts.containsKey(context) || contexts.size >= AdmissionLimits.CONTEXTS ||
			(mapId != null && !Regex("map_[A-Za-z0-9_-]{16}").matches(mapId))) invalid()
		contexts[context] = Context(mapId)
	}

	fun start(contextId: String, requestId: String, url: String, credential: String, body: String, completion: (AdmissionBootstrapReply?) -> Unit) {
		val context = contexts[contextId] ?: invalid()
		if (!active.get() || !foreground || !owned() || !context.live.get() || context.mapId == null || pendingCount >= AdmissionBootstrapLimits.QUEUE) invalid()
		val sequence = sequence(requestId)
		if (sequence <= context.lastRequest || !mobileCredential.matches(credential) || body.length > AdmissionBootstrapLimits.REQUEST_BYTES) invalid()
		val match = bodyPattern.matchEntire(body) ?: invalid()
		if (match.groupValues[1] != context.mapId || match.groupValues.drop(2).any { it.startsWith("tf_native_") || mobileCredential.matches(it) }) invalid()
		AdmissionUrl.clean(url)
		if (url != AdmissionUrl.origin(url) + "/v1/sessions/start" ||
			(context.endpoint != null && (context.endpoint != url || context.credential != credential))) invalid()
		// The validated controller is the source of the first endpoint/credential.
		// Bind subsequent bootstrap calls to that exact pair for this context.
		context.endpoint = url; context.credential = credential; context.lastRequest = sequence
		val work = Work(requestId, context, scheduler.nowMs() + AdmissionBootstrapLimits.TIMEOUT_MS, completion)
		context.pending[requestId] = work; pendingCount++
		work.timer = scheduler.after(AdmissionBootstrapLimits.TIMEOUT_MS) { finish(work, null) }
		try {
			work.network = network.start(AdmissionBootstrapRequest(url, credential, body) { mayStart(work) }) { reply ->
				scheduler.dispatch {
					val valid = mayStart(work) && reply != null && reply.status in 100..599 &&
						reply.cacheControl.length <= 1024 && reply.body.size <= AdmissionBootstrapLimits.RESPONSE_BYTES
					finish(work, if (valid) reply else null)
				}
			}
			if (!work.live.get()) work.network?.cancel()
		} catch (_: Exception) { finish(work, null) }
	}

	fun cancel(contextId: String, requestId: String) {
		if (!validContext(contextId)) invalid()
		val sequence = sequence(requestId)
		val context = contexts[contextId] ?: return
		// A cancellation can overtake dispatch. A per-context high-water mark
		// prevents replay without retaining an unbounded tombstone collection.
		context.lastRequest = maxOf(context.lastRequest, sequence)
		context.pending[requestId]?.let { finish(it, null) }
	}

	fun retire(contextId: String) {
		val context = contexts.remove(contextId) ?: return
		context.live.set(false)
		context.credential = null; context.endpoint = null
		for (work in context.pending.values.toList()) finish(work, null)
	}

	fun lifecycle(resumed: Boolean) {
		foreground = resumed
		if (!resumed) for (context in contexts.values.toList()) for (work in context.pending.values.toList()) finish(work, null)
	}

	fun close() {
		active.set(false)
		for (context in contexts.keys.toList()) retire(context)
	}

	private fun mayStart(work: Work): Boolean = active.get() && foreground && work.live.get() && work.context.live.get() &&
		scheduler.nowMs() < work.deadline && owned()

	private fun finish(work: Work, reply: AdmissionBootstrapReply?) {
		if (!work.live.compareAndSet(true, false)) return
		work.context.pending.remove(work.id); pendingCount--
		work.timer?.cancel(); work.timer = null
		work.network?.cancel(); work.network = null
		try { work.completion(reply) } catch (_: Exception) { /* A consumer cannot reopen retired transport work. */ }
	}

	private fun validContext(value: String) = AdmissionUrl.validToken(value) && value.startsWith("$installation.")
	private fun sequence(value: String): Long {
		if (!value.startsWith("$installation.")) invalid()
		val suffix = value.substring(installation.length + 1)
		if (!Regex("[1-9][0-9]{0,15}").matches(suffix)) invalid()
		return suffix.toLongOrNull()?.takeIf { it <= 9007199254740991L } ?: invalid()
	}
	private fun owned() = try { owns() } catch (_: Exception) { false }
	private fun invalid(): Nothing = throw IllegalArgumentException("Invalid native bootstrap")
}
