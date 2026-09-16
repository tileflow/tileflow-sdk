package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class NativeDocumentShutdownTest {
	@Test fun aCancellationFailureCannotLeaveAnotherDocumentLive() {
		for (mode in listOf("context", "background", "close")) {
			val scheduler = ManualAdmissionScheduler()
			val guards = mutableListOf<() -> Boolean>()
			var sequence = 0
			val registry = NativeDocumentRegistry(scheduler, { _, _, _, guard, _ ->
				guards.add(guard)
				AdmissionCancellation { throw IllegalStateException("Untrusted cleanup failure.") }
			}, { "document-${++sequence}" })
			val scope = NativeDocumentScope({ true }, { _, _ -> AdmissionCancellation {} }, "context-1")
			repeat(2) { registry.open("https://maps.example.test/manifest.json", 1024, scope) }
			when (mode) {
				"context" -> registry.retireContext("context-1")
				"background" -> registry.lifecycle(false)
				else -> registry.close()
			}
			assertTrue(guards.all { !it() })
		}
	}
}
