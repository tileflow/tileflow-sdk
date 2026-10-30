package dev.tileflow.sdk

import android.annotation.SuppressLint
import android.content.Context
import android.view.Choreographer
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.FrameLayout
import dev.tileflow.sdk.bridge.ProtocolContract
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject

/** Recent delays between the renderer drawing a frame and its positions reaching the views. */
internal class TrackingLag(private val capacity: Int = 1000) {
    private val samples = ArrayDeque<Double>()

    fun record(milliseconds: Double) {
        if (!milliseconds.isFinite()) return
        samples.addLast(milliseconds)
        if (samples.size > capacity) samples.removeFirst()
    }

    val count: Int
        get() = samples.size

    /** The value below which [share] of the samples lie, or null without samples. */
    fun percentile(share: Double): Double? {
        if (samples.isEmpty()) return null
        val sorted = samples.sorted()
        return sorted[((sorted.size - 1) * share).roundToInt()]
    }

    val maximum: Double?
        get() = samples.maxOrNull()

    fun clear() = samples.clear()
}

/** The positions of tracked points, keyed by what they track, matched by revision. */
internal class TrackedPositions {
    private val sets = LinkedHashMap<Int, List<Any>>()
    val positions = HashMap<Any, FloatArray?>()

    fun sent(revision: Int, keys: List<Any>) {
        sets[revision] = keys
    }

    /**
     * Applies a report in CSS pixels at [density]; false when its revision is unknown or older than
     * a report already applied.
     */
    fun receive(revision: Int, values: JSONArray, density: Float): Boolean {
        val keys = sets[revision] ?: return false
        sets.keys.filter { it < revision }.forEach { sets.remove(it) }
        if (values.length() != keys.size * 2) return false
        keys.forEachIndexed { index, key ->
            val x = values.opt(index * 2)
            val y = values.opt(index * 2 + 1)
            positions[key] =
                if (x is Number && y is Number)
                    floatArrayOf(x.toFloat() * density, y.toFloat() * density)
                else null
        }
        return true
    }

    fun forget(keep: Set<Any>) {
        positions.keys.retainAll(keep)
    }

    fun clear() {
        sets.clear()
    }
}

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
    internal val tracked = TrackedPositions()
    private var revision = 0
    private var sentPoints: List<Pair<Any, TileflowCoordinate>>? = null
    private var sending = false
    private var frameRequested = false
    private var latestSampleTime: Double? = null
    private val targets = LinkedHashMap<Pair<String, String>, AccessibilityTarget>()
    private val accessibility =
        context.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
    private val explorationListener =
        AccessibilityManager.TouchExplorationStateChangeListener { annotationsChanged() }

    /** Delays between a rendered frame and its positions on the views. */
    val lag = TrackingLag()

    /** Delays between a rendered frame and its positions reaching the main thread. */
    val delivery = TrackingLag()

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

    private val frameCallback = Choreographer.FrameCallback { applyPositions() }

    private val accessibilityTracked: Boolean
        get() = forcesAccessibilityTracking || accessibility.isTouchExplorationEnabled

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        accessibility.addTouchExplorationStateChangeListener(explorationListener)
    }

    override fun onDetachedFromWindow() {
        accessibility.removeTouchExplorationStateChangeListener(explorationListener)
        if (frameRequested) Choreographer.getInstance().removeFrameCallback(frameCallback)
        frameRequested = false
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
        return (views + labelled).take(ProtocolContract.MAXIMUM_TRACKED_POINTS)
    }

    /** Something tracked changed: sends the points and refreshes accessibility targets. */
    fun annotationsChanged() {
        refreshTargets()
        val points = desiredPoints()
        tracked.forget(points.map { it.first }.toSet())
        if (points != sentPoints) send()
        map.annotationsTrackingChanged(points.isNotEmpty())
        requestFrame()
    }

    /** Sends the latest points, one request at a time. */
    private fun send() {
        if (sending) return
        val bridge = map.readyBridge ?: return
        val points = desiredPoints()
        if (points == sentPoints) return
        val current = ++revision
        tracked.sent(current, points.map { it.first })
        sentPoints = points
        sending = true
        map.launchOnView {
            try {
                bridge.call(
                    ProtocolContract.Method.SET_TRACKED_POINTS,
                    JSONObject()
                        .put("revision", current)
                        .put(
                            "points",
                            JSONArray(
                                points.map { (_, coordinate) ->
                                    JSONArray().put(coordinate.longitude).put(coordinate.latitude)
                                }
                            ),
                        ),
                )
            } catch (_: TileflowMapException) {
                // A replaced renderer receives the points again when it is ready.
                if (map.readyBridge !== bridge) return@launchOnView
                sentPoints = null
            } finally {
                sending = false
            }
            if (map.readyBridge === bridge) send()
        }
    }

    /** A new renderer receives the points again. */
    fun rendererReady() {
        sentPoints = null
        tracked.clear()
        sending = false
        send()
    }

    fun rendererRetired() {
        sentPoints = null
        sending = false
        tracked.clear()
    }

    /** Positions the renderer reports after a frame; applied at the next display frame. */
    fun receive(result: JSONObject) {
        val values = result.optJSONArray("positions") ?: return
        if (!tracked.receive(result.optInt("revision", -1), values, density)) return
        latestSampleTime = result.optDouble("time").takeIf { it.isFinite() }
        latestSampleTime?.let { delivery.record(System.currentTimeMillis() - it) }
        requestFrame()
    }

    private fun requestFrame() {
        if (frameRequested || !isAttachedToWindow) return
        frameRequested = true
        Choreographer.getInstance().postFrameCallback(frameCallback)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        // A view that measured a new size takes its place again.
        requestFrame()
    }

    /** Moves the views to the newest positions and places the view annotations. */
    internal fun applyPositions() {
        frameRequested = false
        latestSampleTime?.let { lag.record(System.currentTimeMillis() - it) }
        latestSampleTime = null
        val owner = manager
        if (owner != null) placeViews(owner)
        for ((key, target) in targets) {
            val position = tracked.positions[key]
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
                    val position = tracked.positions[entry.view]
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
        if (frameRequested) Choreographer.getInstance().removeFrameCallback(frameCallback)
        frameRequested = false
        tracked.clear()
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
