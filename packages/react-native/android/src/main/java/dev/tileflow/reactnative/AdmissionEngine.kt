package dev.tileflow.reactnative

import java.util.concurrent.atomic.AtomicBoolean

// All mutable collections are confined to the injected serial scheduler.
// Atomic liveness and volatile deadlines are also read at OkHttp network start.
internal class AdmissionEngine(
	private val installation: String,
	private val scheduler: AdmissionScheduler,
	private val network: AdmissionNetwork,
	private val owns: () -> Boolean,
	private val emit: (Map<String, Any>) -> Unit,
) {
	private class Context(val id: String, val mapId: String?, val resources: Map<String, AdmissionResource>) {
		val live = AtomicBoolean(true)
		val work = linkedMapOf<String, Work>()
		var batch: Batch? = null
		var sequence = 0L
	}
	private class Batch(val id: String, val tickets: List<String>) {
		var timer: AdmissionCancellation? = null
	}
	private class Work(
		val id: String,
		val context: Context,
		val url: String,
		val headers: Map<String, String>,
		val entered: Long,
		val live: AtomicBoolean,
		val response: (AdmissionHttpResponse) -> Unit,
		val failure: () -> Unit,
		val delegate: (String, (AdmissionHttpResponse?) -> Unit) -> AdmissionCancellation,
	) {
		var phase = "queue"
		var cancellation: AdmissionCancellation? = null
		var timer: AdmissionCancellation? = null
		var authority: AdmissionAuthority? = null
		@Volatile var deadline = 0L
		var redirects = 0
	}
	private val contexts = linkedMapOf<String, Context>()
	private val live = AtomicBoolean(true)
	private val lossQueued = AtomicBoolean(false)
	@Volatile private var foreground = true
	private var contextSequence = 0L
	private var ticketSequence = 0L

	fun register(mapId: String?, resources: List<AdmissionResource>): String {
		if (!checkOwnership() || contexts.size >= AdmissionLimits.CONTEXTS || resources.size > AdmissionLimits.RESOURCES ||
			(mapId != null && !Regex("map_[A-Za-z0-9_-]{16}").matches(mapId))) invalid()
		val catalog = linkedMapOf<String, AdmissionResource>()
		for (resource in resources) {
			AdmissionUrl.resource(resource)
			if (catalog.put(resource.url, resource) != null) invalid()
		}
		if (contextSequence >= 9007199254740991L) invalid()
		val id = "$installation.${++contextSequence}"
		contexts[id] = Context(id, mapId, catalog)
		return id
	}

	fun request(
		url: String,
		headers: Map<String, String>,
		onResponse: (AdmissionHttpResponse) -> Unit,
		onFailure: () -> Unit,
		onDelegate: (String, (AdmissionHttpResponse?) -> Unit) -> AdmissionCancellation,
	): AdmissionCancellation {
		val active = AtomicBoolean(true)
		var work: Work? = null
		scheduler.dispatch {
			if (!active.get()) return@dispatch
			val tagged = try { AdmissionUrl.strip(url) } catch (_: Exception) {
				active.set(false); onFailure(); return@dispatch
			}
			val context = contexts[tagged.context]
			if (!foreground || !checkOwnership() || context == null || !context.live.get() ||
				!context.resources.containsKey(tagged.url) || context.work.size >= AdmissionLimits.QUEUE ||
				headers.keys.any { it.equals(AdmissionLimits.GRANT_HEADER, true) } ||
				ticketSequence >= 9007199254740991L) {
				active.set(false); onFailure(); return@dispatch
			}
			val item = Work((++ticketSequence).toString(), context, tagged.url, headers.toMap(), scheduler.nowMs(), active, onResponse, onFailure, onDelegate)
			work = item
			context.work[item.id] = item
			item.timer = scheduler.after(AdmissionLimits.WAIT_MS) {
				if (context.batch?.tickets?.contains(item.id) == true) retire(context.id)
				else fail(item)
			}
			scheduler.dispatch { drain(context) }
		}
		return AdmissionCancellation {
			active.set(false)
			scheduler.dispatch {
				work?.let { item ->
					if (item.context.batch?.tickets?.contains(item.id) == true) {
						event(item.context, "cancel", mapOf("tickets" to listOf(item.id)))
					}
					finish(item)
				}
			}
		}
	}

	private fun drain(context: Context) {
		if (!context.live.get() || !foreground || !checkOwnership() || context.batch != null) return
		val selected = context.work.values.filter { it.live.get() && it.phase == "queue" }.take(AdmissionLimits.BATCH)
		if (selected.isEmpty()) return
		if (context.sequence >= 9007199254740991L) { retire(context.id); return }
		val batch = Batch((++context.sequence).toString(), selected.map { it.id })
		context.batch = batch
		for (item in selected) item.phase = "javascript"
		batch.timer = scheduler.after(AdmissionLimits.WAIT_MS) {
			if (context.batch === batch) retire(context.id)
		}
		event(context, "batch", mapOf("batch" to batch.id, "tickets" to selected.map { mapOf("ticket" to it.id, "url" to it.url) }))
	}

	fun complete(contextId: String, generation: Long, batchId: String, results: List<AdmissionResult>): Int {
		val context = contexts[contextId] ?: return 0
		val batch = context.batch ?: return 0
		if (!context.live.get() || generation != 1L || batch.id != batchId || !checkOwnership()) return 0
		if (results.size > AdmissionLimits.BATCH || results.map { it.ticket } != batch.tickets) { retire(contextId); return 0 }
		batch.timer?.cancel()
		context.batch = null
		var accepted = 0
		for (result in results) {
			val item = context.work[result.ticket] ?: continue
			if (!item.live.get()) { finish(item); continue }
			if (!foreground || scheduler.nowMs() - item.entered >= AdmissionLimits.WAIT_MS) { fail(item); continue }
			when (result) {
				is AdmissionResult.Reject -> fail(item)
				is AdmissionResult.Delegate -> {
					if (context.mapId != null) { fail(item); continue }
					item.phase = "network"
					item.deadline = item.entered + AdmissionLimits.WAIT_MS
					if (!canStart(item)) { fail(item); continue }
					try {
						item.cancellation = item.delegate(item.url) { response -> scheduler.dispatch { received(item, item.url, response) } }
						if (!item.live.get()) item.cancellation?.cancel()
						accepted++
					} catch (_: Exception) { fail(item) }
				}
				is AdmissionResult.Grant -> {
					val resource = context.resources[item.url]
					val authority = result.authority
					if (context.mapId == null || resource == null || result.validForMs !in 1..AdmissionLimits.MAX_VALID_MS ||
						authority.grant.length > AdmissionLimits.GRANT || !Regex("tf_native_v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+").matches(authority.grant) ||
						!authority.allows(resource, context.mapId)) { fail(item); continue }
					item.authority = authority
					// Anchor at the earlier enqueue time, never at bridge receipt.
					item.deadline = minOf(item.entered + AdmissionLimits.WAIT_MS, item.entered + result.validForMs - AdmissionLimits.SAFETY_MS)
					if (start(item, item.url)) accepted++
				}
			}
		}
		scheduler.dispatch { drain(context) }
		return accepted
	}

	private fun canStart(item: Work): Boolean {
		if (!item.live.get() || !item.context.live.get() || !foreground || !live.get() || scheduler.nowMs() >= item.deadline) return false
		if (!ownsSafely()) { loseOwnership(); return false }
		return true
	}

	private fun start(item: Work, url: String): Boolean {
		val authority = item.authority ?: return false
		val resource = item.context.resources[url]
		val mapId = item.context.mapId
		if (resource == null || mapId == null || !authority.allows(resource, mapId) || !canStart(item)) { fail(item); return false }
		item.phase = "network"
		val headers = item.headers + (AdmissionLimits.GRANT_HEADER to authority.grant)
		return try {
			item.cancellation = network.start(AdmissionHttpRequest(url, headers) { canStart(item) }) { response ->
				scheduler.dispatch { received(item, url, response) }
			}
			if (!item.live.get()) item.cancellation?.cancel()
			true
		} catch (_: Exception) { fail(item); false }
	}

	private fun received(item: Work, url: String, response: AdmissionHttpResponse?) {
		if (!item.live.get() || !item.context.live.get()) return
		if (!checkOwnership()) return
		if (response == null || !foreground || scheduler.nowMs() >= item.deadline) { fail(item); return }
		event(item.context, "response", mapOf("status" to response.code))
		if (item.authority != null && response.code in listOf(301, 302, 303, 307, 308)) {
			if (++item.redirects > AdmissionLimits.REDIRECTS) { fail(item); return }
			val location = response.headers.entries.firstOrNull { it.key.equals("location", true) }?.value
			val target = try { AdmissionUrl.redirect(url, location ?: "", item.context.id) } catch (_: Exception) { fail(item); return }
			if (location.isNullOrEmpty()) { fail(item); return }
			start(item, target)
			return
		}
		if (!item.live.compareAndSet(true, false)) return
		finish(item)
		item.response(response)
	}

	private fun finish(item: Work) {
		item.live.set(false)
		item.cancellation?.cancel()
		item.cancellation = null
		item.timer?.cancel()
		item.timer = null
		item.authority = null
		item.context.work.remove(item.id)
		scheduler.dispatch { drain(item.context) }
	}
	private fun fail(item: Work) {
		val notify = item.live.getAndSet(false)
		finish(item)
		if (notify) item.failure()
	}

	fun retire(contextId: String) {
		val context = contexts.remove(contextId) ?: return
		context.live.set(false)
		context.batch?.timer?.cancel()
		context.batch = null
		for (item in context.work.values.toList()) fail(item)
		event(context, "retired", mapOf("code" to "NATIVE_ADMISSION_CANCELLED"))
	}

	fun lifecycle(active: Boolean) {
		foreground = active
		if (!active) {
			for (context in contexts.values.toList()) {
				val tickets = context.batch?.tickets
				if (!tickets.isNullOrEmpty()) event(context, "cancel", mapOf("tickets" to tickets))
				for (item in context.work.values.toList()) fail(item)
			}
		}
		safeEmit(mapOf("kind" to "lifecycle", "installation" to installation, "foreground" to active))
		if (active) for (context in contexts.values) scheduler.dispatch { drain(context) }
	}

	fun close() {
		live.set(false)
		for (context in contexts.keys.toList()) retire(context)
	}
	fun checkOwnership(): Boolean {
		if (!live.get()) return false
		if (!ownsSafely()) { loseOwnership(); return false }
		return true
	}
	private fun ownsSafely() = try { owns() } catch (_: Exception) { false }
	private fun loseOwnership() {
		live.set(false)
		if (!lossQueued.compareAndSet(false, true)) return
		scheduler.dispatch {
			close()
			safeEmit(mapOf("kind" to "ownershipLost", "installation" to installation))
		}
	}
	private fun event(context: Context, kind: String, fields: Map<String, Any>) {
		safeEmit(mapOf("kind" to kind, "installation" to installation, "context" to context.id, "generation" to 1) + fields)
	}
	private fun safeEmit(event: Map<String, Any>) {
		try { emit(event) } catch (_: Exception) { close() }
	}
	private fun invalid(): Nothing = throw IllegalArgumentException("Invalid native admission")
}
