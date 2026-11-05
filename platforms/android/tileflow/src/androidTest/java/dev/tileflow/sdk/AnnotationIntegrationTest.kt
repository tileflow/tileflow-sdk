package dev.tileflow.sdk

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Annotations in MapLibre: taps and drags reach annotation listeners, native
 * views follow a fast pan, and accessibility services read annotations in order. Run with the
 * online fixture server and `adb reverse tcp:18645 tcp:<port>`. The test prints the delay between a
 * rendered frame and the views it moves, for the device it runs on.
 */
@RunWith(AndroidJUnit4::class)
public class AnnotationIntegrationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val centre = TileflowCoordinate(-3.7, 40.42)

    private fun show(): SceneHostActivity {
        val intent =
            Intent(instrumentation.context, SceneHostActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra("map", "appearance")
        val activity = instrumentation.startActivitySync(intent) as SceneHostActivity
        assertTrue("The map did not load.", activity.loaded.await(30, TimeUnit.SECONDS))
        return activity
    }

    private fun <T> onMap(activity: SceneHostActivity, block: suspend (TileflowMapView) -> T): T =
        try {
            runBlocking { withContext(Dispatchers.Main) { block(activity.map) } }
        } finally {
            activity.finish()
        }

    private suspend fun until(label: String, condition: suspend () -> Boolean) {
        withTimeout(30_000) { while (!condition()) delay(50) }
        println("Tileflow: $label")
    }

    /** A person's finger on the map: down, [steps] moves of [dx], [dy] a frame apart, and up. */
    private suspend fun touch(
        map: TileflowMapView,
        x: Float,
        y: Float,
        dx: Float = 0f,
        dy: Float = 0f,
        steps: Int = 0,
    ) {
        val down = SystemClock.uptimeMillis()
        fun send(action: Int, atX: Float, atY: Float) {
            val event = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, atX, atY, 0)
            map.dispatchTouchEvent(event)
            event.recycle()
        }
        send(MotionEvent.ACTION_DOWN, x, y)
        for (step in 1..steps) {
            delay(16)
            send(MotionEvent.ACTION_MOVE, x + dx * step, y + dy * step)
        }
        delay(16)
        send(MotionEvent.ACTION_UP, x + dx * steps, y + dy * steps)
    }

    @Test
    public fun aTapOnAnAnnotationReachesItsListenerAndADragMovesIt() {
        val activity = show()
        onMap(activity) { map ->
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 14.0))
            val circles =
                map.annotations.createCircleAnnotationManager(TileflowAnnotationConfig("spots"))
            val spot =
                circles.create(
                    TileflowCircleAnnotationOptions()
                        .withPoint(centre)
                        .withCircleRadius(24.0)
                        .withCircleColor(Color.RED)
                        .withDraggable(true)
                )
            val taps = mutableListOf<String>()
            circles.addClickListener {
                taps += it.id
                true
            }
            val dropped = mutableListOf<TileflowCoordinate>()
            circles.addDragListener(
                object : TileflowAnnotationDragListener<TileflowCircleAnnotation> {
                    override fun onAnnotationDragFinished(annotation: TileflowCircleAnnotation) {
                        dropped += annotation.point
                    }
                }
            )
            until("the annotation is drawn") {
                runCatching {
                        map.queryRenderedFeatures(
                            options = TileflowRenderedQueryOptions(layerIds = listOf("spots"))
                        )
                    }
                    .getOrNull()
                    ?.isNotEmpty() == true
            }
            val point = map.project(centre)
            val appTaps = { activity.events.count { it is TileflowMapEvent.Tap } }
            val before = appTaps()
            touch(map, point.x, point.y)
            until("the listener took the tap") { taps.isNotEmpty() }
            assertEquals(listOf(spot.id), taps)
            delay(300)
            assertEquals("The application did not receive the taken tap.", before, appTaps())
            val held = mutableListOf<String>()
            circles.addLongClickListener {
                held += it.id
                true
            }
            val down = SystemClock.uptimeMillis()
            val press =
                MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, point.x, point.y, 0)
            map.dispatchTouchEvent(press)
            press.recycle()
            delay((android.view.ViewConfiguration.getLongPressTimeout() + 200).toLong())
            val release =
                MotionEvent.obtain(
                    down,
                    SystemClock.uptimeMillis(),
                    MotionEvent.ACTION_UP,
                    point.x,
                    point.y,
                    0,
                )
            map.dispatchTouchEvent(release)
            release.recycle()
            until("the annotation owns the long press") { held == listOf(spot.id) }
            // A tap beside the annotation reaches the application.
            touch(map, point.x + map.width / 4f, point.y + map.height / 4f)
            until("the application received a tap") { appTaps() > before }

            // A pan that starts on the draggable annotation moves it, not the map.
            val camera = map.currentCamera!!
            val dragX = minOf(150f, map.width / 4f)
            val dragY = minOf(100f, map.height / 4f)
            touch(map, point.x, point.y, dx = dragX / 10, dy = dragY / 10, steps = 10)
            until("the drag ended") { dropped.isNotEmpty() }
            val target = map.unproject(TileflowPoint(point.x + dragX, point.y + dragY))
            assertEquals(target.longitude, dropped.single().longitude, 1e-4)
            assertEquals(target.latitude, dropped.single().latitude, 1e-4)
            assertEquals(camera, map.currentCamera)
            // Source queries read the renderer's worker tiles. The drag callback is immediate,
            // while its final GeoJSON update can still be in flight to that worker.
            var moved: TileflowGeometry.Point? = null
            until("the source has processed the released geometry") {
                moved =
                    map.querySourceFeatures("spots").singleOrNull()?.feature?.geometry
                        as? TileflowGeometry.Point
                moved?.coordinate?.let {
                    abs(target.longitude - it.longitude) < 1e-4 &&
                        abs(target.latitude - it.latitude) < 1e-4
                } == true
            }
            assertEquals(target.longitude, moved!!.coordinate.longitude, 1e-4)
            assertEquals(target.latitude, moved!!.coordinate.latitude, 1e-4)

            val loads = activity.loads.size
            map.reload()
            until("the replacement renderer is ready") { activity.loads.size > loads }
            var restored: TileflowCoordinate? = null
            until("the replacement renderer has a feature") {
                restored =
                    (map.querySourceFeatures("spots").singleOrNull()?.feature?.geometry
                            as? TileflowGeometry.Point)
                        ?.coordinate
                restored != null
            }
            assertEquals(
                "Replayed drag longitude",
                dropped.single().longitude,
                restored!!.longitude,
                1e-4,
            )
            assertEquals(
                "Replayed drag latitude",
                dropped.single().latitude,
                restored!!.latitude,
                1e-4,
            )
            val at = map.project(restored!!)
            val last = TileflowPoint(at.x + 30, at.y + 24)
            val released = dropped.size
            val expected = map.unproject(last)
            val dragStarted = SystemClock.uptimeMillis()
            fun move(action: Int, x: Float, y: Float) {
                MotionEvent.obtain(down, down, action, x, y, 0).also {
                    map.dispatchTouchEvent(it)
                    it.recycle()
                }
            }
            move(MotionEvent.ACTION_DOWN, at.x, at.y)
            move(MotionEvent.ACTION_MOVE, at.x + 14, at.y + 14)
            move(MotionEvent.ACTION_MOVE, last.x, last.y)
            // Replace the renderer before a display frame or a release event can run.
            val nextLoad = activity.loads.size
            map.reload()
            until("an unfinished drag is restored") { activity.loads.size > nextLoad }
            val actual =
                map.querySourceFeatures("spots").single().feature.geometry
                    as TileflowGeometry.Point
            assertEquals(expected.longitude, actual.coordinate.longitude, 1e-4)
            assertEquals(expected.latitude, actual.coordinate.latitude, 1e-4)
            assertEquals(
                "Renderer retirement does not synthesize a release",
                released,
                dropped.size,
            )
        }
    }

    @Test
    public fun twoHundredViewsFollowAFastPan() {
        val performanceMode =
            InstrumentationRegistry.getArguments()
                .getString("tileflowAnnotationPerformance", "strict")
        require(performanceMode == "strict" || performanceMode == "report") {
            "tileflowAnnotationPerformance must be strict or report"
        }
        val activity = show()
        onMap(activity) { map ->
            until("the map activity owns the screen before compositor capture") {
                activity.hasWindowFocus()
            }
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 13.0))
            val bounds = map.visibleBounds()
            // The two references straddle the center. At least one stays fully visible at both
            // ends of a pan, even if the compositor captures the display later than requested.
            val references =
                listOf(
                    PanReference(105, Color.rgb(19, 253, 139), "#f300f7"),
                    PanReference(114, Color.rgb(253, 151, 19), "#04dbf3"),
                )
            val views =
                (0 until 200).map { index ->
                    val coordinate =
                        TileflowCoordinate(
                            bounds.west + (bounds.east - bounds.west) * ((index % 20) + 0.5) / 20,
                            bounds.south + (bounds.north - bounds.south) * ((index / 20) + 0.5) / 10,
                        )
                    val view =
                        View(activity).apply {
                            setBackgroundColor(
                                references.firstOrNull { it.index == index }?.viewColor
                                    ?: Color.BLUE
                            )
                        }
                    map.viewAnnotationManager.addViewAnnotation(
                        view,
                        TileflowViewAnnotationOptions(
                            coordinate,
                            allowOverlap = true,
                            width = 12f,
                            height = 12f,
                        ),
                    )
                    view to coordinate
                }
            until("the views are placed") { views.all { it.first.visibility == View.VISIBLE } }
            val engine = map.readyEngine as dev.tileflow.sdk.engine.NativeMapEngine
            val projection = requireNotNull(engine.map).projection
            for (ref in references) {
                val coordinate = views[ref.index].second
                map.addSource(
                    TileflowGeoJSONSource(
                        ref.id,
                        TileflowGeoJSONData.Features(
                            listOf(TileflowFeature("1", TileflowGeometry.Point(coordinate)))
                        ),
                    )
                )
                map.addLayer(
                    TileflowCircleLayer(ref.id, ref.id)
                        .circleColor(TileflowColor.fromHex(ref.circleHex))
                        .circleRadius(10.0)
                )
            }
            until("MapLibre draws both reference points") {
                map.queryRenderedFeatures(
                        options = TileflowRenderedQueryOptions(references.map { it.id })
                    )
                    .size >= 2
            }
            val physical = mutableListOf<Pair<Int, Double>>()
            val directions = mutableSetOf<Boolean>()
            var movingCaptures = 0
            val origin = IntArray(2).also(map::getLocationOnScreen)
            val referenceCoordinate = views[references.first().index].second
            val row =
                projection
                    .toScreenLocation(
                        org.maplibre.android.geometry.LatLng(
                            referenceCoordinate.latitude,
                            referenceCoordinate.longitude,
                        )
                    )
                    .y
                    .toInt() + origin[1]
            val locations = DoubleArray(views.size * 2)
            views.forEachIndexed { i, (_, coordinate) ->
                locations[2 * i] = coordinate.latitude
                locations[2 * i + 1] = coordinate.longitude
            }
            val samples = mutableListOf<Int>()
            val finishedFrames = ArrayDeque<DoubleArray>()
            var lastDraw: DoubleArray? = null
            fun projected() =
                DoubleArray(locations.size).also { projection.toScreenLocations(locations, it) }
            // The last two completed MapLibre frames are independent of the view layout code.
            val nativeFrames =
                org.maplibre.android.maps.MapView.OnDidFinishRenderingFrameListener { _, _, _ ->
                    val pose = projected()
                    finishedFrames.addFirst(pose)
                    for (ref in references) ref.history += pose[ref.index * 2] + origin[0]
                    if (finishedFrames.size > 2) finishedFrames.removeLast()
                }
            val observer =
                object : android.graphics.drawable.Drawable() {
                    override fun draw(canvas: android.graphics.Canvas) {
                        val current = projected()
                        val previous = lastDraw
                        lastDraw = current
                        if (previous == null || abs(current[0] - previous[0]) < 0.25) return
                        val visible =
                            views.indices.filter { views[it].first.visibility == View.VISIBLE }
                        if (visible.isEmpty()) return
                        val poses = mutableListOf(current)
                        for (frame in finishedFrames) {
                            if (abs(frame[0] - poses.last()[0]) > 0.25) poses += frame
                        }
                        val age =
                            poses.indexOfFirst { pose ->
                                visible.all { index ->
                                    val child = views[index].first
                                    abs(child.translationX + child.width / 2f - pose[2 * index]) <=
                                        1.5 &&
                                        abs(
                                            child.translationY + child.height / 2f -
                                                pose[2 * index + 1]
                                        ) <= 1.5
                                }
                            }
                        samples += if (age >= 0) age else 3
                    }

                    override fun setAlpha(alpha: Int) {}

                    override fun setColorFilter(filter: android.graphics.ColorFilter?) {}

                    @Deprecated("Deprecated by Android")
                    override fun getOpacity(): Int = android.graphics.PixelFormat.TRANSPARENT
                }
            val overlay = map.annotationOverlay
            observer.setBounds(0, 0, overlay.width, overlay.height)
            engine.mapView.addOnDidFinishRenderingFrameListener(nativeFrames)
            overlay.overlay.add(observer)
            val started = SystemClock.uptimeMillis()
            try {
                val width = bounds.east - bounds.west
                kotlinx.coroutines.coroutineScope {
                    val route = listOf(0.5, -0.5, 0.5, -0.5, 0.5, 0.0)
                    for (shift in route + route) {
                        references.forEach { it.history.clear() }
                        val capture =
                            async(Dispatchers.Default) {
                                delay(230)
                                val image =
                                    requireNotNull(instrumentation.uiAutomation.takeScreenshot())
                                try {
                                    references.map { ref -> markerCenters(image, row, ref) }
                                } finally {
                                    image.recycle()
                                }
                            }
                        map.ease(
                            TileflowCameraUpdate(
                                center =
                                    TileflowCoordinate(
                                        centre.longitude + width * shift,
                                        centre.latitude,
                                    )
                            ),
                            durationMillis = 500,
                        )
                        var moving = false
                        val inner =
                            (origin[0] + 36).toDouble()..(origin[0] + map.width - 36).toDouble()
                        for ((ref, centers) in references.zip(capture.await())) {
                            val (viewX, circleX) = centers
                            if (circleX == null) continue
                            if (viewX == null) {
                                assertTrue(
                                    "Map reference ${ref.id} lacks its view at $circleX",
                                    circleX !in inner,
                                )
                                continue
                            }
                            val lag = ref.movingLag(viewX, circleX) ?: continue
                            physical += lag
                            moving = true
                            directions += ref.history.last() > ref.history.first()
                        }
                        if (moving) movingCaptures++
                        if (shift == 0.0 && movingCaptures >= 3 && directions.size == 2) break
                    }
                }
            } finally {
                overlay.overlay.remove(observer)
                engine.mapView.removeOnDidFinishRenderingFrameListener(nativeFrames)
            }
            val elapsed = SystemClock.uptimeMillis() - started
            assertTrue("Too few draws while moving: ${samples.size}", samples.size >= 30)
            val sorted = samples.sorted()
            val p95 = sorted[((sorted.size - 1) * 0.95).toInt()]
            assertTrue(
                "Too few independently captured moving frames: $physical",
                movingCaptures >= 3 && directions.size == 2,
            )
            val worst = maxOf(sorted.last(), physical.maxOf { it.first })
            println(
                "Tileflow: 200 view annotations, ${sorted.size} moving draws in ${elapsed} ms on ${Build.MODEL} (API ${Build.VERSION.SDK_INT}, $performanceMode): projection lag p50 ${sorted[sorted.size/2]}, p95 $p95, max $worst frames; $movingCaptures moving captures in both directions, composed marker samples=$physical"
            )
            assertEquals(200, overlay.trackedCount)
            if (performanceMode == "strict") {
                assertTrue("Worst draw lag $worst frames (p95 $p95)", worst <= 1)
            }
            for ((child, coordinate) in views) {
                val final = map.project(coordinate)
                assertEquals(final.x, child.translationX + child.width / 2f, 1.5f)
                assertEquals(final.y, child.translationY + child.height / 2f, 1.5f)
            }
            val targetXs = references.map { map.project(views[it.index].second).x + origin[0] }
            until("all composed markers reach the final camera position") {
                val image = requireNotNull(instrumentation.uiAutomation.takeScreenshot())
                try {
                    references.zip(targetXs).all { (ref, targetX) ->
                        val (viewX, circleX) = markerCenters(image, row, ref)
                        viewX != null &&
                            circleX != null &&
                            abs(viewX - targetX) <= 1.5 &&
                            abs(circleX - viewX) <= 1.5
                    }
                } finally {
                    image.recycle()
                }
            }
            map.viewAnnotationManager.removeAllViewAnnotations()
            assertTrue(views.all { it.first.parent == null })
        }
    }

    private class PanReference(val index: Int, val viewColor: Int, val circleHex: String) {
        val id = "view-reference-$index"
        val circleColor = Color.parseColor(circleHex)
        val history = mutableListOf<Double>()

        /** Measure every observable interior reference against its own MapLibre frames. */
        fun movingLag(viewX: Double, circleX: Double): Pair<Int, Double>? {
            if (
                history.isEmpty() ||
                    abs(circleX - history.first()) <= 2 ||
                    abs(circleX - history.last()) <= 2
            )
                return null
            val frame = history.indices.minBy { abs(history[it] - circleX) }
            val step =
                listOf(frame - 1, frame + 1)
                    .filter { it in history.indices }
                    .maxOfOrNull { abs(history[it] - history[frame]) } ?: return null
            if (step <= 2) return null
            val delta = abs(viewX - circleX)
            return kotlin.math.ceil((delta - 1.5).coerceAtLeast(0.0) / step).toInt() to delta
        }
    }

    /**
     * Horizontal centers of the colored Android child and the native circle underneath it, measured
     * in one image of the display compositor during a pan.
     */
    private fun markerCenters(
        image: android.graphics.Bitmap,
        row: Int,
        ref: PanReference,
    ): Pair<Double?, Double?> {
        val top = (row - 36).coerceAtLeast(0)
        val height = minOf(image.height - top, 73)
        val pixels = IntArray(image.width * height)
        image.getPixels(pixels, 0, image.width, 0, top, image.width, height)
        fun center(color: Int): Double? {
            var lo = image.width
            var hi = -1
            pixels.forEachIndexed { i, value ->
                if (
                    abs(Color.red(value) - Color.red(color)) <= 2 &&
                        abs(Color.green(value) - Color.green(color)) <= 2 &&
                        abs(Color.blue(value) - Color.blue(color)) <= 2
                ) {
                    val x = i % image.width
                    lo = minOf(lo, x)
                    hi = maxOf(hi, x)
                }
            }
            // A clipped disk has no measurable center; the other reference stays in frame.
            if (hi < lo || lo == 0 || hi == image.width - 1) return null
            assertTrue(
                "Ambiguous marker color ${Integer.toHexString(color)} in [$lo,$hi], row $row",
                hi - lo < 120,
            )
            return (hi + lo) / 2.0
        }
        return center(ref.viewColor) to center(ref.circleColor)
    }

    @Test
    public fun viewAnnotationsBehindAPitchedCameraAreHidden() {
        val activity = show()
        onMap(activity) { map ->
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 14.0, pitch = 60.0))
            val south = TileflowCoordinate(centre.longitude, centre.latitude - 5.0)
            fun viewAt(point: TileflowCoordinate) =
                View(activity).also {
                    map.viewAnnotationManager.addViewAnnotation(
                        it,
                        TileflowViewAnnotationOptions(
                            point,
                            allowOverlap = true,
                            width = 24f,
                            height = 24f,
                        ),
                    )
                }
            val front = viewAt(centre)
            val behind = viewAt(south)
            val simple = TileflowAnnotation("south", south, "Southern marker", "#ff0000")
            map.setContent(annotations = listOf(simple))
            until("the pitched camera places the visible annotation") {
                front.visibility == View.VISIBLE && front.translationY > 0
            }
            val mirrored = map.project(south)
            assertTrue(
                "MapLibre returns a finite projected point",
                mirrored.x.isFinite() && mirrored.y.isFinite(),
            )
            assertTrue(
                "Annotation behind the camera must be hidden. Native projection: $mirrored",
                behind.visibility != View.VISIBLE,
            )
            val markers = arrayListOf<View>()
            map.findViewsWithText(markers, simple.title, View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION)
            assertTrue(markers.none { it.isShown })
            map.jump(
                TileflowCamera(
                    centre.longitude,
                    centre.latitude,
                    14.0,
                    bearing = 180.0,
                    pitch = 60.0,
                )
            )
            until("turning toward the coordinate restores its projection") {
                behind.visibility == View.VISIBLE
            }
        }
    }

    @Test
    public fun draggingLinesAndPolygonsPreservesOffscreenVerticesAndHoles() {
        val activity = show()
        onMap(activity) { map ->
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 15.0))
            suspend fun coordinate(x: Float, y: Float) = map.unproject(TileflowPoint(x, y))
            val x = map.width / 2f
            val y = map.height / 2f
            val lines =
                map.annotations.createPolylineAnnotationManager(TileflowAnnotationConfig("paths"))
            // The western endpoint is outside the visible tiles; dragging keeps the full source
            // geometry.
            val original =
                listOf(coordinate(-map.width.toFloat(), y - 120), coordinate(x + 140, y - 120))
            val line =
                lines.create(
                    TileflowPolylineAnnotationOptions()
                        .withPoints(original)
                        .withLineColor(Color.RED)
                        .withLineWidth(14.0)
                        .withDraggable(true)
                )
            val polygons =
                map.annotations.createPolygonAnnotationManager(TileflowAnnotationConfig("areas"))
            suspend fun ring(left: Float, top: Float, right: Float, bottom: Float) =
                listOf(
                    coordinate(left, top),
                    coordinate(right, top),
                    coordinate(right, bottom),
                    coordinate(left, bottom),
                    coordinate(left, top),
                )
            val outer = ring(x - 110, y + 70, x + 110, y + 240)
            val hole = ring(x + 30, y + 140, x + 65, y + 185).reversed()
            val polygon =
                polygons.create(
                    TileflowPolygonAnnotationOptions()
                        .withPoints(listOf(outer, hole))
                        .withFillColor(Color.RED)
                        .withDraggable(true)
                )
            suspend fun visible(name: String, at: TileflowPoint) =
                map.layerExists(name) &&
                    map.queryRenderedFeatures(
                            TileflowQueryGeometry.Point(at),
                            TileflowRenderedQueryOptions(listOf(name)),
                        )
                        .isNotEmpty()
            until("both geometries are drawn") {
                visible("paths", TileflowPoint(x, y - 120)) &&
                    visible("areas", TileflowPoint(x, y + 105))
            }
            val initialCamera = map.camera()
            touch(map, x, y - 120, dx = 6f, dy = 4f, steps = 8)
            until("the full line moved") { line.points.first() != original.first() }
            val west = map.project(line.points.first())
            assertEquals(-map.width.toFloat() + 48, west.x, 2f)
            assertEquals(y - 120 + 32, west.y, 2f)
            touch(map, x, y + 105, dx = -5f, dy = 3f, steps = 8)
            until("the polygon moved") { polygon.points.first().first() != outer.first() }
            assertEquals(2, polygon.points.size)
            val currentHole = polygon.points[1].first()
            val holePixel = map.project(currentHole)
            assertEquals(x + 30 - 40, holePixel.x, 2f)
            assertEquals(y + 140 + 24, holePixel.y, 2f)
            assertEquals(initialCamera, map.camera())
        }
    }

    @Test
    public fun simpleMarkersActivateAccessiblyAndSurviveReload() {
        val activity = show()
        onMap(activity) { map ->
            val marker = TileflowAnnotation("store", centre, "Visit the store", "#dc5800")
            suspend fun button(label: String): View {
                var target: View? = null
                until("the marker is accessible") {
                    val found = arrayListOf<View>()
                    map.findViewsWithText(found, label, View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION)
                    target = found.firstOrNull { it.contentDescription == label && it.isShown }
                    target != null
                }
                return requireNotNull(target)
            }
            map.setContent(annotations = listOf(marker))
            val first = button(marker.title)
            val point = map.project(centre)
            until("the marker is placed at its coordinate") {
                abs(first.translationX + first.width / 2f - point.x) <= 1.5f &&
                    abs(first.translationY + first.height / 2f - point.y) <= 1.5f
            }
            fun activations() =
                activity.events.filterIsInstance<TileflowMapEvent.AnnotationActivated>().count {
                    it.id == marker.id && it.coordinate == centre
                }
            touch(map, point.x, point.y)
            until("tapping the marker activates it") { activations() == 1 }
            assertTrue(first.performAccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, null))
            until("the accessibility action activates the marker") { activations() == 2 }
            val renamed = marker.copy(title = "Updated store", color = "#dc580080")
            map.setContent(annotations = listOf(renamed))
            assertTrue(first === button(renamed.title))
            val icon = Bitmap.createBitmap(first.width, first.height, Bitmap.Config.ARGB_8888)
            try {
                first.draw(android.graphics.Canvas(icon))
                assertEquals(
                    "The marker preserves the requested alpha",
                    128,
                    Color.alpha(icon.getPixel(icon.width / 2, icon.height / 2)),
                )
            } finally {
                icon.recycle()
            }
            val loads = activity.loads.size
            map.reload()
            until("new map") { activity.loads.size > loads }
            assertTrue(first !== button(renamed.title))
            map.setContent()
            val found = arrayListOf<View>()
            map.findViewsWithText(found, renamed.title, View.FIND_VIEWS_WITH_CONTENT_DESCRIPTION)
            assertTrue(found.isEmpty())
        }
    }

    @Test
    public fun accessibilityServicesReadAnnotationsInOrderAndActivateThem() {
        val activity = show()
        onMap(activity) { map ->
            map.jump(TileflowCamera(centre.longitude, centre.latitude, 14.0))
            val overlay = map.annotationOverlay
            overlay.forcesAccessibilityTracking = true
            val pins = map.annotations.createPointAnnotationManager()
            val north =
                pins.create(
                    TileflowPointAnnotationOptions()
                        .withPoint(
                            TileflowCoordinate(centre.longitude + 0.004, centre.latitude + 0.006)
                        )
                        .withAccessibilityLabel("North pin")
                )
            val south =
                pins.create(
                    TileflowPointAnnotationOptions()
                        .withPoint(
                            TileflowCoordinate(centre.longitude - 0.004, centre.latitude - 0.006)
                        )
                        .withAccessibilityLabel("South pin")
                )
            val callout = View(activity).apply { contentDescription = "Callout" }
            map.viewAnnotationManager.addViewAnnotation(
                callout,
                TileflowViewAnnotationOptions(centre, width = 80f, height = 40f),
            )
            val activated = mutableListOf<String>()
            pins.addClickListener {
                activated += "tap ${it.accessibilityLabel}"
                true
            }
            pins.addLongClickListener {
                activated += "hold ${it.accessibilityLabel}"
                true
            }
            until("the annotations are placed") {
                listOf(north, south).all {
                    overlay.accessibilityTarget(pins.id, it.id)?.visibility == View.VISIBLE
                } && callout.visibility == View.VISIBLE
            }
            val order = ArrayList<View>().also(overlay::addChildrenForAccessibility)
            assertEquals(
                listOf("North pin", "Callout", "South pin"),
                order.map { it.contentDescription.toString() },
            )
            val node = overlay.createAccessibilityNodeInfo()
            assertEquals(3, node.childCount)
            val target = overlay.accessibilityTarget(pins.id, south.id)!!
            val info = target.createAccessibilityNodeInfo()
            assertEquals("South pin", info.contentDescription.toString())
            assertTrue(info.actionList.any { it.id == AccessibilityNodeInfo.ACTION_CLICK })
            assertTrue(info.actionList.any { it.id == AccessibilityNodeInfo.ACTION_LONG_CLICK })
            // The target lies on its annotation.
            val point = map.project(south.point)
            assertEquals(point.x, target.translationX + target.width / 2f, 1.5f)
            assertEquals(point.y, target.translationY + target.height / 2f, 1.5f)
            assertTrue(target.performAccessibilityAction(AccessibilityNodeInfo.ACTION_CLICK, null))
            assertTrue(
                target.performAccessibilityAction(AccessibilityNodeInfo.ACTION_LONG_CLICK, null)
            )
            assertEquals(listOf("tap South pin", "hold South pin"), activated)
            overlay.forcesAccessibilityTracking = false
            assertEquals(null, overlay.accessibilityTarget(pins.id, south.id))
        }
    }
}
