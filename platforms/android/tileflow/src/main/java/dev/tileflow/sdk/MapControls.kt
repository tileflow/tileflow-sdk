package dev.tileflow.sdk

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.util.TypedValue
import android.view.View
import android.view.ViewGroup
import dev.tileflow.sdk.location.TileflowFollowMode
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

/** A corner of the map. Start and end follow the layout direction. */
public enum class TileflowControlPosition {
    TOP_START,
    TOP_END,
    BOTTOM_START,
    BOTTOM_END;

    internal val isTop: Boolean
        get() = this == TOP_START || this == TOP_END

    internal val isStart: Boolean
        get() = this == TOP_START || this == BOTTOM_START

    /** The renderer's name for the corner. */
    internal fun corner(rightToLeft: Boolean): String =
        "${if (isTop) "top" else "bottom"}-${if (isStart != rightToLeft) "left" else "right"}"
}

public enum class TileflowCompassVisibility {
    /** Shown while the map is turned away from north. */
    ADAPTIVE,
    VISIBLE,
    HIDDEN,
}

public enum class TileflowScaleBarUnits {
    /** Miles and feet where the region uses them, otherwise kilometres and metres. */
    AUTOMATIC,
    METRIC,
    IMPERIAL,
}

/**
 * The map's native controls. They stay inside the map's content padding, so system bars and sheets
 * never cover them. The attribution is always shown; only its corner can change.
 *
 * @property recenterButton A button that recenters the map. While the map shows the person's
 *   location it follows the location, and turns between following the position and the heading;
 *   otherwise it reports [TileflowMapEvent.RecenterRequested] and the application decides where
 *   the camera goes.
 */
public data class TileflowMapControls(
    val compass: TileflowCompassVisibility = TileflowCompassVisibility.ADAPTIVE,
    val compassPosition: TileflowControlPosition = TileflowControlPosition.TOP_END,
    val scaleBar: Boolean = false,
    val scaleBarPosition: TileflowControlPosition = TileflowControlPosition.BOTTOM_START,
    val scaleBarUnits: TileflowScaleBarUnits = TileflowScaleBarUnits.AUTOMATIC,
    val recenterButton: Boolean = false,
    val recenterButtonPosition: TileflowControlPosition = TileflowControlPosition.BOTTOM_END,
    val attributionPosition: TileflowControlPosition = TileflowControlPosition.BOTTOM_END,
) {
    /** Whether the controls follow the camera while it moves. */
    internal val followCamera: Boolean
        get() = compass != TileflowCompassVisibility.HIDDEN || scaleBar
}

/** The length and label of a scale bar. */
internal data class ScaleBarMeasure(
    /** The distance the bar shows, in metres. */
    val meters: Double,
    val unit: Unit,
    /** The distance in [unit]. */
    val value: Double,
    /** The bar's length in CSS pixels (dp). */
    val length: Double,
) {
    enum class Unit(val metres: Double, val symbol: String, val singular: String) {
        METERS(1.0, "m", "meter"),
        KILOMETERS(1000.0, "km", "kilometer"),
        FEET(0.3048, "ft", "foot"),
        MILES(1609.344, "mi", "mile"),
    }

    private fun number(locale: Locale): String =
        NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 2 }.format(value)

    fun label(locale: Locale = Locale.getDefault()): String = "${number(locale)} ${unit.symbol}"

    fun spoken(locale: Locale = Locale.getDefault()): String {
        val name =
            when {
                value == 1.0 -> unit.singular
                unit == Unit.FEET -> "feet"
                else -> "${unit.singular}s"
            }
        return "${number(locale)} $name"
    }

    companion object {
        /**
         * The longest round distance (1, 2 or 5 times a power of ten) that fits in [maximumLength]
         * CSS pixels at the camera's centre. MapLibre draws the world 512 CSS pixels wide at zoom
         * 0.
         */
        fun of(camera: TileflowCamera, maximumLength: Double, imperial: Boolean): ScaleBarMeasure {
            val metersPerPixel =
                40_075_016.686 * cos(Math.toRadians(camera.latitude)) / (512 * 2.0.pow(camera.zoom))
            val maximum = maximumLength * metersPerPixel
            val unit =
                if (imperial) {
                    if (maximum >= Unit.MILES.metres) Unit.MILES else Unit.FEET
                } else if (maximum >= Unit.KILOMETERS.metres) Unit.KILOMETERS
                else Unit.METERS
            val available = maximum / unit.metres
            val power = 10.0.pow(floor(log10(available)))
            val value =
                listOf(5.0, 2.0, 1.0).map { it * power }.firstOrNull { it <= available } ?: power
            val meters = value * unit.metres
            return ScaleBarMeasure(meters, unit, value, meters / metersPerPixel)
        }

        /** Imperial units for the regions that use them on maps. */
        fun imperial(units: TileflowScaleBarUnits, locale: Locale = Locale.getDefault()): Boolean =
            when (units) {
                TileflowScaleBarUnits.METRIC -> false
                TileflowScaleBarUnits.IMPERIAL -> true
                TileflowScaleBarUnits.AUTOMATIC -> locale.country in setOf("US", "LR", "MM", "GB")
            }
    }
}

/** Native controls drawn over the renderer. Touches anywhere but on a control reach the map. */
@SuppressLint("ViewConstructor")
internal class MapControlsView(context: Context) : ViewGroup(context) {
    private val density = resources.displayMetrics.density
    val compass = CompassView(context)
    val scaleBar = ScaleBarView(context)
    val recenter = RecenterView(context)
    var controls = TileflowMapControls()
        set(value) {
            field = value
            update()
        }

    var camera: TileflowCamera? = null
        set(value) {
            field = value
            update()
        }

    /** Whether the map shows the location, so the recenter button follows it. */
    var locationShown: Boolean = false
        set(value) {
            field = value
            recenter.show(value, followMode)
        }

    var followMode: TileflowFollowMode = TileflowFollowMode.NONE
        set(value) {
            field = value
            recenter.show(locationShown, value)
        }

    /** Space covered at each edge, in pixels. */
    var insets = TileflowEdgeInsets.ZERO
        set(value) {
            if (field == value) return
            field = value
            requestLayout()
        }

    init {
        for (control in listOf(compass, scaleBar, recenter)) {
            control.visibility = GONE
            addView(control)
        }
    }

    /** Whether a visible control lies under the point, in this view's pixels. */
    fun hasControlAt(x: Float, y: Float): Boolean {
        val slop = 4 * density
        return listOf(compass, recenter).any {
            it.visibility == VISIBLE &&
                x >= it.left - slop &&
                x <= it.right + slop &&
                y >= it.top - slop &&
                y <= it.bottom + slop
        }
    }

    private fun update() {
        val camera = camera
        if (camera == null) {
            for (index in 0 until childCount) getChildAt(index).visibility = GONE
            return
        }
        compass.bearing = camera.bearing
        val turned = abs(camera.bearing % 360) >= 0.5
        compass.visibility =
            if (
                controls.compass == TileflowCompassVisibility.HIDDEN ||
                    (controls.compass == TileflowCompassVisibility.ADAPTIVE && !turned)
            )
                GONE
            else VISIBLE
        scaleBar.visibility = if (controls.scaleBar) VISIBLE else GONE
        if (controls.scaleBar)
            scaleBar.measure =
                ScaleBarMeasure.of(camera, 100.0, ScaleBarMeasure.imperial(controls.scaleBarUnits))
        recenter.visibility = if (controls.recenterButton) VISIBLE else GONE
        requestLayout()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        for (index in 0 until childCount) {
            getChildAt(index).measure(
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
                MeasureSpec.makeMeasureSpec(0, MeasureSpec.UNSPECIFIED),
            )
        }
        setMeasuredDimension(
            getDefaultSize(0, widthMeasureSpec),
            getDefaultSize(0, heightMeasureSpec),
        )
    }

    override fun onLayout(changed: Boolean, l: Int, t: Int, r: Int, b: Int) {
        val rightToLeft = layoutDirection == LAYOUT_DIRECTION_RTL
        val margin = MARGIN_DP * density
        val left = insets.left + margin
        val top = insets.top + margin
        val right = (r - l) - insets.right - margin
        val bottom = (b - t) - insets.bottom - margin
        val offsets =
            mutableMapOf(controls.attributionPosition to ATTRIBUTION_SPACE_DP * density)
        for ((control, position) in
            listOf(
                compass to controls.compassPosition,
                recenter to controls.recenterButtonPosition,
                scaleBar to controls.scaleBarPosition,
            )) {
            if (control.visibility != VISIBLE) continue
            val offset = offsets[position] ?: 0f
            val width = control.measuredWidth
            val height = control.measuredHeight
            val x = if (position.isStart != rightToLeft) left else right - width
            val y = if (position.isTop) top + offset else bottom - offset - height
            control.layout(
                x.roundToInt(),
                y.roundToInt(),
                x.roundToInt() + width,
                y.roundToInt() + height,
            )
            offsets[position] = offset + height + margin
        }
    }

    internal companion object {
        const val MARGIN_DP = 8f
        /** Space kept free for the attribution in its corner. */
        const val ATTRIBUTION_SPACE_DP = 36f
    }
}

private fun isDark(context: Context): Boolean =
    context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
        Configuration.UI_MODE_NIGHT_YES

/** A round button background with a soft shadow. */
private fun buttonPaint(density: Float): Paint =
    Paint(Paint.ANTI_ALIAS_FLAG).apply {
        setShadowLayer(3 * density, 0f, density, Color.argb(60, 0, 0, 0))
    }

private fun Canvas.drawButton(view: View, density: Float, paint: Paint) {
    paint.color =
        if (isDark(view.context)) Color.argb(235, 28, 28, 30) else Color.argb(235, 255, 255, 255)
    drawCircle(view.width / 2f, view.height / 2f, view.width / 2f - 2 * density, paint)
}

/** A closed polygon through points on a 44 × 44 grid, scaled to [size] pixels. */
private fun Path.polygon(size: Int, vararg points: Float): Path {
    val unit = size / 44f
    reset()
    moveTo(points[0] * unit, points[1] * unit)
    for (index in 2 until points.size step 2) lineTo(points[index] * unit, points[index + 1] * unit)
    close()
    return this
}

/** A needle that points north and turns the map to north when tapped. */
internal class CompassView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val background = buttonPaint(density)
    private val north = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(224, 49, 49) }
    private val south = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(142, 142, 147) }
    private val northPath = Path()
    private val southPath = Path()

    var bearing: Double = 0.0
        set(value) {
            field = value
            val heading = (((value % 360) + 360) % 360).roundToInt() % 360
            stateDescriptionCompat("Heading $heading degrees")
            invalidate()
        }

    init {
        contentDescription = "Compass"
        isClickable = true
        isFocusable = true
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = (SIZE_DP * density).roundToInt()
        setMeasuredDimension(size, size)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        northPath.polygon(w, 22f, 8f, 27f, 22f, 17f, 22f)
        southPath.polygon(w, 17f, 22f, 27f, 22f, 22f, 36f)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawButton(this, density, background)
        canvas.save()
        canvas.rotate(-bearing.toFloat(), width / 2f, height / 2f)
        canvas.drawPath(northPath, north)
        canvas.drawPath(southPath, south)
        canvas.restore()
    }

    private companion object {
        const val SIZE_DP = 44f
    }
}

/**
 * A button that recenters the map. While the map shows the location, it shows whether the camera
 * follows it: an outlined arrow when it does not, a filled arrow when it follows the position, and
 * an arrow pointing up when the map turns with the heading or the course.
 */
internal class RecenterView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val background = buttonPaint(density)
    private val glyph = Paint(Paint.ANTI_ALIAS_FLAG).apply { strokeJoin = Paint.Join.ROUND }
    private val arrow = Path()
    private val upright = Path()
    private var locationShown = false
    private var mode = TileflowFollowMode.NONE

    init {
        contentDescription = "Recenter map"
        isClickable = true
        isFocusable = true
        setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    fun show(locationShown: Boolean, mode: TileflowFollowMode) {
        this.locationShown = locationShown
        this.mode = mode
        contentDescription = if (locationShown) "My location" else "Recenter map"
        stateDescriptionCompat(
            when {
                !locationShown || mode == TileflowFollowMode.NONE -> ""
                mode == TileflowFollowMode.POSITION -> "Following"
                mode == TileflowFollowMode.HEADING -> "Following with heading"
                else -> "Following with course"
            }
        )
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val size = (44 * density).roundToInt()
        setMeasuredDimension(size, size)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        // A navigation arrow, as location buttons commonly show.
        arrow.polygon(w, 30f, 14f, 23f, 31f, 21f, 23f, 13f, 21f)
        upright.polygon(w, 22f, 11f, 30f, 32f, 22f, 27f, 14f, 32f)
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawButton(this, density, background)
        glyph.color = if (isDark(context)) Color.rgb(100, 170, 255) else Color.rgb(33, 102, 206)
        val outlined = locationShown && mode == TileflowFollowMode.NONE
        glyph.style = if (outlined) Paint.Style.STROKE else Paint.Style.FILL
        glyph.strokeWidth = 2 * density
        val turning =
            locationShown &&
                (mode == TileflowFollowMode.HEADING || mode == TileflowFollowMode.COURSE)
        canvas.drawPath(if (turning) upright else arrow, glyph)
    }
}

/** A bar of a round length with its distance, measured at the camera's centre. */
internal class ScaleBarView(context: Context) : View(context) {
    private val density = resources.displayMetrics.density
    private val text =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize =
                TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 11f, resources.displayMetrics)
            isFakeBoldText = true
        }
    private val bar =
        Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2 * density
        }
    private val barPath = Path()

    var measure: ScaleBarMeasure? = null
        set(value) {
            if (field == value) return
            field = value
            contentDescription = value?.let { "Map scale, ${it.spoken()}" }
            requestLayout()
            invalidate()
        }

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val label = measure?.label().orEmpty()
        val length = ((measure?.length ?: 0.0) * density).toFloat()
        val width = max(length, text.measureText(label)) + 2 * density
        val height = text.fontSpacing + 7 * density
        setMeasuredDimension(width.roundToInt(), height.roundToInt())
    }

    override fun onDraw(canvas: Canvas) {
        val measure = measure ?: return
        val color = if (isDark(context)) Color.WHITE else Color.rgb(32, 42, 55)
        text.color = color
        text.setShadowLayer(
            density,
            0f,
            0f,
            if (isDark(context)) Color.BLACK else Color.WHITE,
        )
        bar.color = color
        val baseline = -text.ascent()
        canvas.drawText(measure.label(), density, baseline, text)
        val top = text.fontSpacing
        val length = (measure.length * density).toFloat()
        barPath.reset()
        barPath.moveTo(density, top)
        barPath.lineTo(density, top + 5 * density)
        barPath.lineTo(length, top + 5 * density)
        barPath.lineTo(length, top)
        canvas.drawPath(barPath, bar)
    }
}

/** Sets the spoken state on Android 11 and later; earlier versions read the description. */
private fun View.stateDescriptionCompat(value: String) {
    if (android.os.Build.VERSION.SDK_INT >= 30) stateDescription = value
}
