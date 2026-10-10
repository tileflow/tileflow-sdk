package dev.tileflow.reactnative

import android.graphics.Bitmap
import android.graphics.Color
import com.facebook.react.bridge.DynamicFromObject
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NativeThemeTest {
	@Test fun valuesBecomePlainJavaValuesForMapLibre() {
		val curve = JavaOnlyArray.of("interpolate", JavaOnlyArray.of("linear"), JavaOnlyArray.of("zoom"), 10.0, "#000000", 14.0, "#ffffff")
		val value = NativeTheme.value(DynamicFromObject(curve)) as Array<*>
		assertEquals("interpolate", value[0])
		assertArrayEquals(arrayOf<Any?>("zoom"), value[2] as Array<*>)
		assertEquals(14.0, value[5])
		assertNull(NativeTheme.value(DynamicFromObject(null)))
		val options = NativeTheme.value(DynamicFromObject(JavaOnlyMap.of("min-fraction-digits", 1.0))) as Map<*, *>
		assertEquals(1.0, options["min-fraction-digits"])
		var nested: Any = JavaOnlyArray.of(1.0)
		repeat(40) { nested = JavaOnlyArray.of(nested) }
		assertThrows(IllegalStateException::class.java) { NativeTheme.value(DynamicFromObject(nested)) }
	}

	@Test fun homographyMapsTheFourGroundPoints() {
		val from = floatArrayOf(10f, 45f, 90f, 45f, 90f, 90f, 10f, 90f)
		val to = floatArrayOf(20f, 40f, 100f, 50f, 80f, 100f, 5f, 85f)
		val matrix = NativeTheme.homography(from, to)!!
		val points = from.copyOf()
		matrix.mapPoints(points)
		for (index in points.indices) assertEquals(to[index], points[index], 0.01f)
		assertNull(NativeTheme.homography(from, floatArrayOf(0f, 0f, 1f, 1f, 2f, 2f, 3f, Float.NaN)))
	}

	@Test fun patternArtworkMixesInPremultipliedPixels() {
		val black = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.BLACK) }
		val white = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.WHITE) }
		assertSame(black, NativeTheme.mix(black, white, 0.0))
		assertSame(white, NativeTheme.mix(black, white, 1.0))
		val mixed = NativeTheme.mix(black, white, 0.25).getPixel(1, 1)
		assertEquals(255, Color.alpha(mixed))
		assertEquals(64.0, Color.red(mixed).toDouble(), 2.0)
		val wide = Bitmap.createBitmap(4, 2, Bitmap.Config.ARGB_8888)
		assertSame(black, NativeTheme.mix(black, wide, 0.25))
	}
}
