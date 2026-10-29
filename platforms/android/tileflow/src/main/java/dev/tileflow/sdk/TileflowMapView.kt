package dev.tileflow.sdk

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.os.Parcel
import android.os.Parcelable
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.view.WindowInsets
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.annotation.MainThread
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.findViewTreeLifecycleOwner
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.tileflow.configuration.Tileflow
import dev.tileflow.sdk.bridge.DataChannel
import dev.tileflow.sdk.bridge.EventSubscriptions
import dev.tileflow.sdk.bridge.MapBridge
import dev.tileflow.sdk.bridge.ProtocolContract
import dev.tileflow.sdk.hosted.HostedSession
import dev.tileflow.sdk.location.TileflowFollowMode
import dev.tileflow.sdk.location.TileflowFollowModeChangeReason
import dev.tileflow.sdk.location.TileflowLocation
import dev.tileflow.sdk.location.TileflowLocationProvider
import dev.tileflow.sdk.transport.EmbeddedRuntime
import dev.tileflow.sdk.transport.MapPrewarmer
import dev.tileflow.sdk.transport.ResourceAddress
import dev.tileflow.sdk.transport.ResourceClient
import dev.tileflow.sdk.transport.ResourceLoader
import dev.tileflow.sdk.transport.grantScope
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.abs
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * A Tileflow map in a View hierarchy. Declared in a layout, `app:tileflowMapId` selects a Hosted
 * map, `app:tileflowSurfaceId` names where the application shows it and `app:tileflowTheme` sets
 * its initial theme. Otherwise select a map with [setSource].
 */
@MainThread
public class TileflowMapView
@JvmOverloads
constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {
    public var onEvent: (TileflowMapEvent) -> Unit = {}
    public var source: TileflowMapSource? = null
        private set

    public var theme: String? = null
        private set

    public var options: TileflowMapOptions = TileflowMapOptions()
        private set

    /** The scene beyond the theme the application asked for, given again to each new renderer. */
    internal val scene = SceneState()
    /** Calls waiting for an animation of the current renderer to end. */
    internal val animations = AnimationWaiters()

    private var appearance: Pair<ProtocolContract.Method, JSONObject>? = null
    private var content = MapContent()
    private var contentRevision = 0
    private var subscriptions = EventSubscriptions(options.events, options.controls.followCamera)
    /** The camera the renderer last reported, or the one to start the next renderer at. */
    private var camera: TileflowCamera? = null
    /** A camera the application asked for while no renderer could move, and how many it asked. */
    private var requestedCamera: Pair<TileflowCamera, Int>? = null
    private var webView: WebView? = null
    private var bridge: MapBridge? = null
    private var loader: ResourceLoader? = null
    private var bootstrap: ScriptHandler? = null
    private var scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val instanceId = UUID.randomUUID().toString()
    private var generation = 0
    private var destroyed = false
    private var initialized = false
    private var readyForEvents = false
    private var pendingReadyEvent = false
    /** Renderer replacements since content last loaded; a crash loop stops after one. */
    private var recoveries = 0
    /** Whether this load may still reload itself once for a superseded Map deployment. */
    private val automaticReloadAvailable = AtomicBoolean(true)
    private var generationReady = false
    /** A renderer to replace once the view is visible again. */
    private var pendingRemount = false
    // View.isAttachedToWindow stays true until onDetachedFromWindow returns.
    private var attached = false
    /** The current source with its configuration read, kept with its Hosted session. */
    private var loadable: LoadableMapSource? = null
    private var hostedSession: HostedSession? = null
    private var lifecycleOwner: LifecycleOwner? = null
    private var rendererVisible = true
    private val density = resources.displayMetrics.density
    private val cameraEvents = CameraEventGate(scope)
    internal val controlsView = MapControlsView(context)
    /** The location provider, the latest position and the follow mode. */
    internal val location = MapLocation(this)
    private var contentPadding = TileflowEdgeInsets.ZERO
    /** The insets the current renderer has, or null before it is initialized. */
    private var rendererInsets: TileflowEdgeInsets? = null
    private var insetsUpdate: Job? = null
    /** Whether the touch sequence in progress began on a native control. */
    private var touchOnControl = false

    /**
     * The camera the renderer last reported, kept current from its events without a call: when it
     * settles, and while it moves when the application or a control follows it. Before the map
     * loads, the camera it starts at, or null for the map's authored view.
     */
    public val currentCamera: TileflowCamera?
        get() = camera

    /** Whether the camera is moving, for an animation or a gesture, as of the last event. */
    public val isMoving: Boolean
        get() = cameraEvents.isMoving

    /**
     * Where the map's positions and headings come from; null uses a
     * [dev.tileflow.sdk.location.TileflowDefaultLocationProvider] that the map creates when it
     * first shows the location.
     */
    public var locationProvider: TileflowLocationProvider?
        get() = location.custom
        set(value) {
            location.custom = value
            location.consume(null)
            refreshLocation()
        }

    /** The latest position the map received, or null before the first. */
    public val latestLocation: TileflowLocation?
        get() = location.latest

    /**
     * How the camera follows the location. A gesture that moves the map, and a camera movement the
     * application asks for, set it to [TileflowFollowMode.NONE] and report
     * [TileflowMapEvent.FollowModeChanged]. The camera follows only while
     * [TileflowLocationOptions.enabled][dev.tileflow.sdk.location.TileflowLocationOptions.enabled];
     * setting a mode before keeps it until then.
     */
    public var followMode: TileflowFollowMode
        get() = location.follow.mode
        set(value) = setFollowModeFromApplication(value)

    /**
     * Whether the system bars and display cutout, where they overlap the view, add to the content
     * padding.
     */
    public var automaticallyAdjustsContentPadding: Boolean = true
        set(value) {
            field = value
            updateInsets()
        }

    /**
     * The padding the camera and controls use, in pixels: the content padding plus the system
     * bars and display cutout when adjusted automatically.
     */
    public var effectiveContentPadding: TileflowEdgeInsets = TileflowEdgeInsets.ZERO
        private set

    /**
     * Return false to leave a touch that begins at this point, in pixels relative to the view, to
     * the views behind and around the map; for example over application UI drawn on the map.
     * Native controls receive their touches regardless.
     */
    public var touchFilter: ((x: Float, y: Float) -> Boolean)? = null

    /** Every camera change the SDK follows, before the application's level and interval. */
    internal var onCameraObserved: ((TileflowCameraChange) -> Unit)? = null
    private val lifecycleObserver =
        object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                updateVisibility()
            }

            override fun onStop(owner: LifecycleOwner) {
                updateVisibility()
            }

            // Access granted in a system dialog arrives while the activity resumes.
            override fun onResume(owner: LifecycleOwner) {
                refreshLocation()
            }

            override fun onDestroy(owner: LifecycleOwner) {
                destroy()
            }
        }

    init {
        // A layout selects a Hosted map with `app:tileflowMapId`; an invalid value fails inflation.
        if (attrs != null) {
            val values = context.obtainStyledAttributes(attrs, R.styleable.TileflowMapView)
            try {
                values.getString(R.styleable.TileflowMapView_tileflowTheme)?.let {
                    require(it.isNotEmpty() && it.length <= 128) { "Invalid tileflowTheme." }
                    theme = it
                }
                val surfaceId = values.getString(R.styleable.TileflowMapView_tileflowSurfaceId)
                val mapId = values.getString(R.styleable.TileflowMapView_tileflowMapId)
                require(surfaceId == null || mapId != null) {
                    "tileflowSurfaceId needs tileflowMapId."
                }
                if (mapId != null) {
                    setSource(TileflowMapSource.hosted(mapId, surfaceId ?: "mobile-map"))
                }
            } finally {
                values.recycle()
            }
        }
    }

    /**
     * Shows a Hosted map. Its credential and API origin come from
     * `Tileflow.configuration(context)`; use [TileflowMapSource.hosted] with [setSource] to pass a
     * configuration for this map only.
     */
    public constructor(context: Context, mapId: String) : this(context) {
        setSource(TileflowMapSource.hosted(mapId))
    }

    init {
        controlsView.controls = options.controls
        controlsView.locationShown = options.location.enabled
        controlsView.visibility = GONE
        controlsView.compass.setOnClickListener {
            if (compassTapped()) return@setOnClickListener
            scope.launch {
                try {
                    move(
                        TileflowCameraUpdate(bearing = 0.0),
                        TileflowCameraAnimation.Ease(300),
                        reason = "gesture",
                    )
                } catch (_: TileflowMapException) {
                    // The compass acts again on the next tap.
                }
            }
        }
        controlsView.recenter.setOnClickListener { recenterTapped() }
        addView(controlsView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    /**
     * Space covered by the application at each edge, in pixels, such as a sheet over the map. The
     * camera centres on the rest of the view and the controls and attribution stay inside it.
     */
    public fun setContentPadding(left: Float, top: Float, right: Float, bottom: Float) {
        val next = TileflowEdgeInsets(left, top, right, bottom)
        if (!next.valid()) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        contentPadding = next
        updateInsets()
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        super.onLayout(changed, left, top, right, bottom)
        updateInsets()
    }

    override fun onApplyWindowInsets(insets: WindowInsets): WindowInsets {
        val result = super.onApplyWindowInsets(insets)
        post { updateInsets() }
        return result
    }

    /** The system bars and display cutout where they overlap this view, in pixels. */
    private fun systemInsets(): TileflowEdgeInsets {
        if (!automaticallyAdjustsContentPadding || !isAttachedToWindow)
            return TileflowEdgeInsets.ZERO
        val insets =
            ViewCompat.getRootWindowInsets(this)
                ?.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
                ) ?: return TileflowEdgeInsets.ZERO
        val location = IntArray(2)
        getLocationInWindow(location)
        val root = rootView
        fun overlap(inset: Int, distance: Int) = (inset - distance).coerceAtLeast(0).toFloat()
        return TileflowEdgeInsets(
            overlap(insets.left, location[0]),
            overlap(insets.top, location[1]),
            overlap(insets.right, root.width - location[0] - width),
            overlap(insets.bottom, root.height - location[1] - height),
        )
    }

    /** Sends the padding to the renderer, one update at a time with the latest value. */
    private fun updateInsets() {
        val system = systemInsets()
        val insets =
            TileflowEdgeInsets(
                contentPadding.left + system.left,
                contentPadding.top + system.top,
                contentPadding.right + system.right,
                contentPadding.bottom + system.bottom,
            )
        effectiveContentPadding = insets
        controlsView.insets = insets
        val bridge = bridge?.takeIf { initialized } ?: return
        if (insetsUpdate != null || rendererInsets == insets) return
        insetsUpdate =
            scope.launch {
                val sent =
                    try {
                        bridge.call(ProtocolContract.Method.SET_INSETS, insets.css(density))
                        true
                    } catch (_: TileflowMapException) {
                        false
                    }
                insetsUpdate = null
                if (this@TileflowMapView.bridge !== bridge) return@launch
                if (sent) rendererInsets = insets
                updateInsets()
            }
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val gestures = options.gestures
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                touchOnControl =
                    controlsView.visibility == VISIBLE &&
                        controlsView.hasControlAt(event.x, event.y)
                if (!touchOnControl) {
                    if (touchFilter?.invoke(event.x, event.y) == false) return false
                    // Scrolling parents, pagers and sheets leave a drag on the map to the map.
                    if (gestures.movesMap && !gestures.cooperative)
                        parent?.requestDisallowInterceptTouchEvent(true)
                }
            }
            MotionEvent.ACTION_POINTER_DOWN ->
                if (!touchOnControl && gestures.movesMap && gestures.cooperative)
                    parent?.requestDisallowInterceptTouchEvent(true)
        }
        return super.dispatchTouchEvent(event)
    }

    override fun onSaveInstanceState(): Parcelable =
        SavedState(super.onSaveInstanceState(), camera)

    override fun onRestoreInstanceState(state: Parcelable?) {
        if (state !is SavedState) {
            super.onRestoreInstanceState(state)
            return
        }
        super.onRestoreInstanceState(state.superState)
        val saved = state.camera ?: return
        if (destroyed) return
        if (!initialized) {
            request(saved)
            return
        }
        scope.launch {
            try {
                move(TileflowCameraUpdate(saved))
            } catch (_: TileflowMapException) {
                // A renderer replaced meanwhile starts at the saved camera.
            }
        }
    }

    /** The camera a view keeps across configuration changes and process recreation. */
    internal class SavedState : BaseSavedState {
        val camera: TileflowCamera?

        constructor(superState: Parcelable?, camera: TileflowCamera?) : super(superState) {
            this.camera = camera
        }

        private constructor(parcel: Parcel) : super(parcel) {
            camera =
                if (parcel.readInt() == 1)
                    TileflowCamera(
                        parcel.readDouble(),
                        parcel.readDouble(),
                        parcel.readDouble(),
                        parcel.readDouble(),
                        parcel.readDouble(),
                    )
                else null
        }

        override fun writeToParcel(out: Parcel, flags: Int) {
            super.writeToParcel(out, flags)
            val camera = camera
            out.writeInt(if (camera == null) 0 else 1)
            if (camera != null) {
                out.writeDouble(camera.longitude)
                out.writeDouble(camera.latitude)
                out.writeDouble(camera.zoom)
                out.writeDouble(camera.bearing)
                out.writeDouble(camera.pitch)
            }
        }

        companion object {
            @JvmField
            val CREATOR: Parcelable.Creator<SavedState> =
                object : Parcelable.Creator<SavedState> {
                    override fun createFromParcel(source: Parcel): SavedState = SavedState(source)

                    override fun newArray(size: Int): Array<SavedState?> = arrayOfNulls(size)
                }
        }
    }

    public fun setSource(source: TileflowMapSource, initialCamera: TileflowCamera? = null) {
        check(!destroyed) { "The map is destroyed." }
        if (source == this.source) return
        source.validate()
        hostedSession?.close()
        hostedSession = null
        loadable = null
        retireGeneration()
        this.source = source
        if (initialCamera != null) observe(initialCamera)
        resetRecovery()
        if (attached) mount()
    }

    /** Null selects the authored default. "system" follows the map's declared system themes. */
    public suspend fun setTheme(
        theme: String?,
        timeOfDay: TileflowTimeOfDay? = null,
        durationMillis: Long = 0,
    ) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        if (
            (theme != null && (theme.isEmpty() || theme.length > 128)) || durationMillis !in 0..5000
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        this.theme = theme
        val payload =
            JSONObject()
                .put("theme", theme ?: JSONObject.NULL)
                .put("colorScheme", colorScheme())
                .put("duration", durationMillis)
        timeOfDay?.let { payload.put("timeOfDay", it.wireName) }
        appearance = ProtocolContract.Method.SET_THEME to payload
        applyAppearance()
    }

    public suspend fun setBlend(
        themes: List<String>,
        position: Double,
        hold: Boolean = false,
        durationMillis: Long = 0,
    ) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        if (
            themes.size !in 2..8 ||
                themes.toSet().size != themes.size ||
                themes.any { it.isEmpty() || it.length > 128 || it == "system" } ||
                position !in 0.0..(themes.size - 1).toDouble() ||
                durationMillis !in 0..5000
        ) {
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        }
        appearance =
            ProtocolContract.Method.SET_BLEND to
                JSONObject()
                    .put("themes", JSONArray(themes))
                    .put("position", position)
                    .put("hold", hold)
                    .put("duration", durationMillis)
        applyAppearance()
    }

    public suspend fun setOptions(options: TileflowMapOptions) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        options.validate()
        val previous = this.options
        val previousSubscriptions = subscriptions
        this.options = options
        subscriptions = EventSubscriptions(options.events, options.controls.followCamera)
        controlsView.controls = options.controls
        controlsView.locationShown = options.location.enabled
        locationOptionsChanged(previous)
        // Antialiasing and style validation are fixed when a renderer starts.
        if (
            (options.antialias != previous.antialias ||
                options.validatesStyle != previous.validatesStyle) && webView != null
        ) {
            remount()
            return
        }
        sendOptions(events = subscriptions != previousSubscriptions)
    }

    private val rightToLeft: Boolean
        get() = layoutDirection == LAYOUT_DIRECTION_RTL

    private suspend fun sendOptions(events: Boolean) {
        val bridge = bridge?.takeIf { initialized } ?: return
        bridge.call(ProtocolContract.Method.SET_OPTIONS, options.json(rightToLeft))
        if (events)
            bridge.call(
                ProtocolContract.Method.SET_EVENTS,
                JSONObject().put("events", subscriptions.json()),
            )
    }

    private suspend fun applyAppearance() {
        val request = appearance ?: return
        if (initialized) bridge?.call(request.first, request.second)
    }

    /** Replaces application content, preserving it across theme and renderer replacement. */
    public suspend fun setContent(
        annotations: List<TileflowAnnotation> = emptyList(),
        layers: List<TileflowGeoJSONLayer> = emptyList(),
    ) {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val next = MapContent(annotations.toList(), layers.toList())
        next.validate()
        val previous = content
        val revision = ++contentRevision
        content = next
        try {
            if (initialized) bridge?.let { send(next, it) }
        } catch (error: Exception) {
            if (contentRevision == revision) content = previous
            throw error
        }
    }

    private suspend fun send(content: MapContent, bridge: MapBridge) {
        val (payload, references) = content.json(bridge.data)
        bridge.call(ProtocolContract.Method.SET_CONTENT, payload, references)
    }

    /**
     * Moves the camera, easing over [durationMillis] (at most 20 000), and waits until it settles.
     * Before the map loads, the camera becomes the one it starts at.
     */
    public suspend fun setCamera(camera: TileflowCamera, durationMillis: Long = 0) {
        move(
            camera,
            if (durationMillis > 0) TileflowCameraAnimation.Ease(durationMillis)
            else TileflowCameraAnimation.None,
        )
    }

    /**
     * Reads the renderer's camera. [currentCamera] holds the last one it reported without a call.
     */
    public suspend fun camera(): TileflowCamera {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        return cameraOrNull(bridge.call(ProtocolContract.Method.GET_CAMERA))
            ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    }

    /** Returns rendered feature identities at physical pixels relative to this view. */
    public suspend fun query(x: Float, y: Float): List<TileflowRenderedFeature> {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val point = cssPoint(x, y)
        if (!initialized) throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val result =
            bridge?.call(ProtocolContract.Method.QUERY_AT_POINT, point) as? JSONArray
                ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
        return (0 until result.length()).map { index ->
            val feature = result.getJSONObject(index)
            TileflowRenderedFeature(
                if (feature.isNull("id")) null else feature.getString("id"),
                feature.getString("source"),
                feature.getString("layer"),
            )
        }
    }

    /**
     * Frames [bounds] with [padding] pixels around them, inside the content padding, and waits
     * until the camera settles. A [durationMillis] above 0 eases there.
     */
    public suspend fun fit(
        bounds: TileflowBounds,
        padding: Float = 24f,
        maxZoom: Double = 20.0,
        durationMillis: Long = 0,
    ) {
        if (padding !in 0f..1000f * density)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        fit(
            bounds,
            TileflowEdgeInsets(padding, padding, padding, padding),
            maxZoom = maxZoom,
            animation =
                if (durationMillis > 0) TileflowCameraAnimation.Ease(durationMillis)
                else TileflowCameraAnimation.None,
        )
    }

    /** Physical pixels relative to this view. */
    public suspend fun project(coordinate: TileflowCoordinate): TileflowPoint {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val point =
            bridge.call(
                ProtocolContract.Method.PROJECT,
                JSONObject()
                    .put("longitude", coordinate.longitude)
                    .put("latitude", coordinate.latitude),
            ) as JSONObject
        val density = resources.displayMetrics.density
        return TileflowPoint(
            point.getDouble("x").toFloat() * density,
            point.getDouble("y").toFloat() * density,
        )
    }

    public suspend fun unproject(point: TileflowPoint): TileflowCoordinate {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val css = cssPoint(point.x, point.y)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val coordinate = bridge.call(ProtocolContract.Method.UNPROJECT, css) as JSONObject
        return TileflowCoordinate(
            coordinate.getDouble("longitude"),
            coordinate.getDouble("latitude"),
        )
    }

    /** Points may lie outside the view, within the renderer's coordinate range. */
    private fun cssPoint(x: Float, y: Float): JSONObject {
        val density = resources.displayMetrics.density
        val cssX = (x / density).toDouble()
        val cssY = (y / density).toDouble()
        if (!cssX.isFinite() || !cssY.isFinite() || abs(cssX) > 32_768 || abs(cssY) > 32_768)
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        return JSONObject().put("x", cssX).put("y", cssY)
    }

    /**
     * Moves the camera and waits until it settles. Cancelling the calling coroutine stops the
     * movement and throws its `CancellationException`.
     *
     * Before the map loads, a complete camera becomes the one it starts at and the call returns
     * [TileflowCameraAnimationResult.FINISHED]; a partial update fails with
     * [TileflowErrorCode.NOT_READY].
     */
    public suspend fun move(
        update: TileflowCameraUpdate,
        animation: TileflowCameraAnimation = TileflowCameraAnimation.None,
    ): TileflowCameraAnimationResult = move(update, animation, reason = "api")

    public suspend fun move(
        camera: TileflowCamera,
        animation: TileflowCameraAnimation = TileflowCameraAnimation.None,
    ): TileflowCameraAnimationResult = move(TileflowCameraUpdate(camera), animation)

    public suspend fun jump(update: TileflowCameraUpdate): TileflowCameraAnimationResult =
        move(update, TileflowCameraAnimation.None)

    public suspend fun jump(camera: TileflowCamera): TileflowCameraAnimationResult =
        move(TileflowCameraUpdate(camera), TileflowCameraAnimation.None)

    public suspend fun ease(
        update: TileflowCameraUpdate,
        durationMillis: Long = 500,
        easing: TileflowEasing = TileflowEasing.STANDARD,
    ): TileflowCameraAnimationResult =
        move(update, TileflowCameraAnimation.Ease(durationMillis, easing))

    public suspend fun ease(
        camera: TileflowCamera,
        durationMillis: Long = 500,
        easing: TileflowEasing = TileflowEasing.STANDARD,
    ): TileflowCameraAnimationResult = ease(TileflowCameraUpdate(camera), durationMillis, easing)

    public suspend fun fly(
        update: TileflowCameraUpdate,
        options: TileflowFlyOptions = TileflowFlyOptions(),
    ): TileflowCameraAnimationResult = move(update, TileflowCameraAnimation.Fly(options))

    public suspend fun fly(
        camera: TileflowCamera,
        options: TileflowFlyOptions = TileflowFlyOptions(),
    ): TileflowCameraAnimationResult = fly(TileflowCameraUpdate(camera), options)

    /**
     * Frames [bounds] with [padding] pixels around them, inside the content padding, and waits
     * until the camera settles. Fails with [TileflowErrorCode.INVALID_REQUEST] when the padding
     * leaves no room.
     */
    public suspend fun fit(
        bounds: TileflowBounds,
        padding: TileflowEdgeInsets,
        bearing: Double? = null,
        pitch: Double? = null,
        maxZoom: Double? = null,
        animation: TileflowCameraAnimation = TileflowCameraAnimation.None,
    ): TileflowCameraAnimationResult {
        val fit = fitJson(bounds, padding, bearing, pitch, maxZoom)
        endFollowing(TileflowFollowModeChangeReason.API)
        return sendMove(JSONObject().put("fit", fit).put("animation", animation.json()))
    }

    /**
     * Stops the camera, whether the application or a person moved it, and ends following the
     * location. A movement the application started ends as
     * [TileflowCameraAnimationResult.CANCELLED].
     */
    public fun stopCamera() {
        if (destroyed) return
        endFollowing(TileflowFollowModeChangeReason.API)
        val bridge = bridge?.takeIf { initialized } ?: return
        scope.launch {
            try {
                bridge.call(ProtocolContract.Method.STOP_CAMERA)
            } catch (_: TileflowMapException) {
                // A replaced renderer has no movement to stop.
            }
        }
    }

    /**
     * The camera that frames [bounds] with [padding] pixels around them, inside the content
     * padding, without moving. Null when the padding leaves no room.
     */
    public suspend fun camera(
        bounds: TileflowBounds,
        padding: TileflowEdgeInsets = TileflowEdgeInsets.ZERO,
        bearing: Double? = null,
        pitch: Double? = null,
        maxZoom: Double? = null,
    ): TileflowCamera? {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val fit = fitJson(bounds, padding, bearing, pitch, maxZoom)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val result = bridge.call(ProtocolContract.Method.CAMERA_FOR_BOUNDS, fit)
        if (result == JSONObject.NULL) return null
        return cameraOrNull(result) ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    }

    /**
     * The camera that frames every coordinate, for example a route's or a shape's, without moving.
     * Null without coordinates or when the padding leaves no room.
     */
    public suspend fun cameraFitting(
        coordinates: List<TileflowCoordinate>,
        padding: TileflowEdgeInsets = TileflowEdgeInsets.ZERO,
        bearing: Double? = null,
        pitch: Double? = null,
        maxZoom: Double? = null,
    ): TileflowCamera? =
        TileflowBounds.enclosing(coordinates)?.let { camera(it, padding, bearing, pitch, maxZoom) }

    /**
     * The region the view shows. A view that shows the horizon ends at MapLibre's horizon line; one
     * that crosses the antimeridian has an east edge west of its west edge.
     */
    public suspend fun visibleBounds(): TileflowBounds {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val result = bridge.call(ProtocolContract.Method.VISIBLE_BOUNDS) as? JSONObject
        return try {
            result?.let(::boundsFrom)
        } catch (_: org.json.JSONException) {
            null
        } ?: throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
    }

    internal suspend fun move(
        update: TileflowCameraUpdate,
        animation: TileflowCameraAnimation,
        reason: String,
    ): TileflowCameraAnimationResult {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val target = update.json()
        val wireAnimation = animation.json()
        // A movement the application asks for ends following the location.
        if (reason == "api") endFollowing(TileflowFollowModeChangeReason.API)
        if (!initialized) {
            if (update.center == null || update.zoom == null)
                throw TileflowMapException(TileflowErrorCode.NOT_READY)
            val start = update.appliedTo(camera ?: TileflowCamera(0.0, 0.0, 0.0))
            if (!start.isValid()) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            request(start)
            return TileflowCameraAnimationResult.FINISHED
        }
        return sendMove(
            JSONObject().put("target", target).put("animation", wireAnimation).put("reason", reason)
        )
    }

    private suspend fun sendMove(payload: JSONObject): TileflowCameraAnimationResult {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        val bridge =
            bridge?.takeIf { initialized }
                ?: throw TileflowMapException(TileflowErrorCode.NOT_READY)
        val result = bridge.call(ProtocolContract.Method.MOVE_CAMERA, payload) as? JSONObject
        val completion = TileflowCameraAnimationResult.fromWire(result?.optString("completion"))
        val camera = cameraOrNull(result?.optJSONObject("camera"))
        if (completion == null || camera == null)
            throw TileflowMapException(TileflowErrorCode.RENDERER_FAILED)
        if (bridge === this.bridge) observe(camera)
        return completion
    }

    private fun fitJson(
        bounds: TileflowBounds,
        padding: TileflowEdgeInsets,
        bearing: Double?,
        pitch: Double?,
        maxZoom: Double?,
    ): JSONObject {
        if (!padding.valid() || listOf(padding.left, padding.top, padding.right, padding.bottom)
            .any { it / density > 8192 }
        )
            throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
        val fit = JSONObject().put("bounds", bounds.json()).put("padding", padding.css(density))
        for ((key, value, range) in
            listOf(
                Triple("bearing", bearing, -360.0..360.0),
                Triple("pitch", pitch, 0.0..TileflowCameraLimits.MAXIMUM_PITCH),
                Triple("maxZoom", maxZoom, 0.0..24.0),
            )) {
            if (value == null) continue
            if (value !in range) throw TileflowMapException(TileflowErrorCode.INVALID_REQUEST)
            fit.put(key, value)
        }
        return fit
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        attached = true
        lifecycleOwner = findViewTreeLifecycleOwner()
        lifecycleOwner?.lifecycle?.addObserver(lifecycleObserver)
        if (webView == null && source != null && !destroyed && !pendingRemount) mount()
        updateVisibility()
    }

    override fun onDetachedFromWindow() {
        attached = false
        lifecycleOwner?.lifecycle?.removeObserver(lifecycleObserver)
        lifecycleOwner = null
        super.onDetachedFromWindow()
        updateVisibility()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        updateVisibility()
    }

    /** Whether the map is attached and its window and lifecycle show it. */
    internal val isVisibleOnScreen: Boolean
        get() = isVisibleToUser()

    private fun isVisibleToUser(): Boolean =
        attached &&
            windowVisibility == View.VISIBLE &&
            (lifecycleOwner?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) != false)

    private fun updateVisibility() {
        if (destroyed) return
        refreshLocation()
        val visible = isVisibleToUser()
        hostedSession?.setBackgrounded(!visible)
        if (visible == rendererVisible) return
        rendererVisible = visible
        if (visible && pendingRemount) {
            retireGeneration()
            mount()
            return
        }
        if (visible) webView?.onResume() else webView?.onPause()
        if (!initialized) return
        scope.launch {
            try {
                bridge?.call(
                    ProtocolContract.Method.SET_VISIBILITY,
                    JSONObject().put("visible", visible),
                )
            } catch (_: TileflowMapException) {
                /* Initial visibility may precede the handshake. */
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (
            destroyed || theme != "system" || appearance?.first == ProtocolContract.Method.SET_BLEND
        )
            return
        scope.launch {
            try {
                val previous = appearance
                if (previous == null) setTheme(theme)
                else {
                    appearance =
                        previous.first to
                            JSONObject(previous.second.toString()).put("colorScheme", colorScheme())
                    applyAppearance()
                }
            } catch (error: TileflowMapException) {
                // The theme is applied again to the next renderer if this one was replaced.
                if (!destroyed && error.code != TileflowErrorCode.CANCELLED)
                    onEvent(TileflowMapEvent.Failed(error.code, error.context))
            }
        }
    }

    public fun destroy() {
        if (destroyed) return
        destroyed = true
        lifecycleOwner?.lifecycle?.removeObserver(lifecycleObserver)
        lifecycleOwner = null
        hostedSession?.close()
        hostedSession = null
        loadable = null
        refreshLocation()
        retireGeneration(TileflowErrorCode.DISPOSED)
        scope.cancel()
        onEvent = {}
    }

    /**
     * Retry the current source after a load or renderer failure. A Hosted session stopped by
     * [TileflowErrorCode.CREDENTIAL_REJECTED], [TileflowErrorCode.ACCESS_DENIED],
     * [TileflowErrorCode.QUOTA_EXCEEDED] or [TileflowErrorCode.SESSION_REJECTED] bootstraps again.
     * Reloading also skips the delay that follows a temporary session failure
     * ([TileflowErrorCode.RATE_LIMITED], [TileflowErrorCode.SESSION_UNAVAILABLE] or
     * [TileflowErrorCode.INVALID_SESSION_RESPONSE]), so call it in response to a user action rather
     * than from every failure event.
     */
    public fun reload() {
        if (destroyed) throw TileflowMapException(TileflowErrorCode.DISPOSED)
        hostedSession?.retry()
        resetRecovery()
        retireGeneration()
        if (attached && source != null) mount()
    }

    private fun resetRecovery() {
        recoveries = 0
        automaticReloadAvailable.set(true)
        pendingRemount = false
    }

    /** Replace the renderer, keeping the Hosted session; a hidden view replaces it once visible. */
    private fun remount() {
        retireGeneration()
        if (isVisibleToUser()) mount() else pendingRemount = true
    }

    /**
     * A load that fails while hidden, for example because the system suspended its networking,
     * reloads once visible instead of reporting a failure nobody saw.
     */
    private fun report(
        code: TileflowErrorCode,
        current: Int,
        context: TileflowErrorContext = TileflowErrorContext.NONE,
    ) {
        if (destroyed || generation != current) return
        if (!generationReady && !isVisibleToUser()) {
            pendingRemount = true
            return
        }
        onEvent(TileflowMapEvent.Failed(code, context))
    }

    private fun contentReady() {
        generationReady = true
        resetRecovery()
        controlsView.visibility = VISIBLE
        onEvent(TileflowMapEvent.ContentReady)
    }

    /** The camera to start at, or to move to once the renderer that is loading can move. */
    private fun request(camera: TileflowCamera) {
        observe(camera)
        requestedCamera = camera to (requestedCamera?.second ?: 0) + 1
    }

    /** Keeps the synchronous camera and the controls current. */
    internal fun observe(camera: TileflowCamera) {
        this.camera = camera
        controlsView.camera = camera
    }

    private fun colorScheme(): String =
        if (
            resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
                Configuration.UI_MODE_NIGHT_YES
        )
            "dark"
        else "light"

    @SuppressLint("SetJavaScriptEnabled")
    private fun mount() {
        val source = source ?: return
        try {
            // A failed read is not kept, so reload() reads a corrected configuration.
            val loadable =
                this.loadable
                    ?: source
                        .loadable { Tileflow.configuration(context) }
                        .also { this.loadable = it }
            if (
                !WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) ||
                    !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) ||
                    !WebViewRequirement.isSupported(
                        WebViewCompat.getCurrentWebViewPackage(context)?.versionName
                    )
            ) {
                throw TileflowMapException(TileflowErrorCode.INCOMPATIBLE_RUNTIME)
            }
            // The receipt is read once per process; the files are verified once, off the main
            // thread, while the WebView starts.
            val receipt = EmbeddedRuntime.receipt(context.assets)
            EmbeddedRuntime.failure?.let { throw it }
            EmbeddedRuntime.verification(context.assets)
            TileflowDeviceProfile.current(context)
            generation += 1
            val current = generation
            pendingRemount = false
            // A new document starts shown; it is hidden after initialization if the view is not.
            rendererVisible = true
            val endpoint = loadable.hosted
            if (
                hostedSession == null &&
                    endpoint != null &&
                    loadable.mapId != null &&
                    loadable.surfaceId != null
            ) {
                hostedSession = HostedSession(endpoint, loadable.mapId, loadable.surfaceId)
            }
            hostedSession?.setBackgrounded(!isVisibleToUser())
            val resourceLoader =
                ResourceLoader(
                    loadable.policy,
                    hosted = hostedSession,
                    apiOrigin = endpoint?.apiOrigin,
                    publicMetadataUrls = loadable.publicMetadataUrls,
                    cache = TileflowMapCache.get(context).store,
                    grantScope = loadable.grantScope,
                    onDeploymentSuperseded = {
                        // A protected style belongs to a superseded deployment: reload once.
                        automaticReloadAvailable.compareAndSet(true, false).also { reload ->
                            if (reload)
                                post { if (!destroyed && generation == current) remount() }
                        }
                    },
                )
            val view = WebView(context)
            // A long press is the map's gesture, not text selection.
            view.setOnLongClickListener { true }
            view.isLongClickable = false
            view.isHapticFeedbackEnabled = false
            view.settings.apply {
                javaScriptEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                domStorageEnabled = false
                cacheMode = WebSettings.LOAD_NO_CACHE
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            }
            val mapBridge =
                MapBridge(
                    instanceId,
                    current,
                    receipt.runtimeHash,
                    view,
                    DataChannel(),
                    onHello = { readyBridge ->
                        scope.launch {
                            if (destroyed || generation != current) return@launch
                            try {
                                val startingTheme = theme
                                val startingRequest = requestedCamera?.second
                                val startingOptions = options
                                val configuration =
                                    JSONObject()
                                        .put(
                                            "source",
                                            JSONObject()
                                                .put("map", loadable.map)
                                                .put(
                                                    "manifestUrl",
                                                    loadable.manifestUrl.toASCIIString(),
                                                )
                                                .apply {
                                                    loadable.mapId?.let {
                                                        put("discoveryMapId", it)
                                                    }
                                                },
                                        )
                                        .put("theme", theme ?: JSONObject.NULL)
                                        .put("colorScheme", colorScheme())
                                        .put("interactive", true)
                                        .put("options", options.json(rightToLeft))
                                        .put("renderer", options.rendererJson())
                                        .put("events", subscriptions.json())
                                        .put("insets", effectiveContentPadding.css(density))
                                val startingSubscriptions = subscriptions
                                val startingInsets = effectiveContentPadding
                                camera?.let { configuration.put("camera", it.json()) }
                                readyBridge.call(ProtocolContract.Method.INITIALIZE, configuration)
                                if (destroyed || generation != current) return@launch
                                initialized = true
                                rendererInsets = startingInsets
                                updateInsets()
                                send(content, readyBridge)
                                if (appearance != null) applyAppearance()
                                else if (theme != startingTheme) setTheme(theme)
                                if (options != startingOptions)
                                    sendOptions(events = subscriptions != startingSubscriptions)
                                // Only a camera the application asked for meanwhile moves again.
                                requestedCamera
                                    ?.takeIf { it.second != startingRequest }
                                    ?.let { move(it.first) }
                                replayScene(readyBridge)
                                replayLocation(readyBridge)
                                if (!rendererVisible)
                                    readyBridge.call(
                                        ProtocolContract.Method.SET_VISIBILITY,
                                        JSONObject().put("visible", false),
                                    )
                                readyForEvents = true
                                if (pendingReadyEvent) {
                                    pendingReadyEvent = false
                                    contentReady()
                                }
                            } catch (error: Exception) {
                                if (error is CancellationException) throw error
                                report(
                                    (error as? TileflowMapException)?.code
                                        ?: TileflowErrorCode.RENDERER_FAILED,
                                    current,
                                    (error as? TileflowMapException)?.context
                                        ?: TileflowErrorContext.NONE,
                                )
                            }
                        }
                    },
                    onEvent = { event, result ->
                        if (!destroyed && generation == current) receive(event, result, current)
                    },
                    onFailure = { error -> report(error.code, current, error.context) },
                )
            WebViewCompat.addWebMessageListener(
                view,
                "tileflowNative",
                setOf(ResourceAddress.ORIGIN),
            ) { _, message, origin, isMainFrame, _ ->
                if (
                    isMainFrame &&
                        origin.toString() == ResourceAddress.ORIGIN &&
                        !destroyed &&
                        generation == current
                ) {
                    message.data?.let(mapBridge::receive)
                }
            }
            val boot =
                JSONObject()
                    .put("instanceId", instanceId)
                    .put("generation", current)
                    .put("platform", "android")
                    .put(
                        "protocol",
                        JSONObject()
                            .put("minimum", ProtocolContract.MINIMUM_VERSION)
                            .put("maximum", ProtocolContract.VERSION),
                    )
            bootstrap =
                WebViewCompat.addDocumentStartJavaScript(
                    view,
                    "Object.defineProperty(window,'tileflowHost',{value:$boot});",
                    setOf(ResourceAddress.ORIGIN),
                )
            view.webViewClient =
                ResourceClient(
                    context.assets,
                    resourceLoader,
                    onExternalLink = {
                        if (!destroyed && generation == current)
                            onEvent(TileflowMapEvent.ExternalLinkRequested(it))
                    },
                    onFailure = { report(it.code, current, it.context) },
                    data = mapBridge.data,
                ) {
                    // The system may end a hidden renderer to reclaim memory. Replace it once
                    // visible; a renderer that ends again before its content loads is reported.
                    if (webView === view && !destroyed) {
                        if (recoveries++ < 1) remount()
                        else {
                            retireGeneration()
                            onEvent(
                                TileflowMapEvent.Failed(
                                    TileflowErrorCode.RENDERER_FAILED,
                                    TileflowErrorContext.of(
                                        ProtocolContract.ErrorReason.PROCESS_TERMINATED
                                    ),
                                )
                            )
                        }
                    }
                }
            loader = resourceLoader
            bridge = mapBridge
            webView = view
            addView(view, 0, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
            loadRuntime(view, current)
            updateVisibility()
        } catch (error: Exception) {
            retireGeneration()
            onEvent(
                TileflowMapEvent.Failed(
                    (error as? TileflowMapException)?.code ?: TileflowErrorCode.MISSING_RUNTIME,
                    (error as? TileflowMapException)?.context ?: TileflowErrorContext.NONE,
                )
            )
        }
    }

    /**
     * Loads the renderer once the embedded runtime is verified. The WebView's provider and renderer
     * start meanwhile, so verification overlaps their launch.
     */
    private fun loadRuntime(view: WebView, current: Int) {
        if (EmbeddedRuntime.isVerified) {
            view.loadUrl(ResourceAddress.RUNTIME_URL)
            return
        }
        EmbeddedRuntime.verification(context.assets).whenComplete { _, error ->
            post {
                if (destroyed || generation != current || webView !== view) return@post
                if (error == null) view.loadUrl(ResourceAddress.RUNTIME_URL)
                else {
                    val failure = EmbeddedRuntime.mapException(error)
                    retireGeneration()
                    onEvent(TileflowMapEvent.Failed(failure.code, failure.context))
                }
            }
        }
    }

    private fun receive(event: String, result: JSONObject, current: Int) {
        if (event == "contentReady" && !readyForEvents) {
            pendingReadyEvent = true
            return
        }
        if (event == "animationEnded" || event == "shotCue") {
            animations.receive(event, result)
            return
        }
        if (event == "followModeChanged") {
            receiveFollowModeChanged(result)
            return
        }
        val parsed =
            try {
                parseMapEvent(event, result, density)
            } catch (_: org.json.JSONException) {
                TileflowMapEvent.Failed(TileflowErrorCode.RENDERER_FAILED)
            } catch (_: IllegalArgumentException) {
                TileflowMapEvent.Failed(TileflowErrorCode.RENDERER_FAILED)
            }
        if (parsed == TileflowMapEvent.ContentReady)
            cameraOrNull(result.optJSONObject("camera"))?.let(::observe)
        // Consumer callbacks execute outside parsing guards: never mask application exceptions.
        when (parsed) {
            null -> Unit
            TileflowMapEvent.ContentReady -> contentReady()
            is TileflowMapEvent.Failed -> report(parsed.code, current, parsed.context)
            is TileflowMapEvent.CameraChanged -> {
                observe(parsed.change.camera)
                onCameraObserved?.invoke(parsed.change)
                cameraEvents.receive(parsed.change, options.events) {
                    if (!destroyed && generation == current)
                        onEvent(TileflowMapEvent.CameraChanged(it))
                }
            }
            is TileflowMapEvent.GestureStarted,
            is TileflowMapEvent.GestureEnded ->
                if (options.events.level.includes(TileflowEventLevel.CAMERA)) onEvent(parsed)
            else -> onEvent(parsed)
        }
    }

    /** The current renderer once it has initialized. */
    internal val readyBridge: MapBridge?
        get() = bridge?.takeIf { initialized }

    internal val isDestroyed: Boolean
        get() = destroyed

    /** Records options a dedicated call already gave the renderer. */
    internal fun keepOptions(options: TileflowMapOptions) {
        this.options = options
    }

    /** Records where line progress animations lead, so a new renderer draws the lines there. */
    internal fun keepLineProgress(progress: TileflowLineProgress, layers: Set<String>) {
        content =
            content.copy(
                overlays =
                    content.overlays.map { layer ->
                        val current = layer.progress
                        if (layer.id !in layers || current == null) layer
                        else layer.withProgress(progress.copy(highlight = current.highlight))
                    }
            )
    }

    internal fun launchOnView(block: suspend CoroutineScope.() -> Unit) {
        scope.launch(block = block)
    }

    /** Pending calls fail with `cancelled` when replaced and with `disposed` when destroyed. */
    private fun retireGeneration(code: TileflowErrorCode = TileflowErrorCode.CANCELLED) {
        initialized = false
        rendererInsets = null
        insetsUpdate?.cancel()
        insetsUpdate = null
        cameraEvents.rendererReplaced()
        controlsView.visibility = GONE
        readyForEvents = false
        pendingReadyEvent = false
        generationReady = false
        rendererVisible = false
        animations.retire(code)
        bridge?.retire(code)
        loader?.close()
        bootstrap?.remove()
        webView?.let {
            it.stopLoading()
            WebViewCompat.removeWebMessageListener(it, "tileflowNative")
            removeView(it)
            it.destroy()
        }
        bridge = null
        loader = null
        bootstrap = null
        webView = null
    }

    public companion object {
        /**
         * Prepares what every map needs before the first one is shown: verifies the embedded
         * renderer, reads the device profile, opens the shared HTTP client and resource cache, and
         * loads the WebView provider. Call it on the main thread early, for example in
         * `Application.onCreate` or before navigating to a screen with a map; calling it again only
         * repeats the cheap checks. Maps work without it, but the first one then pays these costs
         * while it loads.
         */
        @JvmStatic
        @MainThread
        public fun prewarm(context: Context) {
            MapPrewarmer.start(context)
        }
    }

}
