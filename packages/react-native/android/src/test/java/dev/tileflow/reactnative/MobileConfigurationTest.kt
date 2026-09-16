package dev.tileflow.reactnative

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test

class MobileConfigurationTest {
	private fun credential() = "tf_public_" + "a".repeat(48)
	private fun values(origin: String = "https://api.example.test"): List<String> = listOf("apiOrigin=$origin", "credential=${credential()}")

	private fun invalid(block: () -> Unit) {
		try { block(); fail("Expected configuration rejection.") }
		catch (error: MobileConfigurationException) {
			assertEquals("Native application configuration is invalid.", error.message)
			assertNull(error.cause)
			assertFalse(error.toString().contains(credential()))
			assertFalse(error.toString().contains("api.example.test"))
		}
	}

	@Test fun canonicalOriginsUseOneNarrowGrammar() {
		for ((input, expected) in listOf(
			"HTTPS://API.Example.test:443/" to "https://api.example.test",
			"https://api.example.test:8443/" to "https://api.example.test:8443",
			"https://127.0.0.1:65535" to "https://127.0.0.1:65535",
			"https://xn--bcher-kva.example" to "https://xn--bcher-kva.example",
			"https://localhost/" to "https://localhost"
		)) assertEquals(expected, MobileConfiguration.parse(values(input)).apiOrigin)
	}

	@Test fun rejectsAmbiguousOrNonOriginUrlsWithoutParserRecovery() {
		for (origin in listOf(
			"", " http://api.example.test", "https://api.example.test\n", "http://api.example.test",
			"//api.example.test", "https://api.example.test/path", "https://api.example.test//",
			"https://api.example.test/.", "https://api.example.test/..", "https://api.example.test?",
			"https://api.example.test/#", "https://user@api.example.test", "https://api.example.test\\",
			"https://api.%65xample.test", "https://bücher.example", "https://\u212A.example",
			"https://\u017F.example", "https://api.example.test.", "https://*.example.test",
			"https://bad_host.example", "https://-bad.example", "https://bad-.example", "https://a..example",
			"https://api.example.test:0", "https://api.example.test:0443", "https://api.example.test:65536",
			"https://api.example.test:", "https://127.1", "https://0177.0.0.1", "https://0x7f000001",
			"https://2130706433", "https://example.0x1", "https://256.0.0.1", "https://[::1]",
			"https://${"a".repeat(64)}.example", "https://${"a".repeat(2048)}"
		)) invalid { MobileConfiguration.parse(values(origin)) }
	}

	@Test fun rejectsMissingWrongTypesAndEveryDuplicateWithoutPrecedence() {
		for (input in listOf<Any?>(
			null, "configuration", mapOf("apiOrigin" to "https://api.example.test"), emptyList<String>(),
			listOf(values()[0]), listOf(values()[0], 1), listOf(values()[0], null),
			listOf(values()[0], "credential="), listOf(values()[0], "credential=${credential()}\n"),
			listOf(values()[0], "credential=${credential().uppercase()}"),
			listOf(values()[0], "credential=tf_public_${"a".repeat(47)}"),
			listOf(values()[0], "credential=tf_public_${"a".repeat(49)}"),
			listOf(values()[0], "credential=tf_public_${"g".repeat(48)}"),
			listOf(values()[0], values()[0]), listOf(values()[0], "apiOrigin=https://other.example"),
			values() + values()[1], values() + "unknown=value", listOf(values()[0], "Credential=${credential()}")
		)) invalid { MobileConfiguration.parse(input) }
		assertEquals(credential(), MobileConfiguration.parse(values().reversed()).credential)
	}

	@Test fun snapshotsMutableInputAndRedactsObjectDescriptions() {
		val input = values().toMutableList()
		val parsed = MobileConfiguration.parse(input)
		input[0] = "apiOrigin=https://changed.example"
		input[1] = "credential=changed"
		assertEquals("https://api.example.test", parsed.apiOrigin)
		assertEquals(credential(), parsed.credential)
		assertEquals("MobileConfiguration", parsed.toString())
	}

	@Test fun boundsAndClosesResourceInputIncludingFailure() {
		for (size in listOf(0, 1, 2, 3, Int.MAX_VALUE)) {
			var reads = 0
			var closes = 0
			val resource = object : MobileConfigurationValues {
				override val size = size
				override val applicationOwned = true
				override fun literalString(index: Int): String { reads++; return values()[index] }
				override fun close() { closes++ }
			}
			if (size == 2) assertEquals(credential(), MobileConfiguration.load(resource).credential)
			else invalid { MobileConfiguration.load(resource) }
			assertEquals(if (size == 2) 2 else 0, reads)
			assertEquals(1, closes)
		}
		for (owned in listOf(false, true)) {
			var closes = 0
			invalid { MobileConfiguration.load(object : MobileConfigurationValues {
				override val size = 2
				override val applicationOwned = owned
				// Resource references and non-string native values never become literals.
				override fun literalString(index: Int): String? = null
				override fun close() { closes++ }
			}) }
			assertEquals(1, closes)
		}
	}

	@Test fun cachesSuccessFailureAndReentrantFailureOnce() {
		val cache = MobileConfigurationCache()
		var calls = 0
		val first = cache.read { calls++; MobileConfiguration.parse(values()) }
		assertSame(first, cache.read { calls++; throw IllegalStateException("Unexpected read.") })
		assertEquals(1, calls)
		val broken = MobileConfigurationCache()
		repeat(2) { invalid { broken.read { calls++; throw IllegalStateException(credential()) } } }
		assertEquals(2, calls)
		val reentrant = MobileConfigurationCache()
		invalid { reentrant.read {
			invalid { reentrant.read { MobileConfiguration.parse(values()) } }
			MobileConfiguration.parse(values())
		} }
		invalid { reentrant.read { MobileConfiguration.parse(values()) } }
	}

	@Test fun concurrentReadsShareOnlyApplicationData() {
		val cache = MobileConfigurationCache()
		val entered = CountDownLatch(1)
		val release = CountDownLatch(1)
		val executor = Executors.newFixedThreadPool(2)
		try {
			val first = executor.submit<MobileConfiguration> { cache.read {
				entered.countDown()
				check(release.await(5, TimeUnit.SECONDS))
				MobileConfiguration.parse(values())
			} }
			assertTrue(entered.await(5, TimeUnit.SECONDS))
			val second = executor.submit<MobileConfiguration> { cache.read { error("Unexpected second read.") } }
			release.countDown()
			assertSame(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS))
		} finally { release.countDown(); executor.shutdownNow() }
	}
}
