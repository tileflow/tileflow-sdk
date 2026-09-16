package dev.tileflow.reactnative

// All methods run on the view's UI queue. Identity is captured before each native frame.
internal class NativeSurfaceState(private val surface: String, private val emit: (Map<String, Any>) -> Unit) {
	private var token = ""
	private var style: Any? = null
	private var frame: Any? = null
	private var frameLayout = 0L
	private var visible = false
	private var closed = false
	private var failed = false
	private var layoutEpoch = 1L
	private var committed = 0L
	private var fullyRendered = false
	private var reported = false
	private var sequence = 0L
	private var command = 0L
	private var gestureSequence = 0L
	private var gesture = 0L
	private val pending = ArrayDeque<Map<String, Any>>()
	var awaitingSequence: Long? = null
		private set
	val active: Boolean get() = !closed && !failed
	val pendingCount: Int get() = pending.size

	fun expect(value: String) {
		check(!closed && AdmissionUrl.validToken(value)) { "Native surface operation failed." }
		token = value; style = null; frame = null; committed = 0; fullyRendered = false; reported = false; failed = false; gesture = 0
	}
	fun layout(isVisible: Boolean) {
		if (closed) return
		visible = isVisible
		if (layoutEpoch >= 9007199254740991L) { fail(); return }
		layoutEpoch++; committed = 0; frame = null; fullyRendered = false; reported = false; gesture = 0
		enqueue("invalidate")
	}
	fun loaded(value: String, identity: Any) {
		if (!active || value != token || style === identity) return
		style = identity; fullyRendered = false; frame = null; reported = false
		enqueue("style")
	}
	fun commit(value: String): Long {
		check(active && visible && value == token && style != null) { "Native surface operation failed." }
		committed = layoutEpoch; frame = null; reported = false
		return committed
	}
	fun frameStart(identity: Any?) {
		frame = if (active && visible && identity === style && committed == layoutEpoch) identity else null
		frameLayout = layoutEpoch
	}
	fun mapRendered(identity: Any?, fully: Boolean) {
		if (active && identity != null && identity === style) fullyRendered = fully
	}
	fun frameEnd(identity: Any?, fully: Boolean) {
		val captured = frame; frame = null
		if (!active || reported || !visible || !fully || !fullyRendered || captured == null ||
			captured !== identity || captured !== style || frameLayout != layoutEpoch || committed != layoutEpoch) return
		reported = true
		enqueue("render")
	}
	fun beginCommand(value: Long): Long {
		if (!active || !visible || style == null || gesture != 0L || value <= command || value > 9007199254740991L) return 0
		command = value; committed = 0; frame = null; fullyRendered = false; reported = false
		return enqueue("invalidate")
	}
	fun cancelCommand(value: Long) { if (value > command && value <= 9007199254740991L) command = value }
	fun gestureStart(view: Map<String, Any>) {
		if (!active || !visible || style == null || gesture != 0L) return
		if (gestureSequence >= 9007199254740991L) { fail(); return }
		gesture = ++gestureSequence
		enqueue("gesture-start", mapOf("gesture" to gesture, "view" to view))
	}
	fun gestureChange(view: Map<String, Any>) {
		if (active && gesture != 0L) enqueue("gesture-change", mapOf("gesture" to gesture, "view" to view))
	}
	fun gestureEnd(view: Map<String, Any>) {
		if (!active || gesture == 0L) return
		val completed = gesture; gesture = 0
		enqueue("gesture-end", mapOf("gesture" to completed, "view" to view))
	}
	fun fail() {
		if (closed || failed) return
		failed = true; committed = 0; frame = null; fullyRendered = false; gesture = 0
		enqueue("error")
	}
	private fun enqueue(kindInput: String, fieldsInput: Map<String, Any> = emptyMap()): Long {
		if (closed || token.isEmpty() || sequence >= 9007199254740991L) return 0
		var kind = kindInput
		var fields = fieldsInput
		val last = pending.lastOrNull()
		if ((kind == "gesture-change" || kind == "invalidate") && last?.get("kind") == kind && last["style"] == token && last["gesture"] == fields["gesture"]) pending.removeLast()
		val overflow = pending.size >= 32
		if (overflow) {
			pending.clear(); failed = true; frame = null; committed = 0; fullyRendered = false; gesture = 0
			kind = "error"; fields = emptyMap()
		}
		val emitted = ++sequence
		pending.addLast(mapOf("surface" to surface, "style" to token, "layout" to layoutEpoch, "sequence" to emitted, "kind" to kind) + fields)
		drain()
		return if (overflow) 0 else emitted
	}
	private fun drain() {
		if (closed || awaitingSequence != null || pending.isEmpty()) return
		val event = pending.removeFirst()
		awaitingSequence = event["sequence"] as Long
		try { emit(event) } catch (_: Exception) { close() }
	}
	fun acknowledge(value: Long) {
		if (awaitingSequence != value) return
		awaitingSequence = null; drain()
	}
	fun close() { closed = true; style = null; frame = null; fullyRendered = false; gesture = 0; pending.clear(); awaitingSequence = null }
	override fun toString() = "NativeSurfaceState"
}
