package dev.tileflow.sdk.offline

import dev.tileflow.sdk.transport.ResourceCacheKey
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceCacheStore
import java.io.File
import java.net.URI
import java.nio.file.Files
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * How a map finds what its downloaded regions store: documents by exact address, except for the
 * case of percent-escapes, and the zooms stored for each tile source.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class OfflineServingLookupTest {
    private val directory: File = Files.createTempDirectory("offline-lookup").toFile()
    private val cache =
        ResourceCacheStore(File(directory, "ambient"), File(directory, "durable"), 1L shl 24)
    private val scope =
        ResourceCacheScope.grant(URI("https://api.tileflow.test"), "map_offlinefixture00")
    private val glyphs = "https://api.tileflow.test/fonts/Fixture%20Sans%2CBold/0-255.pbf"
    private val body = byteArrayOf(10, 2, 8, 1)
    private val template =
        "https://api.tileflow.test/tiles/bathymetry/dem/bathymetry-v1-20261021-fixture/" +
            "{z}/{x}/{y}.webp?map=map_offlinefixture00"

    @After
    fun tearDown() {
        directory.deleteRecursively()
    }

    private fun index(): OfflineServingIndex {
        val data =
            OfflinePackBuilder.build(
                OfflinePackKind.DOCUMENTS,
                listOf(OfflinePackBuilder.Entry(glyphs, "application/x-protobuf", null, body)),
            )
        val file = File(directory, "glyphs.tfpack").also { it.writeBytes(data) }
        OfflinePackFormat.verify(file, data.size.toLong(), OfflinePackKind.DOCUMENTS)
        val entry = OfflinePackFormat.index(file).entries.getValue(glyphs)
        val tiles = OfflineServedTiles(OfflineTileTemplate.of(template)!!, 8..9, 204)
        return OfflineServingIndex().also {
            it.publish(
                OfflineServingSnapshot(
                    packs =
                        mapOf(
                            scope.directory to
                                OfflineServedPacks(
                                    mapOf(glyphs to (file to entry)),
                                    mapOf(template to tiles),
                                )
                        )
                ),
                this,
            )
        }
    }

    private fun resource(index: OfflineServingIndex, url: String) =
        index.resource(ResourceCacheKey(URI(url), scope), cache)

    @Test
    fun aFontStackResolvesWhateverTheCaseOfItsEscapes() {
        val index = index()
        // MapLibre Native writes the comma of a font stack as %2c; the service names it %2C.
        assertArrayEquals(body, resource(index, glyphs)?.body)
        assertArrayEquals(body, resource(index, glyphs.replace("%2C", "%2c"))?.body)
        // Only the escapes' case is equivalent: anything else is another address.
        assertNull(resource(index, glyphs.replace("Fixture", "fixture")))
        assertNull(resource(index, glyphs.replace("%2C", ",")))
    }

    @Test
    fun theNormalizedFormChangesOnlyEscapes() {
        assertEquals(
            "https://a.test/Fixture%20Sans%2CBold/x%3Fy?q=%2F",
            OfflineServedPacks.normalizedEscapes(
                "https://a.test/Fixture%20Sans%2cBold/x%3fy?q=%2f"
            ),
        )
        assertEquals(
            "https://a.test/%zz",
            OfflineServedPacks.normalizedEscapes("https://a.test/%zz"),
        )
    }

    @Test
    fun aSourcesStoredZoomsAreKnownForItsTemplate() {
        val index = index()
        assertEquals(8..9, index.storedZooms(scope, template))
        assertNull(index.storedZooms(scope, template.replace("dem", "dem2")))
        assertNull(index.storedZooms(ResourceCacheScope.Shared, template))
    }
}
