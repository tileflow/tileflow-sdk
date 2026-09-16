package dev.tileflow.reactnative

import java.util.UUID
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.common.LifecycleState
import org.maplibre.android.MapLibre
import org.maplibre.android.ModuleProvider

class TileflowNativeAdmissionModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
	private val scheduler = HandlerAdmissionScheduler()
	private var installation: String? = null
	private var previous: ModuleProvider? = null
	private var provider: AdmissionModuleProvider? = null
	private var engine: AdmissionEngine? = null
	private var network: AdmissionOkHttpNetwork? = null
	private var listeners = 0
	private var invalidated = false
	private var lastRemoved: String? = null
	private var lastLost = false

	init { context.addLifecycleEventListener(this) }
	override fun getName() = "TileflowNativeAdmission"

	@ReactMethod fun addListener(eventName: String) { scheduler.dispatch { if (eventName == "TileflowNativeAdmissionEvent") listeners++ } }
	@ReactMethod fun removeListeners(count: Double) { scheduler.dispatch { listeners = maxOf(0, listeners - count.toInt()) } }

	@ReactMethod fun install(promise: Promise) = action(promise) {
		if (invalidated || installation != null || listeners <= 0) invalid()
		val saved = MapLibre.getModuleProvider()
		if (saved is AdmissionModuleProvider) invalid()
		val id = UUID.randomUUID().toString()
		val transport = AdmissionOkHttpNetwork()
		lateinit var wrapper: AdmissionModuleProvider
		val admission = AdmissionEngine(id, scheduler, transport, { MapLibre.getModuleProvider() === wrapper }, ::emit)
		wrapper = AdmissionModuleProvider(saved, admission)
		previous = saved
		provider = wrapper
		network = transport
		engine = admission
		installation = id
		MapLibre.setModuleProvider(wrapper)
		if (MapLibre.getModuleProvider() !== wrapper) {
			admission.close(); transport.close(); invalid()
		}
		admission.lifecycle(reactApplicationContext.lifecycleState == LifecycleState.RESUMED)
		Arguments.makeNativeMap(mapOf("installation" to id))
	}

	@ReactMethod fun registerContext(id: String, registration: ReadableMap, promise: Promise) = action(promise) {
		val admission = current(id)
		val mapId = if (registration.isNull("mapId")) null else registration.getString("mapId") ?: invalid()
		val source = registration.getArray("resources") ?: invalid()
		if (source.size() > AdmissionLimits.RESOURCES) invalid()
		var characters = 0
		val resources = (0 until source.size()).map { index ->
			val item = source.getMap(index) ?: invalid()
			val url = item.getString("url") ?: invalid()
			characters += url.length
			if (characters > AdmissionLimits.BRIDGE_BYTES || url.length > AdmissionLimits.URL) invalid()
			AdmissionResource(url, item.getString("scope") ?: invalid(), if (item.hasKey("tilesetId") && !item.isNull("tilesetId")) item.getString("tilesetId") else null)
		}
		Arguments.makeNativeMap(mapOf("context" to admission.register(mapId, resources), "generation" to 1))
	}

	@ReactMethod fun retireContext(id: String, context: String, promise: Promise) = action(promise) {
		if (!AdmissionUrl.validToken(context)) invalid()
		if (installation == id) engine?.retire(context)
		else if (lastRemoved != id) invalid()
		Arguments.makeNativeMap(mapOf("retired" to true))
	}

	@ReactMethod fun completeBatch(id: String, context: String, generation: Double, batch: String, source: ReadableArray, promise: Promise) = action(promise) {
		val admission = current(id)
		if (!AdmissionUrl.validToken(context) || !AdmissionUrl.validToken(batch) || generation != 1.0 || source.size() > AdmissionLimits.BATCH) invalid()
		var characters = 0
		fun string(map: ReadableMap, key: String, maximum: Int = AdmissionLimits.URL): String {
			val value = map.getString(key) ?: invalid()
			characters += value.length
			if (value.length > maximum || characters > AdmissionLimits.BRIDGE_BYTES) invalid()
			return value
		}
		fun strings(map: ReadableMap, key: String, maximum: Int): List<String> {
			val array = map.getArray(key) ?: invalid()
			if (array.size() > maximum) invalid()
			return (0 until array.size()).map { index ->
				val value = array.getString(index) ?: invalid()
				characters += value.length
				if (value.length > AdmissionLimits.URL || characters > AdmissionLimits.BRIDGE_BYTES) invalid()
				value
			}
		}
		val results = (0 until source.size()).map { index ->
			val item = source.getMap(index) ?: invalid()
			val ticket = string(item, "ticket", 96)
			if (!AdmissionUrl.validToken(ticket)) invalid()
			when (string(item, "kind", 16)) {
				"delegate" -> AdmissionResult.Delegate(ticket)
				"reject" -> AdmissionResult.Reject(ticket)
				"grant" -> {
					val budget = item.getDouble("validForMs")
					if (!budget.isFinite() || budget != budget.toLong().toDouble() || budget <= 0 || budget > AdmissionLimits.MAX_VALID_MS) invalid()
					val authority = item.getMap("authority") ?: invalid()
					AdmissionResult.Grant(ticket, budget.toLong(), AdmissionAuthority(string(authority, "grant", AdmissionLimits.GRANT),
						string(authority, "mapId", 64), strings(authority, "resourceOrigins", 2), strings(authority, "resourceScopes", 6), strings(authority, "tilesetIds", 18)))
				}
				else -> invalid()
			}
		}
		Arguments.makeNativeMap(mapOf("accepted" to admission.complete(context, 1, batch, results)))
	}

	@ReactMethod fun remove(id: String, promise: Promise) = action(promise) {
		if (installation == null && id == lastRemoved) return@action Arguments.makeNativeMap(mapOf("removed" to !lastLost, "ownershipLost" to lastLost))
		if (id != installation) invalid()
		val lost = MapLibre.getModuleProvider() !== provider
		engine?.close()
		network?.close()
		if (!lost) previous?.let { MapLibre.setModuleProvider(it) }
		installation = null; engine = null; provider = null; previous = null; network = null
		lastRemoved = id; lastLost = lost
		Arguments.makeNativeMap(mapOf("removed" to !lost, "ownershipLost" to lost))
	}

	private fun current(id: String): AdmissionEngine {
		if (installation != id || invalidated) invalid()
		val admission = engine ?: invalid()
		if (!admission.checkOwnership()) invalid()
		return admission
	}
	private fun action(promise: Promise, block: () -> Any) {
		scheduler.dispatch {
			try { promise.resolve(block()) }
			catch (_: Exception) { promise.reject("NATIVE_ADMISSION_UNAVAILABLE", "Native resource admission failed") }
		}
	}
	private fun emit(event: Map<String, Any>) {
		if (listeners <= 0 || invalidated) throw IllegalStateException("Native admission listener is unavailable")
		reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
			.emit("TileflowNativeAdmissionEvent", Arguments.makeNativeMap(event))
	}

	override fun onHostPause() { scheduler.dispatch { engine?.lifecycle(false) } }
	override fun onHostResume() { scheduler.dispatch { engine?.lifecycle(true) } }
	override fun onHostDestroy() { scheduler.dispatch { shutdown() } }
	override fun invalidate() {
		reactApplicationContext.removeLifecycleEventListener(this)
		scheduler.dispatch { invalidated = true; shutdown() }
		super.invalidate()
	}
	private fun shutdown() {
		engine?.close(); network?.close()
		if (provider != null && MapLibre.getModuleProvider() === provider) previous?.let { MapLibre.setModuleProvider(it) }
		lastRemoved = installation
		installation = null; engine = null; network = null; provider = null; previous = null
	}
	private fun invalid(): Nothing = throw IllegalArgumentException("Invalid native admission")
}
