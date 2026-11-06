package dev.tileflow.sdk.engine

import dev.tileflow.sdk.transport.ResourceDigest
import dev.tileflow.sdk.transport.ResourceLoader
import java.net.URI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
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

    /** Check a legacy plan's physical layers before handing them to MapLibre. */
    fun matches(manifest: NativeMapManifest, theme: String, style: JSONObject): Boolean {
        val names = themes.map { it.optString("name") }
        val index = index(theme) ?: return false
        if (document.optString("map") != manifest.map || names.size != manifest.styles.size ||
            names.toSet() != manifest.styles.keys) return false

        val byId = style.optJSONArray("layers")?.objects()?.associateBy { it.optString("id") }
            ?: return false
        for (group in groups) {
            val members = group.optJSONArray("themes") ?: return false
            val indices = (0 until members.length()).map { members.optInt(it, -1) }
            if (indices.any { it !in themes.indices }) return false
            if (index !in indices) continue

            val planned = group.optJSONArray("layers")?.objects()?.takeIf { it.isNotEmpty() }
                ?: return false
            val originals = mutableSetOf<String>()
            for (layer in planned) {
                val id = layer.optString("id")
                val original = if (id in byId) id else id.replace(copySuffix, "")
                val base = byId[original] ?: return false
                if (listOf("type", "source", "source-layer").any {
                    layer.optString(it) != base.optString(it)
                }) return false
                originals += original
            }
            if (originals != byId.keys) return false
        }
        return true
    }

    companion object {
        private val copySuffix = Regex("::(?:branch|theme)-[0-9]+$")
        /** Reads the family of the selected style, including the Hosted SHA-256 binding. */
        suspend fun load(
            manifest: NativeMapManifest,
            style: String,
            loader: ResourceLoader,
            currentStyle: JSONObject? = null,
            theme: String? = null,
            mismatch: (String) -> Unit = {},
        ): NativeFamily? {
            val url = manifest.familyUrl(style) ?: return null
            val bytes =
                withContext(Dispatchers.IO) {
                    runCatching { loader.load(URI(url)) }
                        .getOrNull()
                        ?.takeIf { it.status == 200 }
                        ?.bytes
                } ?: return null
            val bound = currentStyle?.optJSONObject("metadata")?.optString("tileflow:nativeFamilySha256")
            val revisions = listOfNotNull(manifest.family?.second, bound?.takeIf { it.isNotEmpty() })
            if (revisions.isNotEmpty()) {
                val digest = ResourceDigest.sha256(bytes)
                if (revisions.any { it != digest }) {
                    mismatch(url)
                    return null
                }
            }
            val family = runCatching { parse(JSONObject(String(bytes, Charsets.UTF_8))) }.getOrNull()
                ?: return null
            if (theme != null && currentStyle != null && !family.matches(manifest, theme, currentStyle)) {
                mismatch(url)
                return null
            }
            return family
        }

        fun defaultRouteInks(scheme: String): JSONObject {
            val dark = scheme == "dark"
            return JSONObject()
                .put("line", if (dark) "#60a5fa" else "#2563eb")
                .put("casing", if (dark) "#0b1220" else "#1e3a8a")
                .put("core", "#eff6ff")
                .put("glow", if (dark) "#60a5fa" else "#2563eb")
                .put("alternative", "#64748b")
                .put("glowOpacity", if (dark) 0.4 else 0.16)
                .put("coreOpacity", if (dark) 0.7 else 0.0)
        }

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

internal fun JSONArray.objects(): List<JSONObject> =
    (0 until length()).mapNotNull { optJSONObject(it) }
