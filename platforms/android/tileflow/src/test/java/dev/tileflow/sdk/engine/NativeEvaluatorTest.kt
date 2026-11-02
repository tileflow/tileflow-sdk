package dev.tileflow.sdk.engine

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The native evaluators reproduce Core's golden fixtures: numbers within 1e-9, strings exactly. */
@RunWith(RobolectricTestRunner::class)
@Config(manifest = Config.NONE, sdk = [34])
class NativeEvaluatorTest {
    private val fixture =
        JSONObject(javaClass.classLoader!!.getResource("native-evaluators.json")!!.readText())

    private fun objects(key: String): List<JSONObject> = fixture.getJSONArray(key).objects()

    private fun ints(array: JSONArray?): List<Int>? =
        array?.let { list -> (0 until list.length()).map { list.getInt(it) } }

    @Test
    fun coloursMixInOkLab() {
        val cases = objects("colours")
        assertEquals(10, cases.size)
        for (item in cases) {
            val mixed =
                NativeEvaluators.mixColours(
                    item.getString("from"),
                    item.getString("to"),
                    item.getDouble("t"),
                )
            assertEquals("$item", if (item.isNull("mixed")) null else item.getString("mixed"), mixed)
        }
    }

    @Test
    fun leavesFillAtPositionsAndSelections() {
        val cases = objects("leaves")
        assertEquals(11, cases.size)
        for (item in cases) {
            val template = JSONObject().put(NativeEvaluators.LEAF_KEY, item.getJSONArray("values"))
            val filled =
                NativeEvaluators.fill(
                    template,
                    item.getDouble("position"),
                    ints(item.optJSONArray("select")),
                )
            assertMatches(item.get("filled"), filled, "$item")
        }
    }

    @Test
    fun blendLayersFillTheGroupAtASelectionAndPosition() {
        val groups = fixture.getJSONObject("family").getJSONObject("blend").getJSONArray("groups")
        val cases = objects("blends")
        assertEquals(4, cases.size)
        for (item in cases) {
            val group = groups.getJSONObject(item.getInt("group"))
            val selection = ints(item.getJSONArray("selection"))!!
            val position = item.getDouble("position")
            val layers = NativeEvaluators.blendLayers(group, selection, position)
            assertMatches(item.getJSONArray("layers"), JSONArray(layers), "blend $selection at $position")
            item.opt("light")?.let {
                assertMatches(
                    it,
                    NativeEvaluators.fill(group.get("light"), position, selection),
                    "light $selection at $position",
                )
            }
        }
    }

    @Test
    fun emphasisFillsEachTargetByStrengthAndKeepsAnArea() {
        val themes = fixture.getJSONObject("family").getJSONArray("themes")
        val cases = objects("emphasis")
        assertEquals(40, cases.size)
        for (item in cases) {
            val target =
                themes
                    .getJSONObject(item.getInt("theme"))
                    .getJSONObject("emphasis")
                    .getJSONArray("targets")
                    .getJSONObject(item.getInt("target"))
            val value = NativeEvaluators.emphasize(target, item.getDouble("t"), item.opt("keep"))
            assertMatches(item.get("value"), value, "$item")
        }
    }

    @Test
    fun themeSelectionFollowsDefaultSystemAndTimeOfDay() {
        val catalog = fixture.getJSONObject("catalog")
        fun strings(value: JSONObject?) =
            value?.let { item -> item.keys().asSequence().associateWith { item.getString(it) } }
        val themes = catalog.getJSONArray("themes")
        val evaluator =
            NativeEvaluators.ThemeCatalog(
                catalog.getString("defaultTheme"),
                strings(catalog.optJSONObject("systemThemes")),
                catalog.optJSONObject("timeOfDay")?.let { families ->
                    families.keys().asSequence().associateWith {
                        strings(families.getJSONObject(it))!!
                    }
                },
                (0 until themes.length()).map { themes.getString(it) }.toSet(),
            )
        val cases = objects("themeSelections")
        assertEquals(11, cases.size)
        for (item in cases) {
            val theme =
                try {
                    NativeEvaluators.theme(
                        evaluator,
                        item.optString("selection").ifEmpty { null },
                        item.optString("colorScheme").ifEmpty { null },
                        item.optString("timeOfDay").ifEmpty { null },
                    )
                } catch (_: NativeEvaluators.Failure) {
                    null
                }
            assertEquals("$item", if (item.isNull("theme")) null else item.getString("theme"), theme)
        }
    }

    @Test
    fun sunsAndRouteInksMixBetweenThemes() {
        val suns = objects("suns")
        assertEquals(3, suns.size)
        for (item in suns) {
            val mixed =
                NativeEvaluators.mixSuns(
                    item.getJSONObject("from"),
                    item.getJSONObject("to"),
                    item.getDouble("t"),
                )
            assertMatches(item.get("mixed"), mixed, "$item")
        }
        val inks = objects("routeInks")
        assertEquals(2, inks.size)
        for (item in inks) {
            val mixed =
                NativeEvaluators.mixRouteInks(
                    item.getJSONObject("from"),
                    item.getJSONObject("to"),
                    item.getDouble("t"),
                )
            assertMatches(item.get("mixed"), mixed, "$item")
        }
    }

    @Test
    fun threeDecimalsRoundAsTheWebDoes() {
        assertEquals("1", NativeEvaluators.threeDecimals(1.0))
        assertEquals("0.5", NativeEvaluators.threeDecimals(0.5))
        assertEquals("0.063", NativeEvaluators.threeDecimals(0.0625))
        assertEquals("0.188", NativeEvaluators.threeDecimals(0.1875))
        assertEquals("0", NativeEvaluators.threeDecimals(0.0004))
        assertEquals("0.507", NativeEvaluators.threeDecimals(0.50749999))
    }

    /** Numbers within 1e-9; everything else exactly. */
    private fun assertMatches(expected: Any?, actual: Any?, message: String, path: String = "$") {
        when {
            expected is Number && actual is Number ->
                assertEquals("$message at $path", expected.toDouble(), actual.toDouble(), 1e-9)
            expected is JSONArray && actual is JSONArray -> {
                assertEquals("$message at $path: length", expected.length(), actual.length())
                for (index in 0 until expected.length())
                    assertMatches(expected.get(index), actual.get(index), message, "$path[$index]")
            }
            expected is JSONObject && actual is JSONObject -> {
                assertEquals(
                    "$message at $path: keys",
                    expected.keys().asSequence().toSortedSet(),
                    actual.keys().asSequence().toSortedSet(),
                )
                for (key in expected.keys())
                    assertMatches(expected.get(key), actual.get(key), message, "$path.$key")
            }
            expected == JSONObject.NULL && (actual == null || actual == JSONObject.NULL) -> Unit
            expected == actual -> Unit
            else -> fail("$message at $path: expected $expected, got $actual")
        }
    }
}
