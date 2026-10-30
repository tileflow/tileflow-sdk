package dev.tileflow.sdk.location

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.location.Location
import android.location.LocationManager
import android.os.Build
import android.view.Display
import android.view.Surface
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import kotlin.math.abs

/** Measures positions while started. Each engine delivers on the main thread. */
internal interface LocationEngine {
    /** Throws [SecurityException] when the application has no access. */
    fun start(deliver: (Location) -> Unit)

    fun stop()
}

/** How often engines ask for a position, in milliseconds. */
internal const val LOCATION_INTERVAL_MS = 1000L

/**
 * The platform's `LocationManager`: its fused provider where the platform has one (Android 12 and
 * later), otherwise satellite and network positions together, keeping the better of the two.
 */
internal class PlatformLocationEngine(context: Context) : LocationEngine {
    private val context = context.applicationContext
    private val manager = context.getSystemService(LocationManager::class.java)
    private val listeners = mutableListOf<LocationListenerCompat>()
    private var best: Location? = null

    private fun providers(): List<String> {
        val available = manager.allProviders
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                LocationManager.FUSED_PROVIDER in available
        )
            return listOf(LocationManager.FUSED_PROVIDER)
        return listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter {
            it in available
        }
    }

    @SuppressLint("MissingPermission")
    override fun start(deliver: (Location) -> Unit) {
        stop()
        val accept = { location: Location ->
            if (isBetter(location, best)) {
                best = location
                deliver(location)
            }
        }
        val request =
            LocationRequestCompat.Builder(LOCATION_INTERVAL_MS)
                .setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY)
                .setMinUpdateIntervalMillis(LOCATION_INTERVAL_MS / 2)
                .build()
        var started = false
        var denied: SecurityException? = null
        for (provider in providers()) {
            try {
                manager.getLastKnownLocation(provider)?.let(accept)
                val listener = LocationListenerCompat { accept(it) }
                LocationManagerCompat.requestLocationUpdates(
                    manager,
                    provider,
                    request,
                    ContextCompat.getMainExecutor(context),
                    listener,
                )
                listeners += listener
                started = true
            } catch (error: SecurityException) {
                // Satellite positions need the precise location; the network's do not.
                denied = error
            }
        }
        if (!started && denied != null) throw denied
    }

    // Removing a listener needs no permission; the annotation on the compat call says otherwise.
    @SuppressLint("MissingPermission")
    override fun stop() {
        for (listener in listeners) LocationManagerCompat.removeUpdates(manager, listener)
        listeners.clear()
    }

    companion object {
        /**
         * Whether [candidate] should replace [current]: it is much newer, or more accurate, or
         * comes from the same provider.
         */
        fun isBetter(candidate: Location, current: Location?): Boolean {
            if (current == null) return true
            val newer = candidate.time - current.time
            if (newer > 2 * LOCATION_INTERVAL_MS * 5) return true
            if (newer < 0) return false
            if (candidate.provider == current.provider) return true
            return candidate.hasAccuracy() &&
                (!current.hasAccuracy() || candidate.accuracy <= current.accuracy)
        }
    }
}

/**
 * The device's heading from its rotation vector sensor, toward the top of the screen in its
 * current rotation, corrected from magnetic to true north once a position is known.
 */
internal class CompassEngine(context: Context) : SensorEventListener {
    private val context = context.applicationContext
    private val sensors = context.getSystemService(SensorManager::class.java)
    private val sensor = sensors?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private var deliver: ((TileflowHeading) -> Unit)? = null
    private var declination = 0f
    private var last: Double? = null
    private val rotation = FloatArray(9)
    private val remapped = FloatArray(9)
    private val orientation = FloatArray(3)

    val isAvailable: Boolean
        get() = sensor != null

    fun start(deliver: (TileflowHeading) -> Unit) {
        val sensor = sensor ?: return
        this.deliver = deliver
        sensors?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
    }

    fun stop() {
        deliver = null
        last = null
        sensors?.unregisterListener(this)
    }

    /** True north differs from magnetic north by the declination where the device is. */
    fun locate(location: Location) {
        declination =
            GeomagneticField(
                    location.latitude.toFloat(),
                    location.longitude.toFloat(),
                    location.altitude.toFloat(),
                    location.time,
                )
                .declination
    }

    override fun onSensorChanged(event: SensorEvent) {
        val deliver = deliver ?: return
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        val (x, y) =
            when (displayRotation()) {
                Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
                Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
                Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
                else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
            }
        SensorManager.remapCoordinateSystem(rotation, x, y, remapped)
        SensorManager.getOrientation(remapped, orientation)
        val direction =
            ((Math.toDegrees(orientation[0].toDouble()) + declination) % 360 + 360) % 360
        // A turn smaller than a degree is noise, and would only cost a message to the map.
        val previous = last
        if (previous != null && abs(((direction - previous + 540) % 360) - 180) < 1) return
        last = direction
        deliver(TileflowHeading(direction, null, System.currentTimeMillis()))
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun displayRotation(): Int =
        context
            .getSystemService(DisplayManager::class.java)
            ?.getDisplay(Display.DEFAULT_DISPLAY)
            ?.rotation ?: Surface.ROTATION_0
}
