package dev.tileflow.sdk.location

import android.content.Context
import androidx.annotation.MainThread

/**
 * The SDK's provider: Google Play services' Fused Location Provider when the application includes
 * `com.google.android.gms:play-services-location` and the device has Google Play services,
 * otherwise the platform's `LocationManager`. It measures only while a map or another consumer
 * needs it and the application has access, and reports the device's heading from its rotation
 * sensor.
 *
 * It asks for no access by itself; see [TileflowLocationPermissions]. It never measures in the
 * background.
 */
@MainThread
public class TileflowDefaultLocationProvider(context: Context) : TileflowLocationProvider {
    private val context = context.applicationContext
    private val consumers = LocationConsumers()
    private val compass = CompassEngine(this.context)
    private var engine: LocationEngine? = null
    private var updating = false
    // Held here: the permission listeners are weak.
    private val permissionsChanged: () -> Unit = { refresh() }

    /** The latest position the provider reported. */
    public var latestLocation: TileflowLocation? = null
        private set

    /** The latest heading the provider reported. */
    public var latestHeading: TileflowHeading? = null
        private set

    /** Whether positions come from Google Play services' Fused Location Provider. */
    public val usesGooglePlayServices: Boolean
        get() = engine() is FusedLocationEngine

    init {
        PermissionChanges.add(permissionsChanged)
    }

    override fun addConsumer(consumer: TileflowLocationConsumer) {
        if (!consumers.add(consumer)) return
        latestLocation?.let(consumer::locationUpdated)
        latestHeading?.let(consumer::headingUpdated)
        refresh()
    }

    override fun removeConsumer(consumer: TileflowLocationConsumer) {
        consumers.remove(consumer)
        refresh()
    }

    /**
     * Starts measuring if the application gained access, or stops if it lost it. Maps call it when
     * they become visible; [TileflowLocationPermissions.RequestWhenInUse] calls it after each
     * answer.
     */
    public fun refresh() {
        val wanted =
            !consumers.isEmpty &&
                TileflowLocationPermissions.authorization(context).allowsLocation
        if (wanted == updating) return
        updating = wanted
        if (!wanted) {
            engine?.stop()
            compass.stop()
            return
        }
        try {
            engine().start(::deliver)
            compass.start(::deliver)
        } catch (_: SecurityException) {
            // Access was withdrawn meanwhile; the next refresh tries again.
            updating = false
        }
    }

    private fun deliver(location: android.location.Location) {
        compass.locate(location)
        val fix = TileflowLocation.of(location)
        if (!fix.isValid) return
        latestLocation = fix
        for (consumer in consumers.all) consumer.locationUpdated(fix)
    }

    private fun deliver(heading: TileflowHeading) {
        latestHeading = heading
        for (consumer in consumers.all) consumer.headingUpdated(heading)
    }

    private fun engine(): LocationEngine =
        engine
            ?: (fused(context) ?: PlatformLocationEngine(context)).also { engine = it }

    private companion object {
        /**
         * The Fused Location Provider, without a dependency on it: in an application without
         * `play-services-location` the engine's class cannot load, and the platform serves.
         */
        fun fused(context: Context): LocationEngine? =
            try {
                FusedLocationEngine.createIfAvailable(context)
            } catch (_: LinkageError) {
                null
            }
    }
}
