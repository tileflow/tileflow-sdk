package dev.tileflow.reactnative

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.common.LifecycleState

class TileflowNativeDocumentsModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
	private val scheduler = HandlerAdmissionScheduler()
	private val network = NativeDocumentOkHttpNetwork()
	private val registry = NativeDocumentRegistry(scheduler, { url, limit, scope, active, completion ->
		if (scope == null) network.start(url, limit, active, completion)
		else scope.load(url, completion)
	})
	@Volatile private var invalidated = false

	init {
		registry.lifecycle(context.lifecycleState == LifecycleState.RESUMED)
		context.addLifecycleEventListener(this)
	}
	override fun getName() = "TileflowNativeDocuments"

	@ReactMethod fun openDocument(url: String, maximumBytes: Double, installation: String?, context: String?, promise: Promise) = action(promise) {
		if (invalidated || !maximumBytes.isFinite() || maximumBytes != maximumBytes.toInt().toDouble() || maximumBytes < 1 || maximumBytes > 8388608 ||
			(installation == null) != (context == null)) invalid()
		val scope = if (installation == null) null else {
			if (!AdmissionUrl.validToken(installation) || !AdmissionUrl.validToken(context)) invalid()
			val admission = reactApplicationContext.getNativeModule(TileflowNativeAdmissionModule::class.java) ?: invalid()
			admission.documentScope(installation, context!!, maximumBytes.toInt())
		}
		Arguments.makeNativeMap(mapOf("document" to registry.open(url, maximumBytes.toInt(), scope)))
	}

	@ReactMethod fun documentResponse(document: String, promise: Promise) {
		scheduler.dispatch {
			try {
				if (invalidated || !AdmissionUrl.validToken(document)) invalid()
				registry.response(document) { response ->
					if (response == null || invalidated) reject(promise)
					else promise.resolve(Arguments.makeNativeMap(mapOf("url" to response.url, "status" to response.status)))
				}
			} catch (_: Exception) { reject(promise) }
		}
	}

	@ReactMethod fun documentChunk(document: String, maximumBytes: Double, promise: Promise) = action(promise) {
		if (invalidated || !maximumBytes.isFinite() || maximumBytes != maximumBytes.toInt().toDouble() || maximumBytes < 1 || maximumBytes > 65536) invalid()
		val chunk = registry.chunk(document, maximumBytes.toInt())
		val encoded = Base64.encodeToString(chunk.bytes, Base64.NO_WRAP)
		chunk.bytes.fill(0)
		Arguments.makeNativeMap(mapOf("bodyBase64" to encoded, "last" to chunk.last))
	}

	@ReactMethod fun cancelDocument(document: String, promise: Promise) = action(promise) {
		registry.cancel(document)
		Arguments.makeNativeMap(mapOf("cancelled" to true))
	}

	internal fun retireNativeContext(context: String) { registry.retireContext(context) }
	private fun action(promise: Promise, block: () -> Any) {
		scheduler.dispatch {
			try { promise.resolve(block()) }
			catch (_: Exception) { reject(promise) }
		}
	}
	private fun reject(promise: Promise) { promise.reject("NATIVE_DOCUMENT_UNAVAILABLE", "Native document acquisition failed.") }
	private fun invalid(): Nothing = throw IllegalArgumentException("Native document acquisition failed.")
	override fun onHostPause() { scheduler.dispatch { registry.lifecycle(false) } }
	override fun onHostResume() { scheduler.dispatch { if (!invalidated) registry.lifecycle(true) } }
	override fun onHostDestroy() { scheduler.dispatch { invalidated = true; registry.close(); network.close() } }
	override fun invalidate() {
		reactApplicationContext.removeLifecycleEventListener(this)
		scheduler.dispatch { invalidated = true; registry.close(); network.close() }
		super.invalidate()
	}
}
