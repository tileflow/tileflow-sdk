package dev.tileflow.sdk

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import dev.tileflow.sdk.engine.AnnotationProjection
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.FrameLayout
import dev.tileflow.sdk.model.MapContract
import kotlin.math.roundToInt

/**
 * The layer of native content over the renderer: view annotations, and while an accessibility
 * service explores by touch, a target for each labelled annotation. It follows the positions the
 * renderer reports and moves its children at the next display frame.
 */
@SuppressLint("ViewConstructor")
internal class AnnotationOverlay(context: Context, private val map: TileflowMapView) :
    FrameLayout(context) {
    private val density = resources.displayMetrics.density
    private var manager: TileflowViewAnnotationManager? = null
    internal val positions = HashMap<Any, FloatArray?>()
    private var sentPoints: List<Pair<Any, TileflowCoordinate>>? = null
    private var native: AnnotationProjection? = null
    private var nativeInput = DoubleArray(0)
    private var nativePixels = DoubleArray(0)
    private val targets = LinkedHashMap<Pair<String, String>, AccessibilityTarget>()
    private val accessibility =
        context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    private val explorationListener =
        AccessibilityManager.TouchExplorationStateChangeListener { annotationsChanged() }

    /** Tracks labelled annotations without an accessibility service, for tests. */
    var forcesAccessibilityTracking = false
        set(value) {
            field = value
            annotationsChanged()
        }

    /** How many points the renderer reports positions for. */
    val trackedCount: Int
        get() = desiredPoints().size

    init {
        clipChildren = true
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    private val accessibilityTracked: Boolean
        get() = forcesAccessibilityTracking || accessibility.isTouchExplorationEnabled

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        accessibility.addTouchExplorationStateChangeListener(explorationListener)
    }

    override fun onDetachedFromWindow() {
        accessibility.removeTouchExplorationStateChangeListener(explorationListener)
        super.onDetachedFromWindow()
    }

    // The overlay never takes a touch itself; its children take theirs.
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean = false

    fun bind(next: TileflowViewAnnotationManager?) {
        manager = next
    }

    fun attach(
        view: View,
        options: TileflowViewAnnotationOptions,
        owner: TileflowViewAnnotationManager,
    ) {
        view.visibility = INVISIBLE
        addView(view, layoutParams(options, owner))
    }

    fun resize(
        view: View,
        options: TileflowViewAnnotationOptions,
        owner: TileflowViewAnnotationManager,
    ) {
        if (view.parent === this) view.layoutParams = layoutParams(options, owner)
    }

    fun detach(view: View) {
        if (view.parent === this) removeView(view)
    }

    private fun layoutParams(
        options: TileflowViewAnnotationOptions,
        owner: TileflowViewAnnotationManager,
    ) =
        LayoutParams(
            options.width?.let { (it * scale(owner)).roundToInt() } ?: LayoutParams.WRAP_CONTENT,
            options.height?.let { (it * scale(owner)).roundToInt() } ?: LayoutParams.WRAP_CONTENT,
        )

    private fun scale(owner: TileflowViewAnnotationManager?) =
        if (owner?.unitsInDp == true) density else 1f

    /** The points to track: shown view annotations, then labelled annotations when read aloud. */
    private fun desiredPoints(): List<Pair<Any, TileflowCoordinate>> {
        val views =
            manager?.entries?.values?.filter { it.options.visible }?.map {
                it.view as Any to it.options.coordinate
            } ?: emptyList()
        val labelled =
            if (!accessibilityTracked) emptyList()
            else
                map.annotations.accessible().map { (owner, annotation) ->
                    (owner.id to annotation.id) as Any to annotation.representative
                }
        return (views + labelled).take(MapContract.MAXIMUM_TRACKED_POINTS)
    }

    /** Something tracked changed: sends the points and refreshes accessibility targets. */
    fun annotationsChanged() {
        refreshTargets()
        val points = desiredPoints()
        positions.keys.retainAll(points.map { it.first }.toSet())
        if (points != sentPoints) send()
        map.annotationSubscriptionsChanged()
        invalidate()
    }

    /** Give MapLibre the coordinates to project in each rendered frame. */
    private fun send() {
        val projection = map.readyEngine?.annotationProjection ?: return
        val points = desiredPoints()
        if (points == sentPoints) return
        native?.onFrame = null
        native = projection
        sentPoints = points
        nativeInput = DoubleArray(points.size * 2)
        nativePixels = DoubleArray(nativeInput.size)
        points.forEachIndexed { index, point ->
            nativeInput[index * 2] = point.second.latitude
            nativeInput[index * 2 + 1] = point.second.longitude
        }
        projection.track(nativeInput)
        projection.onFrame = if (points.isEmpty()) null else ({
            applyPositions()
            invalidate()
        })
        invalidate()
    }

    /** A new renderer receives the points again. */
    fun rendererReady() {
        sentPoints = null
        positions.clear()
        send()
    }

    fun rendererRetired() {
        native?.onFrame = null
        native?.track(DoubleArray(0))
        native = null
        sentPoints = null
        positions.clear()
    }

    override fun dispatchDraw(canvas: Canvas) {
        if (native != null && nativeInput.isNotEmpty()) applyPositions()
        super.dispatchDraw(canvas)
    }

    private fun projectNative(projector: AnnotationProjection) {
        val points = sentPoints ?: return
        if (points.isEmpty()) return
        projector.project(nativeInput, nativePixels)
        points.forEachIndexed { index, (key, _) ->
            val x = nativePixels[index * 2].toFloat()
            val y = nativePixels[index * 2 + 1].toFloat()
            if (x.isFinite() && y.isFinite()) {
                val point = positions[key] ?: FloatArray(2).also { positions[key] = it }
                point[0] = x
                point[1] = y
            } else positions[key] = null
        }
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        // A view that measured a new size takes its place again.
        invalidate()
    }

    /** Moves the views to the newest positions and places the view annotations. */
    internal fun applyPositions() {
        native?.let(::projectNative)
        val owner = manager
        if (owner != null) placeViews(owner)
        for ((key, target) in targets) {
            val position = positions[key]
            if (position == null) {
                target.visibility = GONE
                continue
            }
            target.visibility = VISIBLE
            // A target that was hidden has no measured size yet; its size is fixed.
            target.translationX = position[0] - target.layoutParams.width / 2f
            target.translationY = position[1] - target.layoutParams.height / 2f
        }
    }

    private fun placeViews(owner: TileflowViewAnnotationManager) {
        val scale = scale(owner)
        val entries = owner.entries.values.toList()
        val placements =
            placeViewAnnotations(
                entries.map { entry ->
                    val position = positions[entry.view]
                    PlacementInput(
                        entry.view,
                        position?.get(0),
                        position?.get(1),
                        entry.view.measuredWidth.toFloat(),
                        entry.view.measuredHeight.toFloat(),
                        entry.options.variableAnchors,
                        entry.options.allowOverlap,
                        entry.options.priority,
                        entry.options.selected,
                        entry.order,
                        entry.options.visible,
                    )
                },
                scale,
            )
        val listeners = owner.listeners.toList()
        for (entry in entries) {
            val placement = placements[entry.view]
            val shown = placement != null
            if (placement != null) {
                entry.view.translationX = placement.left
                entry.view.translationY = placement.top
                val frame =
                    floatArrayOf(
                        placement.left / scale,
                        placement.top / scale,
                        entry.view.measuredWidth / scale,
                        entry.view.measuredHeight / scale,
                    )
                if (!frame.contentEquals(entry.frame)) {
                    entry.frame = frame
                    listeners.forEach {
                        it.onViewAnnotationPositionUpdated(
                            entry.view,
                            frame[0],
                            frame[1],
                            frame[2],
                            frame[3],
                        )
                    }
                }
                val anchor = entry.options.variableAnchors[placement.anchor]
                if (anchor != entry.anchor) {
                    entry.anchor = anchor
                    listeners.forEach { it.onViewAnnotationAnchorUpdated(entry.view, anchor) }
                }
            }
            entry.view.visibility = if (shown) VISIBLE else INVISIBLE
            if (shown != entry.shown) {
                entry.shown = shown
                listeners.forEach { it.onViewAnnotationVisibilityUpdated(entry.view, shown) }
            }
        }
    }

    /** Keeps one accessibility target per labelled annotation while they are read aloud. */
    private fun refreshTargets() {
        val wanted =
            if (!accessibilityTracked) emptyList() else map.annotations.accessible()
        val keys = wanted.map { (owner, annotation) -> owner.id to annotation.id }.toSet()
        targets.keys.filter { it !in keys }.forEach { removeView(targets.remove(it)) }
        val size = (48 * density).roundToInt()
        for ((owner, annotation) in wanted) {
            val key = owner.id to annotation.id
            val target =
                targets.getOrPut(key) {
                    AccessibilityTarget(context, owner, annotation.id).also {
                        it.visibility = GONE
                        addView(it, LayoutParams(size, size))
                    }
                }
            target.contentDescription = annotation.accessibilityLabel
            target.isLongClickable = owner.hasLongClickListeners
        }
    }

    /** The accessibility target of an annotation, while one exists. */
    fun accessibilityTarget(managerId: String, annotationId: String): View? =
        targets[managerId to annotationId]

    /**
     * Gives accessibility services the annotations in reading order: top to bottom, then left to
     * right, with view annotations and labelled annotations together.
     */
    override fun addChildrenForAccessibility(outChildren: ArrayList<View>) {
        val found = ArrayList<View>()
        super.addChildrenForAccessibility(found)
        fun owner(view: View): View {
            var current = view
            while (current.parent !== this) current = current.parent as? View ?: return view
            return current
        }
        val leftToRight = layoutDirection != LAYOUT_DIRECTION_RTL
        outChildren +=
            found
                .filter { owner(it).visibility == VISIBLE }
                .sortedWith(
                    compareBy<View> { owner(it).let { child -> child.top + child.translationY } }
                        .thenBy {
                            owner(it).let { child ->
                                val left = child.left + child.translationX
                                if (leftToRight) left else -(left + child.width)
                            }
                        }
                )
    }

    fun dispose() {
        native?.onFrame = null
        native?.track(DoubleArray(0))
        native = null
        positions.clear()
    }

    /** What an accessibility service focuses and activates for a labelled annotation. */
    @SuppressLint("ViewConstructor")
    internal inner class AccessibilityTarget(
        context: Context,
        private val owner: TileflowAnnotationManager<*, *>,
        private val annotationId: String,
    ) : View(context) {
        init {
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
            isClickable = true
            isFocusable = true
        }

        // Touches go to the map; only accessibility actions reach the target.
        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(event: MotionEvent): Boolean = false

        override fun dispatchTouchEvent(event: MotionEvent): Boolean = false

        override fun performClick(): Boolean {
            super.performClick()
            map.annotations.press(owner, annotationId, long = false)
            return true
        }

        override fun performLongClick(): Boolean {
            map.annotations.press(owner, annotationId, long = true)
            return true
        }

        override fun getAccessibilityClassName(): CharSequence = Button::class.java.name

        override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(info)
            info.isLongClickable = isLongClickable
        }
    }
}
