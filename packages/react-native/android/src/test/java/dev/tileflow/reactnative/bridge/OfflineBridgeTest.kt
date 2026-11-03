package dev.tileflow.reactnative.bridge

import dev.tileflow.sdk.TileflowErrorContext
import dev.tileflow.sdk.offline.TileflowOfflineErrorCode
import dev.tileflow.sdk.offline.TileflowOfflineException
import dev.tileflow.sdk.offline.TileflowOfflineRegionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class OfflineBridgeTest {
    private val hosted = mapOf("type" to "hosted", "mapId" to "map_0123456789abcdef", "themes" to listOf("day", "night"))

    @Test
    fun optionsKeepTheirShapeBothWays() {
        val geometries =
            listOf(
                mapOf("type" to "boundingBox", "west" to -3.8, "south" to 40.3, "east" to -3.6, "north" to 40.5),
                mapOf(
                    "type" to "Polygon",
                    "coordinates" to listOf(listOf(listOf(-3.8, 40.3), listOf(-3.6, 40.3), listOf(-3.6, 40.5), listOf(-3.8, 40.3))),
                ),
                mapOf(
                    "type" to "GeometryCollection",
                    "geometries" to
                        listOf(
                            mapOf("type" to "Point", "coordinates" to listOf(-3.7, 40.4)),
                            mapOf("type" to "LineString", "coordinates" to listOf(listOf(-3.7, 40.4), listOf(-3.6, 40.45))),
                        ),
                ),
                mapOf("type" to "corridor", "line" to listOf(listOf(-3.7, 40.4), listOf(-3.6, 40.45)), "width" to 500.0),
            )
        for (geometry in geometries) {
            val options =
                mapOf(
                    "geometry" to geometry,
                    "content" to hosted,
                    "minZoom" to 2.0,
                    "maxZoom" to 14.0,
                    "terrainMaxZoom" to 11.0,
                    "networkRestriction" to "disallowExpensive",
                    "metadata" to mapOf("name" to "Madrid"),
                )
            assertEquals(normalized(options), normalized(OfflineBridge.encode(OfflineBridge.options(options))))
        }
    }

    @Test
    fun omittedOptionsTakeTheSdkDefaults() {
        val encoded =
            OfflineBridge.encode(
                OfflineBridge.options(
                    mapOf(
                        "geometry" to mapOf("type" to "Point", "coordinates" to listOf(-3.7, 40.4)),
                        "content" to
                            mapOf(
                                "type" to "manifest",
                                "url" to "https://maps.example.test/manifest.json",
                                "map" to "stores",
                                "sources" to
                                    listOf(
                                        mapOf("id" to "streets", "template" to "https://tiles.example.test/{z}/{x}/{y}.pbf", "maxZoom" to 14.0)
                                    ),
                            ),
                    )
                )
            )
        assertEquals(0, encoded["minZoom"])
        assertEquals(15, encoded["maxZoom"])
        assertEquals(12, encoded["terrainMaxZoom"])
        assertEquals("none", encoded["networkRestriction"])
    }

    @Test
    fun invalidArgumentsBecomeOfflineErrors() {
        val missing = assertThrows(BridgeArgumentException::class.java) { OfflineBridge.options(mapOf("geometry" to mapOf("type" to "boundingBox"))) }
        val failure = OfflineBridge.failure(missing)
        assertEquals("invalidOptions", failure.code)
        assertEquals("options.geometry.west must be a number", failure.message)
        assertEquals(false, failure.info["recoverable"])
        val invalid =
            assertThrows(TileflowOfflineException::class.java) {
                OfflineBridge.options(mapOf("geometry" to mapOf("type" to "Circle", "coordinates" to emptyList<Any>()), "content" to hosted))
            }
        assertEquals("invalidRegion", OfflineBridge.failure(invalid).code)
        assertEquals("invalidGeoJSON", OfflineBridge.failure(invalid).info["reason"])
    }

    @Test
    fun offlineErrorsCarryTheirFields() {
        val error =
            TileflowOfflineException(
                TileflowOfflineErrorCode.RATE_LIMITED,
                TileflowErrorContext(reason = "tooManyRequests", status = 429),
                retryAfterMillis = 1500,
            )
        assertEquals(
            normalized(mapOf("code" to "rateLimited", "recoverable" to true, "reason" to "tooManyRequests", "status" to 429, "retryAfter" to 1500)),
            normalized(OfflineBridge.failure(error).info),
        )
    }

    @Test
    fun regionEventsHaveATypeTag() {
        assertEquals(mapOf("type" to "removed", "id" to "madrid"), OfflineBridge.encode(TileflowOfflineRegionEvent.Removed("madrid")))
    }
}
