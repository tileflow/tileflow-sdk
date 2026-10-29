package dev.tileflow.sdk.location

import android.os.Handler
import android.os.Looper
import androidx.annotation.MainThread
import dev.tileflow.sdk.TileflowCoordinate
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Replays a route at a constant speed, for tests, demonstrations and the emulator.
 *
 * Each update moves along the route by the distance the speed covers in the update interval and
 * reports the position, with the direction of travel as both the course and the heading. While it
 * plays automatically it starts with its first consumer and pauses without consumers; [advance]
 * moves it by hand, for deterministic tests.
 *
 * @param route At least one coordinate.
 * @param speed Metres per second.
 * @param horizontalAccuracy The accuracy reported with each position, in metres.
 * @param loops Whether the route starts again from its first point when it ends.
 * @param playsAutomatically Replays in real time while there are consumers. When false, only
 *   [advance] moves along the route.
 */
@MainThread
public class TileflowSimulatedLocationProvider
@JvmOverloads
constructor(
    public val route: List<TileflowCoordinate>,
    public val speed: Double = 10.0,
    public val updateIntervalMillis: Long = 1000,
    public val horizontalAccuracy: Double = 5.0,
    public val loops: Boolean = false,
    private val playsAutomatically: Boolean = true,
) : TileflowLocationProvider {
    private val lengths = route.zipWithNext { a, b -> meters(a, b) }
    private val consumers = LocationConsumers()
    private val handler by lazy { Handler(Looper.getMainLooper()) }
    private var playing = false
    private val tick =
        object : Runnable {
            override fun run() {
                if (!playing) return
                advance(updateIntervalMillis)
                if (playing) handler.postDelayed(this, updateIntervalMillis)
            }
        }

    /** The distance travelled along the route, in metres. */
    public var distance: Double = 0.0
        private set

    /** The latest position the provider reported. */
    public var latestLocation: TileflowLocation? = null
        private set

    init {
        require(route.isNotEmpty()) { "A simulated route needs at least one coordinate." }
        require(speed >= 0 && updateIntervalMillis > 0 && horizontalAccuracy >= 0)
    }

    /** The route's length in metres. */
    public val length: Double
        get() = lengths.sum()

    /** Whether the replay reached the end of a route that does not loop. */
    public val isFinished: Boolean
        get() = !loops && distance >= length

    override fun addConsumer(consumer: TileflowLocationConsumer) {
        if (!consumers.add(consumer)) return
        val latest = latestLocation
        if (latest == null) {
            // The first consumer starts the replay at the route's first point.
            report()
        } else {
            consumer.locationUpdated(latest)
            latest.course?.let {
                consumer.headingUpdated(TileflowHeading(it, null, latest.timestamp))
            }
        }
        play()
    }

    override fun removeConsumer(consumer: TileflowLocationConsumer) {
        consumers.remove(consumer)
        if (consumers.isEmpty) pause()
    }

    /** Moves along the route by what the speed covers in [millis], and reports the position. */
    public fun advance(millis: Long): TileflowLocation {
        val total = length
        distance += speed * millis.coerceAtLeast(0) / 1000.0
        distance = if (loops && total > 0) distance % total else min(distance, total)
        return report()
    }

    /** The position and direction of travel at [distance] metres along the route. */
    public fun pointAt(distance: Double): Pair<TileflowCoordinate, Double?> {
        var remaining = distance.coerceAtLeast(0.0)
        for ((index, length) in lengths.withIndex()) {
            val from = route[index]
            val to = route[index + 1]
            if (remaining <= length || index == lengths.lastIndex) {
                val t = if (length > 0) min(remaining / length, 1.0) else 1.0
                return TileflowCoordinate(
                    from.longitude + (to.longitude - from.longitude) * t,
                    from.latitude + (to.latitude - from.latitude) * t,
                ) to (if (length > 0) course(from, to) else null)
            }
            remaining -= length
        }
        return route[0] to null
    }

    private fun report(): TileflowLocation {
        val (coordinate, course) = pointAt(distance)
        val location =
            TileflowLocation(
                coordinate,
                System.currentTimeMillis(),
                horizontalAccuracy,
                course = course,
                speed = if (isFinished) 0.0 else speed,
            )
        latestLocation = location
        for (consumer in consumers.all) {
            consumer.locationUpdated(location)
            course?.let { consumer.headingUpdated(TileflowHeading(it, null, location.timestamp)) }
        }
        if (isFinished) pause()
        return location
    }

    private fun play() {
        if (!playsAutomatically || playing || isFinished) return
        playing = true
        handler.postDelayed(tick, updateIntervalMillis)
    }

    private fun pause() {
        if (!playing) return
        playing = false
        handler.removeCallbacks(tick)
    }

    internal companion object {
        /** The great-circle distance in metres. */
        fun meters(a: TileflowCoordinate, b: TileflowCoordinate): Double {
            val dLat = Math.toRadians(b.latitude - a.latitude)
            val dLon = Math.toRadians(b.longitude - a.longitude)
            val h =
                sin(dLat / 2) * sin(dLat / 2) +
                    cos(Math.toRadians(a.latitude)) *
                        cos(Math.toRadians(b.latitude)) *
                        sin(dLon / 2) *
                        sin(dLon / 2)
            return 2 * 6_371_008.8 * asin(min(1.0, sqrt(h)))
        }

        /** The initial bearing from [a] to [b], in degrees clockwise from true north. */
        fun course(a: TileflowCoordinate, b: TileflowCoordinate): Double {
            val dLon = Math.toRadians(b.longitude - a.longitude)
            val y = sin(dLon) * cos(Math.toRadians(b.latitude))
            val x =
                cos(Math.toRadians(a.latitude)) * sin(Math.toRadians(b.latitude)) -
                    sin(Math.toRadians(a.latitude)) * cos(Math.toRadians(b.latitude)) * cos(dLon)
            return (Math.toDegrees(atan2(y, x)) + 360) % 360
        }
    }
}
