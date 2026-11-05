package dev.tileflow.sdk.transport

import java.net.URI
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class WebResourceAddressTest {
    @Test
    fun templateExpansionIsBoundedAndCannotChangeAuthority() {
        val template = URI("https://terrain.example.com/%7Bz%7D/%7Bx%7D/%7By%7D.png")
        val base = ResourceAddress.encode(template).toASCIIString()
        assertEquals(
            URI("https://terrain.example.com/3/4/5.png"),
            ResourceAddress.decode(URI("$base/3/4/5")),
        )
        for (suffix in listOf("/3/8/0", "/25/0/0", "/01/0/0", "/3/4/5/extra", "/3/-1/2")) {
            assertThrows(IllegalArgumentException::class.java) {
                ResourceAddress.decode(URI(base + suffix))
            }
        }
    }

    @Test
    fun addressingRejectsForeignAndNonCanonicalHandles() {
        val url = URI("https://maps.example.com/tile/0/0/0.pbf")
        assertEquals(url, ResourceAddress.decode(ResourceAddress.encode(url)))
        for (value in
            listOf(
                "https://evil.test/resource/abc",
                "https://tileflow.invalid/resource/abc?key=secret",
            )) {
            assertThrows(IllegalArgumentException::class.java) {
                ResourceAddress.decode(URI(value))
            }
        }
    }
}
