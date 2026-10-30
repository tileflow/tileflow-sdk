package dev.tileflow.sdk.location

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.os.Looper
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Google Play services' Fused Location Provider. The SDK compiles against it but does not depend
 * on it: this class is the only one that refers to it, and the SDK uses it only when the
 * application includes `com.google.android.gms:play-services-location` and the device has Google
 * Play services.
 */
internal class FusedLocationEngine private constructor(context: Context) : LocationEngine {
    private val client = LocationServices.getFusedLocationProviderClient(context)
    private var callback: LocationCallback? = null

    @SuppressLint("MissingPermission")
    override fun start(deliver: (Location) -> Unit) {
        stop()
        val next =
            object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    result.lastLocation?.let(deliver)
                }
            }
        callback = next
        client.lastLocation.addOnSuccessListener { location ->
            if (callback === next && location != null) deliver(location)
        }
        client.requestLocationUpdates(
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
                .setMinUpdateIntervalMillis(LOCATION_INTERVAL_MS / 2)
                .build(),
            next,
            Looper.getMainLooper(),
        )
    }

    override fun stop() {
        callback?.let { client.removeLocationUpdates(it) }
        callback = null
    }

    companion object {
        /** The engine, when Google Play services is available on the device. */
        fun createIfAvailable(context: Context): LocationEngine? =
            if (
                GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) ==
                    ConnectionResult.SUCCESS
            )
                FusedLocationEngine(context)
            else null
    }
}
