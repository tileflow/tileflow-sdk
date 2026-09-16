package dev.tileflow.reactnative

internal fun interface AdmissionCancellation { fun cancel() }

internal interface AdmissionScheduler {
	fun nowMs(): Long
	fun dispatch(action: () -> Unit)
	fun after(delayMs: Long, action: () -> Unit): AdmissionCancellation
}

internal interface AdmissionNetwork {
	fun start(request: AdmissionHttpRequest, callback: (AdmissionHttpResponse?) -> Unit): AdmissionCancellation
}

// Deliberately not data classes: generated string representations must not
// expose headers, authority, response bodies or URLs to diagnostic tooling.
internal class AdmissionHttpRequest(
	val url: String,
	val headers: Map<String, String>,
	val maximumBytes: Int,
	val mayStart: () -> Boolean,
) {
	constructor(url: String, headers: Map<String, String>, mayStart: () -> Boolean) :
		this(url, headers, AdmissionLimits.RESPONSE_BYTES.toInt(), mayStart)
	init { require(maximumBytes in 1..AdmissionLimits.RESPONSE_BYTES.toInt()) { "Invalid native resource bound" } }
	override fun toString() = "AdmissionHttpRequest(redacted)"
}

internal class AdmissionHttpResponse(
	val code: Int,
	val headers: Map<String, String>,
	val body: ByteArray,
	val url: String? = null,
) {
	override fun toString() = "AdmissionHttpResponse(redacted)"
}

internal class AdmissionResource(
	val url: String,
	val scope: String,
	val tilesetId: String?,
	val template: String? = null,
	fontStacks: List<String>? = null,
) {
	val fontStacks: List<String>? = fontStacks?.let { java.util.Collections.unmodifiableList(it.toList()) }
	override fun toString() = "AdmissionResource(redacted)"
}

internal class AdmissionAuthority(
	val grant: String,
	val mapId: String,
	val resourceOrigins: List<String>,
	val resourceScopes: List<String>,
	val tilesetIds: List<String>,
) {
	fun allows(resource: AdmissionResource, expectedMap: String): Boolean =
		mapId == expectedMap && resourceOrigins.contains(AdmissionUrl.origin(resource.url)) &&
		resourceScopes.contains(resource.scope) &&
		(resource.tilesetId == null || tilesetIds.contains(resource.tilesetId))
	override fun toString() = "AdmissionAuthority(redacted)"
}

internal sealed class AdmissionResult(val ticket: String) {
	class Grant(ticket: String, val validForMs: Long, val authority: AdmissionAuthority) : AdmissionResult(ticket)
	class Delegate(ticket: String) : AdmissionResult(ticket)
	class Reject(ticket: String) : AdmissionResult(ticket)
	override fun toString() = "AdmissionResult(redacted)"
}

internal object AdmissionLimits {
	const val CONTEXTS = 16
	const val RESOURCES = 128
	const val QUEUE = 128
	const val BATCH = 8
	const val URL = 2048
	const val BRIDGE_BYTES = 524288
	const val GRANT = 24576
	const val WAIT_MS = 30000L
	const val SAFETY_MS = 1000L
	const val MAX_VALID_MS = 900000L
	const val REDIRECTS = 3
	const val RESPONSE_BYTES = 8388608L
	const val GRANT_HEADER = "X-Tileflow-Native-Grant"
}
