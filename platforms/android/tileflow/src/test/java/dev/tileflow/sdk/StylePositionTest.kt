package dev.tileflow.sdk

import android.app.Activity
import kotlinx.coroutines.runBlocking
import dev.tileflow.sdk.engine.MapEngine
import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.model.MapPayloadStore
import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class StylePositionTest {
    @Test
    fun canonicalPositionsRejectCrossSlotAndPreserveExplicitNull() = runBlocking {
        val fixture = JSONObject(javaClass.getResource("/style-position-fixtures.json")!!.readText())
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        fun slot(value: JSONObject) = TileflowLayerSlot.entries.firstOrNull { it.wireName == value.optString("slot") }
        fun layer(value: JSONObject) = TileflowCircleLayer(value.getString("id"), "points").slot(slot(value))
        try {
            for (raw in 0 until fixture.getJSONArray("rejections").length()) {
                val test = fixture.getJSONArray("rejections").getJSONObject(raw)
                val map = TileflowMapView(activity)
                try {
                    map.addSource(TileflowGeoJSONSource("points", TileflowGeoJSONData.Empty))
                    map.addLayer(layer(test.getJSONObject("reference")))
                    val moving = layer(test.getJSONObject("layer"))
                    val position = test.getJSONObject("position").let {
                        if (it.has("aboveLayerId")) TileflowLayerPosition.Above(it.getString("aboveLayerId"))
                        else TileflowLayerPosition.Below(it.getString("belowLayerId"))
                    }
                    if (test.getString("operation") == "moveLayer") map.addLayer(moving)
                    val before = map.runtimeStyle.layers.toList()
                    val error = runCatching {
                        if (test.getString("operation") == "moveLayer") map.moveLayer(moving.id, position)
                        else map.addLayer(moving, position)
                    }.exceptionOrNull() as? TileflowMapException
                    assertEquals(test.getString("name"), "layerPositionConflict", error?.context?.reason)
                    assertEquals(test.getString("operation"), error?.context?.operation)
                    assertEquals(test.getJSONObject("error").getString("path"), error?.context?.path)
                    assertEquals(moving.id, error?.context?.layerId)
                    assertEquals("sameSlot", error?.context?.rule)
                    assertEquals(listOf("alignSlot", "referenceSameSlot"), error?.context?.corrections?.map { it.code })
                    assertEquals(before, map.runtimeStyle.layers)
                } finally { map.destroy() }
            }
            for (raw in 0 until fixture.getJSONArray("slotIndices").length()) {
                val test = fixture.getJSONArray("slotIndices").getJSONObject(raw)
                val map = TileflowMapView(activity)
                try {
                    map.addSource(TileflowGeoJSONSource("points", TileflowGeoJSONData.Empty))
                    val initial = test.getJSONArray("layers")
                    for (index in 0 until initial.length()) map.addLayer(layer(initial.getJSONObject(index)))
                    val moving = test.getJSONObject("layer")
                    val position = TileflowLayerPosition.AtSlotIndex(test.getJSONObject("position").getInt("slotIndex"))
                    val error = runCatching {
                        if (test.getString("operation") == "moveLayer") map.moveLayer(moving.getString("id"), position)
                        else map.addLayer(layer(moving), position)
                    }.exceptionOrNull()
                    if (test.has("error")) assertEquals("invalidLayerPosition", (error as? TileflowMapException)?.context?.reason)
                    else assertEquals(test.getString("name"), null, error)
                    val expected = test.getJSONArray("expectedOrder")
                    assertEquals((0 until expected.length()).map(expected::getString), map.runtimeStyle.layers.filter { it.slot == slot(moving) }.map { it.id })
                } finally { map.destroy() }
            }
            val map = TileflowMapView(activity)
            try {
                map.addSource(TileflowGeoJSONSource("points", TileflowGeoJSONData.Empty))
                map.addLayer(TileflowCircleLayer("a", "points").slot(TileflowLayerSlot.ABOVE_ROADS))
                map.moveLayer("a", TileflowLayerPosition.Default)
                assertEquals(TileflowLayerSlot.ABOVE_ROADS, map.runtimeStyle.layers.single().slot)
                map.moveLayer("a", TileflowLayerPosition.Default, null)
                assertEquals(null, map.runtimeStyle.layers.single().slot)
            } finally { map.destroy() }
        } finally { activity.finish() }
    }

    @Test
    fun indicesCountOnlyOtherApplicationLayersInTheSameSlot() = runBlocking {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val map = TileflowMapView(activity)
        try {
            map.addSource(TileflowGeoJSONSource("points", TileflowGeoJSONData.Empty))
            map.addLayer(TileflowCircleLayer("a", "points").slot(TileflowLayerSlot.ABOVE_ROADS))
            map.addLayer(TileflowCircleLayer("other", "points").slot(TileflowLayerSlot.ABOVE_LABELS))
            map.addLayer(TileflowCircleLayer("c", "points").slot(TileflowLayerSlot.ABOVE_ROADS))
            map.addLayer(TileflowCircleLayer("b", "points").slot(TileflowLayerSlot.ABOVE_ROADS), TileflowLayerPosition.AtSlotIndex(1))
            fun sameSlot() = map.runtimeStyle.layers.filter { it.slot == TileflowLayerSlot.ABOVE_ROADS }.map { it.id }
            assertEquals(listOf("a", "b", "c"), sameSlot())
            map.moveLayer("a", TileflowLayerPosition.AtSlotIndex(2))
            assertEquals(listOf("b", "c", "a"), sameSlot())
            map.moveLayer("a", TileflowLayerPosition.AtSlotIndex(0))
            assertEquals(listOf("a", "b", "c"), sameSlot())
            assertEquals(TileflowLayerSlot.ABOVE_LABELS, map.runtimeStyle.layers.single { it.id == "other" }.slot)
            val replayed = mutableListOf<JSONObject>()
            val renderer = object : MapEngine {
                override val view = android.view.View(activity)
                override val data = MapPayloadStore()
                override fun start() {}
                override fun setVisible(visible: Boolean) {}
                override fun retire(code: TileflowErrorCode) {}
                override suspend fun call(method: MapContract.Method, payload: Any, references: List<MapPayloadStore.Reference>): Any {
                    if (method == MapContract.Method.ADD_LAYER) replayed += payload as JSONObject
                    data.release(references)
                    return JSONObject.NULL
                }
            }
            map.replayStyle(renderer)
            assertEquals(listOf("a", "b", "c"), replayed.filter { it.optString("slot") == "above-roads" }.map { it.getJSONObject("layer").getString("id") })
            val previous = map.runtimeStyle.layers.toList()
            for (index in listOf(-1, 3)) {
                assertTrue(runCatching { map.moveLayer("a", TileflowLayerPosition.AtSlotIndex(index)) }.exceptionOrNull() is TileflowMapException)
                assertEquals(previous, map.runtimeStyle.layers)
            }
            map.moveLayer("a", TileflowLayerPosition.AtSlotIndex(0), TileflowLayerSlot.ABOVE_LABELS)
            assertEquals(listOf("a", "other"), map.runtimeStyle.layers.filter { it.slot == TileflowLayerSlot.ABOVE_LABELS }.map { it.id })
        } finally { map.destroy(); activity.finish() }
    }

    @Test
    fun featureReplacementAndRemovalAreOneAcceptedMutation() = runBlocking {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val map = TileflowMapView(activity)
        try {
            map.addSource(TileflowGeoJSONSource("points", TileflowGeoJSONData.Empty))
            map.updateGeoJSONSourceFeatures("points", listOf(TileflowFeature("1", null)), removeFeatureIds = listOf("2"))
            val log = map.runtimeStyle.sources.single().geoJSON!!
            assertEquals(1, log.updates.size)
            assertEquals(listOf("2"), log.updates.single().remove)
            assertEquals(1, JSONArray(String(log.updates.single().add!!)).length())
            val failure = runCatching {
                map.updateGeoJSONSourceFeatures("points", listOf(TileflowFeature("3", null)), removeFeatureIds = listOf(""))
            }.exceptionOrNull()
            assertTrue(failure is TileflowMapException)
            assertEquals(log, map.runtimeStyle.sources.single().geoJSON)
        } finally { map.destroy(); activity.finish() }
    }
}
