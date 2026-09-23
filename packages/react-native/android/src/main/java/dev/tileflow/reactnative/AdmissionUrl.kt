package dev.tileflow.reactnative

import java.net.URI
import java.util.Locale
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

internal object AdmissionUrl {
	private const val PARAMETER = "__tf_native_context"
	private val token = Regex("[A-Za-z0-9_.-]{1,96}")
	private val compact = Regex("[A-Za-z0-9._:-]{1,255}")
	private val scopes = setOf("style", "tilejson", "tile", "sprite", "glyph", "font")
	private val percent = Regex("%([0-9a-fA-F]{2})")
	private val nativeStyle = Regex("/maps/(map_[A-Za-z0-9_-]{16})/native/v([1-9][0-9]{0,15})/([A-Za-z][A-Za-z0-9_-]{0,63})\\.json")
	private val reservedStyle = Regex("^/maps/[^/?#]+/native(?:[/?#]|$)")
	private fun decoded(value: String) = percent.replace(value) { it.groupValues[1].toInt(16).toChar().toString() }
	fun validToken(value: String) = token.matches(value) && !value.startsWith("tf_")
	fun reserved(value: String): Boolean {
		val query = value.indexOf('?')
		if (query < 0) return false
		return value.substring(query + 1).split('&').any {
			decoded(it.substringBefore('=')).lowercase(Locale.ROOT).startsWith("__tf_native")
		}
	}
	fun origin(value: String): String {
		val parsed = value.toHttpUrlOrNull() ?: invalid()
		val port = if (parsed.port == 443) "" else ":${parsed.port}"
		val host = if (parsed.host.contains(':')) "[${parsed.host}]" else parsed.host
		return "${parsed.scheme}://$host$port"
	}
	fun styleMatchesMap(value: String, mapId: String): Boolean {
		return try {
			val path = value.substring(origin(value).length)
			if (!reservedStyle.containsMatchIn(decoded(path))) true
			else {
				val match = nativeStyle.matchEntire(path)
				val version = match?.groupValues?.get(2)?.toLongOrNull()
				match != null && match.groupValues[1] == mapId && version != null && version in 1L..9007199254740991L
			}
		} catch (_: Exception) { false }
	}
	fun clean(value: String): String {
		if (value.length > AdmissionLimits.URL || value.any { it.code !in 33..126 || it == '\\' || it == '#' } || reserved(value)) invalid()
		val parsed = value.toHttpUrlOrNull() ?: invalid()
		if (parsed.scheme != "https" || parsed.username.isNotEmpty() || parsed.password.isNotEmpty() || parsed.toString() != value) invalid()
		val text = decoded(value).lowercase(Locale.ROOT)
		if (text.contains("tf_native_") || text.contains("tf_public_")) invalid()
		return value
	}
	fun resource(value: AdmissionResource): AdmissionResource {
		clean(value.url)
		if (value.url.length > AdmissionLimits.URL - 128 || !scopes.contains(value.scope)) invalid()
		if ((value.scope == "tile" || value.scope == "tilejson") && value.tilesetId == null) invalid()
		value.tilesetId?.let {
			if (!compact.matches(it) || it.contains("tf_native_", true) || it.contains("tf_public_", true)) invalid()
		}
		return value
	}
	class Discriminated(val context: String, val url: String)
	fun strip(value: String): Discriminated {
		if (value.length > AdmissionLimits.URL || value.contains('#') || value.contains('\\')) invalid()
		val queryAt = value.indexOf('?')
		if (queryAt < 0) invalid()
		val parts = value.substring(queryAt + 1).split('&')
		val matches = parts.withIndex().filter {
			decoded(it.value.substringBefore('=')).lowercase(Locale.ROOT).startsWith("__tf_native")
		}
		if (matches.size != 1) invalid()
		val selected = matches.single()
		if (!selected.value.startsWith("$PARAMETER=")) invalid()
		val context = selected.value.substring(PARAMETER.length + 1)
		if (!validToken(context)) invalid()
		val remaining = parts.filterIndexed { index, _ -> index != selected.index }
		val url = value.substring(0, queryAt) + if (remaining.isEmpty()) "" else "?" + remaining.joinToString("&")
		return Discriminated(context, clean(url))
	}
	fun redirect(previous: String, location: String, context: String): String {
		if (location.length > AdmissionLimits.URL || location.any { it.code !in 33..126 } || location.contains('\\')) invalid()
		val resolved = try { URI(previous).resolve(location).toString() } catch (_: Exception) { invalid() }
		val clean = if (reserved(resolved)) {
			val tagged = strip(resolved)
			if (tagged.context != context) invalid()
			tagged.url
		} else clean(resolved)
		if (origin(clean) != origin(previous)) invalid()
		return clean
	}
	private fun invalid(): Nothing = throw IllegalArgumentException("Invalid native resource")
}
