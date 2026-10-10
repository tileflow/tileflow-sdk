package dev.tileflow.reactnative

import android.graphics.Bitmap
import android.graphics.PointF
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.PixelCopy
import android.view.SurfaceView
import android.view.TextureView
import android.view.ViewTreeObserver
import android.view.animation.AccelerateDecelerateInterpolator
import android.widget.ImageView
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
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style
import org.maplibre.android.style.layers.Layer
import org.maplibre.android.style.layers.LayoutPropertyValue
import org.maplibre.android.style.layers.PaintPropertyValue
import org.maplibre.android.style.light.Position
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
	private fun current(id: String, allowFailed: Boolean = false): Surface {
		val surface = surfaces[id] ?: invalid()
		if (invalidated || surface.retiring || (!allowFailed && !surface.state.active) || root(surface.root.id) !== surface.root || mapIn(surface.root) !== surface.map) invalid()
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
		val surface = current(id, allowFailed = true)
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
		surface.style() ?: invalid()
		surface.state.request(token)
		surface.sdk.triggerRepaint()
		Arguments.makeNativeMap(mapOf("requested" to true))
	}
	@ReactMethod fun applyCamera(id: String, sequence: Double, input: ReadableMap, promise: Promise) = action(promise) {
		val surface = current(id)
		val target = view(input)
		val number = integer(sequence)
		val invalidation = surface.state.beginCommand(number)
		if (invalidation == 0L) invalid()
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
		Arguments.makeNativeMap(mapOf("command" to number, "invalidation" to invalidation, "view" to target))
	}
	@ReactMethod fun cancelCamera(id: String, sequence: Double, promise: Promise) = action(promise) {
		if (!AdmissionUrl.validToken(id)) invalid()
		surfaces[id]?.state?.cancelCommand(integer(sequence))
		Arguments.makeNativeMap(mapOf("cancelled" to true))
	}
	private fun duration(value: Double): Long {
		if (!value.isFinite() || value < 0 || value > 5000 || value != value.toLong().toDouble()) invalid()
		return value.toLong()
	}
	@ReactMethod fun coverSurface(id: String, milliseconds: Double, promise: Promise) {
		handler.post {
			try {
				val surface = current(id)
				val covered = { value: Boolean -> promise.resolve(Arguments.makeNativeMap(mapOf("covered" to value))) }
				if (duration(milliseconds) == 0L) covered(false) else surface.cover(covered)
			} catch (_: Exception) { reject(promise) }
		}
	}
	@ReactMethod fun revealSurface(id: String, milliseconds: Double, promise: Promise) {
		handler.post {
			try { current(id, allowFailed = true).reveal(duration(milliseconds), promise) }
			catch (_: Exception) { reject(promise) }
		}
	}
	@ReactMethod fun discardSurfaceCover(id: String, promise: Promise) = action(promise) {
		if (!AdmissionUrl.validToken(id)) invalid()
		surfaces[id]?.discardCovers()
		Arguments.makeNativeMap(mapOf("discarded" to true))
	}
	@ReactMethod fun applyThemeValues(id: String, token: String, values: ReadableMap, promise: Promise) = action(promise) {
		val surface = current(id)
		if (surface.token != token) invalid()
		Arguments.makeNativeMap(mapOf("applied" to surface.applyThemeValues(surface.style() ?: invalid(), values)))
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
		var retiring = false
		var deadline: Runnable? = null
		var layoutWaiter: (() -> Unit)? = null
		private val covers = mutableListOf<Cover>()
		private val reveals = mutableListOf<Reveal>()
		private val settling = mutableListOf<Reveal>()
		private var revealDeadline: Runnable? = null
		private var themedToken: String? = null
		private val themedLayers = HashMap<String, Layer>()
		private val themedImages = HashMap<String, Bitmap>()
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
		private val frameStart = MapView.OnWillStartRenderingFrameListener { guarded { sampleLayout(); state.frameStart(style()); followCovers() } }
		private val frameEnd = MapView.OnDidFinishRenderingFrameListener { fully, _, _ -> guarded {
			state.frameEnd(style(), fully)
			if (fully && reveals.isNotEmpty()) startReveals()
		} }
		private val cameraStart = MapLibreMap.OnCameraMoveStartedListener { reason -> guarded {
			if (reason == MapLibreMap.OnCameraMoveStartedListener.REASON_API_GESTURE) state.gestureStart(view())
			else state.gestureEnd(view())
		} }
		private val cameraMove = MapLibreMap.OnCameraMoveListener { guarded { state.gestureChange(view()); followCovers() } }
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
			map.addOnDidFinishRenderingFrameListener(frameEnd)
			sdk.addOnCameraMoveStartedListener(cameraStart); sdk.addOnCameraMoveListener(cameraMove); sdk.addOnCameraIdleListener(cameraEnd)
			sampleLayout()
		}
		fun retire() {
			if (retiring) return
			discardCovers()
			retiring = true; state.close(); deadline?.let { handler.removeCallbacks(it) }; deadline = null
			layoutWaiter?.invoke(); layoutWaiter = null
			root.removeOnLayoutChangeListener(layout); map.removeOnLayoutChangeListener(layout)
			map.removeOnDidFinishLoadingStyleListener(loaded); map.removeOnWillStartRenderingFrameListener(frameStart)
			map.removeOnDidFinishRenderingFrameListener(frameEnd)
			sdk.removeOnCameraMoveStartedListener(cameraStart); sdk.removeOnCameraMoveListener(cameraMove); sdk.removeOnCameraIdleListener(cameraEnd)
			if (!root.isAttachedToWindow) onViewDetachedFromWindow(root)
		}
		/** A snapshot of one frame over the rendering view that follows four of its ground points. */
		inner class Cover(val view: ImageView, val corners: FloatArray, val anchors: List<LatLng>) { var fading = false }
		inner class Reveal(val duration: Long, val covers: List<Cover>, var promise: Promise?)

		fun cover(covered: (Boolean) -> Unit) {
			val render = map.renderView
			if (!NativeTheme.motionEnabled(reactApplicationContext) || !foreground || style() == null || render == null ||
				render.width < 1 || render.height < 1 || covers.size >= 4) { covered(false); return }
			if (covers.any { !it.fading }) { covered(true); return }
			// Only the drawn map is copied; logo, attribution and markers stay live above the cover.
			when (render) {
				is TextureView -> covered(render.bitmap?.let { addCover(it) } ?: false)
				is SurfaceView -> {
					val bitmap = Bitmap.createBitmap(render.width, render.height, Bitmap.Config.ARGB_8888)
					PixelCopy.request(render, bitmap, { result ->
						covered(try { result == PixelCopy.SUCCESS && addCover(bitmap) } catch (_: Exception) { false })
					}, handler)
				}
				else -> covered(false)
			}
		}
		private fun addCover(bitmap: Bitmap): Boolean {
			val render = map.renderView
			if (retiring || style() == null || render == null || !NativeTheme.motionEnabled(reactApplicationContext)) return false
			val width = bitmap.width.toFloat(); val height = bitmap.height.toFloat()
			// Ground points below the horizon at any supported pitch, in snapshot pixels.
			val corners = floatArrayOf(width * 0.1f, height * 0.45f, width * 0.9f, height * 0.45f, width * 0.9f, height * 0.9f, width * 0.1f, height * 0.9f)
			val projection = sdk.projection
			val anchors = (0 until 4).map { projection.fromScreenLocation(PointF(corners[2 * it], corners[2 * it + 1])) }
			if (anchors.any { !it.latitude.isFinite() || !it.longitude.isFinite() }) return false
			val view = ImageView(map.context)
			view.scaleType = ImageView.ScaleType.MATRIX
			view.setImageBitmap(bitmap)
			view.isClickable = false; view.isFocusable = false
			view.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
			// Newer covers go below older ones, which keep fading on top.
			map.addView(view, map.indexOfChild(render) + 1, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
			// React Native lays out only the views it manages, so the cover is sized here.
			view.measure(View.MeasureSpec.makeMeasureSpec(map.width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(map.height, View.MeasureSpec.EXACTLY))
			view.layout(0, 0, map.width, map.height)
			covers.add(Cover(view, corners, anchors))
			followCovers()
			return true
		}
		private fun followCovers() {
			if (covers.isEmpty()) return
			val projection = sdk.projection
			for (cover in covers) {
				val target = FloatArray(8)
				cover.anchors.forEachIndexed { index, anchor ->
					val point = projection.toScreenLocation(anchor)
					target[2 * index] = point.x; target[2 * index + 1] = point.y
				}
				NativeTheme.homography(cover.corners, target)?.let { cover.view.imageMatrix = it }
			}
		}
		fun reveal(duration: Long, promise: Promise) {
			val reveal = Reveal(duration, covers.toList(), promise)
			if (reveal.covers.isEmpty()) { promise.resolve(Arguments.makeNativeMap(mapOf("revealed" to true))); return }
			reveals.add(reveal)
			// Fades start on the next complete frame, or after ten seconds at most.
			if (revealDeadline == null) {
				val timeout = Runnable { revealDeadline = null; startReveals() }
				revealDeadline = timeout; handler.postDelayed(timeout, 10000)
			}
			sdk.triggerRepaint()
		}
		private fun startReveals() {
			revealDeadline?.let { handler.removeCallbacks(it) }; revealDeadline = null
			val pending = reveals.toList(); reveals.clear()
			for (reveal in pending) {
				for (cover in reveal.covers) {
					if (cover.fading) continue
					cover.fading = true
					cover.view.animate().alpha(0f).setDuration(reveal.duration).setInterpolator(AccelerateDecelerateInterpolator())
						.withEndAction { removeCover(cover) }.start()
				}
				settle(reveal)
			}
		}
		private fun removeCover(cover: Cover) {
			cover.view.animate().cancel(); map.removeView(cover.view); covers.remove(cover)
			for (reveal in settling.toList()) settle(reveal)
		}
		// A reveal resolves once every cover that existed when it was requested is gone.
		private fun settle(reveal: Reveal) {
			if (reveal.covers.any { it in covers }) { if (reveal !in settling) settling.add(reveal); return }
			settling.remove(reveal)
			reveal.promise?.resolve(Arguments.makeNativeMap(mapOf("revealed" to true))); reveal.promise = null
		}
		fun discardCovers() {
			revealDeadline?.let { handler.removeCallbacks(it) }; revealDeadline = null
			for (cover in covers.toList()) { cover.view.animate().cancel(); map.removeView(cover.view) }
			covers.clear()
			for (reveal in reveals + settling) { reveal.promise?.resolve(Arguments.makeNativeMap(mapOf("revealed" to true))); reveal.promise = null }
			reveals.clear(); settling.clear()
		}

		fun applyThemeValues(style: Style, values: ReadableMap): Int {
			if (themedToken != token) {
				// Layers and original artwork belong to one style.
				themedToken = token; themedLayers.clear(); themedImages.clear()
			}
			var applied = 0
			for (group in listOf("paint", "layout")) {
				if (!values.hasKey(group)) continue
				val entries = values.getArray(group) ?: invalid()
				if (entries.size() > 8192) invalid()
				for (index in 0 until entries.size()) {
					val entry = entries.getArray(index) ?: invalid()
					if (entry.size() != 3 || entry.getType(0) != ReadableType.String || entry.getType(1) != ReadableType.String) invalid()
					val identifier = entry.getString(0) ?: invalid()
					val layer = themedLayers[identifier] ?: style.getLayer(identifier)?.also { themedLayers[identifier] = it } ?: continue
					val property = entry.getString(1) ?: invalid()
					val value = NativeTheme.value(entry.getDynamic(2))
					layer.setProperties(if (group == "paint") PaintPropertyValue(property, value) else LayoutPropertyValue(property, value))
					applied++
				}
			}
			if (values.hasKey("images")) {
				val images = values.getArray("images") ?: invalid()
				if (images.size() > 64) invalid()
				// Originals are read before any artwork is replaced, so tuples can share names.
				for (index in 0 until images.size()) {
					val entry = images.getArray(index) ?: invalid()
					if (entry.size() != 4 || (0 until 3).any { entry.getType(it) != ReadableType.String } || entry.getType(3) != ReadableType.Number) invalid()
					for (name in (0 until 3).map { entry.getString(it) ?: invalid() })
						if (!themedImages.containsKey(name)) style.getImage(name)?.let { themedImages[name] = it }
				}
				for (index in 0 until images.size()) {
					val entry = images.getArray(index) ?: invalid()
					val from = themedImages[entry.getString(1)] ?: continue
					val to = themedImages[entry.getString(2)] ?: continue
					val t = entry.getDouble(3)
					if (!t.isFinite() || t < 0 || t > 1) invalid()
					style.addImage(entry.getString(0) ?: invalid(), NativeTheme.mix(from, to, t))
					applied++
				}
			}
			if (values.hasKey("light")) {
				val light = values.getMap("light") ?: invalid()
				val target = style.light
				if (target != null) {
					if (light.hasKey("color") && light.getType("color") == ReadableType.String) target.setColor(light.getString("color") ?: invalid())
					if (light.hasKey("intensity") && light.getType("intensity") == ReadableType.Number) target.intensity = light.getDouble("intensity").toFloat()
					if (light.hasKey("position") && light.getType("position") == ReadableType.Array) {
						val position = light.getArray("position") ?: invalid()
						if (position.size() == 3 && (0 until 3).all { position.getType(it) == ReadableType.Number })
							target.position = Position(position.getDouble(0).toFloat(), position.getDouble(1).toFloat(), position.getDouble(2).toFloat())
					}
					applied++
				}
			}
			return applied
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
