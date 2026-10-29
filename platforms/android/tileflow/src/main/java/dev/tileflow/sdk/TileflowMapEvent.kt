package dev.tileflow.sdk

import java.net.URI

public sealed interface TileflowMapEvent {
    /** A user activated an attribution link. The application chooses how to present it. */
    public data class ExternalLinkRequested(val url: URI) : TileflowMapEvent

    public data class AnnotationActivated(val id: String, val coordinate: TileflowCoordinate) :
        TileflowMapEvent

    public data class PoiActivated(val selection: TileflowPoiSelection) : TileflowMapEvent

    public data object Loading : TileflowMapEvent

    /** The renderer's load event; it does not guarantee presentation by the native compositor. */
    public data object ContentReady : TileflowMapEvent

    /**
     * The camera started to move, moved or settled. Which of these arrive depends on
     * [TileflowMapOptions.events]; the settled camera always does.
     */
    public data class CameraChanged(val change: TileflowCameraChange) : TileflowMapEvent

    /**
     * A person tapped the map, outside annotations and points of interest. [point] is in physical
     * pixels relative to the view.
     */
    public data class Tap(val coordinate: TileflowCoordinate, val point: TileflowPoint) :
        TileflowMapEvent {
        public val longitude: Double
            get() = coordinate.longitude

        public val latitude: Double
            get() = coordinate.latitude
    }

    /**
     * A person pressed and held the map without moving. [point] is in physical pixels relative to
     * the view.
     */
    public data class LongPress(val coordinate: TileflowCoordinate, val point: TileflowPoint) :
        TileflowMapEvent

    /**
     * A person started to pan, zoom, rotate or pitch the map. Arrives at the
     * [TileflowEventLevel.CAMERA] level and above.
     */
    public data class GestureStarted(val gesture: TileflowGesture) : TileflowMapEvent

    /** The gesture ended. Motion that continues after it is part of the camera's movement. */
    public data class GestureEnded(val gesture: TileflowGesture) : TileflowMapEvent

    /** A person tapped the recenter button. The application chooses where the camera goes. */
    public data object RecenterRequested : TileflowMapEvent

    public data class ThemeChanged(val theme: String) : TileflowMapEvent

    /**
     * The map continues, but something it tried did not work, for example tiles that failed to
     * load. Repeats of one warning within a second arrive together; [occurrences] counts them.
     */
    public data class Warning(
        val code: TileflowErrorCode,
        val context: TileflowErrorContext,
        val occurrences: Int,
    ) : TileflowMapEvent

    /**
     * The map stopped loading or its renderer failed. [TileflowErrorCode.isRecoverable] tells
     * whether [TileflowMapView.reload] can succeed without other changes.
     */
    public data class Failed(
        val code: TileflowErrorCode,
        val context: TileflowErrorContext = TileflowErrorContext.NONE,
    ) : TileflowMapEvent {
        public val isRecoverable: Boolean
            get() = code.isRecoverable
    }
}

public enum class TileflowCameraChangePhase {
    STARTED,
    MOVING,
    ENDED,
}

public data class TileflowCameraChange(
    val camera: TileflowCamera,
    val reason: TileflowCameraChangeReason,
    val phase: TileflowCameraChangePhase,
) {
    /** Whether the camera has settled. */
    public val isFinal: Boolean
        get() = phase == TileflowCameraChangePhase.ENDED
}
