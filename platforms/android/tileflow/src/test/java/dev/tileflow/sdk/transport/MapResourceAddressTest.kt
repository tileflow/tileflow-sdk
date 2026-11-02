package dev.tileflow.sdk.transport

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The addresses MapLibre Native requests: the map's context and its remote resource, no more. */
class MapResourceAddressTest {
    private val context = "AAAAAAAAAAAAAAAAAAAAAA"

    @Test
    fun anAddressNamesItsMapAndItsRemoteResource() {
        val remote = "https://tiles.tileflow.test:8443/tiles/world/1/{z}/{x}/{y}.pbf?map=map_1"
        val address = MapResourceAddress.encode(remote, context)!!
        assertTrue(address.startsWith("https://tileflow.invalid/$context/"))
        // The engine substitutes the placeholders in the address as it would in the remote URL.
        assertTrue(address.endsWith("/tiles/world/1/{z}/{x}/{y}.pbf?map=map_1"))
        val requested = address.replace("{z}", "15").replace("{x}", "16030").replace("{y}", "12393")
        val (decodedContext, decoded) = MapResourceAddress.decode(requested)!!
        assertEquals(context, decodedContext)
        assertEquals(
            URI("https://tiles.tileflow.test:8443/tiles/world/1/15/16030/12393.pbf?map=map_1"),
            decoded,
        )
    }

    @Test
    fun spriteSuffixesAndFontStacksStayInThePathBeforeTheQuery() {
        val remote = "https://api.tileflow.test/sprites/a/sprite?release=1"
        val sprite = MapResourceAddress.encode(remote, context)!!
        val requested = sprite.replace("/sprite?", "/sprite@2x.json?")
        assertEquals(
            "https://api.tileflow.test/sprites/a/sprite@2x.json?release=1",
            MapResourceAddress.decode(requested)!!.second.toASCIIString(),
        )
        val glyphs =
            MapResourceAddress.encode(
                "https://api.tileflow.test/fonts/{fontstack}/{range}.pbf",
                context,
            )!!
        val font =
            glyphs.replace("{fontstack}", "Fixture%20Sans%2cBold").replace("{range}", "0-255")
        assertEquals(
            "https://api.tileflow.test/fonts/Fixture%20Sans%2cBold/0-255.pbf",
            MapResourceAddress.decode(font)!!.second.toASCIIString(),
        )
    }

    @Test
    fun loopbackHttpAndBareOriginsKeepTheirForm() {
        val address = MapResourceAddress.encode("http://127.0.0.1:18645", context)!!
        assertEquals(URI("http://127.0.0.1:18645/"), MapResourceAddress.decode(address)!!.second)
        val query = MapResourceAddress.encode("https://a.test?x=1", context)!!
        assertEquals(URI("https://a.test/?x=1"), MapResourceAddress.decode(query)!!.second)
    }

    @Test
    fun onlyAbsoluteWebAddressesWithoutCredentialsAreEncoded() {
        assertNull(MapResourceAddress.encode("/relative/style.json", context))
        assertNull(MapResourceAddress.encode("file:///data/style.json", context))
        assertNull(MapResourceAddress.encode("asset://style.json", context))
        assertNull(MapResourceAddress.encode("https://user:secret@a.test/style.json", context))
    }

    @Test
    fun otherAddressesAreNotTileflowRequests() {
        val good = MapResourceAddress.encode("https://a.test/x.pbf", context)!!
        assertNull(MapResourceAddress.decode("https://demotiles.maplibre.org/style.json"))
        assertNull(MapResourceAddress.decode("https://tileflow.invalid/resource/abc"))
        assertNull(MapResourceAddress.decode(good.replace(context, "short")))
        assertNull(MapResourceAddress.decode("https://tileflow.invalid/$context/!!!/x"))
        // The origin must be canonical and carry no path or credentials.
        fun token(text: String) =
            java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(text.toByteArray())
        fun address(origin: String, tail: String = "/x") =
            "https://tileflow.invalid/$context/${token(origin)}$tail"
        assertNull(MapResourceAddress.decode(address("https://u@a.test")))
        assertNull(MapResourceAddress.decode(address("https://a.test/p")))
        assertNull(MapResourceAddress.decode(address("ftp://a.test")))
        assertNull(MapResourceAddress.decode(address("https://a.test", "=/x")))
    }

    @Test
    fun relativeAddressesResolveAgainstTheirDocumentKeepingPlaceholders() {
        val base = "https://api.tileflow.test/maps/m/mobile/native-v1/v3/day.json?release=2"
        assertEquals(
            "https://api.tileflow.test/maps/m/fonts/{fontstack}/{range}.pbf",
            MapResourceAddress.resolve(base, "../../../fonts/{fontstack}/{range}.pbf"),
        )
        assertEquals(
            "https://api.tileflow.test/tiles/{z}/{x}/{y}.pbf",
            MapResourceAddress.resolve(base, "/tiles/{z}/{x}/{y}.pbf"),
        )
        assertEquals(
            "https://b.test/a.json",
            MapResourceAddress.resolve(base, "https://b.test/a.json"),
        )
    }

    @Test
    fun contextsAreRandomAndAddressSafe() {
        val first = MapResourceAddress.newContext()
        assertTrue(Regex("^[A-Za-z0-9_-]{22}$").matches(first))
        assertNotEquals(first, MapResourceAddress.newContext())
    }
}
