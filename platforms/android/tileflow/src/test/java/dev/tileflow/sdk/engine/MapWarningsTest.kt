package dev.tileflow.sdk.engine

import dev.tileflow.sdk.TileflowResourceKind
import dev.tileflow.sdk.transport.MapResourceOutcome
import java.io.IOException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Repeated resource failures reach the application once per window, with their count. */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class MapWarningsTest {
    private val reported = mutableListOf<JSONObject>()
    private val scheduled = mutableListOf<() -> Unit>()
    private val warnings =
        MapWarnings(report = { reported += it }, schedule = { _, block -> scheduled += block })
    private val origin = "https://api.tileflow.test"

    @Test
    fun theFirstFailureIsReportedAtOnceAndRepeatsWhenTheWindowCloses() {
        repeat(3) { warnings.resource(MapResourceOutcome(TileflowResourceKind.TILE, origin, 504)) }
        val down = IOException("down")
        warnings.resource(MapResourceOutcome(TileflowResourceKind.GLYPHS, origin, null, down))
        assertEquals(2, reported.size)
        val first = reported[0]
        assertEquals("resourceFailed", first.getString("code"))
        assertEquals(1, first.getInt("count"))
        assertEquals("tile", first.getJSONObject("context").getString("resource"))
        assertEquals(origin, first.getJSONObject("context").getString("origin"))
        assertEquals(504, first.getJSONObject("context").getInt("status"))
        assertEquals(false, reported[1].getJSONObject("context").has("status"))
        scheduled.toList().forEach { it() }
        assertEquals(3, reported.size)
        assertEquals(2, reported[2].getInt("count"))
    }

    @Test
    fun answeredResourcesAndMissingTilesAreNotFailures() {
        for (status in listOf(200, 204, 206, 304))
            warnings.resource(MapResourceOutcome(TileflowResourceKind.TILE, origin, status))
        warnings.resource(MapResourceOutcome(TileflowResourceKind.TILE, origin, 404))
        assertEquals(0, reported.size)
        warnings.resource(MapResourceOutcome(TileflowResourceKind.SPRITE, origin, 404))
        assertEquals(1, reported.size)
    }

    @Test
    fun aRetiredMapReportsNothing() {
        warnings.resource(MapResourceOutcome(TileflowResourceKind.TILE, origin, 500))
        warnings.resource(MapResourceOutcome(TileflowResourceKind.TILE, origin, 500))
        warnings.retire()
        scheduled.toList().forEach { it() }
        warnings.resource(MapResourceOutcome(TileflowResourceKind.TILE, origin, 500))
        assertEquals(1, reported.size)
    }
}
