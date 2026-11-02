package dev.tileflow.sdk.attribution

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.TextUtils
import android.text.method.LinkMovementMethod
import android.text.style.ClickableSpan
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat
import dev.tileflow.sdk.offline.OfflineCredit
import dev.tileflow.sdk.offline.OfflineObligation
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The map's attribution control, drawn by the SDK over MapLibre Native, whose own attribution and
 * logo stay disabled.
 *
 * It is always shown while the map has something to credit, in the corner the map's options choose,
 * inside the content padding. Compact, it is one line: a button and the credits that read as a
 * line (the sources' credits, the downloaded sources' pages, the style's notices and World's
 * fair-use notice), ellipsized in the middle so the first credit and the last notice stay legible.
 * The button opens every entry in full, in order, with its links. TalkBack reads the full text of
 * every entry from the compact control and offers each link as an action. Links never open by
 * themselves: they reach the map view, which reports the request.
 *
 * The view covers the map; touches reach the map everywhere but on the control and its open list.
 */
internal class MapAttributionView(context: Context) : ViewGroup(context) {
    private val density = resources.displayMetrics.density
    var onLink: ((String) -> Unit)? = null
    /**
     * The corner, as the map's options name it once the layout direction is applied: `top-left`,
     * `top-right`, `bottom-left` or `bottom-right`.
     */
    var corner: String = "bottom-right"
        set(value) {
            if (field == value) return
            field = value
            requestLayout()
        }
    /** The map's content padding, in pixels: left, top, right, bottom. */
    var insets: IntArray = IntArray(4)
        set(value) {
            if (field.contentEquals(value)) return
            field = value
            requestLayout()
        }
    var entries: List<MapAttributionEntry> = emptyList()
        private set
    var expanded: Boolean = false
        private set
    private var linkActions: List<Int> = emptyList()

    val control = LinearLayout(context)
    private val icon = InfoIcon(context)
    val label = TextView(context)
    val list = ScrollView(context)
    val listText = TextView(context)

    init {
        clipChildren = false
        val background = themeColor(android.R.attr.colorBackground, Color.WHITE)
        val foreground = themeColor(android.R.attr.textColorPrimary, Color.BLACK)
        control.orientation = LinearLayout.HORIZONTAL
        control.gravity = Gravity.CENTER_VERTICAL
        control.background =
            GradientDrawable().apply {
                setColor(withAlpha(background, 0.82f))
                cornerRadius = 4 * density
            }
        control.isClickable = true
        control.isFocusable = true
        control.setOnClickListener { setExpanded(!expanded) }
        icon.color = withAlpha(foreground, 0.6f)
        label.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 11f)
        label.setTextColor(withAlpha(foreground, 0.78f))
        label.isSingleLine = true
        label.ellipsize = TextUtils.TruncateAt.MIDDLE
        label.textAlignment = TEXT_ALIGNMENT_VIEW_START
        label.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        icon.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        val side = (20 * density).roundToInt()
        control.addView(icon, LinearLayout.LayoutParams(side, side))
        control.addView(
            label,
            LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = (4 * density).roundToInt()
            },
        )
        ViewCompat.setAccessibilityDelegate(
            control,
            object : androidx.core.view.AccessibilityDelegateCompat() {
                override fun onInitializeAccessibilityNodeInfo(
                    host: View,
                    info: AccessibilityNodeInfoCompat,
                ) {
                    super.onInitializeAccessibilityNodeInfo(host, info)
                    info.className = "android.widget.Button"
                }
            },
        )
        listText.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12f)
        listText.setTextColor(foreground)
        listText.setLinkTextColor(themeColor(android.R.attr.colorAccent, Color.BLUE))
        listText.movementMethod = LinkMovementMethod.getInstance()
        listText.textAlignment = TEXT_ALIGNMENT_VIEW_START
        val padding = (8 * density).roundToInt()
        listText.setPadding(padding, padding, padding, padding)
        list.addView(listText)
        list.background =
            GradientDrawable().apply {
                setColor(withAlpha(background, 0.95f))
                cornerRadius = 6 * density
            }
        list.visibility = GONE
        control.visibility = GONE
        addView(list)
        addView(control)
    }

    /** Shows the entries, in order. With none, the control hides. */
    fun show(entries: List<MapAttributionEntry>) {
        if (entries == this.entries) return
        this.entries = entries
        val compactKinds =
            setOf(
                MapAttributionEntry.Kind.SOURCE,
                MapAttributionEntry.Kind.PAGE,
                MapAttributionEntry.Kind.NOTICE,
                MapAttributionEntry.Kind.FAIR_USE,
            )
        val compact = entries.filter { it.kind in compactKinds }.ifEmpty { entries }
        label.text = compact.joinToString(SEPARATOR) { it.text }
        control.visibility = if (entries.isEmpty()) GONE else VISIBLE
        control.contentDescription = entries.joinToString("\n") { it.text }
        for (id in linkActions) ViewCompat.removeAccessibilityAction(control, id)
        val seen = HashSet<String>()
        linkActions =
            entries.flatMap { entry ->
                entry.links.mapNotNull { link ->
                    val name = "Open ${entry.text(link)}"
                    if (!seen.add(name + link.url)) return@mapNotNull null
                    ViewCompat.addAccessibilityAction(control, name) { _, _ ->
                        onLink?.invoke(link.url)
                        true
                    }
                }
            }
        listText.text = listText(entries)
        if (entries.isEmpty()) setExpanded(false)
        requestLayout()
    }

    fun setExpanded(expanded: Boolean) {
        val next = expanded && entries.isNotEmpty()
        if (next == this.expanded) return
        this.expanded = next
        list.visibility = if (next) VISIBLE else GONE
        ViewCompat.setStateDescription(control, if (next) "Expanded" else "Collapsed")
        list.scrollTo(0, 0)
        requestLayout()
    }

    /** Every entry as a paragraph, with its links. */
    private fun listText(entries: List<MapAttributionEntry>): CharSequence {
        val text = SpannableStringBuilder()
        for ((index, entry) in entries.withIndex()) {
            val start = text.length
            text.append(entry.text)
            if (index < entries.size - 1) text.append("\n")
            for (link in entry.links) {
                text.setSpan(
                    object : ClickableSpan() {
                        override fun onClick(widget: View) {
                            onLink?.invoke(link.url)
                        }
                    },
                    start + link.start,
                    start + link.end,
                    Spanned.SPAN_EXCLUSIVE_EXCLUSIVE,
                )
            }
        }
        return text
    }

    // Layout

    /** The rectangle the control may use: the view inside its insets and margins. */
    private fun area(width: Int, height: Int): IntArray {
        val margin = (MARGIN_DP * density).roundToInt()
        val left = insets[0] + margin
        val top = insets[1] + margin
        val right = max(left, width - insets[2] - margin)
        val bottom = max(top, height - insets[3] - margin)
        return intArrayOf(left, top, right, bottom)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val width = MeasureSpec.getSize(widthMeasureSpec)
        val height = MeasureSpec.getSize(heightMeasureSpec)
        setMeasuredDimension(width, height)
        val area = area(width, height)
        val areaWidth = area[2] - area[0]
        val areaHeight = area[3] - area[1]
        val maximum =
            max(min(areaWidth * 0.62f, 360 * density), min(areaWidth.toFloat(), 120 * density))
        val compactHeight = (COMPACT_HEIGHT_DP * density).roundToInt()
        control.measure(
            MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
            MeasureSpec.makeMeasureSpec(compactHeight, MeasureSpec.EXACTLY),
        )
        val controlWidth = min(control.measuredWidth, ceil(maximum).toInt())
        control.measure(
            MeasureSpec.makeMeasureSpec(controlWidth, MeasureSpec.EXACTLY),
            MeasureSpec.makeMeasureSpec(compactHeight, MeasureSpec.EXACTLY),
        )
        if (expanded) {
            val listWidth = min(areaWidth, (420 * density).roundToInt())
            val listHeight =
                max(
                    0,
                    min(
                        areaHeight - compactHeight - (6 * density).roundToInt(),
                        (320 * density).roundToInt(),
                    ),
                )
            list.measure(
                MeasureSpec.makeMeasureSpec(listWidth, MeasureSpec.EXACTLY),
                MeasureSpec.makeMeasureSpec(listHeight, MeasureSpec.AT_MOST),
            )
        }
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val area = area(r - l, b - t)
        val left = corner.endsWith("left")
        val top = corner.startsWith("top")
        val width = control.measuredWidth
        val height = control.measuredHeight
        val x = if (left) area[0] else area[2] - width
        val y = if (top) area[1] else area[3] - height
        control.layout(x, y, x + width, y + height)
        if (!expanded) return
        val gap = (6 * density).roundToInt()
        val listX = if (left) area[0] else area[2] - list.measuredWidth
        val listY = if (top) y + height + gap else y - gap - list.measuredHeight
        list.layout(listX, listY, listX + list.measuredWidth, listY + list.measuredHeight)
    }

    private fun themeColor(attribute: Int, fallback: Int): Int {
        val value = TypedValue()
        if (!context.theme.resolveAttribute(attribute, value, true)) return fallback
        return if (value.resourceId != 0)
            runCatching { context.getColorStateList(value.resourceId).defaultColor }
                .getOrDefault(fallback)
        else value.data
    }

    private fun withAlpha(color: Int, alpha: Float): Int =
        Color.argb(
            (alpha * 255).roundToInt(),
            Color.red(color),
            Color.green(color),
            Color.blue(color),
        )

    /** A circled "i". */
    private class InfoIcon(context: Context) : View(context) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        var color: Int = Color.GRAY

        override fun onDraw(canvas: Canvas) {
            val density = resources.displayMetrics.density
            val radius = 5.5f * density
            val x = width / 2f
            val y = height / 2f
            paint.color = color
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.2f * density
            canvas.drawCircle(x, y, radius, paint)
            paint.style = Paint.Style.FILL
            canvas.drawCircle(x, y - 2.6f * density, 0.8f * density, paint)
            val stem = 0.6f * density
            canvas.drawRect(x - stem, y - 1f * density, x + stem, y + 3f * density, paint)
        }
    }

    companion object {
        /**
         * The compact control's height. It fits the space the map's other controls leave free for
         * it in its corner (`MapControlsView.ATTRIBUTION_SPACE_DP`).
         */
        const val COMPACT_HEIGHT_DP: Float = 24f
        const val MARGIN_DP: Float = 8f
        /** Separates the items of the compact line. */
        const val SEPARATOR: String = " · "
    }
}

/**
 * The attribution a map shows and the control that shows it: the model's entries for the current
 * view, recomputed when the style, the downloaded credits, the view or the fair-use notice change.
 * Used on the main thread.
 */
internal class MapAttributionControl(context: Context) {
    val view = MapAttributionView(context)
    private val density = context.resources.displayMetrics.density
    var model = MapAttribution()
        private set
    var entries: List<MapAttributionEntry> = emptyList()
        private set
    private val fairUse = MapFairUseState()
    /** The view, `[west, south, east, north]`, the regional credits were last checked against. */
    private var bounds: DoubleArray? = null

    var onLink: ((String) -> Unit)?
        get() = view.onLink
        set(value) {
            view.onLink = value
        }

    /** The style the map shows: its sources' attribution and its notices. */
    fun setStyle(style: JSONObject, attributions: List<String>) {
        model = model.copy(sources = attributions, notices = MapAttribution.notices(style))
        refresh()
    }

    /** The credits of the sources the map's downloaded regions hold. */
    fun setDownloaded(obligations: List<OfflineObligation>, credits: List<OfflineCredit>) {
        model =
            model.copy(
                obligations = obligations.map(::MapObligation),
                credits = credits.map(::MapCredit),
            )
        refresh()
    }

    /** The view the map shows, at the end of a camera movement or when its content loads. */
    fun update(bounds: DoubleArray?) {
        if (bounds != null) this.bounds = bounds
        refresh()
    }

    /** A response the map received: a World tile's may change the fair-use notice. */
    fun received(signal: MapFairUseSignal?) {
        if (signal == null || !fairUse.receive(signal)) return
        model = model.copy(fairUse = fairUse.notice)
        refresh()
    }

    /** The corner the options name and the content insets, in dp, as the view sends them. */
    fun place(corner: String?, insets: JSONObject?) {
        if (corner in setOf("top-left", "top-right", "bottom-left", "bottom-right"))
            view.corner = corner!!
        if (insets != null)
            view.insets =
                listOf("left", "top", "right", "bottom")
                    .map { (insets.optDouble(it, 0.0) * density).roundToInt() }
                    .toIntArray()
    }

    private fun refresh() {
        val next = model.entries(bounds)
        if (next == entries) return
        entries = next
        view.show(next)
    }
}
