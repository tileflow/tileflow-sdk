package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.tileflow.configuration.TileflowConfiguration
import dev.tileflow.configuration.TileflowCredential
import dev.tileflow.sdk.engine.NativeStyleDocument
import dev.tileflow.sdk.hosted.HostedEndpoint
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.offline.OfflineCover
import dev.tileflow.sdk.offline.OfflinePackFormat
import dev.tileflow.sdk.offline.OfflinePackKind
import dev.tileflow.sdk.offline.OfflineServedPacks
import dev.tileflow.sdk.offline.OfflineServedTiles
import dev.tileflow.sdk.offline.OfflineServingIndex
import dev.tileflow.sdk.offline.OfflineServingSnapshot
import dev.tileflow.sdk.offline.OfflineTileId
import dev.tileflow.sdk.offline.OfflineTileTemplate
import dev.tileflow.sdk.transport.MapResourceContexts
import dev.tileflow.sdk.transport.MapResourceOutcome
import dev.tileflow.sdk.transport.MapResourceRoute
import dev.tileflow.sdk.transport.ResourceCacheScope
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.ResourcePolicy
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.URI
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.sinh
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.maplibre.android.MapLibre
import org.maplibre.android.camera.CameraPosition
import org.maplibre.android.geometry.LatLng
import org.maplibre.android.maps.MapLibreMap
import org.maplibre.android.maps.MapLibreMapOptions
import org.maplibre.android.maps.MapView
import org.maplibre.android.maps.Style

/** A MapLibre map showing [style] at [camera], with the engine's own snapshot. */
public class NativeStyleHostActivity : ComponentActivity() {
    lateinit var mapView: MapView
    @Volatile var map: MapLibreMap? = null
    val loaded = CountDownLatch(1)
    val failures = CopyOnWriteArrayList<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        MapLibre.getInstance(this)
        val options =
            MapLibreMapOptions.createFromAttributes(this)
                .attributionEnabled(false)
                .logoEnabled(false)
                .camera(camera)
        mapView = MapView(this, options)
        mapView.onCreate(savedInstanceState)
        mapView.addOnDidFailLoadingMapListener { failures.add(it) }
        mapView.addOnDidFinishLoadingMapListener { loaded.countDown() }
        setContentView(mapView)
        mapView.getMapAsync { ready ->
            map = ready
            ready.setStyle(Style.Builder().fromJson(style!!))
        }
    }

    override fun onStart() {
        super.onStart()
        mapView.onStart()
    }

    override fun onResume() {
        super.onResume()
        mapView.onResume()
    }

    override fun onPause() {
        mapView.onPause()
        super.onPause()
    }

    override fun onStop() {
        mapView.onStop()
        super.onStop()
    }

    override fun onDestroy() {
        mapView.onDestroy()
        super.onDestroy()
    }

    /** What the engine drew. */
    fun snapshot(): Bitmap? {
        val done = CountDownLatch(1)
        var result: Bitmap? = null
        runOnUiThread {
            map?.snapshot {
                result = it
                done.countDown()
            } ?: done.countDown()
        }
        done.await(15, TimeUnit.SECONDS)
        return result
    }

    internal companion object {
        @Volatile var style: String? = null
        @Volatile var camera: CameraPosition? = null
    }
}

/**
 * A downloaded Bathymetry elevation model draws without a network where a tile is absent: the
 * transport answers the absent tile with the source's absent status, MapLibre draws its stored
 * parent, and, because the projection starts the source at its lowest stored zoom, never asks for
 * ancestors no region holds.
 *
 * The regions come from the marine fixture (release 1: its style pack, the elevation source's
 * template, stored zooms and absent status), with the fixture's elevation pack entries carrying
 * decodable Terrarium tiles. A MapLibre map draws the projected style through the production
 * interception and a resource loader with the network switched off.
 */
@RunWith(AndroidJUnit4::class)
public class NativeElevationOfflineIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val assets = instrumentation.context.assets
    private val root =
        File(context.cacheDir, "native-elevation-${System.nanoTime()}").apply { mkdirs() }
    private val api = URI("https://api.tileflow.test")
    private val mapId = "map_offlinefixture00"
    private val styleUrl =
        "https://api.tileflow.test/maps/map_offlinefixture00/mobile/webview-v1/v1/default.json"
    /** The release's Madrid anchor, which holds 8/125/96 and 9/250/193. */
    private val anchor = OfflineTileId(7, 62, 48)

    @Test
    public fun anAbsentElevationTileDrawsItsStoredParentWithoutTheNetwork() {
        val response = asset("packs-v2/release-1/create-response.json").decodeToString()
        val manifest = JSONObject(response).getJSONObject("manifest")
        val dem =
            manifest.getJSONArray("sources").let { sources ->
                (0 until sources.length()).map(sources::getJSONObject).single {
                    it.getString("source") == "bathymetry-dem"
                }
            }
        val template = dem.getString("template")
        val zooms = dem.getJSONArray("zooms").let { it.getInt(0)..it.getInt(1) }
        assertEquals(8..9, zooms)
        val documents =
            File(root, "style.tfpack").apply {
                writeBytes(asset("packs-v2/release-1/packs/style.tfpack"))
            }
        val tiles =
            File(root, "bathymetry-dem.tfpack").apply {
                writeBytes(
                    tilePack(
                        listOf(
                            "8/125/96" to asset("terrarium-minus2000.webp"),
                            "9/250/193" to asset("terrarium-minus500.webp"),
                        )
                    )
                )
            }
        val scope = ResourceCacheScope.grant(api, mapId)
        val index = OfflineServingIndex()
        index.publish(
            OfflineServingSnapshot(
                packs =
                    mapOf(
                        scope.directory to
                            OfflineServedPacks(
                                OfflinePackFormat.index(documents).entries.values.associate {
                                    it.name to (documents to it)
                                },
                                mapOf(
                                    template to
                                        OfflineServedTiles(
                                            OfflineTileTemplate.of(template)!!,
                                            zooms,
                                            dem.getInt("absentStatus"),
                                            listOf(
                                                OfflineCover(
                                                    zooms.first,
                                                    zooms.last,
                                                    listOf(OfflineCover.Entry(anchor, null)),
                                                )
                                            ),
                                            mapOf(anchor to listOf(tiles)),
                                        )
                                ),
                            )
                    )
            ),
            this,
        )
        val configuration =
            TileflowConfiguration(
                apiOrigin = api,
                mapCredential = TileflowCredential("tf_public_" + "f".repeat(48)),
            )
        val session = HostedSession(HostedEndpoint(configuration), mapId, "mobile-map")
        val loader =
            ResourceLoader(
                ResourcePolicy(setOf("https://api.tileflow.test")),
                hosted = session,
                apiOrigin = api,
                cache = TileflowMapCache.get(context).store,
                grantScope = scope,
                offline = index,
                networkEnabled = { false },
            )
        val outcomes = CopyOnWriteArrayList<MapResourceOutcome>()
        val mapContext =
            MapResourceContexts.register(
                MapResourceRoute(
                    loader,
                    classify = { TileflowResourceKind.TILE },
                    report = { outcomes.add(it) },
                )
            )
        val requests = EngineRequests()
        var activity: NativeStyleHostActivity? = null
        try {
            val installed = CountDownLatch(1)
            var failure: Throwable? = null
            instrumentation.runOnMainSync {
                MapResourceContexts.install(context) {
                    failure = it
                    installed.countDown()
                }
            }
            assertTrue(installed.await(10, TimeUnit.SECONDS))
            assertEquals(null, failure)
            instrumentation.runOnMainSync { MapResourceContexts.acquire() }

            fun load(url: URI): ByteArray {
                val payload = loader.load(url)
                check(payload.status == 200) { "$url answered ${payload.status}" }
                return payload.bytes
            }
            val fixtureStyle = JSONObject(load(URI(styleUrl)).decodeToString())
            val depths = fixtureStyle.getJSONObject("sources").getJSONObject("depths")
            // Core's Bathymetry elevation source: Terrarium, 512-pixel tiles.
            depths.put("encoding", "terrarium").put("tileSize", 512)
            val style =
                JSONObject()
                    .put("version", 8)
                    .put("sources", JSONObject().put("depths", depths))
                    .put(
                        "layers",
                        JSONArray()
                            .put(
                                JSONObject(
                                    """
                                    {"id": "background", "type": "background",
                                     "paint": {"background-color": "#ffffff"}}
                                    """
                                )
                            )
                            .put(
                                JSONObject(
                                    """
                                    {"id": "relief", "type": "color-relief", "source": "depths",
                                     "paint": {"color-relief-color": ["interpolate", ["linear"],
                                       ["elevation"], -4000, "#08306b", -500, "#6baed6",
                                       0, "#c6dbef"]}}
                                    """
                                )
                            ),
                    )
            val projected =
                NativeStyleDocument.project(style, styleUrl, mapContext, ::load) {
                    index.storedZooms(scope, it)
                }
            assertEquals(
                "The source starts at its lowest stored zoom",
                8,
                projected.style.getJSONObject("sources").getJSONObject("depths").getInt("minzoom"),
            )
            // The centre of 8/125/96, where its four z9 children meet; only 9/250/193 is stored.
            val longitude = 251.0 / 512 * 360 - 180
            val latitude = Math.toDegrees(atan(sinh(PI * (1 - 2 * 193.0 / 512))))
            NativeStyleHostActivity.style = projected.style.toString()
            NativeStyleHostActivity.camera =
                CameraPosition.Builder().target(LatLng(latitude, longitude)).zoom(9.5).build()
            val intent =
                Intent(instrumentation.context, NativeStyleHostActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val shown = instrumentation.startActivitySync(intent) as NativeStyleHostActivity
            activity = shown
            assertTrue(
                "The map did not finish loading: ${shown.failures}",
                shown.loaded.await(30, TimeUnit.SECONDS),
            )
            // Let the stored parent reach the screen.
            Thread.sleep(1_500)
            val bitmap = shown.snapshot()!!
            val tile = Regex("/(\\d+)/(\\d+)/(\\d+)\\.webp")
            val demRequests =
                requests.matching("/dem/").map { (url, status) ->
                    val (z, x, y) = tile.find(url.path)!!.destructured
                    "$z/$x/$y" to status
                }
            val report =
                "requests: ${demRequests.sortedBy { it.first }}, " +
                    "outcomes: ${outcomes.map { it.status }}"
            println("Tileflow elevation offline: $report; relief share ${reliefShare(bitmap)}")
            assertTrue(
                "No ancestor below the lowest stored zoom: $report",
                demRequests.all { it.first.substringBefore('/').toInt() >= 8 },
            )
            assertTrue(
                "The stored parent was drawn from the pack: $report",
                ("8/125/96" to 200) in demRequests,
            )
            assertTrue(
                "An absent z9 tile answered 204: $report",
                demRequests.any { it.first.startsWith("9/") && it.second == 204 },
            )
            assertTrue(
                "Every request answered: $report",
                demRequests.all { it.second == 200 || it.second == 204 },
            )
            assertTrue(
                "No failures: $report",
                outcomes.all { it.error == null && (it.status ?: 500) < 400 },
            )
            assertEquals(emptyList<String>(), requests.delegated.toList())
            assertTrue("The map failed: ${shown.failures}", shown.failures.isEmpty())
            val relief = reliefShare(bitmap)
            assertTrue("The relief drew (share $relief)", relief > 0.9)
        } finally {
            requests.close()
            activity?.let { instrumentation.runOnMainSync { it.finish() } }
            instrumentation.waitForIdleSync()
            instrumentation.runOnMainSync { MapResourceContexts.release() }
            MapResourceContexts.retire(mapContext)
            loader.close()
            session.close()
            root.deleteRecursively()
        }
    }

    private fun asset(name: String): ByteArray = assets.open(name).use { it.readBytes() }

    /** The share of pixels the relief colours: blue well above red, unlike the white background. */
    private fun reliefShare(bitmap: Bitmap): Double {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        return pixels.count { Color.blue(it) - Color.red(it) > 40 }.toDouble() / pixels.size
    }

    /** A tiles pack (`TFPK` version 1) holding [entries] by name. */
    private fun tilePack(entries: List<Pair<String, ByteArray>>): ByteArray {
        val index = ByteArrayOutputStream()
        var offset = 0L
        for ((name, body) in entries) {
            val nameBytes = name.toByteArray()
            val type = "image/webp".toByteArray()
            val record =
                ByteBuffer.allocate(2 + nameBytes.size + 1 + type.size + 1 + 12)
                    .order(ByteOrder.LITTLE_ENDIAN)
            record
                .putShort(nameBytes.size.toShort())
                .put(nameBytes)
                .put(type.size.toByte())
                .put(type)
                .put(0.toByte())
            record.putLong(offset).putInt(body.size)
            index.write(record.array())
            offset += body.size
        }
        val indexBytes = index.toByteArray()
        val header = ByteBuffer.allocate(32).order(ByteOrder.LITTLE_ENDIAN)
        header
            .put("TFPK".toByteArray())
            .putShort(1.toShort())
            .put(OfflinePackKind.TILES.code.toByte())
            .put(0.toByte())
            .putInt(entries.size)
            .putInt(indexBytes.size)
            .putLong(offset)
            .putLong(0)
        val content = ByteArrayOutputStream()
        content.write(header.array())
        content.write(indexBytes)
        for ((_, body) in entries) content.write(body)
        val bytes = content.toByteArray()
        return bytes + MessageDigest.getInstance("SHA-256").digest(bytes)
    }
}
