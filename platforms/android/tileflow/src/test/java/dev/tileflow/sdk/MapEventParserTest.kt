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
    @Test
    public fun parsesCoordinatesAndIgnoresUnknownEvents() {
        assertEquals(
            TileflowMapEvent.Tap(-3.7, 40.42),
            parseMapEvent(
                "interaction",
                JSONObject("""{"coordinate":{"longitude":-3.7,"latitude":40.42}}"""),
            ),
        )
        assertNull(parseMapEvent("futureEvent", JSONObject()))
        assertThrows(IllegalArgumentException::class.java) {
            parseMapEvent(
                "interaction",
                JSONObject("""{"coordinate":{"longitude":181,"latitude":0}}"""),
            )
        }
        assertThrows(org.json.JSONException::class.java) {
            parseMapEvent("cameraChanged", JSONObject())
        }
    }
}
