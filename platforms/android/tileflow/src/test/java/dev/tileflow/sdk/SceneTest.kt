package dev.tileflow.sdk

import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Color
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.EventSubscriptions
import dev.tileflow.sdk.bridge.ProtocolContract
import java.time.Instant
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class SceneTest {
    private val text = """{"type":"FeatureCollection","features":[]}"""

    private fun refused(block: () -> Unit) {
        val error = assertThrows(TileflowMapException::class.java) { block() }
        assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
    }

    @Test
    fun rendererOptionsStayOutOfTheLiveOptionsAndVegetationFollowsTheMap() {
        val options =
            TileflowMapOptions(vegetation = false, antialias = false, validatesStyle = true)
        assertEquals(false, options.json().get("vegetation"))
        assertFalse(options.json().has("antialias"))
        assertEquals(JSONObject.NULL, TileflowMapOptions().json().get("vegetation"))
        assertEquals(
            """{"antialias":false,"validateStyle":true}""",
            options.rendererJson().toString(),
        )
    }

    @Test
    fun layersTakeRouteInksPlacementAndProgressOnlyWhereTheyApply() {
        val route =
            TileflowGeoJSONLayer(
                "route-line",
                text,
                TileflowGeoJSONLayerKind.LINE,
                ink = TileflowRouteInk.LINE,
                placement = TileflowLayerPlacement.GROUND,
                occludedOpacity = 0.35,
                progress = TileflowLineProgress(end = 0.25, highlight = "#ffffff"),
            )
        val json = route.json(DataChannel.Reference("data", 1, "digest"))
        assertEquals("line", json.getString("ink"))
        assertEquals("ground", json.getString("placement"))
        assertEquals(0.35, json.getDouble("occludedOpacity"), 0.0)
        assertEquals(0.25, json.getJSONObject("progress").getDouble("end"), 0.0)
        assertTrue(json.getJSONObject("progress").isNull("light"))
        // A copy with another stretch shares the data.
        val drawn = route.withProgress(TileflowLineProgress(end = 1.0))
        assertEquals(route.digest, drawn.digest)
        assertEquals(1.0, drawn.progress?.end)
        val fill = TileflowGeoJSONLayerKind.FILL
        val line = TileflowGeoJSONLayerKind.LINE
        refused { TileflowGeoJSONLayer("a", text, fill, progress = TileflowLineProgress()) }
        // A line above the map is never hidden, so it has nothing to show through.
        refused { TileflowGeoJSONLayer("a", text, line, occludedOpacity = 1.0) }
        refused {
            TileflowGeoJSONLayer("a", text, line, progress = TileflowLineProgress(end = 2.0))
        }
        refused {
            TileflowGeoJSONLayer(
                "a",
                text,
                line,
                progress = TileflowLineProgress(highlight = "white"),
            )
        }
    }

    @Test
    fun boundaryRowsTravelInKeyOrderAndCheckTheirKeys() {
        val values =
            TileflowBoundaryValues.byIds(
                mapOf(
                    20L to TileflowBoundaryValue.Category("high"),
                    3L to TileflowBoundaryValue.Number(4.5),
                ),
                labels = true,
                state = "share",
            )
        val (joinBy, rows) = values.rows()
        assertEquals("id", joinBy)
        assertEquals("""[[3,4.5],[20,"high"]]""", rows.toString(Charsets.UTF_8))
        assertEquals(
            "ref",
            TileflowBoundaryValues.byRefs(mapOf("ES-MD" to TileflowBoundaryValue.Number(1.0)))
                .rows()
                .first,
        )
        refused {
            TileflowBoundaryValues.byIds(mapOf(-1L to TileflowBoundaryValue.Number(1.0))).rows()
        }
        refused {
            TileflowBoundaryValues.byIds(
                    mapOf(1L to TileflowBoundaryValue.Number(1.0)),
                    state = "a state",
                )
                .rows()
        }
        refused {
            TileflowBoundaryValues.byIds(mapOf(1L to TileflowBoundaryValue.Number(Double.NaN)))
                .rows()
        }
    }

    @Test
    fun imagesMarkersAndShotsCheckTheirParameters() {
        refused { TileflowMapImage("../pin", byteArrayOf(1)) }
        refused { TileflowMapImage("pin", byteArrayOf(1), pixelRatio = 8.0) }
        refused { TileflowMapImage("pin", ByteArray(0)) }
        val bitmap = Bitmap.createBitmap(12, 16, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(Color.RED)
        val image = TileflowMapImage.fromBitmap("pin", bitmap, mapOf("night" to bitmap))
        assertTrue(image.data.isNotEmpty())
        assertEquals(setOf("night"), image.variants.keys)

        val marker =
            TileflowDepthMarker(
                "cafe",
                TileflowCoordinate(-3.7, 40.42),
                "pin",
                24.0,
                32.0,
                anchor = TileflowDepthMarker.Anchor.BOTTOM,
                altitude = 12.0,
            )
        val json = marker.json()
        assertEquals("bottom", json.getString("anchor"))
        assertTrue(json.getBoolean("occlude"))
        refused { marker.copy(altitude = 20_000.0).json() }

        val start = TileflowCamera(-3.7, 40.42, 13.0)
        val end = TileflowCamera(-3.69, 40.42, 15.0, pitch = 60.0)
        val shot =
            TileflowShot(
                listOf(TileflowShot.Keyframe(0, start), TileflowShot.Keyframe(2500, end)),
                cues = listOf(TileflowShot.Cue(1000, "title")),
            )
        assertEquals(
            2500,
            shot.json().getJSONArray("keyframes").getJSONObject(1).getLong("at"),
        )
        for (invalid in
            listOf(
                TileflowShot(
                    listOf(TileflowShot.Keyframe(500, start), TileflowShot.Keyframe(1000, end))
                ),
                TileflowShot(
                    listOf(TileflowShot.Keyframe(0, start), TileflowShot.Keyframe(0, end))
                ),
                TileflowShot(listOf(TileflowShot.Keyframe(0, start))),
                shot.copy(cues = listOf(TileflowShot.Cue(3000, "late"))),
                // Blend positions need the themes, and themes need a position at every keyframe.
                TileflowShot(
                    listOf(TileflowShot.Keyframe(0, start, 0.0), TileflowShot.Keyframe(1000, end))
                ),
                TileflowShot(
                    listOf(TileflowShot.Keyframe(0, start, 0.0), TileflowShot.Keyframe(1000, end)),
                    themes = listOf("day", "night"),
                ),
            )) {
            refused { invalid.json() }
        }
        refused { TileflowSun.json(TileflowSun.Direction(0.0, 91.0)) }
        val date = TileflowSun.AtDate(Instant.ofEpochSecond(1_782_064_800))
        assertEquals(1_782_064_800_000, (TileflowSun.json(date) as JSONObject).getLong("date"))
    }

    @Test
    fun themeTransitionsReportEveryPhaseAndTheSettledInks() {
        val inks =
            JSONObject()
                .put("line", "#60a5fa")
                .put("casing", "#0b1220")
                .put("core", "#eff6ff")
                .put("glow", "#60a5fa")
                .put("alternative", "#64748b")
                .put("glowOpacity", 0.4)
                .put("coreOpacity", 0.7)
        val ready =
            parseMapEvent(
                "themeTransition",
                JSONObject()
                    .put("phase", "ready")
                    .put("currentTheme", "dark")
                    .put("targetTheme", "dark")
                    .put("routeInks", inks),
            ) as TileflowMapEvent.ThemeTransition
        assertEquals(TileflowThemeTransition.Phase.READY, ready.transition.phase)
        assertEquals(TileflowRouteInks.DARK, ready.transition.routeInks)
        assertEquals("#60a5fa", ready.transition.routeInks!![TileflowRouteInk.GLOW])
        val failed =
            parseMapEvent(
                "themeTransition",
                JSONObject().put("phase", "error").put("targetTheme", "night"),
            ) as TileflowMapEvent.ThemeTransition
        assertEquals(TileflowThemeTransition.Phase.FAILED, failed.transition.phase)
        assertNull(failed.transition.currentTheme)
        assertThrows(IllegalArgumentException::class.java) {
            parseMapEvent("themeTransition", JSONObject().put("phase", "done"))
        }
    }

    @Test
    fun essentialEventsIncludeThemeTransitionsAndAnimationEnds() {
        val events = EventSubscriptions(TileflowEventOptions(TileflowEventLevel.ESSENTIAL)).events
        for (event in
            listOf(
                ProtocolContract.Event.THEME_TRANSITION,
                ProtocolContract.Event.ANIMATION_ENDED,
                ProtocolContract.Event.SHOT_CUE,
            )) {
            assertEquals(0L, events[event])
        }
    }

    @Test
    fun aNewRendererReceivesTheSceneAtOnceAndInOrder() {
        val state = SceneState()
        state.depthMarkers =
            SceneCommand(ProtocolContract.Method.SET_DEPTH_MARKERS, JSONObject().put("markers", 0))
        state.images = SceneCommand(ProtocolContract.Method.SET_IMAGES, JSONObject())
        state.sun =
            SceneCommand(ProtocolContract.Method.SET_SUN, JSONObject().put("duration", 450))
        val traffic = SceneCommand(ProtocolContract.Method.SET_STYLE_STATE, JSONObject())
        state.setStyleState("traffic", traffic)
        state.setStyleState("night", traffic)
        state.setStyleState("traffic", traffic)
        assertEquals(
            listOf(
                ProtocolContract.Method.SET_IMAGES,
                ProtocolContract.Method.SET_DEPTH_MARKERS,
                ProtocolContract.Method.SET_SUN,
                ProtocolContract.Method.SET_STYLE_STATE,
                ProtocolContract.Method.SET_STYLE_STATE,
            ),
            state.commands.map { it.method },
        )
        assertEquals(listOf("night", "traffic"), state.styleStates.keys.toList())
        val channel = DataChannel()
        assertEquals(0, state.sun!!.build(channel, true).first.getInt("duration"))
        assertEquals(450, state.sun!!.build(channel, false).first.getInt("duration"))
    }

    @Test
    fun animationWaitsEndWithTheirRendererAndCallCuesBack(): Unit = runBlocking {
        val waiters = AnimationWaiters()
        // An end that arrives first is kept for the call that learns its identifier.
        waiters.receive("animationEnded", JSONObject().put("animation", "a1").put("finished", true))
        assertTrue(waiters.wait("a1", null))
        val cues = mutableListOf<String>()
        val shot = async { waiters.wait("a2") { cues += it } }
        yield()
        waiters.receive("shotCue", JSONObject().put("animation", "a2").put("cue", "title"))
        waiters.receive(
            "animationEnded",
            JSONObject().put("animation", "a2").put("finished", false),
        )
        assertFalse(shot.await())
        assertEquals(listOf("title"), cues)
        val replaced = async { runCatching { waiters.wait("a3", null) } }
        yield()
        waiters.retire(TileflowErrorCode.CANCELLED)
        val error = replaced.await().exceptionOrNull() as TileflowMapException
        assertEquals(TileflowErrorCode.CANCELLED, error.code)
    }

    @Test
    fun sceneCallsCheckTheirParametersBeforeTheRenderer(): Unit = runBlocking {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val view = TileflowMapView(activity)
        try {
            // Without a renderer, the scene is kept for the next one.
            view.setSun(TileflowSun.Direction(120.0, 30.0))
            view.setStyleState("traffic", TileflowStyleValue.Number(0.5))
            view.setViewMode(TileflowViewMode.THREE_DIMENSIONAL, durationMillis = 1000)
            assertEquals(TileflowViewMode.THREE_DIMENSIONAL, view.options.viewMode)
            assertEquals(2, view.scene.commands.size)
            for (invalid in
                listOf<suspend () -> Unit>(
                    { view.setSun(TileflowSun.Direction(0.0, 91.0)) },
                    { view.setSun(null, durationMillis = 6000) },
                    { view.setStyleState(" padded", TileflowStyleValue.Bool(true)) },
                    {
                        view.setEmphasis(
                            TileflowEmphasis(recede = mapOf(TileflowMapModule("Roads") to 0.5))
                        )
                    },
                    { view.setEmphasis(TileflowEmphasis(labels = 2.0)) },
                    {
                        val marker =
                            TileflowDepthMarker(
                                "same",
                                TileflowCoordinate(0.0, 0.0),
                                "pin",
                                1.0,
                                1.0,
                            )
                        view.setDepthMarkers(listOf(marker, marker))
                    },
                )) {
                val error = runCatching { invalid() }.exceptionOrNull() as TileflowMapException
                assertEquals(TileflowErrorCode.INVALID_REQUEST, error.code)
            }
            val notReady =
                runCatching { view.routeInks() }.exceptionOrNull() as TileflowMapException
            assertEquals(TileflowErrorCode.NOT_READY, notReady.code)
        } finally {
            view.destroy()
        }
    }
}
