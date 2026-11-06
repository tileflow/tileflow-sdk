package dev.tileflow.sdk.boundaries

import dev.tileflow.sdk.JoinBoundaryRowsOptions
import dev.tileflow.sdk.TileflowBoundaryClass
import dev.tileflow.sdk.TileflowBoundaryCode
import dev.tileflow.sdk.TileflowBoundaryKey
import dev.tileflow.sdk.TileflowBoundaryLookup
import dev.tileflow.sdk.TileflowBoundaryLookupRow
import dev.tileflow.sdk.TileflowBoundaryRow
import dev.tileflow.sdk.TileflowBoundaryValue
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.TileflowMapSource
import dev.tileflow.sdk.engine.NativeStyleDocument
import dev.tileflow.sdk.transport.ResourceDigest
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourcePolicy
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.RandomAccessFile
import java.net.URI
import java.util.zip.GZIPOutputStream
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeBoundaryLookupTest {
    @get:Rule val temporary = TemporaryFolder()

    private val rows = listOf(
        TileflowBoundaryRow(TileflowBoundaryKey.Text(" es-md "), TileflowBoundaryValue.Category("active")),
    )
    private val region = JoinBoundaryRowsOptions(
        TileflowBoundaryCode.ISO_3166_2,
        classes = setOf(TileflowBoundaryClass.REGION),
    )
    private val csv = "id,class,iso_3166_2\n42,region,ES-MD\n"
    private val storage get() = File(temporary.root, "boundary-lookups")
    private fun store(manifestUrl: String = "https://maps.example.test/manifest.json") =
        BoundaryLookupStore.forMap(storage, source(manifestUrl))

    private fun source(manifestUrl: String) =
        TileflowMapSource("fixture", URI(manifestUrl)).loadable { error("Not Hosted") }

    @Test
    fun selectedReleaseAndClassSurviveOfflineWithDifferentKeys() {
        MockWebServer().use { server ->
            server.start()
            val tileJsonUrl = server.url("/boundaries/tiles.json").toUri()
            val descriptor = requireNotNull(projection(tileJsonUrl).boundaryLookup)
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(tileJsonUrl)), true)
            server.enqueue(
                MockResponse().setBody(gzip(csv + "43,region,ES-CT\n"))
                    .setHeader("Content-Type", "application/gzip")
                    .setHeader("Cache-Control", "private, no-store"),
            )
            ResourceLoader(policy).use { loader ->
                val result = NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
                assertEquals(listOf(rows.single().copy(key = TileflowBoundaryKey.Number(42.0))), result.rows)
                assertEquals("/boundaries/release-1/region.csv.gz", server.takeRequest().path)
            }
            val different = listOf(rows.single().copy(key = TileflowBoundaryKey.Text("ES-CT")))
            ResourceLoader(policy, networkEnabled = { false }).use { loader ->
                val result = NativeBoundaryLookup.join(different, region, descriptor, loader, store())
                assertEquals(TileflowBoundaryKey.Number(43.0), result.rows.single().key)
                assertEquals(1, server.requestCount)
            }
        }
    }

    @Test
    fun directJoinsAndEmptyClassFiltersUseNoResources() {
        ResourceLoader(ResourcePolicy(emptySet()), networkEnabled = { false }).use { loader ->
            val direct = JoinBoundaryRowsOptions(TileflowBoundaryCode.ID)
            val byId = listOf(rows.single().copy(key = TileflowBoundaryKey.Text(" 42 ")))
            assertEquals(TileflowBoundaryKey.Number(42.0), NativeBoundaryLookup.join(byId, direct, null, loader, store()).rows.single().key)
            val empty = NativeBoundaryLookup.join(rows, region.copy(classes = emptySet()), null, loader, store())
            assertEquals(rows.map { it.key }, empty.unmatched)
            val supplied = TileflowBoundaryLookup(
                listOf(TileflowBoundaryLookupRow(42.0, TileflowBoundaryClass.REGION, iso31662 = "ES-MD")),
            )
            val explicit = NativeBoundaryLookup.join(rows, region.copy(lookup = supplied), null, loader, store())
            assertEquals(TileflowBoundaryKey.Number(42.0), explicit.rows.single().key)
        }
        assertTrue(!storage.exists())
    }

    @Test
    fun onlyTheMapsCurrentReleaseAnswersOffline() {
        MockWebServer().use { server ->
            server.start()
            val url = server.url("/boundaries/tiles.json").toUri()
            val first = requireNotNull(projection(url).boundaryLookup)
            val second = requireNotNull(projection(url, releaseId = "release-2").boundaryLookup)
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(url)), true)
            val firstMap = "https://maps.example.test/manifest.json?map=first"
            val otherMap = "https://maps.example.test/manifest.json?map=other"

            server.enqueue(MockResponse().setBody(gzip(csv)))
            ResourceLoader(policy).use { loader ->
                val result = NativeBoundaryLookup.join(rows, region, first, loader, store(firstMap))
                assertEquals(TileflowBoundaryKey.Number(42.0), result.rows.single().key)
            }
            assertEquals("/boundaries/release-1/region.csv.gz", server.takeRequest().path)
            ResourceLoader(policy, networkEnabled = { false }).use { loader ->
                assertOffline { NativeBoundaryLookup.join(rows, region, second, loader, store(firstMap)) }
                assertOffline { NativeBoundaryLookup.join(rows, region, first, loader, store(otherMap)) }
            }
            assertEquals(1, server.requestCount)

            server.enqueue(MockResponse().setBody(gzip(csv.replace("42,", "44,"))))
            ResourceLoader(policy).use { loader ->
                val result = NativeBoundaryLookup.join(rows, region, second, loader, store(firstMap))
                assertEquals(TileflowBoundaryKey.Number(44.0), result.rows.single().key)
            }
            assertEquals("/boundaries/release-2/region.csv.gz", server.takeRequest().path)
            ResourceLoader(policy, networkEnabled = { false }).use { loader ->
                val result = NativeBoundaryLookup.join(rows, region, second, loader, store(firstMap))
                assertEquals(TileflowBoundaryKey.Number(44.0), result.rows.single().key)
            }
            assertEquals(2, server.requestCount)
        }
    }

    @Test
    fun corruptArchivesFailOfflineAndAreReplacedOnline() {
        MockWebServer().use { server ->
            server.start()
            val url = server.url("/boundaries/tiles.json").toUri()
            val descriptor = requireNotNull(projection(url).boundaryLookup)
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(url)), true)
            server.enqueue(MockResponse().setBody(gzip(csv)))
            ResourceLoader(policy).use { loader ->
                NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
            }
            val archive = requireNotNull(storage.listFiles()).single()
            RandomAccessFile(archive, "rw").use { file ->
                val byte = file.read()
                file.seek(0)
                file.write(byte xor 1)
            }
            ResourceLoader(policy, networkEnabled = { false }).use { loader ->
                assertOffline { NativeBoundaryLookup.join(rows, region, descriptor, loader, store()) }
            }
            assertEquals(1, server.requestCount)

            server.enqueue(MockResponse().setBody(gzip(csv)))
            ResourceLoader(policy).use { loader ->
                NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
            }
            ResourceLoader(policy, networkEnabled = { false }).use { loader ->
                val result = NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
                assertEquals(TileflowBoundaryKey.Number(42.0), result.rows.single().key)
            }
            assertEquals(2, server.requestCount)
            assertEquals(listOf(archive), storage.listFiles()?.toList())
        }
    }

    @Test
    fun unsuccessfulDurableWriteDoesNotReportSuccess() {
        MockWebServer().use { server ->
            server.start()
            val url = server.url("/boundaries/tiles.json").toUri()
            val descriptor = requireNotNull(projection(url).boundaryLookup)
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(url)), true)
            val path = temporary.newFile()
            val readOnlyStore = BoundaryLookupStore.forMap(path, source("https://maps.example.test/manifest.json"))
            server.enqueue(MockResponse().setBody(gzip(csv)))
            ResourceLoader(policy).use { loader ->
                val failure = assertThrows(TileflowMapException::class.java) {
                    NativeBoundaryLookup.join(rows, region, descriptor, loader, readOnlyStore)
                }
                assertEquals("boundaryLookupUnavailable", failure.context.reason)
                assertTrue(failure.context.message?.contains("saved") == true)
            }
        }
    }

    private fun assertOffline(block: () -> Unit) {
        val failure = assertThrows(TileflowMapException::class.java) { block() }
        assertEquals(TileflowErrorCode.RESOURCE_FAILED, failure.code)
        assertEquals("boundaryLookupOffline", failure.context.reason)
    }

    @Test
    fun missingClassAndMalformedLookupAreTypedFailures() {
        MockWebServer().use { server ->
            server.start()
            val tileJsonUrl = server.url("/boundaries/tiles.json").toUri()
            val descriptor = requireNotNull(projection(tileJsonUrl).boundaryLookup)
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(tileJsonUrl)), true)
            ResourceLoader(policy).use { loader ->
                val missing = assertThrows(TileflowMapException::class.java) {
                    val district = region.copy(classes = setOf(TileflowBoundaryClass.DISTRICT))
                    NativeBoundaryLookup.join(rows, district, descriptor, loader, store())
                }
                assertEquals("boundaryLookupUnavailable", missing.context.reason)
                assertEquals(0, server.requestCount)

                server.enqueue(MockResponse().setBody(gzip("id,class\n42,district")))
                val invalid = assertThrows(TileflowMapException::class.java) {
                    NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
                }
                assertEquals("boundaryLookupInvalid", invalid.context.reason)
                assertEquals(1, server.requestCount)
            }
        }
    }

    @Test
    fun aTileJsonLookupDoesNotDescribeInlineTilesFromAnotherRelease() {
        val source = URI("https://maps.example.test/boundaries/tiles.json")
        assertNull(projection(source, inlineTiles = true).boundaryLookup)
    }

    @Test
    fun lookupReportsTheTransportSizeLimit() {
        MockWebServer().use { server ->
            server.start()
            val tileJsonUrl = server.url("/boundaries/tiles.json").toUri()
            val descriptor = requireNotNull(projection(tileJsonUrl).boundaryLookup)
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(tileJsonUrl)), true)
            server.enqueue(MockResponse().setBody(gzip(csv)))
            ResourceLoader(policy, maximumBytes = 32).use { loader ->
                val failure = assertThrows(TileflowMapException::class.java) {
                    NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
                }
                assertEquals("dataTooLarge", failure.context.reason)
                assertEquals(32, failure.context.limit)
            }
        }
    }

    @Test
    fun advertisedManifestVerifiesClassArchiveAndCountsUnmatchedRows() {
        MockWebServer().use { server ->
            server.start()
            val tileJsonUrl = server.url("/boundaries/tiles.json").toUri()
            val descriptor = requireNotNull(projection(tileJsonUrl, advertisesManifest = true).boundaryLookup)
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(tileJsonUrl)), true)
            val archive = gzip(csv + "43,region,ES-CT\n").readByteArray()

            fun manifest(rows: Int) = JSONObject().put("schemaVersion", 2)
                .put("family", "boundaries").put("build", "release-1").put(
                "files", JSONObject().put(
                    "region", JSONObject()
                        .put("file", "region.csv.gz")
                        .put("rows", rows)
                        .put("bytes", archive.size)
                        .put("sha256", ResourceDigest.sha256(archive)),
                ),
            )

            ResourceLoader(policy).use { loader ->
                server.enqueue(MockResponse().setBody(manifest(1).toString()))
                server.enqueue(MockResponse().setBody(Buffer().write(archive)))
                val wrongCount = assertThrows(TileflowMapException::class.java) {
                    NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
                }
                assertEquals("boundaryLookupInvalid", wrongCount.context.reason)
                assertEquals("/boundaries/release-1/lookup.json", server.takeRequest().path)
                assertEquals("/boundaries/release-1/region.csv.gz", server.takeRequest().path)
                assertTrue(!storage.exists())

                server.enqueue(MockResponse().setBody(manifest(2).toString()))
                server.enqueue(MockResponse().setBody(Buffer().write(archive)))
                val result = NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
                assertEquals(TileflowBoundaryKey.Number(42.0), result.rows.single().key)
                assertEquals("/boundaries/release-1/lookup.json", server.takeRequest().path)
                assertEquals("/boundaries/release-1/region.csv.gz", server.takeRequest().path)
            }
            ResourceLoader(policy, networkEnabled = { false }).use { loader ->
                val result = NativeBoundaryLookup.join(rows, region, descriptor, loader, store())
                assertEquals(TileflowBoundaryKey.Number(42.0), result.rows.single().key)
                assertEquals(4, server.requestCount)
            }
        }
    }

    private fun projection(
        tileJsonUrl: URI,
        inlineTiles: Boolean = false,
        advertisesManifest: Boolean = false,
        releaseId: String = "release-1",
    ) = NativeStyleDocument.project(
        JSONObject("""
            {
              "version": 8,
              "sources": {"tileflow-boundaries": {"type": "vector", "url": "$tileJsonUrl"}},
              "layers": []
            }
        """).apply {
            if (inlineTiles)
                getJSONObject("sources").getJSONObject("tileflow-boundaries")
                    .put("tiles", JSONArray().put("different/{z}/{x}/{y}.pbf"))
        },
        tileJsonUrl.resolve("/style.json").toString(),
        "lookup",
        { url ->
            assertEquals(tileJsonUrl, url)
            val tileJson = JSONObject("""
                {
                  "tiles": ["$releaseId/{z}/{x}/{y}.pbf"],
                  "tileflow": {"boundaries": {
                    "releaseId": "$releaseId",
                    "manifestSha256": "${"a".repeat(64)}",
                    "lookup": {"classes": {
                      "region": "$releaseId/region.csv.gz",
                      "municipality": "$releaseId/municipality.csv.gz"
                    }}
                  }}
                }
            """)
            if (advertisesManifest)
                tileJson.getJSONObject("tileflow").getJSONObject("boundaries")
                    .getJSONObject("lookup").put("manifest", "$releaseId/lookup.json")
            tileJson.toString().toByteArray()
        },
    )

    private fun gzip(text: String): Buffer {
        val bytes = ByteArrayOutputStream()
        GZIPOutputStream(bytes).use { it.write(text.toByteArray()) }
        return Buffer().write(bytes.toByteArray())
    }
}
