package dev.tileflow.example

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.GradientDrawable
import android.widget.TextView
import dev.tileflow.sdk.TileflowAnnotationConfig
import dev.tileflow.sdk.TileflowAnnotationDragListener
import dev.tileflow.sdk.TileflowAnnotations
import dev.tileflow.sdk.TileflowCircleAnnotationOptions
import dev.tileflow.sdk.TileflowCoordinate
import dev.tileflow.sdk.TileflowIconAnchor
import dev.tileflow.sdk.TileflowLayerSlot
import dev.tileflow.sdk.TileflowPointAnnotation
import dev.tileflow.sdk.TileflowPointAnnotationOptions
import dev.tileflow.sdk.TileflowPolygonAnnotationOptions
import dev.tileflow.sdk.TileflowViewAnnotationAnchor
import dev.tileflow.sdk.TileflowViewAnnotationAnchorConfig
import dev.tileflow.sdk.TileflowViewAnnotationManager
import dev.tileflow.sdk.TileflowViewAnnotationOptions

/**
 * Draggable pins with a picture drawn in code, a circle and an area. Tapping a pin shows the
 * application's callout above it, anchored to the pin by a view annotation. Pins have accessibility
 * labels, so TalkBack reads them in order and opens their callout with a double tap.
 */
internal class AnnotationExample(
    private val context: Context,
    private val annotations: TileflowAnnotations,
    private val views: TileflowViewAnnotationManager,
    /** How many units of the view annotation API make a dp: 1 for dp, the density for pixels. */
    private val unitsPerDp: Float,
    private val report: (String) -> Unit,
) {
    private val density = context.resources.displayMetrics.density
    private val callout =
        TextView(context).apply {
            setPadding(dp(12), dp(8), dp(12), dp(8))
            setTextColor(android.graphics.Color.BLACK)
            background =
                GradientDrawable().apply {
                    setColor(android.graphics.Color.WHITE)
                    cornerRadius = 12 * density
                    setStroke(dp(1), 0x33000000)
                }
            elevation = 4 * density
        }
    private var calloutPin: String? = null

    private fun dp(value: Int) = (value * density).toInt()

    /** Shows the annotations once; later calls only report that they are there. */
    fun show() {
        if (annotations.annotationManagers.isNotEmpty()) {
            report("Tap a pin, or drag it")
            return
        }
        val area =
            annotations.createPolygonAnnotationManager(
                TileflowAnnotationConfig(slot = TileflowLayerSlot.BELOW_LABELS)
            )
        area.create(
            TileflowPolygonAnnotationOptions()
                .withPoints(
                    listOf(
                        listOf(
                            TileflowCoordinate(-3.6890, 40.4200),
                            TileflowCoordinate(-3.6765, 40.4200),
                            TileflowCoordinate(-3.6765, 40.4080),
                            TileflowCoordinate(-3.6890, 40.4080),
                        )
                    )
                )
                .withFillColor(0x5534A853)
                .withFillOutlineColor(0xFF1E7E34.toInt())
                .withAccessibilityLabel("Retiro Park")
        )
        val spots = annotations.createCircleAnnotationManager()
        spots.create(
            TileflowCircleAnnotationOptions()
                .withPoint(TileflowCoordinate(-3.6921, 40.4138))
                .withCircleRadius(10.0)
                .withCircleColor(0xFF1A73E8.toInt())
                .withCircleStrokeColor(android.graphics.Color.WHITE)
                .withCircleStrokeWidth(3.0)
                .withAccessibilityLabel("Prado Museum")
        )
        val pins =
            annotations.createPointAnnotationManager(
                TileflowAnnotationConfig(slot = TileflowLayerSlot.ABOVE_LABELS)
            )
        pins.iconAllowOverlap = true
        val image = pinImage()
        val places =
            listOf(
                "Puerta del Sol" to TileflowCoordinate(-3.7038, 40.4168),
                "Plaza Mayor" to TileflowCoordinate(-3.7074, 40.4155),
                "Royal Palace" to TileflowCoordinate(-3.7143, 40.4179),
            )
        pins.create(
            places.map { (name, point) ->
                TileflowPointAnnotationOptions()
                    .withPoint(point)
                    .withIconImage(image)
                    .withIconAnchor(TileflowIconAnchor.BOTTOM)
                    .withDraggable(true)
                    .withAccessibilityLabel(name)
            }
        )
        pins.addClickListener { pin ->
            showCallout(pin)
            true
        }
        pins.addDragListener(
            object : TileflowAnnotationDragListener<TileflowPointAnnotation> {
                override fun onAnnotationDrag(annotation: TileflowPointAnnotation) {
                    if (calloutPin == annotation.id) moveCallout(annotation)
                }

                override fun onAnnotationDragFinished(annotation: TileflowPointAnnotation) {
                    if (calloutPin == annotation.id) moveCallout(annotation)
                    report("Moved ${annotation.accessibilityLabel}")
                }
            }
        )
        report("Tap a pin, or drag it")
    }

    /** Hides the callout, for example when the map is tapped elsewhere. */
    fun hideCallout() {
        calloutPin = null
        views.removeViewAnnotation(callout)
    }

    private fun calloutOptions(pin: TileflowPointAnnotation) =
        TileflowViewAnnotationOptions(
            pin.point,
            // Above the pin's picture, or below its point where there is no room above.
            variableAnchors =
                listOf(
                    TileflowViewAnnotationAnchorConfig(
                        TileflowViewAnnotationAnchor.BOTTOM,
                        offsetY = PIN_HEIGHT * unitsPerDp.toDouble(),
                    ),
                    TileflowViewAnnotationAnchorConfig(TileflowViewAnnotationAnchor.TOP),
                ),
            selected = true,
        )

    private fun showCallout(pin: TileflowPointAnnotation) {
        callout.text = pin.accessibilityLabel
        callout.contentDescription = "${pin.accessibilityLabel}, details"
        calloutPin = pin.id
        if (!views.updateViewAnnotation(callout, calloutOptions(pin)))
            views.addViewAnnotation(callout, calloutOptions(pin))
    }

    private fun moveCallout(pin: TileflowPointAnnotation) {
        views.updateViewAnnotation(callout, calloutOptions(pin))
    }

    /** A map pin, drawn at the screen's density. */
    private fun pinImage(): Bitmap {
        val width = dp(PIN_WIDTH)
        val height = dp(PIN_HEIGHT)
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        bitmap.density = context.resources.displayMetrics.densityDpi
        val canvas = Canvas(bitmap)
        val radius = width / 2f
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFE9573F.toInt() }
        val path =
            Path().apply {
                addCircle(radius, radius, radius, Path.Direction.CW)
                moveTo(radius * 0.25f, radius * 1.5f)
                lineTo(radius, height.toFloat())
                lineTo(radius * 1.75f, radius * 1.5f)
                close()
            }
        canvas.drawPath(path, paint)
        paint.color = android.graphics.Color.WHITE
        canvas.drawCircle(radius, radius, radius * 0.4f, paint)
        return bitmap
    }

    private companion object {
        const val PIN_WIDTH = 28
        const val PIN_HEIGHT = 40
    }
}
