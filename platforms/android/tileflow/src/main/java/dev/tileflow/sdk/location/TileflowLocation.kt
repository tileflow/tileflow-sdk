package dev.tileflow.sdk.location

import android.location.Location
import androidx.annotation.MainThread
import dev.tileflow.sdk.TileflowCoordinate
import java.lang.ref.WeakReference

/**
 * A position of the device, as a location provider reports it.
 *
 * @property timestamp When the position was measured, in milliseconds since 1970.
 * @property horizontalAccuracy The radius of uncertainty around [coordinate], in metres; null when
 *   unknown.
 * @property altitude The altitude above the WGS 84 ellipsoid, in metres; null when unknown.
 * @property course The direction of travel, in degrees clockwise from true north; null when
 *   unknown.
 * @property speed The speed, in metres per second; null when unknown.
 */
public data class TileflowLocation(
    val coordinate: TileflowCoordinate,
    val timestamp: Long = System.currentTimeMillis(),
    val horizontalAccuracy: Double? = null,
    val altitude: Double? = null,
    val course: Double? = null,
    val speed: Double? = null,
) {
    /** Whether the values are within the ranges the map draws. */
    internal val isValid: Boolean
        get() =
            coordinate.longitude in -180.0..180.0 &&
                coordinate.latitude in -90.0..90.0 &&
                (horizontalAccuracy?.let { it.isFinite() && it >= 0 } ?: true) &&
                (course?.isFinite() ?: true)

    public companion object {
        /** An Android fix, with the values it does not have left out. */
        @JvmStatic
        public fun of(location: Location): TileflowLocation =
            TileflowLocation(
                TileflowCoordinate(location.longitude, location.latitude),
                location.time,
                if (location.hasAccuracy()) location.accuracy.toDouble() else null,
                if (location.hasAltitude()) location.altitude else null,
                if (location.hasBearing() && hasUsefulBearing(location))
                    location.bearing.toDouble()
                else null,
                if (location.hasSpeed()) location.speed.toDouble() else null,
            )

        /** A bearing whose uncertainty covers every direction says nothing. */
        private fun hasUsefulBearing(location: Location): Boolean =
            !location.hasBearingAccuracy() || location.bearingAccuracyDegrees < 180f
    }
}

/**
 * The direction the device points, as a location provider reports it.
 *
 * @property direction Degrees clockwise from true north toward which the top of the screen points.
 * @property accuracy The maximum deviation of [direction], in degrees; null when unknown.
 * @property timestamp In milliseconds since 1970.
 */
public data class TileflowHeading(
    val direction: Double,
    val accuracy: Double? = null,
    val timestamp: Long = System.currentTimeMillis(),
)

/** Receives the positions and headings a [TileflowLocationProvider] reports. A map is one. */
@MainThread
public interface TileflowLocationConsumer {
    public fun locationUpdated(location: TileflowLocation)

    public fun headingUpdated(heading: TileflowHeading) {}
}

/**
 * A source of positions and headings for maps.
 *
 * A provider delivers on the main thread to every consumer it holds. It should measure only while
 * it has consumers: a map adds itself while it shows the location and is visible, and removes
 * itself otherwise. A new consumer receives the latest known position at once, if there is one.
 * [TileflowDefaultLocationProvider] measures the device; [TileflowSimulatedLocationProvider]
 * replays a route.
 */
@MainThread
public interface TileflowLocationProvider {
    public fun addConsumer(consumer: TileflowLocationConsumer)

    public fun removeConsumer(consumer: TileflowLocationConsumer)
}

/** The consumers of a provider, held weakly so a forgotten map is never kept alive. */
internal class LocationConsumers {
    private val entries = mutableListOf<WeakReference<TileflowLocationConsumer>>()

    val all: List<TileflowLocationConsumer>
        get() = entries.mapNotNull { it.get() }

    val isEmpty: Boolean
        get() = all.isEmpty()

    /** Returns whether the consumer was new. */
    fun add(consumer: TileflowLocationConsumer): Boolean {
        entries.removeAll { it.get() == null }
        if (entries.any { it.get() === consumer }) return false
        entries += WeakReference(consumer)
        return true
    }

    fun remove(consumer: TileflowLocationConsumer) {
        entries.removeAll { it.get() == null || it.get() === consumer }
    }
}
