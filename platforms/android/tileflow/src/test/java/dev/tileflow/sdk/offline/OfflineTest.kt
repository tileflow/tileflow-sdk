package dev.tileflow.sdk.offline

import dev.tileflow.configuration.TileflowBoundingBox
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.configuration.TileflowPosition
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowGeometry
import dev.tileflow.sdk.transport.NativeHTTPTransporting
import dev.tileflow.sdk.transport.ResourcePayload
import java.net.URI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.sin
import kotlin.math.sqrt
import kotlinx.coroutines.runBlocking
import okhttp3.Request
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The contract fixture is produced by the service's own planner, cover and routes; the corridor
 * fixture pins the corridor rings the Swift SDK plans, so both platforms plan the same packs.
 */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class OfflineTest {
    @Test
    fun tileCoverMatchesTheService() {
        val coverage = contract().getJSONArray("coverage")
        for (index in 0 until coverage.length()) {
            val item = coverage.getJSONObject(index)
            val name = item.getString("name")
            val region = OfflinePackRegion.fromJson(item.getJSONObject("region"))!!
            val minZoom = item.getInt("minZoom")
            val counts = item.getJSONArray("counts")
            val rows = item.getJSONArray("rows")
            for (offset in 0 until counts.length()) {
                val cover = OfflineTileCover(region, minZoom + offset)
                assertEquals("$name z${minZoom + offset}", counts.getLong(offset), cover.count)
                val span = rows.getJSONArray(offset)
                assertEquals(name, span.getInt(0)..span.getInt(1), cover.rows)
            }
            val details = item.getJSONArray("detail")
            for (detailIndex in 0 until details.length()) {
                val detail = details.getJSONObject(detailIndex)
                val cover = OfflineTileCover(region, detail.getInt("zoom"))
                val detailRows = detail.getJSONArray("rows")
                for (rowIndex in 0 until detailRows.length()) {
                    val row = detailRows.getJSONArray(rowIndex)
                    val ranges = row.getJSONArray(1)
                    val expected =
                        (0 until ranges.length()).map {
                            ranges.getJSONArray(it).getInt(0)..ranges.getJSONArray(it).getInt(1)
                        }
                    assertEquals("$name row ${row.getInt(0)}", expected, cover.row(row.getInt(0)))
                }
            }
        }
    }

    @Test
    fun regionsAreCanonicalLikeTheService() {
        val cases = contract().getJSONArray("canonical")
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val name = item.getString("name")
            val input = item.getJSONObject("region")
            val region =
                if (input.getString("type") == "bbox") {
                    val box = input.getJSONArray("bbox")
                    OfflinePackRegion.canonical(
                        box.getDouble(0),
                        box.getDouble(1),
                        box.getDouble(2),
                        box.getDouble(3),
                    )
                } else {
                    val ring = input.getJSONArray("coordinates")
                    OfflinePackRegion.canonical(
                        (0 until ring.length()).map {
                            TileflowPosition(
                                ring.getJSONArray(it).getDouble(0),
                                ring.getJSONArray(it).getDouble(1),
                            )
                        }
                    )
                }
            if (item.has("canonical")) {
                val canonical = item.getJSONObject("canonical")
                assertEquals(name, OfflinePackRegion.fromJson(canonical), region)
                assertJson(name, canonical, region!!.toJson())
            } else {
                assertNull(name, region)
            }
        }
    }

    @Test
    fun requestsMatchTheServiceCanonicalBody() {
        val cases = contract().getJSONArray("requests")
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val name = item.getString("name")
            if (name == "inverted-zooms") {
                // The zooms are a range here; an inverted one is refused before it is built.
                val failure = runCatching { OfflineZooms(12..11) }.exceptionOrNull()
                assertEquals(
                    TileflowOfflineErrorCode.INVALID_OPTIONS,
                    (failure as TileflowOfflineException).code,
                )
                continue
            }
            val body = item.getJSONObject("body")
            val box = body.getJSONObject("region").getJSONArray("bbox")
            val built = runCatching {
                OfflinePackRequest.requests(
                    body.getString("mapId"),
                    body.getJSONArray("themes").let { themes ->
                        (0 until themes.length()).map { themes.getString(it) }
                    },
                    TileflowOfflineGeometry.BoundingBox(
                        TileflowBoundingBox(
                            box.getDouble(0),
                            box.getDouble(1),
                            box.getDouble(2),
                            box.getDouble(3),
                        )
                    ),
                    OfflineZooms(
                        body.getInt("minZoom")..body.getInt("maxZoom"),
                        body.optInt("terrainMaxZoom", OfflineZooms.DEFAULT_TERRAIN_MAXIMUM),
                    ),
                    profile = OfflinePackProfile.entries.single { it.wireName == body.getString("profile") },
                )
            }
            if (item.has("canonical")) {
                // Everything but the area, which the service now takes as the cover.
                val sent = JSONObject(String(built.getOrThrow()[0].body))
                val expected = JSONObject(item.getJSONObject("canonical").toString())
                assertNotNull(name, sent.remove("cover"))
                expected.remove("region")
                assertJson(name, expected, sent)
            } else {
                assertEquals(
                    name,
                    TileflowOfflineErrorCode.INVALID_OPTIONS,
                    (built.exceptionOrNull() as TileflowOfflineException).code,
                )
            }
        }
    }

    @Test
    fun createdDownloadIsPlannedExactly() {
        val download = createdDownload()
        val manifest = download.manifest
        assertEquals(listOf("default"), manifest.themes)
        assertEquals(10_000L, manifest.maximumPackResources)
        assertEquals(listOf("boundaries"), manifest.excluded.map { it.source })
        assertEquals(
            listOf("bathymetry", "bathymetry-dem", "nautical", "terrain", "world"),
            manifest.sources.map { it.source },
        )
        // The elevation model's base-zoom parents and Bathymetry's deepest zoom lie below the
        // download's first zoom, in bands the cover holds.
        assertEquals(listOf(9..9, 8..9, 10..14, 10..12, 10..14), manifest.sources.map { it.zooms })
        assertEquals(listOf(204, 204, 204, 404, 404), manifest.sources.map { it.absentStatus })
        assertEquals(
            listOf("gzip", null, "gzip", null, "gzip"),
            manifest.sources.map { it.contentEncoding },
        )
        assertEquals(setOf("https://api.tileflow.test"), manifest.origins)
        // The zoom policy plans the same source zooms the service did.
        val zooms = OfflineZooms(10..14)
        assertEquals(10..14, zooms.zooms(0, 15))
        assertEquals(10..12, zooms.zooms(0, minOf(14, zooms.terrainMaximum)))

        val plan = OfflineVersionPlan.hosted(listOf(download), listOf(createdRequest()))
        assertEquals(
            listOf(
                "style",
                "assets",
                "glyphs/Noto Sans Regular/0",
                "tiles/bathymetry/7/62/48",
                "tiles/bathymetry-dem/7/62/48",
                "tiles/nautical/7/62/48",
                "tiles/nautical/11/1002/772",
                "tiles/nautical/11/1003/772",
                "tiles/terrain/7/62/48",
                "tiles/terrain/11/1002/772",
                "tiles/terrain/11/1003/772",
                "tiles/world/7/62/48",
                "tiles/world/11/1002/772",
                "tiles/world/11/1003/772",
            ),
            plan.packs.map { it.pack.id },
        )
        assertEquals(44L, plan.resourceCount)
        assertEquals("Only tiles are billable", 32L, plan.billable)
        assertTrue(
            plan.packs.filter { it.pack.kind == OfflinePackKind.DOCUMENTS }
                .all { it.pack.billableResources == 0 }
        )
        assertEquals(8_224L, plan.bytes)
        assertEquals("Discovery", 1, plan.resources.size)
        assertEquals(
            mapOf(
                "bathymetry" to 1L,
                "bathymetry-dem" to 2L,
                "nautical" to 13L,
                "terrain" to 5L,
                "world" to 11L,
            ),
            plan.tileCounts,
        )
        // Every tile pack's anchor starts its band; tiles the archive does not store are left out.
        val cover = (10..14).sumOf { covered(manifest.cover, it).size.toLong() }
        assertTrue(plan.tileCounts.getValue("world") < cover)
        for (planned in plan.packs.filter { it.pack.kind == OfflinePackKind.TILES }) {
            assertTrue(planned.pack.anchor!!.z in OfflinePackBand.anchors)
            assertEquals(
                manifest.source(planned.pack.source!!)!!.version,
                planned.release,
            )
        }
    }

    @Test
    fun manifestInvariantsAreChecked() {
        fun pack(manifest: JSONObject, change: (JSONObject) -> Unit) {
            val packs = manifest.getJSONArray("packs")
            change(
                (0 until packs.length())
                    .map { packs.getJSONObject(it) }
                    .first { it.getString("kind") == "tiles" }
            )
        }
        val mutations: List<Pair<String, (JSONObject) -> Unit>> =
            listOf(
                "totals" to
                    { manifest ->
                        val totals = manifest.getJSONObject("totals")
                        totals.put("billableResources", totals.getLong("billableResources") - 1)
                    },
                "an anchor outside the cover" to
                    { manifest ->
                        pack(manifest) {
                            it.put("anchor", JSONArray(listOf(11, 0, 0)))
                            it.put("id", "tiles/world/11/0/0")
                        }
                    },
                "an anchor no band starts at" to
                    { manifest ->
                        pack(manifest) {
                            val anchor = it.getJSONArray("anchor")
                            val x = anchor.getInt(1) * 2
                            val y = anchor.getInt(2) * 2
                            it.put("anchor", JSONArray(listOf(12, x, y)))
                            it.put("id", "tiles/world/12/$x/$y")
                        }
                    },
                "zooms outside the band" to
                    { manifest -> pack(manifest) { it.put("zooms", JSONArray(listOf(12, 16))) } },
                "an id that is not its anchor" to
                    { manifest -> pack(manifest) { it.put("id", "tiles/world/11/1/1") } },
                "an unknown source" to
                    { manifest -> pack(manifest) { it.put("source", "boundaries") } },
                "another origin" to
                    { manifest ->
                        pack(manifest) { it.put("url", "https://elsewhere.test/v1/offline/p.tfpack") }
                    },
                "plain HTTP" to
                    { manifest ->
                        pack(manifest) { it.put("url", "http://api.tileflow.test/v1/offline/p.tfpack") }
                    },
                "larger than a pack can be" to
                    { manifest -> pack(manifest) { it.put("bytes", 33 * 1024 * 1024) } },
                "more billable than resources" to
                    { manifest -> pack(manifest) { it.put("billableResources", 1_000_000) } },
                "an unknown kind" to { manifest -> pack(manifest) { it.put("kind", "models") } },
                "format 1" to { it.put("version", 1) },
                "another cover" to { it.put("coverSha256", "0".repeat(64)) },
                "no cover" to { it.remove("coverSha256") },
                "a tile pack the cover does not list" to
                    { manifest ->
                        pack(manifest) {
                            it.put("anchor", JSONArray(listOf(11, 1004, 772)))
                            it.put("id", "tiles/world/11/1004/772")
                        }
                    },
                "over the plan" to
                    { manifest ->
                        val billable = manifest.getJSONObject("totals").getLong("billableResources")
                        manifest.put(
                            "limits",
                            JSONObject()
                                .put("maxPackResources", billable - 1)
                                .put("dailyDownloads", 20_000),
                        )
                    },
                "a template on another origin" to
                    {
                        it.getJSONArray("sources")
                            .getJSONObject(0)
                            .put("template", "https://elsewhere.test/{z}/{x}/{y}.pbf")
                    },
            )
        for ((name, mutate) in mutations) {
            val response = createdResponse()
            mutate(response.getJSONObject("manifest"))
            val failure =
                runCatching {
                        OfflinePackContract.download(
                            response.toString().toByteArray(),
                            createdRequest(),
                            allowsLoopbackHttp = false,
                        )
                    }
                    .exceptionOrNull()
            assertEquals(
                name,
                TileflowOfflineErrorCode.INVALID_RESPONSE,
                (failure as? TileflowOfflineException)?.code,
            )
        }
        val response = createdResponse().put("grant", "tf_offline_v1.a.b")
        assertTrue(
            "A format 1 grant",
            runCatching {
                    OfflinePackContract.download(
                        response.toString().toByteArray(),
                        createdRequest(),
                        allowsLoopbackHttp = false,
                    )
                }
                .isFailure,
        )
    }

    @Test
    fun revalidationStates() {
        val checkedAt = 1_793_188_800_000L
        val expected =
            mapOf(
                "current" to OfflinePackRevalidation.Current(checkedAt, 86_400_000),
                "update-available" to
                    OfflinePackRevalidation.UpdateAvailable(checkedAt, 86_400_000),
                "credential-revoked" to
                    OfflinePackRevalidation.NotUpdatable("credential_revoked", checkedAt),
                "plan-unavailable" to
                    OfflinePackRevalidation.NotUpdatable("plan_unavailable", checkedAt),
            )
        val cases = contract().getJSONArray("revalidations")
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val body = item.getJSONObject("body").toString().toByteArray()
            assertEquals(
                item.getString("name"),
                expected[item.getString("name")],
                OfflinePackContract.revalidation(body),
            )
        }
        assertTrue(
            runCatching {
                    OfflinePackContract.revalidation(
                        """{"state":"current","checkedAt":"x"}""".toByteArray()
                    )
                }
                .isFailure
        )
    }

    @Test
    fun failuresMapToTypedErrors() {
        val now = 1_793_188_800_000L
        val failures = contract().getJSONArray("failures")
        for (index in 0 until failures.length()) {
            val item = failures.getJSONObject(index)
            val body = item.getString("body").toByteArray()
            val status = item.getInt("status")
            val retryAfter = item.getJSONObject("headers").optString("retry-after", "")
            val serverCode = JSONObject(item.getString("body")).getString("code")
            val operation =
                when (item.getString("operation")) {
                    "create" -> OfflinePackContract.Operation.CREATE
                    "revalidate" -> OfflinePackContract.Operation.REVALIDATE
                    else -> OfflinePackContract.Operation.DOWNLOAD
                }
            val error =
                OfflinePackContract.failure(
                    status,
                    body,
                    retryAfter.ifEmpty { null },
                    operation,
                    now,
                )
            assertEquals(serverCode, offlineErrorCodes[serverCode], error.code)
            assertEquals(serverCode, error.context.reason)
            assertEquals(status, error.context.status)
            assertEquals(
                if (serverCode == "OFFLINE_PACK_TOO_LARGE") 10_000 else null,
                error.context.limit,
            )
            assertEquals(
                serverCode,
                retryAfter.ifEmpty { null }?.toLong()?.times(1_000),
                error.retryAfterMillis,
            )
        }
        // A code is trusted only with its own status; otherwise the status and operation decide.
        val forged = """{"code":"OFFLINE_PACK_TOO_LARGE","error":"x","limit":5}""".toByteArray()
        val unknown =
            OfflinePackContract.failure(
                401,
                forged,
                null,
                OfflinePackContract.Operation.CREATE,
                now,
            )
        assertEquals(TileflowOfflineErrorCode.CREDENTIAL_REJECTED, unknown.code)
        // Downloads stopped by the service wait and try again; access has not ended.
        val stopped =
            OfflinePackContract.failure(
                503,
                """{"code":"OFFLINE_DOWNLOADS_STOPPED","error":"x"}""".toByteArray(),
                "120",
                OfflinePackContract.Operation.DOWNLOAD,
                0,
            )
        assertEquals(TileflowOfflineErrorCode.UNAVAILABLE, stopped.code)
        assertTrue(stopped.isRecoverable)
        assertEquals(120_000L, stopped.retryAfterMillis)
        assertNull(unknown.context.limit)
        assertEquals(
            TileflowOfflineErrorCode.GRANT_REJECTED,
            OfflinePackContract.failure(
                    401,
                    ByteArray(0),
                    null,
                    OfflinePackContract.Operation.DOWNLOAD,
                    now,
                )
                .code,
        )
        assertEquals(
            43_200_000L,
            OfflinePackContract.failure(
                    429,
                    ByteArray(0),
                    "Thu, 29 Oct 2026 00:00:00 GMT",
                    OfflinePackContract.Operation.DOWNLOAD,
                    now,
                )
                .retryAfterMillis,
        )
    }

    @Test
    fun clientSendsTheContractRequests() = runBlocking {
        val requests = mutableListOf<Request>()
        val transport =
            object : NativeHTTPTransporting {
                override fun send(request: Request, timeoutMillis: Long): ResourcePayload {
                    synchronized(requests) { requests.add(request) }
                    return if (request.url.encodedPath.endsWith("/revalidate"))
                        ResourcePayload(
                            ("""{"state":"current","checkedAt":"2026-10-28T12:00:00.000Z",""" +
                                    """"intervalSeconds":86400}""")
                                .toByteArray(),
                            200,
                            emptyMap(),
                        )
                    else
                        ResourcePayload(createdResponse().toString().toByteArray(), 201, emptyMap())
                }

                override fun cancelActive() {}

                override fun close() {}
            }
        val credential = "tf_public_" + "a".repeat(48)
        val client =
            OfflinePackClient(
                TileflowConfiguration(
                    apiOrigin = URI("https://api.tileflow.test"),
                    servicesCredential = TileflowCredential("tf_public_" + "b".repeat(48)),
                    mapCredential = TileflowCredential(credential),
                ),
                transports = { transport },
            )
        val download = client.create(createdRequest())
        client.revalidate(download.grant)

        val (create, revalidate) = requests
        assertEquals("POST", create.method)
        assertEquals("https://api.tileflow.test/v1/offline/packs", create.url.toString())
        assertEquals(listOf("X-Tileflow-Mobile-Client"), create.headers.names().toList())
        assertEquals(credential, create.header("X-Tileflow-Mobile-Client"))
        assertEquals("application/json", create.body!!.contentType().toString())
        assertJson("create", JSONObject(String(createdRequest().body)), body(create))
        // The body the service's own fixture was created from, cover included.
        assertJson(
            "create",
            JSONObject(resource("packs-v2/release-1/create-request.json")),
            body(create),
        )
        assertEquals(
            "https://api.tileflow.test/v1/offline/packs/revalidate",
            revalidate.url.toString(),
        )
        assertEquals(emptySet<String>(), revalidate.headers.names())
        assertJson("revalidate", JSONObject().put("grant", download.grant.value), body(revalidate))
        assertFalse(download.grant.toString().contains(download.grant.value))

        val anonymous =
            OfflinePackClient(
                TileflowConfiguration(apiOrigin = URI("https://api.tileflow.test")),
                transports = { transport },
            )
        try {
            anonymous.create(createdRequest())
            fail("A download needs the map credential")
        } catch (error: TileflowOfflineException) {
            assertEquals(TileflowOfflineErrorCode.MISSING_CREDENTIAL, error.code)
        }
        assertEquals(2, requests.size)
    }

    @Test
    fun geometryBecomesServicePacks() {
        val crossing =
            TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(179.5, -17.0, -179.5, -16.5))
        assertEquals(
            listOf(
                OfflinePackRegion.Bbox(179.5, -17.0, 180.0, -16.5),
                OfflinePackRegion.Bbox(-180.0, -17.0, -179.5, -16.5),
            ),
            crossing.packRegions(),
        )
        val world =
            TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-180.0, -90.0, 180.0, 90.0))
        assertEquals(64L, world.tileCount(3))
        val open =
            TileflowOfflineGeometry.Geometry(
                TileflowGeometry.Polygon(
                    listOf(
                        listOf(
                            TileflowCoordinate(-3.75, 40.38),
                            TileflowCoordinate(-3.62, 40.36),
                            TileflowCoordinate(-3.6, 40.47),
                            TileflowCoordinate(-3.72, 40.5),
                        )
                    )
                )
            )
        val polygon = contract().getJSONArray("coverage").getJSONObject(0).getJSONArray("counts")
        assertEquals(polygon.getLong(16), open.tileCount(16))
        assertEquals(196L + 715L, open.tileCount(15..16))

        fun geometry(value: TileflowGeometry) = TileflowOfflineGeometry.Geometry(value)
        fun point(longitude: Double, latitude: Double) = TileflowCoordinate(longitude, latitude)
        val square = listOf(point(0.0, 0.0), point(1.0, 0.0), point(1.0, 1.0), point(0.0, 0.0))
        // Regions have no limit on their positions, rings or parts.
        geometry(TileflowGeometry.Polygon(List(17) { square })).validate()
        TileflowOfflineGeometry.GeometryCollection(
                List(65) { TileflowGeometry.Point(point(0.0, 0.0)) }
            )
            .validate()
        geometry(TileflowGeometry.LineString((0 until 3_000).map { point(it / 1000.0, 0.0) }))
            .validate()
        val invalid =
            listOf(
                geometry(TileflowGeometry.Polygon(listOf(listOf(point(0.0, 0.0), point(1.0, 1.0))))) to
                    "tooFewPositions",
                geometry(
                    TileflowGeometry.Polygon(
                        listOf(listOf(point(0.0, 0.0), point(1.0, 1.0), point(2.0, 2.0)))
                    )
                ) to "emptyArea",
                geometry(TileflowGeometry.LineString(listOf(point(0.0, 0.0)))) to "tooFewPositions",
                geometry(TileflowGeometry.MultiPoint(emptyList())) to "tooFewPositions",
                geometry(TileflowGeometry.LineString(listOf(point(179.0, 0.0), point(-179.0, 0.0)))) to
                    "crossesAntimeridian",
                TileflowOfflineGeometry.GeometryCollection(emptyList()) to "tooFewPositions",
                geometry(TileflowGeometry.Point(point(181.0, 0.0))) to "invalidPosition",
                TileflowOfflineGeometry.Corridor(
                    listOf(TileflowPosition(179.0, 0.0), TileflowPosition(-179.0, 0.0)),
                    100.0,
                ) to "crossesAntimeridian",
                TileflowOfflineGeometry.Corridor(
                    listOf(TileflowPosition(0.0, 0.0), TileflowPosition(1.0, 0.0)),
                    0.5,
                ) to "invalidWidth",
                TileflowOfflineGeometry.Corridor(
                    listOf(TileflowPosition(0.0, 0.0), TileflowPosition(0.0, 0.0)),
                    10.0,
                ) to "tooFewPositions",
                TileflowOfflineGeometry.BoundingBox(
                    TileflowBoundingBox(0.0, 0.0, Double.NaN, 1.0)
                ) to "invalidPosition",
                TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(1.0, 0.0, 1.0, 1.0)) to
                    "emptyArea",
            )
        for ((geometry, reason) in invalid) {
            val failure = runCatching { geometry.validate() }.exceptionOrNull()
            assertEquals(
                reason,
                TileflowOfflineErrorCode.INVALID_REGION,
                (failure as TileflowOfflineException).code,
            )
            assertEquals(reason, failure.context.reason)
        }
    }

    @Test
    fun geoJsonCoverMatchesTheService() {
        val fixture = JSONObject(resource("geometry-cover.json"))
        val covers = fixture.getJSONArray("covers")
        for (index in 0 until covers.length()) {
            val item = covers.getJSONObject(index)
            val name = item.getString("name")
            val request = item.getJSONObject("request")
            val geometry =
                if (request.getString("type") == "bbox") {
                    val box = request.getJSONArray("bbox")
                    TileflowOfflineGeometry.BoundingBox(
                        TileflowBoundingBox(
                            box.getDouble(0),
                            box.getDouble(1),
                            box.getDouble(2),
                            box.getDouble(3),
                        )
                    )
                } else TileflowOfflineGeometry.fromGeoJson(request.toString())
            val region = OfflinePackRegion.fromJson(item.getJSONObject("region"))
            assertNotNull(name, region)
            assertEquals(name, listOf(region), geometry.packRegions())
            assertJson(name, item.getJSONObject("region"), region!!.toJson())
            val byZoom = item.getJSONObject("cover")
            for (zoom in byZoom.keys()) {
                val expected = byZoom.getJSONArray(zoom)
                val cover = OfflineTileCover(region, zoom.toInt())
                val rows =
                    cover.rows?.flatMap { y -> cover.row(y).map { listOf(y, it.first, it.last) } }
                        ?: emptyList()
                assertEquals(
                    "$name z$zoom",
                    (0 until expected.length()).map { row ->
                        expected.getJSONArray(row).let { listOf(it.getInt(0), it.getInt(1), it.getInt(2)) }
                    },
                    rows,
                )
                assertEquals(
                    "$name z$zoom",
                    rows.sumOf { (it[2] - it[1] + 1).toLong() },
                    geometry.tileCount(zoom.toInt()),
                )
            }
        }
    }

    @Test
    fun coversMatchTheService() {
        val fixture = JSONObject(resource("pack-lists.json"))
        assertEquals(OfflineCover.MAXIMUM_ENTRIES, fixture.getInt("maxCoverEntries"))
        assertEquals(OfflinePackRequest.MAXIMUM_BODY_BYTES, fixture.getInt("maxBodyBytes"))
        val cases = fixture.getJSONArray("cases")
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val name = item.getString("name")
            val region = item.getJSONObject("region")
            val geometry =
                if (region.getString("type") == "bbox") {
                    val box = region.getJSONArray("bbox")
                    TileflowOfflineGeometry.BoundingBox(
                        TileflowBoundingBox(
                            box.getDouble(0),
                            box.getDouble(1),
                            box.getDouble(2),
                            box.getDouble(3),
                        )
                    )
                } else TileflowOfflineGeometry.fromGeoJson(region.toString())
            val minZoom = item.getInt("minZoom")
            val maxZoom = item.getInt("maxZoom")
            val cover = OfflineCover.of(geometry.packRegions(), minZoom, maxZoom)
            assertJson(name, item.getJSONArray("cover"), cover.toJson())
            assertEquals(name, item.getString("coverSha256"), cover.sha256)
            assertEquals(name, item.getInt("coverBytes"), cover.text.toByteArray().size)
            // Read back as the service reads it, the cover is unchanged.
            assertEquals(name, cover, OfflineCover.fromJson(cover.toJson(), minZoom, maxZoom))
            // Packs plan only from the entries whose band reaches the download's zooms.
            val packs = item.getJSONArray("packs")
            val planned = cover.entries.filter { OfflinePackBand.zooms(it.anchor.z)!!.last >= minZoom }
            assertEquals(name, packs.length(), planned.size)
            var total = 0L
            for ((offset, entry) in planned.withIndex()) {
                val pack = packs.getJSONObject(offset)
                val anchor = pack.getJSONArray("anchor")
                assertEquals(
                    name,
                    listOf(anchor.getInt(0), anchor.getInt(1), anchor.getInt(2)),
                    listOf(entry.anchor.z, entry.anchor.x, entry.anchor.y),
                )
                assertEquals(
                    name,
                    pack.getInt("maskZoom"),
                    OfflineCover.maskZoom(entry.anchor.z, maxZoom),
                )
                val zooms = pack.getJSONArray("zooms")
                val tiles = cover.tiles(entry, zooms.getInt(0)..zooms.getInt(1))
                val byZoom = pack.getJSONObject("tilesByZoom")
                assertEquals(
                    "$name $anchor",
                    byZoom.keys().asSequence().associate { it.toInt() to byZoom.getInt(it) },
                    tiles.mapValues { it.value.size },
                )
                // Every tile of the pack, and nothing beside it, is in the download.
                for ((zoom, list) in tiles) assertTrue("$name z$zoom", list.all(cover::contains))
                total += tiles.values.sumOf { it.size }
            }
            assertEquals(name, item.getJSONObject("totals").getLong("tiles"), total)
            // The cover holds exactly the region's tiles at every zoom, also below the first.
            for (zoom in 0..maxZoom)
                assertEquals(
                    "$name z$zoom",
                    geometry.tileCount(zoom),
                    covered(cover, zoom).size.toLong(),
                )
        }
        val canonicalized = fixture.getJSONArray("canonicalized")
        for (index in 0 until canonicalized.length()) {
            val item = canonicalized.getJSONObject(index)
            val cover =
                OfflineCover.fromJson(
                    item.getJSONArray("cover"),
                    item.getInt("minZoom"),
                    item.getInt("maxZoom"),
                )!!
            assertJson("canonical", item.getJSONArray("canonical"), cover.toJson())
            assertEquals(item.getString("coverSha256"), cover.sha256)
        }
        val refused = fixture.getJSONArray("refused")
        for (index in 0 until refused.length()) {
            val item = refused.getJSONObject(index)
            if (!item.has("cover")) continue
            assertNull(
                item.getString("reason"),
                OfflineCover.fromJson(item.get("cover"), item.getInt("minZoom"), item.getInt("maxZoom")),
            )
        }
    }

    @Test
    fun regionsTooComplexAreRefusedBeforeAnyRequest() {
        fun refusal(geometry: TileflowOfflineGeometry, maxZoom: Int): TileflowOfflineException =
            runCatching {
                    OfflinePackRequest.requests(
                        "map_offlinefixture00",
                        listOf("default"),
                        geometry,
                        OfflineZooms(0..maxZoom),
                    )
                }
                .exceptionOrNull() as? TileflowOfflineException ?: throw AssertionError("Not refused")
        // Greater London to z16 lists one pack per z16 tile: more than a download may.
        val london =
            TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-0.51, 51.29, 0.33, 51.69))
        assertEquals(
            23,
            OfflinePackRequest.requests(
                    "map_offlinefixture00",
                    listOf("default"),
                    london,
                    OfflineZooms(0..15),
                )[0]
                .cover
                .entries
                .size,
        )
        val packs = refusal(london, 16)
        assertEquals(TileflowOfflineErrorCode.REGION_TOO_COMPLEX, packs.code)
        assertEquals("tooManyPacks", packs.context.reason)
        assertEquals(16_384, packs.context.limit)
        assertEquals(18_195, packs.context.count)
        // Thousands of scattered points each need a pack with a mask: a body larger than allowed.
        val points =
            (0 until 4_900).map {
                TileflowCoordinate((it % 70) * 0.2, 40 + (it / 70) * 0.15)
            }
        val bytes =
            refusal(TileflowOfflineGeometry.Geometry(TileflowGeometry.MultiPoint(points)), 15)
        assertEquals(TileflowOfflineErrorCode.REGION_TOO_COMPLEX, bytes.code)
        assertEquals("bodyTooLarge", bytes.context.reason)
        assertEquals(262_144, bytes.context.limit)
        assertTrue((bytes.context.count ?: 0) > 262_144)
        // The service's own refusals of size read the same way.
        val tooMany =
            OfflinePackContract.failure(
                422,
                """{"code":"OFFLINE_PACK_TOO_LARGE","maxCoverEntries":16384}""".toByteArray(),
                null,
                OfflinePackContract.Operation.CREATE,
                0,
            )
        assertEquals(TileflowOfflineErrorCode.REGION_TOO_COMPLEX, tooMany.code)
        assertEquals(16_384, tooMany.context.limit)
        val tooLarge =
            OfflinePackContract.failure(
                413,
                """{"code":"OFFLINE_PACK_BODY_TOO_LARGE","maxBodyBytes":262144}""".toByteArray(),
                null,
                OfflinePackContract.Operation.CREATE,
                0,
            )
        assertEquals(TileflowOfflineErrorCode.REGION_TOO_COMPLEX, tooLarge.code)
        assertEquals(262_144, tooLarge.context.limit)
    }

    @Test
    fun geoJsonGeometriesAreReadAndKeptMapboxStyle() {
        val text =
            """
            {"type": "GeometryCollection", "geometries": [
              {"type": "Polygon", "coordinates": [[[-3.72, 40.4], [-3.68, 40.4], [-3.68, 40.43],
                [-3.72, 40.43]]]},
              {"type": "LineString", "coordinates": [[-3.75, 40.38, 650], [-3.6, 40.5]]},
              {"type": "Point", "coordinates": [-3.7, 89]}
            ]}
            """
        val geometry = TileflowOfflineGeometry.fromGeoJson(text)
        val parts = (geometry as TileflowOfflineGeometry.GeometryCollection).geometries
        assertEquals(3, parts.size)
        // The open ring is closed, the altitude dropped and the latitude clamped to the map's.
        val regions = geometry.packRegions()
        val expected =
            JSONObject(
                """
                {"type": "GeometryCollection", "geometries": [
                  {"type": "Polygon", "coordinates": [[[-3.72, 40.4], [-3.68, 40.4], [-3.68, 40.43],
                    [-3.72, 40.43], [-3.72, 40.4]]]},
                  {"type": "LineString", "coordinates": [[-3.75, 40.38], [-3.6, 40.5]]},
                  {"type": "Point", "coordinates": [-3.7, 85.051129]}
                ]}
                """
            )
        assertEquals(1, regions.size)
        assertJson("canonical", expected, regions[0].toJson())
        assertEquals(regions[0], OfflinePackRegion.fromJson(expected))
        // Kept with the region exactly as given.
        val options =
            TileflowOfflineRegionLoadOptions(
                geometry,
                TileflowOfflineContent.Hosted("map_offlineofflineof", listOf("light")),
            )
        assertEquals(options, offlineOptions(options.toJson()))
        val nested =
            """{"type": "GeometryCollection", "geometries": [{"type": "GeometryCollection", "geometries": []}]}"""
        for (invalid in listOf("", "{}", """{"type": "Feature", "geometry": null}""", "[1, 2]", nested)) {
            val failure = runCatching { TileflowOfflineGeometry.fromGeoJson(invalid) }.exceptionOrNull()
            assertEquals(invalid, "invalidGeoJSON", (failure as TileflowOfflineException).context.reason)
        }
    }

    @Test
    fun corridorsCoverTheirWidth() {
        val cases = corridors()
        for (index in 0 until cases.length()) {
            val item = cases.getJSONObject(index)
            val name = item.getString("name")
            val points = item.getJSONArray("line")
            val line =
                (0 until points.length()).map {
                    TileflowPosition(
                        points.getJSONArray(it).getDouble(0),
                        points.getJSONArray(it).getDouble(1),
                    )
                }
            val width = item.getDouble("width")
            val regions = TileflowOfflineGeometry.Corridor(line, width).packRegions()
            assertEquals(name, item.getInt("packs"), regions.size)
            for (region in regions) {
                assertTrue(name, (region as OfflinePackRegion.Polygon).ring.size <= 256)
            }
            val counts = item.getJSONObject("counts")
            for (zoom in counts.keys()) {
                assertEquals(
                    "$name z$zoom",
                    counts.getLong(zoom),
                    OfflineTileCover.count(regions, zoom.toInt()),
                )
            }
            // Every point 0.95 half widths beside the line lies in a covered tile.
            val zoom = 15
            val covers = regions.map { OfflineTileCover(it, zoom) }
            for (segment in 1 until line.size) {
                val a = line[segment - 1]
                val b = line[segment]
                for (step in 0..10) {
                    val t = step / 10.0
                    val point =
                        TileflowPosition(
                            a.longitude + t * (b.longitude - a.longitude),
                            a.latitude + t * (b.latitude - a.latitude),
                        )
                    for (side in listOf(-1.0, 1.0)) {
                        val offset = beside(point, a, b, side * 0.95 * width / 2)
                        val tile = OfflineTileCover.mercator(offset, (1 shl zoom).toDouble())
                        val x = floor(tile.first).toInt()
                        val y = floor(tile.second).toInt()
                        assertTrue("$name $segment $t", covers.any { it.contains(x, y) })
                    }
                }
            }
        }
    }

    @Test
    fun selfHostedEstimateCountsTheCover() {
        val geometry =
            TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.72, 40.4, -3.68, 40.43))
        val counts = contract().getJSONArray("coverage").getJSONObject(1).getJSONArray("counts")
        fun sum(range: IntRange) = range.sumOf { counts.getLong(it) }
        val estimate =
            OfflinePlanner.estimate(
                geometry,
                OfflineZooms(0..16),
                listOf(
                    OfflinePlanner.SelfHostedSource("streets", 0, 14),
                    OfflinePlanner.SelfHostedSource("relief", 2, 14, maximumDownloadZoom = 12),
                    OfflinePlanner.SelfHostedSource("detail", 17, 20),
                ),
            )
        // Zooms deeper than a source's maximum overzoom its deepest tiles; none are downloaded.
        assertEquals(sum(0..14), estimate.tileCounts["streets"])
        assertEquals(sum(2..12), estimate.tileCounts["relief"])
        assertEquals(0L, estimate.tileCounts["detail"])
        assertEquals(sum(0..14) + sum(2..12), estimate.resourceCount)
        assertNull(estimate.bytes)
        assertEquals(0L, estimate.mapViews)
    }

    @Test
    fun deviceLimit() {
        val accepted =
            listOf(
                listOf(0L, 10_000L, 0L, 10_000L),
                listOf(9_000L, 1_000L, 0L, 10_000L),
                listOf(9_500L, 1_000L, 600L, 10_000L),
                // A lower limit never stops an update that does not grow the device's total.
                listOf(30_000L, 500L, 500L, 10_000L),
                listOf(30_000L, 0L, 0L, 10_000L),
            )
        for ((total, adding, releasing, limit) in accepted)
            OfflineDeviceLimit.check(total, adding, releasing, limit)
        val refused =
            listOf(
                listOf(9_000L, 1_001L, 0L, 10_000L),
                listOf(0L, 50_001L, 0L, 50_000L),
                listOf(30_000L, 501L, 500L, 10_000L),
            )
        for ((total, adding, releasing, limit) in refused) {
            val failure =
                runCatching { OfflineDeviceLimit.check(total, adding, releasing, limit) }
                    .exceptionOrNull() as TileflowOfflineException
            assertEquals(TileflowOfflineErrorCode.DEVICE_LIMIT_EXCEEDED, failure.code)
            assertEquals(limit.toInt(), failure.context.limit)
        }
        assertNotNull(runCatching { OfflineDeviceLimit.check(5, 1, 6, 10) }.exceptionOrNull())
    }

    private val offlineErrorCodes =
        mapOf(
            "OFFLINE_PACKS_DISABLED" to TileflowOfflineErrorCode.UNAVAILABLE,
            "OFFLINE_PACKS_UNAVAILABLE" to TileflowOfflineErrorCode.UNAVAILABLE,
            "OFFLINE_PACK_GRANT_UNAVAILABLE" to TileflowOfflineErrorCode.UNAVAILABLE,
            "OFFLINE_PACK_INVALID_INPUT" to TileflowOfflineErrorCode.REJECTED,
            "OFFLINE_PACK_AUTHORITY_CONFLICT" to TileflowOfflineErrorCode.REJECTED,
            "OFFLINE_PACK_BODY_TOO_LARGE" to TileflowOfflineErrorCode.REJECTED,
            "MOBILE_CREDENTIAL_INVALID" to TileflowOfflineErrorCode.CREDENTIAL_REJECTED,
            "MOBILE_MAP_MISMATCH" to TileflowOfflineErrorCode.ACCESS_DENIED,
            "OFFLINE_PACK_MAP_NOT_FOUND" to TileflowOfflineErrorCode.NOT_FOUND,
            "OFFLINE_PACK_THEME_NOT_FOUND" to TileflowOfflineErrorCode.NOT_FOUND,
            "OFFLINE_PACKS_NOT_INCLUDED" to TileflowOfflineErrorCode.NOT_INCLUDED,
            "OFFLINE_DOWNLOADS_DISABLED" to TileflowOfflineErrorCode.DOWNLOADS_DISABLED,
            "OFFLINE_PACK_TOO_LARGE" to TileflowOfflineErrorCode.PACK_TOO_LARGE,
            "OFFLINE_PACK_NOT_DOWNLOADABLE" to TileflowOfflineErrorCode.NOT_DOWNLOADABLE,
            "OFFLINE_PACK_GRANT_INVALID" to TileflowOfflineErrorCode.GRANT_REJECTED,
            "OFFLINE_PACK_GRANT_EXPIRED" to TileflowOfflineErrorCode.GRANT_REJECTED,
            "OFFLINE_PACK_GRANT_STALE" to TileflowOfflineErrorCode.GRANT_REJECTED,
            "OFFLINE_PACK_RESOURCE_DENIED" to TileflowOfflineErrorCode.ACCESS_DENIED,
            "OFFLINE_PACK_SUPERSEDED" to TileflowOfflineErrorCode.SUPERSEDED,
            "OFFLINE_DAILY_LIMIT_REACHED" to TileflowOfflineErrorCode.DAILY_LIMIT_REACHED,
            "OFFLINE_TEAM_DAILY_LIMIT_REACHED" to TileflowOfflineErrorCode.DAILY_LIMIT_REACHED,
            "OFFLINE_PACK_REPEAT_LIMIT_REACHED" to TileflowOfflineErrorCode.RATE_LIMITED,
            "COMMERCIAL_MAP_LIMIT_REACHED" to TileflowOfflineErrorCode.QUOTA_EXCEEDED,
            "COMMERCIAL_SPENDING_LIMIT_REACHED" to TileflowOfflineErrorCode.QUOTA_EXCEEDED,
            "RATE_LIMITED" to TileflowOfflineErrorCode.RATE_LIMITED,
        )

    private fun resource(name: String): String =
        javaClass.classLoader!!.getResourceAsStream(name)!!.bufferedReader().use { it.readText() }

    private fun contract() = JSONObject(resource("offline-pack-contract.json"))

    private fun corridors() = JSONArray(resource("offline-corridors.json"))

    /** The service's creation answer, generated by its own code (`packs-v2/release-1`). */
    private fun createdResponse() = JSONObject(resource("packs-v2/release-1/create-response.json"))

    /** The tiles a cover holds at [zoom]. */
    private fun covered(cover: OfflineCover, zoom: Int): List<OfflineTileId> =
        cover.entries
            .flatMap { cover.tiles(it, zoom..zoom)[zoom].orEmpty() }
            .sortedWith(compareBy({ it.y }, { it.x }))

    private fun createdRequest() =
        OfflinePackRequest.requests(
            "map_offlinefixture00",
            listOf("default"),
            TileflowOfflineGeometry.BoundingBox(TileflowBoundingBox(-3.71, 40.41, -3.69, 40.425)),
            OfflineZooms(10..14),
            profile = OfflinePackProfile.WEB_VIEW,
        )[0]

    private fun createdDownload() =
        OfflinePackContract.download(
            createdResponse().toString().toByteArray(),
            createdRequest(),
            allowsLoopbackHttp = false,
        )

    private fun body(request: Request): JSONObject =
        JSONObject(Buffer().also { request.body!!.writeTo(it) }.readUtf8())

    /** Compares JSON values without regard to member order or number types. */
    private fun assertJson(message: String, expected: Any?, actual: Any?) {
        when (expected) {
            is JSONObject -> {
                actual as JSONObject
                assertEquals(
                    message,
                    expected.keys().asSequence().toSet(),
                    actual.keys().asSequence().toSet(),
                )
                for (key in expected.keys()) assertJson(message, expected.get(key), actual.get(key))
            }
            is JSONArray -> {
                actual as JSONArray
                assertEquals(message, expected.length(), actual.length())
                for (index in 0 until expected.length())
                    assertJson(message, expected.get(index), actual.get(index))
            }
            is Number ->
                assertEquals(message, expected.toDouble(), (actual as Number).toDouble(), 0.0)
            else -> assertEquals(message, expected, actual)
        }
    }

    /** The position [metres] to the left of the segment's heading, on a sphere. */
    private fun beside(
        point: TileflowPosition,
        a: TileflowPosition,
        b: TileflowPosition,
        metres: Double,
    ): TileflowPosition {
        val radians = Math.PI / 180
        val dx = (b.longitude - a.longitude) * cos(point.latitude * radians)
        val dy = b.latitude - a.latitude
        val length = sqrt(dx * dx + dy * dy)
        val degrees = metres / 6_371_008.8 / radians
        return TileflowPosition(
            point.longitude - dy / length * degrees / cos(point.latitude * radians),
            point.latitude + dx / length * degrees,
        )
    }

}
