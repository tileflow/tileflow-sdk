package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class AdmissionCatalogTest {
	private val tile = AdmissionResource("https://tiles.example.test/world/{z}/{x}/{y}.pbf?r=3", "tile", "world", "tile")
	private val glyph = AdmissionResource("https://assets.example.test/fonts/{fontstack}/{range}.pbf", "glyph", null, "glyphs", listOf("Noto Sans Regular"))

	@Test fun concreteRequestsRetainTheirExactClassAndTileset() {
		val catalog = AdmissionCatalog(listOf(tile, glyph))
		val url = "https://tiles.example.test/world/2/3/1.pbf?r=3"
		val resource = catalog.find(url)!!
		assertEquals(url, resource.url)
		assertEquals("tile", resource.scope)
		assertEquals("world", resource.tilesetId)
		assertNull(resource.template)
		assertNotNull(catalog.find("https://assets.example.test/fonts/Noto%20Sans%20Regular/0-255.pbf"))
	}

	@Test fun unsafeOrAmbiguousExpansionsFailWithoutChangingIdentity() {
		val catalog = AdmissionCatalog(listOf(tile, glyph))
		for (url in listOf(
			"https://tiles.example.test/world/2/4/1.pbf?r=3",
			"https://tiles.example.test/world/02/3/1.pbf?r=3",
			"https://tiles.example.test/world/2/%33/1.pbf?r=3",
			"https://tiles.example.test/other/2/3/1.pbf?r=3",
			"https://tiles.example.test:444/world/2/3/1.pbf?r=3",
			"https://tiles.example.test/world/2/3/1.pbf?r=4",
			"https://assets.example.test/fonts/Noto%20Sans%20Italic/0-255.pbf",
			"https://assets.example.test/fonts/Noto%20Sans%20Regular/1-256.pbf"
		)) assertNull(catalog.find(url))
		val exact = AdmissionResource("https://tiles.example.test/world/2/3/1.pbf?r=3", "tile", "other")
		try { AdmissionCatalog(listOf(tile, exact)).find(exact.url); fail("Expected ambiguous catalog rejection.") }
		catch (error: IllegalArgumentException) { assertEquals("Invalid native resource catalog", error.message) }
	}

	@Test fun validatesTemplatesBeforeRegistrationAndRetainsBounds() {
		for (resource in listOf(
			AdmissionResource("https://{x}.example.test/{z}/{x}/{y}.pbf", "tile", "world", "tile"),
			AdmissionResource(tile.url, "style", null, "tile"),
			AdmissionResource(tile.url, "tile", "world", "unknown"),
			AdmissionResource(glyph.url, "glyph", null, "glyphs", emptyList()),
			AdmissionResource(glyph.url, "glyph", null, "glyphs", listOf("Noto/Other"))
		)) {
			try { AdmissionCatalog(listOf(resource)); fail("Expected template rejection.") }
			catch (error: IllegalArgumentException) { assertFalse(error.message.orEmpty().contains("example.test")) }
		}
		try { AdmissionCatalog(List(129) { AdmissionResource("https://assets.example.test/$it.png", "sprite", null) }); fail("Expected catalog bound.") }
		catch (_: IllegalArgumentException) { }
	}
}
