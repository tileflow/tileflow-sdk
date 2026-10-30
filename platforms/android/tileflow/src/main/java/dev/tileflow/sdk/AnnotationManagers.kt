package dev.tileflow.sdk

import android.graphics.Bitmap
import androidx.annotation.MainThread
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import org.json.JSONArray
import org.json.JSONObject

/**
 * The map's annotation managers, as `mapView.annotations`. Each manager draws its annotations in
 * one source and one layer of the application's runtime style, both named by the manager's
 * [TileflowAnnotationManager.id], so they keep their place across theme changes and a new renderer,
 * and other application layers can go above or below them.
 */
@MainThread
public class TileflowAnnotations internal constructor() {
    private val managers = LinkedHashMap<String, TileflowAnnotationManager<*, *>>()
    internal var view: TileflowMapView? = null
        private set

    /** The managers in the order they were created. */
    public val annotationManagers: List<TileflowAnnotationManager<*, *>>
        get() = managers.values.toList()

    public fun createPointAnnotationManager(
        config: TileflowAnnotationConfig = TileflowAnnotationConfig()
    ): TileflowPointAnnotationManager =
        add(TileflowPointAnnotationManager(identifier(config), config, this))

    public fun createCircleAnnotationManager(
        config: TileflowAnnotationConfig = TileflowAnnotationConfig()
    ): TileflowCircleAnnotationManager =
        add(TileflowCircleAnnotationManager(identifier(config), config, this))

    public fun createPolylineAnnotationManager(
        config: TileflowAnnotationConfig = TileflowAnnotationConfig()
    ): TileflowPolylineAnnotationManager =
        add(TileflowPolylineAnnotationManager(identifier(config), config, this))

    public fun createPolygonAnnotationManager(
        config: TileflowAnnotationConfig = TileflowAnnotationConfig()
    ): TileflowPolygonAnnotationManager =
        add(TileflowPolygonAnnotationManager(identifier(config), config, this))

    /** Removes a manager with its annotations, source and layer. */
    public fun removeAnnotationManager(manager: TileflowAnnotationManager<*, *>) {
        if (managers[manager.id] !== manager) return
        managers.remove(manager.id)
        manager.dispose()
        changed()
    }

    private fun identifier(config: TileflowAnnotationConfig): String {
        val id = config.id ?: UUID.randomUUID().toString()
        if (!MANAGER_ID.matches(id) || managers.containsKey(id) || view?.sourceExists(id) == true)
            invalidAnnotation()
        return id
    }

    private fun <M : TileflowAnnotationManager<*, *>> add(manager: M): M {
        if (managers.size >= ANNOTATION_LAYER_LIMIT) invalidAnnotation()
        managers[manager.id] = manager
        manager.bind(view)
        changed()
        return manager
    }

    internal fun bind(next: TileflowMapView?) {
        if (view === next) return
        view = next
        managers.values.forEach { it.bind(next) }
        next?.annotationsChanged()
    }

    internal fun changed() {
        view?.annotationsChanged()
    }

    internal val isEmpty: Boolean
        get() = managers.isEmpty()

    /** The layers the renderer reports hits and drags for. */
    internal val layerIds: List<String>
        get() = managers.keys.toList()

    /** Annotations that accessibility services read, by manager. */
    internal fun accessible(): List<Pair<TileflowAnnotationManager<*, *>, TileflowBaseAnnotation>> =
        managers.values.flatMap { manager ->
            manager.annotations.filter { !it.accessibilityLabel.isNullOrEmpty() }.map { manager to it }
        }

    /** Gives a tap or long press to the annotations it hit, topmost first; true when one took it. */
    internal fun dispatchPress(hits: List<Pair<String, String>>, long: Boolean): Boolean =
        hits.any { (layer, id) -> managers[layer]?.press(id, long) == true }

    internal fun dispatchDrag(result: JSONObject) {
        managers[result.optString("layer")]?.drag(result)
    }

    internal fun press(manager: TileflowAnnotationManager<*, *>, id: String, long: Boolean): Boolean =
        managers[manager.id] === manager && manager.press(id, long)

    private companion object {
        val MANAGER_ID = Regex("^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
        val ANNOTATION_LAYER_LIMIT = dev.tileflow.sdk.bridge.ProtocolContract.MAXIMUM_ANNOTATION_LAYERS
    }
}

/** A style property an annotation manager sets on its layer. */
internal class AnnotationProperty(val name: String, val layout: Boolean, val fallback: Any?)

/**
 * Draws a kind of annotation. Change annotations with [create], [update] and [delete]; the manager
 * sends what changed to the map once per main-thread turn, a feature at a time when few changed.
 *
 * @property id The identifier of the manager's source and layer in the application's runtime style.
 */
@MainThread
public abstract class TileflowAnnotationManager<T : TileflowBaseAnnotation, O>
internal constructor(
    public val id: String,
    private val config: TileflowAnnotationConfig,
    private val owner: TileflowAnnotations,
    private val layerType: String,
    private val properties: List<AnnotationProperty>,
) {
    private val items = LinkedHashMap<String, T>()
    private val clickListeners = mutableListOf<TileflowAnnotationClickListener<T>>()
    private val longClickListeners = mutableListOf<TileflowAnnotationLongClickListener<T>>()
    private val dragListeners = mutableListOf<TileflowAnnotationDragListener<T>>()
    private var view: TileflowMapView? = null
    private var disposed = false
    private var dirty = false
    private var job: Job? = null
    // What the bound view's runtime style holds for this manager.
    private var installed = false
    private var sentFeatures = mutableMapOf<String, String>()
    private var sentLayer: String? = null
    private val addedImages = mutableSetOf<String>()

    /** The manager's annotations in the order they were created. */
    public val annotations: List<T>
        get() = items.values.toList()

    public fun create(options: O): T = build(options, UUID.randomUUID().toString()).also {
        items[it.id] = it
        changed()
    }

    public fun create(options: List<O>): List<T> = options.map(::create)

    /** Sends an annotation's changed properties to the map. */
    public fun update(annotation: T) {
        if (!items.containsKey(annotation.id)) invalidAnnotation()
        items[annotation.id] = annotation
        changed()
    }

    public fun update(annotations: List<T>): Unit = annotations.forEach(::update)

    public fun delete(annotation: T) {
        if (items.remove(annotation.id) != null) changed()
    }

    public fun delete(annotations: List<T>): Unit = annotations.forEach(::delete)

    public fun deleteAll() {
        if (items.isEmpty()) return
        items.clear()
        changed()
    }

    public fun addClickListener(listener: TileflowAnnotationClickListener<T>): Boolean =
        clickListeners.add(listener)

    public fun removeClickListener(listener: TileflowAnnotationClickListener<T>): Boolean =
        clickListeners.remove(listener)

    // Accessibility services offer a long press only on annotations whose manager answers it.
    public fun addLongClickListener(listener: TileflowAnnotationLongClickListener<T>): Boolean =
        longClickListeners.add(listener).also { owner.changed() }

    public fun removeLongClickListener(listener: TileflowAnnotationLongClickListener<T>): Boolean =
        longClickListeners.remove(listener).also { owner.changed() }

    public fun addDragListener(listener: TileflowAnnotationDragListener<T>): Boolean =
        dragListeners.add(listener)

    public fun removeDragListener(listener: TileflowAnnotationDragListener<T>): Boolean =
        dragListeners.remove(listener)

    internal abstract fun build(options: O, id: String): T

    /** Layout values the manager sets for all its annotations, by MapLibre name. */
    internal open fun managerLayout(): Map<String, Any> = emptyMap()

    /** Images the manager adds to the map for its annotations, by name. */
    internal open fun images(): Map<String, Bitmap> = emptyMap()

    internal val hasLongClickListeners: Boolean
        get() = longClickListeners.isNotEmpty()

    /** Marks the manager changed; the map receives the change once the main thread is free. */
    internal fun changed() {
        if (disposed) return
        dirty = true
        owner.changed()
        schedule()
    }

    internal fun bind(next: TileflowMapView?) {
        val previous = view
        if (previous === next) return
        job?.cancel()
        job = null
        if (previous != null && installed) uninstall(previous)
        view = next
        installed = false
        sentFeatures = mutableMapOf()
        sentLayer = null
        addedImages.clear()
        dirty = true
        schedule()
    }

    internal fun dispose() {
        disposed = true
        val current = view
        job?.cancel()
        job = null
        if (current != null && installed) uninstall(current)
        view = null
    }

    private fun uninstall(target: TileflowMapView) {
        val images = addedImages.toList()
        if (target.isDestroyed) return
        target.launchOnView {
            try {
                if (target.layerExists(id)) target.removeLayer(id)
                if (target.sourceExists(id)) target.removeSource(id)
                images.forEach { target.removeImage(it) }
            } catch (error: TileflowMapException) {
                target.annotationWarning(error)
            }
        }
    }

    private fun schedule() {
        val target = view ?: return
        if (target.isDestroyed || job?.isActive == true) return
        job =
            target.launchJob {
                while (dirty && view === target && !disposed) {
                    dirty = false
                    try {
                        flush(target)
                    } catch (error: CancellationException) {
                        throw error
                    } catch (error: TileflowMapException) {
                        target.annotationWarning(error)
                    }
                }
            }
    }

    internal fun feature(annotation: T): TileflowFeature =
        TileflowFeature(
            null,
            annotation.geometry,
            mapOf(
                "id" to TileflowJSON.Text(annotation.id),
                "draggable" to TileflowJSON.Bool(annotation.isDraggable),
            ) + annotation.styleProperties().mapValues { (_, value) -> tileflowJSON(value) },
        )

    /** The layer's MapLibre JSON for the current annotations and manager values. */
    internal fun layerJson(): JSONObject {
        val used = items.values.flatMapTo(mutableSetOf()) { it.styleProperties().keys }
        val layout = JSONObject()
        val paint = JSONObject()
        for (property in properties) {
            if (property.name !in used) continue
            val get = JSONArray().put("get").put(property.name)
            val value =
                if (property.fallback == null) get
                else JSONArray().put("coalesce").put(get).put(fallbackJson(property.fallback))
            (if (property.layout) layout else paint).put(property.name, value)
        }
        managerLayout().forEach { (name, value) -> layout.put(name, styleConstantJson(value)) }
        return JSONObject().put("id", id).put("type", layerType).put("source", id).apply {
            if (layout.length() > 0) put("layout", layout)
            if (paint.length() > 0) put("paint", paint)
        }
    }

    private suspend fun flush(target: TileflowMapView) {
        val wanted = images()
        for ((name, bitmap) in wanted) {
            if (name in addedImages) continue
            target.addImage(TileflowMapImage.fromBitmap(name, bitmap))
            addedImages += name
        }
        val features = items.values.associate { it.id to feature(it) }
        val texts = features.mapValues { (_, feature) -> feature.json().toString() }
        val layer = layerJson()
        val layerText = layer.toString()
        if (!installed) {
            target.addSource(
                TileflowGeoJSONSource(
                    id,
                    TileflowGeoJSONData.Features(features.values.toList()),
                    promoteId = "id",
                )
            )
            try {
                target.addLayer(AnnotationLayer(id, layerType, layer, config.slot), config.position)
            } catch (error: TileflowMapException) {
                target.removeSource(id)
                throw error
            }
            installed = true
            sentFeatures = texts.toMutableMap()
            sentLayer = layerText
        } else {
            val changed = texts.filter { (key, text) -> sentFeatures[key] != text }.keys
            val removed = sentFeatures.keys - texts.keys
            if (changed.isNotEmpty() || removed.isNotEmpty()) {
                if ((changed.size + removed.size) * 2 < texts.size) {
                    if (removed.isNotEmpty())
                        target.removeGeoJSONSourceFeatures(id, removed.toList())
                    if (changed.isNotEmpty())
                        target.addGeoJSONSourceFeatures(id, changed.map { features.getValue(it) })
                } else {
                    target.setGeoJSONSourceData(
                        id,
                        TileflowGeoJSONData.Features(features.values.toList()),
                    )
                }
                sentFeatures = texts.toMutableMap()
            }
            if (layerText != sentLayer) {
                target.updateLayer(AnnotationLayer(id, layerType, layer, config.slot))
                sentLayer = layerText
            }
        }
        for (name in addedImages.toList()) {
            if (name in wanted) continue
            target.removeImage(name)
            addedImages -= name
        }
    }

    /** A tap or long press on an annotation; true when a listener took it. */
    internal fun press(annotationId: String, long: Boolean): Boolean {
        val annotation = items[annotationId] ?: return false
        return if (long) longClickListeners.toList().any { it.onAnnotationLongClick(annotation) }
        else clickListeners.toList().any { it.onAnnotationClick(annotation) }
    }

    internal fun drag(result: JSONObject) {
        val annotation = items[result.optString("id")] ?: return
        val geometry = TileflowGeometry.of(result.optJSONObject("geometry")) ?: return
        val moved =
            try {
                annotation.move(geometry)
            } catch (_: TileflowMapException) {
                false
            }
        if (!moved) return
        // The renderer holds the dragged geometry already; it is recorded once the drag ends.
        when (result.optString("phase")) {
            "started" -> dragListeners.toList().forEach { it.onAnnotationDragStarted(annotation) }
            "moved" -> dragListeners.toList().forEach { it.onAnnotationDrag(annotation) }
            "ended" -> {
                changed()
                dragListeners.toList().forEach { it.onAnnotationDragFinished(annotation) }
            }
        }
        owner.view?.annotationMoved()
    }
}

/** Draws [TileflowPointAnnotation]s as a MapLibre symbol layer. */
public class TileflowPointAnnotationManager
internal constructor(id: String, config: TileflowAnnotationConfig, owner: TileflowAnnotations) :
    TileflowAnnotationManager<TileflowPointAnnotation, TileflowPointAnnotationOptions>(
        id,
        config,
        owner,
        "symbol",
        listOf(
            AnnotationProperty("icon-image", true, null),
            AnnotationProperty("icon-anchor", true, "center"),
            AnnotationProperty("icon-offset", true, listOf(0.0, 0.0)),
            AnnotationProperty("icon-rotate", true, 0.0),
            AnnotationProperty("icon-size", true, 1.0),
            AnnotationProperty("symbol-sort-key", true, 0.0),
            AnnotationProperty("icon-color", false, TileflowColor(0, 0, 0)),
            AnnotationProperty("icon-opacity", false, 1.0),
        ),
    ) {
    /** Whether an annotation shows where it collides with other symbols. */
    public var iconAllowOverlap: Boolean? = null
        set(value) {
            field = value
            changed()
        }

    /** Whether other symbols show where they collide with an annotation. */
    public var iconIgnorePlacement: Boolean? = null
        set(value) {
            field = value
            changed()
        }

    override fun build(options: TileflowPointAnnotationOptions, id: String): TileflowPointAnnotation =
        options.build(id)

    override fun managerLayout(): Map<String, Any> =
        listOfNotNull(
                iconAllowOverlap?.let { "icon-allow-overlap" to it },
                iconIgnorePlacement?.let { "icon-ignore-placement" to it },
            )
            .toMap()

    override fun images(): Map<String, Bitmap> =
        annotations
            .mapNotNull { annotation ->
                val bitmap = annotation.iconImageBitmap ?: return@mapNotNull null
                bitmapImageName(bitmap).takeIf { it == annotation.iconImage }?.let { it to bitmap }
            }
            .toMap()
}

/** Draws [TileflowCircleAnnotation]s as a MapLibre circle layer. */
public class TileflowCircleAnnotationManager
internal constructor(id: String, config: TileflowAnnotationConfig, owner: TileflowAnnotations) :
    TileflowAnnotationManager<TileflowCircleAnnotation, TileflowCircleAnnotationOptions>(
        id,
        config,
        owner,
        "circle",
        listOf(
            AnnotationProperty("circle-sort-key", true, 0.0),
            AnnotationProperty("circle-radius", false, 5.0),
            AnnotationProperty("circle-color", false, TileflowColor(0, 0, 0)),
            AnnotationProperty("circle-opacity", false, 1.0),
            AnnotationProperty("circle-stroke-color", false, TileflowColor(0, 0, 0)),
            AnnotationProperty("circle-stroke-width", false, 0.0),
            AnnotationProperty("circle-stroke-opacity", false, 1.0),
            AnnotationProperty("circle-blur", false, 0.0),
        ),
    ) {
    override fun build(
        options: TileflowCircleAnnotationOptions,
        id: String,
    ): TileflowCircleAnnotation = options.build(id)
}

/** Draws [TileflowPolylineAnnotation]s as a MapLibre line layer with round joins. */
public class TileflowPolylineAnnotationManager
internal constructor(id: String, config: TileflowAnnotationConfig, owner: TileflowAnnotations) :
    TileflowAnnotationManager<TileflowPolylineAnnotation, TileflowPolylineAnnotationOptions>(
        id,
        config,
        owner,
        "line",
        listOf(
            AnnotationProperty("line-sort-key", true, 0.0),
            AnnotationProperty("line-color", false, TileflowColor(0, 0, 0)),
            AnnotationProperty("line-width", false, 1.0),
            AnnotationProperty("line-opacity", false, 1.0),
            AnnotationProperty("line-blur", false, 0.0),
        ),
    ) {
    /** How every line of the manager ends. */
    public var lineCap: TileflowLineCap? = null
        set(value) {
            field = value
            changed()
        }

    override fun build(
        options: TileflowPolylineAnnotationOptions,
        id: String,
    ): TileflowPolylineAnnotation = options.build(id)

    override fun managerLayout(): Map<String, Any> =
        listOfNotNull("line-join" to "round", lineCap?.let { "line-cap" to it }).toMap()
}

/** Draws [TileflowPolygonAnnotation]s as a MapLibre fill layer. */
public class TileflowPolygonAnnotationManager
internal constructor(id: String, config: TileflowAnnotationConfig, owner: TileflowAnnotations) :
    TileflowAnnotationManager<TileflowPolygonAnnotation, TileflowPolygonAnnotationOptions>(
        id,
        config,
        owner,
        "fill",
        listOf(
            AnnotationProperty("fill-sort-key", true, 0.0),
            AnnotationProperty("fill-color", false, TileflowColor(0, 0, 0)),
            AnnotationProperty("fill-opacity", false, 1.0),
            // Without its own outline colour, a polygon's outline takes its fill colour.
            AnnotationProperty("fill-outline-color", false, FillColorFallback),
        ),
    ) {
    override fun build(
        options: TileflowPolygonAnnotationOptions,
        id: String,
    ): TileflowPolygonAnnotation = options.build(id)
}

/** The fallback of a polygon's outline colour: its fill colour, or black. */
internal object FillColorFallback

private fun fallbackJson(value: Any): Any =
    when (value) {
        FillColorFallback ->
            JSONArray()
                .put("coalesce")
                .put(JSONArray().put("get").put("fill-color"))
                .put(TileflowColor(0, 0, 0).css)
        is List<*> -> JSONArray().put("literal").put(styleConstantJson(value))
        else -> styleConstantJson(value)
    }

/** A style value as a GeoJSON property. */
internal fun tileflowJSON(value: Any): TileflowJSON =
    when (value) {
        is Boolean -> TileflowJSON.Bool(value)
        is Number -> TileflowJSON.Number(value.toDouble())
        is String -> TileflowJSON.Text(value)
        is TileflowStyleEnum -> TileflowJSON.Text(value.value)
        is TileflowColor -> TileflowJSON.Text(value.css)
        is List<*> -> TileflowJSON.Array(value.map { tileflowJSON(it ?: invalidAnnotation()) })
        else -> invalidAnnotation()
    }

/** An annotation manager's layer, written as MapLibre JSON. */
internal class AnnotationLayer(
    id: String,
    type: String,
    private val value: JSONObject,
    slot: TileflowLayerSlot?,
) : TileflowLayer(id, type) {
    init {
        this.slot = slot
    }

    override fun json(): JSONObject = JSONObject(value.toString())
}
