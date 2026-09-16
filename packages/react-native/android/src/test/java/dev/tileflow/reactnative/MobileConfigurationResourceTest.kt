package dev.tileflow.reactnative

import android.util.TypedValue
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [35])
class MobileConfigurationResourceTest {
	@Test fun readsOnlyBoundedLiteralStringValues() {
		val value = TypedValue()
		value.type = TypedValue.TYPE_STRING
		value.string = "apiOrigin=https://api.example.test"
		assertEquals(value.string, mobileConfigurationLiteral(value))
		value.resourceId = 1
		assertNull(mobileConfigurationLiteral(value))
		value.resourceId = 0
		for (type in listOf(TypedValue.TYPE_REFERENCE, TypedValue.TYPE_ATTRIBUTE, TypedValue.TYPE_INT_BOOLEAN, TypedValue.TYPE_INT_DEC, TypedValue.TYPE_NULL)) {
			value.type = type
			assertNull(mobileConfigurationLiteral(value))
		}
		value.type = TypedValue.TYPE_STRING
		value.string = "x".repeat(2081)
		assertNull(mobileConfigurationLiteral(value))
		value.string = StringBuilder("apiOrigin=https://api.example.test")
		assertNull(mobileConfigurationLiteral(value))
	}
}
