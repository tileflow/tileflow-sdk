package dev.tileflow.sdk.boundaries

import dev.tileflow.sdk.JoinBoundaryRowsOptions
import dev.tileflow.sdk.TileflowBoundaryClass
import dev.tileflow.sdk.TileflowBoundaryCode
import dev.tileflow.sdk.TileflowBoundaryKey
import dev.tileflow.sdk.TileflowBoundaryRow
import dev.tileflow.sdk.TileflowBoundaryValue
import dev.tileflow.sdk.TileflowErrorCode
import dev.tileflow.sdk.TileflowMapException
import dev.tileflow.sdk.engine.NativeStyleDocument
import dev.tileflow.sdk.transport.ResourceCacheStore
import dev.tileflow.sdk.transport.ResourceDigest
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourcePolicy
import java.io.ByteArrayOutputStream
import java.io.File
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

    @Test
    fun selectedReleaseAndClassUseExistingCacheOnlyWhileOnline() {
        MockWebServer().use { server ->
            server.start()
            val tileJsonUrl = server.url("/boundaries/tiles.json").toUri()
            val descriptor = requireNotNull(projection(tileJsonUrl).boundaryLookup)
            val cache = ResourceCacheStore(
                File(temporary.root, "ambient"),
                File(temporary.root, "durable"),
                1024 * 1024,
            )
            val policy = ResourcePolicy(setOf(ResourcePolicy.origin(tileJsonUrl)), true)
            server.enqueue(
                MockResponse().setBody(gzip(csv)).setHeader("Content-Type", "application/gzip")
                    .setHeader("Cache-Control", "public, max-age=600, immutable"),
            )
            ResourceLoader(policy, cache = cache).use { loader ->
                val result = NativeBoundaryLookup.join(rows, region, descriptor, loader)
                assertEquals(listOf(rows.single().copy(key = TileflowBoundaryKey.Number(42.0))), result.rows)
                assertEquals("/boundaries/release-1/region.csv.gz", server.takeRequest().path)
            }
            cache.settle()

            var reachable = true
            ResourceLoader(policy, cache = cache, reachable = { reachable }).use { loader ->
                assertEquals(1, NativeBoundaryLookup.join(rows, region, descriptor, loader).rows.size)
                assertEquals(1, server.requestCount)

                reachable = false
                val failure = assertThrows(TileflowMapException::class.java) {
                    NativeBoundaryLookup.join(rows, region, descriptor, loader)
                }
                assertEquals(TileflowErrorCode.RESOURCE_FAILED, failure.code)
                assertEquals("boundaryLookupOffline", failure.context.reason)
                assertEquals(1, server.requestCount)
            }
        }
    }

    @Test
    fun directJoinsAndEmptyClassFiltersUseNoResources() {
        ResourceLoader(ResourcePolicy(emptySet())).use { loader ->
            val direct = JoinBoundaryRowsOptions(TileflowBoundaryCode.ID)
            val byId = listOf(rows.single().copy(key = TileflowBoundaryKey.Text(" 42 ")))
            assertEquals(TileflowBoundaryKey.Number(42.0), NativeBoundaryLookup.join(byId, direct, null, loader).rows.single().key)
            val empty = NativeBoundaryLookup.join(rows, region.copy(classes = emptySet()), null, loader)
            assertEquals(rows.map { it.key }, empty.unmatched)
        }

        ResourceLoader(ResourcePolicy(emptySet()), networkEnabled = { false }).use { loader ->
            val failure = assertThrows(TileflowMapException::class.java) {
                NativeBoundaryLookup.join(rows, JoinBoundaryRowsOptions(TileflowBoundaryCode.ID), null, loader)
            }
            assertEquals("boundaryLookupOffline", failure.context.reason)
        }
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
                    NativeBoundaryLookup.join(rows, district, descriptor, loader)
                }
                assertEquals("boundaryLookupUnavailable", missing.context.reason)
                assertEquals(0, server.requestCount)

                server.enqueue(MockResponse().setBody(gzip("id,class\n42,district")))
                val invalid = assertThrows(TileflowMapException::class.java) {
                    NativeBoundaryLookup.join(rows, region, descriptor, loader)
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
                    NativeBoundaryLookup.join(rows, region, descriptor, loader)
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
                server.enqueue(MockResponse().setBody(manifest(2).toString()))
                server.enqueue(MockResponse().setBody(Buffer().write(archive)))
                val result = NativeBoundaryLookup.join(rows, region, descriptor, loader)
                assertEquals(TileflowBoundaryKey.Number(42.0), result.rows.single().key)
                assertEquals("/boundaries/release-1/lookup.json", server.takeRequest().path)
                assertEquals("/boundaries/release-1/region.csv.gz", server.takeRequest().path)

                server.enqueue(MockResponse().setBody(manifest(1).toString()))
                server.enqueue(MockResponse().setBody(Buffer().write(archive)))
                val wrongCount = assertThrows(TileflowMapException::class.java) {
                    NativeBoundaryLookup.join(rows, region, descriptor, loader)
                }
                assertEquals("boundaryLookupInvalid", wrongCount.context.reason)
            }
        }
    }

    private fun projection(
        tileJsonUrl: URI,
        inlineTiles: Boolean = false,
        advertisesManifest: Boolean = false,
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
                  "tiles": ["release-1/{z}/{x}/{y}.pbf"],
                  "tileflow": {"boundaries": {
                    "releaseId": "release-1",
                    "manifestSha256": "${"a".repeat(64)}",
                    "lookup": {"classes": {
                      "region": "release-1/region.csv.gz",
                      "municipality": "release-1/municipality.csv.gz"
                    }}
                  }}
                }
            """)
            if (advertisesManifest)
                tileJson.getJSONObject("tileflow").getJSONObject("boundaries")
                    .getJSONObject("lookup").put("manifest", "release-1/lookup.json")
            tileJson.toString().toByteArray()
        },
    )

    private fun gzip(text: String): Buffer {
        val bytes = ByteArrayOutputStream()
        GZIPOutputStream(bytes).use { it.write(text.toByteArray()) }
        return Buffer().write(bytes.toByteArray())
    }
}
