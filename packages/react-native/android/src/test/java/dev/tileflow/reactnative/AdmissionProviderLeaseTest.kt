package dev.tileflow.reactnative

import java.lang.reflect.Proxy
import org.junit.Assert.*
import org.junit.Test
import org.maplibre.android.ModuleProvider

class AdmissionProviderLeaseTest {
	private fun provider(): ModuleProvider = Proxy.newProxyInstance(ModuleProvider::class.java.classLoader, arrayOf(ModuleProvider::class.java)) { _, _, _ -> null } as ModuleProvider

	@Test fun installationAndRemovalAreOwnedIdempotentAndNeverOverwriteALaterProvider() {
		val original = provider(); val installed = provider(); val later = provider()
		var current = original
		val lease = AdmissionProviderLease({ current }, { current = it })
		assertSame(original, lease.previous)
		lease.install(installed)
		assertTrue(lease.owns())
		current = later
		assertFalse(lease.owns())
		assertEquals(mapOf("removed" to false, "ownershipLost" to true), lease.remove())
		assertSame(later, current)
		assertEquals(lease.remove(), lease.remove())
		assertThrows(IllegalArgumentException::class.java) { lease.install(installed) }
	}

	@Test fun acknowledgedRemovalRestoresOnlyTheOwnedInstallation() {
		val original = provider(); var current = original
		var writes = 0
		val lease = AdmissionProviderLease({ current }, { current = it; writes++ })
		lease.install(provider())
		assertEquals(mapOf("removed" to true, "ownershipLost" to false), lease.remove())
		assertSame(original, current)
		assertFalse(lease.owns())
		lease.remove(); lease.remove()
		assertEquals(2, writes)
	}

	@Test fun failedInstallRollsBackAWriteThatSucceededBeforeThrowing() {
		val original = provider(); val candidate = provider(); var current = original
		val lease = AdmissionProviderLease({ current }, {
			current = it
			if (it === candidate) throw IllegalStateException("Installation failed")
		})
		assertThrows(IllegalArgumentException::class.java) { lease.install(candidate) }
		assertSame(original, current)
		assertFalse(lease.owns())
		assertEquals(mapOf("removed" to true, "ownershipLost" to false), lease.remove())
	}

	@Test fun failedInstallPreservesAnInterveningMutation() {
		val original = provider(); val later = provider(); var current = original
		val lease = AdmissionProviderLease({ current }, { current = later })
		assertThrows(IllegalArgumentException::class.java) { lease.install(provider()) }
		assertSame(later, current)
		assertFalse(lease.owns())
		assertEquals(mapOf("removed" to false, "ownershipLost" to true), lease.remove())
	}
}
