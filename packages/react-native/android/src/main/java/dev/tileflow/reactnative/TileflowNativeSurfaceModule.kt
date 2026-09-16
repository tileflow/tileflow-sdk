package dev.tileflow.reactnative

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.ViewTreeObserver
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.common.LifecycleState
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.common.UIManagerType
import java.util.UUID
import kotlin.math.abs
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.BackgroundLayer
import org.maplibre.android.style.layers.PropertyFactory
import org.maplibre.reactnative.components.camera.MLRNCamera
import org.maplibre.reactnative.components.mapview.MLRNMapView

class TileflowNativeSurfaceModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener {
	private val handler = Handler(Looper.getMainLooper())
	private val surfaces = linkedMapOf<String, Surface>()
	private val rootRetirements = linkedMapOf<Int, RootRetirement>()
	private var foreground = context.lifecycleState == LifecycleState.RESUMED
	private var invalidated = false
	private var listeners = 0
	init { context.addLifecycleEventListener(this) }
	override fun getName() = "TileflowNativeSurface"
	@ReactMethod fun addListener(name: String) { handler.post { if (name == "TileflowNativeSurfaceEvent") listeners++ } }
	@ReactMethod fun removeListeners(count: Double) { handler.post { listeners = maxOf(0, listeners - count.toInt()) } }
	private fun invalid(): Nothing = throw IllegalStateException("Native surface operation failed.")
	private fun reject(promise: Promise) { promise.reject("NATIVE_SURFACE_UNAVAILABLE", "Native surface operation failed.") }
	private fun action(promise: Promise, work: () -> Any) {
		handler.post { try { promise.resolve(work()) } catch (_: Exception) { reject(promise) } }
	}
	private fun integer(value: Double): Long {
		if (!value.isFinite() || value < 1 || value > 9007199254740991.0 || value != value.toLong().toDouble()) invalid()
		return value.toLong()
	}
	private fun root(tag: Int): View? {
		return try { UIManagerHelper.getUIManager(reactApplicationContext, UIManagerType.FABRIC)?.resolveView(tag) }
		catch (_: Exception) { null }
	}
	private fun mapIn(root: View): MLRNMapView {
		val queue = ArrayDeque<View>(); queue.add(root)
		var found: MLRNMapView? = null
		var visited = 0
		while (queue.isNotEmpty()) {
			if (++visited > 1024) invalid()
			val view = queue.removeFirst()
			if (view is MLRNMapView) {
				if (found != null) invalid()
				found = view
			} else if (view is ViewGroup) {
				if (view.childCount + queue.size > 1024) invalid()
				for (index in 0 until view.childCount) queue.add(view.getChildAt(index))
			}
		}
		return found ?: invalid()
	}
	private fun current(id: String): Surface {
		val surface = surfaces[id] ?: invalid()
		if (invalidated || surface.retiring || !surface.state.active || root(surface.root.id) !== surface.root || mapIn(surface.root) !== surface.map) invalid()
		return surface
	}

	@ReactMethod fun attachSurface(tag: Double, promise: Promise) = action(promise) {
		if (invalidated || !foreground || listeners < 1 || surfaces.size >= 16 || tag != tag.toInt().toDouble() || tag < 1) invalid()
		val root = root(tag.toInt()) ?: invalid()
		val map = mapIn(root)
		if (!root.isAttachedToWindow || map.mapLibreMap == null || surfaces.values.any { it.map === map }) invalid()
		val surface = Surface(UUID.randomUUID().toString(), root, map)
		surfaces[surface.id] = surface
		try { surface.attach() } catch (_: Exception) { surface.retire(); throw IllegalStateException("Native surface operation failed.") }
		Arguments.makeNativeMap(mapOf("surface" to surface.id))
	}
	@ReactMethod fun expectStyle(id: String, token: String, promise: Promise) = action(promise) {
		val surface = current(id)
		surface.state.expect(token); surface.token = token
		surface.deadline?.let { handler.removeCallbacks(it) }
		val deadline = Runnable { if (!surface.retiring && surface.token == token) surface.state.fail() }
		surface.deadline = deadline; handler.postDelayed(deadline, 30000)
		Arguments.makeNativeMap(mapOf("accepted" to true))
	}
	@ReactMethod fun acknowledgeSurface(id: String, sequence: Double, promise: Promise) = action(promise) {
		if (!AdmissionUrl.validToken(id)) invalid()
		surfaces[id]?.state?.acknowledge(integer(sequence))
		Arguments.makeNativeMap(mapOf("acknowledged" to true))
	}
	@ReactMethod fun commitLayout(id: String, token: String, promise: Promise) {
		handler.post {
			try {
				val surface = current(id)
				if (surface.layoutWaiter != null) invalid()
				val observer = surface.root.viewTreeObserver
				var settled = false
				lateinit var listener: ViewTreeObserver.OnPreDrawListener
				val finish: (Boolean) -> Unit = finish@ { success ->
					if (settled) return@finish
					settled = true
					if (observer.isAlive) observer.removeOnPreDrawListener(listener)
					surface.layoutWaiter = null
					try {
						if (!success || current(id) !== surface || surface.token != token) invalid()
						surface.sampleLayout()
						promise.resolve(Arguments.makeNativeMap(mapOf("layout" to surface.state.commit(token))))
					} catch (_: Exception) { reject(promise) }
				}
				listener = ViewTreeObserver.OnPreDrawListener { finish(true); true }
				surface.layoutWaiter = { finish(false) }
				observer.addOnPreDrawListener(listener)
				surface.root.invalidate()
			} catch (_: Exception) { reject(promise) }
		}
	}
	@ReactMethod fun requestFrame(id: String, token: String, promise: Promise) = action(promise) {
		val surface = current(id)
		if (surface.token != token) invalid()
		// Change only an invisible owner marker. The resulting native frame is the evidence.
		val layer = surface.style()?.getLayer(surface.marker()) as? BackgroundLayer ?: invalid()
		surface.repaint = !surface.repaint
		layer.setProperties(PropertyFactory.backgroundOpacity(if (surface.repaint) 0.0f else 0.0001f))
		Arguments.makeNativeMap(mapOf("requested" to true))
	}
	@ReactMethod fun applyCamera(id: String, sequence: Double, input: ReadableMap, promise: Promise) = action(promise) {
		val surface = current(id)
		val target = view(input)
		val number = integer(sequence)
		if (!surface.state.beginCommand(number)) invalid()
		val cameras = (0 until surface.map.featureCount).mapNotNull { surface.map.getFeatureAt(it)?.toView() as? MLRNCamera }
		if (cameras.size != 1) invalid()
		val command = Arguments.makeNativeMap(target + mapOf("duration" to 0))
		cameras.single().handleImperativeStop(command)
		val actual = surface.view()
		val expectedCenter = target["center"] as List<*>
		val actualCenter = actual["center"] as List<*>
		if (!nearAngular(actualCenter[0] as Double, expectedCenter[0] as Double) ||
			abs(actualCenter[1] as Double - expectedCenter[1] as Double) > 0.000001 ||
			abs(actual["zoom"] as Double - target["zoom"] as Double) > 0.000001 ||
			!nearAngular(actual["bearing"] as Double, target["bearing"] as Double) ||
			abs(actual["pitch"] as Double - target["pitch"] as Double) > 0.000001 || current(id) !== surface) invalid()
		Arguments.makeNativeMap(mapOf("command" to number, "view" to target))
	}
	@ReactMethod fun cancelCamera(id: String, sequence: Double, promise: Promise) = action(promise) {
		if (!AdmissionUrl.validToken(id)) invalid()
		surfaces[id]?.state?.cancelCommand(integer(sequence))
		Arguments.makeNativeMap(mapOf("cancelled" to true))
	}
	private fun nearAngular(a: Double, b: Double): Boolean = abs(((a - b + 540) % 360) - 180) <= 0.000001
	private fun view(input: ReadableMap): Map<String, Any> {
		val keys = input.keySetIterator(); var count = 0
		while (keys.hasNextKey()) if (++count > 4 || keys.nextKey() !in setOf("center", "zoom", "bearing", "pitch")) invalid()
		if (count != 4) invalid()
		val center = input.getArray("center") ?: invalid()
		if (center.size() != 2 || center.getType(0) != ReadableType.Number || center.getType(1) != ReadableType.Number) invalid()
		val longitude = center.getDouble(0); val latitude = center.getDouble(1)
		val zoom = input.getDouble("zoom"); val bearing = input.getDouble("bearing"); val pitch = input.getDouble("pitch")
		if (listOf(longitude, latitude, zoom, bearing, pitch).any { !it.isFinite() } || longitude !in -180.0..180.0 ||
			latitude !in -90.0..90.0 || zoom !in 0.0..24.0 || bearing !in -180.0..180.0 || pitch !in 0.0..85.0) invalid()
		return mapOf("center" to listOf(longitude, latitude), "zoom" to zoom, "bearing" to bearing, "pitch" to pitch)
	}

	@ReactMethod fun retireSurface(id: String, promise: Promise) {
		handler.post {
			try {
				if (!AdmissionUrl.validToken(id)) invalid()
				val surface = surfaces[id]
				if (surface == null) { promise.resolve(Arguments.makeNativeMap(mapOf("detached" to true))); return@post }
				surface.retire()
				waitForRoot(surface.root, promise)
			} catch (_: Exception) { reject(promise) }
		}
	}
	@ReactMethod fun retireRoot(tag: Double, promise: Promise) {
		handler.post {
			try {
				if (tag < 1 || tag != tag.toInt().toDouble()) invalid()
				val root = root(tag.toInt())
				if (root == null) { promise.resolve(Arguments.makeNativeMap(mapOf("detached" to true))); return@post }
				for (surface in surfaces.values.toList()) if (surface.root === root) surface.retire()
				waitForRoot(root, promise)
			} catch (_: Exception) { reject(promise) }
		}
	}
	private fun waitForRoot(root: View, promise: Promise) {
		if (!root.isAttachedToWindow) { promise.resolve(Arguments.makeNativeMap(mapOf("detached" to true))); return }
		val existing = rootRetirements[root.id]
		if (existing != null) { if (existing.root !== root || existing.waiters.size >= 16) invalid(); existing.waiters.add(promise); return }
		if (rootRetirements.size >= 16) invalid()
		val retirement = RootRetirement(root); retirement.waiters.add(promise); rootRetirements[root.id] = retirement
		root.addOnAttachStateChangeListener(retirement)
		// A deadline can report failed cleanup, never successful detachment.
		handler.postDelayed({ if (rootRetirements[root.id] === retirement) retirement.timeout() }, 30000)
	}
	private inner class RootRetirement(val root: View) : View.OnAttachStateChangeListener {
		val waiters = mutableListOf<Promise>()
		override fun onViewAttachedToWindow(view: View) {}
		override fun onViewDetachedFromWindow(view: View) {
			root.removeOnAttachStateChangeListener(this); rootRetirements.remove(root.id)
			for (promise in waiters.toList()) promise.resolve(Arguments.makeNativeMap(mapOf("detached" to true)))
			waiters.clear()
		}
		fun timeout() { for (promise in waiters.toList()) reject(promise); waiters.clear() }
	}

	private inner class Surface(val id: String, val root: View, val map: MLRNMapView) : View.OnAttachStateChangeListener {
		val sdk = map.mapLibreMap ?: invalid()
		val state = NativeSurfaceState(id) { event ->
			if (event["kind"] == "render") deadline?.let { handler.removeCallbacks(it); deadline = null }
			if (!invalidated && listeners > 0) reactApplicationContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java).emit("TileflowNativeSurfaceEvent", Arguments.makeNativeMap(event))
			else invalid()
		}
		var token = ""
		var repaint = false
		var retiring = false
		var deadline: Runnable? = null
		var layoutWaiter: (() -> Unit)? = null
		private var layoutSnapshot: List<Int>? = null
		fun marker() = "__tileflow_native_style_$token"
		fun style(): Style? = sdk.style?.takeIf { it.isFullyLoaded && it.getLayer(marker()) != null }
		fun view(): Map<String, Any> {
			val position = sdk.cameraPosition; val center = position.target ?: invalid()
			val longitude = ((center.longitude + 540) % 360) - 180
			val bearing = ((position.bearing + 540) % 360) - 180
			return mapOf("center" to listOf(longitude, center.latitude), "zoom" to position.zoom, "bearing" to bearing, "pitch" to position.tilt)
		}
		private fun guarded(action: () -> Unit) { if (!retiring) try { action() } catch (_: Exception) { state.fail() } }
		private val loaded = MapView.OnDidFinishLoadingStyleListener { guarded { style()?.let { state.loaded(token, it) } } }
		private val frameStart = MapView.OnWillStartRenderingFrameListener { guarded { sampleLayout(); state.frameStart(style()) } }
		private val frameEnd = MapView.OnDidFinishRenderingFrameListener { fully, _, _ -> guarded { state.frameEnd(style(), fully) } }
		private val mapEnd = MapView.OnDidFinishRenderingMapListener { fully -> guarded { state.mapRendered(style(), fully) } }
		private val cameraStart = MapLibreMap.OnCameraMoveStartedListener { reason -> guarded {
			if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) state.gestureStart(view())
			else state.gestureEnd(view())
		} }
		private val cameraMove = MapLibreMap.OnCameraMoveListener { guarded { state.gestureChange(view()) } }
		private val cameraEnd = MapLibreMap.OnCameraIdleListener { guarded { state.gestureEnd(view()) } }
		private val layout = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> guarded { sampleLayout() } }
		fun sampleLayout() {
			val snapshot = listOf(root.width, root.height, map.width, map.height, root.left, root.top, if (root.isAttachedToWindow && map.isAttachedToWindow && foreground) 1 else 0)
			if (snapshot == layoutSnapshot) return
			layoutSnapshot = snapshot
			state.layout(snapshot.last() == 1 && snapshot.take(4).all { it > 0 })
		}
		fun attach() {
			root.addOnAttachStateChangeListener(this); root.addOnLayoutChangeListener(layout); map.addOnLayoutChangeListener(layout)
			map.addOnDidFinishLoadingStyleListener(loaded); map.addOnWillStartRenderingFrameListener(frameStart)
			map.addOnDidFinishRenderingFrameListener(frameEnd); map.addOnDidFinishRenderingMapListener(mapEnd)
			sdk.addOnCameraMoveStartedListener(cameraStart); sdk.addOnCameraMoveListener(cameraMove); sdk.addOnCameraIdleListener(cameraEnd)
			sampleLayout()
		}
		fun retire() {
			if (retiring) return
			retiring = true; state.close(); deadline?.let { handler.removeCallbacks(it) }; deadline = null
			layoutWaiter?.invoke(); layoutWaiter = null
			root.removeOnLayoutChangeListener(layout); map.removeOnLayoutChangeListener(layout)
			map.removeOnDidFinishLoadingStyleListener(loaded); map.removeOnWillStartRenderingFrameListener(frameStart)
			map.removeOnDidFinishRenderingFrameListener(frameEnd); map.removeOnDidFinishRenderingMapListener(mapEnd)
			sdk.removeOnCameraMoveStartedListener(cameraStart); sdk.removeOnCameraMoveListener(cameraMove); sdk.removeOnCameraIdleListener(cameraEnd)
			if (!root.isAttachedToWindow) onViewDetachedFromWindow(root)
		}
		override fun onViewAttachedToWindow(view: View) { guarded { sampleLayout() } }
		override fun onViewDetachedFromWindow(view: View) {
			retire(); root.removeOnAttachStateChangeListener(this); surfaces.remove(id)
		}
	}
	override fun onHostPause() { handler.post { foreground = false; for (surface in surfaces.values) surface.sampleLayout() } }
	override fun onHostResume() { handler.post { foreground = true; for (surface in surfaces.values) surface.sampleLayout() } }
	override fun onHostDestroy() { handler.post { invalidated = true; for (surface in surfaces.values.toList()) surface.retire() } }
	override fun invalidate() { reactApplicationContext.removeLifecycleEventListener(this); onHostDestroy(); super.invalidate() }
}
