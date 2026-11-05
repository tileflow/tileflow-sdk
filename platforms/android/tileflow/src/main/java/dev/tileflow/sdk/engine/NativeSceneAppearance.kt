package dev.tileflow.sdk.engine

import com.google.gson.JsonNull
import com.google.gson.JsonObject
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.model.MapPayloadStore
import kotlin.math.round
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.maplibre.android.maps.Style
import org.maplibre.android.style.light.Position
import org.maplibre.android.style.sources.VectorSource

/** Application overrides retained separately from each themed style document. */
internal class NativeSceneAppearance(
    private val style: () -> Style?,
    private val center: () -> TileflowCoordinate,
    private val preset: () -> JSONObject?,
    private val clock: NativeSceneClock,
) {
    private var document = JSONObject()
    private var sun: NativeSceneMath.Direction? = null
    private val state = linkedMapOf<String, Any>()
    private var boundaries: Boundaries? = null
    private var boundaryRevision = 0
    private var boundariesPending = false

    private data class Removed(val layer: String, val id: String, val key: String)

    private val removals = mutableSetOf<Removed>()

    private data class Boundaries(
        val key: String,
        val layers: List<String>,
        val rows: Map<String, Any>,
    )

    private fun themeSun(): NativeSceneMath.Direction {
        val chosen = preset() ?: document.optJSONObject("metadata")?.optJSONObject("tileflow:sun")
        if (chosen != null && chosen.has("azimuth")) {
            return NativeSceneMath.Direction(
                chosen.getDouble("azimuth"),
                chosen.getDouble("altitude"),
            )
        }
        val light = document.optJSONObject("light")?.optJSONArray("position")
        return NativeSceneMath.Direction(
            light?.optDouble(1, 210.0) ?: 210.0,
            90 - (light?.optDouble(2, 30.0) ?: 30.0),
        )
    }

    suspend fun setSun(request: JSONObject): Boolean {
        val value = request.optJSONObject("sun")
        val next =
            value?.let {
                if (it.has("date")) {
                    val coordinate =
                        it.optJSONObject("location")?.let { point ->
                            TileflowCoordinate(
                                point.getDouble("longitude"),
                                point.getDouble("latitude"),
                            )
                        } ?: center()
                    NativeSceneMath.sunPosition(
                        it.getDouble("date"),
                        coordinate.longitude,
                        coordinate.latitude,
                    )
                } else NativeSceneMath.Direction(it.getDouble("azimuth"), it.getDouble("altitude"))
            }
        val from = sun ?: themeSun()
        val to = next ?: themeSun()
        return clock.animate("sun", request.optLong("duration", 0)) { t ->
            sun =
                if (t >= 1) next
                else {
                    val direction =
                        NativeEvaluators.mixSunDirections(
                            from.azimuth,
                            from.altitude,
                            to.azimuth,
                            to.altitude,
                            NativeSceneMath.smooth(t),
                        )
                    NativeSceneMath.Direction(direction.first, direction.second)
                }
            writeSun()
        }
    }

    fun writeSun() {
        val light = style()?.light ?: return
        val base = document.optJSONObject("light")
        if (
            sun == null &&
                preset() == null &&
                document.optJSONObject("metadata")?.has("tileflow:sun") != true &&
                base == null
        )
            return
        val position = sun ?: themeSun()
        val radial = base?.optJSONArray("position")?.optDouble(0, 1.15) ?: 1.15
        fun places(value: Double) = (round(value * 1000) / 1000).toFloat()
        light.anchor = "map"
        light.position =
            Position.fromPosition(
                radial.toFloat(),
                places(NativeEvaluators.normalizedAzimuth(position.azimuth)),
                places((90 - position.altitude).coerceIn(0.0, 90.0)),
            )
    }

    suspend fun setState(request: JSONObject): Boolean {
        val key = request.getString("name")
        val to = request.get("value")
        val from = state[key] as? Number
        val duration = if (from != null && to is Number) request.optLong("duration", 0) else 0
        return clock.animate("state:$key", duration) { t ->
            val value =
                if (t < 1 && from != null && to is Number)
                    NativeSceneMath.mix(from.toDouble(), to.toDouble(), NativeSceneMath.smooth(t))
                else to
            if (value === JSONObject.NULL) state.remove(key) else state[key] = value
            writeState(key, value)
        }
    }

    private fun jsonPrimitive(value: Any): com.google.gson.JsonElement =
        when (value) {
            is Number -> com.google.gson.JsonPrimitive(value)
            is Boolean -> com.google.gson.JsonPrimitive(value)
            is String -> com.google.gson.JsonPrimitive(value)
            else -> JsonNull.INSTANCE
        }

    private fun writeState(key: String, value: Any) {
        val effective =
            if (value === JSONObject.NULL)
                document.optJSONObject("state")?.optJSONObject(key)?.opt("default")
                    ?: JSONObject.NULL
            else value
        style()
            ?.setGlobalStateProperty(
                key,
                if (effective === JSONObject.NULL) JsonNull.INSTANCE else jsonPrimitive(effective),
            )
    }

    suspend fun setBoundaries(request: JSONObject, channel: MapPayloadStore) {
        val revision = ++boundaryRevision
        val values = request.optJSONObject("values")
        val next =
            values?.let {
                if (it.optString("joinBy") != "id")
                    styleInvalid(
                        "Join native Boundaries rows to intrinsic feature ids before setting state."
                    )
                val data =
                    channel.payload(it.getJSONObject("rows").getString("id"))?.bytes
                        ?: styleInvalid("Missing rows")
                val entries =
                    withContext(Dispatchers.Default) {
                        val rows = linkedMapOf<String, Any>()
                        for (value in JSONArray(data.toString(Charsets.UTF_8)).items()) {
                            val row = value as? JSONArray ?: styleInvalid("Invalid Boundaries row")
                            val id = row.opt(0) as? Number ?: styleInvalid("Invalid Boundaries id")
                            if (
                                row.length() != 2 ||
                                    id.toLong().toDouble() != id.toDouble() ||
                                    id.toLong() < 0
                            )
                                styleInvalid("Invalid Boundaries id")
                            val v = row.opt(1)
                            if (v is Number || v is String) rows[id.toLong().toString()] = v
                            else if (v !== JSONObject.NULL) styleInvalid("Invalid Boundaries value")
                        }
                        rows
                    }
                Boundaries(
                    request.optString("state", "value"),
                    if (request.optBoolean("labels")) listOf("boundary_area", "boundary_label")
                    else listOf("boundary_area"),
                    entries,
                )
            }
        if (revision != boundaryRevision) return
        val prior = boundaries
        val native = style()?.getSourceAs<VectorSource>("tileflow-boundaries")
        if (native != null && prior != null) {
            for (layer in prior.layers) for (id in prior.rows.keys) {
                if (
                    next == null ||
                        prior.key != next.key ||
                        layer !in next.layers ||
                        id !in next.rows
                )
                    removals += Removed(layer, id, prior.key)
            }
        }
        boundaries = next
        if (next != null)
            for (layer in next.layers) for (id in next.rows.keys) removals.remove(
                Removed(layer, id, next.key)
            )
        if (native != null) eraseRows(native)
        boundariesPending = next != null
        if (native != null && next != null)
            for (layer in next.layers) for ((id, value) in next.rows) {
                if (prior?.key != next.key || layer !in prior.layers || prior.rows[id] != value)
                    writeRow(native, next, layer, id, value)
            }
    }

    /**
     * A keyed removal in MapLibre can wait for outstanding edits of the same source layer. Remove
     * an entire feature only when we own its sole key, and confirm other removals after drawing.
     */
    private fun eraseRows(native: VectorSource) {
        val iterator = removals.iterator()
        while (iterator.hasNext()) {
            val row = iterator.next()
            val state = native.getFeatureState(row.layer, row.id)
            when {
                state == null || !state.has(row.key) -> iterator.remove()
                state.size() == 1 -> native.removeFeatureState(row.layer, row.id)
                else -> native.removeFeatureState(row.layer, row.id, row.key)
            }
        }
    }

    private fun writeRow(
        source: VectorSource,
        values: Boundaries,
        layer: String,
        id: String,
        value: Any,
    ) {
        val state = JsonObject()
        if (value is Number) state.addProperty(values.key, value)
        else state.addProperty(values.key, value as String)
        source.setFeatureState(layer, id, state)
    }

    fun confirmBoundaries() {
        if (!boundariesPending && removals.isEmpty()) return
        val native = style()?.getSourceAs<VectorSource>("tileflow-boundaries") ?: return
        eraseRows(native)
        val values = boundaries ?: return
        boundariesPending = false
        for (layer in values.layers) for ((id, value) in values.rows) {
            val actual = native.getFeatureState(layer, id)?.get(values.key)
            if (actual != jsonPrimitive(value)) {
                boundariesPending = true
                writeRow(native, values, layer, id, value)
            }
        }
    }

    fun restore(document: JSONObject) {
        this.document = document
        writeSun()
        state.forEach(::writeState)
        boundaries?.let { values ->
            boundariesPending = true
            val source = style()?.getSourceAs<VectorSource>("tileflow-boundaries") ?: return@let
            for (layer in values.layers) for ((id, value) in values.rows) writeRow(
                source,
                values,
                layer,
                id,
                value,
            )
        }
    }
}
