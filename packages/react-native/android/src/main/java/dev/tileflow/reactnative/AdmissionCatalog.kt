package dev.tileflow.reactnative

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

/** A finite set of exact documents and narrowly typed URL expansions. */
internal class AdmissionCatalog(resources: List<AdmissionResource>) {
	private class Rule(val resource: AdmissionResource, val pattern: Regex?, val names: List<String>)
	private val rules: List<Rule>

	init {
		if (resources.size > AdmissionLimits.RESOURCES) invalid()
		val seen = mutableSetOf<String>()
		rules = resources.map {
			val resource = validate(it)
			if (!seen.add(resource.url)) invalid()
			if (resource.template == null) Rule(resource, null, emptyList())
			else {
				val names = mutableListOf<String>()
				var cursor = 0
				val expression = StringBuilder("^")
				for (match in placeholder.findAll(resource.url)) {
					val name = match.groupValues[1]
					if (names.size >= 16 || (names.isNotEmpty() && match.range.first == cursor)) invalid()
					expression.append(Regex.escape(resource.url.substring(cursor, match.range.first)))
					expression.append('(').append(slots[name] ?: invalid()).append(')')
					names.add(name)
					cursor = match.range.last + 1
				}
				if (names.isEmpty()) invalid()
				expression.append(Regex.escape(resource.url.substring(cursor))).append('$')
				Rule(resource, Regex(expression.toString()), names.toList())
			}
		}
	}

	fun find(url: String): AdmissionResource? {
		try { AdmissionUrl.clean(url) } catch (_: Exception) { return null }
		var found: AdmissionResource? = null
		for (rule in rules) {
			if (!matches(rule, url)) continue
			if (found != null) invalid()
			found = AdmissionResource(url, rule.resource.scope, rule.resource.tilesetId)
		}
		return found
	}

	private fun matches(rule: Rule, url: String): Boolean {
		val pattern = rule.pattern ?: return rule.resource.url == url
		val match = pattern.matchEntire(url) ?: return false
		val values = mutableMapOf<String, String>()
		for ((index, name) in rule.names.withIndex()) {
			val value = match.groupValues[index + 1]
			if (values.containsKey(name) && values[name] != value) return false
			values[name] = value
		}
		val zoom = values["z"]?.toIntOrNull()
		if (zoom != null && zoom > 30) return false
		for (name in listOf("x", "y")) {
			val coordinate = values[name]?.toLongOrNull() ?: continue
			if (coordinate >= (1L shl (zoom ?: 30))) return false
		}
		values["quadkey"]?.let { if (zoom != null && it.length != zoom) return false }
		values["bbox-epsg-3857"]?.let { box ->
			val numbers = box.split(',').map { it.toDoubleOrNull() ?: return false }
			if (numbers.size != 4 || numbers.any { !it.isFinite() || kotlin.math.abs(it) > 20037508.343 } || numbers[0] >= numbers[2] || numbers[1] >= numbers[3]) return false
		}
		values["range"]?.let { range ->
			val pair = range.split('-').map { it.toLongOrNull() ?: return false }
			if (pair.size != 2 || pair[0] % 256 != 0L || pair[1] != pair[0] + 255 || pair[1] > 1114111) return false
		}
		values["fontstack"]?.let { stack ->
			val decoded = try { decode(stack) } catch (_: Exception) { return false }
			if (rule.resource.fontStacks?.contains(decoded) != true) return false
		}
		return true
	}

	companion object {
		private val placeholder = Regex("\\{([a-z0-9-]+)\\}")
		private val decimal = "(?:0|[1-9][0-9]{0,9})"
		private val coordinate = "-?(?:0|[1-9][0-9]{0,7})(?:\\.[0-9]{1,16})?"
		private val slots = mapOf(
			"z" to "(?:0|[1-9][0-9]?)", "x" to decimal, "y" to decimal,
			"ratio" to "(?:@2x|@3x)?", "quadkey" to "[0-3]{0,30}", "prefix" to "[0-9a-f]{2}",
			"bbox-epsg-3857" to "$coordinate,$coordinate,$coordinate,$coordinate",
			"fontstack" to "(?:[A-Za-z0-9_.~,+-]|%[0-9a-fA-F]{2}){1,768}", "range" to "$decimal-$decimal"
		)
		private val scopes = setOf("style", "tilejson", "tile", "sprite", "glyph", "font")
		private val compact = Regex("[A-Za-z0-9._:-]{1,255}")

		fun validate(value: AdmissionResource): AdmissionResource {
			try {
				if (value.url.length > AdmissionLimits.URL - 128 || !scopes.contains(value.scope)) invalid()
				if ((value.scope == "tile" || value.scope == "tilejson") && value.tilesetId == null) invalid()
				value.tilesetId?.let { if (!compact.matches(it) || it.contains("tf_native_", true) || it.contains("tf_public_", true)) invalid() }
				if (value.template == null) {
					if (value.fontStacks != null || value.url.contains('{') || value.url.contains('}')) invalid()
					AdmissionUrl.clean(value.url)
					return AdmissionResource(value.url, value.scope, value.tilesetId)
				}
				if (value.template !in setOf("tile", "glyphs")) invalid()
				val authority = value.url.substringBefore('/', "").takeIf { it.isNotEmpty() }
				if (authority == null || !value.url.startsWith("https://")) invalid()
				val path = value.url.indexOf('/', 8)
				if (path < 0 || value.url.substring(0, path).any { it == '{' || it == '}' }) invalid()
				val names = placeholder.findAll(value.url).map { it.groupValues[1] }.toList()
				if (names.isEmpty() || names.size > 16 || names.any { !slots.containsKey(it) }) invalid()
				val masked = placeholder.replace(value.url, "native-template-slot")
				if (masked.contains('{') || masked.contains('}')) invalid()
				AdmissionUrl.clean(masked)
				if (value.template == "tile") {
					if (value.scope != "tile" || value.fontStacks != null || names.any { it == "fontstack" || it == "range" }) invalid()
					return AdmissionResource(value.url, value.scope, value.tilesetId, "tile")
				}
				val stacks = value.fontStacks ?: invalid()
				if (value.scope != "glyph" || !names.containsAll(listOf("fontstack", "range")) || names.any { it != "fontstack" && it != "range" } || stacks.isEmpty() || stacks.size > 16 || stacks.toSet().size != stacks.size) invalid()
				for (stack in stacks) {
					if (stack.isEmpty() || stack.length > 256 || stack != stack.trim() || stack.any { it.code < 32 || it.code in 127..159 || it in "\\/?#%&=" } || stack.contains("tf_native_", true) || stack.contains("tf_public_", true) || stack.split(',').any { it.isEmpty() || it != it.trim() }) invalid()
				}
				return AdmissionResource(value.url, value.scope, value.tilesetId, "glyphs", stacks.toList())
			} catch (_: Exception) { invalid() }
		}

		private fun decode(value: String): String {
			val bytes = ByteArrayOutputStream()
			var index = 0
			while (index < value.length) {
				if (value[index] == '%') { bytes.write(value.substring(index + 1, index + 3).toInt(16)); index += 3 }
				else { bytes.write(value[index].code); index++ }
			}
			return Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes.toByteArray())).toString()
		}
		private fun invalid(): Nothing = throw IllegalArgumentException("Invalid native resource catalog")
	}
}
