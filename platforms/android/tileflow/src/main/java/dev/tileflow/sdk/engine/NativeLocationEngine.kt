package dev.tileflow.sdk.engine

import android.app.PendingIntent
import android.location.Location
import android.os.Handler
import android.os.Looper
import org.maplibre.android.location.CompassEngine
import org.maplibre.android.location.CompassListener
import org.maplibre.android.location.engine.LocationEngine
import org.maplibre.android.location.engine.LocationEngineCallback
import org.maplibre.android.location.engine.LocationEngineRequest
import org.maplibre.android.location.engine.LocationEngineResult

/** The location component receives only fixes and headings supplied by the view's provider. */
internal class NativeLocationEngine : LocationEngine, CompassEngine {
    private val clients = mutableMapOf<LocationEngineCallback<LocationEngineResult>, Handler>()
    private val compasses = mutableSetOf<CompassListener>()

    var fix: Location? = null
        private set

    var heading: Float? = null
        private set

    fun update(fix: Location?) {
        this.fix = fix
        val result = LocationEngineResult.create(fix)
        for ((callback, handler) in clients.toMap()) {
            if (handler.looper == Looper.myLooper()) callback.onSuccess(result)
            else handler.post { if (clients.containsKey(callback)) callback.onSuccess(result) }
        }
    }

    fun direction(value: Float?) {
        heading = value
        if (value != null) compasses.toList().forEach { it.onCompassChanged(value) }
    }

    override fun getLastLocation(callback: LocationEngineCallback<LocationEngineResult>) {
        callback.onSuccess(LocationEngineResult.create(fix))
    }

    override fun requestLocationUpdates(
        request: LocationEngineRequest,
        callback: LocationEngineCallback<LocationEngineResult>,
        looper: Looper?,
    ) {
        clients[callback] = Handler(looper ?: Looper.getMainLooper())
    }

    override fun removeLocationUpdates(callback: LocationEngineCallback<LocationEngineResult>) {
        clients.remove(callback)
    }

    override fun requestLocationUpdates(
        request: LocationEngineRequest,
        pendingIntent: PendingIntent,
    ) {
        throw UnsupportedOperationException(
            "Map location updates are delivered to foreground listeners."
        )
    }

    override fun removeLocationUpdates(pendingIntent: PendingIntent) {}

    override fun addCompassListener(listener: CompassListener) {
        compasses.add(listener)
        heading?.let { listener.onCompassChanged(it) }
    }

    override fun removeCompassListener(listener: CompassListener) {
        compasses.remove(listener)
    }

    override fun getLastHeading(): Float = heading ?: 0f

    override fun getLastAccuracySensorStatus(): Int =
        if (heading != null) android.hardware.SensorManager.SENSOR_STATUS_ACCURACY_HIGH
        else android.hardware.SensorManager.SENSOR_STATUS_UNRELIABLE
}
