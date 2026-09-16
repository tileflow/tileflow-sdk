package dev.tileflow.reactnative

import org.maplibre.android.ModuleProvider

// Install/remove run on the module's serial scheduler. Network threads only
// read owns(). Never restore a provider after another owner has replaced it.
internal class AdmissionProviderLease(
	private val read: () -> ModuleProvider,
	private val write: (ModuleProvider) -> Unit,
) {
	val previous: ModuleProvider = read()
	@Volatile private var candidate: ModuleProvider? = null
	@Volatile private var removal: Map<String, Boolean>? = null
	private var attempted = false

	fun install(provider: ModuleProvider) {
		if (attempted || removal != null || provider === previous) invalid()
		attempted = true
		try {
			if (read() !== previous) invalid()
			candidate = provider
			write(provider)
			if (read() !== provider) invalid()
		} catch (_: Exception) {
			// A setter may mutate successfully before throwing. Roll back only
			// when identity still proves that the candidate is ours.
			try { remove() } catch (_: Exception) { /* No acknowledgement on failed restoration. */ }
			invalid()
		}
	}

	fun owns(): Boolean = try {
		val installed = candidate
		installed != null && removal == null && read() === installed
	} catch (_: Exception) { false }

	fun remove(): Map<String, Boolean> {
		removal?.let { return it }
		val current = try { read() } catch (_: Exception) { invalid() }
		val installed = candidate
		if (current !== installed) {
			val restored = current === previous
			return mapOf("removed" to restored, "ownershipLost" to !restored).also { removal = it }
		}
		try { write(previous) } catch (_: Exception) {
			// Verify the postcondition even when the setter throws afterwards.
			if (try { read() !== previous } catch (_: Exception) { true }) invalid()
		}
		val after = try { read() } catch (_: Exception) { invalid() }
		if (after === installed) invalid()
		val restored = after === previous
		return mapOf("removed" to restored, "ownershipLost" to !restored).also { removal = it }
	}

	private fun invalid(): Nothing = throw IllegalArgumentException("Native provider ownership is unavailable")
}
