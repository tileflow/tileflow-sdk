package dev.tileflow.reactnative

import java.io.ByteArrayInputStream
import java.io.IOException
import java.io.InputStream
import org.junit.Assert.*
import org.junit.Test

class NativeDocumentBodyTest {
	@Test fun bodyReadsNeverExceedTheRequestedBudgetPlusOneByte() {
		for (size in listOf(0, 1, 2, 3, 10000)) {
			var count = 0
			val source = object : InputStream() {
				override fun read(): Int { if (count == size) return -1; count++; return 97 }
			}
			if (size <= 2) assertEquals(size, readNativeDocumentBody(source, 2, -1) { true }.size)
			else {
				try { readNativeDocumentBody(source, 2, -1) { true }; fail("Expected byte bound.") }
				catch (error: IOException) { assertEquals("Native document acquisition failed.", error.message) }
			}
			assertTrue(count <= 3)
		}
	}
	@Test fun anOversizedDeclaredBodyIsNotRead() {
		val source = object : InputStream() { override fun read(): Int = error("Unexpected body read.") }
		try { readNativeDocumentBody(source, 2, 3) { true }; fail("Expected declared byte bound.") }
		catch (_: IOException) { }
	}
	@Test fun cancellationIsCheckedBeforeEachReadWithoutJavaScriptTimers() {
		var reads = 0
		val source = ByteArrayInputStream(ByteArray(65536))
		try { readNativeDocumentBody(source, 65536, -1) { ++reads <= 1 }; fail("Expected cancellation.") }
		catch (_: IOException) { }
		assertTrue(source.available() > 0)
	}
}
