package dev.tileflow.sdk

import android.graphics.Bitmap
import androidx.annotation.ColorInt
import org.json.JSONArray
import org.json.JSONObject

/**
 * An annotation an annotation manager draws on the map: a point, circle, polyline or polygon that
 * people can tap, hold and, when [isDraggable], drag. Change its properties, then pass it to its
 * manager's `update`.
 *
 * @property id Identifies the annotation in its manager; the manager generates it.
 */
public abstract class TileflowBaseAnnotation internal constructor(public val id: String) {
    /** Whether a pan that starts on the annotation drags it instead of the map. */
    public var isDraggable: Boolean = false

    /**
     * What TalkBack reads for the annotation. Annotations with a label are part of the map's
     * accessibility order, where a double tap activates them like a tap.
     */
    public var accessibilityLabel: String? = null

    internal abstract val geometry: TileflowGeometry

    /** Moves the annotation to a geometry a drag reports. */
    internal abstract fun move(geometry: TileflowGeometry): Boolean

    /** The point accessibility services place the annotation at. */
    internal abstract val representative: TileflowCoordinate

    /** Style values by MapLibre property name, as feature properties. */
    internal abstract fun styleProperties(): Map<String, Any>

    internal fun feature(): JSONObject {
        val properties = JSONObject().put("id", id).put("draggable", isDraggable)
        styleProperties().forEach { (name, value) -> properties.put(name, styleConstantJson(value)) }
        return JSONObject()
            .put("type", "Feature")
            .put("geometry", TileflowGeometry.json(geometry))
            .put("properties", properties)
    }
}

/**
 * A point drawn with an image, as a MapLibre symbol.
 *
 * @property point Where the image is anchored.
 * @property iconImage The name of an application image, or of [iconImageBitmap] once set.
 * @property iconImageBitmap An image the manager adds to the map for the annotation.
 * @property iconOffset `[x, y]` in pixels of the image, positive right and down.
 * @property symbolSortKey Annotations with lower keys are placed first when they collide.
 */
public class TileflowPointAnnotation
internal constructor(id: String, point: TileflowCoordinate) : TileflowBaseAnnotation(id) {
    public var point: TileflowCoordinate = point
        set(value) {
            validCoordinate(value)
            field = value
        }

    public var iconImage: String? = null
    public var iconImageBitmap: Bitmap? = null
        set(value) {
            field = value
            if (value != null) iconImage = bitmapImageName(value)
        }

    public var iconAnchor: TileflowIconAnchor? = null
    public var iconOffset: List<Double>? = null
    public var iconRotate: Double? = null
    public var iconSize: Double? = null
    public var iconColor: TileflowColor? = null
    public var iconOpacity: Double? = null
    public var symbolSortKey: Double? = null

    override val geometry: TileflowGeometry
        get() = TileflowGeometry.Point(point)

    override val representative: TileflowCoordinate
        get() = point

    override fun move(geometry: TileflowGeometry): Boolean {
        point = (geometry as? TileflowGeometry.Point)?.coordinate ?: return false
        return true
    }

    override fun styleProperties(): Map<String, Any> =
        listOfNotNull(
                iconImage?.let { "icon-image" to it },
                iconAnchor?.let { "icon-anchor" to it },
                iconOffset?.let { "icon-offset" to it },
                iconRotate?.let { "icon-rotate" to it },
                iconSize?.let { "icon-size" to it },
                iconColor?.let { "icon-color" to it },
                iconOpacity?.let { "icon-opacity" to it },
                symbolSortKey?.let { "symbol-sort-key" to it },
            )
            .toMap()
}

/** A circle of a fixed size on screen around a point, as a MapLibre circle. */
public class TileflowCircleAnnotation
internal constructor(id: String, point: TileflowCoordinate) : TileflowBaseAnnotation(id) {
    public var point: TileflowCoordinate = point
        set(value) {
            validCoordinate(value)
            field = value
        }

    /** In pixels of the map, as MapLibre's `circle-radius`. */
    public var circleRadius: Double? = null
    public var circleColor: TileflowColor? = null
    public var circleOpacity: Double? = null
    public var circleStrokeColor: TileflowColor? = null
    public var circleStrokeWidth: Double? = null
    public var circleStrokeOpacity: Double? = null
    public var circleBlur: Double? = null
    public var circleSortKey: Double? = null

    override val geometry: TileflowGeometry
        get() = TileflowGeometry.Point(point)

    override val representative: TileflowCoordinate
        get() = point

    override fun move(geometry: TileflowGeometry): Boolean {
        point = (geometry as? TileflowGeometry.Point)?.coordinate ?: return false
        return true
    }

    override fun styleProperties(): Map<String, Any> =
        listOfNotNull(
                circleRadius?.let { "circle-radius" to it },
                circleColor?.let { "circle-color" to it },
                circleOpacity?.let { "circle-opacity" to it },
                circleStrokeColor?.let { "circle-stroke-color" to it },
                circleStrokeWidth?.let { "circle-stroke-width" to it },
                circleStrokeOpacity?.let { "circle-stroke-opacity" to it },
                circleBlur?.let { "circle-blur" to it },
                circleSortKey?.let { "circle-sort-key" to it },
            )
            .toMap()
}

/** A line through two or more points, as a MapLibre line. */
public class TileflowPolylineAnnotation
internal constructor(id: String, points: List<TileflowCoordinate>) : TileflowBaseAnnotation(id) {
    public var points: List<TileflowCoordinate> = points
        set(value) {
            validLine(value)
            field = value.toList()
        }

    public var lineColor: TileflowColor? = null
    public var lineWidth: Double? = null
    public var lineOpacity: Double? = null
    public var lineBlur: Double? = null
    public var lineSortKey: Double? = null

    override val geometry: TileflowGeometry
        get() = TileflowGeometry.LineString(points)

    /** The middle vertex. */
    override val representative: TileflowCoordinate
        get() = points[points.size / 2]

    override fun move(geometry: TileflowGeometry): Boolean {
        points = (geometry as? TileflowGeometry.LineString)?.coordinates ?: return false
        return true
    }

    override fun styleProperties(): Map<String, Any> =
        listOfNotNull(
                lineColor?.let { "line-color" to it },
                lineWidth?.let { "line-width" to it },
                lineOpacity?.let { "line-opacity" to it },
                lineBlur?.let { "line-blur" to it },
                lineSortKey?.let { "line-sort-key" to it },
            )
            .toMap()
}

/**
 * An area, as a MapLibre fill.
 *
 * @property points Rings, the outer one first and holes after it; the manager closes open rings.
 */
public class TileflowPolygonAnnotation
internal constructor(id: String, points: List<List<TileflowCoordinate>>) :
    TileflowBaseAnnotation(id) {
    public var points: List<List<TileflowCoordinate>> = points
        set(value) {
            validRings(value)
            field = value.map { it.toList() }
        }

    public var fillColor: TileflowColor? = null
    public var fillOpacity: Double? = null
    public var fillOutlineColor: TileflowColor? = null
    public var fillSortKey: Double? = null

    override val geometry: TileflowGeometry
        get() = TileflowGeometry.Polygon(points.map { ring -> closed(ring) })

    /** The average of the outer ring's vertices. */
    override val representative: TileflowCoordinate
        get() {
            val outer = points.first()
            val ring = if (outer.size > 1 && outer.first() == outer.last()) outer.dropLast(1) else outer
            return TileflowCoordinate(
                ring.sumOf { it.longitude } / ring.size,
                ring.sumOf { it.latitude } / ring.size,
            )
        }

    override fun move(geometry: TileflowGeometry): Boolean {
        points = (geometry as? TileflowGeometry.Polygon)?.rings ?: return false
        return true
    }

    override fun styleProperties(): Map<String, Any> =
        listOfNotNull(
                fillColor?.let { "fill-color" to it },
                fillOpacity?.let { "fill-opacity" to it },
                fillOutlineColor?.let { "fill-outline-color" to it },
                fillSortKey?.let { "fill-sort-key" to it },
            )
            .toMap()
}

/** What a manager creates a [TileflowPointAnnotation] from. */
public class TileflowPointAnnotationOptions {
    private var point: TileflowCoordinate? = null
    private var iconImage: String? = null
    private var iconImageBitmap: Bitmap? = null
    private var iconAnchor: TileflowIconAnchor? = null
    private var iconOffset: List<Double>? = null
    private var iconRotate: Double? = null
    private var iconSize: Double? = null
    private var iconColor: TileflowColor? = null
    private var iconOpacity: Double? = null
    private var symbolSortKey: Double? = null
    private var draggable = false
    private var accessibilityLabel: String? = null

    public fun withPoint(point: TileflowCoordinate): TileflowPointAnnotationOptions = apply {
        this.point = point
    }

    public fun withIconImage(name: String): TileflowPointAnnotationOptions = apply {
        iconImage = name
        iconImageBitmap = null
    }

    public fun withIconImage(bitmap: Bitmap): TileflowPointAnnotationOptions = apply {
        iconImageBitmap = bitmap
        iconImage = null
    }

    public fun withIconAnchor(anchor: TileflowIconAnchor): TileflowPointAnnotationOptions = apply {
        iconAnchor = anchor
    }

    public fun withIconOffset(offset: List<Double>): TileflowPointAnnotationOptions = apply {
        iconOffset = offset
    }

    public fun withIconRotate(degrees: Double): TileflowPointAnnotationOptions = apply {
        iconRotate = degrees
    }

    public fun withIconSize(size: Double): TileflowPointAnnotationOptions = apply { iconSize = size }

    public fun withIconColor(color: TileflowColor): TileflowPointAnnotationOptions = apply {
        iconColor = color
    }

    public fun withIconColor(@ColorInt color: Int): TileflowPointAnnotationOptions =
        withIconColor(TileflowColor.fromArgb(color))

    public fun withIconOpacity(opacity: Double): TileflowPointAnnotationOptions = apply {
        iconOpacity = opacity
    }

    public fun withSymbolSortKey(key: Double): TileflowPointAnnotationOptions = apply {
        symbolSortKey = key
    }

    public fun withDraggable(draggable: Boolean): TileflowPointAnnotationOptions = apply {
        this.draggable = draggable
    }

    public fun withAccessibilityLabel(label: String?): TileflowPointAnnotationOptions = apply {
        accessibilityLabel = label
    }

    internal fun build(id: String): TileflowPointAnnotation =
        TileflowPointAnnotation(id, point ?: invalidAnnotation()).also {
            it.iconImage = iconImage
            iconImageBitmap?.let { bitmap -> it.iconImageBitmap = bitmap }
            it.iconAnchor = iconAnchor
            it.iconOffset = iconOffset
            it.iconRotate = iconRotate
            it.iconSize = iconSize
            it.iconColor = iconColor
            it.iconOpacity = iconOpacity
            it.symbolSortKey = symbolSortKey
            it.isDraggable = draggable
            it.accessibilityLabel = accessibilityLabel
        }
}

/** What a manager creates a [TileflowCircleAnnotation] from. */
public class TileflowCircleAnnotationOptions {
    private var point: TileflowCoordinate? = null
    private var circleRadius: Double? = null
    private var circleColor: TileflowColor? = null
    private var circleOpacity: Double? = null
    private var circleStrokeColor: TileflowColor? = null
    private var circleStrokeWidth: Double? = null
    private var circleStrokeOpacity: Double? = null
    private var circleBlur: Double? = null
    private var circleSortKey: Double? = null
    private var draggable = false
    private var accessibilityLabel: String? = null

    public fun withPoint(point: TileflowCoordinate): TileflowCircleAnnotationOptions = apply {
        this.point = point
    }

    public fun withCircleRadius(radius: Double): TileflowCircleAnnotationOptions = apply {
        circleRadius = radius
    }

    public fun withCircleColor(color: TileflowColor): TileflowCircleAnnotationOptions = apply {
        circleColor = color
    }

    public fun withCircleColor(@ColorInt color: Int): TileflowCircleAnnotationOptions =
        withCircleColor(TileflowColor.fromArgb(color))

    public fun withCircleOpacity(opacity: Double): TileflowCircleAnnotationOptions = apply {
        circleOpacity = opacity
    }

    public fun withCircleStrokeColor(color: TileflowColor): TileflowCircleAnnotationOptions = apply {
        circleStrokeColor = color
    }

    public fun withCircleStrokeColor(@ColorInt color: Int): TileflowCircleAnnotationOptions =
        withCircleStrokeColor(TileflowColor.fromArgb(color))

    public fun withCircleStrokeWidth(width: Double): TileflowCircleAnnotationOptions = apply {
        circleStrokeWidth = width
    }

    public fun withCircleStrokeOpacity(opacity: Double): TileflowCircleAnnotationOptions = apply {
        circleStrokeOpacity = opacity
    }

    public fun withCircleBlur(blur: Double): TileflowCircleAnnotationOptions = apply {
        circleBlur = blur
    }

    public fun withCircleSortKey(key: Double): TileflowCircleAnnotationOptions = apply {
        circleSortKey = key
    }

    public fun withDraggable(draggable: Boolean): TileflowCircleAnnotationOptions = apply {
        this.draggable = draggable
    }

    public fun withAccessibilityLabel(label: String?): TileflowCircleAnnotationOptions = apply {
        accessibilityLabel = label
    }

    internal fun build(id: String): TileflowCircleAnnotation =
        TileflowCircleAnnotation(id, point ?: invalidAnnotation()).also {
            it.circleRadius = circleRadius
            it.circleColor = circleColor
            it.circleOpacity = circleOpacity
            it.circleStrokeColor = circleStrokeColor
            it.circleStrokeWidth = circleStrokeWidth
            it.circleStrokeOpacity = circleStrokeOpacity
            it.circleBlur = circleBlur
            it.circleSortKey = circleSortKey
            it.isDraggable = draggable
            it.accessibilityLabel = accessibilityLabel
        }
}

/** What a manager creates a [TileflowPolylineAnnotation] from. */
public class TileflowPolylineAnnotationOptions {
    private var points: List<TileflowCoordinate>? = null
    private var lineColor: TileflowColor? = null
    private var lineWidth: Double? = null
    private var lineOpacity: Double? = null
    private var lineBlur: Double? = null
    private var lineSortKey: Double? = null
    private var draggable = false
    private var accessibilityLabel: String? = null

    public fun withPoints(points: List<TileflowCoordinate>): TileflowPolylineAnnotationOptions =
        apply {
            this.points = points.toList()
        }

    public fun withLineColor(color: TileflowColor): TileflowPolylineAnnotationOptions = apply {
        lineColor = color
    }

    public fun withLineColor(@ColorInt color: Int): TileflowPolylineAnnotationOptions =
        withLineColor(TileflowColor.fromArgb(color))

    public fun withLineWidth(width: Double): TileflowPolylineAnnotationOptions = apply {
        lineWidth = width
    }

    public fun withLineOpacity(opacity: Double): TileflowPolylineAnnotationOptions = apply {
        lineOpacity = opacity
    }

    public fun withLineBlur(blur: Double): TileflowPolylineAnnotationOptions = apply {
        lineBlur = blur
    }

    public fun withLineSortKey(key: Double): TileflowPolylineAnnotationOptions = apply {
        lineSortKey = key
    }

    public fun withDraggable(draggable: Boolean): TileflowPolylineAnnotationOptions = apply {
        this.draggable = draggable
    }

    public fun withAccessibilityLabel(label: String?): TileflowPolylineAnnotationOptions = apply {
        accessibilityLabel = label
    }

    internal fun build(id: String): TileflowPolylineAnnotation =
        TileflowPolylineAnnotation(id, (points ?: invalidAnnotation()).also(::validLine)).also {
            it.lineColor = lineColor
            it.lineWidth = lineWidth
            it.lineOpacity = lineOpacity
            it.lineBlur = lineBlur
            it.lineSortKey = lineSortKey
            it.isDraggable = draggable
            it.accessibilityLabel = accessibilityLabel
        }
}

/** What a manager creates a [TileflowPolygonAnnotation] from. */
public class TileflowPolygonAnnotationOptions {
    private var points: List<List<TileflowCoordinate>>? = null
    private var fillColor: TileflowColor? = null
    private var fillOpacity: Double? = null
    private var fillOutlineColor: TileflowColor? = null
    private var fillSortKey: Double? = null
    private var draggable = false
    private var accessibilityLabel: String? = null

    /** Rings, the outer one first and holes after it. */
    public fun withPoints(points: List<List<TileflowCoordinate>>): TileflowPolygonAnnotationOptions =
        apply {
            this.points = points.map { it.toList() }
        }

    public fun withFillColor(color: TileflowColor): TileflowPolygonAnnotationOptions = apply {
        fillColor = color
    }

    public fun withFillColor(@ColorInt color: Int): TileflowPolygonAnnotationOptions =
        withFillColor(TileflowColor.fromArgb(color))

    public fun withFillOpacity(opacity: Double): TileflowPolygonAnnotationOptions = apply {
        fillOpacity = opacity
    }

    public fun withFillOutlineColor(color: TileflowColor): TileflowPolygonAnnotationOptions = apply {
        fillOutlineColor = color
    }

    public fun withFillOutlineColor(@ColorInt color: Int): TileflowPolygonAnnotationOptions =
        withFillOutlineColor(TileflowColor.fromArgb(color))

    public fun withFillSortKey(key: Double): TileflowPolygonAnnotationOptions = apply {
        fillSortKey = key
    }

    public fun withDraggable(draggable: Boolean): TileflowPolygonAnnotationOptions = apply {
        this.draggable = draggable
    }

    public fun withAccessibilityLabel(label: String?): TileflowPolygonAnnotationOptions = apply {
        accessibilityLabel = label
    }

    internal fun build(id: String): TileflowPolygonAnnotation =
        TileflowPolygonAnnotation(id, (points ?: invalidAnnotation()).also(::validRings)).also {
            it.fillColor = fillColor
            it.fillOpacity = fillOpacity
            it.fillOutlineColor = fillOutlineColor
            it.fillSortKey = fillSortKey
            it.isDraggable = draggable
            it.accessibilityLabel = accessibilityLabel
        }
}

/** Answers taps on a manager's annotations; return true to stop the tap there. */
public fun interface TileflowAnnotationClickListener<T : TileflowBaseAnnotation> {
    public fun onAnnotationClick(annotation: T): Boolean
}

/** Answers long presses on a manager's annotations; return true to stop the press there. */
public fun interface TileflowAnnotationLongClickListener<T : TileflowBaseAnnotation> {
    public fun onAnnotationLongClick(annotation: T): Boolean
}

/**
 * Follows drags of a manager's draggable annotations. The annotation already holds the geometry
 * the drag moved it to.
 */
public interface TileflowAnnotationDragListener<T : TileflowBaseAnnotation> {
    public fun onAnnotationDragStarted(annotation: T) {}

    public fun onAnnotationDrag(annotation: T) {}

    public fun onAnnotationDragFinished(annotation: T) {}
}

/**
 * How an annotation manager is created.
 *
 * @property id The identifier of the manager's source and layer in the application's runtime
 *   style; null generates one.
 * @property slot Where the manager's layer lies among the map's own layers; null lies above them.
 * @property position Where the layer lies relative to the application's other layers.
 */
public data class TileflowAnnotationConfig(
    val id: String? = null,
    val slot: TileflowLayerSlot? = null,
    val position: TileflowLayerPosition = TileflowLayerPosition.Default,
)

internal fun invalidAnnotation(): Nothing =
    throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)

internal fun validCoordinate(coordinate: TileflowCoordinate) {
    if (coordinate.longitude !in -180.0..180.0 || coordinate.latitude !in -90.0..90.0)
        invalidAnnotation()
}

private fun validLine(points: List<TileflowCoordinate>) {
    if (points.size < 2) invalidAnnotation()
    points.forEach(::validCoordinate)
}

private fun validRings(rings: List<List<TileflowCoordinate>>) {
    if (rings.isEmpty() || rings.any { closed(it).size < 4 }) invalidAnnotation()
    rings.forEach { it.forEach(::validCoordinate) }
}

private fun closed(ring: List<TileflowCoordinate>): List<TileflowCoordinate> =
    if (ring.isNotEmpty() && ring.first() != ring.last()) ring + ring.first() else ring

/** One name per bitmap, so annotations that share a bitmap share one map image. */
internal fun bitmapImageName(bitmap: Bitmap): String =
    "tileflow-annotation-${Integer.toHexString(System.identityHashCode(bitmap))}"

/** Annotation identifiers of the hits a tap or long press reports, topmost first. */
internal fun annotationHits(result: JSONObject): List<Pair<String, String>> {
    val hits = result.optJSONArray("annotations") ?: JSONArray()
    return (0 until hits.length()).mapNotNull { index ->
        val hit = hits.optJSONObject(index) ?: return@mapNotNull null
        val layer = hit.optString("layer")
        val id = hit.optString("id")
        if (layer.isEmpty() || id.isEmpty()) null else layer to id
    }
}
