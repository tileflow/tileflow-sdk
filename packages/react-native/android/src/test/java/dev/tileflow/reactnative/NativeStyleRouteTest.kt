package dev.tileflow.reactnative

import org.junit.Assert.*
import org.junit.Test

class NativeStyleRouteTest {
	private val map = "map_0123456789abcdef"
	private val other = "map_abcdefghijklmnop"
	private val origin = "https://api.example.test"
	private val url = "$origin/maps/$map/native/v7/light.json"
	private val authority = AdmissionAuthority("redacted", map, listOf(origin), listOf("style"), emptyList())

	@Test fun exactVersionedStylesRetainCatalogAndMapIdentity() {
		for (version in listOf(1L, 7L, 9007199254740991L)) {
			val value = "$origin/maps/$map/native/v$version/light.json"
			val resource = AdmissionCatalog(listOf(AdmissionResource(value, "style", null))).find(value)!!
			assertEquals(value, resource.url)
			assertTrue(AdmissionUrl.styleMatchesMap(value, map))
			assertTrue(authority.allows(resource, map))
			assertFalse(authority.allows(resource, other))
		}
		val catalog = AdmissionCatalog(listOf(AdmissionResource(url, "style", null)))
		assertNull(catalog.find(url.replace("v7", "v8")))
		assertNull(catalog.find(url.replace(map, other)))
	}

	@Test fun reservedRoutesCannotBecomeManifestAliasesOrCrossMapGrants() {
		for (value in listOf(
			url.replace("v7", "v0"), url.replace("v7", "v07"),
			url.replace("v7", "v9007199254740992"), url.replace("v7", "v-1"),
			url.replace("/native/", "/%6eative/"), url.replace("light.json", "%6cight.json"),
			"$url?map=$map", "$url#fragment", url.replace(map, other),
			"$origin/maps/$map/native/manifest.json"
		)) {
			assertFalse(AdmissionUrl.styleMatchesMap(value, map))
			assertFalse(authority.allows(AdmissionResource(value, "style", null), map))
		}
		assertTrue(authority.allows(AdmissionResource("$origin/maps/$map/light.json", "style", null), map))
	}
}
