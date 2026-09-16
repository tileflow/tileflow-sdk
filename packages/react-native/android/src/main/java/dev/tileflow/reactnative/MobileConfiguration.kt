package dev.tileflow.reactnative

import java.util.Locale

internal class MobileConfigurationException : RuntimeException("Native application configuration is invalid.")

/** The platform adapter must return only literal strings, never resolved resource aliases. */
internal interface MobileConfigurationValues : AutoCloseable {
	val size: Int
	val applicationOwned: Boolean
	fun literalString(index: Int): String?
	override fun close()
}

/** Application data only. Never use this object as Map, session or transport identity. */
internal class MobileConfiguration private constructor(val apiOrigin: String, val credential: String) {
	override fun toString() = "MobileConfiguration"

	companion object {
		private val originPattern = Regex("[Hh][Tt][Tt][Pp][Ss]://([A-Za-z0-9.-]+)(?::([1-9][0-9]{0,4}))?/?")
		private val labelPattern = Regex("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?")
		private val octetPattern = Regex("(?:0|[1-9][0-9]{0,2})")
		private fun invalid(): Nothing = throw MobileConfigurationException()

		private fun origin(input: String): String {
			if (input.isEmpty() || input.length > 2048) invalid()
			val match = originPattern.matchEntire(input) ?: invalid()
			val host = match.groupValues[1].lowercase(Locale.ROOT)
			val labels = host.split('.')
			if (host.length > 253 || labels.any { !labelPattern.matches(it) }) invalid()
			if (labels.last().first() !in 'a'..'z') {
				if (labels.size != 4 || labels.any { !octetPattern.matches(it) || it.toInt() > 255 }) invalid()
			}
			val port = match.groupValues[2].let { if (it.isEmpty()) 443 else it.toInt() }
			if (port > 65535) invalid()
			return "https://$host" + if (port == 443) "" else ":$port"
		}

		fun parse(input: Any?): MobileConfiguration {
			try {
				if (input !is List<*> || input.size != 2) invalid()
				var apiOrigin: String? = null
				var credential: String? = null
				for (item in input) {
					if (item !is String || item.length > 2080) invalid()
					val separator = item.indexOf('=')
					if (separator <= 0) invalid()
					val value = item.substring(separator + 1)
					when (item.substring(0, separator)) {
						"apiOrigin" -> { if (apiOrigin != null) invalid(); apiOrigin = origin(value) }
						"credential" -> {
							if (credential != null || value.length != 58 || !value.startsWith("tf_public_") ||
								value.substring(10).any { it !in '0'..'9' && it !in 'a'..'f' }) invalid()
							credential = value
						}
						else -> invalid()
					}
				}
				return MobileConfiguration(apiOrigin ?: invalid(), credential ?: invalid())
			} catch (_: Exception) { invalid() }
		}

		fun load(values: MobileConfigurationValues): MobileConfiguration {
			try {
				try {
					if (!values.applicationOwned || values.size != 2) invalid()
					return parse(listOf(values.literalString(0), values.literalString(1)))
				} finally { values.close() }
			} catch (_: Exception) { invalid() }
		}
	}
}

/** Process-scoped immutable configuration, including failed reads. Contains no React context. */
internal class MobileConfigurationCache {
	private var phase = 0
	private var configuration: MobileConfiguration? = null

	@Synchronized fun read(source: () -> MobileConfiguration): MobileConfiguration {
		if (phase == 2) return configuration ?: throw MobileConfigurationException()
		if (phase != 0) { phase = 3; throw MobileConfigurationException() }
		phase = 1
		try {
			val result = source()
			if (phase != 1) throw MobileConfigurationException()
			configuration = result
			phase = 2
			return result
		} catch (_: Exception) {
			configuration = null
			phase = 3
			throw MobileConfigurationException()
		}
	}
}
