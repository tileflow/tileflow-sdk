package dev.tileflow.sdk

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
public class MapEventParserTest {
    private val camera = """{"longitude":-3.7,"latitude":40.42,"zoom":12,"bearing":0,"pitch":0}"""

    @Test
    public fun parsesCoordinatesAndIgnoresUnknownEvents() {
        assertEquals(
            TileflowMapEvent.Tap(-3.7, 40.42),
            parseMapEvent(
                "tap",
                JSONObject(
                    """{"coordinate":{"longitude":-3.7,"latitude":40.42},"point":{"x":1,"y":2}}"""
                ),
            ),
        )
        assertNull(parseMapEvent("futureEvent", JSONObject()))
        assertThrows(IllegalArgumentException::class.java) {
            parseMapEvent("tap", JSONObject("""{"coordinate":{"longitude":181,"latitude":0}}"""))
        }
        assertThrows(org.json.JSONException::class.java) {
            parseMapEvent("cameraMoveEnded", JSONObject())
        }
    }

    @Test
    public fun cameraEventsCarryPhaseAndReason() {
        val started =
            parseMapEvent(
                "cameraMoveStarted",
                JSONObject("""{"camera":$camera,"reason":"gesture","revision":1}"""),
            ) as TileflowMapEvent.CameraChanged
        assertEquals(TileflowCameraChangePhase.STARTED, started.change.phase)
        assertEquals(TileflowCameraChangeReason.GESTURE, started.change.reason)
        val ended =
            parseMapEvent("cameraMoveEnded", JSONObject("""{"camera":$camera,"reason":"api"}"""))
                as TileflowMapEvent.CameraChanged
        assertEquals(true, ended.change.isFinal)
        assertEquals(TileflowCameraChangeReason.API, ended.change.reason)
        assertThrows(IllegalArgumentException::class.java) {
            parseMapEvent("cameraMoved", JSONObject("""{"camera":$camera,"reason":"teleport"}"""))
        }
        for (reason in TileflowCameraChangeReason.entries) {
            parseMapEvent(
                "cameraMoved",
                JSONObject("""{"camera":$camera,"reason":"${reason.wireName}"}"""),
            )
        }
    }

    @Test
    public fun failuresAndWarningsCarryTheSharedTaxonomyAndContext() {
        val warning =
            parseMapEvent(
                "warning",
                JSONObject(
                    """{"code":"resourceFailed","message":"A map resource failed to load.","count":12,"context":{"resource":"tile","origin":"https://tiles.example.com","status":503}}"""
                ),
            ) as TileflowMapEvent.Warning
        assertEquals(TileflowErrorCode.RESOURCE_FAILED, warning.code)
        assertEquals(12, warning.occurrences)
        assertEquals(TileflowResourceKind.TILE, warning.context.resource)
        assertEquals("https://tiles.example.com", warning.context.origin)
        assertEquals(503, warning.context.status)
        val failure =
            parseMapEvent(
                "error",
                JSONObject(
                    """{"code":"rendererFailed","message":"The graphics context was lost.","context":{"reason":"graphicsContextLost"}}"""
                ),
            ) as TileflowMapEvent.Failed
        assertEquals(TileflowErrorCode.RENDERER_FAILED, failure.code)
        assertEquals("graphicsContextLost", failure.context.reason)
        assertEquals(true, failure.isRecoverable)
        // Codes only the host may raise, or unknown codes, are renderer faults.
        for (code in listOf("credentialRejected", "evaluate")) {
            assertEquals(
                TileflowMapEvent.Failed(TileflowErrorCode.RENDERER_FAILED),
                parseMapEvent("error", JSONObject().put("code", code)),
            )
        }
    }
}
