package dev.tileflow.sdk.engine

import org.json.JSONArray
import org.json.JSONObject

/**
 * A map's family document (`kind: tileflow-native-family`): every theme's route inks, sun and
 * emphasis table, and blend plans for the whole family, which the native evaluators fill.
 */
internal class NativeFamily private constructor(val document: JSONObject) {
    val themes: List<JSONObject> = document.getJSONArray("themes").objects()
    val groups: List<JSONObject> =
        document.optJSONObject("blend")?.optJSONArray("groups")?.objects().orEmpty()

    fun index(theme: String): Int? =
        themes.indexOfFirst { it.optString("name") == theme }.takeIf { it >= 0 }

    fun theme(name: String): JSONObject? = index(name)?.let { themes[it] }

    /**
     * The blend group that holds every named theme, and the selection: each theme's index in the
     * group's themes, in blend order. Null when the themes cannot blend.
     */
    fun blend(names: List<String>): Pair<Int, List<Int>>? {
        val indices = names.map { index(it) ?: return null }
        for ((number, group) in groups.withIndex()) {
            val members = group.optJSONArray("themes") ?: continue
            val list = (0 until members.length()).map { members.optInt(it) }
            val selection = indices.map { list.indexOf(it) }
            if (selection.none { it < 0 }) return number to selection
        }
        return null
    }

    /** The route inks of one theme, or of a blend at a position. */
    fun routeInks(names: List<String>, position: Double = 0.0): JSONObject? {
        val inks = names.map { theme(it)?.optJSONObject("routeInks") ?: return null }
        return NativeEvaluators.at(inks, position, NativeEvaluators::mixRouteInks)
    }

    companion object {
        fun parse(document: JSONObject): NativeFamily? =
            document
                .takeIf {
                    it.optString("kind") == "tileflow-native-family" &&
                        it.optInt("schemaVersion") == 1 &&
                        (it.optJSONArray("themes")?.length() ?: 0) > 0
                }
                ?.let(::NativeFamily)
    }
}

internal fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
