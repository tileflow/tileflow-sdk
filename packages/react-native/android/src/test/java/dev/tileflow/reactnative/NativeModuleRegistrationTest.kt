package dev.tileflow.reactnative

import com.facebook.react.module.annotations.ReactModule
import org.junit.Assert.assertEquals
import org.junit.Test

class NativeModuleRegistrationTest {
	@Test fun admissionIsDiscoverableForProtectedDocuments() {
		val metadata = TileflowNativeAdmissionModule::class.java.getAnnotation(ReactModule::class.java)

		assertEquals("TileflowNativeAdmission", metadata?.name)
	}

	@Test fun documentsAreDiscoverableForContextRetirement() {
		val metadata = TileflowNativeDocumentsModule::class.java.getAnnotation(ReactModule::class.java)

		assertEquals("TileflowNativeDocuments", metadata?.name)
	}
}
