package dev.tileflow.sdk

import dev.tileflow.sdk.engine.MapEngine
import dev.tileflow.sdk.location.TileflowLocationOptions
import kotlinx.coroutines.Job
import org.json.JSONException
import org.json.JSONObject

/** Content managed by a Compose map. Source, layer and annotation ids have separate namespaces. */
public class TileflowMapContentBuilder internal constructor() {
    internal val sources = mutableListOf<TileflowSource>()
    internal val layers = mutableListOf<TileflowLayer>()
    internal val annotations = mutableListOf<TileflowAnnotation>()
    internal val locations = mutableListOf<TileflowLocationOptions>()

    public fun source(value: TileflowSource) {
        sources += value
    }

    /** Layers are drawn in declaration order within each slot. */
    public fun layer(value: TileflowLayer) {
        layers += value
    }

    public fun annotation(value: TileflowAnnotation) {
        annotations += value
    }

    /** Overrides the map's location options until this declaration is removed. */
    public fun location(value: TileflowLocationOptions) {
        locations += value
    }
}

private fun invalidContent(): Nothing =
    throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

internal class DeclaredMapContent(
    builder: TileflowMapContentBuilder = TileflowMapContentBuilder(),
    previous: DeclaredMapContent? = null,
) {
    val sources = linkedMapOf<String, RuntimeStyle.Source>()
    private val inlineData = mutableMapOf<String, TileflowGeoJSONData.GeoJSON>()
    val layers = linkedMapOf<String, RuntimeStyle.Layer>()
    val markers = builder.annotations.toList()
    val location = builder.locations.singleOrNull()
    val empty
        get() = sources.isEmpty() && layers.isEmpty() && markers.isEmpty() && location == null

    init {
        if (builder.locations.size > 1 || markers.map { it.id }.toSet().size != markers.size)
            invalidContent()
        location?.json()
        markers.forEach { it.json() }
        for (source in builder.sources) {
            if (!STYLE_ID.matches(source.id) || sources.containsKey(source.id)) invalidContent()
            // Raw GeoJSON owns an immutable byte buffer. Feature lists and expression maps can
            // change between compositions even when the application reuses their Kotlin object.
            val raw = (source as? TileflowGeoJSONSource)?.data as? TileflowGeoJSONData.GeoJSON
            val base =
                if (raw != null && previous?.inlineData?.get(source.id) === raw)
                    previous.sources.getValue(source.id).geoJSON?.base
                else null
            val (spec, log) = sourceWire(source, base)
            sources[source.id] = RuntimeStyle.Source(source.id, JSONObject(spec.toString()), log)
            if (raw != null) inlineData[source.id] = raw
        }
        for (layer in builder.layers) {
            if (!STYLE_ID.matches(layer.id) || layers.containsKey(layer.id)) invalidContent()
            layers[layer.id] =
                RuntimeStyle.Layer(layer.id, JSONObject(layer.json().toString()), layer.slot)
        }
    }

    fun matches(other: DeclaredMapContent): Boolean =
        layers.keys.toList() == other.layers.keys.toList() &&
            markers == other.markers &&
            location == other.location &&
            sources.keys == other.sources.keys &&
            sources.all { (key, source) ->
                val previous = other.sources.getValue(key)
                source.spec.toString() == previous.spec.toString() &&
                    sameBase(source.geoJSON?.base, previous.geoJSON?.base)
            } &&
            layers.all { (key, layer) ->
                val previous = other.layers.getValue(key)
                layer.slot == previous.slot && layer.json.toString() == previous.json.toString()
            }
}

internal fun sameBase(left: GeoJSONLog.Base?, right: GeoJSONLog.Base?): Boolean =
    if (left is GeoJSONLog.Base.Bytes && right is GeoJSONLog.Base.Bytes) left.digest == right.digest
    else left == right

/**
 * Recomposition keeps only the latest pending declaration. A refused revision never becomes the
 * diff's base.
 */
internal class MapContentCoordinator(private val view: TileflowMapView) {
    private data class Input(
        val builder: TileflowMapContentBuilder,
        val options: TileflowMapOptions,
    )

    private data class Owners(
        val sources: Set<String>,
        val layers: Set<String>,
        val markers: Set<String>,
    )

    private data class Rejection(
        val declaration: DeclaredMapContent?,
        val ids: List<List<String>>,
        val options: TileflowMapOptions,
        val owners: Owners,
        val renderer: MapEngine?,
    ) {
        fun matches(other: Rejection): Boolean =
            ids == other.ids &&
                options == other.options &&
                owners == other.owners &&
                renderer === other.renderer &&
                if (declaration == null) other.declaration == null
                else other.declaration?.let(declaration::matches) == true
    }

    private var applied = DeclaredMapContent()
    private var baseOptions: TileflowMapOptions? = null
    private var pending: Input? = null
    private var rejected: Rejection? = null
    private var refusedInput: Input? = null
    private var job: Job? = null

    fun submit(builder: TileflowMapContentBuilder, options: TileflowMapOptions) {
        pending = Input(builder, options)
        drain()
    }

    suspend fun rendererReady() {
        if (pending == null && rejected != null && rejected?.renderer !== view.styleEngine)
            pending = refusedInput
        drain()
        job?.join()
    }

    fun ownersChanged() {
        val last = rejected ?: return
        val input = refusedInput ?: return
        if (job?.isActive == true || pending != null || last.owners == owners()) return
        pending = input
        drain()
    }

    private fun owners() =
        Owners(
            view.runtimeStyle.sources.map { it.id }.toSet(),
            view.runtimeStyle.layers.map { it.id }.toSet(),
            view.content.annotations.map { it.id }.toSet(),
        )

    private fun rejection(input: Input, declaration: DeclaredMapContent?): Rejection {
        val ids =
            listOf(
                input.builder.sources.map { it.id },
                input.builder.layers.map { it.id },
                input.builder.annotations.map { it.id },
            )
        return Rejection(declaration, ids, input.options, owners(), view.styleEngine)
    }

    private fun drain() {
        if (job?.isActive == true || pending == null || view.isDestroyed) return
        job =
            view.launchJob {
                while (!view.isDestroyed) {
                    val input = pending ?: break
                    pending = null
                    val engine = view.styleEngine
                    var next: DeclaredMapContent? = null
                    try {
                        next =
                            try {
                                DeclaredMapContent(input.builder, applied)
                            } catch (_: JSONException) {
                                invalidContent()
                            } catch (_: IllegalArgumentException) {
                                invalidContent()
                            }
                        if ((!next.empty || !applied.empty) && engine == null) {
                            pending = input
                            break
                        }
                        if (rejected?.matches(rejection(input, next)) == true) continue
                        val options =
                            when {
                                baseOptions != input.options ->
                                    input.options.copy(
                                        location = next.location ?: input.options.location
                                    )
                                applied.location != next.location ->
                                    view.options.copy(
                                        location = next.location ?: input.options.location
                                    )
                                else -> null
                            }
                        if (options != null || !applied.matches(next))
                            view.applyDeclaredContent(applied, next, options)
                        applied = next
                        baseOptions = input.options
                        rejected = null
                        refusedInput = null
                    } catch (error: TileflowMapException) {
                        if (view.isDestroyed || error.code == TileflowErrorCode.DISPOSED)
                            return@launchJob
                        if (error.code == TileflowErrorCode.CANCELLED) {
                            if (pending == null) pending = input
                            if (engine === view.styleEngine || view.styleEngine == null) break
                            continue
                        }
                        val refusal = rejection(input, next)
                        if (rejected?.matches(refusal) != true)
                            view.onEvent(TileflowMapEvent.Failed(error.code, error.context))
                        rejected = refusal
                        refusedInput = input
                    }
                }
            }
    }
}
