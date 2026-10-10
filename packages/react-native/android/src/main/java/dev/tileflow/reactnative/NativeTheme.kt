package dev.tileflow.reactnative

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Dynamic
import com.facebook.react.bridge.ReadableType
import kotlin.math.roundToInt

/** Pure helpers for theme transitions and blends on MapLibre Android. */
internal object NativeTheme {
	private const val maximumDepth = 32

	/** A style-specification value from JavaScript as the plain Java value MapLibre converts. */
	fun value(dynamic: Dynamic, depth: Int = 0): Any? {
		if (depth > maximumDepth) throw IllegalStateException("Native surface operation failed.")
		return when (dynamic.type) {
			ReadableType.Null -> null
			ReadableType.Boolean -> dynamic.asBoolean()
			ReadableType.Number -> dynamic.asDouble().also { if (!it.isFinite()) throw IllegalStateException("Native surface operation failed.") }
			ReadableType.String -> dynamic.asString()
			ReadableType.Array -> {
				val array = dynamic.asArray() ?: throw IllegalStateException("Native surface operation failed.")
				Array(array.size()) { index -> value(array.getDynamic(index), depth + 1) }
			}
			ReadableType.Map -> {
				val map = dynamic.asMap() ?: throw IllegalStateException("Native surface operation failed.")
				val result = HashMap<String, Any?>()
				val keys = map.keySetIterator()
				while (keys.hasNextKey()) {
					val key = keys.nextKey()
					result[key] = value(map.getDynamic(key), depth + 1)
				}
				result
			}
		}
	}

	/** Whether the device shows animations; the "remove animations" setting turns them off. */
	fun motionEnabled(context: Context): Boolean {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !ValueAnimator.areAnimatorsEnabled()) return false
		return Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
	}

	/** Pattern artwork mixed in premultiplied pixels: `from` at 1 - t plus `to` at t. */
	fun mix(from: Bitmap, to: Bitmap, t: Double): Bitmap {
		if (t <= 0) return from
		if (t >= 1) return to
		if (from.width != to.width || from.height != to.height) return if (t < 0.5) from else to
		val result = Bitmap.createBitmap(from.width, from.height, Bitmap.Config.ARGB_8888)
		result.density = from.density
		val canvas = Canvas(result)
		val paint = Paint()
		paint.alpha = ((1 - t) * 255).roundToInt()
		canvas.drawBitmap(from, 0f, 0f, paint)
		paint.alpha = (t * 255).roundToInt()
		paint.xfermode = PorterDuffXfermode(PorterDuff.Mode.ADD)
		canvas.drawBitmap(to, 0f, 0f, paint)
		return result
	}

	/** The projective transform taking four points to four points, or null when degenerate. */
	fun homography(from: FloatArray, to: FloatArray): Matrix? {
		if (from.size != 8 || to.size != 8 || to.any { !it.isFinite() }) return null
		val matrix = Matrix()
		return if (matrix.setPolyToPoly(from, 0, to, 0, 4)) matrix else null
	}
}
