package dev.tileflow.sdk

import android.app.Activity
import android.graphics.Bitmap
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import dev.tileflow.sdk.model.MapContract
import dev.tileflow.sdk.model.EventSubscriptions
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Annotations: view annotation placement, what managers send to the runtime style, how taps and
 * drags reach listeners, positions matched by revision and the accessibility order.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AnnotationsTest {
    private val madrid = TileflowCoordinate(-3.7, 40.42)

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private fun map(block: (Activity, TileflowMapView) -> Unit) {
        val activity = Robolectric.buildActivity(Activity::class.java).setup().get()
        val view = TileflowMapView(activity)
        activity.setContentView(view, ViewGroup.LayoutParams(400, 800))
        idle()
        try {
            block(activity, view)
        } finally {
            view.destroy()
        }
    }

    private fun input(
        key: String,
        x: Float?,
        anchors: List<TileflowViewAnnotationAnchor> = listOf(TileflowViewAnnotationAnchor.CENTER),
        priority: Int = 0,
        selected: Boolean = false,
        allowOverlap: Boolean = false,
        order: Long = 0,
    ) =
        PlacementInput(
            key,
            x,
            x?.let { 100f },
            40f,
            20f,
            anchors.map { TileflowViewAnnotationAnchorConfig(it) },
            allowOverlap,
            priority,
            selected,
            order,
        )

    @Test
    fun anchorsPutThatPointOfTheViewOnTheCoordinate() {
        val expected =
            mapOf(
                TileflowViewAnnotationAnchor.CENTER to (80f to 90f),
                TileflowViewAnnotationAnchor.TOP to (80f to 100f),
                TileflowViewAnnotationAnchor.BOTTOM to (80f to 80f),
                TileflowViewAnnotationAnchor.LEFT to (100f to 90f),
                TileflowViewAnnotationAnchor.RIGHT to (60f to 90f),
                TileflowViewAnnotationAnchor.TOP_LEFT to (100f to 100f),
                TileflowViewAnnotationAnchor.TOP_RIGHT to (60f to 100f),
                TileflowViewAnnotationAnchor.BOTTOM_LEFT to (100f to 80f),
                TileflowViewAnnotationAnchor.BOTTOM_RIGHT to (60f to 80f),
            )
        for ((anchor, frame) in expected)
            assertEquals(
                anchor.name,
                frame,
                anchoredFrame(100f, 100f, 40f, 20f, TileflowViewAnnotationAnchorConfig(anchor)),
            )
        // A positive vertical offset moves the view up; offsets scale to pixels.
        assertEquals(
            90f to 70f,
            anchoredFrame(
                100f,
                100f,
                40f,
                20f,
                TileflowViewAnnotationAnchorConfig(TileflowViewAnnotationAnchor.BOTTOM, 5.0, 5.0),
                scale = 2f,
            ),
        )
    }

    @Test
    fun collisionsHideLaterAndLowerAnnotationsUnlessAnotherAnchorFits() {
        val placed =
            placeViewAnnotations(
                listOf(
                    input("first", 100f, order = 0),
                    input("important", 110f, priority = 5, order = 1),
                    input("chosen", 300f, selected = true, order = 2),
                    input("overlapping", 105f, allowOverlap = true, order = 3),
                    input(
                        "moves",
                        140f,
                        anchors =
                            listOf(
                                TileflowViewAnnotationAnchor.CENTER,
                                TileflowViewAnnotationAnchor.LEFT,
                            ),
                        order = 4,
                    ),
                    input("hidden", null, order = 5),
                )
            )
        assertNull(placed["first"])
        assertEquals(Placement(90f, 90f, 0), placed["important"])
        assertEquals(Placement(280f, 90f, 0), placed["chosen"])
        assertEquals(Placement(85f, 90f, 0), placed["overlapping"])
        assertEquals(Placement(140f, 90f, 1), placed["moves"])
        assertNull(placed["hidden"])
        assertTrue(placed.containsKey("hidden"))
    }

    @Test
    fun managersDrawInTheirOwnSourceAndLayerAndSendWhatChanged() = map { _, view ->
        val manager =
            view.annotations.createPointAnnotationManager(
                TileflowAnnotationConfig(id = "pins", slot = TileflowLayerSlot.ABOVE_LABELS)
            )
        manager.iconAllowOverlap = true
        val bitmap = Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
        val pins =
            manager.create(
                (0 until 10).map { index ->
                    TileflowPointAnnotationOptions()
                        .withPoint(TileflowCoordinate(index.toDouble(), 0.0))
                        .withIconImage(bitmap)
                        .withIconAnchor(TileflowIconAnchor.BOTTOM)
                        .withDraggable(index == 0)
                }
            )
        idle()
        val source = view.runtimeStyle.sources.single { it.id == "pins" }
        assertEquals("id", source.spec.getString("promoteId"))
        val base = source.geoJSON!!.base as GeoJSONLog.Base.Bytes
        val features = JSONObject(String(base.bytes)).getJSONArray("features")
        assertEquals(10, features.length())
        val first = features.getJSONObject(0).getJSONObject("properties")
        assertEquals(pins[0].id, first.getString("id"))
        assertTrue(first.getBoolean("draggable"))
        assertEquals("bottom", first.getString("icon-anchor"))
        val layer = view.runtimeStyle.layers.single()
        assertEquals("pins", layer.id)
        assertEquals(TileflowLayerSlot.ABOVE_LABELS, layer.slot)
        val layout = layer.json.getJSONObject("layout")
        assertEquals(
            "[\"coalesce\",[\"get\",\"icon-anchor\"],\"center\"]",
            layout.getJSONArray("icon-anchor").toString(),
        )
        assertEquals("[\"get\",\"icon-image\"]", layout.getJSONArray("icon-image").toString())
        assertTrue(layout.getBoolean("icon-allow-overlap"))
        assertFalse(layer.json.has("paint"))
        assertEquals(listOf(bitmapImageName(bitmap)), view.images.map { it.name })

        // One annotation changed: one feature travels; most changed: the data is replaced.
        pins[3].iconSize = 2.0
        manager.update(pins[3])
        idle()
        assertEquals(1, source.geoJSON!!.updates.size)
        assertTrue(view.runtimeStyle.layers.single().json.getJSONObject("layout").has("icon-size"))
        pins.forEach { it.iconRotate = 45.0 }
        manager.update(pins)
        idle()
        assertEquals(0, source.geoJSON!!.updates.size)
        manager.delete(pins[9])
        idle()
        assertEquals(listOf("${pins[9].id}"), source.geoJSON!!.updates.single().remove)

        // Removing the manager takes its layer, source and images off the map.
        view.annotations.removeAnnotationManager(manager)
        idle()
        assertTrue(view.runtimeStyle.layers.isEmpty())
        assertFalse(view.sourceExists("pins"))
        assertTrue(view.images.isEmpty())
    }

    @Test
    fun aListenerThatTakesATapStopsItThere() = map { _, view ->
        val pins = view.annotations.createPointAnnotationManager(TileflowAnnotationConfig("pins"))
        val circles =
            view.annotations.createCircleAnnotationManager(TileflowAnnotationConfig("circles"))
        val pin = pins.create(TileflowPointAnnotationOptions().withPoint(madrid))
        val circle = circles.create(TileflowCircleAnnotationOptions().withPoint(madrid))
        val calls = mutableListOf<String>()
        pins.addClickListener {
            calls += "pin ${it.id == pin.id}"
            false
        }
        circles.addClickListener {
            calls += "circle ${it.id == circle.id}"
            true
        }
        circles.addLongClickListener {
            calls += "held"
            false
        }
        val hits =
            annotationHits(
                JSONObject()
                    .put(
                        "annotations",
                        JSONArray()
                            .put(JSONObject().put("layer", "pins").put("id", pin.id))
                            .put(JSONObject().put("layer", "circles").put("id", circle.id))
                            .put(JSONObject().put("layer", "other").put("id", "x")),
                    )
            )
        assertTrue(view.annotations.dispatchPress(hits, long = false))
        assertFalse(view.annotations.dispatchPress(hits, long = true))
        assertFalse(view.annotations.dispatchPress(listOf("pins" to "unknown"), long = false))
        assertEquals(listOf("pin true", "circle true", "held"), calls)
        assertEquals(listOf("pins", "circles"), view.annotations.layerIds)
    }

    @Test
    fun annotationManagersSubscribeToPressesAndDrags() = map { _, view ->
        val subscriptions = view.javaClass.getDeclaredField("subscriptions").also {
            it.isAccessible = true
        }
        view.annotations.createPolygonAnnotationManager()
        val events = (subscriptions.get(view) as EventSubscriptions).events.keys
        assertTrue(events.containsAll(setOf(MapContract.Event.TAP, MapContract.Event.LONG_PRESS, MapContract.Event.ANNOTATION_DRAGGED)))
    }

    @Test
    fun dragsMoveTheAnnotationAndAreKeptWhenTheyEnd() = map { _, view ->
        val lines =
            view.annotations.createPolylineAnnotationManager(TileflowAnnotationConfig("lines"))
        val line =
            lines.create(
                TileflowPolylineAnnotationOptions()
                    .withPoints(listOf(madrid, TileflowCoordinate(-3.6, 40.5)))
                    .withDraggable(true)
            )
        idle()
        val phases = mutableListOf<String>()
        lines.addDragListener(
            object : TileflowAnnotationDragListener<TileflowPolylineAnnotation> {
                override fun onAnnotationDragStarted(annotation: TileflowPolylineAnnotation) {
                    phases += "started"
                }

                override fun onAnnotationDrag(annotation: TileflowPolylineAnnotation) {
                    phases += "moved"
                }

                override fun onAnnotationDragFinished(annotation: TileflowPolylineAnnotation) {
                    phases += "ended ${annotation.points.first().longitude}"
                }
            }
        )
        fun drag(phase: String, longitude: Double) =
            view.annotations.dispatchDrag(
                JSONObject()
                    .put("phase", phase)
                    .put("layer", "lines")
                    .put("id", line.id)
                    .put(
                        "geometry",
                        JSONObject()
                            .put("type", "LineString")
                            .put("coordinates", JSONArray("[[$longitude,40],[1,41]]")),
                    )
            )
        drag("started", 1.0)
        drag("moved", 2.0)
        idle()
        val source = view.runtimeStyle.sources.single()
        assertEquals(0, source.geoJSON!!.updates.size)
        drag("ended", 3.0)
        idle()
        assertEquals(listOf("started", "moved", "ended 3.0"), phases)
        // The only feature changed, so the source's data is replaced with the dropped line.
        val base = source.geoJSON!!.base as GeoJSONLog.Base.Bytes
        val coordinates =
            JSONObject(String(base.bytes))
                .getJSONArray("features")
                .getJSONObject(0)
                .getJSONObject("geometry")
                .getJSONArray("coordinates")
        assertEquals(3.0, coordinates.getJSONArray(0).getDouble(0), 0.0)
    }

    @Test
    fun accessibilityReadsAnnotationsInReadingOrderAndActivatesThem() = map { activity, view ->
        val overlay = view.annotationOverlay
        overlay.forcesAccessibilityTracking = true
        val pins = view.annotations.createPointAnnotationManager(TileflowAnnotationConfig("pins"))
        val lower =
            pins.create(
                TileflowPointAnnotationOptions().withPoint(madrid).withAccessibilityLabel("Lower")
            )
        val upper =
            pins.create(
                TileflowPointAnnotationOptions().withPoint(madrid).withAccessibilityLabel("Upper")
            )
        pins.create(TileflowPointAnnotationOptions().withPoint(madrid))
        val callout = View(activity).also { it.contentDescription = "Callout" }
        view.viewAnnotationManager.addViewAnnotation(
            callout,
            TileflowViewAnnotationOptions(madrid, width = 40f, height = 20f),
        )
        val pressed = mutableListOf<String>()
        pins.addClickListener {
            pressed += "tap ${it.accessibilityLabel}"
            true
        }
        pins.addLongClickListener {
            pressed += "hold ${it.accessibilityLabel}"
            true
        }
        idle()
        overlay.positions[callout] = floatArrayOf(100f, 200f)
        overlay.positions["pins" to lower.id] = floatArrayOf(50f, 300f)
        overlay.positions["pins" to upper.id] = floatArrayOf(300f, 40f)
        overlay.measure(
            View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(800, View.MeasureSpec.EXACTLY),
        )
        overlay.layout(0, 0, 400, 800)
        overlay.applyPositions()
        val order = ArrayList<View>().also(overlay::addChildrenForAccessibility)
        assertEquals(
            listOf("Upper", "Callout", "Lower"),
            order.map { it.contentDescription.toString() },
        )
        val target = overlay.accessibilityTarget("pins", lower.id)!!
        val info = target.createAccessibilityNodeInfo()
        assertTrue(info.isClickable)
        assertTrue(info.isLongClickable)
        assertTrue(target.performAccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, null))
        assertTrue(target.performAccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, null))
        assertEquals(listOf("tap Lower", "hold Lower"), pressed)
        overlay.forcesAccessibilityTracking = false
        assertNull(overlay.accessibilityTarget("pins", lower.id))
    }

    @Test
    fun aControllerOwnsAnnotationsAcrossTheMapsItAttachesTo() = map { activity, view ->
        val controller = TileflowMapController()
        val manager = controller.annotations.createCircleAnnotationManager(TileflowAnnotationConfig("dots"))
        manager.create(TileflowCircleAnnotationOptions().withPoint(madrid).withCircleRadius(8.0))
        val callout = View(activity)
        controller.viewAnnotationManager.addViewAnnotation(callout, TileflowViewAnnotationOptions(madrid, width = 10f))
        controller.attach(view)
        idle()
        assertTrue(view.annotations === controller.annotations)
        assertTrue(view.sourceExists("dots"))
        assertTrue(callout.parent === view.annotationOverlay)
        // Sizes through the controller are in dp.
        assertEquals((10 * view.resources.displayMetrics.density).toInt(), callout.layoutParams.width)
        controller.detach(view)
        idle()
        assertFalse(view.sourceExists("dots"))
        assertNull(callout.parent)
        assertTrue(view.annotations !== controller.annotations)
    }
}
