package dev.tileflow.sdk

import android.view.View
import androidx.annotation.MainThread

/** Which point of a view annotation lies on its coordinate. */
public enum class TileflowViewAnnotationAnchor {
    CENTER,
    TOP,
    BOTTOM,
    LEFT,
    RIGHT,
    TOP_LEFT,
    TOP_RIGHT,
    BOTTOM_LEFT,
    BOTTOM_RIGHT,
}

/**
 * An anchor to try for a view annotation, with an offset from it: [offsetX] positive moves the view
 * right and [offsetY] positive moves it up. Offsets are in pixels for [TileflowMapView] and in dp
 * through [TileflowMapController].
 */
public data class TileflowViewAnnotationAnchorConfig(
    val anchor: TileflowViewAnnotationAnchor,
    val offsetX: Double = 0.0,
    val offsetY: Double = 0.0,
)

/**
 * Where and how a view annotation shows.
 *
 * @property variableAnchors Anchors to try in order; the first where the view does not collide
 *   with a view annotation placed before it wins.
 * @property allowOverlap Shows the view even where it collides with other view annotations.
 * @property priority Higher priorities are placed first; [selected] ones before all others.
 * @property visible Hides the view without removing it.
 * @property width The view's width, or null for its measured width; in pixels for
 *   [TileflowMapView] and dp through [TileflowMapController], as is [height].
 */
public data class TileflowViewAnnotationOptions(
    val coordinate: TileflowCoordinate,
    val variableAnchors: List<TileflowViewAnnotationAnchorConfig> =
        listOf(TileflowViewAnnotationAnchorConfig(TileflowViewAnnotationAnchor.CENTER)),
    val allowOverlap: Boolean = false,
    val priority: Int = 0,
    val visible: Boolean = true,
    val selected: Boolean = false,
    val width: Float? = null,
    val height: Float? = null,
) {
    internal fun validate() {
        validCoordinate(coordinate)
        if (
            variableAnchors.isEmpty() ||
                variableAnchors.any { !it.offsetX.isFinite() || !it.offsetY.isFinite() } ||
                (width != null && !(width.isFinite() && width >= 0)) ||
                (height != null && !(height.isFinite() && height >= 0))
        )
            invalidAnnotation()
    }
}

/**
 * Follows view annotations as the map places them. Positions are in pixels for [TileflowMapView]
 * and dp through [TileflowMapController], relative to the map.
 */
public interface TileflowViewAnnotationUpdatedListener {
    public fun onViewAnnotationPositionUpdated(
        view: View,
        left: Float,
        top: Float,
        width: Float,
        height: Float,
    ) {}

    public fun onViewAnnotationVisibilityUpdated(view: View, visible: Boolean) {}

    public fun onViewAnnotationAnchorUpdated(view: View, anchor: TileflowViewAnnotationAnchorConfig) {}
}

/**
 * Native views anchored to coordinates, as `mapView.viewAnnotationManager`. The renderer reports
 * where each coordinate is after every frame that moves it, and the map moves the views at the
 * next display frame, hiding them where the globe or terrain covers their coordinate. Use a view
 * annotation to present a callout or popup next to an annotation.
 */
@MainThread
public class TileflowViewAnnotationManager internal constructor(internal val unitsInDp: Boolean) {
    internal class Entry(val view: View, var options: TileflowViewAnnotationOptions, val order: Long) {
        var shown = false
        var anchor: TileflowViewAnnotationAnchorConfig? = null
        var frame: FloatArray? = null
    }

    internal val entries = LinkedHashMap<View, Entry>()
    internal val listeners = mutableListOf<TileflowViewAnnotationUpdatedListener>()
    private var order = 0L
    internal var overlay: AnnotationOverlay? = null
        private set

    /** The views and their options, in the order they were added. */
    public val annotations: Map<View, TileflowViewAnnotationOptions>
        get() = entries.mapValues { it.value.options }

    /** Adds a view that has no parent, anchored as [options] says. */
    public fun addViewAnnotation(view: View, options: TileflowViewAnnotationOptions) {
        options.validate()
        if (entries.containsKey(view) || view.parent != null) invalidAnnotation()
        entries[view] = Entry(view, options, order++)
        overlay?.attach(view, options, this)
        overlay?.annotationsChanged()
    }

    /** Replaces a view's options; false when the view is not a view annotation. */
    public fun updateViewAnnotation(view: View, options: TileflowViewAnnotationOptions): Boolean {
        options.validate()
        val entry = entries[view] ?: return false
        entry.options = options
        overlay?.resize(view, options, this)
        overlay?.annotationsChanged()
        return true
    }

    public fun removeViewAnnotation(view: View): Boolean {
        entries.remove(view) ?: return false
        overlay?.detach(view)
        overlay?.annotationsChanged()
        return true
    }

    public fun removeAllViewAnnotations() {
        entries.keys.toList().forEach(::removeViewAnnotation)
    }

    public fun getViewAnnotationOptions(view: View): TileflowViewAnnotationOptions? =
        entries[view]?.options

    public fun addOnViewAnnotationUpdatedListener(listener: TileflowViewAnnotationUpdatedListener) {
        listeners += listener
    }

    public fun removeOnViewAnnotationUpdatedListener(
        listener: TileflowViewAnnotationUpdatedListener
    ) {
        listeners -= listener
    }

    internal fun bind(next: AnnotationOverlay?) {
        if (overlay === next) return
        overlay?.let { previous ->
            entries.keys.forEach(previous::detach)
            previous.annotationsChanged()
        }
        overlay = next
        entries.values.forEach {
            it.shown = false
            it.anchor = null
            it.frame = null
            next?.attach(it.view, it.options, this)
        }
        next?.annotationsChanged()
    }
}

/** A view annotation to place: where its coordinate is, its size and how it may be placed. */
internal class PlacementInput(
    val key: Any,
    val x: Float?,
    val y: Float?,
    val width: Float,
    val height: Float,
    val anchors: List<TileflowViewAnnotationAnchorConfig>,
    val allowOverlap: Boolean,
    val priority: Int,
    val selected: Boolean,
    val order: Long,
    val visible: Boolean = true,
)

/** Where a view annotation goes: its frame's left and top and the anchor chosen. */
internal data class Placement(val left: Float, val top: Float, val anchor: Int)

/** The frame of a view of [width] by [height] with [config] at ([x], [y]), as left and top. */
internal fun anchoredFrame(
    x: Float,
    y: Float,
    width: Float,
    height: Float,
    config: TileflowViewAnnotationAnchorConfig,
    scale: Float = 1f,
): Pair<Float, Float> {
    val (left, top) =
        when (config.anchor) {
            TileflowViewAnnotationAnchor.CENTER -> x - width / 2 to y - height / 2
            TileflowViewAnnotationAnchor.TOP -> x - width / 2 to y
            TileflowViewAnnotationAnchor.BOTTOM -> x - width / 2 to y - height
            TileflowViewAnnotationAnchor.LEFT -> x to y - height / 2
            TileflowViewAnnotationAnchor.RIGHT -> x - width to y - height / 2
            TileflowViewAnnotationAnchor.TOP_LEFT -> x to y
            TileflowViewAnnotationAnchor.TOP_RIGHT -> x - width to y
            TileflowViewAnnotationAnchor.BOTTOM_LEFT -> x to y - height
            TileflowViewAnnotationAnchor.BOTTOM_RIGHT -> x - width to y - height
        }
    return left + (config.offsetX * scale).toFloat() to top - (config.offsetY * scale).toFloat()
}

/**
 * Places view annotations: selected ones first, then by priority, then in the order they were
 * added. Each takes the first anchor whose frame collides with no annotation placed before it,
 * unless it allows overlap; one without a free anchor, without a position or not visible is
 * hidden (null). Offsets are multiplied by [scale].
 */
internal fun placeViewAnnotations(
    inputs: List<PlacementInput>,
    scale: Float = 1f,
): Map<Any, Placement?> {
    val placed = mutableListOf<FloatArray>()
    val result = HashMap<Any, Placement?>()
    val sorted =
        inputs.sortedWith(
            compareByDescending<PlacementInput> { it.selected }
                .thenByDescending { it.priority }
                .thenBy { it.order }
        )
    for (input in sorted) {
        val x = input.x
        val y = input.y
        if (!input.visible || x == null || y == null) {
            result[input.key] = null
            continue
        }
        var chosen: Placement? = null
        for ((index, config) in input.anchors.withIndex()) {
            val (left, top) = anchoredFrame(x, y, input.width, input.height, config, scale)
            val frame = floatArrayOf(left, top, left + input.width, top + input.height)
            if (input.allowOverlap || placed.none { intersects(it, frame) }) {
                chosen = Placement(left, top, index)
                placed += frame
                break
            }
        }
        result[input.key] = chosen
    }
    return result
}

private fun intersects(a: FloatArray, b: FloatArray): Boolean =
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
